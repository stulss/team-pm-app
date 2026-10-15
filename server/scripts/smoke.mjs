// 실제 서버 + 실제 DB 로 핵심 흐름과 SQL 동작(조인, FK, CASCADE, 동시 요청)을 점검하는 스모크 테스트.
//
//   npm run smoke -w server                       # http://localhost:4000 (서버를 먼저 띄울 것)
//   BASE_URL=https://<배포 URL> npm run smoke -w server
//   VERCEL_BYPASS=<토큰> ...                       # 보호된 Preview 배포를 점검할 때
//
// DIRECT_URL(server/.env)로 DB 에 직접 접속해 역할을 지정하고 정리한다.
// 생성하는 데이터는 모두 @example.test 이메일/"smoke-" 프로젝트이며 종료 시 삭제한다.
import pg from 'pg';

const BASE = (process.env.BASE_URL ?? 'http://localhost:4000') + '/api/v1';
const headers = (token) => ({
  'content-type': 'application/json',
  ...(token && { authorization: `Bearer ${token}` }),
  ...(process.env.VERCEL_BYPASS && { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }),
});
const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token),
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  ← ${extra}`}`);
};

const run = Date.now().toString(36);
const emailOf = (k) => `smoke-${run}-${k}@example.test`;
const people = {};

async function cleanup() {
  await db.query(
    `DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'smoke-%@example.test')`,
  );
  await db.query(`DELETE FROM users WHERE email LIKE 'smoke-%@example.test'`);
}

await db.connect();
try {
  await cleanup(); // 이전 실행의 잔여물

  for (const k of ['admin', 'manager', 'manager2', 'member', 'outsider']) {
    const r = await call('POST', '/auth/register', {
      body: { email: emailOf(k), password: 'S3cure!pass', name: `smoke-${k}` },
    });
    if (r.status !== 201)
      throw new Error(`register ${k} failed: ${r.status} ${JSON.stringify(r.body)}`);
    people[k] = { id: r.body.user.id, token: r.body.accessToken };
  }
  const roles = {
    admin: 'admin',
    manager: 'manager',
    manager2: 'manager',
    member: 'member',
    outsider: 'member',
  };
  for (const [k, role] of Object.entries(roles)) {
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [people[k].id, role]);
  }
  const t = (k) => people[k].token;

  // --- 생성
  const created = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-project', description: 'smoke', memberIds: [people.member.id] },
  });
  check('manager 가 프로젝트 생성 (201)', created.status === 201, JSON.stringify(created.body));
  const pid = created.body.id;
  check(
    '생성자는 소유자이자 멤버',
    created.body.members?.some((m) => m.id === people.manager.id && m.isOwner),
  );
  check(
    'member 는 프로젝트 생성 불가 (403)',
    (await call('POST', '/projects', { token: t('member'), body: { name: 'x' } })).status === 403,
  );
  const ghost = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-ghost', memberIds: [crypto.randomUUID()] },
  });
  check(
    '없는 사용자를 멤버로 넣으면 400 + 프로젝트 미생성',
    ghost.status === 400 &&
      (await db.query(`SELECT 1 FROM projects WHERE name = 'smoke-ghost'`)).rowCount === 0,
  );

  // --- 조회/접근
  const listMember = await call('GET', '/projects', { token: t('member') });
  check(
    'member 목록에는 속한 프로젝트만',
    listMember.body.data.every((p) => p.id === pid) && listMember.body.meta.total === 1,
    JSON.stringify(listMember.body.meta),
  );
  check(
    '목록에 memberCount/ownerName 포함',
    listMember.body.data[0]?.memberCount === 2 &&
      listMember.body.data[0]?.ownerName === 'smoke-manager',
  );
  const listAdmin = await call('GET', '/projects?limit=100', { token: t('admin') });
  check(
    'admin 은 전체 목록에서 볼 수 있음',
    listAdmin.body.data.some((p) => p.id === pid),
  );
  check(
    '멤버 상세 (200)',
    (await call('GET', `/projects/${pid}`, { token: t('member') })).status === 200,
  );
  check(
    '비멤버 상세 (403)',
    (await call('GET', `/projects/${pid}`, { token: t('outsider') })).status === 403,
  );
  check(
    '멤버 아닌 manager 상세 (403)',
    (await call('GET', `/projects/${pid}`, { token: t('manager2') })).status === 403,
  );
  check(
    '없는 프로젝트 (404)',
    (await call('GET', `/projects/${crypto.randomUUID()}`, { token: t('admin') })).status === 404,
  );

  // --- 수정
  const renamed = await call('PATCH', `/projects/${pid}`, {
    token: t('manager'),
    body: { name: 'smoke-renamed' },
  });
  check('소유 manager 수정 (200)', renamed.status === 200 && renamed.body.name === 'smoke-renamed');
  check(
    '멤버 member 수정 불가 (403)',
    (await call('PATCH', `/projects/${pid}`, { token: t('member'), body: { name: 'x' } }))
      .status === 403,
  );
  check(
    '다른 manager 수정 불가 (403)',
    (await call('PATCH', `/projects/${pid}`, { token: t('manager2'), body: { name: 'x' } }))
      .status === 403,
  );
  const archived = await call('PATCH', `/projects/${pid}`, {
    token: t('admin'),
    body: { status: 'archived' },
  });
  check('admin 아카이브 (200)', archived.body.status === 'archived');
  const filtered = await call('GET', '/projects?status=archived&limit=100', { token: t('admin') });
  check(
    'status=archived 필터',
    filtered.body.data.some((p) => p.id === pid),
  );
  await call('PATCH', `/projects/${pid}`, { token: t('admin'), body: { status: 'active' } });

  // --- 멤버
  const added = await call('POST', `/projects/${pid}/members`, {
    token: t('manager'),
    body: { userId: people.outsider.id },
  });
  check('멤버 추가 (201)', added.status === 201);
  check(
    '추가된 사용자는 접근 가능',
    (await call('GET', `/projects/${pid}`, { token: t('outsider') })).status === 200,
  );
  const dup = await call('POST', `/projects/${pid}/members`, {
    token: t('manager'),
    body: { userId: people.outsider.id },
  });
  check(
    '중복 추가 (409 ALREADY_MEMBER)',
    dup.status === 409 && dup.body.error.code === 'ALREADY_MEMBER',
  );
  const race = await Promise.all([
    call('POST', `/projects/${pid}/members`, {
      token: t('manager'),
      body: { userId: people.manager2.id },
    }),
    call('POST', `/projects/${pid}/members`, {
      token: t('manager'),
      body: { userId: people.manager2.id },
    }),
  ]);
  check(
    '동시 추가: 201 하나 + 409 하나',
    race
      .map((r) => r.status)
      .sort()
      .join() === '201,409',
    race.map((r) => r.status).join(),
  );
  const members = await call('GET', `/projects/${pid}/members`, { token: t('member') });
  check(
    '멤버 목록 첫 번째는 소유자',
    members.body.data[0]?.isOwner === true && members.body.data.length === 4,
  );
  check(
    '소유자 제거 불가 (409)',
    (await call('DELETE', `/projects/${pid}/members/${people.manager.id}`, { token: t('admin') }))
      .status === 409,
  );
  check(
    'member 가 멤버 제거 불가 (403)',
    (await call('DELETE', `/projects/${pid}/members/${people.outsider.id}`, { token: t('member') }))
      .status === 403,
  );
  check(
    '멤버 제거 (204)',
    (
      await call('DELETE', `/projects/${pid}/members/${people.outsider.id}`, {
        token: t('manager'),
      })
    ).status === 204,
  );
  check(
    '제거 후 접근 불가 (403)',
    (await call('GET', `/projects/${pid}`, { token: t('outsider') })).status === 403,
  );

  // --- DB 제약
  let fkError;
  try {
    await db.query('DELETE FROM users WHERE id = $1', [people.manager.id]);
  } catch (e) {
    fkError = e.code;
  }
  check('소유자 사용자 삭제는 FK RESTRICT 로 막힘 (23503)', fkError === '23503', String(fkError));

  // --- 삭제 + CASCADE
  check(
    '소유 manager 는 삭제 불가 (403)',
    (await call('DELETE', `/projects/${pid}`, { token: t('manager') })).status === 403,
  );
  check(
    'admin 삭제 (204)',
    (await call('DELETE', `/projects/${pid}`, { token: t('admin') })).status === 204,
  );
  const leftover = await db.query('SELECT 1 FROM project_members WHERE project_id = $1', [pid]);
  check('삭제 시 project_members CASCADE', leftover.rowCount === 0);
  check(
    '삭제 후 조회 (404)',
    (await call('GET', `/projects/${pid}`, { token: t('admin') })).status === 404,
  );

  const rls = await db.query(
    `SELECT relname FROM pg_class WHERE relname IN ('projects','project_members') AND relrowsecurity`,
  );
  check('projects / project_members RLS 활성화', rls.rowCount === 2);
} catch (err) {
  failed += 1;
  console.error('ERROR', err);
} finally {
  await cleanup();
  const left = await db.query(
    `SELECT count(*)::int AS n FROM users WHERE email LIKE 'smoke-%@example.test'`,
  );
  console.log(`cleanup: 남은 smoke 사용자 ${left.rows[0].n}명`);
  await db.end();
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

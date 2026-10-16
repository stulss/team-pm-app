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
    let { accessToken } = r.body;
    if (r.body.needsVerification) {
      // 운영처럼 이메일 인증이 켜져 있으면 세션이 없다. 테스트 계정은 DB 에서 인증 처리한 뒤 로그인한다.
      await db.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [r.body.user.id]);
      const login = await call('POST', '/auth/login', {
        body: { email: emailOf(k), password: 'S3cure!pass' },
      });
      accessToken = login.body.accessToken;
    }
    people[k] = { id: r.body.user.id, token: accessToken };
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
  // 공개 가입 사용자(member)도 프로젝트를 만들고, 이메일로 초대하고, 직접 삭제한다
  const own = await call('POST', '/projects', {
    token: t('member'),
    body: { name: 'smoke-own' },
  });
  check(
    'member 도 프로젝트 생성 (201), 본인이 소유자',
    own.status === 201 && own.body.ownerId === people.member.id,
    JSON.stringify(own.body),
  );
  const inviteUrl = `/projects/${own.body.id}/members`;
  check(
    '이메일로 멤버 초대 (201, 대소문자 무시)',
    (
      await call('POST', inviteUrl, {
        token: t('member'),
        body: { email: emailOf('outsider').toUpperCase() },
      })
    ).status === 201,
  );
  check(
    '없는 이메일 초대 (404), 중복 초대 (409)',
    (await call('POST', inviteUrl, { token: t('member'), body: { email: 'none@example.test' } }))
      .status === 404 &&
      (await call('POST', inviteUrl, { token: t('member'), body: { email: emailOf('outsider') } }))
        .status === 409,
  );
  check(
    '소유자가 아닌 멤버는 초대·삭제 불가 (403)',
    (await call('POST', inviteUrl, { token: t('outsider'), body: { email: emailOf('admin') } }))
      .status === 403 &&
      (await call('DELETE', `/projects/${own.body.id}`, { token: t('outsider') })).status === 403,
  );
  check(
    '소유자(member)가 직접 삭제 (204) + 멤버 CASCADE',
    (await call('DELETE', `/projects/${own.body.id}`, { token: t('member') })).status === 204 &&
      (await db.query('SELECT 1 FROM project_members WHERE project_id = $1', [own.body.id]))
        .rowCount === 0,
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

  // --- 작업
  const tp = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-tasks', memberIds: [people.member.id, people.manager2.id] },
  });
  const tpid = tp.body.id;
  const task = await call('POST', `/projects/${tpid}/tasks`, {
    token: t('member'),
    body: {
      title: 'smoke 작업 1',
      description: '설명 텍스트',
      priority: 'high',
      dueDate: '2026-10-20',
      assigneeId: people.member.id,
    },
  });
  check('member 가 작업 생성 (201)', task.status === 201, JSON.stringify(task.body));
  check(
    '작업 기본값/담당자/마감일 형식',
    task.body.status === 'todo' &&
      task.body.priority === 'high' &&
      task.body.dueDate === '2026-10-20' &&
      task.body.assignee?.name === 'smoke-member' &&
      task.body.position === 1024,
    JSON.stringify(task.body),
  );
  const second = await call('POST', `/projects/${tpid}/tasks`, {
    token: t('manager'),
    body: { title: 'smoke 작업 2' },
  });
  check(
    '같은 컬럼의 다음 작업은 position 이 커짐',
    second.body.position === 2048,
    String(second.body.position),
  );
  const tid = task.body.id;

  const bad = (body, token = 'manager') =>
    call('POST', `/projects/${tpid}/tasks`, { token: t(token), body });
  check('비멤버 작업 생성 (403)', (await bad({ title: 'x' }, 'outsider')).status === 403);
  check(
    '담당자가 프로젝트 멤버가 아니면 400',
    (await bad({ title: 'x', assigneeId: people.outsider.id })).status === 400,
  );
  check('제목 없음 (400)', (await bad({ title: '  ' })).status === 400);
  check('잘못된 마감일 (400)', (await bad({ title: 'x', dueDate: '2026-13-40' })).status === 400);

  check(
    '작업 상세 (멤버 200)',
    (await call('GET', `/tasks/${tid}`, { token: t('member') })).status === 200,
  );
  check(
    '작업 상세 (비멤버 403)',
    (await call('GET', `/tasks/${tid}`, { token: t('outsider') })).status === 403,
  );
  check(
    '없는 작업 (404)',
    (await call('GET', `/tasks/${crypto.randomUUID()}`, { token: t('admin') })).status === 404,
  );

  const edited = await call('PATCH', `/tasks/${tid}`, {
    token: t('manager2'),
    body: { title: 'smoke 수정됨', priority: 'urgent', dueDate: null },
  });
  check(
    '멤버가 작업 수정 (제목/우선순위/마감일 해제)',
    edited.status === 200 &&
      edited.body.title === 'smoke 수정됨' &&
      edited.body.priority === 'urgent' &&
      edited.body.dueDate === null,
    JSON.stringify(edited.body),
  );
  const moved = await call('PATCH', `/tasks/${tid}`, {
    token: t('member'),
    body: { status: 'done' },
  });
  check(
    'done 으로 바꾸면 completedAt 설정 + 컬럼 맨 아래',
    moved.body.status === 'done' && !!moved.body.completedAt && moved.body.position === 1024,
    JSON.stringify(moved.body),
  );
  const reopened = await call('PATCH', `/tasks/${tid}`, {
    token: t('member'),
    body: { status: 'todo' },
  });
  check(
    '되돌리면 completedAt 해제 + todo 맨 아래',
    reopened.body.status === 'todo' &&
      reopened.body.completedAt === null &&
      reopened.body.position === 3072,
    JSON.stringify(reopened.body),
  );
  check(
    '변경할 항목이 없으면 400',
    (await call('PATCH', `/tasks/${tid}`, { token: t('member'), body: {} })).status === 400,
  );

  // 필터
  const q = (qs) => call('GET', `/projects/${tpid}/tasks?${qs}`, { token: t('member') });
  check(
    '필터: assignee=me',
    (await q('assignee=me')).body.data.every((x) => x.assignee?.id === people.member.id),
  );
  check(
    '필터: assignee=unassigned',
    (await q('assignee=unassigned')).body.data.every((x) => x.assignee === null),
  );
  check('필터: priority', (await q('priority=urgent')).body.meta.total === 1);
  check('필터: q 검색(대소문자 무시)', (await q('q=SMOKE%20수정')).body.meta.total === 1);
  check('필터: q 의 % 는 와일드카드가 아님', (await q('q=%25')).body.meta.total === 0);
  check('필터: status', (await q('status=in_progress')).body.meta.total === 0);
  await call('PATCH', `/tasks/${second.body.id}`, {
    token: t('manager'),
    body: { dueDate: '2026-10-01' },
  });
  check('필터: due_before', (await q('due_before=2026-10-05')).body.meta.total === 1);
  check('잘못된 필터 값 (400)', (await q('status=bogus')).status === 400);
  const grouped = await q('groupBy=status');
  check(
    'groupBy=status 는 4개 컬럼',
    Object.keys(grouped.body.columns).join() === 'todo,in_progress,review,done' &&
      grouped.body.columns.todo.length === 2,
  );
  const page2 = await q('limit=1&page=2');
  check(
    '페이지네이션 meta',
    page2.body.data.length === 1 && page2.body.meta.total === 2 && page2.body.meta.page === 2,
  );

  // 내 작업
  const mine = await call('GET', '/tasks/mine', { token: t('member') });
  check(
    '내 작업: 내게 배정된 것만 + 프로젝트 이름',
    mine.body.data.length === 1 &&
      mine.body.data[0].assignee.id === people.member.id &&
      mine.body.data[0].projectName === 'smoke-tasks',
    JSON.stringify(mine.body),
  );
  check(
    '내 작업: 배정 없으면 빈 목록',
    (await call('GET', '/tasks/mine', { token: t('outsider') })).body.data.length === 0,
  );

  // 삭제 권한
  const mTask = await call('POST', `/projects/${tpid}/tasks`, {
    token: t('member'),
    body: { title: 'smoke member 작업' },
  });
  check(
    'member 는 남이 만든 작업 삭제 불가 (403)',
    (await call('DELETE', `/tasks/${second.body.id}`, { token: t('member') })).status === 403,
  );
  check(
    'member 는 본인이 만든 작업 삭제 (204)',
    (await call('DELETE', `/tasks/${mTask.body.id}`, { token: t('member') })).status === 204,
  );
  check(
    'manager 는 남이 만든 작업도 삭제 (204)',
    (await call('DELETE', `/tasks/${tid}`, { token: t('manager2') })).status === 204,
  );

  // 멤버 제거 시 담당 작업 미배정
  await call('PATCH', `/tasks/${second.body.id}`, {
    token: t('manager'),
    body: { assigneeId: people.manager2.id },
  });
  await call('DELETE', `/projects/${tpid}/members/${people.manager2.id}`, { token: t('manager') });
  const afterRemove = await call('GET', `/tasks/${second.body.id}`, { token: t('manager') });
  check(
    '멤버 제거 시 그 프로젝트의 담당 작업은 미배정',
    afterRemove.body.assignee === null,
    JSON.stringify(afterRemove.body.assignee),
  );

  // --- 칸반 이동
  const bp = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-board', memberIds: [people.member.id] },
  });
  const bpid = bp.body.id;
  const mk = async (title, status = 'todo') =>
    (
      await call('POST', `/projects/${bpid}/tasks`, {
        token: t('manager'),
        body: { title, status },
      })
    ).body;
  const [ta, tb, tc, td] = [
    await mk('A'),
    await mk('B'),
    await mk('C'),
    await mk('D', 'in_progress'),
  ];
  const mv = (who, id, body) => call('PATCH', `/tasks/${id}/move`, { token: t(who), body });
  const board = async () =>
    (await call('GET', `/projects/${bpid}/tasks?groupBy=status`, { token: t('manager') })).body
      .columns;
  const titles = (col) => col.map((x) => x.title).join('');
  const pos = async (id) =>
    Number((await db.query('SELECT position FROM tasks WHERE id = $1', [id])).rows[0].position);

  const mid = await mv('member', tc.id, {
    status: 'todo',
    beforeTaskId: ta.id,
    afterTaskId: tb.id,
  });
  check(
    '두 작업 사이로 이동: 중간 position',
    mid.status === 200 && mid.body.position === 1536,
    JSON.stringify(mid.body),
  );
  check('groupBy 순서가 A,C,B', titles((await board()).todo) === 'ACB');
  const top = await mv('member', tb.id, { status: 'todo', afterTaskId: ta.id });
  check(
    '맨 위로 이동 (after 만)',
    top.body.position === 512 && titles((await board()).todo) === 'BAC',
  );
  const bottom = await mv('member', tb.id, { status: 'todo', beforeTaskId: tc.id });
  check(
    '맨 아래로 이동 (before 만)',
    bottom.body.position === (await pos(tc.id)) + 1024 && titles((await board()).todo) === 'ACB',
  );
  const cross = await mv('member', ta.id, { status: 'in_progress', beforeTaskId: td.id });
  check(
    '다른 컬럼으로 이동',
    cross.body.status === 'in_progress' && titles((await board()).in_progress) === 'DA',
  );
  check(
    '빈 컬럼으로 이동 (position 1024)',
    (await mv('member', tc.id, { status: 'review' })).body.position === 1024,
  );

  const doneMove = await mv('member', ta.id, { status: 'done' });
  const doneAt = doneMove.body.completedAt;
  check('done 이동 시 completed_at 설정', !!doneAt);
  const other = await mk('E', 'done');
  const within = await mv('member', ta.id, { status: 'done', beforeTaskId: other.id });
  check(
    'done 안에서 이동해도 completed_at 유지',
    within.body.completedAt === doneAt,
    `${within.body.completedAt} vs ${doneAt}`,
  );
  check(
    'done 에서 나가면 completed_at 해제',
    (await mv('member', ta.id, { status: 'todo' })).body.completedAt === null,
  );

  // 정밀도 고갈 → 재정렬
  await db.query('UPDATE tasks SET position = 1024 WHERE id = $1', [ta.id]);
  await db.query('UPDATE tasks SET position = 1024.0005 WHERE id = $1', [tb.id]);
  const rebalanced = await mv('member', tc.id, {
    status: 'todo',
    beforeTaskId: ta.id,
    afterTaskId: tb.id,
  });
  const col = (await board()).todo;
  check(
    '간격 고갈 시 재정렬 후 이동 성공 + 순서 유지',
    rebalanced.status === 200 && titles(col) === 'ACB',
    titles(col),
  );
  check(
    '재정렬 후 간격이 충분함',
    col[1].position - col[0].position > 100 && col[2].position - col[1].position > 100,
    JSON.stringify(col.map((x) => x.position)),
  );

  check(
    '이웃이 대상 컬럼에 없으면 400',
    (await mv('member', tc.id, { status: 'todo', beforeTaskId: td.id })).status === 400,
  );
  check(
    '이웃 순서가 뒤집히면 409',
    (await mv('member', tc.id, { status: 'todo', beforeTaskId: tb.id, afterTaskId: ta.id }))
      .status === 409,
  );
  check('비멤버 이동 불가 (403)', (await mv('outsider', tc.id, { status: 'todo' })).status === 403);

  // 같은 컬럼 동시 이동: 모두 성공하고 position 이 서로 달라야 함 (FOR UPDATE 직렬화)
  const racers = [await mk('R1'), await mk('R2'), await mk('R3'), await mk('R4'), await mk('R5')];
  const results = await Promise.all(racers.map((r) => mv('member', r.id, { status: 'review' })));
  const racePositions = new Set(results.map((r) => r.body.position));
  check(
    '동시 이동 5건 모두 성공 + position 중복 없음',
    results.every((r) => r.status === 200) && racePositions.size === 5,
    results.map((r) => `${r.status}:${r.body.position}`).join(' '),
  );

  await call('PATCH', `/projects/${bpid}`, { token: t('manager'), body: { status: 'archived' } });
  const frozenMove = await mv('member', tc.id, { status: 'todo' });
  check(
    '보관된 프로젝트에서 이동 불가 (409)',
    frozenMove.status === 409 && frozenMove.body.error.code === 'PROJECT_ARCHIVED',
  );
  await call('DELETE', `/projects/${bpid}`, { token: t('admin') });

  // 보관된 프로젝트는 읽기 전용
  await call('PATCH', `/projects/${tpid}`, { token: t('manager'), body: { status: 'archived' } });
  const frozen = await bad({ title: 'x' }, 'member');
  check(
    '보관된 프로젝트에 작업 생성 불가 (409 PROJECT_ARCHIVED)',
    frozen.status === 409 && frozen.body.error.code === 'PROJECT_ARCHIVED',
  );
  check(
    '보관된 프로젝트의 작업 수정 불가 (409)',
    (await call('PATCH', `/tasks/${second.body.id}`, { token: t('manager'), body: { title: 'x' } }))
      .status === 409,
  );
  check(
    '보관된 프로젝트의 작업은 조회 가능',
    (await call('GET', `/tasks/${second.body.id}`, { token: t('member') })).status === 200,
  );

  // 프로젝트 삭제 시 작업 CASCADE
  await call('DELETE', `/projects/${tpid}`, { token: t('admin') });
  check(
    '프로젝트 삭제 시 tasks CASCADE',
    (await db.query('SELECT 1 FROM tasks WHERE project_id = $1', [tpid])).rowCount === 0,
  );
  check(
    'tasks 인덱스 3개 + RLS',
    (
      await db.query(
        "SELECT 1 FROM pg_indexes WHERE tablename = 'tasks' AND indexname IN ('tasks_project_status_position_idx','tasks_assignee_status_idx','tasks_due_date_open_idx')",
      )
    ).rowCount === 3 &&
      (await db.query("SELECT 1 FROM pg_class WHERE relname = 'tasks' AND relrowsecurity"))
        .rowCount === 1,
  );

  // --- 댓글
  const cp = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-comments', memberIds: [people.member.id, people.manager2.id] },
  });
  const cpid = cp.body.id;
  const ctask = (
    await call('POST', `/projects/${cpid}/tasks`, {
      token: t('manager'),
      body: { title: 'smoke 댓글 작업' },
    })
  ).body;
  const cm = (who, body, id = ctask.id) =>
    call('POST', `/tasks/${id}/comments`, { token: t(who), body: { body } });
  const c1 = await cm('member', '첫 댓글 <b>태그</b>');
  check(
    '댓글 작성 (201) + 작성자/본문 그대로',
    c1.status === 201 &&
      c1.body.author.name === 'smoke-member' &&
      c1.body.body === '첫 댓글 <b>태그</b>' &&
      c1.body.edited === false,
    JSON.stringify(c1.body),
  );
  const c2 = await cm('manager', '두 번째');
  const c3 = await cm('manager2', '세 번째');
  check('비멤버 댓글 작성 불가 (403)', (await cm('outsider', 'x')).status === 403);
  check('빈 댓글 (400)', (await cm('member', '   ')).status === 400);
  check('5001자 댓글 (400)', (await cm('member', 'a'.repeat(5001))).status === 400);

  const clist = await call('GET', `/tasks/${ctask.id}/comments`, { token: t('member') });
  check(
    '댓글 목록은 오래된 순',
    clist.body.data.map((c) => c.body).join('|') === '첫 댓글 <b>태그</b>|두 번째|세 번째',
    JSON.stringify(clist.body.data.map((c) => c.body)),
  );
  check(
    '비멤버 댓글 목록 (403)',
    (await call('GET', `/tasks/${ctask.id}/comments`, { token: t('outsider') })).status === 403,
  );

  const withCount = await call('GET', `/tasks/${ctask.id}`, { token: t('member') });
  check(
    '작업의 commentCount = 3',
    withCount.body.commentCount === 3,
    String(withCount.body.commentCount),
  );
  const boardCount = await call('GET', `/projects/${cpid}/tasks?groupBy=status`, {
    token: t('member'),
  });
  check('보드/목록 응답에도 commentCount', boardCount.body.columns.todo[0].commentCount === 3);
  const mineCount = await call('GET', `/projects/${cpid}/tasks`, { token: t('member') });
  check('목록 응답에도 commentCount', mineCount.body.data[0].commentCount === 3);

  const commentEdited = await call('PATCH', `/comments/${c1.body.id}`, {
    token: t('member'),
    body: { body: '고친 댓글' },
  });
  check(
    '작성자 수정 (200) + edited=true',
    commentEdited.status === 200 &&
      commentEdited.body.body === '고친 댓글' &&
      commentEdited.body.edited === true,
    JSON.stringify(commentEdited.body),
  );
  check(
    '남의 댓글은 admin 도 수정 불가 (403)',
    (await call('PATCH', `/comments/${c2.body.id}`, { token: t('admin'), body: { body: 'x' } }))
      .status === 403,
  );
  check(
    '다른 member 수정 불가 (403)',
    (await call('PATCH', `/comments/${c2.body.id}`, { token: t('member'), body: { body: 'x' } }))
      .status === 403,
  );

  check(
    '다른 member 삭제 불가 (403)',
    (await call('DELETE', `/comments/${c2.body.id}`, { token: t('member') })).status === 403,
  );
  check(
    '작성자 삭제 (204)',
    (await call('DELETE', `/comments/${c1.body.id}`, { token: t('member') })).status === 204,
  );
  check(
    '프로젝트 멤버인 manager 가 남의 댓글 삭제 (204)',
    (await call('DELETE', `/comments/${c3.body.id}`, { token: t('manager') })).status === 204,
  );
  check(
    '이미 삭제된 댓글 (404)',
    (await call('DELETE', `/comments/${c1.body.id}`, { token: t('member') })).status === 404,
  );
  check(
    '삭제된 댓글 수정 불가 (404)',
    (await call('PATCH', `/comments/${c1.body.id}`, { token: t('member'), body: { body: 'x' } }))
      .status === 404,
  );

  const afterDelete = await call('GET', `/tasks/${ctask.id}/comments`, { token: t('member') });
  const masked = afterDelete.body.data.find((c) => c.id === c1.body.id);
  check(
    '삭제된 댓글은 목록에 남고 본문이 가려짐',
    masked?.deleted === true &&
      masked.body === '삭제된 댓글' &&
      !JSON.stringify(afterDelete.body).includes('고친 댓글'),
    JSON.stringify(masked),
  );
  check(
    'commentCount 는 삭제된 것을 제외 (1)',
    (await call('GET', `/tasks/${ctask.id}`, { token: t('member') })).body.commentCount === 1,
  );
  check(
    '소프트 삭제: 행은 DB 에 남아 있음',
    (
      await db.query('SELECT 1 FROM comments WHERE id = $1 AND deleted_at IS NOT NULL', [
        c1.body.id,
      ])
    ).rowCount === 1,
  );

  check(
    '작성자 사용자 삭제는 FK RESTRICT 로 막힘',
    await (async () => {
      try {
        await db.query('DELETE FROM users WHERE id = $1', [people.member.id]);
        return false;
      } catch (e) {
        return e.code === '23503';
      }
    })(),
  );

  await call('PATCH', `/projects/${cpid}`, { token: t('manager'), body: { status: 'archived' } });
  check('보관된 프로젝트에서 댓글 작성 불가 (409)', (await cm('member', 'x')).status === 409);
  check(
    '보관된 프로젝트에서 댓글 삭제 불가 (409)',
    (await call('DELETE', `/comments/${c2.body.id}`, { token: t('manager') })).status === 409,
  );
  await call('PATCH', `/projects/${cpid}`, { token: t('manager'), body: { status: 'active' } });

  await call('DELETE', `/tasks/${ctask.id}`, { token: t('manager') });
  check(
    '작업 삭제 시 댓글 CASCADE',
    (await db.query('SELECT 1 FROM comments WHERE task_id = $1', [ctask.id])).rowCount === 0,
  );
  const ctask2 = (
    await call('POST', `/projects/${cpid}/tasks`, {
      token: t('manager'),
      body: { title: 'smoke 댓글 작업 2' },
    })
  ).body;
  await cm('member', '프로젝트 삭제 시 함께 지워질 댓글', ctask2.id);
  await call('DELETE', `/projects/${cpid}`, { token: t('admin') });
  check(
    '프로젝트 삭제 시 댓글 CASCADE',
    (await db.query('SELECT 1 FROM comments WHERE task_id = $1', [ctask2.id])).rowCount === 0,
  );
  check(
    'comments 인덱스 + RLS',
    (
      await db.query(
        "SELECT 1 FROM pg_indexes WHERE tablename = 'comments' AND indexname = 'comments_task_created_idx'",
      )
    ).rowCount === 1 &&
      (await db.query("SELECT 1 FROM pg_class WHERE relname = 'comments' AND relrowsecurity"))
        .rowCount === 1,
  );

  // --- 알림
  const np = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-notif', memberIds: [people.member.id, people.manager2.id] },
  });
  const npid = np.body.id;
  const nmk = (who, body) =>
    call('POST', `/projects/${npid}/tasks`, {
      token: t(who),
      body: { title: 'smoke 알림 작업', ...body },
    });
  const nlist = (who, qs = '') => call('GET', `/notifications${qs}`, { token: t(who) });
  const ncount = async (who) =>
    (await call('GET', '/notifications/unread-count', { token: t(who) })).body.count;

  const assigned = await nmk('manager', { assigneeId: people.member.id });
  const n1 = await nlist('member');
  check(
    '배정 알림 생성 (task_assigned) + 작업·프로젝트·배정자 정보',
    n1.body.data.length === 1 &&
      n1.body.data[0].type === 'task_assigned' &&
      n1.body.data[0].taskId === assigned.body.id &&
      n1.body.data[0].projectId === npid &&
      n1.body.data[0].actor?.name === 'smoke-manager' &&
      n1.body.data[0].isRead === false,
    JSON.stringify(n1.body),
  );
  check(
    '본인에게 배정하면 알림 없음',
    await (async () => {
      const before = (await nlist('manager')).body.meta.total;
      await nmk('manager', { assigneeId: people.manager.id });
      return (await nlist('manager')).body.meta.total === before;
    })(),
  );
  check(
    '담당자 변경 시 새 담당자에게만 알림',
    await (async () => {
      await call('PATCH', `/tasks/${assigned.body.id}`, {
        token: t('manager'),
        body: { assigneeId: people.manager2.id },
      });
      return (await nlist('manager2')).body.data.some((n) => n.taskId === assigned.body.id);
    })(),
  );

  await call('POST', `/tasks/${assigned.body.id}/comments`, {
    token: t('manager2'),
    body: { body: '알림 테스트 댓글' },
  });
  const withComment = await nlist('manager');
  check(
    '댓글 알림: 작업 작성자에게 (comment_added), 댓글 작성자 본인은 제외',
    withComment.body.data.some(
      (n) => n.type === 'comment_added' && n.taskId === assigned.body.id,
    ) && !(await nlist('manager2')).body.data.some((n) => n.type === 'comment_added'),
  );

  check('unread-count', (await ncount('member')) === 1);
  const first = (await nlist('member')).body.data[0];
  check(
    '다른 사용자는 남의 알림을 읽음 처리할 수 없음 (404)',
    (await call('PATCH', `/notifications/${first.id}/read`, { token: t('manager2') })).status ===
      404,
  );
  check(
    '읽음 처리 (204) → unread-count 0',
    (await call('PATCH', `/notifications/${first.id}/read`, { token: t('member') })).status ===
      204 && (await ncount('member')) === 0,
  );
  check(
    '?unread=true 는 안 읽은 것만',
    (await nlist('member', '?unread=true')).body.data.length === 0,
  );
  check(
    'read-all 은 본인 것만 변경',
    await (async () => {
      const before = await ncount('manager2');
      const res = await call('POST', '/notifications/read-all', { token: t('manager2') });
      return (
        before >= 1 &&
        res.body.updated === before &&
        (await ncount('manager2')) === 0 &&
        (await ncount('manager')) >= 1
      );
    })(),
  );

  // 마감 알림 (Cron): 서버와 같은 시간대(Asia/Seoul)의 오늘을 DB 에서 구한다.
  if (process.env.CRON_SECRET) {
    const today = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS d"))
      .rows[0].d;
    const shift = (n) =>
      db.query('SELECT ($1::date + $2::int)::text AS d', [today, n]).then((r) => r.rows[0].d);
    const [d0, d1, d2, dm1] = [today, await shift(1), await shift(2), await shift(-1)];
    const mk = async (title, body) => (await nmk('manager', { title, ...body })).body;
    const tToday = await mk('smoke 오늘 마감', { assigneeId: people.member.id, dueDate: d0 });
    const tTomorrow = await mk('smoke 내일 마감', { assigneeId: people.member.id, dueDate: d1 });
    await mk('smoke 모레 마감', { assigneeId: people.member.id, dueDate: d2 });
    const tLate = await mk('smoke 지난 마감', { assigneeId: people.manager2.id, dueDate: dm1 });
    await mk('smoke 완료 지연', { assigneeId: people.member.id, dueDate: dm1, status: 'done' });
    await mk('smoke 미배정 지연', { dueDate: dm1 });
    await call('POST', '/notifications/read-all', { token: t('member') });

    // Cron 엔드포인트는 /api/v1 밖(/api/cron)에 있고 Authorization: Bearer <CRON_SECRET> 으로 인증한다.
    const cron = async (secret = process.env.CRON_SECRET) => {
      const res = await fetch(BASE.replace('/api/v1', '') + '/api/cron/daily', {
        headers: {
          ...(secret && { authorization: `Bearer ${secret}` }),
          ...(process.env.VERCEL_BYPASS && {
            'x-vercel-protection-bypass': process.env.VERCEL_BYPASS,
          }),
        },
      });
      return { status: res.status, body: await res.json() };
    };
    check('cron: 비밀 없이 호출하면 401', (await cron(null)).status === 401);
    check('cron: 잘못된 비밀은 401', (await cron('wrong-secret-wrong-secret')).status === 401);
    const ran = await cron();
    check(
      'cron 실행: 임박 2건(오늘·내일) + 지연 1건',
      ran.status === 200 && ran.body.dueSoon >= 2 && ran.body.overdue >= 1,
      JSON.stringify(ran.body),
    );
    const dueList = (await nlist('member')).body.data;
    check(
      '오늘/내일 마감 작업의 담당자에게 due_soon 알림 (모레는 없음)',
      dueList.some(
        (n) => n.type === 'due_soon' && n.taskId === tToday.id && n.message.includes('오늘'),
      ) &&
        dueList.some(
          (n) => n.type === 'due_soon' && n.taskId === tTomorrow.id && n.message.includes('내일'),
        ) &&
        // 모레·완료·미배정 작업은 임박 알림이 없어야 한다 (배정 알림에는 제목이 들어 있으므로 종류로 구분)
        dueList.filter((n) => n.type === 'due_soon').length === 2,
      JSON.stringify(dueList.filter((n) => n.type === 'due_soon').map((n) => n.message)),
    );
    check(
      '지난 마감 작업의 담당자에게 task_overdue 알림',
      (await nlist('manager2')).body.data.some(
        (n) => n.type === 'task_overdue' && n.taskId === tLate.id,
      ),
    );
    const again = await cron();
    check(
      '두 번째 실행은 같은 작업을 다시 알리지 않음 (중복 방지)',
      again.body.dueSoon === 0 && again.body.overdue === 0,
      JSON.stringify(again.body),
    );
    await call('PATCH', `/tasks/${tTomorrow.id}`, { token: t('manager'), body: { dueDate: d0 } });
    check('마감일을 바꾸면 임박 알림이 다시 가능', (await cron()).body.dueSoon === 1);
    await db.query(
      "UPDATE notifications SET created_at = now() - interval '100 days' WHERE task_id = $1 AND type = 'due_soon'",
      [tToday.id],
    );
    check('90일 지난 알림은 cron 이 정리', (await cron()).body.notificationsDeleted >= 1);
  }

  check(
    '작업 삭제 시 알림 CASCADE',
    await (async () => {
      await call('DELETE', `/tasks/${assigned.body.id}`, { token: t('manager') });
      return (
        (await db.query('SELECT 1 FROM notifications WHERE task_id = $1', [assigned.body.id]))
          .rowCount === 0
      );
    })(),
  );
  await call('DELETE', `/projects/${npid}`, { token: t('admin') });
  check(
    'notifications 인덱스 + RLS',
    (
      await db.query(
        "SELECT 1 FROM pg_indexes WHERE tablename = 'notifications' AND indexname = 'notifications_user_read_created_idx'",
      )
    ).rowCount === 1 &&
      (await db.query("SELECT 1 FROM pg_class WHERE relname = 'notifications' AND relrowsecurity"))
        .rowCount === 1,
  );

  // --- 대시보드: 알려진 데이터로 집계 수치가 실제 데이터와 정확히 일치하는지 확인
  {
    const today = (await db.query("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text AS d"))
      .rows[0].d;
    const shift = async (n) =>
      (await db.query('SELECT ($1::date + $2::int)::text AS d', [today, n])).rows[0].d;
    const [dm5, dm1, d0, d30] = [await shift(-5), await shift(-1), today, await shift(30)];
    const dp = await call('POST', '/projects', {
      token: t('manager'),
      body: { name: 'smoke-dash', memberIds: [people.member.id] },
    });
    const dpid = dp.body.id;
    const dmk = (title, body) =>
      call('POST', `/projects/${dpid}/tasks`, { token: t('manager'), body: { title, ...body } });
    const M = people.member.id;
    const G = people.manager.id;
    // todo 3, in_progress 1, review 1, done 3 → 전체 8, 완료 3 (37.5%)
    await dmk('T1', { assigneeId: M, dueDate: dm5 }); // 지연
    await dmk('T2', { assigneeId: M, dueDate: dm1 }); // 지연
    await dmk('T3', { dueDate: d0 }); // 오늘 → 이번 주 마감
    await dmk('P1', { status: 'in_progress', assigneeId: G, dueDate: d30 });
    await dmk('R1', { status: 'review', assigneeId: M });
    await dmk('D1', { status: 'done', assigneeId: M, dueDate: dm5 }); // 완료는 지연이 아님
    await dmk('D2', { status: 'done', assigneeId: G });
    await dmk('D3', { status: 'done' });

    const pd = (await call('GET', `/projects/${dpid}/dashboard`, { token: t('member') })).body;
    check(
      '프로젝트 진행률 3/8 = 37.5%',
      pd.progress.total === 8 && pd.progress.done === 3 && pd.progress.percent === 37.5,
      JSON.stringify(pd.progress),
    );
    check(
      '상태별 개수 (3/1/1/3)',
      JSON.stringify(pd.byStatus) ===
        JSON.stringify({ todo: 3, in_progress: 1, review: 1, done: 3 }),
      JSON.stringify(pd.byStatus),
    );
    check(
      '지연 2건 (완료된 과거 마감은 제외), 오래된 순',
      pd.overdue.count === 2 &&
        pd.overdue.tasks.map((x) => x.title).join() === 'T1,T2' &&
        pd.overdue.tasks[0].dueDate === dm5 &&
        pd.overdue.tasks[0].assignee?.name === 'smoke-member',
      JSON.stringify(pd.overdue),
    );
    check(
      '이번 주 마감 예정 1건 (오늘 마감, 지연·30일 뒤·완료 제외)',
      pd.dueThisWeek === 1,
      String(pd.dueThisWeek),
    );
    check(
      '담당자별 미완료: member 3, manager 1, 미배정 1 (동점이면 미배정 마지막)',
      JSON.stringify(pd.byAssignee.map((a) => [a.name, a.open])) ===
        JSON.stringify([
          ['smoke-member', 3],
          ['smoke-manager', 1],
          ['미배정', 1],
        ]),
      JSON.stringify(pd.byAssignee),
    );
    check(
      '비멤버 대시보드 (403)',
      (await call('GET', `/projects/${dpid}/dashboard`, { token: t('outsider') })).status === 403,
    );

    const od = (await call('GET', '/dashboard', { token: t('member') })).body;
    check(
      '내 전체 요약: 소속 프로젝트만 합산(진행률·프로젝트별)',
      od.progress.total === 8 &&
        od.progress.done === 3 &&
        od.progress.percent === 37.5 &&
        // 이 스모크의 앞 단계에서 만든 다른 프로젝트(작업 0건)에도 속해 있을 수 있으므로 이름으로 찾는다.
        od.projects.find((p) => p.name === 'smoke-dash')?.overdue === 2 &&
        od.projects.filter((p) => p.name !== 'smoke-dash').every((p) => p.total === 0),
      JSON.stringify(od.projects),
    );
    check(
      '내 전체 요약: 내 미완료 3건, 지연 목록에 프로젝트 이름',
      od.myOpen === 3 && od.overdue.count === 2 && od.overdue.tasks[0].projectName === 'smoke-dash',
    );
    check(
      '내 전체 요약: 소속 없는 사용자는 빈 요약',
      (await call('GET', '/dashboard', { token: t('outsider') })).body.projects.length === 0,
    );
    const adm = (await call('GET', '/dashboard', { token: t('admin') })).body;
    check(
      'admin 전체 요약에는 모든 진행 중 프로젝트가 포함',
      adm.projects.some((p) => p.name === 'smoke-dash'),
    );

    await call('PATCH', `/projects/${dpid}`, { token: t('manager'), body: { status: 'archived' } });
    check(
      '보관된 프로젝트는 전체 요약에서 제외되지만 프로젝트 대시보드는 열림',
      !(await call('GET', '/dashboard', { token: t('member') })).body.projects.some(
        (p) => p.name === 'smoke-dash',
      ) &&
        (await call('GET', `/projects/${dpid}/dashboard`, { token: t('member') })).status === 200,
    );
    await call('DELETE', `/projects/${dpid}`, { token: t('admin') });
  }

  // --- 이메일 인증 / 비밀번호 재설정 SQL
  // 메일 발송 자체는 단위 테스트가 검증한다. 여기서는 토큰 테이블 SQL(일회성·만료·교체·정리)과
  // 링크 처리 API 를 실제 DB 로 확인한다. 링크 클릭은 DB 에 토큰을 직접 넣어 흉내 낸다.
  {
    const { createHash, randomBytes } = await import('node:crypto');
    const authRepo = await import('../src/modules/auth/repository.js');
    const hashOf = (t) => createHash('sha256').update(t).digest('hex');
    const newToken = () => randomBytes(32).toString('base64url');
    const mailEmail = emailOf('mailflow');
    const reg = await call('POST', '/auth/register', {
      body: { email: mailEmail, password: 'S3cure!pass', name: 'smoke-mailflow' },
    });
    const uid = reg.body.user.id;
    const verifiedAt = async () =>
      (await db.query('SELECT email_verified_at FROM users WHERE id = $1', [uid])).rows[0]
        .email_verified_at;
    await db.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [uid]);
    const inHour = new Date(Date.now() + 3600_000);
    const put = (kind, token, expiresAt = inHour) =>
      authRepo.insertEmailToken({ userId: uid, kind, tokenHash: hashOf(token), expiresAt });
    const post = (path, body) => call('POST', path, { body });

    // 메일이 켜진 환경에서는 가입 직후 인증 토큰이 이미 발급돼 있다 → 비우고 시작한다.
    await db.query('DELETE FROM email_tokens WHERE user_id = $1', [uid]);
    check(
      '발급 이력이 없으면 쿨다운 조회는 null',
      (await authRepo.secondsSinceLastEmailToken(uid, 'verify')) === null,
    );
    const v1 = newToken();
    const v2 = newToken();
    await put('verify', v1);
    await put('verify', v2);
    const since = await authRepo.secondsSinceLastEmailToken(uid, 'verify');
    check(
      '방금 발급한 토큰의 경과 시간은 몇 초 이내',
      since !== null && since >= 0 && since < 30,
      String(since),
    );
    check(
      '새 링크를 발급하면 이전 링크는 무효 (400)',
      (await post('/auth/verify-email', { token: v1 })).status === 400,
    );
    check('인증 전에는 email_verified_at 이 비어 있음', (await verifiedAt()) === null);
    check(
      '유효한 인증 링크 (200) → 인증 시각 기록',
      (await post('/auth/verify-email', { token: v2 })).status === 200 &&
        (await verifiedAt()) !== null,
    );
    check(
      '같은 링크 재사용 불가 (400 INVALID_TOKEN)',
      (await post('/auth/verify-email', { token: v2 })).body?.error?.code === 'INVALID_TOKEN',
    );
    const expired = newToken();
    await put('verify', expired, new Date(Date.now() - 3600_000));
    check(
      '만료된 링크 (400)',
      (await post('/auth/verify-email', { token: expired })).status === 400,
    );

    // 비밀번호 재설정
    const before = await post('/auth/login', { email: mailEmail, password: 'S3cure!pass' });
    check('재설정 전 로그인 가능', before.status === 200, JSON.stringify(before.body));
    const r1 = newToken();
    await put('reset', r1);
    const weak = await post('/auth/reset-password', { token: r1, password: 'short' });
    const unused = await db.query(
      "SELECT 1 FROM email_tokens WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL",
      [uid],
    );
    check(
      '약한 비밀번호는 400 이고 링크는 소비되지 않음',
      weak.status === 400 && unused.rowCount === 1,
    );
    const reset = await post('/auth/reset-password', { token: r1, password: 'N3w-secure-pass' });
    check('재설정 링크로 새 비밀번호 설정 (200)', reset.status === 200, JSON.stringify(reset.body));
    const live = await db.query(
      'SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [uid],
    );
    check('재설정 후 기존 refresh 세션이 모두 폐기됨', live.rowCount === 0);
    const oldLogin = await post('/auth/login', { email: mailEmail, password: 'S3cure!pass' });
    const newLogin = await post('/auth/login', { email: mailEmail, password: 'N3w-secure-pass' });
    check(
      '이전 비밀번호 로그인 불가 (401), 새 비밀번호 가능 (200)',
      oldLogin.status === 401 && newLogin.status === 200,
    );
    check(
      '재설정 링크도 일회용 (400)',
      (await post('/auth/reset-password', { token: r1, password: 'Another-pass-9' })).status ===
        400,
    );
    const ghostEmail = `nobody-${run}@example.test`;
    check(
      '없는 이메일의 재설정·재발송 요청도 같은 202 (계정 존재 비노출)',
      (await post('/auth/forgot-password', { email: ghostEmail })).status === 202 &&
        (await post('/auth/resend-verification', { email: ghostEmail })).status === 202,
    );

    // 정리: 만료된 지 하루 지난 토큰은 cron 이 지운다
    const stale = newToken();
    await put('reset', stale, new Date(Date.now() - 2 * 86400_000));
    await authRepo.deleteExpired();
    check(
      '만료된 지 하루 지난 이메일 토큰은 정리됨',
      (await db.query('SELECT 1 FROM email_tokens WHERE token_hash = $1', [hashOf(stale)]))
        .rowCount === 0,
    );
    const rlsOn = await db.query(
      "SELECT 1 FROM pg_class WHERE relname = 'email_tokens' AND relrowsecurity",
    );
    const removed = await db.query('DELETE FROM users WHERE id = $1', [uid]);
    const left = await db.query('SELECT 1 FROM email_tokens WHERE user_id = $1', [uid]);
    check(
      'email_tokens RLS 활성화, 사용자 삭제 시 CASCADE',
      rlsOn.rowCount === 1 && removed.rowCount === 1 && left.rowCount === 0,
    );
  }

  // --- 활동 기록 (M10): SQL(커서·필터·SET NULL·CASCADE·정리)과 라우트 훅을 실제 DB 로 확인
  {
    const activityRepo = await import('../src/modules/activity/repository.js');
    const apid = (
      await call('POST', '/projects', {
        token: t('manager'),
        body: { name: 'smoke-activity', memberIds: [people.member.id] },
      })
    ).body.id;
    const feed = (qs = '', who = 'manager') =>
      call('GET', `/projects/${apid}/activities${qs}`, { token: t(who) });
    const mk = await call('POST', `/projects/${apid}/tasks`, {
      token: t('member'),
      body: { title: 'smoke-act-task', assigneeId: people.manager.id },
    });
    const atid = mk.body.id;
    await call('PATCH', `/tasks/${atid}`, {
      token: t('member'),
      body: { priority: 'high', dueDate: '2030-01-31', description: 'smoke-secret-desc' },
    });
    await call('PATCH', `/tasks/${atid}/move`, { token: t('member'), body: { status: 'review' } });
    const ac = await call('POST', `/tasks/${atid}/comments`, {
      token: t('member'),
      body: { body: 'smoke-secret-comment' },
    });
    await call('DELETE', `/comments/${ac.body.id}`, { token: t('manager') });
    await call('POST', `/projects/${apid}/members`, {
      token: t('manager'),
      body: { userId: people.outsider.id },
    });
    await call('DELETE', `/projects/${apid}/members/${people.outsider.id}`, {
      token: t('manager'),
    });
    await call('DELETE', `/tasks/${atid}`, { token: t('member') });

    const all = await feed('?limit=50');
    const seen = all.body.data.map((a) => a.action);
    check(
      '활동 기록이 최신순으로 쌓임 (프로젝트 생성 → 작업 생성/수정/이동 → 댓글 → 멤버 → 삭제)',
      all.status === 200 &&
        JSON.stringify(seen) ===
          JSON.stringify([
            'task.deleted',
            'member.removed',
            'member.added',
            'comment.deleted',
            'comment.created',
            'task.moved',
            'task.updated',
            'task.created',
            'project.created',
          ]),
      JSON.stringify(seen),
    );
    const upd = all.body.data.find((a) => a.action === 'task.updated');
    check(
      'meta(jsonb)가 객체로 돌아오고 바뀐 항목만 {from,to}, 설명은 사실만',
      upd?.meta?.changes?.priority?.to === 'high' &&
        upd.meta.changes.dueDate?.to === '2030-01-31' &&
        upd.meta.changes.description === true &&
        !upd.meta.changes.status,
      JSON.stringify(upd?.meta),
    );
    const leak = await db.query(
      "SELECT 1 FROM activity_logs WHERE project_id = $1 AND (meta::text LIKE '%smoke-secret%')",
      [apid],
    );
    check('댓글 본문·설명 내용은 DB 에 기록되지 않음', leak.rowCount === 0);
    const del = all.body.data.find((a) => a.action === 'task.deleted');
    check(
      '삭제된 작업의 기록은 남고 작업 ID·제목을 유지 (task_id FK 없음)',
      del?.taskId === atid && del.meta.title === 'smoke-act-task',
    );

    const pages = [];
    let cursor;
    for (let i = 0; i < 10; i += 1) {
      const r = await feed(`?limit=4${cursor ? `&before=${cursor}` : ''}`);
      pages.push(...r.body.data);
      cursor = r.body.nextCursor;
      if (!cursor) break;
    }
    const seqs = pages.map((a) => a.seq);
    check(
      '커서 페이지네이션: 중복·누락 없이 9건, seq 내림차순',
      pages.length === 9 &&
        new Set(pages.map((a) => a.id)).size === 9 &&
        seqs.every((v, i) => i === 0 || v < seqs[i - 1]),
      JSON.stringify(seqs),
    );
    const onlyTask = await feed(`?taskId=${atid}`);
    check(
      'taskId 필터는 그 작업의 기록만',
      onlyTask.body.data.length === 6 && onlyTask.body.data.every((a) => a.taskId === atid),
      String(onlyTask.body.data.length),
    );
    const onlyMoved = await feed('?action=task.moved');
    check('action 필터', onlyMoved.body.data.length === 1);
    check(
      '멤버·Admin 은 조회 가능, 비멤버는 403',
      (await feed('', 'member')).status === 200 &&
        (await feed('', 'admin')).status === 200 &&
        (await feed('', 'outsider')).status === 403,
    );

    // 사용자가 지워져도 기록은 남고 actor 만 NULL 이 된다
    const temp = await call('POST', '/auth/register', {
      body: { email: emailOf('actor'), password: 'S3cure!pass', name: 'smoke-actor' },
    });
    await db.query(
      "INSERT INTO activity_logs (project_id, actor_id, action, meta) VALUES ($1, $2, 'project.updated', '{}')",
      [apid, temp.body.user.id],
    );
    await db.query('DELETE FROM users WHERE id = $1', [temp.body.user.id]);
    const orphan = await db.query(
      "SELECT actor_id FROM activity_logs WHERE project_id = $1 AND action = 'project.updated'",
      [apid],
    );
    check(
      '사용자 삭제 시 기록은 유지되고 actor_id 는 NULL',
      orphan.rowCount === 1 && orphan.rows[0].actor_id === null,
    );
    const orphanApi = (await feed('?action=project.updated')).body.data[0];
    check('API 는 actor 를 null 로 돌려줌', orphanApi && orphanApi.actor === null);

    // 보관 기간 정리
    await db.query(
      "INSERT INTO activity_logs (project_id, action, created_at) VALUES ($1, 'task.created', now() - interval '200 days')",
      [apid],
    );
    const removed = await activityRepo.deleteOlderThan(activityRepo.RETENTION_DAYS);
    check(
      '180일 지난 기록만 정리됨',
      removed >= 1 && (await feed('?limit=50')).body.data.length === 10,
    );
    const rlsOn = await db.query(
      "SELECT 1 FROM pg_class WHERE relname = 'activity_logs' AND relrowsecurity",
    );
    check('activity_logs RLS 활성화', rlsOn.rowCount === 1);

    await call('DELETE', `/projects/${apid}`, { token: t('manager') });
    check(
      '프로젝트 삭제 시 활동 기록 CASCADE',
      (await db.query('SELECT 1 FROM activity_logs WHERE project_id = $1', [apid])).rowCount === 0,
    );
  }

  // --- 히스토리 공유 링크 (M10b): 해시 저장·만료·폐기·한도·공개 조회·정리를 실제 DB 로 확인
  {
    const { createHash } = await import('node:crypto');
    const shareRepo = await import('../src/modules/share/repository.js');
    const spid = (
      await call('POST', '/projects', {
        token: t('manager'),
        body: { name: 'smoke-share', memberIds: [people.member.id] },
      })
    ).body.id;
    const mkLink = (who = 'manager', days = 7) =>
      call('POST', `/projects/${spid}/share-links`, {
        token: t(who),
        body: { expiresInDays: days },
      });
    const publicGet = (tok, qs = '') =>
      fetch(`${BASE}/shared/${tok}${qs}`, {
        headers: process.env.VERCEL_BYPASS
          ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS }
          : {},
      }).then(async (r) => ({
        status: r.status,
        headers: r.headers,
        body: await r.json().catch(() => null),
      }));

    await call('POST', `/projects/${spid}/tasks`, {
      token: t('member'),
      body: { title: 'smoke-share-task' },
    });
    await call('POST', `/projects/${spid}/members`, {
      token: t('manager'),
      body: { userId: people.outsider.id },
    });

    const a = await mkLink('manager', 7);
    check(
      '소유자가 공유 링크 생성 (201), 토큰 43자',
      a.status === 201 && /^[A-Za-z0-9_-]{43}$/.test(a.body.token),
      JSON.stringify(a.body),
    );
    const stored = await db.query('SELECT token_hash FROM share_links WHERE id = $1', [a.body.id]);
    check(
      'DB 에는 SHA-256 해시만 저장 (원문 불일치)',
      stored.rows[0].token_hash === createHash('sha256').update(a.body.token).digest('hex') &&
        stored.rows[0].token_hash !== a.body.token,
    );
    check(
      '멤버(소유자 아님)는 생성·목록 불가 (403)',
      (await mkLink('member')).status === 403 &&
        (await call('GET', `/projects/${spid}/share-links`, { token: t('member') })).status === 403,
    );

    const pub = await publicGet(a.body.token);
    check(
      '로그인 없이 공개 조회 (200), 프로젝트 이름·작업 기록 포함',
      pub.status === 200 &&
        pub.body.project.name === 'smoke-share' &&
        pub.body.data.some(
          (x) => x.action === 'task.created' && x.meta.title === 'smoke-share-task',
        ),
      JSON.stringify(pub.body)?.slice(0, 200),
    );
    check(
      '공개 응답 헤더: no-store, noindex',
      pub.headers.get('cache-control') === 'no-store' &&
        (pub.headers.get('x-robots-tag') ?? '').includes('noindex'),
    );
    const actionsSeen = pub.body.data.map((x) => x.action);
    check(
      '공개 응답에서 멤버·공유 기록은 숨김',
      !actionsSeen.some((x) => x.startsWith('member.') || x.startsWith('share.')),
      JSON.stringify(actionsSeen),
    );
    check(
      '공개 응답에 이메일 없음',
      !JSON.stringify(pub.body).includes('@example.test') &&
        !JSON.stringify(pub.body).includes(people.outsider.id),
    );
    const internal = await call('GET', `/projects/${spid}/activities?limit=50`, {
      token: t('manager'),
    });
    check(
      '멤버에게는 멤버 추가·공유 생성 기록이 보임',
      internal.body.data.some((x) => x.action === 'member.added') &&
        internal.body.data.some((x) => x.action === 'share.created'),
    );

    // 조회수: 첫 페이지만 센다
    await publicGet(a.body.token, '?limit=1');
    const afterFirst = await db.query(
      'SELECT view_count, last_viewed_at FROM share_links WHERE id = $1',
      [a.body.id],
    );
    const cursor = (await publicGet(a.body.token, '?limit=1')).body.nextCursor;
    await publicGet(a.body.token, `?limit=1&before=${cursor}`);
    const afterMore = await db.query('SELECT view_count FROM share_links WHERE id = $1', [
      a.body.id,
    ]);
    check(
      '조회수는 첫 페이지에서만 증가 (더 보기는 미증가), 마지막 조회 시각 기록',
      afterFirst.rows[0].view_count === 2 &&
        afterFirst.rows[0].last_viewed_at !== null &&
        afterMore.rows[0].view_count === 3,
      `${afterFirst.rows[0].view_count}/${afterMore.rows[0].view_count}`,
    );
    const listed = await call('GET', `/projects/${spid}/share-links`, { token: t('manager') });
    check(
      '목록에는 토큰·해시가 없고 조회수가 보임',
      listed.status === 200 &&
        listed.body.data.length === 1 &&
        listed.body.data[0].viewCount === 3 &&
        !JSON.stringify(listed.body).includes(a.body.token) &&
        !JSON.stringify(listed.body).includes('hash'),
    );

    // 폐기·만료·없음은 같은 404
    const b = await mkLink('manager', 1);
    await db.query("UPDATE share_links SET expires_at = now() - interval '1 hour' WHERE id = $1", [
      b.body.id,
    ]);
    const unknown = await publicGet('z'.repeat(43));
    const expiredRes = await publicGet(b.body.token);
    check(
      '만료된 링크와 없는 링크는 같은 404 (SHARE_LINK_NOT_FOUND)',
      unknown.status === 404 &&
        expiredRes.status === 404 &&
        JSON.stringify(unknown.body) === JSON.stringify(expiredRes.body) &&
        unknown.body.error.code === 'SHARE_LINK_NOT_FOUND',
    );
    check(
      '만료된 링크는 목록·개수에서 빠짐',
      (await call('GET', `/projects/${spid}/share-links`, { token: t('manager') })).body.data
        .length === 1,
    );
    check(
      '폐기하면 즉시 404, 재폐기 404, 멤버는 폐기 불가 (403)',
      (await call('DELETE', `/projects/${spid}/share-links/${a.body.id}`, { token: t('member') }))
        .status === 403 &&
        (
          await call('DELETE', `/projects/${spid}/share-links/${a.body.id}`, {
            token: t('manager'),
          })
        ).status === 204 &&
        (await publicGet(a.body.token)).status === 404 &&
        (
          await call('DELETE', `/projects/${spid}/share-links/${a.body.id}`, {
            token: t('manager'),
          })
        ).status === 404,
    );

    // 유효 링크 5개 한도
    const made = [];
    for (let i = 0; i < 5; i += 1) made.push((await mkLink()).status);
    const sixth = await mkLink();
    check(
      '유효 링크는 프로젝트당 5개 (6번째 409 LIMIT_REACHED)',
      made.every((x) => x === 201) &&
        sixth.status === 409 &&
        sixth.body.error.code === 'LIMIT_REACHED',
      JSON.stringify(made),
    );

    // 정리: 만료·폐기된 지 30일이 지난 링크만
    await db.query(
      `INSERT INTO share_links (project_id, token_hash, expires_at)
       VALUES ($1, 'smoke-old-expired-hash', now() - interval '40 days'),
              ($1, 'smoke-recent-expired-hash', now() - interval '2 days')`,
      [spid],
    );
    const removedStale = await shareRepo.deleteStale();
    const staleLeft = await db.query(
      "SELECT token_hash FROM share_links WHERE token_hash LIKE 'smoke-%-hash'",
    );
    check(
      '30일 지난 만료 링크만 정리 (최근 만료는 유지)',
      removedStale >= 1 &&
        staleLeft.rowCount === 1 &&
        staleLeft.rows[0].token_hash === 'smoke-recent-expired-hash',
    );
    const rlsShare = await db.query(
      "SELECT 1 FROM pg_class WHERE relname = 'share_links' AND relrowsecurity",
    );
    check('share_links RLS 활성화', rlsShare.rowCount === 1);

    await call('DELETE', `/projects/${spid}`, { token: t('manager') });
    check(
      '프로젝트 삭제 시 공유 링크 CASCADE, 공개 조회도 404',
      (await db.query('SELECT 1 FROM share_links WHERE project_id = $1', [spid])).rowCount === 0 &&
        (await publicGet('y'.repeat(43))).status === 404,
    );
  }

  // --- 멘션 (M11): comment_mentions SQL, enum, 알림 중복 제거, 검증을 실제 DB 로 확인
  {
    const mpid = (
      await call('POST', '/projects', {
        token: t('manager'),
        body: { name: 'smoke-mention', memberIds: [people.member.id, people.manager2.id] },
      })
    ).body.id;
    const mtid = (
      await call('POST', `/projects/${mpid}/tasks`, {
        token: t('manager'),
        body: { title: 'smoke-mention-task', assigneeId: people.manager2.id },
      })
    ).body.id;
    await db.query('DELETE FROM notifications WHERE task_id = $1', [mtid]);
    const mention = (who, body, ids) =>
      call('POST', `/tasks/${mtid}/comments`, {
        token: t(who),
        body: { body, ...(ids && { mentionIds: ids }) },
      });
    const notesFor = (key, type) =>
      db
        .query(
          'SELECT message FROM notifications WHERE task_id = $1 AND user_id = $2 AND type = $3',
          [mtid, people[key].id, type],
        )
        .then((r) => r.rows);

    const c1 = await mention('manager', '@smoke-member 확인 부탁', [people.member.id]);
    check(
      '멘션 댓글 작성 (201), 응답에 mentions(id,name)',
      c1.status === 201 &&
        JSON.stringify(c1.body.mentions) ===
          JSON.stringify([{ id: people.member.id, name: 'smoke-member' }]),
      JSON.stringify(c1.body),
    );
    const stored = await db.query(
      'SELECT user_id, name FROM comment_mentions WHERE comment_id = $1',
      [c1.body.id],
    );
    check(
      'comment_mentions 에 (댓글, 사용자, 이름 스냅샷) 저장',
      stored.rowCount === 1 &&
        stored.rows[0].user_id === people.member.id &&
        stored.rows[0].name === 'smoke-member',
    );
    const mn = await notesFor('member', 'mention');
    check(
      "멘션된 멤버에게 'mention' 알림 (enum 값 사용 가능)",
      mn.length === 1 &&
        mn[0].message.includes('smoke-manager') &&
        mn[0].message.includes('회원님을 언급'),
      JSON.stringify(mn),
    );
    check(
      '작성자 본인에게는 알림 없음, 담당자·작성자 댓글 알림은 멘션 대상이 아니면 그대로',
      (await notesFor('manager', 'mention')).length === 0 &&
        (await notesFor('manager2', 'comment_added')).length === 1,
    );

    // 담당자를 멘션하면 mention 하나만 (comment_added 중복 없음)
    await db.query('DELETE FROM notifications WHERE task_id = $1', [mtid]);
    await mention('member', '@smoke-manager2 이거 봐 주세요', [people.manager2.id]);
    check(
      '담당자 멘션 시 mention 1건만, comment_added 는 중복 없음',
      (await notesFor('manager2', 'mention')).length === 1 &&
        (await notesFor('manager2', 'comment_added')).length === 0,
    );

    // 검증
    const before = (
      await db.query('SELECT count(*)::int AS n FROM comments WHERE task_id = $1', [mtid])
    ).rows[0].n;
    const bad1 = await mention('manager', '@smoke-outsider 안녕', [people.outsider.id]);
    const bad2 = await mention('manager', '이름이 본문에 없음', [people.member.id]);
    const bad3 = await mention('manager', '@x', [crypto.randomUUID()]);
    const after = (
      await db.query('SELECT count(*)::int AS n FROM comments WHERE task_id = $1', [mtid])
    ).rows[0].n;
    check(
      '비멤버·본문에 이름 없음·없는 사용자는 400 INVALID_MENTION, 댓글도 저장되지 않음',
      [bad1, bad2, bad3].every(
        (r) => r.status === 400 && r.body.error.code === 'INVALID_MENTION',
      ) && after === before,
      JSON.stringify([bad1.status, bad2.status, bad3.status, before, after]),
    );

    // 수정: 새로 추가된 멘션에게만 알림, 전체 교체
    await db.query('DELETE FROM notifications WHERE task_id = $1', [mtid]);
    const edited = await call('PATCH', `/comments/${c1.body.id}`, {
      token: t('manager'),
      body: { body: '@smoke-manager2 로 바꿈', mentionIds: [people.manager2.id] },
    });
    const rows = await db.query('SELECT user_id FROM comment_mentions WHERE comment_id = $1', [
      c1.body.id,
    ]);
    check(
      '수정은 멘션을 통째로 교체하고 새 멘션에게만 알림',
      edited.status === 200 &&
        rows.rowCount === 1 &&
        rows.rows[0].user_id === people.manager2.id &&
        (await notesFor('manager2', 'mention')).length === 1 &&
        (await notesFor('member', 'mention')).length === 0,
      JSON.stringify(edited.body),
    );
    const cleared = await call('PATCH', `/comments/${c1.body.id}`, {
      token: t('manager'),
      body: { body: '멘션 없이 수정' },
    });
    check(
      'mentionIds 없이 수정하면 멘션이 비워짐',
      cleared.status === 200 &&
        cleared.body.mentions.length === 0 &&
        (await db.query('SELECT 1 FROM comment_mentions WHERE comment_id = $1', [c1.body.id]))
          .rowCount === 0,
    );

    // 이름 스냅샷, 삭제 마스킹, 목록 조회(json_agg)
    const c2 = await mention('manager', '@smoke-member 스냅샷', [people.member.id]);
    await db.query("UPDATE users SET name = 'smoke-renamed' WHERE id = $1", [people.member.id]);
    const listed = await call('GET', `/tasks/${mtid}/comments`, { token: t('manager') });
    const found = listed.body.data.find((x) => x.id === c2.body.id);
    check(
      '이름이 바뀌어도 댓글의 멘션 이름(스냅샷)은 유지',
      found?.mentions?.[0]?.name === 'smoke-member' && found.body.includes('@smoke-member'),
      JSON.stringify(found?.mentions),
    );
    await db.query("UPDATE users SET name = 'smoke-member' WHERE id = $1", [people.member.id]);
    await call('DELETE', `/comments/${c2.body.id}`, { token: t('manager') });
    const masked = (
      await call('GET', `/tasks/${mtid}/comments`, { token: t('manager') })
    ).body.data.find((x) => x.id === c2.body.id);
    check(
      '삭제된 댓글은 mentions 도 빈 배열',
      masked.deleted === true && masked.mentions.length === 0,
    );

    // 제약
    const idx = await db.query(
      "SELECT 1 FROM pg_indexes WHERE tablename = 'comment_mentions' AND indexname = 'comment_mentions_user_created_idx'",
    );
    const rlsOn = await db.query(
      "SELECT 1 FROM pg_class WHERE relname = 'comment_mentions' AND relrowsecurity",
    );
    check('comment_mentions 인덱스 + RLS', idx.rowCount === 1 && rlsOn.rowCount === 1);

    const c3 = await mention('manager', '@smoke-member 삭제 연쇄', [people.member.id]);
    await db.query('DELETE FROM tasks WHERE id = $1', [mtid]);
    check(
      '작업 삭제 시 댓글과 멘션 CASCADE',
      (await db.query('SELECT 1 FROM comment_mentions WHERE comment_id = $1', [c3.body.id]))
        .rowCount === 0,
    );
    await call('DELETE', `/projects/${mpid}`, { token: t('manager') });
  }

  // --- 채팅 (M12): chat_messages SQL, 권한, 제약, 정리를 실제 DB 로 확인
  {
    const chatRepo = await import('../src/modules/chat/repository.js');
    const cpid = (
      await call('POST', '/projects', {
        token: t('manager'),
        body: { name: 'smoke-chat', memberIds: [people.member.id] },
      })
    ).body.id;
    const say = (who, body) =>
      call('POST', `/projects/${cpid}/chat`, { token: t(who), body: { body } });
    const feed = (who, qs = '') => call('GET', `/projects/${cpid}/chat${qs}`, { token: t(who) });

    const m1 = await say('member', '  안녕하세요  ');
    check(
      '채팅 보내기 (201), 공백 제거·작성자 이름 포함',
      m1.status === 201 && m1.body.body === '안녕하세요' && m1.body.author?.name === 'smoke-member',
      JSON.stringify(m1.body),
    );
    await say('manager', '둘째');
    await say('manager', '셋째');
    const page1 = await feed('member', '?limit=2');
    const page2 = await feed('member', `?limit=2&before=${page1.body.nextCursor}`);
    check(
      '채팅 목록은 최신순이고 seq 커서로 이어 읽힌다',
      page1.body.data.map((m) => m.body).join() === '셋째,둘째' &&
        typeof page1.body.nextCursor === 'number' &&
        page2.body.data.map((m) => m.body).join() === '안녕하세요' &&
        page2.body.nextCursor === null,
      JSON.stringify([page1.body, page2.body]),
    );
    check(
      '비멤버는 읽기·쓰기 403',
      (await feed('outsider')).status === 403 && (await say('outsider', '들어감')).status === 403,
    );
    check(
      '빈 메시지·2000자 초과는 400, 2000자는 통과',
      (await say('member', '   ')).status === 400 &&
        (await say('member', 'a'.repeat(2001))).status === 400 &&
        (await say('member', 'a'.repeat(2000))).status === 201,
    );
    let checkRejected = false;
    try {
      await db.query(
        "INSERT INTO chat_messages (project_id, body) VALUES ($1, repeat('a', 2001))",
        [cpid],
      );
    } catch {
      checkRejected = true;
    }
    check('DB CHECK 제약이 2001자 메시지를 거부', checkRejected);

    const del = (who, id) => call('DELETE', `/projects/${cpid}/chat/${id}`, { token: t(who) });
    check(
      '삭제: 다른 멤버는 403, 작성자 204, 소유자 204',
      (await del('manager2', m1.body.id)).status === 403 &&
        (await del('member', m1.body.id)).status === 204 &&
        (await del('manager', (await say('member', '소유자가 지움')).body.id)).status === 204,
    );
    check('삭제한 메시지는 다시 지우면 404', (await del('member', m1.body.id)).status === 404);

    // 상한 정리(trim): 가장 최근 N건만 남긴다
    await db.query('DELETE FROM chat_messages WHERE project_id = $1', [cpid]);
    for (let i = 1; i <= 6; i += 1) await say('manager', `t${i}`);
    const trimmed = await chatRepo.trim(cpid, 4);
    const left = await feed('manager');
    check(
      '상한 정리는 오래된 메시지부터 지워 최근 N건만 남김',
      trimmed === 2 && left.body.data.map((m) => m.body).join() === 't6,t5,t4,t3',
      JSON.stringify([trimmed, left.body.data.map((m) => m.body)]),
    );
    check('상한 이하이면 아무것도 지우지 않음', (await chatRepo.trim(cpid, 10)) === 0);

    // 보관 기간 정리
    await db.query(
      "INSERT INTO chat_messages (project_id, body, created_at) VALUES ($1, '오래됨', now() - interval '100 days')",
      [cpid],
    );
    const removedOld = await chatRepo.deleteOlderThan(chatRepo.RETENTION_DAYS);
    check(
      '90일 지난 메시지만 정리됨',
      removedOld >= 1 && (await feed('manager')).body.data.length === 4,
    );

    // 작성자가 지워져도 메시지는 남고 author 는 null
    const ghost = await db.query(
      "INSERT INTO users (email, password_hash, name) VALUES ('smoke-ghost@example.test', 'x', 'smoke-ghost') RETURNING id",
    );
    await db.query('INSERT INTO chat_messages (project_id, author_id, body) VALUES ($1, $2, $3)', [
      cpid,
      ghost.rows[0].id,
      '유령의 말',
    ]);
    await db.query('DELETE FROM users WHERE id = $1', [ghost.rows[0].id]);
    const orphan = (await feed('manager', '?limit=1')).body.data[0];
    check(
      '작성자가 사라져도 메시지 유지, author null',
      orphan.body === '유령의 말' && orphan.author === null,
    );

    // 보관 프로젝트는 읽기 전용
    await call('PATCH', `/projects/${cpid}`, { token: t('manager'), body: { status: 'archived' } });
    const archivedSend = await say('manager', '보관 후');
    check(
      '보관된 프로젝트: 읽기 200, 보내기 409 PROJECT_ARCHIVED',
      (await feed('manager')).status === 200 &&
        archivedSend.status === 409 &&
        archivedSend.body.error.code === 'PROJECT_ARCHIVED',
    );

    const idx = await db.query(
      "SELECT 1 FROM pg_indexes WHERE tablename = 'chat_messages' AND indexname = 'chat_messages_project_seq_idx'",
    );
    const rlsOn = await db.query(
      "SELECT 1 FROM pg_class WHERE relname = 'chat_messages' AND relrowsecurity",
    );
    check('chat_messages 인덱스 + RLS', idx.rowCount === 1 && rlsOn.rowCount === 1);

    await call('DELETE', `/projects/${cpid}`, { token: t('manager') });
    check(
      '프로젝트 삭제 시 채팅 메시지 CASCADE',
      (await db.query('SELECT 1 FROM chat_messages WHERE project_id = $1', [cpid])).rowCount === 0,
    );
  }

  // --- 통합검색 (M13): 권한 필터 SQL, ILIKE 이스케이프, 삭제 댓글 제외를 실제 DB 로 확인
  {
    const word = 'zq' + Math.random().toString(36).slice(2, 8); // 다른 데이터와 겹치지 않는 검색어
    const spA = (
      await call('POST', '/projects', {
        token: t('manager'),
        body: { name: `smoke-search-A ${word}`, memberIds: [people.member.id] },
      })
    ).body.id;
    const spB = (
      await call('POST', '/projects', {
        token: t('manager2'),
        body: { name: `smoke-search-B ${word}` },
      })
    ).body.id;
    const taskA = (
      await call('POST', `/projects/${spA}/tasks`, {
        token: t('manager'),
        body: { title: `검색작업 ${word}`, description: `설명에도 ${word} 가 있다` },
      })
    ).body.id;
    await call('POST', `/projects/${spB}/tasks`, {
      token: t('manager2'),
      body: { title: `남의작업 ${word}` },
    });
    const cm = await call('POST', `/tasks/${taskA}/comments`, {
      token: t('manager'),
      body: { body: `댓글 ${word} 내용` },
    });
    await call('POST', `/projects/${spA}/chat`, {
      token: t('member'),
      body: { body: `채팅 ${word} 내용` },
    });
    await call('POST', `/projects/${spB}/chat`, {
      token: t('manager2'),
      body: { body: `남의채팅 ${word}` },
    });
    const find = (who, q, extra = '') =>
      call('GET', `/search?q=${encodeURIComponent(q)}${extra}`, { token: t(who) });

    const mine = await find('member', word);
    check(
      '검색: 멤버는 자기 프로젝트의 프로젝트·작업·댓글·채팅을 찾는다',
      mine.status === 200 &&
        mine.body.projects.length === 1 &&
        mine.body.tasks.length === 1 &&
        mine.body.comments.length === 1 &&
        mine.body.chat.length === 1 &&
        mine.body.projects[0].id === spA,
      JSON.stringify(mine.body).slice(0, 300),
    );
    check(
      '검색: 다른 프로젝트(B)의 결과는 어떤 종류에도 없다',
      [...mine.body.tasks, ...mine.body.comments, ...mine.body.chat].every(
        (r) => r.projectId === spA,
      ),
    );
    const none = await find('outsider', word);
    check(
      '검색: 어느 프로젝트에도 속하지 않은 사용자는 결과 0건',
      none.status === 200 &&
        none.body.projects.length +
          none.body.tasks.length +
          none.body.comments.length +
          none.body.chat.length ===
          0,
    );
    const adm = await find('admin', word);
    check(
      '검색: Admin 은 모든 프로젝트를 찾는다 (A, B 둘 다)',
      adm.body.projects.length === 2 && adm.body.tasks.length === 2 && adm.body.chat.length === 2,
    );
    check(
      '검색: 설명에만 일치한 작업은 snippet 을 준다',
      mine.body.tasks[0].snippet === null || mine.body.tasks[0].snippet.includes(word),
    );
    check(
      '검색: 대소문자 무시',
      (await find('member', word.toUpperCase())).body.tasks.length === 1,
    );
    check(
      '검색: % _ \\ 는 와일드카드가 아니다',
      (await find('member', '%%')).body.tasks.length === 0 &&
        (await find('member', '__')).body.chat.length === 0 &&
        (await find('member', '\\\\')).status === 200,
    );
    await call('POST', `/projects/${spB}/chat`, {
      token: t('manager2'),
      body: { body: `${word}%50 완료` },
    });
    check(
      '검색: 실제 % 가 들어간 글은 % 를 글자로 찾고 _ 는 다른 글자와 맞지 않는다',
      (await find('manager2', `${word}%50`, '&type=chat')).body.chat.length === 1 &&
        (await find('manager2', `${word}_50`, '&type=chat')).body.chat.length === 0,
    );
    check(
      '검색: type 과 limit 적용',
      (await find('admin', word, '&type=chat&limit=1')).body.chat.length === 1 &&
        (await find('admin', word, '&type=chat')).body.tasks.length === 0,
    );
    check('검색: 검색어 1자는 400', (await find('member', 'a')).status === 400);

    await call('DELETE', `/comments/${cm.body.id}`, { token: t('manager') });
    check(
      '검색: 삭제된 댓글은 찾지 않는다',
      (await find('member', word)).body.comments.length === 0,
    );
    await call('DELETE', `/projects/${spA}/members/${people.member.id}`, { token: t('manager') });
    const removed = await find('member', word);
    check(
      '검색: 멤버에서 제거되면 그 프로젝트의 결과가 즉시 사라진다',
      removed.body.projects.length + removed.body.tasks.length + removed.body.chat.length === 0,
    );

    const idx = await db.query(
      "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_trgm_idx' ORDER BY indexname",
    );
    check(
      '검색: pg_trgm 인덱스 5개',
      idx.rowCount === 5 &&
        (await db.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")).rowCount === 1,
      JSON.stringify(idx.rows),
    );
    await call('DELETE', `/projects/${spA}`, { token: t('manager') });
    await call('DELETE', `/projects/${spB}`, { token: t('manager2') });
  }

  // --- 삭제 + CASCADE
  check(
    '소유자가 아닌 멤버/다른 manager 는 삭제 불가 (403)',
    (await call('DELETE', `/projects/${pid}`, { token: t('member') })).status === 403 &&
      (await call('DELETE', `/projects/${pid}`, { token: t('manager2') })).status === 403,
  );
  check(
    '소유자 삭제 (204)',
    (await call('DELETE', `/projects/${pid}`, { token: t('manager') })).status === 204,
  );
  const adminOwned = await call('POST', '/projects', {
    token: t('manager'),
    body: { name: 'smoke-admin-delete' },
  });
  check(
    'admin 은 남의 프로젝트도 삭제 (204)',
    (await call('DELETE', `/projects/${adminOwned.body.id}`, { token: t('admin') })).status === 204,
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

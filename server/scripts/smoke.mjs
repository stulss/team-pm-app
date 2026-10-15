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

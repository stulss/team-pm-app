import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';

vi.mock('../config/db.js', () => ({
  query: vi.fn(),
  pool: {},
  withTransaction: (fn) => fn({}),
}));
vi.mock('../modules/users/repository.js', async () => ({
  ...(await vi.importActual('../modules/users/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).usersRepo,
}));
vi.mock(
  '../modules/auth/repository.js',
  async () => (await import('./helpers/memoryRepos.js')).authRepo,
);
vi.mock('../modules/projects/repository.js', async () => ({
  ...(await vi.importActual('../modules/projects/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).projectsRepo,
}));
vi.mock('../modules/tasks/repository.js', async () => ({
  ...(await vi.importActual('../modules/tasks/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).tasksRepo,
}));

const { app } = await import('../app.js');

// admin(비멤버), manager(소유자), manager2(멤버), member(멤버), member2(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const createTask = (who, body = {}, project = pid) =>
  request(app)
    .post(`/api/v1/projects/${project}/tasks`)
    .set(as(who))
    .send({ title: '로그인 화면 디자인', ...body });
const patchTask = (who, id, body) =>
  request(app).patch(`/api/v1/tasks/${id}`).set(as(who)).send(body);
const getTask = (who, id) => request(app).get(`/api/v1/tasks/${id}`).set(as(who));
const delTask = (who, id) => request(app).delete(`/api/v1/tasks/${id}`).set(as(who));
const list = (who, qs = '', project = pid) =>
  request(app).get(`/api/v1/projects/${project}/tasks${qs}`).set(as(who));

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['manager', '매니저'],
    ['manager2', '매니저2'],
    ['member', '멤버'],
    ['member2', '멤버2'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  for (const k of ['manager', 'manager2']) {
    store.users.find((u) => u.id === people[k].id).role = 'manager';
  }
  const created = await request(app)
    .post('/api/v1/projects')
    .set(as('manager'))
    .send({
      name: '웹사이트 리뉴얼',
      memberIds: [people.manager2.id, people.member.id, people.member2.id],
    });
  pid = created.body.id;
});

describe('POST /projects/:id/tasks', () => {
  it('멤버가 만들면 기본값이 채워지고 컬럼 맨 아래에 붙는다', async () => {
    const a = await createTask('member', {
      description: '피그마 시안 반영',
      dueDate: '2026-10-20',
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      projectId: pid,
      title: '로그인 화면 디자인',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: '2026-10-20',
      position: 1024,
      createdBy: people.member.id,
      completedAt: null,
    });
    const b = await createTask('manager', { title: '두 번째' });
    expect(b.body.position).toBe(2048);
    const other = await createTask('manager', { title: '다른 컬럼', status: 'review' });
    expect(other.body.position).toBe(1024);
  });

  it('비멤버는 403, Admin 은 멤버가 아니어도 가능, 인증 없으면 401', async () => {
    expect((await createTask('outsider')).status).toBe(403);
    expect((await createTask('admin')).status).toBe(201);
    const res = await request(app).post(`/api/v1/projects/${pid}/tasks`).send({ title: 'x' });
    expect(res.status).toBe(401);
  });

  it('status=done 으로 만들면 completedAt 이 채워진다', async () => {
    const res = await createTask('member', { status: 'done' });
    expect(res.body.completedAt).toBeTruthy();
  });

  it('담당자는 활성 프로젝트 멤버여야 한다', async () => {
    const ok = await createTask('manager', { assigneeId: people.member.id });
    expect(ok.status).toBe(201);
    expect(ok.body.assignee).toEqual({ id: people.member.id, name: '멤버' });

    const nonMember = await createTask('manager', { assigneeId: people.outsider.id });
    expect(nonMember.status).toBe(400);
    expect(nonMember.body.error.details[0].field).toBe('assigneeId');

    store.users.find((u) => u.id === people.member2.id).is_active = false;
    expect((await createTask('manager', { assigneeId: people.member2.id })).status).toBe(400);
    expect((await createTask('manager', { assigneeId: 'not-a-uuid' })).status).toBe(400);
    expect((await createTask('manager', { assigneeId: crypto.randomUUID() })).status).toBe(400);
  });

  it.each([
    ['빈 제목', { title: '   ' }],
    ['201자 제목', { title: 'a'.repeat(201) }],
    ['잘못된 우선순위', { priority: 'critical' }],
    ['잘못된 상태', { status: 'doing' }],
    ['형식이 틀린 마감일', { dueDate: '10/20/2026' }],
    ['존재하지 않는 날짜', { dueDate: '2026-13-40' }],
  ])('검증 실패 → 400 (%s)', async (_label, body) => {
    const res = await createTask('manager', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store.tasks).toHaveLength(0);
  });

  it('없는 프로젝트는 404, 잘못된 ID 는 400', async () => {
    expect((await createTask('admin', {}, crypto.randomUUID())).status).toBe(404);
    expect((await createTask('admin', {}, 'abc')).status).toBe(400);
  });
});

describe('GET /projects/:id/tasks', () => {
  beforeEach(async () => {
    await createTask('manager', {
      title: 'API 문서화',
      priority: 'high',
      assigneeId: people.member.id,
      dueDate: '2026-10-10',
    });
    await createTask('manager', {
      title: '로그인 구현',
      status: 'in_progress',
      priority: 'urgent',
    });
    await createTask('manager', {
      title: '배포 준비',
      status: 'done',
      assigneeId: people.manager2.id,
      description: '서버 100% 이전',
    });
  });

  it('멤버는 목록과 meta 를 받고 비멤버는 403', async () => {
    const res = await list('member');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 100, total: 3 });
    expect(res.body.data[0].title).toBe('배포 준비'); // 최신순
    expect((await list('outsider')).status).toBe(403);
  });

  it.each([
    ['status=todo', ['API 문서화']],
    ['status=done', ['배포 준비']],
    ['priority=urgent', ['로그인 구현']],
    ['q=로그인', ['로그인 구현']],
    ['q=API', ['API 문서화']],
    ['q=서버', ['배포 준비']],
    ['q=%25', ['배포 준비']], // % 는 와일드카드가 아니라 문자 그대로(설명의 "100%")
    ['assignee=unassigned', ['로그인 구현']],
    ['due_before=2026-10-10', ['API 문서화']],
    ['due_before=2026-10-09', []],
    ['status=todo&priority=urgent', []],
  ])('필터 %s', async (qs, titles) => {
    const res = await list('member', `?${qs}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.title).sort()).toEqual([...titles].sort());
    expect(res.body.meta.total).toBe(titles.length);
  });

  it('assignee=me / assignee=<uuid>', async () => {
    const me = await list('member', '?assignee=me');
    expect(me.body.data.map((t) => t.title)).toEqual(['API 문서화']);
    const byId = await list('member', `?assignee=${people.manager2.id}`);
    expect(byId.body.data.map((t) => t.title)).toEqual(['배포 준비']);
  });

  it('groupBy=status 는 네 컬럼을 position 순으로 준다', async () => {
    const res = await list('member', '?groupBy=status');
    expect(Object.keys(res.body.columns)).toEqual(['todo', 'in_progress', 'review', 'done']);
    expect(res.body.columns.todo.map((t) => t.title)).toEqual(['API 문서화']);
    expect(res.body.columns.review).toEqual([]);
    expect(res.body).not.toHaveProperty('data');
  });

  it('페이지네이션', async () => {
    const res = await list('member', '?limit=2&page=2');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3 });
  });

  it.each([
    'status=bogus',
    'priority=x',
    'due_before=tomorrow',
    'assignee=nobody',
    'limit=9999',
    'page=0',
  ])('잘못된 쿼리 %s → 400', async (qs) => {
    expect((await list('member', `?${qs}`)).status).toBe(400);
  });
});

describe('GET /tasks/:id', () => {
  it('멤버는 200, 비멤버는 403, 없는 작업은 404, 잘못된 ID 는 400', async () => {
    const { body } = await createTask('member');
    expect((await getTask('manager2', body.id)).status).toBe(200);
    expect((await getTask('outsider', body.id)).status).toBe(403);
    expect((await getTask('admin', body.id)).status).toBe(200);
    expect((await getTask('member', crypto.randomUUID())).status).toBe(404);
    expect((await getTask('member', 'abc')).status).toBe(400);
  });
});

describe('PATCH /tasks/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await createTask('manager', { assigneeId: people.member.id, dueDate: '2026-10-20' })).body
      .id;
  });

  it('어느 멤버든 필드를 수정할 수 있다 (생성자가 아니어도)', async () => {
    const res = await patchTask('member2', id, {
      title: '새 제목',
      description: '설명',
      priority: 'urgent',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: '새 제목', description: '설명', priority: 'urgent' });
  });

  it('비멤버는 403 이고 변경되지 않는다', async () => {
    expect((await patchTask('outsider', id, { title: 'x' })).status).toBe(403);
    expect(store.tasks[0].title).toBe('로그인 화면 디자인');
  });

  it('담당자와 마감일을 null 로 해제할 수 있다', async () => {
    const res = await patchTask('member', id, { assigneeId: null, dueDate: null });
    expect(res.body.assignee).toBeNull();
    expect(res.body.dueDate).toBeNull();
  });

  it('새 담당자는 프로젝트 멤버여야 하고, 기존 담당자는 비활성화돼도 다른 수정은 막히지 않는다', async () => {
    expect((await patchTask('manager', id, { assigneeId: people.outsider.id })).status).toBe(400);
    expect(
      (await patchTask('manager', id, { assigneeId: people.member2.id })).body.assignee.id,
    ).toBe(people.member2.id);

    store.users.find((u) => u.id === people.member2.id).is_active = false;
    const res = await patchTask('manager', id, { title: '담당자가 비활성이어도 수정 가능' });
    expect(res.status).toBe(200);
    expect(res.body.assignee.id).toBe(people.member2.id);
  });

  it('상태가 done 이 되면 completedAt 이 채워지고 되돌리면 비워지며, 컬럼 맨 아래로 간다', async () => {
    await createTask('manager', { title: 'done 컬럼 기존 작업', status: 'done' });
    const done = await patchTask('member', id, { status: 'done' });
    expect(done.body.status).toBe('done');
    expect(done.body.completedAt).toBeTruthy();
    expect(done.body.position).toBe(2048);

    const back = await patchTask('member', id, { status: 'todo' });
    expect(back.body.completedAt).toBeNull();
    expect(back.body.position).toBe(1024);
  });

  it('같은 상태로 보내면 위치가 바뀌지 않는다', async () => {
    const before = store.tasks[0].position;
    const res = await patchTask('member', id, { status: 'todo' });
    expect(res.body.position).toBe(before);
  });

  it('마감일을 바꾸면 임박 알림 표시가 초기화된다', async () => {
    store.tasks[0].due_notified_at = new Date();
    await patchTask('member', id, { dueDate: '2026-11-01' });
    expect(store.tasks[0].due_notified_at).toBeNull();

    store.tasks[0].due_notified_at = new Date();
    await patchTask('member', id, { title: '제목만 변경' });
    expect(store.tasks[0].due_notified_at).not.toBeNull();
  });

  it.each([
    ['빈 body', {}],
    ['빈 제목', { title: '' }],
    ['잘못된 상태', { status: 'x' }],
    ['잘못된 마감일', { dueDate: 'soon' }],
    ['잘못된 담당자 ID', { assigneeId: 'zzz' }],
  ])('검증 실패 → 400 (%s)', async (_label, body) => {
    expect((await patchTask('member', id, body)).status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  it('Member 는 본인이 만든 작업만 삭제할 수 있다', async () => {
    const mine = (await createTask('member')).body.id;
    const others = (await createTask('manager')).body.id;
    expect((await delTask('member', others)).status).toBe(403);
    expect(store.tasks).toHaveLength(2);
    expect((await delTask('member', mine)).status).toBe(204);
    expect(store.tasks).toHaveLength(1);
  });

  it('Manager(멤버)와 Admin 은 남이 만든 작업도 삭제할 수 있다', async () => {
    const a = (await createTask('member')).body.id;
    const b = (await createTask('member2')).body.id;
    expect((await delTask('manager2', a)).status).toBe(204);
    expect((await delTask('admin', b)).status).toBe(204);
    expect(store.tasks).toHaveLength(0);
  });

  it('비멤버는 Manager 여도 403', async () => {
    const id = (await createTask('member')).body.id;
    store.users.find((u) => u.id === people.outsider.id).role = 'manager';
    expect((await delTask('outsider', id)).status).toBe(403);
  });

  it('없는 작업은 404, 삭제 후 조회도 404', async () => {
    const id = (await createTask('member')).body.id;
    await delTask('member', id);
    expect((await getTask('member', id)).status).toBe(404);
    expect((await delTask('member', id)).status).toBe(404);
  });
});

describe('보관된 프로젝트', () => {
  let id;
  beforeEach(async () => {
    id = (await createTask('member')).body.id;
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
  });

  it('읽기만 가능하고 생성·수정·삭제는 409 PROJECT_ARCHIVED', async () => {
    expect((await list('member')).status).toBe(200);
    expect((await getTask('member', id)).status).toBe(200);

    for (const res of [
      await createTask('member'),
      await patchTask('member', id, { title: 'x' }),
      await delTask('member', id),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].title).toBe('로그인 화면 디자인');
  });

  it('보관을 해제하면 다시 수정할 수 있다', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'active' });
    expect((await patchTask('member', id, { title: '다시 수정' })).status).toBe(200);
  });
});

describe('GET /tasks/mine', () => {
  const mine = (who, qs = '') => request(app).get(`/api/v1/tasks/mine${qs}`).set(as(who));

  beforeEach(async () => {
    await createTask('manager', {
      title: 'A',
      assigneeId: people.member.id,
      dueDate: '2026-10-20',
    });
    await createTask('manager', { title: 'B', assigneeId: people.member.id, status: 'done' });
    await createTask('manager', { title: 'C', assigneeId: people.member2.id });
    await createTask('manager', { title: 'D' });
  });

  it('내게 배정된 작업만 프로젝트 이름과 함께, 완료 작업은 뒤로', async () => {
    const res = await mine('member');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.title)).toEqual(['A', 'B']);
    expect(res.body.data[0].projectName).toBe('웹사이트 리뉴얼');
    expect(res.body.meta.total).toBe(2);
  });

  it('필터와 빈 결과, 인증', async () => {
    expect((await mine('member', '?status=todo')).body.data.map((t) => t.title)).toEqual(['A']);
    expect((await mine('outsider')).body.data).toEqual([]);
    expect((await request(app).get('/api/v1/tasks/mine')).status).toBe(401);
    expect((await mine('member', '?status=nope')).status).toBe(400);
  });

  it('프로젝트에서 제거된 멤버에게는 해당 작업이 더 이상 보이지 않고 담당도 해제된다', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${pid}/members/${people.member.id}`)
      .set(as('manager'));
    expect(res.status).toBe(204);
    expect((await mine('member')).body.data).toEqual([]);
    expect(store.tasks.filter((t) => t.assignee_id === people.member.id)).toHaveLength(0);
    // 다른 사람의 담당 작업은 그대로
    expect(store.tasks.find((t) => t.title === 'C').assignee_id).toBe(people.member2.id);
  });
});

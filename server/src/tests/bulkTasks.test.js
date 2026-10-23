import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset, store } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';

vi.mock('../config/db.js', () => ({
  query: vi.fn(),
  pool: {},
  withTransaction: (fn) => fn({}),
}));
const mem = () => import('./helpers/memoryRepos.js');
vi.mock('../modules/users/repository.js', async () => ({
  ...(await vi.importActual('../modules/users/repository.js')),
  ...(await mem()).usersRepo,
}));
vi.mock('../modules/auth/repository.js', async () => (await mem()).authRepo);
vi.mock('../modules/apiTokens/repository.js', async () => (await mem()).apiTokensRepo);
vi.mock('../modules/projects/repository.js', async () => ({
  ...(await vi.importActual('../modules/projects/repository.js')),
  ...(await mem()).projectsRepo,
}));
vi.mock('../modules/tasks/repository.js', async () => ({
  ...(await vi.importActual('../modules/tasks/repository.js')),
  ...(await mem()).tasksRepo,
}));
vi.mock('../modules/comments/repository.js', async () => ({
  ...(await vi.importActual('../modules/comments/repository.js')),
  ...(await mem()).commentsRepo,
}));
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await mem()).notificationsRepo,
}));
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await mem()).activityRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자), owner(소유자), alice(멤버), bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body === undefined ? req : req.send(body);
};
const mk = async (title, who = 'owner', extra = {}) =>
  (await api('post', `/projects/${pid}/tasks`, who, { title, ...extra })).body;
const bulk = (who, taskIds, patch) =>
  api('patch', `/projects/${pid}/tasks/bulk`, who, { taskIds, patch });
const bulkDelete = (who, taskIds) =>
  api('post', `/projects/${pid}/tasks/bulk-delete`, who, { taskIds });
const row = (id) => store.tasks.find((t) => t.id === id);
const events = (name) => emitToProject.mock.calls.filter((c) => c[2] === name);

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['bob', '밥'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '일괄',
      key: 'BLK',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
});

describe('PATCH /projects/:id/tasks/bulk', () => {
  it('선택한 작업의 상태·우선순위·담당자·마감일을 한꺼번에 바꾼다', async () => {
    const tasks = [await mk('하나'), await mk('둘'), await mk('셋')];
    const untouched = await mk('선택 안 함');
    const res = await bulk(
      'alice',
      tasks.map((t) => t.id),
      { status: 'done', priority: 'urgent', assigneeId: people.bob.id, dueDate: '2030-05-01' },
    );
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
    expect(res.body.tasks.map((t) => t.key)).toEqual(['BLK-1', 'BLK-2', 'BLK-3']);
    for (const t of tasks) {
      expect(row(t.id)).toMatchObject({
        status: 'done',
        priority: 'urgent',
        assignee_id: people.bob.id,
        due_date: '2030-05-01',
      });
      expect(row(t.id).completed_at).toBeTruthy();
    }
    expect(row(untouched.id)).toMatchObject({ status: 'todo', priority: 'medium' });
  });

  it('작업마다 실시간 이벤트·활동 기록·배정 알림이 개별 수정과 똑같이 남는다', async () => {
    const tasks = [await mk('하나'), await mk('둘')];
    vi.clearAllMocks();
    store.activities.length = 0;
    store.notifications.length = 0;
    await bulk(
      'owner',
      tasks.map((t) => t.id),
      { assigneeId: people.alice.id, priority: 'high' },
    );
    expect(events('task:updated')).toHaveLength(2);
    const acts = store.activities.filter((a) => a.action === 'task.updated');
    expect(acts).toHaveLength(2);
    expect(acts[0].meta.changes).toMatchObject({ priority: { from: 'medium', to: 'high' } });
    expect(store.notifications.filter((n) => n.user_id === people.alice.id)).toHaveLength(2);
  });

  it('담당자 해제(null)와 마감일 해제(null)', async () => {
    const t = await mk('작업', 'owner', { assigneeId: people.alice.id, dueDate: '2030-01-01' });
    const res = await bulk('owner', [t.id], { assigneeId: null, dueDate: null });
    expect(res.status).toBe(200);
    expect(row(t.id)).toMatchObject({ assignee_id: null, due_date: null });
  });

  it('같은 id 를 여러 번 보내도 한 번만 처리한다', async () => {
    const t = await mk('작업');
    const res = await bulk('owner', [t.id, t.id, t.id], { priority: 'low' });
    expect(res.body.updated).toBe(1);
    expect(events('task:updated')).toHaveLength(1);
  });

  it('하나라도 문제가 있으면 아무것도 바꾸지 않는다(검증 먼저)', async () => {
    const a = await mk('내 프로젝트 작업');
    const other = (await api('post', '/projects', 'owner', { name: '다른', key: 'OTH' })).body.id;
    const foreign = (
      await api('post', `/projects/${other}/tasks`, 'owner', { title: '다른 프로젝트 작업' })
    ).body;

    const mixed = await bulk('owner', [a.id, foreign.id], { priority: 'urgent' });
    expect(mixed.status).toBe(404);
    expect(row(a.id).priority).toBe('medium');

    const missing = await bulk('owner', [a.id, crypto.randomUUID()], { priority: 'urgent' });
    expect(missing.status).toBe(404);
    expect(row(a.id).priority).toBe('medium');

    const badAssignee = await bulk('owner', [a.id], {
      priority: 'urgent',
      assigneeId: people.outsider.id,
    });
    expect(badAssignee.status).toBe(400);
    expect(row(a.id).priority).toBe('medium');

    const early = await mk('시작일 있는 작업', 'owner', { startDate: '2030-06-10' });
    const range = await bulk('owner', [a.id, early.id], { dueDate: '2030-06-01' });
    expect(range.status).toBe(400);
    expect(row(a.id).due_date).toBeNull();
    expect(events('task:updated')).toHaveLength(0);
  });

  it('입력 검증: 빈 patch·빈 목록·51개·잘못된 id·잘못된 값은 400', async () => {
    const t = await mk('작업');
    expect((await bulk('owner', [t.id], {})).status).toBe(400);
    expect((await bulk('owner', [], { priority: 'low' })).status).toBe(400);
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect((await bulk('owner', many, { priority: 'low' })).status).toBe(400);
    expect((await bulk('owner', ['nope'], { priority: 'low' })).status).toBe(400);
    expect((await bulk('owner', [t.id], { status: 'later' })).status).toBe(400);
    expect((await bulk('owner', [t.id], { unknown: 1 })).status).toBe(400);
  });

  it('로그인·멤버 권한: 비로그인 401, 비멤버 403, Admin 은 가능', async () => {
    const t = await mk('작업');
    const anon = await request(app)
      .patch(`/api/v1/projects/${pid}/tasks/bulk`)
      .send({ taskIds: [t.id], patch: { priority: 'low' } });
    expect(anon.status).toBe(401);
    expect((await bulk('outsider', [t.id], { priority: 'low' })).status).toBe(403);
    expect(row(t.id).priority).toBe('medium');
    expect((await bulk('admin', [t.id], { priority: 'low' })).status).toBe(200);
  });

  it('보관된 프로젝트는 409', async () => {
    const t = await mk('작업');
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    const res = await bulk('owner', [t.id], { priority: 'low' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('POST /projects/:id/tasks/bulk-delete', () => {
  it('소유자는 선택한 작업을 모두 지우고 이벤트·활동 기록이 남는다', async () => {
    const tasks = [await mk('하나'), await mk('둘'), await mk('셋')];
    const keep = await mk('남길 작업');
    vi.clearAllMocks();
    const res = await bulkDelete(
      'owner',
      tasks.map((t) => t.id),
    );
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(store.tasks.map((t) => t.id)).toEqual([keep.id]);
    expect(events('task:deleted')).toHaveLength(3);
    expect(store.activities.filter((a) => a.action === 'task.deleted')).toHaveLength(3);
  });

  it('일반 멤버는 본인이 만든 작업만: 남의 작업이 섞이면 403 이고 아무것도 지우지 않는다', async () => {
    const mine = await mk('내 작업', 'alice');
    const theirs = await mk('소유자 작업', 'owner');
    const denied = await bulkDelete('alice', [mine.id, theirs.id]);
    expect(denied.status).toBe(403);
    expect(store.tasks).toHaveLength(2);

    const ok = await bulkDelete('alice', [mine.id]);
    expect(ok.status).toBe(200);
    expect(store.tasks.map((t) => t.id)).toEqual([theirs.id]);
  });

  it('다른 프로젝트 작업 404, 비멤버 403, 보관 409, 51개 400', async () => {
    const t = await mk('작업');
    const other = (await api('post', '/projects', 'owner', { name: '다른', key: 'OTH' })).body.id;
    const foreign = (await api('post', `/projects/${other}/tasks`, 'owner', { title: 'x' })).body;
    expect((await bulkDelete('owner', [t.id, foreign.id])).status).toBe(404);
    expect(store.tasks).toHaveLength(2);
    expect((await bulkDelete('outsider', [t.id])).status).toBe(403);
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect((await bulkDelete('owner', many)).status).toBe(400);
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await bulkDelete('owner', [t.id])).status).toBe(409);
  });
});

describe('API 토큰', () => {
  const token = async (scope) =>
    (
      await request(app)
        .post('/api/v1/users/me/api-tokens')
        .set(as('owner'))
        .send({ name: `bulk-${scope}`, scope })
    ).body.token;

  it('쓰기 토큰은 일괄 수정·삭제를 할 수 있고 읽기 토큰은 403', async () => {
    const t = await mk('작업');
    const write = await token('write');
    const read = await token('read');
    const patchBody = { taskIds: [t.id], patch: { priority: 'high' } };
    const denied = await request(app)
      .patch(`/api/v1/projects/${pid}/tasks/bulk`)
      .set(bearer(read))
      .send(patchBody);
    expect(denied.status).toBe(403);
    expect(row(t.id).priority).toBe('medium');

    const ok = await request(app)
      .patch(`/api/v1/projects/${pid}/tasks/bulk`)
      .set(bearer(write))
      .send(patchBody);
    expect(ok.status).toBe(200);
    expect(row(t.id).priority).toBe('high');

    const del = await request(app)
      .post(`/api/v1/projects/${pid}/tasks/bulk-delete`)
      .set(bearer(write))
      .send({ taskIds: [t.id] });
    expect(del.status).toBe(200);
    expect(store.tasks).toHaveLength(0);
  });
});

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
const { env } = await import('../config/env.js');

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
const importRows = (who, rows) => api('post', `/projects/${pid}/tasks/import`, who, { rows });
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

const count = () => store.tasks.filter((t) => t.project_id === pid).length;

describe('POST /projects/:id/tasks/import', () => {
  it('행마다 작업을 만들고 기본값을 채우며 키를 순서대로 매긴다', async () => {
    const res = await importRows('alice', [
      { title: '첫 작업' },
      {
        title: '둘째',
        description: '설명',
        status: 'in_progress',
        priority: 'high',
        assigneeId: people.bob.id,
        startDate: '2030-05-01',
        dueDate: '2030-05-09',
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    expect(res.body.tasks.map((t) => t.key)).toEqual(['BLK-1', 'BLK-2']);
    expect(row(res.body.tasks[0].id)).toMatchObject({ status: 'todo', priority: 'medium' });
    expect(row(res.body.tasks[1].id)).toMatchObject({
      title: '둘째',
      description: '설명',
      status: 'in_progress',
      priority: 'high',
      assignee_id: people.bob.id,
      start_date: '2030-05-01',
      due_date: '2030-05-09',
      created_by: people.alice.id,
    });
    expect(events('task:created')).toHaveLength(2);
  });

  it('문제 있는 행이 하나라도 있으면 행 번호와 함께 400 이고 아무것도 만들지 않는다', async () => {
    const res = await importRows('alice', [
      { title: '정상' },
      { title: '담당자 외부인', assigneeId: people.outsider.id },
      { title: '날짜 거꾸로', startDate: '2030-06-02', dueDate: '2030-06-01' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { row: 2, field: 'assigneeId', issue: 'not_a_project_member' },
      { row: 3, field: 'startDate', issue: 'after_due_date' },
    ]);
    expect(count()).toBe(0);
    expect(events('task:created')).toHaveLength(0);
  });

  it('형식이 틀린 행(제목 없음·알 수 없는 상태·모르는 키)은 400', async () => {
    for (const bad of [{ title: ' ' }, { title: 'x', status: 'nope' }, { title: 'x', extra: 1 }]) {
      expect((await importRows('alice', [bad])).status).toBe(400);
    }
    expect(count()).toBe(0);
  });

  it('0행·201행은 400', async () => {
    expect((await importRows('alice', [])).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ title: `t${i}` }));
    expect((await importRows('alice', many)).status).toBe(400);
    expect(count()).toBe(0);
  });

  it('비멤버는 403', async () => {
    expect((await importRows('outsider', [{ title: 'x' }])).status).toBe(403);
    expect(count()).toBe(0);
  });

  it('보관된 프로젝트는 409', async () => {
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    const res = await importRows('alice', [{ title: 'x' }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });

  it('작업 상한을 넘기면 409 이고 아무것도 만들지 않는다', async () => {
    const original = env.MAX_TASKS_PER_PROJECT;
    env.MAX_TASKS_PER_PROJECT = 3;
    try {
      await mk('이미 있음');
      const res = await importRows('alice', [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LIMIT_REACHED');
      expect(count()).toBe(1);
      expect((await importRows('alice', [{ title: 'a' }, { title: 'b' }])).status).toBe(201);
    } finally {
      env.MAX_TASKS_PER_PROJECT = original;
    }
  });
});

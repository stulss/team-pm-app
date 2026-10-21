import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset } from './helpers/memoryRepos.js';
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
vi.mock('../modules/comments/repository.js', async () => ({
  ...(await vi.importActual('../modules/comments/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).commentsRepo,
}));
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).activityRepo,
}));
// 상한을 작게 시험하려고 줄인다.
vi.mock('../modules/labels/repository.js', async () => ({
  ...(await vi.importActual('../modules/labels/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).labelsRepo,
  MAX_LABELS_PER_PROJECT: 3,
  MAX_LABELS_PER_TASK: 2,
}));
vi.mock('../modules/checklist/repository.js', async () => {
  const mem = (await import('./helpers/memoryRepos.js')).checklistRepo;
  mem.MAX_ITEMS_PER_TASK = 3;
  return { ...(await vi.importActual('../modules/checklist/repository.js')), ...mem };
});
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice·bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let tid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const mkLabel = (who, name = '버그', color = 'red', id = pid) =>
  api('post', `/projects/${id}/labels`, who, { name, color });
const mkItem = (who, content = '시안 확인', id = tid) =>
  api('post', `/tasks/${id}/checklist`, who, { content });
const getTask = async (who = 'owner', id = tid) => (await api('get', `/tasks/${id}`, who)).body;

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
      name: '라벨 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
  tid = (await api('post', `/projects/${pid}/tasks`, 'owner', { title: '첫 작업' })).body.id;
});

describe('라벨: 접근과 만들기', () => {
  it('멤버는 만들고 읽을 수 있고, 비멤버는 403, 인증 없으면 401', async () => {
    const created = await mkLabel('alice', '버그', 'red');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: '버그', color: 'red' });
    expect((await api('get', `/projects/${pid}/labels`, 'bob')).body.data).toHaveLength(1);
    expect((await api('get', `/projects/${pid}/labels`, 'admin')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/labels`, 'outsider')).status).toBe(403);
    expect((await mkLabel('outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/labels`)).status).toBe(401);
  });

  it('입력 검증: 빈 이름·31자·허용되지 않는 색은 400', async () => {
    expect((await mkLabel('alice', '   ')).status).toBe(400);
    expect((await mkLabel('alice', 'a'.repeat(31))).status).toBe(400);
    expect((await mkLabel('alice', '버그', 'magenta')).status).toBe(400);
    expect((await mkLabel('alice', 'a'.repeat(30))).status).toBe(201);
  });

  it('같은 이름은 대소문자를 무시하고 409 LABEL_EXISTS, 다른 프로젝트에서는 허용', async () => {
    await mkLabel('alice', 'Bug');
    const dup = await mkLabel('bob', 'bug');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('LABEL_EXISTS');
    const other = (await api('post', '/projects', 'owner', { name: '다른 프로젝트' })).body.id;
    expect((await mkLabel('owner', 'bug', 'blue', other)).status).toBe(201);
  });

  it('프로젝트당 상한을 넘으면 409 LIMIT_REACHED', async () => {
    for (const n of ['a', 'b', 'c']) expect((await mkLabel('alice', n)).status).toBe(201);
    const over = await mkLabel('alice', 'd');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });
});

describe('라벨: 이름·색 변경과 삭제', () => {
  it('만든 사람·소유자·Admin 은 바꿀 수 있고, 다른 멤버는 403', async () => {
    const label = (await mkLabel('alice', '버그')).body;
    const url = `/projects/${pid}/labels/${label.id}`;
    expect((await api('patch', url, 'bob', { color: 'blue' })).status).toBe(403);
    expect((await api('patch', url, 'alice', { name: '결함' })).body.name).toBe('결함');
    expect((await api('patch', url, 'owner', { color: 'green' })).body.color).toBe('green');
    expect((await api('patch', url, 'admin', { color: 'gray' })).status).toBe(200);
    expect((await api('patch', url, 'alice', {})).status).toBe(400);
    expect((await api('delete', url, 'bob')).status).toBe(403);
  });

  it('다른 라벨과 겹치는 이름으로는 바꿀 수 없다(409), 자기 이름 그대로는 허용', async () => {
    const a = (await mkLabel('alice', 'A')).body;
    await mkLabel('alice', 'B');
    const url = `/projects/${pid}/labels/${a.id}`;
    expect((await api('patch', url, 'alice', { name: 'b' })).status).toBe(409);
    expect((await api('patch', url, 'alice', { name: 'a' })).status).toBe(200);
  });

  it('삭제하면 작업에서도 떨어지고, 다른 프로젝트의 라벨은 404', async () => {
    const label = (await mkLabel('alice')).body;
    await api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: [label.id] });
    expect((await getTask()).labels).toHaveLength(1);
    const other = (await api('post', '/projects', 'owner', { name: '다른 프로젝트' })).body.id;
    expect((await api('delete', `/projects/${other}/labels/${label.id}`, 'owner')).status).toBe(
      404,
    );
    expect((await api('delete', `/projects/${pid}/labels/${label.id}`, 'alice')).status).toBe(204);
    expect((await getTask()).labels).toEqual([]);
  });
});

describe('작업에 라벨 붙이기', () => {
  it('교체 방식으로 정해지고 작업 응답에 이름순으로 실린다', async () => {
    const b = (await mkLabel('alice', 'B', 'blue')).body;
    const a = (await mkLabel('alice', 'A', 'red')).body;
    const res = await api('put', `/tasks/${tid}/labels`, 'bob', { labelIds: [b.id, a.id] });
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual([
      { id: a.id, name: 'A', color: 'red' },
      { id: b.id, name: 'B', color: 'blue' },
    ]);
    const replaced = await api('put', `/tasks/${tid}/labels`, 'bob', { labelIds: [b.id, b.id] });
    expect(replaced.body.labels.map((l) => l.name)).toEqual(['B']);
    expect((await api('put', `/tasks/${tid}/labels`, 'bob', { labelIds: [] })).body.labels).toEqual(
      [],
    );
  });

  it('다른 프로젝트의 라벨은 400, 작업당 상한은 409, 비멤버는 403', async () => {
    const other = (await api('post', '/projects', 'owner', { name: '다른 프로젝트' })).body.id;
    const foreign = (await mkLabel('owner', '외부', 'gray', other)).body;
    const res = await api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: [foreign.id] });
    expect(res.status).toBe(400);
    expect((await getTask()).labels).toEqual([]);

    const ids = [];
    for (const n of ['a', 'b', 'c']) ids.push((await mkLabel('alice', n)).body.id);
    const over = await api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: ids });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
    expect((await api('put', `/tasks/${tid}/labels`, 'outsider', { labelIds: [] })).status).toBe(
      403,
    );
    expect((await api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: ['x'] })).status).toBe(
      400,
    );
  });

  it('목록을 ?label= 로 거를 수 있다', async () => {
    const label = (await mkLabel('alice')).body;
    const second = (await api('post', `/projects/${pid}/tasks`, 'owner', { title: '둘째' })).body;
    await api('put', `/tasks/${second.id}/labels`, 'alice', { labelIds: [label.id] });
    const res = await api('get', `/projects/${pid}/tasks?label=${label.id}`, 'owner');
    expect(res.body.data.map((t) => t.title)).toEqual(['둘째']);
    expect((await api('get', `/projects/${pid}/tasks?label=nope`, 'owner')).status).toBe(400);
  });

  it('라벨 변경은 task:updated, 라벨 생성·삭제는 label:changed 를 보낸다', async () => {
    const label = (await mkLabel('alice')).body;
    await api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: [label.id] });
    await api('delete', `/projects/${pid}/labels/${label.id}`, 'alice');
    const events = emitToProject.mock.calls.map((c) => c[2]);
    expect(events).toEqual(expect.arrayContaining(['label:changed', 'task:updated']));
    expect(events.filter((e) => e === 'label:changed')).toHaveLength(2);
  });
});

describe('체크리스트', () => {
  it('항목을 추가·수정·삭제하고, 작업 응답에 진행률이 실린다', async () => {
    const first = await mkItem('alice', '시안 확인');
    expect(first.status).toBe(201);
    expect(first.body.item).toMatchObject({ content: '시안 확인', isDone: false });
    expect(first.body.task.checklist).toEqual({ done: 0, total: 1 });
    const second = (await mkItem('bob', '배포')).body.item;

    const toggled = await api('patch', `/tasks/${tid}/checklist/${second.id}`, 'alice', {
      isDone: true,
    });
    expect(toggled.body.item.isDone).toBe(true);
    expect(toggled.body.task.checklist).toEqual({ done: 1, total: 2 });

    const renamed = await api('patch', `/tasks/${tid}/checklist/${second.id}`, 'bob', {
      content: '운영 배포',
    });
    expect(renamed.body.item.content).toBe('운영 배포');

    const list = (await api('get', `/tasks/${tid}/checklist`, 'alice')).body.data;
    expect(list.map((i) => i.content)).toEqual(['시안 확인', '운영 배포']);

    const removed = await api('delete', `/tasks/${tid}/checklist/${second.id}`, 'alice');
    expect(removed.status).toBe(200);
    expect(removed.body.task.checklist).toEqual({ done: 0, total: 1 });
    expect((await getTask()).checklist).toEqual({ done: 0, total: 1 });
  });

  it('입력 검증, 상한(409), 비멤버 403, 없는 항목 404', async () => {
    expect((await mkItem('alice', '   ')).status).toBe(400);
    expect((await mkItem('alice', 'a'.repeat(201))).status).toBe(400);
    for (const n of ['1', '2', '3']) expect((await mkItem('alice', n)).status).toBe(201);
    const over = await mkItem('alice', '4');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');

    expect((await mkItem('outsider')).status).toBe(403);
    expect((await api('get', `/tasks/${tid}/checklist`, 'outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/tasks/${tid}/checklist`)).status).toBe(401);

    const missing = '00000000-0000-4000-8000-000000000000';
    expect(
      (await api('patch', `/tasks/${tid}/checklist/${missing}`, 'alice', { isDone: true })).status,
    ).toBe(404);
    const [item] = (await api('get', `/tasks/${tid}/checklist`, 'alice')).body.data;
    expect((await api('patch', `/tasks/${tid}/checklist/${item.id}`, 'alice', {})).status).toBe(
      400,
    );
  });

  it('다른 작업의 항목 ID 로는 고칠 수 없다(404)', async () => {
    const other = (await api('post', `/projects/${pid}/tasks`, 'owner', { title: '둘째' })).body;
    const item = (await mkItem('alice')).body.item;
    const res = await api('patch', `/tasks/${other.id}/checklist/${item.id}`, 'alice', {
      isDone: true,
    });
    expect(res.status).toBe(404);
    expect((await getTask('owner', tid)).checklist).toEqual({ done: 0, total: 1 });
  });

  it('변경은 task:updated 로 퍼진다', async () => {
    const { item } = (await mkItem('alice')).body;
    await api('patch', `/tasks/${tid}/checklist/${item.id}`, 'alice', { isDone: true });
    const updates = emitToProject.mock.calls.filter((c) => c[2] === 'task:updated');
    expect(updates).toHaveLength(2);
    expect(updates[1][3].task.checklist).toEqual({ done: 1, total: 1 });
  });

  it('작업을 지우면 항목도 사라진다', async () => {
    await mkItem('alice');
    expect((await api('delete', `/tasks/${tid}`, 'owner')).status).toBe(204);
    expect((await api('get', `/tasks/${tid}/checklist`, 'owner')).status).toBe(404);
  });
});

describe('보관된 프로젝트는 읽기 전용', () => {
  it('라벨·체크리스트 변경은 409, 읽기는 가능', async () => {
    const label = (await mkLabel('alice')).body;
    const { item } = (await mkItem('alice')).body;
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });

    const blocked = [
      mkLabel('alice', '새 라벨'),
      api('patch', `/projects/${pid}/labels/${label.id}`, 'alice', { color: 'blue' }),
      api('delete', `/projects/${pid}/labels/${label.id}`, 'alice'),
      api('put', `/tasks/${tid}/labels`, 'alice', { labelIds: [] }),
      mkItem('alice', '새 항목'),
      api('patch', `/tasks/${tid}/checklist/${item.id}`, 'alice', { isDone: true }),
      api('delete', `/tasks/${tid}/checklist/${item.id}`, 'alice'),
    ];
    for (const res of await Promise.all(blocked)) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect((await api('get', `/projects/${pid}/labels`, 'bob')).body.data).toHaveLength(1);
    expect((await api('get', `/tasks/${tid}/checklist`, 'bob')).body.data).toHaveLength(1);
  });
});

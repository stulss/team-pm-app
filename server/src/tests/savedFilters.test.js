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
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).activityRepo,
}));
// 상한을 작게 시험하려고 3개로 줄인다.
vi.mock('../modules/savedFilters/repository.js', async () => {
  const mem = (await import('./helpers/memoryRepos.js')).savedFiltersRepo;
  mem.MAX_FILTERS_PER_USER = 3;
  return { ...(await vi.importActual('../modules/savedFilters/repository.js')), ...mem };
});
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice·bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const save = (who, name = '내 할 일', filters = { assignee: 'me', status: 'todo' }, id = pid) =>
  api('post', `/projects/${id}/saved-filters`, who, { name, filters });

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
      name: '필터 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
});

describe('저장된 필터', () => {
  it('멤버는 저장하고 읽을 수 있고, 비멤버는 403, 인증 없으면 401', async () => {
    const created = await save('alice');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: '내 할 일',
      filters: { assignee: 'me', status: 'todo' },
    });
    expect(created.body.id).toBeTruthy();
    expect((await api('get', `/projects/${pid}/saved-filters`, 'alice')).body.data).toHaveLength(1);
    expect((await save('outsider')).status).toBe(403);
    expect((await api('get', `/projects/${pid}/saved-filters`, 'outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/saved-filters`)).status).toBe(401);
  });

  it('개인용: 다른 멤버·소유자·Admin 도 남의 필터를 볼 수 없다', async () => {
    await save('alice');
    for (const who of ['bob', 'owner', 'admin']) {
      expect((await api('get', `/projects/${pid}/saved-filters`, who)).body.data).toEqual([]);
    }
  });

  it('남의 필터를 지우려 하면 404, 내 것은 204', async () => {
    const { id } = (await save('alice')).body;
    const url = `/projects/${pid}/saved-filters/${id}`;
    expect((await api('delete', url, 'bob')).status).toBe(404);
    expect((await api('delete', url, 'owner')).status).toBe(404);
    expect((await api('get', `/projects/${pid}/saved-filters`, 'alice')).body.data).toHaveLength(1);
    expect((await api('delete', url, 'alice')).status).toBe(204);
    expect((await api('delete', url, 'alice')).status).toBe(404);
  });

  it('입력 검증: 이름 길이, 허용되지 않는 키·값은 400', async () => {
    expect((await save('alice', '   ')).status).toBe(400);
    expect((await save('alice', 'a'.repeat(41))).status).toBe(400);
    expect((await save('alice', 'a'.repeat(40))).status).toBe(201);
    const bad = [
      { status: 'nope' },
      { priority: 'huge' },
      { assignee: 'someone' },
      { label: 'x' },
      { q: '' },
      { q: 'a'.repeat(101) },
      { admin: true },
      { __proto__: { x: 1 }, unknown: 1 },
    ];
    for (const [i, filters] of bad.entries()) {
      expect((await save('alice', `bad-${i}`, filters)).status, JSON.stringify(filters)).toBe(400);
    }
    expect((await save('alice', 'x', 'status=todo')).status).toBe(400);
    expect((await save('alice', '빈 필터', {})).status).toBe(201);
  });

  it('같은 이름은 대소문자 무시 409 FILTER_EXISTS, 다른 사람은 같은 이름 가능', async () => {
    await save('alice', 'Mine');
    const dup = await save('alice', 'mine');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('FILTER_EXISTS');
    expect((await save('bob', 'mine')).status).toBe(201);
  });

  it('사용자당 상한을 넘으면 409 LIMIT_REACHED, 다른 사용자는 영향 없음', async () => {
    for (const n of ['a', 'b', 'c']) expect((await save('alice', n)).status).toBe(201);
    const over = await save('alice', 'd');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
    expect((await save('bob', 'd')).status).toBe(201);
  });

  it('이름순으로 돌려주고, 보관된 프로젝트에서도 저장·삭제할 수 있다', async () => {
    await save('alice', 'b');
    const a = (await save('alice', 'A')).body;
    const list = (await api('get', `/projects/${pid}/saved-filters`, 'alice')).body.data;
    expect(list.map((f) => f.name)).toEqual(['A', 'b']);
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await save('alice', 'archived')).status).toBe(201);
    expect((await api('delete', `/projects/${pid}/saved-filters/${a.id}`, 'alice')).status).toBe(
      204,
    );
  });
});

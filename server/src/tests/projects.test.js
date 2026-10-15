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

vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));

const { app } = await import('../app.js');

// 사용자 5명: admin(첫 가입), manager(소유자), manager2(다른 매니저), member(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
const setRole = (who, role) => {
  store.users.find((u) => u.id === people[who].id).role = role;
};

async function createProject(who = 'manager', body = {}) {
  return request(app)
    .post('/api/v1/projects')
    .set(as(who))
    .send({ name: '웹사이트 리뉴얼', ...body });
}

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['manager', '매니저'],
    ['manager2', '매니저2'],
    ['member', '멤버'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  setRole('manager', 'manager');
  setRole('manager2', 'manager');
});

describe('POST /projects', () => {
  it('Admin 과 Manager 는 만들 수 있고 생성자는 소유자이자 멤버가 된다', async () => {
    const res = await createProject('manager', { memberIds: [people.member.id] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: '웹사이트 리뉴얼',
      ownerId: people.manager.id,
      status: 'active',
    });
    expect(res.body.members.map((m) => m.id).sort()).toEqual(
      [people.manager.id, people.member.id].sort(),
    );
    expect(res.body.members.find((m) => m.id === people.manager.id).isOwner).toBe(true);

    expect((await createProject('admin')).status).toBe(201);
  });

  it('Member 는 403', async () => {
    const res = await createProject('member');
    expect(res.status).toBe(403);
    expect(store.projects).toHaveLength(0);
  });

  it('인증 없이는 401', async () => {
    const res = await request(app).post('/api/v1/projects').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it('이름이 비었거나 memberIds 가 잘못되면 400', async () => {
    expect((await createProject('manager', { name: '  ' })).status).toBe(400);
    expect((await createProject('manager', { memberIds: ['nope'] })).status).toBe(400);
  });

  it('존재하지 않거나 비활성인 사용자를 멤버로 넣으면 400 이고 아무것도 만들어지지 않는다', async () => {
    const ghost = await createProject('manager', { memberIds: [crypto.randomUUID()] });
    expect(ghost.status).toBe(400);

    store.users.find((u) => u.id === people.member.id).is_active = false;
    const inactive = await createProject('manager', { memberIds: [people.member.id] });
    expect(inactive.status).toBe(400);
    expect(store.projects).toHaveLength(0);
  });

  it('memberIds 에 생성자가 있어도 중복 없이 한 번만 들어간다', async () => {
    const res = await createProject('manager', { memberIds: [people.manager.id] });
    expect(res.body.members).toHaveLength(1);
  });
});

describe('GET /projects', () => {
  beforeEach(async () => {
    await createProject('manager', { name: 'A', memberIds: [people.member.id] });
    await createProject('manager2', { name: 'B' });
  });

  it('Member 는 속한 프로젝트만 본다', async () => {
    const res = await request(app).get('/api/v1/projects').set(as('member'));
    expect(res.body.data.map((p) => p.name)).toEqual(['A']);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ memberCount: 2, ownerName: '매니저' });
  });

  it('비멤버는 빈 목록', async () => {
    const res = await request(app).get('/api/v1/projects').set(as('outsider'));
    expect(res.body.data).toEqual([]);
  });

  it('Admin 은 전체를 본다', async () => {
    const res = await request(app).get('/api/v1/projects').set(as('admin'));
    expect(res.body.data.map((p) => p.name).sort()).toEqual(['A', 'B']);
  });

  it('status 필터', async () => {
    const id = store.projects.find((p) => p.name === 'A').id;
    await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    const active = await request(app).get('/api/v1/projects?status=active').set(as('admin'));
    const archived = await request(app).get('/api/v1/projects?status=archived').set(as('admin'));
    expect(active.body.data.map((p) => p.name)).toEqual(['B']);
    expect(archived.body.data.map((p) => p.name)).toEqual(['A']);
  });
});

describe('GET /projects/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await createProject('manager', { memberIds: [people.member.id] })).body.id;
  });

  it('멤버와 Admin 은 볼 수 있다', async () => {
    for (const who of ['manager', 'member', 'admin']) {
      const res = await request(app).get(`/api/v1/projects/${id}`).set(as(who));
      expect(res.status, who).toBe(200);
      expect(res.body.members).toHaveLength(2);
    }
  });

  it('비멤버는 403', async () => {
    const res = await request(app).get(`/api/v1/projects/${id}`).set(as('outsider'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('다른 Manager 라도 멤버가 아니면 403', async () => {
    expect((await request(app).get(`/api/v1/projects/${id}`).set(as('manager2'))).status).toBe(403);
  });

  it('없는 프로젝트는 404, 잘못된 ID 는 400', async () => {
    expect(
      (await request(app).get(`/api/v1/projects/${crypto.randomUUID()}`).set(as('admin'))).status,
    ).toBe(404);
    expect((await request(app).get('/api/v1/projects/abc').set(as('admin'))).status).toBe(400);
  });
});

describe('PATCH /projects/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await createProject('manager', { memberIds: [people.member.id, people.manager2.id] }))
      .body.id;
  });
  const patch = (who, body) => request(app).patch(`/api/v1/projects/${id}`).set(as(who)).send(body);

  it('소유 Manager 와 Admin 은 수정/아카이브할 수 있다', async () => {
    const renamed = await patch('manager', { name: '새 이름' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('새 이름');

    const archived = await patch('admin', { status: 'archived' });
    expect(archived.body.status).toBe('archived');
  });

  it('멤버인 Member 와 멤버인 다른 Manager 는 403', async () => {
    expect((await patch('member', { name: 'x' })).status).toBe(403);
    expect((await patch('manager2', { name: 'x' })).status).toBe(403);
    expect(store.projects[0].name).toBe('웹사이트 리뉴얼');
  });

  it('소유자가 Manager 에서 Member 로 강등되면 관리 권한을 잃는다', async () => {
    setRole('manager', 'member');
    expect((await patch('manager', { name: 'x' })).status).toBe(403);
  });

  it('빈 변경/잘못된 status 는 400', async () => {
    expect((await patch('manager', {})).status).toBe(400);
    expect((await patch('manager', { status: 'deleted' })).status).toBe(400);
  });
});

describe('DELETE /projects/:id', () => {
  let id;
  beforeEach(async () => {
    id = (await createProject('manager', { memberIds: [people.member.id] })).body.id;
  });
  const del = (who) => request(app).delete(`/api/v1/projects/${id}`).set(as(who));

  it('Admin 만 삭제할 수 있다 (소유 Manager 도 403)', async () => {
    expect((await del('manager')).status).toBe(403);
    expect((await del('member')).status).toBe(403);
    expect(store.projects).toHaveLength(1);

    expect((await del('admin')).status).toBe(204);
    expect(store.projects).toHaveLength(0);
    expect(store.members).toHaveLength(0);
  });
});

describe('멤버 관리', () => {
  let id;
  beforeEach(async () => {
    id = (await createProject('manager', { memberIds: [people.member.id] })).body.id;
  });
  const add = (who, userId) =>
    request(app).post(`/api/v1/projects/${id}/members`).set(as(who)).send({ userId });
  const remove = (who, userId) =>
    request(app).delete(`/api/v1/projects/${id}/members/${userId}`).set(as(who));

  it('소유 Manager 가 멤버를 추가하면 그 사용자는 프로젝트에 접근할 수 있다', async () => {
    expect((await request(app).get(`/api/v1/projects/${id}`).set(as('outsider'))).status).toBe(403);

    const res = await add('manager', people.outsider.id);
    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe(people.outsider.id);

    expect((await request(app).get(`/api/v1/projects/${id}`).set(as('outsider'))).status).toBe(200);
  });

  it('Member 와 멤버가 아닌 Manager 는 추가/제거할 수 없다', async () => {
    expect((await add('member', people.outsider.id)).status).toBe(403);
    expect((await add('manager2', people.outsider.id)).status).toBe(403);
    expect((await remove('member', people.member.id)).status).toBe(403);
    expect(store.members).toHaveLength(2);
  });

  it('이미 멤버면 409, 없는/비활성 사용자는 404/400', async () => {
    const dup = await add('manager', people.member.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');

    expect((await add('manager', crypto.randomUUID())).status).toBe(404);

    store.users.find((u) => u.id === people.outsider.id).is_active = false;
    expect((await add('manager', people.outsider.id)).status).toBe(400);
    expect((await add('manager', 'not-a-uuid')).status).toBe(400);
  });

  it('멤버를 제거하면 접근이 막히고 목록에서 사라진다', async () => {
    expect((await remove('manager', people.member.id)).status).toBe(204);
    expect((await request(app).get(`/api/v1/projects/${id}`).set(as('member'))).status).toBe(403);
    const list = await request(app).get('/api/v1/projects').set(as('member'));
    expect(list.body.data).toEqual([]);
  });

  it('소유자는 제거할 수 없다 (Admin 이 해도 409)', async () => {
    const res = await remove('admin', people.manager.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWNER_CANNOT_BE_REMOVED');
  });

  it('멤버가 아닌 사용자를 제거하면 404', async () => {
    expect((await remove('manager', people.outsider.id)).status).toBe(404);
  });

  it('멤버 목록은 멤버와 Admin 만 볼 수 있다', async () => {
    const ok = await request(app).get(`/api/v1/projects/${id}/members`).set(as('member'));
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(2);
    const no = await request(app).get(`/api/v1/projects/${id}/members`).set(as('outsider'));
    expect(no.status).toBe(403);
  });
});

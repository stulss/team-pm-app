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
vi.mock('../modules/chat/repository.js', async () => ({
  ...(await vi.importActual('../modules/chat/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).chatRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice(멤버·담당자), bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let tid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const mySettings = (who, id = pid) => api('patch', `/projects/${id}/my-settings`, who, {});
const set = (who, body, id = pid) => api('patch', `/projects/${id}/my-settings`, who, body);
const types = async (who) => (await api('get', '/notifications', who)).body.data.map((n) => n.type);
const mkProject = async (name) =>
  (await api('post', '/projects', 'owner', { name, memberIds: [people.alice.id, people.bob.id] }))
    .body.id;

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
  pid = await mkProject('프로젝트 A');
  tid = (
    await api('post', `/projects/${pid}/tasks`, 'owner', {
      title: '작업',
      assigneeId: people.alice.id,
    })
  ).body.id;
});

describe('내 프로젝트 설정', () => {
  it('기본값은 둘 다 꺼짐이고, 목록·상세 응답에 mySettings 가 실린다', async () => {
    const list = (await api('get', '/projects', 'alice')).body.data;
    expect(list[0].mySettings).toEqual({ muted: false, pinned: false });
    const detail = (await api('get', `/projects/${pid}`, 'alice')).body;
    expect(detail.mySettings).toEqual({ muted: false, pinned: false });
  });

  it('일부만 바꾸면 나머지는 유지되고, 본인에게만 적용된다', async () => {
    const res = await set('alice', { pinned: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ muted: false, pinned: true });
    expect((await set('alice', { muted: true })).body).toEqual({ muted: true, pinned: true });
    expect((await api('get', `/projects/${pid}`, 'bob')).body.mySettings).toEqual({
      muted: false,
      pinned: false,
    });
    expect((await api('get', `/projects/${pid}`, 'alice')).body.mySettings).toEqual({
      muted: true,
      pinned: true,
    });
    expect((await set('alice', { pinned: false })).body).toEqual({ muted: true, pinned: false });
  });

  it('빈 객체·허용되지 않은 키·값은 400, 비멤버는 403, 인증 없으면 401', async () => {
    for (const body of [{}, { muted: 'yes' }, { admin: true }, { pinned: 1 }]) {
      expect((await set('alice', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await set('outsider', { muted: true })).status).toBe(403);
    expect(
      (await request(app).patch(`/api/v1/projects/${pid}/my-settings`).send({ muted: true }))
        .status,
    ).toBe(401);
    expect((await mySettings('alice')).status).toBe(400);
  });

  it('멤버가 아닌 Admin 은 프로젝트를 볼 수는 있어도 개인 설정은 바꿀 수 없다(403)', async () => {
    expect((await api('get', `/projects/${pid}`, 'admin')).status).toBe(200);
    expect((await set('admin', { pinned: true })).status).toBe(403);
  });

  it('고정한 프로젝트가 목록 맨 위에 오고, 그 안에서는 최신순', async () => {
    const b = await mkProject('프로젝트 B');
    const c = await mkProject('프로젝트 C');
    const order = async () => (await api('get', '/projects', 'alice')).body.data.map((p) => p.name);
    expect(await order()).toEqual(['프로젝트 C', '프로젝트 B', '프로젝트 A']);
    await set('alice', { pinned: true }, pid);
    expect(await order()).toEqual(['프로젝트 A', '프로젝트 C', '프로젝트 B']);
    await set('alice', { pinned: true }, b);
    expect(await order()).toEqual(['프로젝트 B', '프로젝트 A', '프로젝트 C']);
    // 다른 사용자의 목록 순서는 영향이 없다
    expect((await api('get', '/projects', 'bob')).body.data.map((p) => p.name)).toEqual([
      '프로젝트 C',
      '프로젝트 B',
      '프로젝트 A',
    ]);
    void c;
  });

  it('보관된 프로젝트에서도 바꿀 수 있다', async () => {
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await set('alice', { muted: true })).status).toBe(200);
  });
});

describe('음소거한 프로젝트의 알림은 만들어지지 않는다', () => {
  it('배정·댓글 알림이 오지 않고, 다른 프로젝트의 알림은 계속 온다', async () => {
    const before = await types('alice');
    expect(before).toEqual(['task_assigned']);
    await set('alice', { muted: true });

    const second = (
      await api('post', `/projects/${pid}/tasks`, 'owner', {
        title: '새 작업',
        assigneeId: people.alice.id,
      })
    ).body;
    await api('post', `/tasks/${second.id}/comments`, 'bob', { body: '댓글' });
    expect(await types('alice')).toEqual(['task_assigned']); // 음소거 전에 받은 1건뿐

    const other = await mkProject('프로젝트 B');
    await api('post', `/projects/${other}/tasks`, 'owner', {
      title: '다른 프로젝트 작업',
      assigneeId: people.alice.id,
    });
    expect(await types('alice')).toEqual(['task_assigned', 'task_assigned']);
  });

  it('채팅 멘션(프로젝트 직접 지정)과 댓글 멘션도 막고, 해제하면 다시 온다', async () => {
    await set('bob', { muted: true });
    await api('post', `/projects/${pid}/chat`, 'owner', {
      body: '@밥 채팅',
      mentionIds: [people.bob.id],
    });
    await api('post', `/tasks/${tid}/comments`, 'owner', {
      body: '@밥 댓글',
      mentionIds: [people.bob.id],
    });
    expect(await types('bob')).toEqual([]);
    await set('bob', { muted: false });
    await api('post', `/projects/${pid}/chat`, 'owner', {
      body: '@밥 다시',
      mentionIds: [people.bob.id],
    });
    expect(await types('bob')).toEqual(['mention']);
  });

  it('음소거는 본인에게만 적용된다 (다른 담당자는 계속 받는다)', async () => {
    await set('alice', { muted: true });
    const bobTask = (
      await api('post', `/projects/${pid}/tasks`, 'owner', {
        title: '밥 작업',
        assigneeId: people.bob.id,
      })
    ).body;
    expect(bobTask.id).toBeTruthy();
    expect(await types('bob')).toEqual(['task_assigned']);
  });
});

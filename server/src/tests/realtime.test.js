import http from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
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
const { attachSockets } = await import('../sockets/index.js');
const { registerIo } = await import('../sockets/emitter.js');

// 실제 http + socket.io 서버(Redis 없이 단일 인스턴스). REST 는 supertest 로 app 에 직접 보낸다.
const httpServer = http.createServer(app);
let url;
let io;
const open = [];

beforeAll(async () => {
  const ready = attachSockets(httpServer);
  registerIo(ready);
  io = await ready;
  await new Promise((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${httpServer.address().port}`;
});

afterAll(async () => {
  open.forEach((s) => s.close());
  await io.close();
});

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      path: '/api/socket.io',
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    open.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
const join = (socket, projectId) =>
  new Promise((resolve) => socket.emit('project:join', { projectId }, resolve));
const next = (socket, event, ms = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
const silent = (socket, event, ms = 400) =>
  new Promise((resolve, reject) => {
    const fail = () => reject(new Error(`unexpected ${event}`));
    socket.once(event, fail);
    setTimeout(() => {
      socket.off(event, fail);
      resolve();
    }, ms);
  });

const people = {};
const as = (who) => bearer(people[who].token);
let pid;
const sockets = {};

const rest = (method, path, who, body, socketId) => {
  let req = request(app)[method](`/api/v1${path}`).set(as(who));
  if (socketId) req = req.set('X-Socket-Id', socketId);
  return body ? req.send(body) : req;
};

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['manager', '매니저'],
    ['member', '멤버'],
    ['member2', '멤버2'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  store.users.find((u) => u.id === people.manager.id).role = 'manager';
  const created = await rest('post', '/projects', 'manager', {
    name: '실시간',
    memberIds: [people.member.id, people.member2.id],
  });
  pid = created.body.id;
  for (const key of ['member', 'member2', 'outsider'])
    sockets[key] = await connect(people[key].token);
});

describe('project:join', () => {
  it('멤버와 Admin 은 입장하고, 비멤버·잘못된 ID·없는 프로젝트는 거부된다', async () => {
    expect(await join(sockets.member, pid)).toEqual({ ok: true });
    expect(await join(sockets.outsider, pid)).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await join(sockets.member, 'abc')).toEqual({ ok: false, error: 'INVALID_PROJECT_ID' });
    expect(await join(sockets.member, crypto.randomUUID())).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    const adminSocket = await connect(people.admin.token);
    expect(await join(adminSocket, pid)).toEqual({ ok: true });
  });

  it('입장하지 않은 소켓은 이벤트를 받지 못한다', async () => {
    await join(sockets.outsider, pid); // 거부됨
    const quiet = silent(sockets.outsider, 'task:created');
    await rest('post', `/projects/${pid}/tasks`, 'manager', { title: '비공개' });
    await quiet;
  });
});

describe('작업 이벤트', () => {
  beforeEach(async () => {
    await join(sockets.member, pid);
    await join(sockets.member2, pid);
  });

  it('task:created 는 같은 프로젝트의 다른 소켓에 전달되고 요청자 소켓은 제외된다', async () => {
    const other = next(sockets.member2, 'task:created');
    const self = silent(sockets.member, 'task:created');
    const outside = silent(sockets.outsider, 'task:created');

    const res = await rest(
      'post',
      `/projects/${pid}/tasks`,
      'member',
      { title: '새 작업' },
      sockets.member.id,
    );
    expect(res.status).toBe(201);

    const payload = await other;
    expect(payload.projectId).toBe(pid);
    expect(payload.task).toMatchObject({ id: res.body.id, title: '새 작업', status: 'todo' });
    await self;
    await outside;
  });

  it('X-Socket-Id 가 없으면 요청자 소켓도 받는다', async () => {
    const got = next(sockets.member, 'task:created');
    await rest('post', `/projects/${pid}/tasks`, 'member', { title: '헤더 없음' });
    expect((await got).task.title).toBe('헤더 없음');
  });

  it('task:updated / task:moved / task:deleted', async () => {
    const created = await rest('post', `/projects/${pid}/tasks`, 'manager', { title: '대상' });
    const id = created.body.id;

    const updated = next(sockets.member2, 'task:updated');
    await rest(
      'patch',
      `/tasks/${id}`,
      'member',
      { title: '수정됨', priority: 'urgent' },
      sockets.member.id,
    );
    expect((await updated).task).toMatchObject({ id, title: '수정됨', priority: 'urgent' });

    const moved = next(sockets.member2, 'task:moved');
    await rest('patch', `/tasks/${id}/move`, 'member', { status: 'review' }, sockets.member.id);
    expect(await moved).toMatchObject({
      projectId: pid,
      taskId: id,
      status: 'review',
      position: 1024,
      movedBy: people.member.id,
    });

    const deleted = next(sockets.member2, 'task:deleted');
    await rest('delete', `/tasks/${id}`, 'manager', null, sockets.member.id);
    expect(await deleted).toEqual({ projectId: pid, taskId: id });
  });

  it('권한 오류로 실패한 요청은 이벤트를 만들지 않는다', async () => {
    const created = await rest('post', `/projects/${pid}/tasks`, 'manager', { title: '남의 작업' });
    const quiet = silent(sockets.member2, 'task:deleted');
    const res = await rest('delete', `/tasks/${created.body.id}`, 'member');
    expect(res.status).toBe(403);
    await quiet;
  });

  it('project:leave 이후에는 받지 못한다', async () => {
    await new Promise((resolve) =>
      sockets.member2.emit('project:leave', { projectId: pid }, resolve),
    );
    const quiet = silent(sockets.member2, 'task:created');
    await rest('post', `/projects/${pid}/tasks`, 'manager', { title: '떠난 뒤' });
    await quiet;
  });
});

describe('프로젝트·멤버 이벤트와 접근 회수', () => {
  beforeEach(async () => {
    await join(sockets.member, pid);
    await join(sockets.member2, pid);
  });

  it('project:updated (보관)', async () => {
    const got = next(sockets.member, 'project:updated');
    await rest('patch', `/projects/${pid}`, 'manager', { status: 'archived' });
    expect((await got).project).toMatchObject({ id: pid, status: 'archived' });
  });

  it('멤버를 제거하면 member:removed 를 받고, 이후 프로젝트 이벤트는 받지 못한다', async () => {
    const roomEvent = next(sockets.member2, 'member:removed');
    const res = await rest('delete', `/projects/${pid}/members/${people.member2.id}`, 'manager');
    expect(res.status).toBe(204);
    expect((await roomEvent).user.id).toBe(people.member2.id);

    const removedQuiet = silent(sockets.member2, 'task:created');
    const stillGets = next(sockets.member, 'task:created');
    await rest('post', `/projects/${pid}/tasks`, 'manager', { title: '제거 후' });
    await removedQuiet;
    expect((await stillGets).task.title).toBe('제거 후');
  });

  it('제거된 사용자는 다시 입장할 수 없다', async () => {
    await rest('delete', `/projects/${pid}/members/${people.member2.id}`, 'manager');
    expect(await join(sockets.member2, pid)).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('멤버를 추가하면 프로젝트 방과 새 멤버의 개인 방에 member:added 가 간다', async () => {
    const room = next(sockets.member, 'member:added');
    const personal = next(sockets.outsider, 'member:added');
    await rest('post', `/projects/${pid}/members`, 'manager', { userId: people.outsider.id });
    expect((await room).user.id).toBe(people.outsider.id);
    expect((await personal).projectId).toBe(pid);
  });

  it('사용자를 비활성화하면 소켓 연결이 끊긴다', async () => {
    const closed = next(sockets.member2, 'disconnect');
    const res = await rest('patch', `/users/${people.member2.id}/status`, 'admin', {
      isActive: false,
    });
    expect(res.status).toBe(200);
    await closed;
    expect(sockets.member2.connected).toBe(false);
  });

  it('역할을 바꾸면 소켓 연결이 끊겨 재연결 시 권한을 다시 검증받는다', async () => {
    const closed = next(sockets.member, 'disconnect');
    await rest('patch', `/users/${people.member.id}/role`, 'admin', { role: 'manager' });
    await closed;
  });
});

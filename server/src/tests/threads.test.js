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
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자, 비멤버), owner(소유자·작업 작성자), alice(담당자), bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let tid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const post = (who, text, extra = {}, task = tid) =>
  api('post', `/tasks/${task}/comments`, who, { body: text, ...extra });
const notificationsOf = async (who) => (await api('get', '/notifications', who)).body.data;
const listComments = async (who = 'owner', task = tid) =>
  (await api('get', `/tasks/${task}/comments`, who)).body.data;

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
      name: '스레드 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
  tid = (
    await api('post', `/projects/${pid}/tasks`, 'owner', {
      title: '스레드 작업',
      assigneeId: people.alice.id,
    })
  ).body.id;
});

describe('답글 달기', () => {
  it('일반 댓글은 parentId 가 null, 답글은 원 댓글 ID 를 가진다(목록은 작성순 평면 배열)', async () => {
    const root = (await post('bob', '원 댓글')).body;
    expect(root.parentId).toBeNull();
    const reply = await post('alice', '답글입니다', { parentId: root.id });
    expect(reply.status).toBe(201);
    expect(reply.body.parentId).toBe(root.id);
    const second = (await post('owner', '두 번째 답글', { parentId: root.id })).body;

    const list = await listComments('bob');
    expect(list.map((c) => [c.body, c.parentId])).toEqual([
      ['원 댓글', null],
      ['답글입니다', root.id],
      ['두 번째 답글', root.id],
    ]);
    expect(second.parentId).toBe(root.id);
  });

  it('답글에 다시 답글은 400 REPLY_TO_REPLY', async () => {
    const root = (await post('bob', '원 댓글')).body;
    const reply = (await post('alice', '답글', { parentId: root.id })).body;
    const nested = await post('bob', '답글의 답글', { parentId: reply.id });
    expect(nested.status).toBe(400);
    expect(nested.body.error.code).toBe('REPLY_TO_REPLY');
    expect(await listComments()).toHaveLength(2);
  });

  it('없는 댓글·잘못된 ID·다른 작업의 댓글은 거부한다 (다른 작업은 404)', async () => {
    const root = (await post('bob', '원 댓글')).body;
    const otherTask = (await api('post', `/projects/${pid}/tasks`, 'owner', { title: '다른 작업' }))
      .body.id;
    expect(
      (await post('alice', 'x', { parentId: '00000000-0000-4000-8000-000000000000' })).status,
    ).toBe(404);
    expect((await post('alice', 'x', { parentId: 'nope' })).status).toBe(400);
    const crossTask = await post('alice', '다른 작업에 답글', { parentId: root.id }, otherTask);
    expect(crossTask.status).toBe(404);
    expect(await listComments('owner', otherTask)).toEqual([]);
  });

  it('삭제된 댓글에는 답글을 달 수 없지만, 이미 달린 답글은 남는다', async () => {
    const root = (await post('bob', '원 댓글')).body;
    await post('alice', '먼저 단 답글', { parentId: root.id });
    await api('delete', `/comments/${root.id}`, 'bob');
    const late = await post('alice', '늦은 답글', { parentId: root.id });
    expect(late.status).toBe(404);

    const list = await listComments();
    expect(list.map((c) => [c.body, c.deleted, c.parentId])).toEqual([
      ['삭제된 댓글', true, null],
      ['먼저 단 답글', false, root.id],
    ]);
  });

  it('비멤버는 403, 인증 없으면 401, 보관된 프로젝트는 409', async () => {
    const root = (await post('bob', '원 댓글')).body;
    expect((await post('outsider', 'x', { parentId: root.id })).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/v1/tasks/${tid}/comments`)
          .send({ body: 'x', parentId: root.id })
      ).status,
    ).toBe(401);
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    const archived = await post('alice', '보관 후', { parentId: root.id });
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('PROJECT_ARCHIVED');
  });

  it('답글도 수정·삭제·멘션·반응이 되고 댓글 수 배지에 포함된다', async () => {
    const root = (await post('bob', '원 댓글')).body;
    const reply = (
      await post('alice', `@밥 확인했어요`, { parentId: root.id, mentionIds: [people.bob.id] })
    ).body;
    expect(reply.mentions.map((m) => m.name)).toEqual(['밥']);
    const edited = await api('patch', `/comments/${reply.id}`, 'alice', { body: '수정한 답글' });
    expect(edited.body).toMatchObject({ body: '수정한 답글', parentId: root.id });
    const reacted = await api('put', `/comments/${reply.id}/reactions/heart`, 'bob');
    expect(reacted.body.reactions).toHaveLength(1);

    const task = (await api('get', `/tasks/${tid}`, 'owner')).body;
    expect(task.commentCount).toBe(2);
    await api('delete', `/comments/${reply.id}`, 'alice');
    expect((await api('get', `/tasks/${tid}`, 'owner')).body.commentCount).toBe(1);
  });

  it('답글은 comment:created 로 퍼지고 payload 에 parentId 가 있다', async () => {
    const root = (await post('bob', '원 댓글')).body;
    emitToProject.mockClear();
    await post('alice', '답글', { parentId: root.id });
    const events = emitToProject.mock.calls.filter((c) => c[2] === 'comment:created');
    expect(events).toHaveLength(1);
    expect(events[0][3].comment.parentId).toBe(root.id);
  });
});

describe('답글 알림', () => {
  const mine = async (who) =>
    (await notificationsOf(who)).filter((n) => n.type === 'comment_added').map((n) => n.message);

  it('원 댓글 작성자에게는 답글 알림 하나만 가고, 담당자·작업 작성자에게는 일반 댓글 알림이 간다', async () => {
    const root = (await post('bob', '원 댓글')).body;
    // bob 의 원 댓글: 담당자 alice·작성자 owner 에게 댓글 알림
    expect(await mine('alice')).toHaveLength(1);
    expect(await mine('owner')).toHaveLength(1);

    await post('alice', '답글', { parentId: root.id });
    const bob = await mine('bob');
    expect(bob).toHaveLength(1);
    expect(bob[0]).toContain('앨리스님이');
    expect(bob[0]).toContain('답글');
    // 작업 작성자 owner 는 일반 댓글 알림, 답글을 쓴 alice 본인은 새 알림 없음
    expect(await mine('owner')).toHaveLength(2);
    expect(await mine('alice')).toHaveLength(1);
  });

  it('원 댓글 작성자가 담당자이면 답글 알림 하나만(중복 없음)', async () => {
    const root = (await post('alice', '담당자의 댓글')).body;
    await post('bob', '답글', { parentId: root.id });
    const alice = await mine('alice');
    expect(alice).toHaveLength(1);
    expect(alice[0]).toContain('답글');
  });

  it('자기 댓글에 답글을 달면 본인에게는 알림이 없다', async () => {
    const root = (await post('bob', '내 댓글')).body;
    await post('bob', '내 답글', { parentId: root.id });
    expect(await mine('bob')).toEqual([]);
  });

  it('원 댓글 작성자를 멘션하면 멘션 알림만 가고 답글 알림은 따로 가지 않는다', async () => {
    const root = (await post('bob', '원 댓글')).body;
    await post('alice', '@밥 답글', { parentId: root.id, mentionIds: [people.bob.id] });
    const all = await notificationsOf('bob');
    expect(all.map((n) => n.type)).toEqual(['mention']);
  });
});

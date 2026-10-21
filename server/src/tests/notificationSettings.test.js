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
const { emitToUser } = await import('../sockets/emitter.js');
const { store } = await import('./helpers/memoryRepos.js');

// admin(첫 가입자), owner(소유자·작업 작성자), alice(담당자), bob(멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let tid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const setNotifications = (who, notifications) =>
  api('patch', '/users/me/preferences', who, { notifications });
const inbox = async (who) => (await api('get', '/notifications', who)).body.data;
const types = async (who) => (await inbox(who)).map((n) => n.type);

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['bob', '밥'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '알림 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
  tid = (
    await api('post', `/projects/${pid}/tasks`, 'owner', {
      title: '알림 작업',
      assigneeId: people.alice.id,
    })
  ).body.id;
});

describe('끈 알림은 만들어지지 않는다', () => {
  it('기본값은 모두 받는다 (배정 알림이 온다)', async () => {
    expect(await types('alice')).toEqual(['task_assigned']);
  });

  it('배정 알림을 끄면 새 배정 알림이 오지 않고, 다른 종류는 계속 온다', async () => {
    await setNotifications('alice', { assigned: false });
    const second = (
      await api('post', `/projects/${pid}/tasks`, 'owner', {
        title: '두 번째',
        assigneeId: people.alice.id,
      })
    ).body;
    expect(await types('alice')).toEqual(['task_assigned']); // 설정 전에 받은 1건뿐
    // 댓글 알림은 켜져 있어 계속 온다
    await api('post', `/tasks/${second.id}/comments`, 'bob', { body: '확인 부탁' });
    expect(await types('alice')).toEqual(['comment_added', 'task_assigned']);
  });

  it('댓글 알림을 끄면 댓글 알림은 없고 배정 알림은 온다', async () => {
    await setNotifications('alice', { comment: false });
    await api('post', `/tasks/${tid}/comments`, 'bob', { body: '댓글입니다' });
    expect(await types('alice')).toEqual(['task_assigned']);
  });

  it('멘션 알림을 끄면 멘션해도 알림이 가지 않는다 (댓글·채팅 모두)', async () => {
    await setNotifications('bob', { mention: false });
    await api('post', `/tasks/${tid}/comments`, 'owner', {
      body: '@밥 확인해 주세요',
      mentionIds: [people.bob.id],
    });
    await api('post', `/projects/${pid}/chat`, 'owner', {
      body: '@밥 채팅에서도',
      mentionIds: [people.bob.id],
    });
    expect(await types('bob')).toEqual([]);
    // 켜면 다시 온다
    await setNotifications('bob', { mention: true });
    await api('post', `/tasks/${tid}/comments`, 'owner', {
      body: '@밥 다시',
      mentionIds: [people.bob.id],
    });
    expect(await types('bob')).toEqual(['mention']);
  });

  it('끈 종류는 실시간 푸시도 하지 않는다', async () => {
    await setNotifications('alice', { assigned: false });
    emitToUser.mockClear();
    await api('post', `/projects/${pid}/tasks`, 'owner', {
      title: '푸시 없음',
      assigneeId: people.alice.id,
    });
    expect(emitToUser.mock.calls.filter((c) => c[1] === 'notification:new')).toHaveLength(0);
  });

  it('마감 알림(due)을 끄면 매일 작업이 만드는 임박·지연 알림이 없다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { notificationsRepo } = await import('./helpers/memoryRepos.js');
    await setNotifications('alice', { due: false });
    const rows = await notificationsRepo.insertMany([
      { userId: people.alice.id, type: 'due_soon', taskId: tid, message: `마감 ${today}` },
      { userId: people.alice.id, type: 'task_overdue', taskId: tid, message: '지연' },
      { userId: people.bob.id, type: 'due_soon', taskId: tid, message: '밥은 받음' },
    ]);
    expect(rows.map((r) => r.user_id)).toEqual([people.bob.id]);
    expect(
      store.notifications.filter(
        (n) => n.user_id === people.alice.id && n.type !== 'task_assigned',
      ),
    ).toEqual([]);
  });

  it('한 번에 여러 명에게 보낼 때 끈 사람만 빠진다', async () => {
    const { notificationsRepo } = await import('./helpers/memoryRepos.js');
    await setNotifications('alice', { comment: false });
    const rows = await notificationsRepo.insertMany([
      { userId: people.alice.id, type: 'comment_added', taskId: tid, message: 'a' },
      { userId: people.bob.id, type: 'comment_added', taskId: tid, message: 'b' },
    ]);
    expect(rows.map((r) => r.message)).toEqual(['b']);
  });
});

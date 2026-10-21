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
const mkComment = async (who = 'alice', text = '확인 부탁드립니다') =>
  (await api('post', `/tasks/${tid}/comments`, who, { body: text })).body;
const mkMessage = async (who = 'alice', text = '안녕하세요') =>
  (await api('post', `/projects/${pid}/chat`, who, { body: text })).body;
const reactComment = (who, comment, key, method = 'put') =>
  api(method, `/comments/${comment.id}/reactions/${key}`, who);
const reactChat = (who, message, key, method = 'put', id = pid) =>
  api(method, `/projects/${id}/chat/${message.id}/reactions/${key}`, who);
const names = (reactions) => reactions.map((r) => [r.key, r.users.map((u) => u.name)]);

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
      name: '반응 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
  tid = (await api('post', `/projects/${pid}/tasks`, 'owner', { title: '작업' })).body.id;
});

describe('댓글 반응', () => {
  it('새 댓글은 반응이 비어 있고, 달면 키와 사용자 이름이 처음 달린 순서로 실린다', async () => {
    const comment = await mkComment();
    expect(comment.reactions).toEqual([]);

    const first = await reactComment('bob', comment, 'thumbs_up');
    expect(first.status).toBe(200);
    expect(names(first.body.reactions)).toEqual([['thumbs_up', ['밥']]]);
    await reactComment('owner', comment, 'heart');
    await reactComment('alice', comment, 'thumbs_up');

    const listed = (await api('get', `/tasks/${tid}/comments`, 'bob')).body.data[0];
    expect(names(listed.reactions)).toEqual([
      ['thumbs_up', ['밥', '앨리스']],
      ['heart', ['소유자']],
    ]);
    expect(listed.reactions[0].users[0]).toEqual({ id: people.bob.id, name: '밥' });
  });

  it('같은 반응을 다시 달아도 그대로(멱등)이고, 거두면 사라진다', async () => {
    const comment = await mkComment();
    await reactComment('bob', comment, 'party');
    const again = await reactComment('bob', comment, 'party');
    expect(again.status).toBe(200);
    expect(names(again.body.reactions)).toEqual([['party', ['밥']]]);

    const removed = await reactComment('bob', comment, 'party', 'delete');
    expect(removed.status).toBe(200);
    expect(removed.body.reactions).toEqual([]);
    expect((await reactComment('bob', comment, 'party', 'delete')).status).toBe(200);
  });

  it('한 사람이 서로 다른 반응을 여러 개 달 수 있고, 내 것만 거둘 수 있다', async () => {
    const comment = await mkComment();
    for (const key of ['eyes', 'check', 'wow']) await reactComment('bob', comment, key);
    await reactComment('alice', comment, 'eyes');
    const removed = await reactComment('bob', comment, 'eyes', 'delete');
    // 순서는 "남아 있는 반응 중 가장 먼저 달린 시각" 기준이라, 밥의 eyes 가 빠지면 앨리스의 eyes 가 뒤로 간다
    expect(names(removed.body.reactions)).toEqual([
      ['check', ['밥']],
      ['wow', ['밥']],
      ['eyes', ['앨리스']],
    ]);
  });

  it('허용되지 않은 키는 400, 잘못된 댓글 ID 는 400, 없는 댓글은 404', async () => {
    const comment = await mkComment();
    expect((await reactComment('bob', comment, 'fire')).status).toBe(400);
    expect((await api('put', '/comments/not-a-uuid/reactions/heart', 'bob')).status).toBe(400);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await api('put', `/comments/${missing}/reactions/heart`, 'bob')).status).toBe(404);
  });

  it('비멤버는 403, 인증 없으면 401, Admin 은 가능', async () => {
    const comment = await mkComment();
    expect((await reactComment('outsider', comment, 'heart')).status).toBe(403);
    expect((await request(app).put(`/api/v1/comments/${comment.id}/reactions/heart`)).status).toBe(
      401,
    );
    expect((await reactComment('admin', comment, 'heart')).status).toBe(200);
  });

  it('삭제된 댓글에는 달 수 없고(404), 응답에서도 반응이 가려진다', async () => {
    const comment = await mkComment();
    await reactComment('bob', comment, 'heart');
    await api('delete', `/comments/${comment.id}`, 'alice');
    expect((await reactComment('bob', comment, 'heart')).status).toBe(404);
    expect((await reactComment('bob', comment, 'heart', 'delete')).status).toBe(404);
    const listed = (await api('get', `/tasks/${tid}/comments`, 'bob')).body.data[0];
    expect(listed.deleted).toBe(true);
    expect(listed.reactions).toEqual([]);
  });

  it('본문을 바꾸지 않으므로 수정됨 표시가 생기지 않고, comment:updated 로 퍼진다', async () => {
    const comment = await mkComment();
    emitToProject.mockClear();
    const res = await reactComment('bob', comment, 'heart');
    expect(res.body.edited).toBe(false);
    const events = emitToProject.mock.calls.filter((c) => c[2] === 'comment:updated');
    expect(events).toHaveLength(1);
    expect(events[0][3]).toMatchObject({ projectId: pid, taskId: tid });
    expect(names(events[0][3].comment.reactions)).toEqual([['heart', ['밥']]]);
  });

  it('보관된 프로젝트는 읽기 전용(409)', async () => {
    const comment = await mkComment();
    await reactComment('bob', comment, 'heart');
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    for (const method of ['put', 'delete']) {
      const res = await reactComment('bob', comment, 'heart', method);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    const listed = (await api('get', `/tasks/${tid}/comments`, 'bob')).body.data[0];
    expect(names(listed.reactions)).toEqual([['heart', ['밥']]]);
  });
});

describe('채팅 반응', () => {
  it('달고 거두면 목록과 응답에 반영된다', async () => {
    const message = await mkMessage();
    expect(message.reactions).toEqual([]);
    const res = await reactChat('bob', message, 'laugh');
    expect(res.status).toBe(200);
    expect(names(res.body.reactions)).toEqual([['laugh', ['밥']]]);
    await reactChat('owner', message, 'laugh');
    const listed = (await api('get', `/projects/${pid}/chat`, 'alice')).body.data[0];
    expect(names(listed.reactions)).toEqual([['laugh', ['밥', '소유자']]]);

    const removed = await reactChat('bob', message, 'laugh', 'delete');
    expect(names(removed.body.reactions)).toEqual([['laugh', ['소유자']]]);
    expect((await reactChat('bob', message, 'laugh', 'delete')).status).toBe(200);
  });

  it('허용되지 않은 키 400, 없는 메시지·다른 프로젝트의 메시지 404, 비멤버 403', async () => {
    const message = await mkMessage();
    expect((await reactChat('bob', message, 'fire')).status).toBe(400);
    expect((await reactChat('outsider', message, 'heart')).status).toBe(403);
    const other = (await api('post', '/projects', 'owner', { name: '다른 프로젝트' })).body.id;
    expect((await reactChat('owner', message, 'heart', 'put', other)).status).toBe(404);
    const missing = { id: '00000000-0000-4000-8000-000000000000' };
    expect((await reactChat('bob', missing, 'heart')).status).toBe(404);
    expect(
      (await request(app).put(`/api/v1/projects/${pid}/chat/${message.id}/reactions/heart`)).status,
    ).toBe(401);
  });

  it('chat:updated 로 퍼지고, 메시지를 지우면 반응도 사라지며, 보관 프로젝트는 409', async () => {
    const message = await mkMessage();
    emitToProject.mockClear();
    await reactChat('bob', message, 'heart');
    const events = emitToProject.mock.calls.filter((c) => c[2] === 'chat:updated');
    expect(events).toHaveLength(1);
    expect(names(events[0][3].message.reactions)).toEqual([['heart', ['밥']]]);

    await api('delete', `/projects/${pid}/chat/${message.id}`, 'alice');
    expect((await api('get', `/projects/${pid}/chat`, 'bob')).body.data).toEqual([]);

    const second = await mkMessage('alice', '두 번째');
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    const blocked = await reactChat('bob', second, 'heart');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

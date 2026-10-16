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
// 상한 정리를 작게 시험하려고 프로젝트당 3건으로 줄인다.
vi.mock('../modules/chat/repository.js', async () => ({
  ...(await vi.importActual('../modules/chat/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).chatRepo,
  MAX_PER_PROJECT: 3,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(비멤버, 첫 가입자), owner(소유자), member(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const say = (who, body) => api('post', `/projects/${pid}/chat`, who, { body });
const feed = async (who = 'owner', qs = '') =>
  (await api('get', `/projects/${pid}/chat${qs}`, who)).body;

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['member', '멤버'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  const created = await api('post', '/projects', 'owner', {
    name: '채팅 프로젝트',
    memberIds: [people.member.id],
  });
  pid = created.body.id;
});

describe('접근 권한', () => {
  it('멤버는 읽고 쓸 수 있고, 비멤버는 403, 인증 없으면 401', async () => {
    expect((await say('member', '안녕하세요')).status).toBe(201);
    expect((await api('get', `/projects/${pid}/chat`, 'owner')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/chat`, 'admin')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/chat`, 'outsider')).status).toBe(403);
    expect((await say('outsider', '들어가요')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/chat`)).status).toBe(401);
    expect((await feed()).data).toHaveLength(1);
  });

  it('멤버에서 제거되면 즉시 읽지도 쓰지도 못한다', async () => {
    await api('delete', `/projects/${pid}/members/${people.member.id}`, 'owner');
    expect((await api('get', `/projects/${pid}/chat`, 'member')).status).toBe(403);
    expect((await say('member', '아직 되나요')).status).toBe(403);
  });
});

describe('보내기와 목록', () => {
  it('앞뒤 공백을 지우고 작성자와 함께 돌려주며, 최신순이다', async () => {
    const sent = await say('member', '  첫 메시지  ');
    expect(sent.body).toMatchObject({
      body: '첫 메시지',
      author: { id: people.member.id, name: '멤버' },
    });
    await say('owner', '둘째');
    const { data, nextCursor } = await feed();
    expect(data.map((m) => m.body)).toEqual(['둘째', '첫 메시지']);
    expect(nextCursor).toBeNull();
  });

  it('빈 메시지와 2000자 초과는 400, 2000자는 통과', async () => {
    expect((await say('owner', '   ')).status).toBe(400);
    expect((await say('owner', 'a'.repeat(2001))).status).toBe(400);
    expect((await say('owner', 'a'.repeat(2000))).status).toBe(201);
  });

  it('HTML 은 해석하지 않고 문자열 그대로 저장한다', async () => {
    await say('owner', '<script>alert(1)</script>');
    expect((await feed()).data[0].body).toBe('<script>alert(1)</script>');
  });

  it('커서로 페이지를 나눠 읽는다', async () => {
    for (let i = 1; i <= 3; i += 1) await say('owner', `m${i}`);
    const first = await feed('owner', '?limit=2');
    expect(first.data.map((m) => m.body)).toEqual(['m3', 'm2']);
    expect(first.nextCursor).toBe(first.data[1].seq);
    const second = await feed('owner', `?limit=2&before=${first.nextCursor}`);
    expect(second.data.map((m) => m.body)).toEqual(['m1']);
    expect(second.nextCursor).toBeNull();
  });

  it('잘못된 쿼리는 400', async () => {
    for (const qs of ['?limit=0', '?limit=101', '?before=abc', '?before=0']) {
      expect((await api('get', `/projects/${pid}/chat${qs}`, 'owner')).status, qs).toBe(400);
    }
  });

  it('다른 프로젝트의 메시지는 섞이지 않는다', async () => {
    await say('owner', '여기 메시지');
    const other = await api('post', '/projects', 'owner', { name: '다른 곳' });
    const res = await api('get', `/projects/${other.body.id}/chat`, 'owner');
    expect(res.body.data).toEqual([]);
  });

  it('프로젝트당 상한(테스트에서는 3건)을 넘으면 오래된 메시지부터 지운다', async () => {
    for (let i = 1; i <= 5; i += 1) await say('owner', `m${i}`);
    expect((await feed()).data.map((m) => m.body)).toEqual(['m5', 'm4', 'm3']);
  });

  it('작성자가 사라져도 메시지는 남고 작성자는 null', async () => {
    await say('member', '떠날 사람');
    store.chat[0].author_id = null;
    expect((await feed()).data[0].author).toBeNull();
  });
});

describe('삭제', () => {
  let messageId;
  beforeEach(async () => {
    messageId = (await say('member', '지울 메시지')).body.id;
  });
  const del = (who) => api('delete', `/projects/${pid}/chat/${messageId}`, who);

  it('작성자·소유자·Admin 은 삭제할 수 있다', async () => {
    expect((await del('member')).status).toBe(204);
    expect((await feed()).data).toHaveLength(0);
    for (const who of ['owner', 'admin']) {
      messageId = (await say('member', '또 지움')).body.id;
      expect((await del(who)).status, who).toBe(204);
    }
  });

  it('다른 멤버와 비멤버는 삭제할 수 없다', async () => {
    const third = await register(app, { email: 'third@example.com', name: '셋째' });
    await api('post', `/projects/${pid}/members`, 'owner', { userId: third.res.body.user.id });
    const res = await request(app)
      .delete(`/api/v1/projects/${pid}/chat/${messageId}`)
      .set(bearer(third.res.body.accessToken));
    expect(res.status).toBe(403);
    expect((await del('outsider')).status).toBe(403);
    expect((await feed()).data).toHaveLength(1);
  });

  it('없는 메시지·다른 프로젝트의 메시지는 404, 잘못된 ID 는 400', async () => {
    const other = await api('post', '/projects', 'owner', { name: '다른 곳' });
    const res = await api('delete', `/projects/${other.body.id}/chat/${messageId}`, 'owner');
    expect(res.status).toBe(404);
    const missing = await api('delete', `/projects/${pid}/chat/${crypto.randomUUID()}`, 'owner');
    expect(missing.status).toBe(404);
    expect((await api('delete', `/projects/${pid}/chat/not-a-uuid`, 'owner')).status).toBe(400);
  });
});

describe('보관된 프로젝트는 읽기 전용', () => {
  it('읽기는 되고 보내기·삭제는 409 PROJECT_ARCHIVED', async () => {
    const id = (await say('owner', '보관 전')).body.id;
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await feed()).data).toHaveLength(1);
    const sent = await say('owner', '보관 후');
    expect(sent.status).toBe(409);
    expect(sent.body.error.code).toBe('PROJECT_ARCHIVED');
    expect((await api('delete', `/projects/${pid}/chat/${id}`, 'owner')).status).toBe(409);
  });
});

describe('실시간', () => {
  it('보내면 chat:created, 지우면 chat:deleted 를 프로젝트 방에 보낸다', async () => {
    const sent = await say('member', '실시간 확인');
    expect(emitToProject).toHaveBeenCalledWith(
      expect.anything(),
      pid,
      'chat:created',
      expect.objectContaining({
        projectId: pid,
        message: expect.objectContaining({ id: sent.body.id }),
      }),
    );
    await api('delete', `/projects/${pid}/chat/${sent.body.id}`, 'member');
    expect(emitToProject).toHaveBeenCalledWith(expect.anything(), pid, 'chat:deleted', {
      projectId: pid,
      messageId: sent.body.id,
    });
  });

  it('실패한 요청은 이벤트를 보내지 않는다', async () => {
    emitToProject.mockClear(); // 프로젝트 생성 때의 이벤트는 제외
    await say('outsider', '안 됨');
    await say('owner', '');
    expect(emitToProject).not.toHaveBeenCalled();
  });
});

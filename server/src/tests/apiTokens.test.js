import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
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
const { assertAllowed } = await import('../modules/apiTokens/guard.js');
const { hashToken } = await import('../modules/apiTokens/service.js');

let jwt; // 로그인(JWT)
let projectId;

const issue = async (body = {}) =>
  request(app)
    .post('/api/v1/users/me/api-tokens')
    .set(bearer(jwt))
    .send({ name: 'Claude', scope: 'write', expiresInDays: null, ...body });
const withToken = (token) => bearer(token);

beforeEach(async () => {
  reset();
  const { res } = await register(app);
  jwt = res.body.accessToken;
  const project = await request(app)
    .post('/api/v1/projects')
    .set(bearer(jwt))
    .send({ name: '토큰 테스트', key: 'TOK' });
  projectId = project.body.id;
});

describe('토큰 발급·목록·폐기', () => {
  it('로그인해야 하고, 값은 발급 응답에서만 보이며 DB 에는 해시만 저장한다', async () => {
    expect((await request(app).post('/api/v1/users/me/api-tokens').send({})).status).toBe(401);

    const res = await issue();
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^tpm_[A-Za-z0-9_-]{43}$/);
    expect(res.body.prefix).toBe(res.body.token.slice(0, 12));

    expect(store.apiTokens).toHaveLength(1);
    expect(store.apiTokens[0].token_hash).toBe(hashToken(res.body.token));
    expect(JSON.stringify(store.apiTokens)).not.toContain(res.body.token);

    const list = await request(app).get('/api/v1/users/me/api-tokens').set(bearer(jwt));
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body.data[0]).toMatchObject({ name: 'Claude', scope: 'write', expiresAt: null });
  });

  it('입력을 검증하고(이름·권한·만료), 만료일은 30·90일만', async () => {
    expect((await issue({ name: ' ' })).status).toBe(400);
    expect((await issue({ scope: 'admin' })).status).toBe(400);
    expect((await issue({ expiresInDays: 7 })).status).toBe(400);
    const r = await issue({ expiresInDays: 30 });
    const days = (new Date(r.body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('활성 토큰은 10개까지이고 폐기하면 다시 만들 수 있다', async () => {
    const ids = [];
    for (let i = 0; i < 10; i += 1) ids.push((await issue({ name: `t${i}` })).body.id);
    const over = await issue({ name: '11번째' });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('TOKEN_LIMIT');
    await request(app).delete(`/api/v1/users/me/api-tokens/${ids[0]}`).set(bearer(jwt));
    expect((await issue({ name: '다시' })).status).toBe(201);
  });

  it('폐기하면 그 토큰은 바로 쓸 수 없고, 남의 토큰은 폐기할 수 없다', async () => {
    const t = (await issue()).body;
    const ok = await request(app).get('/api/v1/projects').set(withToken(t.token));
    expect(ok.status).toBe(200);

    const other = await register(app, { email: 'other@example.com', name: '다른이' });
    const stranger = await request(app)
      .delete(`/api/v1/users/me/api-tokens/${t.id}`)
      .set(bearer(other.res.body.accessToken));
    expect(stranger.status).toBe(404);

    const del = await request(app).delete(`/api/v1/users/me/api-tokens/${t.id}`).set(bearer(jwt));
    expect(del.status).toBe(204);
    expect((await request(app).get('/api/v1/projects').set(withToken(t.token))).status).toBe(401);
  });
});

describe('토큰으로 호출', () => {
  it('발급자의 권한으로 읽고 쓴다', async () => {
    const { token } = (await issue()).body;
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(withToken(token))
      .send({ title: 'AI 가 만든 작업' });
    expect(created.status).toBe(201);
    expect(created.body.key).toBe('TOK-1');

    const found = await request(app).get('/api/v1/tasks/key/TOK-1').set(withToken(token));
    expect(found.status).toBe(200);
    expect(found.body.title).toBe('AI 가 만든 작업');
  });

  it('틀린·만료된·폐기된 토큰과 비활성 사용자의 토큰은 401', async () => {
    const wrong = await request(app).get('/api/v1/projects').set(withToken('tpm_nope'));
    expect(wrong.status).toBe(401);

    const { token } = (await issue()).body;
    store.apiTokens[0].expires_at = new Date(Date.now() - 1000);
    expect((await request(app).get('/api/v1/projects').set(withToken(token))).status).toBe(401);

    store.apiTokens[0].expires_at = null;
    store.users[0].is_active = false;
    expect((await request(app).get('/api/v1/projects').set(withToken(token))).status).toBe(401);
  });

  it('읽기 전용 토큰은 GET 만 되고 쓰기는 403 TOKEN_READ_ONLY', async () => {
    const { token } = (await issue({ scope: 'read' })).body;
    expect(
      (await request(app).get(`/api/v1/projects/${projectId}`).set(withToken(token))).status,
    ).toBe(200);
    const w = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(withToken(token))
      .send({ title: 'x' });
    expect(w.status).toBe(403);
    expect(w.body.error.code).toBe('TOKEN_READ_ONLY');
    expect(store.tasks).toHaveLength(0);
  });

  it('계정·토큰 관리·세션 같은 경로는 쓰기 토큰이어도 403 TOKEN_FORBIDDEN', async () => {
    const { token } = (await issue()).body;
    for (const [method, path] of [
      ['get', '/users/me/api-tokens'],
      ['post', '/users/me/api-tokens'],
      ['patch', '/users/me'],
      ['delete', '/users/me'],
      ['get', '/users/me/export'],
      ['get', '/auth/sessions'],
      ['post', '/auth/github/link'],
      ['get', '/notifications'],
      [`get`, `/projects/${projectId}/share-links`],
      [`get`, `/projects/${projectId}/github`],
      ['post', `/projects/${projectId}/members`],
      ['delete', `/projects/${projectId}`],
    ]) {
      const res = await request(app)[method](`/api/v1${path}`).set(withToken(token)).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe('TOKEN_FORBIDDEN');
    }
    expect(store.users[0].is_active).toBe(true);
    // 프로젝트는 그대로
    expect(store.projects).toHaveLength(1);
  });

  it('정책 함수: 허용 경로와 방법의 조합', () => {
    expect(() => assertAllowed('write', 'GET', '/projects/x/members')).not.toThrow();
    expect(() => assertAllowed('write', 'POST', '/projects/x/members')).toThrow();
    expect(() => assertAllowed('write', 'PATCH', '/projects/x')).not.toThrow();
    expect(() => assertAllowed('write', 'DELETE', '/projects/x')).toThrow();
    expect(() => assertAllowed('write', 'DELETE', '/projects/x/tasks')).not.toThrow();
    expect(() => assertAllowed('read', 'GET', '/auth/me')).not.toThrow();
    expect(() => assertAllowed('write', 'GET', '/auth/refresh')).toThrow();
    expect(() => assertAllowed('write', 'GET', '/projectsx')).toThrow();
  });

  it('마지막 사용 시각이 기록된다', async () => {
    const { token } = (await issue()).body;
    expect(store.apiTokens[0].last_used_at).toBeNull();
    await request(app).get('/api/v1/projects').set(withToken(token));
    expect(store.apiTokens[0].last_used_at).toBeInstanceOf(Date);
  });
});

describe('활동 기록에 토큰 이름', () => {
  it('요청 문맥의 토큰 이름이 meta.token 으로 저장된다(값은 없다)', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.resetModules();
    vi.doMock('../config/db.js', () => ({ query, pool: {}, withTransaction: (fn) => fn({}) }));
    const guard = await import('../modules/apiTokens/guard.js');
    const repo = await vi.importActual('../modules/activity/repository.js');

    await guard.tokenContext.run({ name: 'Claude 데스크톱' }, () =>
      repo.insert({ projectId: 'p', actorId: 'u', action: 'task.created', meta: { title: 'a' } }),
    );
    await repo.insert({
      projectId: 'p',
      actorId: 'u',
      action: 'task.created',
      meta: { title: 'a' },
    });
    const [withCtx, without] = query.mock.calls.map((c) => JSON.parse(c[1][4]));
    expect(withCtx).toEqual({ title: 'a', token: 'Claude 데스크톱' });
    expect(without).toEqual({ title: 'a' });
    vi.doUnmock('../config/db.js');
  });
});

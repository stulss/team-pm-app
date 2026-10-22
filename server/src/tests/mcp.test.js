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

let jwt;
let projectId;
let writeToken;
let readToken;

const issue = async (scope) =>
  (
    await request(app)
      .post('/api/v1/users/me/api-tokens')
      .set(bearer(jwt))
      .send({ name: `${scope}-token`, scope })
  ).body.token;

let rpcId = 0;
const rpc = (token, method, params) =>
  request(app)
    .post('/api/mcp')
    .set(bearer(token))
    .send({ jsonrpc: '2.0', id: ++rpcId, method, params });
const call = async (token, name, args) => {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  return { res, out: res.body.result };
};
const parse = (out) => JSON.parse(out.content[0].text);

beforeEach(async () => {
  reset();
  const { res } = await register(app);
  jwt = res.body.accessToken;
  projectId = (
    await request(app).post('/api/v1/projects').set(bearer(jwt)).send({ name: 'MCP', key: 'MCP' })
  ).body.id;
  writeToken = await issue('write');
  readToken = await issue('read');
});

describe('MCP 인증과 프로토콜', () => {
  it('토큰이 없거나 JWT 면 401 이고 GET 은 405', async () => {
    const none = await request(app)
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(none.status).toBe(401);
    expect(none.headers['www-authenticate']).toMatch(/Bearer/);
    expect((await rpc(jwt, 'ping')).status).toBe(401); // 로그인 JWT 는 받지 않는다
    expect((await rpc('tpm_wrong', 'ping')).status).toBe(401);
    const get = await request(app).get('/api/mcp').set(bearer(writeToken));
    expect(get.status).toBe(405);
  });

  it('initialize 는 클라이언트가 보낸 지원 버전으로 답하고 알림은 202', async () => {
    const init = await rpc(writeToken, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 't', version: '1' },
    });
    expect(init.body.result).toMatchObject({
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'team-pm-app' },
    });
    const unknown = await rpc(writeToken, 'initialize', { protocolVersion: '1999-01-01' });
    expect(unknown.body.result.protocolVersion).toBe('2025-06-18');

    const note = await request(app)
      .post('/api/mcp')
      .set(bearer(writeToken))
      .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(note.status).toBe(202);
    expect(note.text).toBe('');
  });

  it('형식이 틀린 요청·배치·모르는 메서드', async () => {
    const batch = await request(app)
      .post('/api/mcp')
      .set(bearer(writeToken))
      .send([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
    expect(batch.status).toBe(400);
    const bad = await request(app).post('/api/mcp').set(bearer(writeToken)).send({ id: 1 });
    expect(bad.status).toBe(400);
    const unknown = await rpc(writeToken, 'resources/list');
    expect(unknown.body.error.code).toBe(-32601);
    expect((await rpc(writeToken, 'ping')).body.result).toEqual({});
  });

  it('tools/list: 읽기 토큰에는 쓰기 도구가 없다', async () => {
    const w = (await rpc(writeToken, 'tools/list')).body.result.tools.map((t) => t.name);
    const r = (await rpc(readToken, 'tools/list')).body.result.tools.map((t) => t.name);
    expect(w).toEqual(
      expect.arrayContaining(['create_task', 'update_task', 'move_task', 'add_comment']),
    );
    expect(r).toContain('list_tasks');
    for (const name of ['create_task', 'update_task', 'move_task', 'add_comment']) {
      expect(r).not.toContain(name);
    }
    const tool = (await rpc(writeToken, 'tools/list')).body.result.tools.find(
      (t) => t.name === 'create_task',
    );
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.required).toEqual(expect.arrayContaining(['project', 'title']));
  });
});

describe('MCP 도구', () => {
  it('작업을 만들고 키로 조회·수정·이동·댓글까지 한다', async () => {
    const created = await call(writeToken, 'create_task', {
      project: projectId,
      title: 'AI 가 만든 작업',
      priority: 'high',
    });
    expect(created.out.isError).toBe(false);
    expect(parse(created.out)).toMatchObject({
      key: 'MCP-1',
      title: 'AI 가 만든 작업',
      priority: 'high',
    });

    const got = await call(readToken, 'get_task', { task: 'mcp-1' });
    expect(parse(got.out).title).toBe('AI 가 만든 작업');

    const upd = await call(writeToken, 'update_task', {
      task: 'MCP-1',
      title: '수정됨',
      dueDate: '2030-01-02',
    });
    expect(parse(upd.out)).toMatchObject({ title: '수정됨', dueDate: '2030-01-02' });

    const mv = await call(writeToken, 'move_task', { task: 'MCP-1', status: 'done' });
    expect(parse(mv.out).status).toBe('done');

    const c = await call(writeToken, 'add_comment', { task: 'MCP-1', body: '안녕하세요' });
    expect(parse(c.out).body).toBe('안녕하세요');
    const comments = await call(readToken, 'list_comments', { task: 'MCP-1' });
    expect(parse(comments.out).data).toHaveLength(1);

    const list = await call(readToken, 'list_tasks', { project: projectId, status: 'done' });
    expect(parse(list.out).data.map((t) => t.key)).toEqual(['MCP-1']);
    const projects = await call(readToken, 'list_projects', {});
    expect(parse(projects.out).data.map((p) => p.key)).toEqual(['MCP']);
    const mine = await call(readToken, 'my_tasks', {});
    expect(mine.out.isError).toBe(false);
  });

  it('읽기 토큰으로 쓰기 도구를 호출하면 서버가 거절한다(데이터 변화 없음)', async () => {
    const { out } = await call(readToken, 'create_task', { project: projectId, title: '몰래' });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/읽기 전용/);
    expect(store.tasks).toHaveLength(0);
  });

  it('인자 검증 오류·없는 도구·없는 작업·남의 프로젝트', async () => {
    const bad = await call(writeToken, 'create_task', { project: 'nope', title: '' });
    expect(bad.out.isError).toBe(true);
    expect(bad.out.content[0].text).toMatch(/인자가 올바르지 않습니다/);

    const none = await rpc(writeToken, 'tools/call', { name: 'drop_database', arguments: {} });
    expect(none.body.error.code).toBe(-32602);

    const missing = await call(writeToken, 'get_task', { task: 'MCP-99' });
    expect(missing.out.isError).toBe(true);

    const weird = await call(writeToken, 'get_task', { task: '../users/me' });
    expect(weird.out.isError).toBe(true);
    expect(weird.out.content[0].text).toMatch(/작업 키/);

    // 다른 사용자의 토큰은 그 사용자가 속하지 않은 프로젝트를 볼 수 없다
    const other = await register(app, { email: 'o@example.com', name: '타인' });
    const otherToken = (
      await request(app)
        .post('/api/v1/users/me/api-tokens')
        .set(bearer(other.res.body.accessToken))
        .send({ name: 'o', scope: 'write' })
    ).body.token;
    const forbidden = await call(otherToken, 'create_task', { project: projectId, title: '침입' });
    expect(forbidden.out.isError).toBe(true);
    expect(store.tasks).toHaveLength(0);
    const empty = await call(otherToken, 'list_projects', {});
    expect(parse(empty.out).data).toEqual([]);
  });

  it('응답 어디에도 토큰 값이 없다', async () => {
    const res = await rpc(writeToken, 'tools/call', { name: 'list_projects', arguments: {} });
    expect(JSON.stringify(res.body)).not.toContain(writeToken);
  });
});

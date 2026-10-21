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
// 상한을 작게 시험하려고 3개로 줄인다.
vi.mock('../modules/dependencies/repository.js', async () => {
  const mem = (await import('./helpers/memoryRepos.js')).dependenciesRepo;
  mem.MAX_BLOCKERS_PER_TASK = 3;
  return { ...(await vi.importActual('../modules/dependencies/repository.js')), ...mem };
});
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const mkTask = async (title, extra = {}, id = pid) =>
  (await api('post', `/projects/${id}/tasks`, 'owner', { title, ...extra })).body;
const link = (task, dependsOn, who = 'alice') =>
  api('post', `/tasks/${task.id}/dependencies`, who, { dependsOnId: dependsOn.id });
const getTask = async (task, who = 'owner') => (await api('get', `/tasks/${task.id}`, who)).body;

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '의존성 프로젝트',
      memberIds: [people.alice.id],
    })
  ).body.id;
});

describe('선행 작업 연결', () => {
  it('연결하면 후행 작업 응답의 blockedBy 에 선행 작업이 실리고, 목록 API 가 양방향을 돌려준다', async () => {
    const a = await mkTask('설계', { dueDate: '2026-10-10' });
    const b = await mkTask('구현');
    const res = await link(b, a);
    expect(res.status).toBe(201);
    expect(res.body.blockedBy).toEqual([
      { id: a.id, title: '설계', status: 'todo', dueDate: '2026-10-10' },
    ]);
    expect(res.body.blocks).toEqual([]);
    expect(res.body.task.blockedBy).toHaveLength(1);

    expect((await getTask(b)).blockedBy.map((x) => x.id)).toEqual([a.id]);
    expect((await getTask(a)).blockedBy).toEqual([]);

    const forA = (await api('get', `/tasks/${a.id}/dependencies`, 'alice')).body;
    expect(forA.blockedBy).toEqual([]);
    expect(forA.blocks.map((x) => x.id)).toEqual([b.id]);
  });

  it('선행 작업 상태가 바뀌면 blockedBy 에 반영된다', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    await link(b, a);
    await api('patch', `/tasks/${a.id}`, 'owner', { status: 'done' });
    expect((await getTask(b)).blockedBy[0].status).toBe('done');
  });

  it('자기 자신·없는 작업·다른 프로젝트 작업은 400', async () => {
    const a = await mkTask('설계');
    const other = (await api('post', '/projects', 'owner', { name: '다른 프로젝트' })).body.id;
    const foreign = await mkTask('외부 작업', {}, other);
    expect((await link(a, a)).status).toBe(400);
    expect((await link(a, foreign)).status).toBe(400);
    expect(
      (
        await api('post', `/tasks/${a.id}/dependencies`, 'alice', {
          dependsOnId: '00000000-0000-4000-8000-000000000000',
        })
      ).status,
    ).toBe(400);
    expect(
      (await api('post', `/tasks/${a.id}/dependencies`, 'alice', { dependsOnId: 'x' })).status,
    ).toBe(400);
    expect((await getTask(a)).blockedBy).toEqual([]);
  });

  it('같은 연결을 두 번 만들면 409 DEPENDENCY_EXISTS', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    await link(b, a);
    const dup = await link(b, a);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DEPENDENCY_EXISTS');
  });

  it('순환은 직접·간접 모두 409 DEPENDENCY_CYCLE', async () => {
    const [a, b, c] = [await mkTask('A'), await mkTask('B'), await mkTask('C')];
    expect((await link(b, a)).status).toBe(201); // B 는 A 를 기다림
    expect((await link(c, b)).status).toBe(201); // C 는 B 를 기다림
    const direct = await link(a, b); // A 가 B 를 기다리면 A↔B 순환
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe('DEPENDENCY_CYCLE');
    const indirect = await link(a, c); // A→C→B→A
    expect(indirect.status).toBe(409);
    expect(indirect.body.error.code).toBe('DEPENDENCY_CYCLE');
    expect((await getTask(a)).blockedBy).toEqual([]);
    // 순환이 아닌 다이아몬드 모양은 허용
    const d = await mkTask('D');
    expect((await link(d, a)).status).toBe(201);
    expect((await link(d, c)).status).toBe(201);
  });

  it('작업당 선행 작업 상한을 넘으면 409 LIMIT_REACHED', async () => {
    const target = await mkTask('대상');
    for (const n of ['1', '2', '3']) expect((await link(target, await mkTask(n))).status).toBe(201);
    const over = await link(target, await mkTask('4'));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });

  it('비멤버는 403, 인증 없으면 401', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    expect((await link(b, a, 'outsider')).status).toBe(403);
    expect((await api('get', `/tasks/${a.id}/dependencies`, 'outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/tasks/${a.id}/dependencies`)).status).toBe(401);
    expect((await api('get', `/tasks/${a.id}/dependencies`, 'admin')).status).toBe(200);
  });
});

describe('연결 해제와 정리', () => {
  it('해제하면 blockedBy 에서 빠지고, 없는 연결은 404', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    await link(b, a);
    const res = await api('delete', `/tasks/${b.id}/dependencies/${a.id}`, 'alice');
    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toEqual([]);
    expect((await getTask(b)).blockedBy).toEqual([]);
    expect((await api('delete', `/tasks/${b.id}/dependencies/${a.id}`, 'alice')).status).toBe(404);
  });

  it('선행 작업을 지우면 연결도 사라진다', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    await link(b, a);
    await api('delete', `/tasks/${a.id}`, 'owner');
    expect((await getTask(b)).blockedBy).toEqual([]);
  });

  it('연결·해제는 task:updated 로 퍼진다', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    emitToProject.mockClear();
    await link(b, a);
    await api('delete', `/tasks/${b.id}/dependencies/${a.id}`, 'alice');
    const updates = emitToProject.mock.calls.filter((c) => c[2] === 'task:updated');
    expect(updates).toHaveLength(2);
    expect(updates[0][3].task.blockedBy).toHaveLength(1);
    expect(updates[1][3].task.blockedBy).toHaveLength(0);
  });

  it('보관된 프로젝트는 읽기 전용(409), 읽기는 가능', async () => {
    const a = await mkTask('설계');
    const b = await mkTask('구현');
    const c = await mkTask('검수');
    await link(b, a);
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    for (const res of [link(c, a), api('delete', `/tasks/${b.id}/dependencies/${a.id}`, 'alice')]) {
      const r = await res;
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('PROJECT_ARCHIVED');
    }
    expect((await api('get', `/tasks/${b.id}/dependencies`, 'alice')).body.blockedBy).toHaveLength(
      1,
    );
  });
});

describe('시작일', () => {
  it('작업을 만들고 고칠 때 startDate 를 받고 응답·변경 이력에 반영된다', async () => {
    const t = await mkTask('기간 작업', { startDate: '2026-10-05', dueDate: '2026-10-09' });
    expect(t).toMatchObject({ startDate: '2026-10-05', dueDate: '2026-10-09' });
    const patched = await api('patch', `/tasks/${t.id}`, 'alice', { startDate: '2026-10-06' });
    expect(patched.body.startDate).toBe('2026-10-06');
    const cleared = await api('patch', `/tasks/${t.id}`, 'alice', { startDate: null });
    expect(cleared.body.startDate).toBeNull();
    const history = (await api('get', `/projects/${pid}/activities?taskId=${t.id}`, 'owner')).body
      .data;
    expect(history.some((h) => h.meta?.changes?.startDate)).toBe(true);
  });

  it('시작일이 마감일보다 늦으면 400 (한쪽만 바꿔도 현재 값과 비교)', async () => {
    expect(
      (
        await api('post', `/projects/${pid}/tasks`, 'owner', {
          title: 'x',
          startDate: '2026-10-10',
          dueDate: '2026-10-09',
        })
      ).status,
    ).toBe(400);
    const t = await mkTask('기간 작업', { startDate: '2026-10-05', dueDate: '2026-10-09' });
    expect(
      (await api('patch', `/tasks/${t.id}`, 'alice', { startDate: '2026-10-10' })).status,
    ).toBe(400);
    expect((await api('patch', `/tasks/${t.id}`, 'alice', { dueDate: '2026-10-04' })).status).toBe(
      400,
    );
    expect(
      (await api('patch', `/tasks/${t.id}`, 'alice', { startDate: '2026-10-09' })).status,
    ).toBe(200);
    expect(
      (await api('patch', `/tasks/${t.id}`, 'alice', { startDate: '10/01/2026' })).status,
    ).toBe(400);
    // 마감일이 없으면 시작일만으로도 된다
    expect((await mkTask('시작만', { startDate: '2026-12-01' })).startDate).toBe('2026-12-01');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset, activityRepo } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';

// 기록 저장 실패를 흉내 내는 스위치(목 모듈이 함수를 복사해 가므로 spyOn 으로는 서비스에 닿지 않는다)
const activityDb = vi.hoisted(() => ({ fail: false }));

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
vi.mock('../modules/activity/repository.js', async () => {
  const memory = (await import('./helpers/memoryRepos.js')).activityRepo;
  return {
    ...(await vi.importActual('../modules/activity/repository.js')),
    ...memory,
    insert: (input) =>
      activityDb.fail ? Promise.reject(new Error('db down')) : memory.insert(input),
  };
});

vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(비멤버), owner(소유자), member(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const feed = async (who = 'owner', qs = '') =>
  (await api('get', `/projects/${pid}/activities${qs}`, who)).body;
const actions = async (qs = '') => (await feed('owner', qs)).data.map((a) => a.action);

beforeEach(async () => {
  reset();
  activityDb.fail = false;
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
    name: '웹사이트 리뉴얼',
    memberIds: [people.member.id],
  });
  pid = created.body.id;
});

describe('GET /projects/:id/activities — 접근 권한', () => {
  it('멤버와 Admin 은 볼 수 있고 비멤버는 403, 인증 없으면 401', async () => {
    expect((await api('get', `/projects/${pid}/activities`, 'owner')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/activities`, 'member')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/activities`, 'admin')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/activities`, 'outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/activities`)).status).toBe(401);
  });

  it('멤버에서 제거되면 더는 볼 수 없다', async () => {
    await api('delete', `/projects/${pid}/members/${people.member.id}`, 'owner');
    expect((await api('get', `/projects/${pid}/activities`, 'member')).status).toBe(403);
  });

  it('잘못된 쿼리는 400', async () => {
    for (const qs of ['?limit=0', '?limit=201', '?before=abc', '?taskId=x', '?action=nope']) {
      expect((await api('get', `/projects/${pid}/activities${qs}`, 'owner')).status, qs).toBe(400);
    }
  });
});

describe('프로젝트·멤버 기록', () => {
  it('프로젝트 생성이 첫 기록이다 (최신순이므로 마지막)', async () => {
    const { data } = await feed();
    const last = data[data.length - 1];
    expect(last).toMatchObject({
      action: 'project.created',
      actor: { id: people.owner.id, name: '소유자' },
      meta: { name: '웹사이트 리뉴얼' },
    });
  });

  it('이름·상태 변경만 기록하고, 설명만 바꾸면 기록하지 않는다', async () => {
    await api('patch', `/projects/${pid}`, 'owner', { description: '설명만' });
    expect(await actions('?action=project.updated')).toHaveLength(0);

    await api('patch', `/projects/${pid}`, 'owner', { name: '새 이름', status: 'archived' });
    const { data } = await feed('owner', '?action=project.updated');
    expect(data).toHaveLength(1);
    expect(data[0].meta.changes).toEqual({
      name: { from: '웹사이트 리뉴얼', to: '새 이름' },
      status: { from: 'active', to: 'archived' },
    });
  });

  it('멤버 추가·제거를 이름과 함께 기록하고, 이후 이름이 바뀌어도 기록은 그대로다', async () => {
    await api('post', `/projects/${pid}/members`, 'owner', { userId: people.outsider.id });
    await api('delete', `/projects/${pid}/members/${people.outsider.id}`, 'owner');
    const { data } = await feed();
    expect(data[0]).toMatchObject({ action: 'member.removed', meta: { user: { name: '외부인' } } });
    expect(data[1]).toMatchObject({ action: 'member.added', meta: { user: { name: '외부인' } } });
    store.users.find((u) => u.id === people.outsider.id).name = '개명함';
    expect((await feed()).data[0].meta.user.name).toBe('외부인');
  });
});

describe('작업 기록', () => {
  const createTask = (who = 'member', body = {}) =>
    api('post', `/projects/${pid}/tasks`, who, { title: '로그인 화면', ...body });

  it('생성·삭제를 기록하고 삭제된 작업의 이전 기록도 남는다', async () => {
    const task = (await createTask('member', { assigneeId: people.owner.id })).body;
    await api('delete', `/tasks/${task.id}`, 'member');
    const { data } = await feed();
    expect(data[0]).toMatchObject({
      action: 'task.deleted',
      taskId: task.id,
      actor: { name: '멤버' },
      meta: { title: '로그인 화면' },
    });
    expect(data[1]).toMatchObject({
      action: 'task.created',
      meta: { title: '로그인 화면', status: 'todo', assignee: { name: '소유자' } },
    });
  });

  it('수정은 바뀐 항목만 {from,to} 로 기록하고, 아무것도 안 바뀌면 기록하지 않는다', async () => {
    const task = (await createTask()).body;
    await api('patch', `/tasks/${task.id}`, 'member', {
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-12-01',
      assigneeId: people.owner.id,
      title: '로그인 화면 v2',
      description: '비밀 설명 내용',
    });
    const [entry] = (await feed()).data;
    expect(entry.action).toBe('task.updated');
    expect(entry.meta.title).toBe('로그인 화면 v2');
    expect(entry.meta.changes).toEqual({
      title: { from: '로그인 화면', to: '로그인 화면 v2' },
      status: { from: 'todo', to: 'in_progress' },
      priority: { from: 'medium', to: 'high' },
      dueDate: { from: null, to: '2026-12-01' },
      assignee: { from: null, to: { id: people.owner.id, name: '소유자' } },
      description: true, // 내용은 남기지 않는다
    });
    expect(JSON.stringify(entry)).not.toContain('비밀 설명 내용');

    const before = store.activities.length;
    await api('patch', `/tasks/${task.id}`, 'member', { priority: 'high' }); // 변화 없음
    expect(store.activities).toHaveLength(before);
  });

  it('담당자를 해제하면 to 가 null 이다', async () => {
    const task = (await createTask('member', { assigneeId: people.owner.id })).body;
    await api('patch', `/tasks/${task.id}`, 'member', { assigneeId: null });
    const [entry] = (await feed()).data;
    expect(entry.meta.changes.assignee).toEqual({
      from: { id: people.owner.id, name: '소유자' },
      to: null,
    });
  });

  it('이동은 컬럼이 바뀔 때만 기록하고 같은 컬럼 안의 순서 변경은 기록하지 않는다', async () => {
    const a = (await createTask('member', { title: 'A' })).body;
    await createTask('member', { title: 'B' });
    const before = store.activities.length;
    await api('patch', `/tasks/${a.id}/move`, 'member', { status: 'todo' }); // 같은 컬럼
    expect(store.activities).toHaveLength(before);

    await api('patch', `/tasks/${a.id}/move`, 'member', { status: 'done' });
    const [entry] = (await feed()).data;
    expect(entry).toMatchObject({
      action: 'task.moved',
      taskId: a.id,
      meta: { title: 'A', from: 'todo', to: 'done' },
    });
  });

  it('taskId 로 한 작업의 이력만 볼 수 있다', async () => {
    const a = (await createTask('member', { title: 'A' })).body;
    const b = (await createTask('member', { title: 'B' })).body;
    await api('patch', `/tasks/${a.id}`, 'member', { priority: 'urgent' });
    const onlyA = (await feed('owner', `?taskId=${a.id}`)).data;
    expect(onlyA.map((x) => x.action)).toEqual(['task.updated', 'task.created']);
    expect(onlyA.every((x) => x.taskId === a.id)).toBe(true);
    expect((await feed('owner', `?taskId=${b.id}`)).data).toHaveLength(1);
  });

  it('다른 프로젝트의 기록은 보이지 않는다', async () => {
    const other = (await api('post', '/projects', 'outsider', { name: '남의 프로젝트' })).body;
    await api('post', `/projects/${other.id}/tasks`, 'outsider', { title: '비밀 작업' });
    const data = (await feed()).data;
    expect(JSON.stringify(data)).not.toContain('비밀 작업');
    expect(data.every((a) => a.action !== 'task.created')).toBe(true);
  });
});

describe('댓글 기록', () => {
  it('작성·삭제를 기록하지만 본문은 저장하지 않고, 수정은 기록하지 않는다', async () => {
    const task = (await api('post', `/projects/${pid}/tasks`, 'member', { title: '댓글 작업' }))
      .body;
    const comment = (
      await api('post', `/tasks/${task.id}/comments`, 'member', { body: '민감한 댓글 본문' })
    ).body;
    await api('patch', `/comments/${comment.id}`, 'member', { body: '수정된 본문' });
    await api('delete', `/comments/${comment.id}`, 'owner');
    const data = (await feed()).data;
    expect(data[0]).toMatchObject({
      action: 'comment.deleted',
      taskId: task.id,
      actor: { name: '소유자' },
      meta: { taskTitle: '댓글 작업' },
    });
    expect(data[1]).toMatchObject({ action: 'comment.created', meta: { taskTitle: '댓글 작업' } });
    expect(data.filter((a) => a.action.startsWith('comment'))).toHaveLength(2);
    const dump = JSON.stringify(store.activities);
    expect(dump).not.toContain('민감한 댓글 본문');
    expect(dump).not.toContain('수정된 본문');
  });
});

describe('페이지네이션과 보관', () => {
  it('limit 와 before 커서로 중복·누락 없이 끝까지 읽힌다', async () => {
    for (let i = 0; i < 7; i += 1) {
      await api('post', `/projects/${pid}/tasks`, 'member', { title: `작업 ${i}` });
    }
    const all = [];
    let cursor;
    let pages = 0;
    do {
      const page = await feed('owner', `?limit=3${cursor ? `&before=${cursor}` : ''}`);
      expect(page.data.length).toBeLessThanOrEqual(3);
      all.push(...page.data);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(all).toHaveLength(8); // 프로젝트 생성 1 + 작업 7
    expect(new Set(all.map((a) => a.id)).size).toBe(8);
    expect(all.map((a) => a.seq)).toEqual([...all.map((a) => a.seq)].sort((x, y) => y - x));
    expect(pages).toBe(3);
  });

  it('마지막 페이지의 nextCursor 는 null', async () => {
    expect((await feed()).nextCursor).toBeNull();
  });

  it('180일이 지난 기록은 정리 작업이 지운다', async () => {
    await api('post', `/projects/${pid}/tasks`, 'member', { title: '최근' });
    store.activities[0].created_at = new Date(Date.now() - 200 * 86400_000);
    const deleted = await activityRepo.deleteOlderThan(activityRepo.RETENTION_DAYS);
    expect(deleted).toBe(1);
    expect(store.activities).toHaveLength(1);
  });
});

describe('실시간', () => {
  it('기록을 저장한 뒤 activity:created 를 요청자 포함 전원에게 보낸다', async () => {
    emitToProject.mockClear();
    const task = (await api('post', `/projects/${pid}/tasks`, 'member', { title: '알림' })).body;
    const calls = emitToProject.mock.calls;
    const events = calls.map((c) => c[2]);
    expect(events).toContain('task:created');
    const activityCall = calls.find((c) => c[2] === 'activity:created');
    expect(activityCall).toBeTruthy();
    expect(activityCall[0]).toBeNull(); // 요청자 소켓도 제외하지 않는다
    expect(activityCall[1]).toBe(pid);
    expect(activityCall[3]).toEqual({ projectId: pid, taskId: task.id });
    // 작업 이벤트가 기록 이벤트보다 먼저 나간다(실시간 지연을 늘리지 않음)
    expect(events.indexOf('task:created')).toBeLessThan(events.indexOf('activity:created'));
  });

  it('기록 저장이 실패하면 activity:created 를 보내지 않는다', async () => {
    activityDb.fail = true;
    emitToProject.mockClear();
    const res = await api('post', `/projects/${pid}/tasks`, 'member', { title: '실패' });
    expect(res.status).toBe(201);
    const events = emitToProject.mock.calls.map((c) => c[2]);
    expect(events).toContain('task:created');
    expect(events).not.toContain('activity:created');
  });
});

describe('기록 실패', () => {
  it('기록 저장이 실패해도 본 요청은 성공한다', async () => {
    activityDb.fail = true;
    const res = await api('post', `/projects/${pid}/tasks`, 'member', { title: '실패해도 성공' });
    expect(res.status).toBe(201);
    expect(store.tasks.some((t) => t.title === '실패해도 성공')).toBe(true);
    expect(store.activities.some((a) => a.meta?.title === '실패해도 성공')).toBe(false);
  });
});

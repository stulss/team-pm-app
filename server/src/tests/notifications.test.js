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
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).activityRepo,
}));
vi.mock('../modules/chat/repository.js', async () => ({
  ...(await vi.importActual('../modules/chat/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).chatRepo,
}));
vi.mock('../modules/share/repository.js', async () => ({
  ...(await vi.importActual('../modules/share/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).shareRepo,
}));
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));

const { app } = await import('../app.js');
const { todayIn } = await import('../modules/notifications/service.js');

const CRON_SECRET = 'test-cron-secret-0123456789';

// admin, manager(소유자), member, member2, outsider
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const addDays = (n) => {
  const d = new Date(`${todayIn()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const createTask = (who, body = {}) =>
  request(app)
    .post(`/api/v1/projects/${pid}/tasks`)
    .set(as(who))
    .send({ title: 'API 문서화', ...body });
const patchTask = (who, id, body) =>
  request(app).patch(`/api/v1/tasks/${id}`).set(as(who)).send(body);
const comment = (who, taskId, body = '확인 부탁') =>
  request(app).post(`/api/v1/tasks/${taskId}/comments`).set(as(who)).send({ body });
const mine = (who, qs = '') => request(app).get(`/api/v1/notifications${qs}`).set(as(who));
const runCron = () =>
  request(app).get('/api/cron/daily').set('Authorization', `Bearer ${CRON_SECRET}`);

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
  const project = await request(app)
    .post('/api/v1/projects')
    .set(as('manager'))
    .send({ name: '알림', memberIds: [people.member.id, people.member2.id] });
  pid = project.body.id;
});

describe('task_assigned', () => {
  it('작업을 만들며 담당자를 지정하면 담당자에게 알림이 간다', async () => {
    const task = (await createTask('manager', { assigneeId: people.member.id })).body;
    const res = await mine('member');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      type: 'task_assigned',
      taskId: task.id,
      projectId: pid,
      actor: { id: people.manager.id, name: '매니저' },
      message: "매니저님이 'API 문서화' 작업을 배정했습니다.",
      isRead: false,
    });
  });

  it('본인에게 지정하거나 담당자가 없으면 알림이 없다', async () => {
    await createTask('member', { assigneeId: people.member.id });
    await createTask('manager');
    expect(store.notifications).toHaveLength(0);
  });

  it('담당자를 바꿀 때만 새 담당자에게 알린다 (같은 담당자/해제/본인 지정 제외)', async () => {
    const id = (await createTask('manager', { assigneeId: people.member.id })).body.id;
    store.notifications.length = 0;

    await patchTask('manager', id, { title: '제목만 변경' });
    await patchTask('manager', id, { assigneeId: people.member.id });
    expect(store.notifications).toHaveLength(0);

    await patchTask('manager', id, { assigneeId: people.member2.id });
    expect(store.notifications.map((n) => n.user_id)).toEqual([people.member2.id]);

    await patchTask('manager', id, { assigneeId: null });
    await patchTask('member2', id, { assigneeId: people.member2.id });
    expect(store.notifications).toHaveLength(1);
  });
});

describe('comment_added', () => {
  let task;
  beforeEach(async () => {
    task = (await createTask('manager', { assigneeId: people.member.id })).body;
    store.notifications.length = 0;
  });

  it('담당자와 작성자에게 가고 댓글 작성자 본인은 제외된다', async () => {
    await comment('member2', task.id);
    expect(store.notifications.map((n) => n.user_id).sort()).toEqual(
      [people.manager.id, people.member.id].sort(),
    );
    expect(store.notifications[0].message).toBe("멤버2님이 'API 문서화' 작업에 댓글을 남겼습니다.");

    store.notifications.length = 0;
    await comment('member', task.id); // 담당자가 쓰면 작성자(manager)에게만
    expect(store.notifications.map((n) => n.user_id)).toEqual([people.manager.id]);
  });

  it('프로젝트를 떠났거나 비활성인 사람에게는 가지 않는다', async () => {
    await request(app)
      .delete(`/api/v1/projects/${pid}/members/${people.member.id}`)
      .set(as('manager'));
    store.users.find((u) => u.id === people.manager.id).is_active = false;
    await comment('member2', task.id);
    expect(store.notifications).toHaveLength(0);
  });

  it('댓글 작성이 실패하면(비멤버) 알림도 없다', async () => {
    expect((await comment('outsider', task.id)).status).toBe(403);
    expect(store.notifications).toHaveLength(0);
  });
});

describe('알림 API', () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i += 1) {
      await createTask('manager', { title: `작업 ${i}`, assigneeId: people.member.id });
    }
  });

  it('본인 알림만 최신순으로 보이고 인증이 필요하다', async () => {
    const res = await mine('member');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3 });
    expect(res.body.data[0].message).toContain('작업 2');
    expect((await mine('member2')).body.data).toEqual([]);
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });

  it('unread-count, 개별 읽음, ?unread=true, 전체 읽음', async () => {
    const count = () =>
      request(app)
        .get('/api/v1/notifications/unread-count')
        .set(as('member'))
        .then((r) => r.body.count);
    expect(await count()).toBe(3);

    const first = (await mine('member')).body.data[0];
    const read = await request(app)
      .patch(`/api/v1/notifications/${first.id}/read`)
      .set(as('member'));
    expect(read.status).toBe(204);
    expect(await count()).toBe(2);
    expect((await mine('member', '?unread=true')).body.data).toHaveLength(2);
    expect((await mine('member', '?unread=false')).body.data).toHaveLength(3);

    const all = await request(app).post('/api/v1/notifications/read-all').set(as('member'));
    expect(all.body).toEqual({ updated: 2 });
    expect(await count()).toBe(0);
  });

  it('남의 알림은 읽음 처리할 수 없고(404) 상태도 바뀌지 않는다', async () => {
    const first = (await mine('member')).body.data[0];
    const res = await request(app)
      .patch(`/api/v1/notifications/${first.id}/read`)
      .set(as('member2'));
    expect(res.status).toBe(404);
    expect(store.notifications.find((n) => n.id === first.id).is_read).toBe(false);
    expect(
      (await request(app).patch('/api/v1/notifications/abc/read').set(as('member'))).status,
    ).toBe(400);
  });

  it('read-all 은 본인 알림만 바꾼다', async () => {
    await createTask('manager', { assigneeId: people.member2.id });
    await request(app).post('/api/v1/notifications/read-all').set(as('member'));
    expect(store.notifications.filter((n) => n.user_id === people.member2.id)[0].is_read).toBe(
      false,
    );
  });

  it('페이지네이션', async () => {
    const res = await mine('member', '?limit=2&page=2');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3 });
    expect((await mine('member', '?limit=500')).status).toBe(400);
  });

  it('작업을 삭제하면 알림도 사라진다', async () => {
    const first = (await mine('member')).body.data[0];
    await request(app).delete(`/api/v1/tasks/${first.taskId}`).set(as('manager'));
    expect((await mine('member')).body.data).toHaveLength(2);
  });
});

describe('GET /api/cron/daily', () => {
  it('인증 없이/잘못된 비밀로는 401', async () => {
    expect((await request(app).get('/api/cron/daily')).status).toBe(401);
    const bad = await request(app).get('/api/cron/daily').set('Authorization', 'Bearer wrong');
    expect(bad.status).toBe(401);
    expect(store.notifications).toHaveLength(0);
  });

  it('오늘·내일 마감은 임박, 어제까지는 지연 알림 — 대상이 아닌 작업은 제외', async () => {
    const dueToday = (
      await createTask('manager', {
        title: '오늘',
        assigneeId: people.member.id,
        dueDate: addDays(0),
      })
    ).body;
    await createTask('manager', {
      title: '내일',
      assigneeId: people.member.id,
      dueDate: addDays(1),
    });
    await createTask('manager', {
      title: '모레',
      assigneeId: people.member.id,
      dueDate: addDays(2),
    });
    await createTask('manager', {
      title: '어제',
      assigneeId: people.member2.id,
      dueDate: addDays(-1),
    });
    await createTask('manager', {
      title: '완료',
      assigneeId: people.member.id,
      dueDate: addDays(-1),
      status: 'done',
    });
    await createTask('manager', { title: '미배정', dueDate: addDays(-1) });
    await createTask('manager', { title: '마감 없음', assigneeId: people.member.id });
    store.notifications.length = 0;

    const res = await runCron();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ today: todayIn(), dueSoon: 2, overdue: 1 });

    const byTitle = Object.fromEntries(
      store.notifications.map((n) => [store.tasks.find((t) => t.id === n.task_id).title, n]),
    );
    expect(Object.keys(byTitle).sort()).toEqual(['내일', '어제', '오늘']);
    expect(byTitle['오늘']).toMatchObject({
      type: 'due_soon',
      user_id: people.member.id,
      actor_id: null,
    });
    expect(byTitle['오늘'].message).toBe("'오늘' 마감이 오늘입니다.");
    expect(byTitle['내일'].message).toBe("'내일' 마감이 내일입니다.");
    expect(byTitle['어제']).toMatchObject({ type: 'task_overdue', user_id: people.member2.id });
    expect(byTitle['어제'].message).toContain(addDays(-1));
    expect(dueToday.id).toBeTruthy();
  });

  it('두 번 실행해도 같은 작업은 한 번만 알린다 (중복 방지)', async () => {
    await createTask('manager', { assigneeId: people.member.id, dueDate: addDays(0) });
    store.notifications.length = 0;
    expect((await runCron()).body.dueSoon).toBe(1);
    expect((await runCron()).body).toMatchObject({ dueSoon: 0, overdue: 0 });
    expect(store.notifications).toHaveLength(1);
  });

  it('마감일을 바꾸면 다시 알릴 수 있다', async () => {
    const id = (await createTask('manager', { assigneeId: people.member.id, dueDate: addDays(1) }))
      .body.id;
    store.notifications.length = 0;
    await runCron();
    expect(store.notifications).toHaveLength(1);

    await patchTask('manager', id, { dueDate: addDays(0) });
    store.notifications.length = 0;
    expect((await runCron()).body.dueSoon).toBe(1);
  });

  it('임박 알림을 받은 작업이 지나면 지연 알림도 따로 한 번 간다', async () => {
    const id = (await createTask('manager', { assigneeId: people.member.id, dueDate: addDays(0) }))
      .body.id;
    store.notifications.length = 0;
    await runCron();
    // 마감일이 지났다고 가정: 같은 작업의 마감일 값만 과거로 (알림 표시 컬럼은 그대로)
    store.tasks.find((t) => t.id === id).due_date = addDays(-1);
    const res = await runCron();
    expect(res.body).toMatchObject({ dueSoon: 0, overdue: 1 });
    expect(store.notifications.map((n) => n.type)).toEqual(['due_soon', 'task_overdue']);
  });

  it('보관된 프로젝트·비활성/제거된 담당자의 작업은 알리지 않는다', async () => {
    const a = (await createTask('manager', { assigneeId: people.member.id, dueDate: addDays(0) }))
      .body;
    await createTask('manager', { assigneeId: people.member2.id, dueDate: addDays(0) });
    store.users.find((u) => u.id === people.member2.id).is_active = false;
    store.notifications.length = 0;
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    expect((await runCron()).body).toMatchObject({ dueSoon: 0, overdue: 0 });

    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'active' });
    expect((await runCron()).body.dueSoon).toBe(1); // member2(비활성) 제외, member 만
    expect(store.notifications[0].task_id).toBe(a.id);
  });

  it('90일이 지난 알림은 정리한다', async () => {
    await createTask('manager', { assigneeId: people.member.id });
    store.notifications[0].created_at = new Date(Date.now() - 100 * 86_400_000);
    await createTask('manager', { title: '최근', assigneeId: people.member.id });
    const res = await runCron();
    expect(res.body.notificationsDeleted).toBe(1);
    expect(store.notifications).toHaveLength(1);
  });
});

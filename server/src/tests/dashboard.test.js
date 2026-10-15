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
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));
vi.mock('../modules/dashboard/repository.js', async () => ({
  ...(await vi.importActual('../modules/dashboard/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).dashboardRepo,
}));

const { app } = await import('../app.js');
const { weekEndOf, percentOf } = await import('../modules/dashboard/service.js');
const { todayIn } = await import('../modules/notifications/service.js');

const addDays = (n) => {
  const d = new Date(`${todayIn()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('weekEndOf / percentOf', () => {
  it('이번 주 끝은 그 주의 일요일 (일요일이면 오늘)', () => {
    expect(weekEndOf('2026-10-12')).toBe('2026-10-18'); // 월
    expect(weekEndOf('2026-10-14')).toBe('2026-10-18'); // 수
    expect(weekEndOf('2026-10-17')).toBe('2026-10-18'); // 토
    expect(weekEndOf('2026-10-18')).toBe('2026-10-18'); // 일
    expect(weekEndOf('2026-12-30')).toBe('2027-01-03'); // 연말 경계
  });

  it('진행률은 소수 첫째 자리까지, 작업이 없으면 0', () => {
    expect(percentOf(9, 24)).toBe(37.5);
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(2, 3)).toBe(66.7);
    expect(percentOf(3, 3)).toBe(100);
    expect(percentOf(0, 0)).toBe(0);
  });
});

// admin, manager(소유), manager2(다른 프로젝트 소유), member, outsider
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let otherPid;

const createTask = (who, body, project = pid) =>
  request(app)
    .post(`/api/v1/projects/${project}/tasks`)
    .set(as(who))
    .send({ title: '작업', ...body });
const projectDash = (who, id = pid) =>
  request(app).get(`/api/v1/projects/${id}/dashboard`).set(as(who));
const overall = (who) => request(app).get('/api/v1/dashboard').set(as(who));

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['manager', '매니저'],
    ['manager2', '매니저2'],
    ['member', '멤버'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  for (const k of ['manager', 'manager2']) {
    store.users.find((u) => u.id === people[k].id).role = 'manager';
  }
  pid = (
    await request(app)
      .post('/api/v1/projects')
      .set(as('manager'))
      .send({ name: '프로젝트 A', memberIds: [people.member.id] })
  ).body.id;
  otherPid = (
    await request(app).post('/api/v1/projects').set(as('manager2')).send({ name: '프로젝트 B' })
  ).body.id;
});

describe('GET /projects/:id/dashboard', () => {
  it('작업이 없으면 모두 0 이고 진행률은 0%', async () => {
    const res = await projectDash('member');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projectId: pid,
      progress: { total: 0, done: 0, percent: 0 },
      byStatus: { todo: 0, in_progress: 0, review: 0, done: 0 },
      overdue: { count: 0, tasks: [] },
      dueThisWeek: 0,
      byAssignee: [],
    });
  });

  describe('데이터가 있을 때', () => {
    beforeEach(async () => {
      const m = people.member.id;
      const mg = people.manager.id;
      // todo 3, in_progress 1, review 1, done 3  → 전체 8, 완료 3 (37.5%)
      await createTask('manager', { title: 'T1', assigneeId: m, dueDate: addDays(-5) }); // 지연
      await createTask('manager', { title: 'T2', assigneeId: m, dueDate: addDays(-1) }); // 지연
      await createTask('manager', { title: 'T3', dueDate: addDays(0) }); // 오늘(이번 주)
      await createTask('manager', {
        title: 'P1',
        status: 'in_progress',
        assigneeId: mg,
        dueDate: addDays(30),
      });
      await createTask('manager', { title: 'R1', status: 'review', assigneeId: m });
      await createTask('manager', {
        title: 'D1',
        status: 'done',
        assigneeId: m,
        dueDate: addDays(-9),
      }); // 완료는 지연 아님
      await createTask('manager', { title: 'D2', status: 'done', assigneeId: mg });
      await createTask('manager', { title: 'D3', status: 'done' });
    });

    it('진행률·상태별 개수가 실제 데이터와 일치한다', async () => {
      const res = await projectDash('member');
      expect(res.body.progress).toEqual({ total: 8, done: 3, percent: 37.5 });
      expect(res.body.byStatus).toEqual({ todo: 3, in_progress: 1, review: 1, done: 3 });
    });

    it('지연 작업: 마감일 < 오늘 이면서 미완료만, 오래된 순', async () => {
      const res = await projectDash('member');
      expect(res.body.overdue.count).toBe(2);
      expect(res.body.overdue.tasks.map((t) => t.title)).toEqual(['T1', 'T2']);
      expect(res.body.overdue.tasks[0]).toMatchObject({
        dueDate: addDays(-5),
        assignee: { id: people.member.id, name: '멤버' },
      });
    });

    it('이번 주 마감 예정: 오늘 포함, 지연·완료·이후 작업 제외', async () => {
      const res = await projectDash('member');
      // T3(오늘)만. T1·T2 는 지연, P1 은 30일 뒤, D1 은 완료
      expect(res.body.dueThisWeek).toBe(1);
    });

    it('담당자별 미완료 수(미배정 포함), 많은 순, 동점이면 미배정이 마지막', async () => {
      const res = await projectDash('member');
      expect(res.body.byAssignee).toEqual([
        { userId: people.member.id, name: '멤버', open: 3 }, // T1, T2, R1
        { userId: people.manager.id, name: '매니저', open: 1 }, // P1
        { userId: null, name: '미배정', open: 1 }, // T3 — 동점이면 미배정은 마지막
      ]);
    });

    it('지연 목록은 최대 10건이지만 count 는 전체 수', async () => {
      for (let i = 0; i < 12; i += 1) {
        await createTask('manager', { title: `L${i}`, dueDate: addDays(-20 - i) });
      }
      const res = await projectDash('member');
      expect(res.body.overdue.count).toBe(14);
      expect(res.body.overdue.tasks).toHaveLength(10);
    });
  });

  it('권한: 멤버와 Admin 만, 비멤버 403, 없는 프로젝트 404, 인증 없으면 401', async () => {
    expect((await projectDash('member')).status).toBe(200);
    expect((await projectDash('admin')).status).toBe(200);
    expect((await projectDash('outsider')).status).toBe(403);
    expect((await projectDash('member', crypto.randomUUID())).status).toBe(404);
    expect((await request(app).get(`/api/v1/projects/${pid}/dashboard`)).status).toBe(401);
  });

  it('보관된 프로젝트의 대시보드도 볼 수 있다', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    expect((await projectDash('member')).status).toBe(200);
  });
});

describe('GET /dashboard (내 전체 요약)', () => {
  beforeEach(async () => {
    await createTask('manager', { title: 'A1', status: 'done', assigneeId: people.member.id });
    await createTask('manager', {
      title: 'A2',
      assigneeId: people.member.id,
      dueDate: addDays(-2),
    });
    await createTask('manager2', { title: 'B1', dueDate: addDays(-3) }, otherPid);
    await createTask('manager2', { title: 'B2', status: 'done' }, otherPid);
  });

  it('소속 프로젝트만 합산하고 프로젝트별 진행률을 준다', async () => {
    const res = await overall('member');
    expect(res.status).toBe(200);
    expect(res.body.progress).toEqual({ total: 2, done: 1, percent: 50 });
    expect(res.body.myOpen).toBe(1);
    expect(res.body.overdue.tasks.map((t) => t.title)).toEqual(['A2']);
    expect(res.body.overdue.tasks[0]).toMatchObject({ projectId: pid, projectName: '프로젝트 A' });
    expect(res.body.projects).toEqual([
      { id: pid, name: '프로젝트 A', total: 2, done: 1, percent: 50, overdue: 1 },
    ]);
  });

  it('Admin 은 모든 프로젝트를 합산한다', async () => {
    const res = await overall('admin');
    expect(res.body.progress).toEqual({ total: 4, done: 2, percent: 50 });
    expect(res.body.projects.map((p) => p.name)).toEqual(['프로젝트 A', '프로젝트 B']);
    expect(res.body.overdue.count).toBe(2);
  });

  it('보관된 프로젝트는 제외하고, 소속이 없으면 빈 요약', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    const res = await overall('member');
    expect(res.body.progress).toEqual({ total: 0, done: 0, percent: 0 });
    expect(res.body.projects).toEqual([]);
    const outsider = await overall('outsider');
    expect(outsider.body.projects).toEqual([]);
    expect(outsider.body.myOpen).toBe(0);
  });

  it('인증 없으면 401', async () => {
    expect((await request(app).get('/api/v1/dashboard')).status).toBe(401);
  });
});

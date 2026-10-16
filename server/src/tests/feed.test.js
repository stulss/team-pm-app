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
vi.mock('../modules/feed/repository.js', async () => ({
  ...(await vi.importActual('../modules/feed/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).feedRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { addDays } = await import('../modules/feed/service.js');
const { todayIn } = await import('../modules/notifications/service.js');

// admin(첫 가입자, 어느 프로젝트에도 속하지 않음), owner(A 소유), member(A 멤버), other(B 소유)
const people = {};
const as = (who) => bearer(people[who].token);
const today = todayIn();
let pidA;
let pidB;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const feed = async (who) => (await api('get', '/feed', who)).body;
const addTask = (pid, who, body) =>
  api('post', `/projects/${pid}/tasks`, who, body).then((r) => r.body);

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['member', '멤버'],
    ['other', '다른팀'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pidA = (await api('post', '/projects', 'owner', { name: '알파', memberIds: [people.member.id] }))
    .body.id;
  pidB = (await api('post', '/projects', 'other', { name: '베타' })).body.id;
});

describe('접근', () => {
  it('인증 없으면 401, 빈 피드는 빈 묶음', async () => {
    expect((await request(app).get('/api/v1/feed')).status).toBe(401);
    const body = await feed('admin');
    expect(body).toMatchObject({
      today,
      dueTasks: [],
      mentions: [],
      activities: [],
      notifications: { unread: 0, items: [] },
    });
  });
});

describe('마감 작업', () => {
  const due = (days) => addDays(today, days);
  const mine = (title, dueDate, extra = {}) =>
    addTask(pidA, 'owner', { title, dueDate, assigneeId: people.member.id, ...extra });

  it('나에게 배정된 지난 마감·7일 이내 마감만, 마감일 순으로 나온다', async () => {
    await mine('먼 작업', due(8));
    await mine('7일째', due(7));
    await mine('오늘', due(0));
    await mine('지연', due(-3));
    await addTask(pidA, 'owner', { title: '내 것 아님', dueDate: due(1) });
    await addTask(pidA, 'owner', {
      title: '남에게 배정',
      dueDate: due(1),
      assigneeId: people.owner.id,
    });
    await mine('마감 없음', undefined);
    const { dueTasks } = await feed('member');
    expect(dueTasks.map((t) => t.title)).toEqual(['지연', '오늘', '7일째']);
    expect(dueTasks.map((t) => t.overdue)).toEqual([true, false, false]);
    expect(dueTasks[0]).toMatchObject({ projectId: pidA, projectName: '알파', status: 'todo' });
  });

  it('완료된 작업과 보관된 프로젝트의 작업은 제외한다', async () => {
    const done = await mine('끝난 작업', due(1));
    await api('patch', `/tasks/${done.id}`, 'owner', { status: 'done' });
    await mine('진행 작업', due(1));
    expect((await feed('member')).dueTasks.map((t) => t.title)).toEqual(['진행 작업']);
    await api('patch', `/projects/${pidA}`, 'owner', { status: 'archived' });
    expect((await feed('member')).dueTasks).toEqual([]);
  });

  it('프로젝트에서 제거되면 사라지고, 최대 10건이다', async () => {
    for (let i = 0; i < 12; i += 1) await mine(`작업 ${i}`, due(1));
    expect((await feed('member')).dueTasks).toHaveLength(10);
    await api('delete', `/projects/${pidA}/members/${people.member.id}`, 'owner');
    expect((await feed('member')).dueTasks).toEqual([]);
  });
});

describe('멘션', () => {
  let taskId;
  beforeEach(async () => {
    taskId = (await addTask(pidA, 'owner', { title: '멘션 작업' })).id;
  });
  const mentionMember = (who, body) =>
    api('post', `/tasks/${taskId}/comments`, who, { body, mentionIds: [people.member.id] });

  it('나를 멘션한 댓글이 최신순으로 작성자·미리보기와 함께 나온다', async () => {
    await mentionMember('owner', '@멤버 첫 번째 확인 부탁');
    await mentionMember('owner', `@멤버 ${'길게 '.repeat(60)}`);
    const { mentions } = await feed('member');
    expect(mentions).toHaveLength(2);
    expect(mentions[0].snippet.endsWith('…')).toBe(true);
    expect(mentions[0].snippet.length).toBeLessThanOrEqual(81);
    expect(mentions[1]).toMatchObject({
      taskId,
      taskTitle: '멘션 작업',
      projectName: '알파',
      author: { name: '소유자' },
      snippet: '@멤버 첫 번째 확인 부탁',
    });
  });

  it('내가 쓴 댓글(자기 멘션)과 남이 받은 멘션은 나오지 않는다', async () => {
    await mentionMember('member', '@멤버 나 자신');
    await api('post', `/tasks/${taskId}/comments`, 'member', {
      body: '@소유자 확인',
      mentionIds: [people.owner.id],
    });
    expect((await feed('member')).mentions).toEqual([]);
    expect((await feed('owner')).mentions).toHaveLength(1);
  });

  it('삭제된 댓글과 멤버에서 제거된 뒤의 멘션은 나오지 않는다', async () => {
    const c = await mentionMember('owner', '@멤버 지울 댓글');
    await api('delete', `/comments/${c.body.id}`, 'owner');
    expect((await feed('member')).mentions).toEqual([]);
    await mentionMember('owner', '@멤버 남는 댓글');
    expect((await feed('member')).mentions).toHaveLength(1);
    await api('delete', `/projects/${pidA}/members/${people.member.id}`, 'owner');
    expect((await feed('member')).mentions).toEqual([]);
  });
});

describe('알림 미리보기', () => {
  it('안 읽은 알림 수와 최근 5건만 보여 준다', async () => {
    for (let i = 0; i < 7; i += 1) {
      await addTask(pidA, 'owner', { title: `배정 ${i}`, assigneeId: people.member.id });
    }
    const { notifications } = await feed('member');
    expect(notifications.unread).toBe(7);
    expect(notifications.items).toHaveLength(5);
    await api('post', '/notifications/read-all', 'member');
    expect((await feed('member')).notifications).toMatchObject({ unread: 0, items: [] });
  });
});

describe('내가 없는 동안의 활동', () => {
  it('내 프로젝트의 남이 한 활동만, 최신순으로 프로젝트 이름과 함께', async () => {
    await addTask(pidA, 'owner', { title: '소유자의 작업' });
    await addTask(pidA, 'member', { title: '멤버의 작업' });
    await addTask(pidB, 'other', { title: '남의 프로젝트 작업' });
    const { activities } = await feed('member');
    expect(activities.every((a) => a.projectId === pidA)).toBe(true);
    expect(activities.every((a) => a.actor?.id !== people.member.id)).toBe(true);
    expect(activities[0]).toMatchObject({
      action: 'task.created',
      projectName: '알파',
      actor: { name: '소유자' },
      meta: { title: '소유자의 작업' },
    });
    expect(activities.map((a) => a.seq)).toEqual(
      [...activities.map((a) => a.seq)].sort((a, b) => b - a),
    );
  });

  it('프로젝트 멤버가 아닌 Admin 에게는 아무것도 보이지 않는다', async () => {
    await addTask(pidA, 'owner', { title: '비공개 작업' });
    expect((await feed('admin')).activities).toEqual([]);
  });

  it('최대 15건이다', async () => {
    for (let i = 0; i < 20; i += 1) await addTask(pidA, 'owner', { title: `작업 ${i}` });
    expect((await feed('member')).activities).toHaveLength(15);
  });
});

describe('addDays', () => {
  it('달·해를 넘겨도 날짜만 계산한다', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

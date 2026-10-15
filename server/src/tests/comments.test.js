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

const { app } = await import('../app.js');

// admin(비멤버), manager(소유자), manager2(멤버), member, member2, outsider
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let taskId;

const post = (who, body, id = taskId) =>
  request(app).post(`/api/v1/tasks/${id}/comments`).set(as(who)).send({ body });
const list = (who, id = taskId) => request(app).get(`/api/v1/tasks/${id}/comments`).set(as(who));
const edit = (who, id, body) =>
  request(app).patch(`/api/v1/comments/${id}`).set(as(who)).send({ body });
const del = (who, id) => request(app).delete(`/api/v1/comments/${id}`).set(as(who));
const taskOf = (who, id = taskId) => request(app).get(`/api/v1/tasks/${id}`).set(as(who));

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['manager', '매니저'],
    ['manager2', '매니저2'],
    ['member', '멤버'],
    ['member2', '멤버2'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  for (const k of ['manager', 'manager2']) {
    store.users.find((u) => u.id === people[k].id).role = 'manager';
  }
  const project = await request(app)
    .post('/api/v1/projects')
    .set(as('manager'))
    .send({
      name: '댓글',
      memberIds: [people.manager2.id, people.member.id, people.member2.id],
    });
  pid = project.body.id;
  const task = await request(app)
    .post(`/api/v1/projects/${pid}/tasks`)
    .set(as('manager'))
    .send({ title: '댓글 대상' });
  taskId = task.body.id;
});

describe('POST /tasks/:id/comments', () => {
  it('멤버가 쓰면 201 과 작성자 정보를 돌려준다 (Admin 은 멤버가 아니어도 가능)', async () => {
    const res = await post('member', '시안 v2 올렸어요');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      taskId,
      author: { id: people.member.id, name: '멤버' },
      body: '시안 v2 올렸어요',
      deleted: false,
      edited: false,
    });
    expect((await post('admin', '관리자 댓글')).status).toBe(201);
  });

  it('비멤버는 403, 없는 작업은 404, 인증 없으면 401', async () => {
    expect((await post('outsider', 'x')).status).toBe(403);
    expect((await post('member', 'x', crypto.randomUUID())).status).toBe(404);
    const res = await request(app).post(`/api/v1/tasks/${taskId}/comments`).send({ body: 'x' });
    expect(res.status).toBe(401);
    expect(store.comments).toHaveLength(0);
  });

  it.each([
    ['빈 내용', ''],
    ['공백뿐', '   \n  '],
    ['5001자', 'a'.repeat(5001)],
  ])('검증 실패 → 400 (%s)', async (_label, body) => {
    expect((await post('member', body)).status).toBe(400);
    expect(store.comments).toHaveLength(0);
  });

  it('앞뒤 공백은 잘리고, HTML 은 그대로 문자열로 저장된다', async () => {
    const res = await post('member', '  <script>alert(1)</script>  ');
    expect(res.body.body).toBe('<script>alert(1)</script>');
  });

  it('보관된 프로젝트에서는 409 PROJECT_ARCHIVED', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    const res = await post('member', 'x');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
  });
});

describe('GET /tasks/:id/comments', () => {
  it('오래된 순으로 주고, 비멤버는 403', async () => {
    await post('member', '첫째');
    await post('manager', '둘째');
    await post('member2', '셋째');
    const res = await list('manager2');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.body)).toEqual(['첫째', '둘째', '셋째']);
    expect((await list('outsider')).status).toBe(403);
    expect((await list('member', crypto.randomUUID())).status).toBe(404);
  });

  it('삭제된 댓글은 본문을 가리고 deleted 표시를 한다', async () => {
    const c = (await post('member', '비밀 내용')).body;
    await del('member', c.id);
    const res = await list('member2');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: c.id, body: '삭제된 댓글', deleted: true });
    expect(JSON.stringify(res.body)).not.toContain('비밀 내용');
  });
});

describe('작업의 commentCount', () => {
  it('삭제되지 않은 댓글 수만 센다', async () => {
    expect((await taskOf('member')).body.commentCount).toBe(0);
    const a = (await post('member', 'a')).body;
    await post('member2', 'b');
    expect((await taskOf('member')).body.commentCount).toBe(2);
    await del('member', a.id);
    expect((await taskOf('member')).body.commentCount).toBe(1);
    const board = await request(app)
      .get(`/api/v1/projects/${pid}/tasks?groupBy=status`)
      .set(as('member'));
    expect(board.body.columns.todo[0].commentCount).toBe(1);
  });
});

describe('PATCH /comments/:id', () => {
  let comment;
  beforeEach(async () => {
    comment = (await post('member', '원래 내용')).body;
  });

  it('작성자만 수정할 수 있고 edited 표시가 켜진다', async () => {
    const res = await edit('member', comment.id, '고친 내용');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: '고친 내용', edited: true });
  });

  it('다른 멤버·Manager·Admin 도 남의 댓글은 수정할 수 없다 (403)', async () => {
    for (const who of ['member2', 'manager', 'admin']) {
      expect((await edit(who, comment.id, '가로채기')).status, who).toBe(403);
    }
    expect(store.comments[0].body).toBe('원래 내용');
  });

  it('비멤버는 403, 없는 댓글은 404, 잘못된 ID/내용은 400', async () => {
    expect((await edit('outsider', comment.id, 'x')).status).toBe(403);
    expect((await edit('member', crypto.randomUUID(), 'x')).status).toBe(404);
    expect((await edit('member', 'abc', 'x')).status).toBe(400);
    expect((await edit('member', comment.id, '  ')).status).toBe(400);
  });

  it('삭제된 댓글은 수정할 수 없다 (404), 보관된 프로젝트에서는 409', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    expect((await edit('member', comment.id, 'x')).status).toBe(409);
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'active' });
    await del('member', comment.id);
    expect((await edit('member', comment.id, 'x')).status).toBe(404);
  });
});

describe('DELETE /comments/:id', () => {
  let comment;
  beforeEach(async () => {
    comment = (await post('member', '지울 댓글')).body;
  });

  it('작성자, 프로젝트 멤버인 Manager, Admin 은 삭제할 수 있다', async () => {
    for (const who of ['member', 'manager2', 'admin']) {
      const c = (await post('member', `삭제 ${who}`)).body;
      expect((await del(who, c.id)).status, who).toBe(204);
    }
  });

  it('다른 Member 와 비멤버는 403', async () => {
    expect((await del('member2', comment.id)).status).toBe(403);
    expect((await del('outsider', comment.id)).status).toBe(403);
    expect(store.comments[0].deleted_at).toBeNull();
  });

  it('멤버가 아닌 Manager 는 삭제할 수 없다', async () => {
    store.users.find((u) => u.id === people.outsider.id).role = 'manager';
    expect((await del('outsider', comment.id)).status).toBe(403);
  });

  it('이미 삭제된 댓글은 404, 삭제 후에도 행은 남는다(소프트 삭제)', async () => {
    expect((await del('member', comment.id)).status).toBe(204);
    expect(store.comments).toHaveLength(1);
    expect(store.comments[0].deleted_at).toBeTruthy();
    expect((await del('member', comment.id)).status).toBe(404);
  });

  it('보관된 프로젝트에서는 409', async () => {
    await request(app)
      .patch(`/api/v1/projects/${pid}`)
      .set(as('manager'))
      .send({ status: 'archived' });
    expect((await del('member', comment.id)).status).toBe(409);
  });

  it('작업을 삭제하면 댓글도 함께 삭제된다', async () => {
    await request(app).delete(`/api/v1/tasks/${taskId}`).set(as('manager'));
    expect(store.comments).toHaveLength(0);
  });
});

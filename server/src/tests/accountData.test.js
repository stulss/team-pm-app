import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { PASSWORD, bearer, cookieHeader, register } from './helpers/setup.js';

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

const { app } = await import('../app.js');

beforeEach(() => {
  reset();
});

// 첫 가입자는 admin 이므로, 삭제 테스트는 두 번째 사용자(member)로 한다.
async function twoUsers() {
  await register(app);
  const { res } = await register(app, { email: 'minseo@example.com', name: '민서' });
  return { token: res.body.accessToken, id: res.body.user.id, res };
}

describe('GET /users/me/export', () => {
  it('로그인해야 하고, 내 데이터만 첨부 파일로 내려받는다', async () => {
    expect((await request(app).get('/api/v1/users/me/export')).status).toBe(401);

    const { token, id } = await twoUsers();
    store.projects.push({ id: 'p1', name: '내 프로젝트', key: 'MINE', owner_id: 'x' });
    store.projects.push({ id: 'p2', name: '남의 프로젝트', key: 'OTHR', owner_id: 'x' });
    store.members.push({ project_id: 'p1', user_id: id, joined_at: new Date() });
    store.tasks.push({ id: 't1', title: '내가 맡은 일', assignee_id: id, created_by: 'x' });
    store.tasks.push({ id: 't2', title: '남의 일', assignee_id: 'x', created_by: 'x' });
    store.comments.push({ id: 'c1', author_id: id, body: '내 댓글', task_id: 't1' });
    store.comments.push({ id: 'c2', author_id: 'x', body: '남의 댓글', task_id: 't1' });

    const res = await request(app).get('/api/v1/users/me/export').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="team-pm-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const body = JSON.parse(res.text);
    expect(body.user).toMatchObject({ email: 'minseo@example.com', name: '민서' });
    expect(body.projects.map((p) => p.name)).toEqual(['내 프로젝트']);
    expect(body.assignedTasks.map((t) => t.title)).toEqual(['내가 맡은 일']);
    expect(body.comments.map((c) => c.body)).toEqual(['내 댓글']);
    expect(res.text).not.toMatch(/password|남의/i);
  });
});

describe('DELETE /users/me', () => {
  const del = (token, body) =>
    request(app).delete('/api/v1/users/me').set(bearer(token)).send(body);

  it('로그인해야 한다', async () => {
    expect((await request(app).delete('/api/v1/users/me').send({})).status).toBe(401);
  });

  it('이메일이 다르거나 비밀번호가 틀리면 거절한다', async () => {
    const { token } = await twoUsers();
    const wrongEmail = await del(token, {
      confirmEmail: 'x@example.com',
      currentPassword: PASSWORD,
    });
    expect(wrongEmail.status).toBe(400);
    expect(wrongEmail.body.error.code).toBe('EMAIL_MISMATCH');
    const wrongPassword = await del(token, {
      confirmEmail: 'minseo@example.com',
      currentPassword: 'nope-nope-1',
    });
    expect(wrongPassword.status).toBe(401);
    expect(store.users[1].is_active).toBe(true);
  });

  it('소유한 프로젝트가 있으면 막고 프로젝트 이름을 알려 준다', async () => {
    const { token, id } = await twoUsers();
    store.projects.push({ id: 'p1', name: '내 프로젝트', owner_id: id });
    const res = await del(token, { confirmEmail: 'minseo@example.com', currentPassword: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OWNS_PROJECTS');
    expect(res.body.error.message).toContain('내 프로젝트');
    expect(store.users[1].is_active).toBe(true);
  });

  it('마지막 관리자는 삭제할 수 없다', async () => {
    const { res } = await register(app);
    const out = await del(res.body.accessToken, {
      confirmEmail: 'jiho@example.com',
      currentPassword: PASSWORD,
    });
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe('LAST_ADMIN');
  });

  it('성공하면 익명화하고 세션을 모두 끊으며 쿠키를 지운다', async () => {
    const { token, id, res: signup } = await twoUsers();
    store.members.push({ project_id: 'p1', user_id: id, joined_at: new Date() });
    store.tasks.push({ id: 't1', title: '맡은 일', assignee_id: id, created_by: id });
    store.notifications.push({ id: 'n1', user_id: id });

    const out = await del(token, {
      confirmEmail: ' Minseo@Example.com ',
      currentPassword: PASSWORD,
    });
    expect(out.status).toBe(204);
    expect(out.headers['set-cookie'].join()).toMatch(/refresh_token=;/);

    const user = store.users[1];
    expect(user).toMatchObject({
      name: '탈퇴한 사용자',
      is_active: false,
      email: `deleted-${id}@deleted.invalid`,
    });
    // 작성한 작업은 남고 담당만 풀린다. 소속·알림은 사라진다.
    expect(store.tasks[0]).toMatchObject({ created_by: id, assignee_id: null });
    expect(store.members.filter((m) => m.user_id === id)).toHaveLength(0);
    expect(store.notifications).toHaveLength(0);

    // 기존 refresh 토큰으로는 더 이상 로그인 상태를 이을 수 없고, 같은 비밀번호로 로그인도 안 된다.
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(signup))).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'minseo@example.com', password: PASSWORD })
      ).status,
    ).toBe(401);
    // 같은 이메일로 다시 가입할 수 있다
    const again = await register(app, { email: 'minseo@example.com', name: '다시' });
    expect(again.res.status).toBe(201);
  });

  it('GitHub 로 가입해 비밀번호가 없는 계정은 이메일 확인만으로 삭제한다', async () => {
    await twoUsers();
    store.users[1].password_set = false;
    const { token } = await (async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'minseo@example.com', password: PASSWORD });
      return { token: login.body.accessToken };
    })();
    const out = await del(token, { confirmEmail: 'minseo@example.com' });
    expect(out.status).toBe(204);
  });
});

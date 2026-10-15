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

let admin;
let member;

beforeEach(async () => {
  reset();
  const a = await register(app);
  admin = { token: a.res.body.accessToken, id: a.res.body.user.id, cookie: cookieHeader(a.res) };
  const m = await register(app, { email: 'minseo@example.com', name: '민서' });
  member = { token: m.res.body.accessToken, id: m.res.body.user.id, cookie: cookieHeader(m.res) };
});

describe('GET /users', () => {
  it('인증 없이는 401', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('일반 member 는 사용자 목록을 볼 수 없다 (403) — 공개 가입이 열려 있어도 팀원 정보가 노출되지 않게', async () => {
    const res = await request(app).get('/api/v1/users').set(bearer(member.token));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('example.com');
    expect((await request(app).get('/api/v1/users?q=관리').set(bearer(member.token))).status).toBe(
      403,
    );
  });

  it('manager 는 목록을 볼 수 있다 (멤버 초대용)', async () => {
    store.users.find((u) => u.id === member.id).role = 'manager';
    const res = await request(app).get('/api/v1/users').set(bearer(member.token));
    expect(res.status).toBe(200);
  });

  it('목록과 페이지 정보를 준다', async () => {
    const res = await request(app).get('/api/v1/users').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
  });

  it('?q= 로 이름/이메일을 검색한다', async () => {
    const res = await request(app).get('/api/v1/users?q=민서').set(bearer(admin.token));
    expect(res.body.data.map((u) => u.name)).toEqual(['민서']);
  });

  it('잘못된 limit 은 400', async () => {
    const res = await request(app).get('/api/v1/users?limit=1000').set(bearer(admin.token));
    expect(res.status).toBe(400);
  });
});

describe('PATCH /users/:id/role', () => {
  const patch = (token, id, role) =>
    request(app).patch(`/api/v1/users/${id}/role`).set(bearer(token)).send({ role });

  it('admin 은 역할을 바꿀 수 있다', async () => {
    const res = await patch(admin.token, member.id, 'manager');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('manager');
  });

  it('member 는 403', async () => {
    const res = await patch(member.token, member.id, 'admin');
    expect(res.status).toBe(403);
    expect(store.users.find((u) => u.id === member.id).role).toBe('member');
  });

  it('manager 도 403', async () => {
    await patch(admin.token, member.id, 'manager');
    const res = await patch(member.token, admin.id, 'member');
    expect(res.status).toBe(403);
  });

  it('역할 변경은 토큰 재발급 없이 즉시 반영된다', async () => {
    await patch(admin.token, member.id, 'admin');
    const res = await patch(member.token, admin.id, 'manager');
    expect(res.status).toBe(200);
  });

  it('잘못된 role / id 는 400, 없는 사용자는 404', async () => {
    expect((await patch(admin.token, member.id, 'boss')).status).toBe(400);
    expect((await patch(admin.token, 'not-a-uuid', 'member')).status).toBe(400);
    expect((await patch(admin.token, crypto.randomUUID(), 'member')).status).toBe(404);
  });

  it('마지막 admin 은 강등할 수 없다', async () => {
    const res = await patch(admin.token, admin.id, 'member');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_ADMIN');
  });
});

describe('PATCH /users/:id/status', () => {
  const setStatus = (token, id, isActive) =>
    request(app).patch(`/api/v1/users/${id}/status`).set(bearer(token)).send({ isActive });

  it('member 는 403', async () => {
    expect((await setStatus(member.token, admin.id, false)).status).toBe(403);
  });

  it('비활성화하면 기존 토큰·refresh·로그인이 모두 막힌다', async () => {
    expect((await setStatus(admin.token, member.id, false)).status).toBe(200);

    const me = await request(app).get('/api/v1/auth/me').set(bearer(member.token));
    expect(me.status).toBe(401);

    const refresh = await request(app).post('/api/v1/auth/refresh').set('Cookie', member.cookie);
    expect(refresh.status).toBe(401);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'minseo@example.com', password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('마지막 admin 은 비활성화할 수 없다', async () => {
    const res = await setStatus(admin.token, admin.id, false);
    expect(res.status).toBe(409);
  });
});

describe('PATCH /users/me', () => {
  const patchMe = (token, body) =>
    request(app).patch('/api/v1/users/me').set(bearer(token)).send(body);

  it('이름을 바꿀 수 있다', async () => {
    const res = await patchMe(member.token, { name: '민서2' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('민서2');
  });

  it('변경할 항목이 없으면 400', async () => {
    expect((await patchMe(member.token, {})).status).toBe(400);
  });

  it('비밀번호 변경에는 현재 비밀번호가 필요하다', async () => {
    const res = await patchMe(member.token, { newPassword: 'N3w!password' });
    expect(res.status).toBe(401);

    const wrong = await patchMe(member.token, {
      currentPassword: 'wrong-password',
      newPassword: 'N3w!password',
    });
    expect(wrong.status).toBe(401);
  });

  it('비밀번호를 바꾸면 기존 세션은 끊기고 새 세션을 받는다', async () => {
    const res = await patchMe(member.token, {
      currentPassword: PASSWORD,
      newPassword: 'N3w!password',
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();

    const oldSession = await request(app).post('/api/v1/auth/refresh').set('Cookie', member.cookie);
    expect(oldSession.status).toBe(401);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'minseo@example.com', password: 'N3w!password' });
    expect(login.status).toBe(200);
  });
});

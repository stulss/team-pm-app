import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { PASSWORD, bearer, cookieHeader, cookieOf, register } from './helpers/setup.js';

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
const { sha256 } = await import('../utils/crypto.js');
const { env } = await import('../config/env.js');

beforeEach(() => {
  reset();
});

describe('POST /auth/register', () => {
  it('첫 가입자는 admin, 이후 가입자는 member 이다', async () => {
    const first = await register(app);
    expect(first.res.status).toBe(201);
    expect(first.res.body.user).toMatchObject({ email: 'jiho@example.com', role: 'admin' });
    expect(first.res.body.accessToken).toBeTruthy();

    const second = await register(app, { email: 'minseo@example.com', name: '민서' });
    expect(second.res.body.user.role).toBe('member');
  });

  it('응답에 비밀번호 해시를 노출하지 않는다', async () => {
    const { res } = await register(app);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('refresh 쿠키는 httpOnly + SameSite=Strict + Path=/api/v1/auth 이고 DB에는 해시만 저장된다', async () => {
    const { res } = await register(app);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const raw = cookieHeader(res).split('=')[1];
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].token_hash).toBe(sha256(raw));
    expect(store.tokens[0].token_hash).not.toBe(raw);
  });

  it('이메일은 소문자로 저장하고 중복 가입은 409 이다', async () => {
    await register(app, { email: 'Jiho@Example.com' });
    expect(store.users[0].email).toBe('jiho@example.com');

    const dup = await register(app, { email: 'JIHO@example.com' });
    expect(dup.res.status).toBe(409);
    expect(dup.res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['짧은 비밀번호', { password: 'short' }],
    ['잘못된 이메일', { email: 'not-an-email' }],
    ['빈 이름', { name: '  ' }],
  ])('검증 실패 → 400 (%s)', async (_label, override) => {
    const { res } = await register(app, override);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toHaveProperty('field');
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await register(app);
  });

  it('올바른 자격증명이면 200 과 토큰을 준다', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'JIHO@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(cookieOf(res)).toBeTruthy();
  });

  it('틀린 비밀번호와 없는 이메일은 같은 401 응답이다(계정 존재 여부 비노출)', async () => {
    const wrongPw = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jiho@example.com', password: 'wrong-password' });
    const noUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
    expect(wrongPw.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('비활성 사용자는 로그인할 수 없다', async () => {
    store.users[0].is_active = false;
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jiho@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('토큰이 없거나 잘못되면 401', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(bearer('garbage'))).status).toBe(401);
  });

  it('유효한 access 토큰이면 내 정보를 준다', async () => {
    const { res } = await register(app);
    const me = await request(app).get('/api/v1/auth/me').set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('jiho@example.com');
  });

  it('refresh 토큰을 access 토큰 자리에 쓸 수 없다', async () => {
    const { res } = await register(app);
    const refresh = cookieHeader(res).split('=')[1];
    const me = await request(app).get('/api/v1/auth/me').set(bearer(refresh));
    expect(me.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('쿠키가 없으면 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('회전: 새 토큰을 발급하고 이전 토큰은 더 이상 쓸 수 없다', async () => {
    const { res: signup } = await register(app);
    const oldCookie = cookieHeader(signup);

    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(rotated.status).toBe(200);
    expect(rotated.body.accessToken).toBeTruthy();
    const newCookie = cookieHeader(rotated);
    expect(newCookie).not.toBe(oldCookie);

    const reused = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reused.status).toBe(401);

    const again = await request(app).post('/api/v1/auth/refresh').set('Cookie', newCookie);
    expect(again.status).toBe(200);
  });

  it('유예 시간이 지난 뒤 폐기된 토큰을 재사용하면 모든 세션을 끊는다', async () => {
    const { res: signup } = await register(app);
    const oldCookie = cookieHeader(signup);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    const newCookie = cookieHeader(rotated);

    // 이전 토큰이 폐기된 지 오래된 상황으로 만든다
    store.tokens.find((t) => t.revoked_at).revoked_at = new Date(Date.now() - 60_000);

    await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    const afterTheft = await request(app).post('/api/v1/auth/refresh').set('Cookie', newCookie);
    expect(afterTheft.status).toBe(401);
  });

  it('유예 시간 안의 재사용(탭 경쟁)은 다른 세션을 끊지 않는다', async () => {
    const { res: signup } = await register(app);
    const oldCookie = cookieHeader(signup);
    const rotated = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    const newCookie = cookieHeader(rotated);

    const raced = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(raced.status).toBe(401);
    const stillOk = await request(app).post('/api/v1/auth/refresh').set('Cookie', newCookie);
    expect(stillOk.status).toBe(200);
  });

  it('비활성화된 사용자는 refresh 할 수 없다', async () => {
    const { res: signup } = await register(app);
    store.users[0].is_active = false;
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(signup));
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('204 를 반환하고 refresh 토큰을 폐기한다', async () => {
    const { res: signup } = await register(app);
    const cookie = cookieHeader(signup);

    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);

    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('쿠키가 없어도 204 이다', async () => {
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(204);
  });
});

describe('ALLOW_REGISTRATION', () => {
  afterEach(() => {
    env.ALLOW_REGISTRATION = true;
  });

  it('false 이면 첫 계정은 만들 수 있지만 이후 가입은 403 REGISTRATION_CLOSED', async () => {
    env.ALLOW_REGISTRATION = false;
    const first = await register(app);
    expect(first.res.status).toBe(201);
    expect(first.res.body.user.role).toBe('admin');

    const second = await register(app, { email: 'later@example.com' });
    expect(second.res.status).toBe(403);
    expect(second.res.body.error.code).toBe('REGISTRATION_CLOSED');
    expect(store.users).toHaveLength(1);
  });

  it('닫혀 있어도 기존 사용자의 로그인은 된다', async () => {
    await register(app);
    env.ALLOW_REGISTRATION = false;
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'jiho@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('true(기본)이면 누구나 가입할 수 있다', async () => {
    await register(app);
    expect((await register(app, { email: 'open@example.com' })).res.status).toBe(201);
  });
});

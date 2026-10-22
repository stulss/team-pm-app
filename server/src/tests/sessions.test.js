import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { PASSWORD, bearer, cookieHeader } from './helpers/setup.js';

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

const EMAIL = 'jiho@example.com';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';

beforeEach(() => {
  reset();
});

const signup = () =>
  request(app)
    .post('/api/v1/auth/register')
    .set('User-Agent', CHROME)
    .send({ email: EMAIL, password: PASSWORD, name: '지호' });
const loginFrom = (agent) =>
  request(app)
    .post('/api/v1/auth/login')
    .set('User-Agent', agent)
    .send({ email: EMAIL, password: PASSWORD });
const list = (token, cookie) =>
  request(app).get('/api/v1/auth/sessions').set(bearer(token)).set('Cookie', cookie);

describe('로그인한 기기 목록', () => {
  it('로그인하지 않으면 401', async () => {
    expect((await request(app).get('/api/v1/auth/sessions')).status).toBe(401);
    expect((await request(app).delete('/api/v1/auth/sessions')).status).toBe(401);
  });

  it('기기마다 한 줄이고, 브라우저 문자열·IP 와 지금 기기 표시가 있다', async () => {
    const a = await signup();
    const b = await loginFrom(PHONE);
    const res = await list(a.body.accessToken, cookieHeader(a));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const mine = res.body.data.find((s) => s.current);
    expect(mine.device).toBe(CHROME);
    expect(mine.ip).toBeTruthy();
    expect(res.body.data.find((s) => !s.current).device).toBe(PHONE);
    // 휴대폰 쪽에서 보면 반대가 지금 기기
    const other = await list(b.body.accessToken, cookieHeader(b));
    expect(other.body.data.find((s) => s.current).device).toBe(PHONE);
  });

  it('토큰을 갱신(회전)해도 같은 기기 한 줄이다', async () => {
    const a = await signup();
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(a))
      .set('User-Agent', CHROME);
    const r2 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(r1))
      .set('User-Agent', CHROME);
    const res = await list(r2.body.accessToken, cookieHeader(r2));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].current).toBe(true);
  });

  it('다른 사용자의 기기는 보이지 않는다', async () => {
    const a = await signup();
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'minseo@example.com', password: PASSWORD, name: '민서' });
    const res = await list(a.body.accessToken, cookieHeader(a));
    expect(res.body.data).toHaveLength(1);
  });
});

describe('기기 로그아웃', () => {
  it('다른 기기를 끝내면 그 기기의 갱신이 거부되고 지금 기기는 유지된다', async () => {
    const a = await signup();
    const b = await loginFrom(PHONE);
    const phoneId = (await list(a.body.accessToken, cookieHeader(a))).body.data.find(
      (s) => !s.current,
    ).id;

    const del = await request(app)
      .delete(`/api/v1/auth/sessions/${phoneId}`)
      .set(bearer(a.body.accessToken))
      .set('Cookie', cookieHeader(a));
    expect(del.status).toBe(204);

    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(b))).status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(a))).status,
    ).toBe(200);
  });

  it('지금 기기는 끝낼 수 없고(400), 없는 기기는 404, 형식이 틀리면 400', async () => {
    const a = await signup();
    const mine = (await list(a.body.accessToken, cookieHeader(a))).body.data[0].id;
    const call = (id) =>
      request(app)
        .delete(`/api/v1/auth/sessions/${id}`)
        .set(bearer(a.body.accessToken))
        .set('Cookie', cookieHeader(a));
    const current = await call(mine);
    expect(current.status).toBe(400);
    expect(current.body.error.code).toBe('CURRENT_SESSION');
    expect((await call('11111111-1111-4111-8111-111111111111')).status).toBe(404);
    expect((await call('abc')).status).toBe(400);
  });

  it('다른 사용자의 기기 id 로는 끝낼 수 없다(404)', async () => {
    const a = await signup();
    const other = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'minseo@example.com', password: PASSWORD, name: '민서' });
    const theirs = (await list(other.body.accessToken, cookieHeader(other))).body.data[0].id;
    const res = await request(app)
      .delete(`/api/v1/auth/sessions/${theirs}`)
      .set(bearer(a.body.accessToken))
      .set('Cookie', cookieHeader(a));
    expect(res.status).toBe(404);
    expect(
      (await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(other))).status,
    ).toBe(200);
  });

  it('다른 모든 기기에서 로그아웃하면 지금 기기만 남는다', async () => {
    const a = await signup();
    const b = await loginFrom(PHONE);
    const c = await loginFrom(PHONE);
    const res = await request(app)
      .delete('/api/v1/auth/sessions')
      .set(bearer(a.body.accessToken))
      .set('Cookie', cookieHeader(a));
    expect(res.body).toEqual({ revoked: 2 });
    for (const gone of [b, c]) {
      expect(
        (await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(gone))).status,
      ).toBe(401);
    }
    const left = await list(a.body.accessToken, cookieHeader(a));
    expect(left.body.data).toHaveLength(1);
  });

  it('refresh 쿠키가 없으면 "다른 기기 로그아웃"은 아무것도 끊지 않는다', async () => {
    const a = await signup();
    await loginFrom(PHONE);
    const res = await request(app).delete('/api/v1/auth/sessions').set(bearer(a.body.accessToken));
    expect(res.body).toEqual({ revoked: 0 });
    expect(store.tokens.filter((t) => !t.revoked_at)).toHaveLength(2);
  });
});

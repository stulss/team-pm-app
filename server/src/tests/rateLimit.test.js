import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../config/db.js', () => ({ query: vi.fn(), pool: {}, withTransaction: (fn) => fn({}) }));

const { createLimiters, loginLimiter } = await import('../middleware/rateLimit.js');

// 운영과 같은 한도를 켠 작은 앱 (테스트에서는 메모리 저장소). 기본 limiter 는 개발/테스트에서 꺼져 있으므로 직접 만든다.
function makeApp() {
  const { login, register, api } = createLimiters({ skip: () => false, useRedis: false });
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post('/login', login, (req, res) => res.json({ ok: true }));
  app.post('/register', register, (req, res) => res.json({ ok: true }));
  app.use(api);
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/data', (req, res) => res.json({ ok: true }));
  return app;
}

const postLogin = (app, email, ip = '1.1.1.1') =>
  request(app).post('/login').set('X-Forwarded-For', ip).send({ email });

describe('login limiter (IP + 이메일, 15분 10회)', () => {
  it('같은 IP·이메일로 11번째 시도는 429 RATE_LIMITED', async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      expect((await postLogin(app, 'a@example.com')).status).toBe(200);
    }
    const blocked = await postLogin(app, 'a@example.com');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['ratelimit']).toBeTruthy();
  });

  it('이메일이 다르거나 IP 가 다르면 따로 센다 (대소문자 무시)', async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) await postLogin(app, 'a@example.com');
    expect((await postLogin(app, 'A@Example.com')).status).toBe(429); // 같은 이메일
    expect((await postLogin(app, 'b@example.com')).status).toBe(200); // 다른 이메일
    expect((await postLogin(app, 'a@example.com', '2.2.2.2')).status).toBe(200); // 다른 IP
  });
});

describe('register limiter (IP, 1시간 20회)', () => {
  it('21번째 가입 시도는 429, 다른 IP 는 영향 없음', async () => {
    const app = makeApp();
    const post = (ip) => request(app).post('/register').set('X-Forwarded-For', ip).send({});
    for (let i = 0; i < 20; i += 1) expect((await post('3.3.3.3')).status).toBe(200);
    expect((await post('3.3.3.3')).status).toBe(429);
    expect((await post('4.4.4.4')).status).toBe(200);
  });
});

describe('api limiter (IP, 1분 600회)', () => {
  it('601번째 요청은 429 이지만 /health 는 제외된다', async () => {
    const app = makeApp();
    const get = (path) => request(app).get(path).set('X-Forwarded-For', '5.5.5.5');
    for (let i = 0; i < 600; i += 1) {
      const res = await get('/data');
      if (res.status !== 200) throw new Error(`요청 ${i + 1} 에서 예상치 못한 ${res.status}`);
    }
    expect((await get('/data')).status).toBe(429);
    expect((await get('/health')).status).toBe(200);
  });
});

describe('기본 limiter', () => {
  it('개발·테스트(NODE_ENV != production)에서는 꺼져 있다', async () => {
    const app = express();
    app.use(express.json());
    app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));
    for (let i = 0; i < 15; i += 1) {
      expect((await request(app).post('/login').send({ email: 'x@example.com' })).status).toBe(200);
    }
  });
});

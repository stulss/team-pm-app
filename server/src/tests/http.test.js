import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../config/db.js', () => ({ query: vi.fn(), pool: {}, withTransaction: (fn) => fn({}) }));

const { app } = await import('../app.js');

describe('요청 본문 크기 제한', () => {
  it('100KB 를 넘는 JSON 은 413 PAYLOAD_TOO_LARGE', async () => {
    const huge = { email: 'a@example.com', password: 'x'.repeat(150_000) };
    const res = await request(app).post('/api/v1/auth/login').send(huge);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('깨진 JSON 은 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('x-request-id', () => {
  it('요청마다 응답 헤더로 ID 를 돌려준다', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);
  });

  it('안전한 형식의 요청 ID 는 그대로 쓰고, 이상한 값은 새로 만든다', async () => {
    const ok = await request(app).get('/api/v1/nope').set('X-Request-Id', 'trace-abc_123');
    expect(ok.headers['x-request-id']).toBe('trace-abc_123');

    const bad = await request(app).get('/api/v1/nope').set('X-Request-Id', 'bad id<script>');
    expect(bad.headers['x-request-id']).not.toBe('bad id<script>');
    expect(bad.headers['x-request-id']).toMatch(/^[\w-]+$/);
  });
});

describe('보안 헤더', () => {
  it('helmet 헤더가 붙고 API 응답은 캐시되지 않는다', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS 는 CLIENT_ORIGIN 이 없으면 열리지 않는다', async () => {
    const res = await request(app).get('/api/v1/nope').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

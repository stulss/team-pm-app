import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { PASSWORD, cookieHeader, register } from './helpers/setup.js';

const mail = vi.hoisted(() => ({ enabled: false, sent: [], fail: false }));

vi.mock('../config/db.js', () => ({
  query: vi.fn(),
  pool: {},
  withTransaction: (fn) => fn({}),
}));
vi.mock('../utils/mailer.js', () => ({
  mailEnabled: () => mail.enabled,
  isDeliverable: () => true,
  sendMail: async (message) => {
    if (mail.fail) throw new Error('mail provider responded 500');
    mail.sent.push(message);
    return true;
  },
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
const NEW_PASSWORD = 'Brand-new-pass1';
const post = (path, body) => request(app).post(`/api/v1/auth/${path}`).send(body);
const tokenIn = (message) => /token=([^\s&"]+)/.exec(message.text)[1];
// 재발송 쿨다운(60초)이 지난 것처럼 만든다.
const ageTokens = () => {
  for (const t of store.emailTokens) t.created_at = new Date(Date.now() - 120_000);
};

beforeEach(() => {
  reset();
  mail.enabled = true;
  mail.fail = false;
  mail.sent = [];
});

describe('가입에는 이메일 인증이 없다(메일 설정과 무관)', () => {
  for (const enabled of [false, true]) {
    it(`메일이 ${enabled ? '켜져' : '꺼져'} 있어도 가입하면 바로 세션이 발급되고 메일은 나가지 않는다`, async () => {
      mail.enabled = enabled;
      const { res } = await register(app);
      expect(res.status).toBe(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(cookieHeader(res)).toBeTruthy();
      expect(res.body.needsVerification).toBeUndefined();
      expect(res.body.user.emailVerified).toBeUndefined();
      expect(mail.sent).toHaveLength(0);
      expect(store.emailTokens).toHaveLength(0);

      const login = await post('login', { email: EMAIL, password: PASSWORD });
      expect(login.status).toBe(200);
      const refreshed = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookieHeader(res));
      expect(refreshed.status).toBe(200);
    });
  }

  it('인증 관련 엔드포인트는 없다(404)', async () => {
    await register(app);
    expect((await post('verify-email', { token: 'x'.repeat(43) })).status).toBe(404);
    expect((await post('resend-verification', { email: EMAIL })).status).toBe(404);
  });
});

describe('메일이 꺼져 있을 때', () => {
  beforeEach(() => {
    mail.enabled = false;
  });

  it('비밀번호 재설정 요청은 202 이지만 아무것도 보내지 않는다', async () => {
    await register(app);
    expect((await post('forgot-password', { email: EMAIL })).status).toBe(202);
    expect(mail.sent).toHaveLength(0);
    expect(store.emailTokens).toHaveLength(0);
  });
});

describe('비밀번호 재설정', () => {
  it('없는 이메일도 202 이고 메일을 보내지 않는다(계정 존재 여부 비노출)', async () => {
    await register(app);
    const known = await post('forgot-password', { email: EMAIL });
    const unknown = await post('forgot-password', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(mail.sent).toHaveLength(1); // 존재하는 계정에만 발송
  });

  it('DB 에는 토큰 원문이 아니라 해시만 저장된다', async () => {
    await register(app);
    await post('forgot-password', { email: EMAIL });
    const token = tokenIn(mail.sent[0]);
    expect(store.emailTokens[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.emailTokens)).not.toContain(token);
  });

  it('같은 사용자에게는 60초 안에 다시 보내지 않는다', async () => {
    await register(app);
    await post('forgot-password', { email: EMAIL });
    await post('forgot-password', { email: EMAIL });
    expect(mail.sent).toHaveLength(1);
    ageTokens();
    await post('forgot-password', { email: EMAIL });
    expect(mail.sent).toHaveLength(2);
  });

  it('메일 발송이 실패해도 요청은 202 이고 응답에 사유를 드러내지 않는다', async () => {
    await register(app);
    mail.fail = true;
    const res = await post('forgot-password', { email: EMAIL });
    expect(res.status).toBe(202);
    expect(JSON.stringify(res.body)).not.toContain('provider');
  });

  it('링크로 새 비밀번호를 설정하면 이전 비밀번호와 기존 세션이 무효가 된다', async () => {
    await register(app);
    const login = await post('login', { email: EMAIL, password: PASSWORD });
    const oldCookie = cookieHeader(login);

    expect((await post('forgot-password', { email: EMAIL })).status).toBe(202);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].text).toContain('/reset-password?token=');
    const token = tokenIn(mail.sent[0]);

    const reset = await post('reset-password', { token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    expect((await post('login', { email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await post('login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie);
    expect(refreshed.status).toBe(401);
  });

  it('토큰은 한 번만 쓸 수 있고, 새 요청은 이전 링크를 무효화한다', async () => {
    await register(app);
    await post('forgot-password', { email: EMAIL });
    const first = tokenIn(mail.sent[0]);
    ageTokens();
    await post('forgot-password', { email: EMAIL });
    const second = tokenIn(mail.sent[1]);
    const reset = (token, password) => post('reset-password', { token, password });
    expect((await reset(first, NEW_PASSWORD)).status).toBe(400);
    expect((await reset(second, NEW_PASSWORD)).status).toBe(200);
    const again = await reset(second, 'Another-pass22');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('너무 짧은 비밀번호는 400 이고 토큰은 소비되지 않는다. 만료된 토큰은 400', async () => {
    await register(app);
    await post('forgot-password', { email: EMAIL });
    const token = tokenIn(mail.sent[0]);
    expect((await post('reset-password', { token, password: 'short' })).status).toBe(400);
    const record = store.emailTokens.find((t) => t.kind === 'reset');
    expect(record.used_at).toBeNull();

    record.expires_at = new Date(Date.now() - 1000);
    expect((await post('reset-password', { token, password: NEW_PASSWORD })).status).toBe(400);
  });

  it('비활성 계정에는 재설정 메일을 보내지 않는다', async () => {
    await register(app);
    store.users[0].is_active = false;
    await post('forgot-password', { email: EMAIL });
    expect(mail.sent).toHaveLength(0);
  });
});

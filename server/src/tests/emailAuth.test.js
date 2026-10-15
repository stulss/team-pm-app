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

describe('메일이 꺼져 있을 때', () => {
  beforeEach(() => {
    mail.enabled = false;
  });

  it('가입하면 바로 세션이 발급되고(인증 요구 없음) 메일은 나가지 않는다', async () => {
    const { res } = await register(app);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.needsVerification).toBeUndefined();
    expect(mail.sent).toHaveLength(0);
    expect((await post('login', { email: EMAIL, password: PASSWORD })).status).toBe(200);
  });

  it('비밀번호 재설정 요청은 202 이지만 아무것도 보내지 않는다', async () => {
    await register(app);
    expect((await post('forgot-password', { email: EMAIL })).status).toBe(202);
    expect(mail.sent).toHaveLength(0);
    expect(store.emailTokens).toHaveLength(0);
  });
});

describe('이메일 인증', () => {
  it('가입하면 세션 없이 needsVerification 을 돌려주고 인증 메일을 보낸다', async () => {
    const { res } = await register(app);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ needsVerification: true, user: { emailVerified: false } });
    expect(res.body.accessToken).toBeUndefined();
    expect(cookieHeader(res)).toBeUndefined();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].subject).toContain('인증');
    expect(mail.sent[0].text).toContain('/verify-email?token=');
  });

  it('DB 에는 토큰 원문이 아니라 해시만 저장된다', async () => {
    await register(app);
    const token = tokenIn(mail.sent[0]);
    expect(store.emailTokens[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.emailTokens)).not.toContain(token);
  });

  it('인증 전 로그인은 (비밀번호가 맞을 때만) 403 EMAIL_NOT_VERIFIED, 틀리면 401', async () => {
    await register(app);
    const ok = await post('login', { email: EMAIL, password: PASSWORD });
    expect(ok.status).toBe(403);
    expect(ok.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const bad = await post('login', { email: EMAIL, password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('링크로 인증하면 로그인할 수 있고, 같은 링크는 다시 쓸 수 없다', async () => {
    await register(app);
    const token = tokenIn(mail.sent[0]);
    expect((await post('verify-email', { token })).status).toBe(200);
    const login = await post('login', { email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true);
    const again = await post('verify-email', { token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_TOKEN');
  });

  it('잘못된·만료된 토큰은 400', async () => {
    await register(app);
    expect((await post('verify-email', { token: 'x'.repeat(43) })).status).toBe(400);
    expect((await post('verify-email', { token: 'short' })).status).toBe(400);
    store.emailTokens[0].expires_at = new Date(Date.now() - 1000);
    expect((await post('verify-email', { token: tokenIn(mail.sent[0]) })).status).toBe(400);
  });

  it('재발송: 없는 이메일도 202(메일 없음), 60초 안에는 다시 보내지 않고, 지나면 새 링크가 이전 링크를 무효화', async () => {
    await register(app);
    expect((await post('resend-verification', { email: 'nobody@example.com' })).status).toBe(202);
    expect(mail.sent).toHaveLength(1);

    expect((await post('resend-verification', { email: EMAIL })).status).toBe(202);
    expect(mail.sent).toHaveLength(1); // 쿨다운

    ageTokens();
    expect((await post('resend-verification', { email: EMAIL })).status).toBe(202);
    expect(mail.sent).toHaveLength(2);
    expect((await post('verify-email', { token: tokenIn(mail.sent[0]) })).status).toBe(400);
    expect((await post('verify-email', { token: tokenIn(mail.sent[1]) })).status).toBe(200);
  });

  it('이미 인증된 계정에는 재발송하지 않는다', async () => {
    await register(app);
    await post('verify-email', { token: tokenIn(mail.sent[0]) });
    ageTokens();
    await post('resend-verification', { email: EMAIL });
    expect(mail.sent).toHaveLength(1);
  });

  it('메일 발송이 실패해도 가입은 성공하고 응답에 사유를 드러내지 않는다', async () => {
    mail.fail = true;
    const { res } = await register(app);
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('provider');
  });

  it('인증을 켠 뒤에는 아직 인증하지 않은 사용자의 refresh 도 거부된다', async () => {
    mail.enabled = false;
    const { res } = await register(app);
    const cookie = cookieHeader(res);
    mail.enabled = true;
    const refreshed = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshed.status).toBe(401);
  });
});

describe('비밀번호 재설정', () => {
  const verified = async () => {
    const { res } = await register(app);
    expect(res.status).toBe(201);
    await post('verify-email', { token: tokenIn(mail.sent[0]) });
    mail.sent = [];
    ageTokens();
  };

  it('없는 이메일도 202 이고 메일을 보내지 않는다(계정 존재 여부 비노출)', async () => {
    await register(app);
    mail.sent = [];
    ageTokens();
    const known = await post('forgot-password', { email: EMAIL });
    const unknown = await post('forgot-password', { email: 'nobody@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(mail.sent).toHaveLength(1); // 존재하는 계정에만 발송
  });

  it('링크로 새 비밀번호를 설정하면 이전 비밀번호와 기존 세션이 무효가 된다', async () => {
    await verified();
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
    await verified();
    await post('forgot-password', { email: EMAIL });
    const first = tokenIn(mail.sent[0]);
    ageTokens();
    await post('forgot-password', { email: EMAIL });
    const second = tokenIn(mail.sent[1]);
    const reset = (token, password) => post('reset-password', { token, password });
    expect((await reset(first, NEW_PASSWORD)).status).toBe(400);
    expect((await reset(second, NEW_PASSWORD)).status).toBe(200);
    expect((await reset(second, 'Another-pass22')).status).toBe(400);
  });

  it('너무 짧은 비밀번호는 400 이고 토큰은 소비되지 않는다. 만료된 토큰은 400', async () => {
    await verified();
    await post('forgot-password', { email: EMAIL });
    const token = tokenIn(mail.sent[0]);
    expect((await post('reset-password', { token, password: 'short' })).status).toBe(400);
    const record = store.emailTokens.find((t) => t.kind === 'reset');
    expect(record.used_at).toBeNull();

    record.expires_at = new Date(Date.now() - 1000);
    expect((await post('reset-password', { token, password: NEW_PASSWORD })).status).toBe(400);
  });

  it('인증 전 계정도 재설정 링크로 소유를 증명하면 인증된 것으로 본다', async () => {
    await register(app);
    mail.sent = [];
    ageTokens();
    await post('forgot-password', { email: EMAIL });
    await post('reset-password', { token: tokenIn(mail.sent[0]), password: NEW_PASSWORD });
    expect((await post('login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
  });

  it('비활성 계정에는 재설정 메일을 보내지 않는다', async () => {
    await verified();
    store.users[0].is_active = false;
    await post('forgot-password', { email: EMAIL });
    expect(mail.sent).toHaveLength(0);
  });
});

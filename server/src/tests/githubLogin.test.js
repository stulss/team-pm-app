import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
import { cookieHeader, register } from './helpers/setup.js';

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
const { env } = await import('../config/env.js');
const { pickEmail, sameState } = await import('../modules/auth/github.js');

const START = '/api/v1/auth/github/start';
const CALLBACK = '/api/v1/auth/github/callback';

// GitHub 응답을 흉내 낸다. 호출 순서와 상관없이 주소로 구분한다.
const fakeGithub = ({
  token = 'gho_test',
  profile = { id: 4242, login: 'octocat', name: 'Octo Cat' },
  emails = [{ email: 'Octo@Example.com', primary: true, verified: true }],
  failProfile = false,
} = {}) =>
  vi.fn(async (url) => {
    const u = String(url);
    const json = (body, ok = true) => ({ ok, json: async () => body });
    if (u.includes('/login/oauth/access_token')) return json(token ? { access_token: token } : {});
    if (u.endsWith('/user/emails')) return json(emails);
    if (u.endsWith('/user')) return failProfile ? json({}, false) : json(profile);
    throw new Error(`unexpected fetch ${u}`);
  });

// start 로 state 쿠키를 받은 뒤 callback 을 부른다.
async function loginFlow({ state, code = 'abc', query = {} } = {}) {
  const start = await request(app).get(START);
  const cookie = (start.headers['set-cookie'] ?? []).find((c) => c.startsWith('gh_oauth_state='));
  const real = new URL(start.headers.location).searchParams.get('state');
  const res = await request(app)
    .get(CALLBACK)
    .set('Cookie', cookie ? cookie.split(';')[0] : '')
    .query({ state: state ?? real, code, ...query });
  return { start, res };
}

const reason = (res) => new URL(res.headers.location).searchParams.get('github');

beforeEach(() => {
  reset();
  env.GITHUB_CLIENT_ID = 'cid';
  env.GITHUB_CLIENT_SECRET = 'csecret';
});
afterEach(() => {
  delete env.GITHUB_CLIENT_ID;
  delete env.GITHUB_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe('GET /auth/providers · /auth/github/start', () => {
  it('키가 있으면 켜져 있다고 알리고, 없으면 끄고 시작도 404', async () => {
    expect((await request(app).get('/api/v1/auth/providers')).body).toEqual({ github: true });
    delete env.GITHUB_CLIENT_ID;
    expect((await request(app).get('/api/v1/auth/providers')).body).toEqual({ github: false });
    expect((await request(app).get(START)).status).toBe(404);
  });

  it('GitHub 승인 화면으로 보내고 같은 state 를 httpOnly 쿠키로 심는다', async () => {
    const res = await request(app).get(START);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/v1\/auth\/github\/callback$/);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('gh_oauth_state='));
    expect(cookie).toContain(`gh_oauth_state=${url.searchParams.get('state')}`);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});

describe('GET /auth/github/callback', () => {
  it('새 사용자는 가입되고(이메일 인증 완료·소문자 이메일) 세션 쿠키가 생긴다', async () => {
    vi.stubGlobal('fetch', fakeGithub());
    const { res } = await loginFlow();
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).pathname).toBe('/');
    expect(cookieHeader(res)).toMatch(/^refresh_token=/);
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      email: 'octo@example.com',
      name: 'Octo Cat',
      github_id: 4242,
      role: 'admin',
    });
    expect(store.users[0].email_verified_at).toBeTruthy();
  });

  it('받은 세션으로 /auth/refresh 가 된다', async () => {
    vi.stubGlobal('fetch', fakeGithub());
    const { res } = await loginFlow();
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(res));
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.email).toBe('octo@example.com');
  });

  it('같은 GitHub 계정으로 다시 오면 같은 사용자로 로그인한다', async () => {
    vi.stubGlobal('fetch', fakeGithub());
    await loginFlow();
    await loginFlow();
    expect(store.users).toHaveLength(1);
  });

  it('같은 이메일의 기존 계정에는 연결하고 로그인한다', async () => {
    await register(app, { email: 'octo@example.com', name: '기존' });
    vi.stubGlobal('fetch', fakeGithub());
    const { res } = await loginFlow();
    expect(new URL(res.headers.location).pathname).toBe('/');
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      name: '기존',
      github_id: 4242,
      github_login: 'octocat',
    });
  });

  it('이미 다른 GitHub 계정이 연결된 사용자에게는 이메일이 같아도 연결하지 않는다', async () => {
    await register(app, { email: 'octo@example.com' });
    store.users[0].github_id = 999;
    vi.stubGlobal('fetch', fakeGithub());
    const { res } = await loginFlow();
    expect(reason(res)).toBe('email_linked_elsewhere');
    expect(cookieHeader(res)).toBeUndefined();
    expect(store.users[0].github_id).toBe(999);
  });

  it('인증된 기본 이메일이 없으면 거절한다', async () => {
    vi.stubGlobal(
      'fetch',
      fakeGithub({ emails: [{ email: 'a@b.com', primary: true, verified: false }] }),
    );
    const { res } = await loginFlow();
    expect(reason(res)).toBe('no_verified_email');
    expect(store.users).toHaveLength(0);
  });

  it('state 가 없거나 다르면 GitHub 를 부르지 않고 거절한다', async () => {
    const fetchMock = fakeGithub();
    vi.stubGlobal('fetch', fetchMock);
    const wrong = await loginFlow({ state: 'forged' });
    expect(reason(wrong.res)).toBe('bad_state');
    const noCookie = await request(app).get(CALLBACK).query({ state: 'x', code: 'abc' });
    expect(reason(noCookie)).toBe('bad_state');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.users).toHaveLength(0);
  });

  it('사용자가 승인을 거절하거나 코드 교환이 실패하면 사유와 함께 로그인 화면으로', async () => {
    vi.stubGlobal('fetch', fakeGithub());
    expect(reason((await loginFlow({ query: { error: 'access_denied' } })).res)).toBe('denied');
    vi.stubGlobal('fetch', fakeGithub({ token: '' }));
    expect(reason((await loginFlow()).res)).toBe('bad_code');
    vi.stubGlobal('fetch', fakeGithub({ failProfile: true }));
    expect(reason((await loginFlow()).res)).toBe('github_error');
    expect(store.users).toHaveLength(0);
  });

  it('비활성 계정과 닫힌 가입은 거절한다', async () => {
    await register(app, { email: 'octo@example.com' });
    store.users[0].is_active = false;
    vi.stubGlobal('fetch', fakeGithub());
    expect(reason((await loginFlow()).res)).toBe('inactive');

    reset();
    await register(app, { email: 'first@example.com' });
    env.ALLOW_REGISTRATION = false;
    try {
      expect(reason((await loginFlow()).res)).toBe('registration_closed');
    } finally {
      env.ALLOW_REGISTRATION = true;
    }
    expect(store.users).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('pickEmail 은 인증된 기본 이메일만 고른다', () => {
    expect(
      pickEmail([
        { email: 'a@x.com', primary: false, verified: true },
        { email: 'b@x.com', primary: true, verified: false },
        { email: 'c@x.com', primary: true, verified: true },
      ]),
    ).toBe('c@x.com');
    expect(pickEmail(undefined)).toBeUndefined();
    expect(pickEmail([])).toBeUndefined();
  });

  it('sameState 는 같은 문자열만 통과시킨다', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'abcd')).toBe(false);
    expect(sameState(undefined, 'abc')).toBe(false);
    expect(sameState('', '')).toBe(false);
  });
});

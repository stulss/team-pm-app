import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';
import {
  ACCENTS,
  DEFAULT_PREFERENCES,
  NOTIFICATION_KEYS,
  DENSITIES,
  THEMES,
  VIEWS,
  TIME_FORMATS,
  WEEK_STARTS,
  withDefaults,
} from '../modules/users/preferences.js';
import {
  ACCENTS as CLIENT_ACCENTS,
  DENSITIES as CLIENT_DENSITIES,
  NOTIFICATIONS as CLIENT_NOTIFICATIONS,
  THEMES as CLIENT_THEMES,
  VIEWS as CLIENT_VIEWS,
  TIME_FORMATS as CLIENT_TIME_FORMATS,
  WEEK_STARTS as CLIENT_WEEK_STARTS,
} from '../../../client/src/constants/preferences.js';

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
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');

let token;
const patch = (body, tk = token) =>
  request(app).patch('/api/v1/users/me/preferences').set(bearer(tk)).send(body);
const me = async () => (await request(app).get('/api/v1/auth/me').set(bearer(token))).body.user;

beforeEach(async () => {
  reset();
  const { res } = await register(app, { email: 'pref@example.com', name: '설정' });
  token = res.body.accessToken;
});

describe('설정 저장', () => {
  it('새 사용자는 기본값을 가진다 (가입·로그인·/auth/me 응답 모두)', async () => {
    expect((await me()).preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it('일부만 바꾸면 나머지는 그대로이고 이후 조회에도 유지된다', async () => {
    const res = await patch({ theme: 'dark', accent: 'teal' });
    expect(res.status).toBe(200);
    expect(res.body.user.preferences).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
      accent: 'teal',
    });
    const next = await patch({ density: 'compact' });
    expect(next.body.user.preferences).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
      accent: 'teal',
      density: 'compact',
    });
    expect((await me()).preferences).toEqual(next.body.user.preferences);
  });

  it('허용된 모든 값이 저장된다', async () => {
    for (const [key, values] of [
      ['theme', THEMES],
      ['accent', ACCENTS],
      ['density', DENSITIES],
      ['defaultView', VIEWS],
      ['weekStart', WEEK_STARTS],
      ['timeFormat', TIME_FORMATS],
    ]) {
      for (const value of values) {
        const res = await patch({ [key]: value });
        expect(res.status).toBe(200);
        expect(res.body.user.preferences[key]).toBe(value);
      }
    }
  });

  it('빈 객체·알 수 없는 키·허용되지 않은 값·잘못된 형식은 400', async () => {
    const bad = [
      {},
      { theme: 'purple' },
      { accent: 'magenta' },
      { density: 'huge' },
      { defaultView: 'gantt' },
      { weekStart: 'fri' },
      { timeFormat: '36h' },
      { admin: true },
      { theme: 'dark', extra: 1 },
      { theme: 123 },
      { theme: null },
      { notifications: {} },
      { notifications: { assigned: 'no' } },
      { notifications: { sms: true } },
      { notifications: true },
    ];
    for (const body of bad) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await patch('theme=dark')).status).toBe(400);
    expect((await me()).preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it('인증 없으면 401이고, 다른 사용자의 설정에는 영향이 없다', async () => {
    expect(
      (await request(app).patch('/api/v1/users/me/preferences').send({ theme: 'dark' })).status,
    ).toBe(401);
    const { res } = await register(app, { email: 'other@example.com', name: '다른' });
    await patch({ theme: 'dark' }, res.body.accessToken);
    expect((await me()).preferences.theme).toBe('system');
  });

  it('이름·비밀번호 변경은 설정을 지우지 않는다', async () => {
    await patch({ accent: 'rose' });
    const renamed = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(token))
      .send({ name: '새이름' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.preferences.accent).toBe('rose');
  });
});

describe('알림 설정', () => {
  it('키 단위로 병합되어 나머지 알림 설정은 유지된다', async () => {
    const first = await patch({ notifications: { comment: false } });
    expect(first.body.user.preferences.notifications).toEqual({
      assigned: true,
      due: true,
      comment: false,
      mention: true,
    });
    const second = await patch({ notifications: { mention: false }, theme: 'dark' });
    expect(second.body.user.preferences.notifications).toEqual({
      assigned: true,
      due: true,
      comment: false,
      mention: false,
    });
    expect(second.body.user.preferences.theme).toBe('dark');
    const third = await patch({ notifications: { comment: true } });
    expect(third.body.user.preferences.notifications.comment).toBe(true);
    expect(third.body.user.preferences.notifications.mention).toBe(false);
  });

  it('withDefaults 는 알림 설정에서 불리언이 아닌 값을 기본값으로 대체한다', () => {
    expect(withDefaults({ notifications: { assigned: 'x', due: false } }).notifications).toEqual({
      assigned: true,
      due: false,
      comment: true,
      mention: true,
    });
  });
});

describe('withDefaults / 클라이언트 목록', () => {
  it('저장된 값이 허용 목록에 없으면 기본값으로 대체하고, 없는 값에도 안전하다', () => {
    expect(withDefaults({ theme: 'neon', accent: 'blue', extra: 1 })).toEqual({
      ...DEFAULT_PREFERENCES,
      accent: 'blue',
    });
    expect(withDefaults(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(withDefaults(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('클라이언트의 선택지가 서버가 허용하는 값과 같다', () => {
    expect(CLIENT_THEMES.map((t) => t.value)).toEqual(THEMES);
    expect(CLIENT_ACCENTS.map((t) => t.value)).toEqual(ACCENTS);
    expect(CLIENT_DENSITIES.map((t) => t.value)).toEqual(DENSITIES);
    expect(CLIENT_VIEWS.map((t) => t.value)).toEqual(VIEWS);
    expect(CLIENT_WEEK_STARTS.map((t) => t.value)).toEqual(WEEK_STARTS);
    expect(CLIENT_TIME_FORMATS.map((t) => t.value)).toEqual(TIME_FORMATS);
    expect(CLIENT_NOTIFICATIONS.map((t) => t.value)).toEqual(NOTIFICATION_KEYS);
  });
});

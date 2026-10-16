import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset, shareRepo } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';

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
vi.mock('../modules/tasks/repository.js', async () => ({
  ...(await vi.importActual('../modules/tasks/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).tasksRepo,
}));
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).activityRepo,
}));
vi.mock('../modules/share/repository.js', async () => ({
  ...(await vi.importActual('../modules/share/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).shareRepo,
}));

const { app } = await import('../app.js');

// admin(비멤버), owner(소유자), member(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`);
  if (who) req.set(as(who));
  return body ? req.send(body) : req;
};
const createLink = (who = 'owner', days = 7, project = pid) =>
  api('post', `/projects/${project}/share-links`, who, { expiresInDays: days });
const view = (token, qs = '') => request(app).get(`/api/v1/shared/${token}${qs}`);
const UNKNOWN = 'u'.repeat(43);

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['member', '멤버'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '웹사이트 리뉴얼',
      memberIds: [people.member.id],
    })
  ).body.id;
});

describe('POST /projects/:id/share-links', () => {
  it('소유자와 Admin 은 만들 수 있고 토큰 원문은 이 응답에만 있다', async () => {
    const res = await createLink('owner', 7);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const days = (new Date(res.body.expiresAt) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect((await createLink('admin', 1)).status).toBe(201);
  });

  it('DB 에는 해시만 저장하고 원문은 저장하지 않는다', async () => {
    const { token } = (await createLink()).body;
    const row = store.shareLinks[0];
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.shareLinks)).not.toContain(token);
  });

  it('멤버·비멤버는 403, 인증이 없으면 401', async () => {
    expect((await createLink('member')).status).toBe(403);
    expect((await createLink('outsider')).status).toBe(403);
    expect(
      (await api('post', `/projects/${pid}/share-links`, null, { expiresInDays: 7 })).status,
    ).toBe(401);
    expect(store.shareLinks).toHaveLength(0);
  });

  it('만료일은 1·7·30 중 하나여야 한다 (400)', async () => {
    for (const body of [
      {},
      { expiresInDays: 2 },
      { expiresInDays: '7' },
      { expiresInDays: 0 },
      { expiresInDays: 365 },
    ]) {
      expect((await api('post', `/projects/${pid}/share-links`, 'owner', body)).status).toBe(400);
    }
  });

  it('유효한 링크는 프로젝트당 5개까지, 폐기하면 다시 만들 수 있다', async () => {
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push((await createLink()).body.id);
    const sixth = await createLink();
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe('LIMIT_REACHED');
    await api('delete', `/projects/${pid}/share-links/${ids[0]}`, 'owner');
    expect((await createLink()).status).toBe(201);
  });

  it('만료된 링크는 개수에 포함되지 않는다', async () => {
    for (let i = 0; i < 5; i += 1) await createLink();
    store.shareLinks[0].expires_at = new Date(Date.now() - 1000);
    expect((await createLink()).status).toBe(201);
  });
});

describe('GET /projects/:id/share-links', () => {
  it('소유자는 유효한 링크 목록을 보지만 토큰·해시는 보이지 않는다', async () => {
    const a = (await createLink('owner', 7)).body;
    await createLink('admin', 1);
    const res = await api('get', `/projects/${pid}/share-links`, 'owner');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((l) => l.id)).toContain(a.id);
    expect(res.body.data[0]).toMatchObject({ viewCount: 0, lastViewedAt: null });
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain(a.token);
    expect(dump).not.toContain('token_hash');
    expect(dump).not.toContain('tokenHash');
  });

  it('폐기·만료된 링크는 목록에서 빠진다', async () => {
    const a = (await createLink()).body;
    await createLink();
    await api('delete', `/projects/${pid}/share-links/${a.id}`, 'owner');
    store.shareLinks[1].expires_at = new Date(Date.now() - 1000);
    expect((await api('get', `/projects/${pid}/share-links`, 'owner')).body.data).toHaveLength(0);
  });

  it('멤버·비멤버는 목록을 볼 수 없다 (403)', async () => {
    expect((await api('get', `/projects/${pid}/share-links`, 'member')).status).toBe(403);
    expect((await api('get', `/projects/${pid}/share-links`, 'outsider')).status).toBe(403);
  });
});

describe('DELETE /projects/:id/share-links/:linkId', () => {
  it('소유자가 폐기하면 즉시 공개 조회가 막히고, 다시 폐기하면 404', async () => {
    const link = (await createLink()).body;
    expect((await view(link.token)).status).toBe(200);
    expect((await api('delete', `/projects/${pid}/share-links/${link.id}`, 'owner')).status).toBe(
      204,
    );
    expect((await view(link.token)).status).toBe(404);
    expect((await api('delete', `/projects/${pid}/share-links/${link.id}`, 'owner')).status).toBe(
      404,
    );
  });

  it('멤버는 폐기할 수 없고(403), 다른 프로젝트의 링크 ID 로는 폐기할 수 없다(404)', async () => {
    const link = (await createLink()).body;
    expect((await api('delete', `/projects/${pid}/share-links/${link.id}`, 'member')).status).toBe(
      403,
    );
    const other = (await api('post', '/projects', 'outsider', { name: '남의 프로젝트' })).body.id;
    expect(
      (await api('delete', `/projects/${other}/share-links/${link.id}`, 'outsider')).status,
    ).toBe(404);
    expect((await view(link.token)).status).toBe(200);
  });

  it('잘못된 ID 는 400', async () => {
    expect((await api('delete', `/projects/${pid}/share-links/not-a-uuid`, 'owner')).status).toBe(
      400,
    );
  });
});

describe('GET /shared/:token (공개)', () => {
  const addTask = (title = '공개될 작업') =>
    api('post', `/projects/${pid}/tasks`, 'member', { title, assigneeId: people.owner.id });

  it('로그인 없이 읽을 수 있고 응답 모양과 보안 헤더가 맞다', async () => {
    await addTask();
    const { token } = (await createLink()).body;
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.body.project).toEqual({ name: '웹사이트 리뉴얼', status: 'active' });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.data.map((a) => a.action)).toEqual(['task.created', 'project.created']);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
  });

  it('멤버 변경·공유 기록은 숨기고, 이메일 같은 개인정보는 응답에 없다', async () => {
    await api('post', `/projects/${pid}/members`, 'owner', { userId: people.outsider.id });
    await api('delete', `/projects/${pid}/members/${people.outsider.id}`, 'owner');
    await addTask();
    const { token } = (await createLink()).body;
    const res = await view(token);
    const actions = res.body.data.map((a) => a.action);
    expect(actions).not.toContain('member.added');
    expect(actions).not.toContain('member.removed');
    expect(actions).not.toContain('share.created');
    const dump = JSON.stringify(res.body);
    expect(dump).not.toContain('@example.com');
    expect(dump).not.toContain(people.outsider.id);
  });

  it('멤버에게는 공유 링크 생성·폐기가 활동 기록에 보인다', async () => {
    const link = (await createLink()).body;
    await api('delete', `/projects/${pid}/share-links/${link.id}`, 'owner');
    const feed = (await api('get', `/projects/${pid}/activities`, 'member')).body.data;
    expect(feed[0]).toMatchObject({ action: 'share.revoked', actor: { name: '소유자' } });
    expect(feed[1]).toMatchObject({ action: 'share.created', meta: { days: 7 } });
  });

  it('조회수는 첫 페이지에서만 늘고 더 보기(before)에서는 늘지 않는다', async () => {
    for (let i = 0; i < 5; i += 1) await addTask(`작업 ${i}`);
    const { token } = (await createLink()).body;
    const first = await view(token, '?limit=3');
    expect(first.body.data).toHaveLength(3);
    expect(first.body.nextCursor).toBeTruthy();
    await view(token, `?limit=3&before=${first.body.nextCursor}`);
    const row = store.shareLinks[0];
    expect(row.view_count).toBe(1);
    expect(row.last_viewed_at).toBeInstanceOf(Date);
    await view(token);
    expect(store.shareLinks[0].view_count).toBe(2);
  });

  it('커서로 끝까지 읽을 수 있다', async () => {
    for (let i = 0; i < 6; i += 1) await addTask(`작업 ${i}`);
    const { token } = (await createLink()).body;
    const ids = [];
    let cursor;
    do {
      const r = await view(token, `?limit=4${cursor ? `&before=${cursor}` : ''}`);
      ids.push(...r.body.data.map((a) => a.id));
      cursor = r.body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(7); // 프로젝트 생성 1 + 작업 6
    expect(new Set(ids).size).toBe(7);
  });

  it('없는·폐기된·만료된 토큰은 모두 같은 404 이다', async () => {
    const a = (await createLink()).body;
    const b = (await createLink()).body;
    await api('delete', `/projects/${pid}/share-links/${a.id}`, 'owner');
    store.shareLinks[1].expires_at = new Date(Date.now() - 1000);
    const bodies = [];
    for (const token of [UNKNOWN, a.token, b.token]) {
      const res = await view(token);
      expect(res.status).toBe(404);
      bodies.push(res.body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0].error.code).toBe('SHARE_LINK_NOT_FOUND');
  });

  it('형식이 이상한 토큰·쿼리는 400', async () => {
    expect((await view('short')).status).toBe(400);
    const { token } = (await createLink()).body;
    expect((await view(token, '?limit=0')).status).toBe(400);
    expect((await view(token, '?limit=51')).status).toBe(400);
    expect((await view(token, '?before=abc')).status).toBe(400);
  });

  it('보관된 프로젝트도 조회된다', async () => {
    const { token } = (await createLink()).body;
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    const res = await view(token);
    expect(res.status).toBe(200);
    expect(res.body.project.status).toBe('archived');
  });

  it('다른 프로젝트의 기록은 섞이지 않는다', async () => {
    const other = (await api('post', '/projects', 'outsider', { name: '남의 프로젝트' })).body.id;
    await api('post', `/projects/${other}/tasks`, 'outsider', { title: '비밀 작업' });
    const { token } = (await createLink()).body;
    expect(JSON.stringify((await view(token)).body)).not.toContain('비밀 작업');
  });
});

describe('정리', () => {
  it('만료·폐기된 지 30일이 지난 링크만 지운다', async () => {
    const keep = (await createLink()).body;
    const old = (await createLink()).body;
    const oldRevoked = (await createLink()).body;
    const recentRevoked = (await createLink()).body;
    const byId = (id) => store.shareLinks.find((l) => l.id === id);
    byId(old.id).expires_at = new Date(Date.now() - 40 * 86400_000);
    byId(oldRevoked.id).revoked_at = new Date(Date.now() - 40 * 86400_000);
    byId(recentRevoked.id).revoked_at = new Date(Date.now() - 2 * 86400_000);
    expect(await shareRepo.deleteStale()).toBe(2);
    expect(store.shareLinks.map((l) => l.id).sort()).toEqual([keep.id, recentRevoked.id].sort());
  });
});

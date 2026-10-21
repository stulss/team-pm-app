import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';
import { KEY_PATTERN, TASK_KEY_PATTERN, suggestKey, uniqueKey } from '../modules/projects/key.js';

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
vi.mock('../modules/comments/repository.js', async () => ({
  ...(await vi.importActual('../modules/comments/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).commentsRepo,
}));
vi.mock('../modules/notifications/repository.js', async () => ({
  ...(await vi.importActual('../modules/notifications/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).notificationsRepo,
}));
vi.mock('../modules/activity/repository.js', async () => ({
  ...(await vi.importActual('../modules/activity/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).activityRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');

// admin(첫 가입자), owner(소유자), alice(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
});

describe('suggestKey / uniqueKey', () => {
  it('영문 단어가 여럿이면 머리글자, 하나면 앞 4자, 영문이 없으면 PP', () => {
    expect(suggestKey('Mobile App Renewal')).toBe('MAR');
    expect(suggestKey('Team PM')).toBe('TP');
    expect(suggestKey('Website')).toBe('WEBS');
    expect(suggestKey('A very long project name here now')).toBe('AVLPN');
    expect(suggestKey('모바일 앱 리뉴얼')).toBe('PP');
    expect(suggestKey('앱 v2 개편')).toBe('V2');
    expect(suggestKey('')).toBe('PP');
    expect(suggestKey('x')).toBe('XP');
  });

  it('만든 키는 항상 형식을 만족한다', () => {
    for (const name of ['a', '1234', '!!!', '日本語', 'Ünïcode Näme', 'a b c d e f g h i j k l']) {
      expect(KEY_PATTERN.test(suggestKey(name)), name).toBe(true);
    }
  });

  it('겹치면 숫자를 붙이고 10자를 넘지 않는다', async () => {
    const used = new Set(['MAR', 'MAR2', 'MAR3']);
    expect(await uniqueKey('Mobile App Renewal', async (k) => used.has(k))).toBe('MAR4');
    const full = new Set(['ABCD']);
    expect(await uniqueKey('Abcde', async (k) => full.has(k))).toBe('ABCD2');
    expect((await uniqueKey('x'.repeat(30), async () => false)).length).toBeLessThanOrEqual(10);
  });

  it('작업 키 형식은 대소문자를 무시하고 번호는 6자리까지', () => {
    expect(TASK_KEY_PATTERN.exec('TPM-12').slice(1)).toEqual(['TPM', '12']);
    expect(TASK_KEY_PATTERN.exec('tpm-7').slice(1)).toEqual(['tpm', '7']);
    for (const bad of ['TPM12', 'TPM-', 'T-1', '-5', 'TPM-1234567', 'TPM-1a', ' TPM-1']) {
      expect(TASK_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('프로젝트 키', () => {
  it('키를 주지 않으면 이름에서 만들고, 같은 이름이면 숫자를 붙인다', async () => {
    const a = (await api('post', '/projects', 'owner', { name: 'Mobile App Renewal' })).body;
    const b = (await api('post', '/projects', 'owner', { name: 'Mobile App Renewal' })).body;
    expect(a.key).toBe('MAR');
    expect(b.key).toBe('MAR2');
    expect((await api('post', '/projects', 'owner', { name: '한글 프로젝트' })).body.key).toBe(
      'PP',
    );
  });

  it('직접 준 키는 대문자로 바뀌어 저장되고, 겹치거나 형식이 틀리면 거부', async () => {
    const ok = await api('post', '/projects', 'owner', { name: '하나', key: 'tpm' });
    expect(ok.status).toBe(201);
    expect(ok.body.key).toBe('TPM');
    const dup = await api('post', '/projects', 'owner', { name: '둘', key: 'TPM' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('KEY_TAKEN');
    for (const key of ['A', '1AB', 'AB-C', 'ABCDEFGHIJK', '한글']) {
      expect((await api('post', '/projects', 'owner', { name: 'x', key })).status, key).toBe(400);
    }
  });

  it('소유자·Admin 은 키를 바꿀 수 있고, 일반 멤버는 403, 겹치면 409', async () => {
    const p = (
      await api('post', '/projects', 'owner', {
        name: '키 프로젝트',
        key: 'KEYA',
        memberIds: [people.alice.id],
      })
    ).body;
    await api('post', '/projects', 'owner', { name: '다른', key: 'KEYB' });
    expect((await api('patch', `/projects/${p.id}`, 'alice', { key: 'ZZ' })).status).toBe(403);
    const changed = await api('patch', `/projects/${p.id}`, 'owner', { key: 'newkey' });
    expect(changed.body.key).toBe('NEWKEY');
    const clash = await api('patch', `/projects/${p.id}`, 'admin', { key: 'KEYB' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('KEY_TAKEN');
    expect((await api('patch', `/projects/${p.id}`, 'admin', { key: 'ADM1' })).status).toBe(200);
    expect((await api('get', '/projects', 'owner')).body.data.map((x) => x.key)).toContain('ADM1');
  });
});

describe('작업 번호와 키', () => {
  const mk = async (pid, title) =>
    (await api('post', `/projects/${pid}/tasks`, 'owner', { title })).body;

  it('프로젝트 안에서 1부터 번호가 매겨지고, 지워도 번호를 다시 쓰지 않는다', async () => {
    const pid = (await api('post', '/projects', 'owner', { name: 'T', key: 'TPM' })).body.id;
    const [t1, t2, t3] = [await mk(pid, '하나'), await mk(pid, '둘'), await mk(pid, '셋')];
    expect([t1.number, t2.number, t3.number]).toEqual([1, 2, 3]);
    expect([t1.key, t3.key]).toEqual(['TPM-1', 'TPM-3']);
    await api('delete', `/tasks/${t3.id}`, 'owner');
    expect((await mk(pid, '넷')).number).toBe(4);
    // 다른 프로젝트는 자기 번호
    const other = (await api('post', '/projects', 'owner', { name: 'O', key: 'OTH' })).body.id;
    expect((await mk(other, '첫 작업')).key).toBe('OTH-1');
  });

  it('목록·단건 응답에 번호와 키가 있고, 키를 바꾸면 새 키로 보인다', async () => {
    const p = (await api('post', '/projects', 'owner', { name: 'T', key: 'TPM' })).body;
    const t = await mk(p.id, '작업');
    const list = (await api('get', `/projects/${p.id}/tasks`, 'owner')).body.data;
    expect(list[0]).toMatchObject({ number: 1, key: 'TPM-1' });
    await api('patch', `/projects/${p.id}`, 'owner', { key: 'NEW' });
    expect((await api('get', `/tasks/${t.id}`, 'owner')).body.key).toBe('NEW-1');
  });

  it('키로 조회: 대소문자 무시, 없는 키 404, 형식 오류 400, 비멤버 403', async () => {
    const p = (
      await api('post', '/projects', 'owner', {
        name: 'T',
        key: 'TPM',
        memberIds: [people.alice.id],
      })
    ).body;
    const t = await mk(p.id, '키 작업');
    const byKey = await api('get', '/tasks/key/tpm-1', 'alice');
    expect(byKey.status).toBe(200);
    expect(byKey.body).toMatchObject({ id: t.id, key: 'TPM-1', title: '키 작업' });
    expect((await api('get', '/tasks/key/TPM-99', 'alice')).status).toBe(404);
    expect((await api('get', '/tasks/key/NOPE-1', 'alice')).status).toBe(404);
    expect((await api('get', '/tasks/key/TPM1', 'alice')).status).toBe(400);
    expect((await api('get', '/tasks/key/TPM-1', 'outsider')).status).toBe(403);
    expect((await api('get', '/tasks/key/TPM-1', 'admin')).status).toBe(200);
    expect((await request(app).get('/api/v1/tasks/key/TPM-1')).status).toBe(401);
  });
});

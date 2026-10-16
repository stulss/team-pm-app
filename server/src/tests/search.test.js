import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset } from './helpers/memoryRepos.js';
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
vi.mock('../modules/chat/repository.js', async () => ({
  ...(await vi.importActual('../modules/chat/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).chatRepo,
}));
vi.mock('../modules/search/repository.js', async () => ({
  ...(await vi.importActual('../modules/search/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).searchRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { snippet, likePattern } = await import('../modules/search/service.js');

// admin(첫 가입자), owner(프로젝트 A 소유·멤버), member(A 멤버), other(프로젝트 B 소유)
const people = {};
const as = (who) => bearer(people[who].token);
let pidA;
let pidB;
let taskA;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const find = (who, q, extra = '') => api('get', `/search?q=${encodeURIComponent(q)}${extra}`, who);

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['member', '멤버'],
    ['other', '다른팀'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pidA = (
    await api('post', '/projects', 'owner', {
      name: '알파 프로젝트',
      memberIds: [people.member.id],
    })
  ).body.id;
  pidB = (await api('post', '/projects', 'other', { name: '베타 프로젝트' })).body.id;

  taskA = (
    await api('post', `/projects/${pidA}/tasks`, 'owner', {
      title: '로그인 화면 만들기',
      description: '비밀번호 재설정 링크도 함께 넣는다',
    })
  ).body.id;
  await api('post', `/projects/${pidB}/tasks`, 'other', { title: '로그인 비밀 작업' });
  await api('post', `/tasks/${taskA}/comments`, 'owner', { body: '로그인 버튼 색을 정해야 해요' });
  await api('post', `/projects/${pidA}/chat`, 'member', { body: '로그인 이슈 확인 부탁드려요' });
  await api('post', `/projects/${pidB}/chat`, 'other', { body: '로그인 이야기는 여기서' });
});

describe('접근 권한', () => {
  it('인증 없으면 401', async () => {
    expect((await request(app).get('/api/v1/search?q=로그인')).status).toBe(401);
  });

  it('내가 멤버인 프로젝트의 결과만 나온다 (다른 프로젝트는 모든 종류에서 제외)', async () => {
    const { body } = await find('owner', '로그인');
    expect(body.tasks.map((t) => t.projectId)).toEqual([pidA]);
    expect(body.comments.map((c) => c.projectId)).toEqual([pidA]);
    expect(body.chat.map((m) => m.projectId)).toEqual([pidA]);
    const other = await find('other', '로그인');
    expect(other.body.tasks.map((t) => t.projectId)).toEqual([pidB]);
    expect(other.body.chat.map((m) => m.projectId)).toEqual([pidB]);
    expect(other.body.comments).toEqual([]);
  });

  it('프로젝트 이름도 접근 가능한 것만 나온다', async () => {
    expect((await find('owner', '프로젝트')).body.projects.map((p) => p.name)).toEqual([
      '알파 프로젝트',
    ]);
  });

  it('Admin 은 모든 프로젝트를 검색한다', async () => {
    const { body } = await find('admin', '로그인');
    expect(body.tasks.map((t) => t.projectId).sort()).toEqual([pidA, pidB].sort());
    expect(body.projects.length).toBe(0);
    expect((await find('admin', '프로젝트')).body.projects).toHaveLength(2);
  });

  it('멤버에서 제거되면 그 프로젝트의 결과가 즉시 사라진다', async () => {
    expect((await find('member', '로그인')).body.chat).toHaveLength(1);
    await api('delete', `/projects/${pidA}/members/${people.member.id}`, 'owner');
    const { body } = await find('member', '로그인');
    expect(body.tasks).toEqual([]);
    expect(body.comments).toEqual([]);
    expect(body.chat).toEqual([]);
  });
});

describe('검색 동작', () => {
  it('대소문자를 구분하지 않는 부분 일치', async () => {
    await api('post', `/projects/${pidA}/tasks`, 'owner', { title: 'Deploy Pipeline' });
    const { body } = await find('owner', 'pipe');
    expect(body.tasks.map((t) => t.title)).toEqual(['Deploy Pipeline']);
    expect((await find('owner', 'PIPELINE')).body.tasks).toHaveLength(1);
  });

  it('설명에만 일치해도 찾고, 그 주변을 snippet 으로 준다 (제목 일치는 snippet 없음)', async () => {
    const byDesc = (await find('owner', '재설정')).body.tasks;
    expect(byDesc).toHaveLength(1);
    expect(byDesc[0].snippet).toContain('재설정');
    const byTitle = (await find('owner', '화면')).body.tasks;
    expect(byTitle[0].snippet).toBeNull();
  });

  it('댓글과 채팅 결과에 작성자·작업 제목·snippet 이 있다', async () => {
    const { body } = await find('owner', '로그인');
    expect(body.comments[0]).toMatchObject({
      taskId: taskA,
      taskTitle: '로그인 화면 만들기',
      projectName: '알파 프로젝트',
      author: { name: '소유자' },
    });
    expect(body.comments[0].snippet).toContain('로그인 버튼');
    expect(body.chat[0]).toMatchObject({ author: { name: '멤버' }, projectName: '알파 프로젝트' });
  });

  it('삭제된 댓글은 검색되지 않는다', async () => {
    const list = await api('get', `/tasks/${taskA}/comments`, 'owner');
    await api('delete', `/comments/${list.body.data[0].id}`, 'owner');
    expect((await find('owner', '버튼')).body.comments).toEqual([]);
  });

  it('% _ \\ 는 와일드카드가 아니라 글자 그대로 찾는다', async () => {
    await api('post', `/projects/${pidA}/chat`, 'owner', { body: '진행률 100% 달성' });
    await api('post', `/projects/${pidA}/chat`, 'owner', { body: '100 달성' });
    expect((await find('owner', '100%')).body.chat).toHaveLength(1);
    expect((await find('owner', '%%')).body.chat).toEqual([]);
    expect((await find('owner', '__')).body.chat).toEqual([]);
    expect(likePattern('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
  });

  it('type 으로 한 종류만 찾고, limit 로 건수를 제한한다', async () => {
    for (let i = 0; i < 4; i += 1) {
      await api('post', `/projects/${pidA}/chat`, 'owner', { body: `반복 메시지 ${i}` });
    }
    const only = (await find('owner', '메시지', '&type=chat&limit=3')).body;
    expect(only.chat).toHaveLength(3);
    expect(only.tasks).toEqual([]);
    expect(only.projects).toEqual([]);
  });

  it('결과가 없으면 빈 배열들', async () => {
    expect((await find('owner', '존재하지않는말')).body).toEqual({
      projects: [],
      tasks: [],
      comments: [],
      chat: [],
    });
  });
});

describe('검증', () => {
  it('검색어 1자·51자·없음, 잘못된 type·limit 은 400', async () => {
    for (const qs of [
      '?q=a',
      `?q=${'a'.repeat(51)}`,
      '',
      '?q=ab&type=nope',
      '?q=ab&limit=0',
      '?q=ab&limit=21',
    ]) {
      expect((await api('get', `/search${qs}`, 'owner')).status, qs).toBe(400);
    }
    expect((await api('get', '/search?q=   ab  ', 'owner')).status).toBe(200);
  });
});

describe('snippet', () => {
  it('일치 주변만 잘라 앞뒤에 …을 붙이고 공백을 한 칸으로 줄인다', () => {
    const text = `${'가'.repeat(100)}  찾는말\n뒤${'나'.repeat(100)}`;
    const s = snippet(text, '찾는말');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('찾는말 뒤');
    expect(s.length).toBeLessThan(100);
  });

  it('짧은 글은 그대로, 일치가 없거나 빈 값이면 null', () => {
    expect(snippet('짧은 글', '짧은')).toBe('짧은 글');
    expect(snippet('내용', '없음')).toBeNull();
    expect(snippet(null, 'x')).toBeNull();
  });
});

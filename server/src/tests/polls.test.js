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
// 상한을 작게 시험하려고 프로젝트당 3개로 줄인다.
vi.mock('../modules/polls/repository.js', async () => ({
  ...(await vi.importActual('../modules/polls/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).pollsRepo,
  MAX_POLLS_PER_PROJECT: 3,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice·bob(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const mkPoll = (who, extra = {}, id = pid) =>
  api('post', `/projects/${id}/polls`, who, {
    question: '점심 뭐 먹을까요?',
    options: ['한식', '중식', '일식'],
    ...extra,
  });
const castVote = (who, poll, picks, id = pid) =>
  api('put', `/projects/${id}/polls/${poll.id}/vote`, who, {
    optionIds: picks.map((i) => poll.options[i].id),
  });
const polls = async (who = 'owner') => (await api('get', `/projects/${pid}/polls`, who)).body.data;

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['bob', '밥'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '투표 프로젝트',
      memberIds: [people.alice.id, people.bob.id],
    })
  ).body.id;
});

describe('접근과 만들기', () => {
  it('멤버는 만들고 읽을 수 있고, 비멤버는 403, 인증 없으면 401', async () => {
    const created = await mkPoll('alice');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      question: '점심 뭐 먹을까요?',
      multiple: false,
      closed: false,
      createdBy: { id: people.alice.id, name: '앨리스' },
      totalVoters: 0,
      myVotes: [],
    });
    expect(created.body.options.map((o) => [o.label, o.votes])).toEqual([
      ['한식', 0],
      ['중식', 0],
      ['일식', 0],
    ]);
    expect((await api('get', `/projects/${pid}/polls`, 'bob')).body.data).toHaveLength(1);
    expect((await api('get', `/projects/${pid}/polls`, 'admin')).status).toBe(200);
    expect((await api('get', `/projects/${pid}/polls`, 'outsider')).status).toBe(403);
    expect((await mkPoll('outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/polls`)).status).toBe(401);
  });

  it('입력 검증: 선택지 2~10개, 빈 값·긴 값·중복(대소문자 무시)은 400', async () => {
    const bad = [
      { options: ['하나'] },
      { options: Array.from({ length: 11 }, (_, i) => `선택 ${i}`) },
      { options: ['가', '   '] },
      { options: ['가', 'a'.repeat(101)] },
      { options: ['Pizza', ' pizza '] },
      { question: '   ' },
      { question: 'q'.repeat(201) },
      { multiple: 'yes' },
    ];
    for (const extra of bad) {
      expect((await mkPoll('alice', extra)).status, JSON.stringify(extra).slice(0, 40)).toBe(400);
    }
    expect(
      (await mkPoll('alice', { options: Array.from({ length: 10 }, (_, i) => `${i}`) })).status,
    ).toBe(201);
  });

  it('프로젝트당 상한(테스트에서는 3개)을 넘으면 409 LIMIT_REACHED', async () => {
    for (let i = 0; i < 3; i += 1) expect((await mkPoll('alice')).status).toBe(201);
    const over = await mkPoll('alice');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LIMIT_REACHED');
  });

  it('목록은 최신순이고 다른 프로젝트의 투표는 섞이지 않는다', async () => {
    await mkPoll('alice', { question: '첫째' });
    await mkPoll('alice', { question: '둘째' });
    const other = (await api('post', '/projects', 'owner', { name: '다른 곳' })).body.id;
    await mkPoll('owner', { question: '남의 것' }, other);
    expect((await polls()).map((p) => p.question)).toEqual(['둘째', '첫째']);
  });
});

describe('투표하기', () => {
  let poll;
  beforeEach(async () => {
    poll = (await mkPoll('owner')).body;
  });

  it('고른 선택지의 득표와 내 선택이 반영되고, 마감 전에는 바꾸거나 취소할 수 있다', async () => {
    let res = await castVote('alice', poll, [0]);
    expect(res.status).toBe(200);
    expect(res.body.options.map((o) => o.votes)).toEqual([1, 0, 0]);
    expect(res.body.myVotes).toEqual([poll.options[0].id]);
    expect(res.body.totalVoters).toBe(1);

    await castVote('bob', poll, [0]);
    res = await castVote('alice', poll, [1]); // 바꾸기: 한 표만 남는다
    expect(res.body.options.map((o) => o.votes)).toEqual([1, 1, 0]);
    expect(res.body.myVotes).toEqual([poll.options[1].id]);
    expect(res.body.totalVoters).toBe(2);

    res = await castVote('alice', poll, []); // 취소
    expect(res.body.options.map((o) => o.votes)).toEqual([1, 0, 0]);
    expect(res.body.myVotes).toEqual([]);
    expect(res.body.totalVoters).toBe(1);
  });

  it('같은 사람이 같은 선택지를 여러 번 눌러도 한 표', async () => {
    await castVote('alice', poll, [2]);
    await castVote('alice', poll, [2]);
    expect((await polls())[0].options.map((o) => o.votes)).toEqual([0, 0, 1]);
  });

  it('단일 선택에 2개, 중복 ID, 없는 선택지, 다른 투표의 선택지는 400 INVALID_VOTE', async () => {
    const other = (await mkPoll('owner', { question: '다른 투표' })).body;
    const cases = [
      [poll.options[0].id, poll.options[1].id],
      [poll.options[0].id, poll.options[0].id],
      [crypto.randomUUID()],
      [other.options[0].id],
    ];
    for (const optionIds of cases) {
      const res = await api('put', `/projects/${pid}/polls/${poll.id}/vote`, 'alice', {
        optionIds,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_VOTE');
    }
    expect(
      (await api('put', `/projects/${pid}/polls/${poll.id}/vote`, 'alice', { optionIds: ['x'] }))
        .status,
    ).toBe(400);
    expect((await polls())[0].totalVoters).toBe(0);
  });

  it('복수 선택 투표는 여러 개를 고를 수 있다', async () => {
    const multi = (await mkPoll('owner', { question: '복수', multiple: true })).body;
    const res = await castVote('alice', multi, [0, 2]);
    expect(res.body.options.map((o) => o.votes)).toEqual([1, 0, 1]);
    expect(res.body.totalVoters).toBe(1);
    expect(res.body.myVotes).toHaveLength(2);
  });

  it('익명 집계: 응답에 다른 사람의 선택은 없고 본인 선택만 있다', async () => {
    await castVote('alice', poll, [0]);
    const forBob = (await api('get', `/projects/${pid}/polls`, 'bob')).body;
    const text = JSON.stringify(forBob);
    expect(forBob.data[0].myVotes).toEqual([]);
    expect(text).not.toContain(people.alice.id); // 투표한 사람은 드러나지 않는다
    expect(text).not.toContain('앨리스');
    expect(Object.keys(forBob.data[0]).sort()).toEqual(
      [
        'closed',
        'closedAt',
        'createdAt',
        'createdBy',
        'id',
        'multiple',
        'myVotes',
        'options',
        'question',
        'totalVoters',
      ].sort(),
    );
  });

  it('멤버에서 제거되면 그 사람의 표는 집계에서 빠진다', async () => {
    await castVote('alice', poll, [0]);
    await castVote('bob', poll, [0]);
    await api('delete', `/projects/${pid}/members/${people.bob.id}`, 'owner');
    const [after] = await polls();
    expect(after.options.map((o) => o.votes)).toEqual([1, 0, 0]);
    expect(after.totalVoters).toBe(1);
    expect((await castVote('bob', poll, [1])).status).toBe(403);
  });

  it('없는 투표·다른 프로젝트의 투표는 404, 잘못된 ID 는 400', async () => {
    const other = (await api('post', '/projects', 'owner', { name: '다른 곳' })).body.id;
    const res = await api('put', `/projects/${other}/polls/${poll.id}/vote`, 'owner', {
      optionIds: [],
    });
    expect(res.status).toBe(404);
    const missing = await api(
      'put',
      `/projects/${pid}/polls/${crypto.randomUUID()}/vote`,
      'alice',
      { optionIds: [] },
    );
    expect(missing.status).toBe(404);
    expect(
      (await api('put', `/projects/${pid}/polls/nope/vote`, 'alice', { optionIds: [] })).status,
    ).toBe(400);
  });
});

describe('마감과 삭제', () => {
  let poll;
  beforeEach(async () => {
    poll = (await mkPoll('alice')).body;
    await castVote('bob', poll, [0]);
  });
  const close = (who) => api('post', `/projects/${pid}/polls/${poll.id}/close`, who);

  it('만든 사람·소유자·Admin 은 마감할 수 있고, 다른 멤버는 403', async () => {
    expect((await close('bob')).status).toBe(403);
    expect((await close('outsider')).status).toBe(403);
    for (const who of ['alice', 'owner', 'admin']) {
      const fresh = (await mkPoll('alice', { question: `마감 ${who}` })).body;
      const res = await api('post', `/projects/${pid}/polls/${fresh.id}/close`, who);
      expect(res.status, who).toBe(200);
      expect(res.body.closed).toBe(true);
      await api('delete', `/projects/${pid}/polls/${fresh.id}`, 'owner'); // 상한(3개) 안에 머물게 정리
    }
  });

  it('마감하면 결과는 유지되고 투표는 409 POLL_CLOSED, 다시 마감해도 같은 결과', async () => {
    const res = await close('alice');
    expect(res.body).toMatchObject({ closed: true, totalVoters: 1 });
    expect(res.body.closedAt).toBeTruthy();
    const late = await castVote('bob', poll, [1]);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('POLL_CLOSED');
    expect((await castVote('alice', poll, [])).status).toBe(409); // 취소도 불가
    const again = await close('owner');
    expect(again.status).toBe(200);
    expect(again.body.options.map((o) => o.votes)).toEqual([1, 0, 0]);
  });

  it('삭제는 만든 사람·소유자·Admin 만, 표도 함께 사라진다', async () => {
    const del = (who) => api('delete', `/projects/${pid}/polls/${poll.id}`, who);
    expect((await del('bob')).status).toBe(403);
    expect((await del('alice')).status).toBe(204);
    expect(await polls()).toEqual([]);
    expect((await del('owner')).status).toBe(404);
    const second = (await mkPoll('bob')).body;
    expect((await api('delete', `/projects/${pid}/polls/${second.id}`, 'admin')).status).toBe(204);
  });
});

describe('보관된 프로젝트는 읽기 전용', () => {
  it('읽기는 되고 만들기·투표·마감·삭제는 409 PROJECT_ARCHIVED', async () => {
    const poll = (await mkPoll('alice')).body;
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect(await polls()).toHaveLength(1);
    const calls = [
      mkPoll('alice'),
      castVote('bob', poll, [0]),
      api('post', `/projects/${pid}/polls/${poll.id}/close`, 'alice'),
      api('delete', `/projects/${pid}/polls/${poll.id}`, 'alice'),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PROJECT_ARCHIVED');
    }
  });
});

describe('실시간', () => {
  it('만들기·투표·마감·삭제는 poll:changed 를 프로젝트 방에 보낸다', async () => {
    emitToProject.mockClear();
    const poll = (await mkPoll('alice')).body;
    await castVote('bob', poll, [0]);
    await api('post', `/projects/${pid}/polls/${poll.id}/close`, 'alice');
    await api('delete', `/projects/${pid}/polls/${poll.id}`, 'alice');
    const events = emitToProject.mock.calls.filter((c) => c[2] === 'poll:changed');
    expect(events).toHaveLength(4);
    expect(events.every((c) => c[1] === pid && c[3].pollId === poll.id)).toBe(true);
  });

  it('실패한 요청은 이벤트를 보내지 않는다', async () => {
    emitToProject.mockClear();
    await mkPoll('outsider');
    await mkPoll('alice', { options: ['하나'] });
    expect(emitToProject).not.toHaveBeenCalled();
  });
});

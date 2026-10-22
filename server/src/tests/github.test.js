import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { reset, store } from './helpers/memoryRepos.js';
import { bearer, register } from './helpers/setup.js';
import { signBody, webhookSecret } from '../modules/github/parse.js';
import { env } from '../config/env.js';

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
vi.mock('../modules/github/repository.js', async () => ({
  ...(await vi.importActual('../modules/github/repository.js')),
  ...(await import('./helpers/memoryRepos.js')).githubRepo,
}));
vi.mock('../sockets/emitter.js', async () => ({
  ...(await vi.importActual('../sockets/emitter.js')),
  emitToProject: vi.fn(async () => {}),
  emitToUser: vi.fn(async () => {}),
}));

const { app } = await import('../app.js');
const { emitToProject } = await import('../sockets/emitter.js');

// admin(첫 가입자, 비멤버), owner(소유자), alice(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let connection; // GET /projects/:id/github 의 connection

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const mkTask = async (title, extra = {}) =>
  (await api('post', `/projects/${pid}/tasks`, 'owner', { title, ...extra })).body;
const connect = (who = 'owner', body = { repo: 'octo/hello' }) =>
  api('put', `/projects/${pid}/github`, who, body);

let deliverySeq = 0;
// 서명한 웹훅을 보낸다. secret 을 생략하면 올바른 비밀로 서명한다.
const hook = (
  event,
  payload,
  { secret, delivery, id, signature, contentType = 'application/json' } = {},
) => {
  // 문자열 그대로 보내야 서명한 바이트와 서버가 받는 바이트가 같다(Buffer 는 supertest 가 JSON 으로 바꿔 버린다).
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const key =
    secret ??
    webhookSecret(
      store.githubConnections.find((c) => c.id === (id ?? connection.id)),
      env.JWT_REFRESH_SECRET,
    );
  const req = request(app)
    .post(`/api/webhooks/github/${id ?? connection.id}`)
    .set('content-type', contentType)
    .set('x-github-event', event)
    .set('x-hub-signature-256', signature ?? signBody(key, Buffer.from(text)));
  if (delivery !== null) req.set('x-github-delivery', delivery ?? `d-${(deliverySeq += 1)}`);
  return req.send(text);
};
const pr = (action, over = {}) => ({
  action,
  repository: { full_name: 'octo/hello' },
  pull_request: {
    number: 7,
    title: 'Fix login',
    body: '',
    html_url: 'https://github.com/octo/hello/pull/7',
    state: 'open',
    merged: false,
    draft: false,
    head: { ref: 'feature/x' },
    user: { login: 'octocat' },
    ...over,
  },
});
const links = async (taskId, who = 'alice') =>
  (await api('get', `/tasks/${taskId}/github-links`, who)).body.data;
const statusOf = async (taskId) => (await api('get', `/tasks/${taskId}`, 'owner')).body.status;

beforeEach(async () => {
  reset();
  vi.clearAllMocks();
  deliverySeq = 0;
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['alice', '앨리스'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: 'GH 프로젝트',
      key: 'TPM',
      memberIds: [people.alice.id],
    })
  ).body.id;
  connection = (await connect()).body.connection;
});

describe('연결 관리', () => {
  it('소유자·Admin 만 보고 바꾼다 (멤버 403, 비멤버 403, 인증 없으면 401)', async () => {
    expect((await api('get', `/projects/${pid}/github`, 'alice')).status).toBe(403);
    expect((await api('get', `/projects/${pid}/github`, 'outsider')).status).toBe(403);
    expect((await connect('alice')).status).toBe(403);
    expect((await api('delete', `/projects/${pid}/github`, 'alice')).status).toBe(403);
    expect((await api('post', `/projects/${pid}/github/rotate-secret`, 'alice')).status).toBe(403);
    expect((await request(app).get(`/api/v1/projects/${pid}/github`)).status).toBe(401);
    expect((await api('get', `/projects/${pid}/github`, 'admin')).status).toBe(200);
  });

  it('연결하면 웹훅 주소와 비밀을 돌려주고, 저장소는 owner/repo 로 정리된다', async () => {
    const res = await connect('owner', {
      repo: 'https://github.com/Octo/Hello.git',
      doneOnMerge: true,
    });
    expect(res.status).toBe(200);
    const c = res.body.connection;
    expect(c).toMatchObject({
      repo: 'Octo/Hello',
      moveOnOpen: false,
      doneOnMerge: true,
      lastEventAt: null,
    });
    expect(c.webhookUrl).toMatch(new RegExp(`/api/webhooks/github/${c.id}$`));
    expect(c.secret).toBe(webhookSecret({ id: c.id, secret_version: 1 }, env.JWT_REFRESH_SECRET));
    const got = (await api('get', `/projects/${pid}/github`, 'owner')).body.connection;
    expect(got.secret).toBe(c.secret);
  });

  it('연결 전에는 connection 이 null 이고, 잘못된 저장소는 400', async () => {
    const other = (await api('post', '/projects', 'owner', { name: '다른', key: 'OTH' })).body.id;
    expect((await api('get', `/projects/${other}/github`, 'owner')).body).toEqual({
      connection: null,
    });
    for (const repo of ['', 'octo', 'a b/c', 123]) {
      expect((await connect('owner', { repo })).status, String(repo)).toBe(400);
    }
  });

  it('같은 저장소를 다른 프로젝트에 연결할 수 없다 (대소문자 무시, 409 REPO_TAKEN)', async () => {
    const other = (await api('post', '/projects', 'owner', { name: '다른', key: 'OTH' })).body.id;
    const res = await api('put', `/projects/${other}/github`, 'owner', { repo: 'OCTO/hello' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REPO_TAKEN');
    // 같은 프로젝트가 저장소·옵션을 바꾸는 것은 허용
    expect(
      (await connect('owner', { repo: 'octo/hello', moveOnOpen: true })).body.connection.moveOnOpen,
    ).toBe(true);
  });

  it('비밀 재발급은 이전 비밀을 즉시 무효로 한다', async () => {
    const before = connection.secret;
    const rotated = (await api('post', `/projects/${pid}/github/rotate-secret`, 'owner')).body
      .connection;
    expect(rotated.secret).not.toBe(before);
    expect(rotated.id).toBe(connection.id);
    const oldSigned = await hook('ping', { zen: 'x' }, { secret: before });
    expect(oldSigned.status).toBe(401);
    expect((await hook('ping', { zen: 'x' }, { secret: rotated.secret })).status).toBe(200);
  });

  it('연결을 해제하면 웹훅은 401, 해제를 다시 해도 204', async () => {
    expect((await api('delete', `/projects/${pid}/github`, 'owner')).status).toBe(204);
    expect((await api('delete', `/projects/${pid}/github`, 'owner')).status).toBe(204);
    expect((await hook('ping', {}, { secret: connection.secret })).status).toBe(401);
    expect((await api('get', `/projects/${pid}/github`, 'owner')).body.connection).toBeNull();
  });

  it('보관된 프로젝트는 연결을 바꿀 수 없다 (409)', async () => {
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await connect('owner', { repo: 'octo/other' })).status).toBe(409);
    expect((await api('post', `/projects/${pid}/github/rotate-secret`, 'owner')).status).toBe(409);
  });
});

describe('웹훅 인증', () => {
  it('서명이 없거나 틀리면 401, 없는 연결도 같은 401, 본문이 바뀌면 401', async () => {
    expect((await hook('ping', {}, { signature: 'sha256=00' })).status).toBe(401);
    const noHeader = await request(app)
      .post(`/api/webhooks/github/${connection.id}`)
      .set('content-type', 'application/json')
      .send('{}');
    expect(noHeader.status).toBe(401);
    expect(
      (
        await hook(
          'ping',
          {},
          { id: '00000000-0000-4000-8000-000000000000', secret: 'x', signature: 'sha256=00' },
        )
      ).status,
    ).toBe(401);
    expect((await request(app).post('/api/webhooks/github/not-a-uuid').send('{}')).status).toBe(
      401,
    );
    // 서명은 원본 본문에 대한 것이므로 본문을 바꾸면 거부
    const body = JSON.stringify({ zen: 'a' });
    const sig = signBody(connection.secret, Buffer.from(body));
    const tampered = await request(app)
      .post(`/api/webhooks/github/${connection.id}`)
      .set('content-type', 'application/json')
      .set('x-github-event', 'ping')
      .set('x-github-delivery', 'd-t')
      .set('x-hub-signature-256', sig)
      .send(JSON.stringify({ zen: 'b' }));
    expect(tampered.status).toBe(401);
  });

  it('ping 은 200 pong, JSON 이 아닌 Content-Type 은 415, 깨진 JSON 은 400, 전달 id 가 없으면 400', async () => {
    const ping = await hook('ping', { zen: 'x' });
    expect(ping.status).toBe(200);
    expect(ping.body).toMatchObject({ ok: true, pong: true });
    expect(
      (await hook('ping', 'payload=%7B%7D', { contentType: 'application/x-www-form-urlencoded' }))
        .status,
    ).toBe(415);
    expect((await hook('ping', '{not json')).status).toBe(400);
    expect((await hook('ping', {}, { delivery: null })).status).toBe(400);
  });

  it('같은 전달 id 를 다시 받으면 처리하지 않는다 (duplicate)', async () => {
    const t = await mkTask('작업');
    const body = pr('opened', { title: `TPM-${t.number} 작업` });
    const first = await hook('pull_request', body, { delivery: 'same' });
    const again = await hook('pull_request', body, { delivery: 'same' });
    expect(first.body.linked).toBe(1);
    expect(again.body).toEqual({ ok: true, duplicate: true });
    expect(await links(t.id)).toHaveLength(1);
  });

  it('다른 저장소의 페이로드는 202 로 무시하고, 처리하지 않는 이벤트는 200 ignored', async () => {
    const t = await mkTask('작업');
    const other = pr('opened', { title: `TPM-${t.number}` });
    other.repository.full_name = 'someone/else';
    const res = await hook('pull_request', other);
    expect(res.status).toBe(202);
    expect(await links(t.id)).toEqual([]);
    const issues = await hook('issue_comment', { action: 'created' });
    expect(issues.status).toBe(200);
    expect(issues.body.ignored).toBe('issue_comment');
  });

  it('처리하면 연결의 마지막 이벤트 시각이 갱신된다', async () => {
    expect(
      (await api('get', `/projects/${pid}/github`, 'owner')).body.connection.lastEventAt,
    ).toBeNull();
    await hook('ping', {});
    expect(
      (await api('get', `/projects/${pid}/github`, 'owner')).body.connection.lastEventAt,
    ).toBeNull(); // ping 은 기록하지 않음
    const t = await mkTask('작업');
    await hook('pull_request', pr('opened', { title: `TPM-${t.number}` }));
    expect(
      (await api('get', `/projects/${pid}/github`, 'owner')).body.connection.lastEventAt,
    ).not.toBeNull();
  });
});

describe('PR 연결', () => {
  it('제목·본문·브랜치 이름의 작업 키로 연결하고, 작업 응답에 pullRequests 가 실린다', async () => {
    const [a, b, c] = [await mkTask('하나'), await mkTask('둘'), await mkTask('셋')];
    const res = await hook(
      'pull_request',
      pr('opened', {
        title: `[TPM-${a.number}] 로그인`,
        body: `closes tpm-${b.number}`,
        head: { ref: `feature/tpm-${c.number}-x` },
      }),
    );
    expect(res.body).toMatchObject({ ok: true, tasks: 3, linked: 3, moved: 0 });
    for (const t of [a, b, c]) {
      const [l] = await links(t.id);
      expect(l).toMatchObject({
        kind: 'pull_request',
        externalId: '7',
        state: 'open',
        author: 'octocat',
        title: expect.stringContaining('로그인'),
      });
    }
    const task = (await api('get', `/tasks/${a.id}`, 'alice')).body;
    expect(task.pullRequests).toEqual([
      { number: '7', state: 'open', url: 'https://github.com/octo/hello/pull/7' },
    ]);
  });

  it('다른 프로젝트 키·없는 번호는 연결하지 않는다', async () => {
    const t = await mkTask('작업');
    const res = await hook(
      'pull_request',
      pr('opened', { title: `OTHER-${t.number} TPM-999 UTF-8` }),
    );
    expect(res.body).toMatchObject({ tasks: 0, linked: 0 });
    expect(await links(t.id)).toEqual([]);
  });

  it('PR 상태가 바뀌면 같은 연결을 갱신하고(중복 행 없음) 활동 기록을 남긴다', async () => {
    const t = await mkTask('작업');
    const title = `TPM-${t.number} 작업`;
    await hook('pull_request', pr('opened', { title }));
    await hook('pull_request', pr('closed', { title, state: 'closed', merged: true }));
    const all = await links(t.id);
    expect(all).toHaveLength(1);
    expect(all[0].state).toBe('merged');
    const acts = (
      await api('get', `/projects/${pid}/activities?taskId=${t.id}`, 'owner')
    ).body.data.map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['github.linked', 'github.pr_state']));
    // 같은 상태의 edited 이벤트는 기록을 늘리지 않는다
    const count = acts.length;
    await hook('pull_request', pr('edited', { title, state: 'closed', merged: true }));
    expect(
      (await api('get', `/projects/${pid}/activities?taskId=${t.id}`, 'owner')).body.data,
    ).toHaveLength(count);
  });

  it('작업 응답의 pullRequests 는 최근 3건만, 연결 목록은 멤버만 본다', async () => {
    const t = await mkTask('작업');
    for (const n of [1, 2, 3, 4]) {
      await hook(
        'pull_request',
        pr('opened', {
          number: n,
          title: `TPM-${t.number} #${n}`,
          html_url: `https://github.com/octo/hello/pull/${n}`,
        }),
      );
    }
    expect(await links(t.id)).toHaveLength(4);
    const task = (await api('get', `/tasks/${t.id}`, 'alice')).body;
    expect(task.pullRequests.map((p) => p.number)).toEqual(['4', '3', '2']);
    expect((await api('get', `/tasks/${t.id}/github-links`, 'outsider')).status).toBe(403);
    expect((await request(app).get(`/api/v1/tasks/${t.id}/github-links`)).status).toBe(401);
  });

  it('연결·상태 이동은 task:updated 로 실시간에 알린다', async () => {
    const t = await mkTask('작업');
    emitToProject.mockClear();
    await hook('pull_request', pr('opened', { title: `TPM-${t.number}` }));
    const updates = emitToProject.mock.calls.filter((c) => c[2] === 'task:updated');
    expect(updates).toHaveLength(1);
    expect(updates[0][3].task.pullRequests).toHaveLength(1);
  });
});

describe('자동 상태 이동 (옵션)', () => {
  it('기본은 꺼져 있어 상태를 바꾸지 않는다', async () => {
    const t = await mkTask('작업');
    await hook('pull_request', pr('opened', { title: `TPM-${t.number}` }));
    await hook(
      'pull_request',
      pr('closed', { title: `TPM-${t.number}`, state: 'closed', merged: true }),
    );
    expect(await statusOf(t.id)).toBe('todo');
  });

  it('PR 이 열리면 할 일 → 진행 중, draft 는 이동하지 않고 draft 해제 때 이동한다', async () => {
    await connect('owner', { repo: 'octo/hello', moveOnOpen: true });
    const [a, b] = [await mkTask('하나'), await mkTask('둘')];
    await hook('pull_request', pr('opened', { number: 1, title: `TPM-${a.number}`, draft: true }));
    expect(await statusOf(a.id)).toBe('todo');
    await hook(
      'pull_request',
      pr('ready_for_review', { number: 1, title: `TPM-${a.number}`, draft: false }),
    );
    expect(await statusOf(a.id)).toBe('in_progress');
    await hook('pull_request', pr('opened', { number: 2, title: `TPM-${b.number}` }));
    expect(await statusOf(b.id)).toBe('in_progress');
  });

  it('이미 진행된 작업(검토·완료)은 PR 이 열려도 되돌리지 않는다', async () => {
    await connect('owner', { repo: 'octo/hello', moveOnOpen: true });
    const [r, d] = [
      await mkTask('검토', { status: 'review' }),
      await mkTask('완료', { status: 'done' }),
    ];
    await hook('pull_request', pr('opened', { title: `TPM-${r.number} TPM-${d.number}` }));
    expect(await statusOf(r.id)).toBe('review');
    expect(await statusOf(d.id)).toBe('done');
  });

  it('PR 이 머지되면 완료로 옮기고(completedAt), 머지 없이 닫히면 옮기지 않는다', async () => {
    await connect('owner', { repo: 'octo/hello', doneOnMerge: true });
    const [a, b] = [await mkTask('머지됨'), await mkTask('닫힘')];
    await hook(
      'pull_request',
      pr('closed', { number: 1, title: `TPM-${a.number}`, state: 'closed', merged: true }),
    );
    await hook(
      'pull_request',
      pr('closed', { number: 2, title: `TPM-${b.number}`, state: 'closed', merged: false }),
    );
    const done = (await api('get', `/tasks/${a.id}`, 'owner')).body;
    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();
    expect(await statusOf(b.id)).toBe('todo');
    // 자동 이동은 행위자 없는 task.moved 로 기록된다
    const moved = (
      await api('get', `/projects/${pid}/activities?taskId=${a.id}`, 'owner')
    ).body.data.find((x) => x.action === 'task.moved');
    expect(moved.actor).toBeNull();
    expect(moved.meta).toMatchObject({ from: 'todo', to: 'done', via: 'github' });
  });

  it('보관된 프로젝트에서는 연결은 갱신해도 상태는 옮기지 않는다', async () => {
    await connect('owner', { repo: 'octo/hello', doneOnMerge: true });
    const t = await mkTask('작업');
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    await hook(
      'pull_request',
      pr('closed', { title: `TPM-${t.number}`, state: 'closed', merged: true }),
    );
    expect(await statusOf(t.id)).toBe('todo');
    expect(await links(t.id)).toHaveLength(1);
  });
});

describe('커밋 연결 (push)', () => {
  const push = (commits, over = {}) => ({
    ref: 'refs/heads/main',
    repository: { full_name: 'octo/hello' },
    commits,
    ...over,
  });
  const commit = (id, message, over = {}) => ({
    id,
    message,
    url: `https://github.com/octo/hello/commit/${id}`,
    author: { username: 'octocat', name: 'Octo Cat' },
    ...over,
  });

  it('커밋 메시지의 작업 키로 연결하고 제목은 첫 줄만 쓴다', async () => {
    const t = await mkTask('작업');
    const sha = 'a'.repeat(40);
    const res = await hook(
      'push',
      push([commit(sha, `TPM-${t.number} 결제 오류 수정\n\n자세한 설명`)]),
    );
    expect(res.body).toMatchObject({ tasks: 1, linked: 1 });
    const [l] = await links(t.id);
    expect(l).toMatchObject({
      kind: 'commit',
      externalId: sha,
      title: `TPM-${t.number} 결제 오류 수정`,
      state: null,
      author: 'octocat',
    });
  });

  it('키가 없는 커밋은 무시하고, 같은 커밋을 다시 받아도 한 행이며 삭제 푸시는 무시한다', async () => {
    const t = await mkTask('작업');
    const sha = 'b'.repeat(40);
    await hook(
      'push',
      push([commit('c'.repeat(40), '키 없는 커밋'), commit(sha, `tpm-${t.number} 소문자`)]),
    );
    await hook('push', push([commit(sha, `tpm-${t.number} 소문자`)]));
    expect(await links(t.id)).toHaveLength(1);
    const del = await hook('push', push([], { deleted: true }));
    expect(del.body.ignored).toBe('deleted');
  });

  it('한 푸시에서 한 커밋이 여러 작업을, 여러 커밋이 한 작업을 연결한다', async () => {
    const [a, b] = [await mkTask('하나'), await mkTask('둘')];
    await hook(
      'push',
      push([
        commit('1'.repeat(40), `TPM-${a.number} TPM-${b.number} 공통`),
        commit('2'.repeat(40), `TPM-${a.number} 후속`),
      ]),
    );
    expect(await links(a.id)).toHaveLength(2);
    expect(await links(b.id)).toHaveLength(1);
  });
});

describe('키 없는 PR 을 작업 카드로 자동 등록 (M34)', () => {
  const enable = (extra = {}) =>
    connect('owner', { repo: 'octo/hello', createOnPr: true, ...extra });
  const open = (over = {}, action = 'opened') => hook('pull_request', pr(action, over));
  const cards = () => store.tasks.filter((t) => t.project_id === pid);

  it('옵션은 기본 꺼짐이고 켜기·끄기는 소유자만(멤버 403)', async () => {
    expect(connection.createOnPr).toBe(false);
    await open();
    expect(cards()).toHaveLength(0);

    expect((await connect('alice', { repo: 'octo/hello', createOnPr: true })).status).toBe(403);
    const on = await enable();
    expect(on.body.connection.createOnPr).toBe(true);
    expect((await api('get', `/projects/${pid}/github`, 'owner')).body.connection.createOnPr).toBe(
      true,
    );
    // 다른 옵션만 바꿔도 이 옵션은 그대로
    expect(
      (await connect('owner', { repo: 'octo/hello', moveOnOpen: true })).body.connection,
    ).toMatchObject({ createOnPr: true, moveOnOpen: true });
  });

  it('PR 을 열면 제목·본문·주소로 카드를 만들고 PR 을 연결하며 활동과 실시간 이벤트를 남긴다', async () => {
    await enable();
    const res = await open({ title: '로그인 오류 수정', body: '세션이 끊기는 문제' });
    expect(res.body.created).toBe(1);

    const [card] = cards();
    expect(card).toMatchObject({
      title: '로그인 오류 수정',
      status: 'todo',
      priority: 'medium',
      assignee_id: null,
      created_by: people.owner.id,
    });
    expect(card.description).toBe(
      '세션이 끊기는 문제\n\nGitHub PR #7: https://github.com/octo/hello/pull/7',
    );
    expect(await links(card.id)).toEqual([
      expect.objectContaining({ kind: 'pull_request', externalId: '7', state: 'open' }),
    ]);

    const activity = (
      await api('get', `/projects/${pid}/activities?taskId=${card.id}`, 'owner')
    ).body.data.map((a) => [a.action, a.actor, a.meta.via]);
    expect(activity).toContainEqual(['task.created', null, 'github']);
    expect(activity.map((a) => a[0])).toContain('github.linked');
    expect(emitToProject).toHaveBeenCalledWith(
      null,
      pid,
      'task:created',
      expect.objectContaining({ task: expect.objectContaining({ id: card.id }) }),
    );
  });

  it('상태는 moveOnOpen 이 켜졌으면 진행 중, 아니면 할 일', async () => {
    await enable({ moveOnOpen: true });
    await open();
    expect(cards()[0].status).toBe('in_progress');
  });

  it('PR 하나는 한 번만: 재전송·다시 열기·카드를 지운 뒤에도 다시 만들지 않는다', async () => {
    await enable();
    await open();
    await open();
    await open({}, 'reopened');
    expect(cards()).toHaveLength(1);

    await api('delete', `/tasks/${cards()[0].id}`, 'owner');
    expect(cards()).toHaveLength(0);
    await open({}, 'reopened');
    expect(cards()).toHaveLength(0);

    // 다른 PR 은 새 카드
    await open({ number: 8, title: '다음' });
    expect(cards().map((t) => t.title)).toEqual(['다음']);
  });

  it('초안 PR 은 준비되면 등록하고, 머지·닫힌·수정 이벤트로는 만들지 않는다', async () => {
    await enable();
    await open({ draft: true });
    expect(cards()).toHaveLength(0);
    await open({ draft: false }, 'ready_for_review');
    expect(cards()).toHaveLength(1);

    store.tasks.length = 0;
    store.prCards.length = 0;
    await hook('pull_request', pr('closed', { state: 'closed', merged: true, number: 9 }));
    await hook('pull_request', pr('closed', { state: 'closed', number: 10 }));
    await hook('pull_request', pr('edited', { number: 11 }));
    expect(cards()).toHaveLength(0);
  });

  it('작업 키가 있는 PR 은 새로 만들지 않는다(없는 작업을 가리키는 오타도)', async () => {
    await enable();
    const t = await mkTask('기존 작업');
    await open({ title: `TPM-${t.number} 로그인` });
    await open({ number: 8, title: 'TPM-999 오타' });
    await open({ number: 9, head: { ref: `feature/TPM-${t.number}-x` } });
    expect(cards()).toHaveLength(1);
    expect((await links(t.id)).map((l) => l.externalId).sort()).toEqual(['7', '9']);
  });

  it('봇이 연 PR 은 등록하지 않는다', async () => {
    await enable();
    await open({ user: { login: 'dependabot[bot]', type: 'Bot' }, title: 'Bump x' });
    expect(cards()).toHaveLength(0);
  });

  it('PR 작성자와 GitHub 로그인이 같은 프로젝트 멤버가 담당자가 된다(멤버가 아니면 미지정)', async () => {
    await enable();
    store.users.find((u) => u.id === people.alice.id).github_login = 'OctoCat';
    await open();
    expect(cards()[0].assignee_id).toBe(people.alice.id);

    store.users.find((u) => u.id === people.outsider.id).github_login = 'stranger';
    await open({ number: 8, user: { login: 'stranger' } });
    expect(cards()[1].assignee_id).toBeNull();
  });

  it('긴 제목·본문은 잘라 한도 안에 넣는다', async () => {
    await enable();
    await open({ title: 'ㄱ'.repeat(300), body: 'ㄴ'.repeat(20_000) });
    expect(cards()[0].title).toHaveLength(200);
    expect(cards()[0].description.length).toBeLessThanOrEqual(10_000);
    expect(cards()[0].description).toContain('GitHub PR #7');
  });

  it('보관된 프로젝트·작업 수 한도에서는 만들지 않고, 한도가 풀리면 다음 이벤트에서 등록한다', async () => {
    await enable();
    const prev = env.MAX_TASKS_PER_PROJECT;
    env.MAX_TASKS_PER_PROJECT = 1;
    try {
      await mkTask('자리 차지');
      const full = await open();
      expect(full.status).toBe(200);
      expect(cards()).toHaveLength(1);
      expect(store.prCards).toHaveLength(0); // 자리를 풀었다
      env.MAX_TASKS_PER_PROJECT = 10;
      await open({}, 'reopened');
      expect(cards()).toHaveLength(2);
    } finally {
      env.MAX_TASKS_PER_PROJECT = prev;
    }

    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    await open({ number: 12 });
    expect(cards()).toHaveLength(2);
  });
});

describe('GitHub 이슈 동기화 (M35)', () => {
  const enable = (extra = {}) =>
    connect('owner', { repo: 'octo/hello', syncIssues: true, ...extra });
  const issue = (action, over = {}) => ({
    action,
    repository: { full_name: 'octo/hello' },
    issue: {
      number: 3,
      title: '결제 화면이 멈춤',
      body: '재현 방법…',
      html_url: 'https://github.com/octo/hello/issues/3',
      state: action === 'closed' ? 'closed' : 'open',
      user: { login: 'reporter' },
      assignees: [],
      ...over,
    },
  });
  const send = (action, over) => hook('issues', issue(action, over));
  const cards = () => store.tasks.filter((t) => t.project_id === pid);

  it('옵션은 기본 꺼짐: 이슈 이벤트를 받아도 카드를 만들지 않는다', async () => {
    expect(connection.syncIssues).toBe(false);
    const res = await send('opened');
    expect(res.status).toBe(200);
    expect(cards()).toHaveLength(0);

    const on = await enable();
    expect(on.body.connection.syncIssues).toBe(true);
    expect((await connect('alice', { repo: 'octo/hello', syncIssues: false })).status).toBe(403);
  });

  it('이슈를 열면 카드를 만들고 이슈를 연결하며, 같은 이슈는 다시 만들지 않는다', async () => {
    await enable();
    store.users.find((u) => u.id === people.alice.id).github_login = 'Assignee1';
    const res = await send('opened', { assignees: [{ login: 'assignee1' }] });
    expect(res.body.created).toBe(1);
    const [card] = cards();
    expect(card).toMatchObject({
      title: '결제 화면이 멈춤',
      status: 'todo',
      assignee_id: people.alice.id,
    });
    expect(card.description).toBe(
      '재현 방법…\n\nGitHub 이슈 #3: https://github.com/octo/hello/issues/3',
    );
    expect(await links(card.id)).toEqual([
      expect.objectContaining({
        kind: 'issue',
        externalId: '3',
        state: 'open',
        author: 'reporter',
      }),
    ]);
    const acts = (
      await api('get', `/projects/${pid}/activities?taskId=${card.id}`, 'owner')
    ).body.data.map((a) => [a.action, a.actor, a.meta.ref]);
    expect(acts).toContainEqual(['task.created', null, undefined]);
    expect(acts).toContainEqual(['github.linked', null, '#3']);
    expect(emitToProject).toHaveBeenCalledWith(null, pid, 'task:created', expect.anything());

    await send('opened');
    await send('reopened');
    expect(cards()).toHaveLength(1);
  });

  it('닫으면 완료로, 완료인 카드를 다시 열면 할 일로, 제목이 바뀌면 따라 바뀐다(설명은 그대로)', async () => {
    await enable();
    await send('opened');
    const id = cards()[0].id;
    await api('patch', `/tasks/${id}`, 'owner', { description: '사람이 고친 설명' });

    await send('closed');
    expect(await statusOf(id)).toBe('done');
    expect((await links(id))[0].state).toBe('closed');

    await send('reopened');
    expect(await statusOf(id)).toBe('todo');
    expect((await links(id))[0].state).toBe('open');

    // 진행 중인 카드는 다시 열어도 그대로
    await api('patch', `/tasks/${id}/move`, 'owner', { status: 'in_progress' });
    await send('reopened');
    expect(await statusOf(id)).toBe('in_progress');

    await send('edited', { title: '결제 화면이 멈춤 (수정)' });
    const row = (await api('get', `/tasks/${id}`, 'owner')).body;
    expect(row.title).toBe('결제 화면이 멈춤 (수정)');
    expect(row.description).toBe('사람이 고친 설명');
    const acts = (await api('get', `/projects/${pid}/activities?taskId=${id}`, 'owner')).body.data;
    expect(acts.some((a) => a.action === 'task.moved' && a.meta.via === 'github')).toBe(true);
    expect(acts.some((a) => a.action === 'task.updated' && a.meta.via === 'github')).toBe(true);
  });

  it('카드를 지운 뒤에는 닫기·다시 열기·수정에도 아무 일 없고 다시 만들지 않는다', async () => {
    await enable();
    await send('opened');
    await api('delete', `/tasks/${cards()[0].id}`, 'owner');
    for (const action of ['edited', 'closed', 'reopened']) {
      expect((await send(action)).status).toBe(200);
    }
    expect(cards()).toHaveLength(0);
  });

  it('키가 있는 이슈는 그 작업에 링크만 걸고 상태는 건드리지 않는다', async () => {
    await enable();
    const t = await mkTask('기존 작업');
    await send('opened', { title: `TPM-${t.number} 관련 이슈` });
    await send('closed', { title: `TPM-${t.number} 관련 이슈` });
    expect(cards()).toHaveLength(1);
    expect(await statusOf(t.id)).toBe('todo');
    expect(await links(t.id)).toEqual([
      expect.objectContaining({ kind: 'issue', state: 'closed' }),
    ]);
  });

  it('PR(issue.pull_request)·봇·보관된 프로젝트·지원하지 않는 동작은 무시한다', async () => {
    await enable();
    await send('opened', { pull_request: { url: 'x' } });
    await send('opened', { user: { login: 'bot', type: 'Bot' } });
    await send('labeled');
    await send('assigned');
    expect(cards()).toHaveLength(0);

    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    await send('opened', { number: 9 });
    expect(cards()).toHaveLength(0);
  });

  it('작업 수 한도에서는 만들지 않고 자리를 풀어 한도가 풀리면 다시 열 때 등록한다', async () => {
    await enable();
    const prev = env.MAX_TASKS_PER_PROJECT;
    env.MAX_TASKS_PER_PROJECT = 1;
    try {
      await mkTask('자리 차지');
      await send('opened');
      expect(cards()).toHaveLength(1);
      expect(store.issueCards).toHaveLength(0);
      env.MAX_TASKS_PER_PROJECT = 10;
      await send('reopened');
      expect(cards()).toHaveLength(2);
    } finally {
      env.MAX_TASKS_PER_PROJECT = prev;
    }
  });
});

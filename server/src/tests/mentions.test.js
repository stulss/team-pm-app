import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { store, reset } from './helpers/memoryRepos.js';
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

const { app } = await import('../app.js');

// owner(소유자·작업 작성자), assignee(담당자), member(멤버), member2(멤버), outsider(비멤버)
const people = {};
const as = (who) => bearer(people[who].token);
let pid;
let taskId;

const api = (method, path, who, body) => {
  const req = request(app)[method](`/api/v1${path}`).set(as(who));
  return body ? req.send(body) : req;
};
const post = (who, body, mentionIds) =>
  api('post', `/tasks/${taskId}/comments`, who, { body, ...(mentionIds && { mentionIds }) });
const notesOf = (who, type = 'mention') =>
  store.notifications.filter((n) => n.user_id === people[who].id && n.type === type);

beforeEach(async () => {
  reset();
  for (const [key, name] of [
    ['admin', '관리자'],
    ['owner', '소유자'],
    ['assignee', '담당자'],
    ['member', '멤버'],
    ['member2', '멤버이'],
    ['outsider', '외부인'],
  ]) {
    const { res } = await register(app, { email: `${key}@example.com`, name });
    people[key] = { id: res.body.user.id, token: res.body.accessToken };
  }
  pid = (
    await api('post', '/projects', 'owner', {
      name: '웹사이트 리뉴얼',
      memberIds: [people.assignee.id, people.member.id, people.member2.id],
    })
  ).body.id;
  taskId = (
    await api('post', `/projects/${pid}/tasks`, 'owner', {
      title: '로그인 화면',
      assigneeId: people.assignee.id,
    })
  ).body.id;
  store.notifications.length = 0; // 작업 배정 알림 제거
});

describe('댓글 작성 + 멘션', () => {
  it('멘션된 멤버에게 mention 알림이 가고 응답·목록에 mentions 가 담긴다', async () => {
    const res = await post('owner', '@멤버 확인 부탁드려요', [people.member.id]);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toEqual([{ id: people.member.id, name: '멤버' }]);

    const notes = notesOf('member');
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toBe(
      "소유자님이 '로그인 화면' 작업의 댓글에서 회원님을 언급했습니다.",
    );
    expect(notes[0].task_id).toBe(taskId);
    expect(notes[0].actor_id).toBe(people.owner.id);

    const list = (await api('get', `/tasks/${taskId}/comments`, 'member2')).body.data;
    expect(list[0].mentions).toEqual([{ id: people.member.id, name: '멤버' }]);
  });

  it('여러 명을 멘션할 수 있고 중복 ID 는 한 번만 알린다', async () => {
    const res = await post('owner', '@멤버 @멤버이 같이 봐 주세요', [
      people.member.id,
      people.member2.id,
      people.member.id,
    ]);
    expect(res.status).toBe(201);
    expect(res.body.mentions).toHaveLength(2);
    expect(notesOf('member')).toHaveLength(1);
    expect(notesOf('member2')).toHaveLength(1);
  });

  it('멘션이 없는 댓글은 기존처럼 comment_added 만 간다 (mentions 는 빈 배열)', async () => {
    const res = await post('owner', '그냥 댓글');
    expect(res.body.mentions).toEqual([]);
    expect(store.notifications.filter((n) => n.type === 'mention')).toHaveLength(0);
    // 담당자(작성자 본인이 아닌)는 댓글 알림을 받는다
    expect(notesOf('assignee', 'comment_added')).toHaveLength(1);
  });

  it('작업 담당자를 멘션하면 mention 하나만 가고 comment_added 는 중복으로 가지 않는다', async () => {
    await post('member', '@담당자 이거 봐 주세요', [people.assignee.id]);
    expect(notesOf('assignee', 'mention')).toHaveLength(1);
    expect(notesOf('assignee', 'comment_added')).toHaveLength(0);
    // 작업 작성자(소유자)는 멘션되지 않았으므로 기존 댓글 알림을 받는다
    expect(notesOf('owner', 'comment_added')).toHaveLength(1);
  });

  it('본인을 멘션해도 알림은 가지 않는다', async () => {
    const res = await post('member', '@멤버 메모', [people.member.id]);
    expect(res.status).toBe(201);
    expect(notesOf('member')).toHaveLength(0);
  });

  it('멘션 알림은 알림 목록 API 로도 조회되고 읽음 처리할 수 있다', async () => {
    await post('owner', '@멤버 확인', [people.member.id]);
    const list = await api('get', '/notifications', 'member');
    expect(list.body.data[0]).toMatchObject({ type: 'mention', taskId, isRead: false });
    expect((await api('get', '/notifications/unread-count', 'member')).body.count).toBe(1);
  });
});

describe('멘션 검증 (400 INVALID_MENTION)', () => {
  const expectInvalid = async (res) => {
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MENTION');
    expect(store.comments).toHaveLength(0); // 댓글도 만들어지지 않는다
    expect(store.notifications).toHaveLength(0);
  };

  it('프로젝트 멤버가 아닌 사용자는 멘션할 수 없다', async () => {
    await expectInvalid(await post('owner', '@외부인 안녕', [people.outsider.id]));
  });

  it('존재하지 않는 사용자 ID 도 400', async () => {
    await expectInvalid(await post('owner', '@누구 안녕', [crypto.randomUUID()]));
  });

  it('비활성화된 멤버는 멘션할 수 없다', async () => {
    store.users.find((u) => u.id === people.member.id).is_active = false;
    await expectInvalid(await post('owner', '@멤버 안녕', [people.member.id]));
  });

  it('프로젝트에서 제거된 멤버는 멘션할 수 없다', async () => {
    await api('delete', `/projects/${pid}/members/${people.member.id}`, 'owner');
    await expectInvalid(await post('owner', '@멤버 안녕', [people.member.id]));
  });

  it('본문에 @이름 이 없으면 (보이지 않는 멘션) 400', async () => {
    await expectInvalid(await post('owner', '이름이 본문에 없습니다', [people.member.id]));
  });

  it('형식이 이상하거나 10명을 넘으면 400 (VALIDATION)', async () => {
    expect((await post('owner', '@멤버', ['not-a-uuid'])).status).toBe(400);
    const many = Array.from({ length: 11 }, () => crypto.randomUUID());
    expect((await post('owner', '@멤버', many)).status).toBe(400);
  });

  it('비멤버·보관된 프로젝트는 기존 규칙(403·409)이 우선한다', async () => {
    expect(
      (
        await api('post', `/tasks/${taskId}/comments`, 'outsider', {
          body: '@멤버',
          mentionIds: [people.member.id],
        })
      ).status,
    ).toBe(403);
    await api('patch', `/projects/${pid}`, 'owner', { status: 'archived' });
    expect((await post('owner', '@멤버', [people.member.id])).status).toBe(409);
  });
});

describe('댓글 수정 + 멘션', () => {
  let commentId;
  beforeEach(async () => {
    commentId = (await post('owner', '@멤버 먼저 봐 주세요', [people.member.id])).body.id;
    store.notifications.length = 0;
  });
  const edit = (who, body, mentionIds) =>
    api('patch', `/comments/${commentId}`, who, { body, ...(mentionIds && { mentionIds }) });

  it('같은 사람을 유지한 채 수정하면 다시 알리지 않는다', async () => {
    const res = await edit('owner', '@멤버 오타를 고쳤어요', [people.member.id]);
    expect(res.status).toBe(200);
    expect(res.body.mentions).toHaveLength(1);
    expect(store.notifications).toHaveLength(0);
  });

  it('새로 추가한 사람에게만 알리고, 빠진 사람의 알림을 회수하지는 않는다', async () => {
    const res = await edit('owner', '@멤버이 로 바꿉니다', [people.member2.id]);
    expect(res.body.mentions).toEqual([{ id: people.member2.id, name: '멤버이' }]);
    expect(notesOf('member2')).toHaveLength(1);
    expect(notesOf('member')).toHaveLength(0);
  });

  it('mentionIds 를 보내지 않으면 멘션이 비워진다', async () => {
    const res = await edit('owner', '멘션 없이 수정');
    expect(res.body.mentions).toEqual([]);
  });

  it('수정에서도 검증한다 (본문에 @이름 없음 / 비멤버)', async () => {
    expect((await edit('owner', '이름 없음', [people.member.id])).body.error.code).toBe(
      'INVALID_MENTION',
    );
    expect((await edit('owner', '@외부인', [people.outsider.id])).status).toBe(400);
    // 실패한 수정은 기존 상태를 바꾸지 않는다
    expect(store.comments[0].body).toBe('@멤버 먼저 봐 주세요');
    expect(store.comments[0].mentions).toHaveLength(1);
  });

  it('작성자가 아니면 수정할 수 없다 (403)', async () => {
    expect((await edit('member', '@멤버 해킹', [people.member.id])).status).toBe(403);
  });
});

describe('이름 스냅샷과 삭제', () => {
  it('멘션 후 이름이 바뀌어도 댓글의 mentions 이름은 그대로다', async () => {
    await post('owner', '@멤버 확인', [people.member.id]);
    store.users.find((u) => u.id === people.member.id).name = '개명한멤버';
    const list = (await api('get', `/tasks/${taskId}/comments`, 'owner')).body.data;
    expect(list[0].mentions[0].name).toBe('멤버');
    expect(list[0].body).toContain('@멤버');
  });

  it('삭제된 댓글은 mentions 도 가린다', async () => {
    const c = (await post('owner', '@멤버 확인', [people.member.id])).body;
    await api('delete', `/comments/${c.id}`, 'owner');
    const list = (await api('get', `/tasks/${taskId}/comments`, 'owner')).body.data;
    expect(list[0]).toMatchObject({ deleted: true, body: '삭제된 댓글', mentions: [] });
  });
});

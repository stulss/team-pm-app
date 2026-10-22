// DB 없이 서비스/라우트 로직을 검증하기 위한 메모리 저장소.
// repository.js 와 같은 시그니처를 가지며, 행은 DB 행(snake_case)과 같은 모양이다.
// SQL 자체는 검증하지 못한다 — 실제 DB 가 연결되면 통합 테스트로 보강한다.
import crypto from 'node:crypto';
import { badRequest, conflict } from '../../utils/errors.js';
import { positionBetween } from '../../utils/position.js';

export const store = {
  users: [],
  tokens: [],
  projects: [],
  members: [],
  tasks: [],
  comments: [],
  notifications: [],
  emailTokens: [],
  activities: [],
  shareLinks: [],
  chat: [],
  polls: [],
  pollOptions: [],
  pollVotes: [],
  labels: [],
  taskLabels: [],
  checklist: [],
  savedFilters: [],
  deps: [],
  githubConnections: [],
  githubLinks: [],
  githubDeliveries: [],
  commentReactions: [],
  chatReactions: [],
  apiTokens: [],
  prCards: [],
  issueCards: [],
};

export function reset() {
  store.users = [];
  store.tokens = [];
  store.projects = [];
  store.members = [];
  store.tasks = [];
  store.comments = [];
  store.notifications = [];
  store.emailTokens = [];
  store.activities = [];
  store.shareLinks = [];
  store.chat = [];
  store.polls = [];
  store.pollOptions = [];
  store.pollVotes = [];
  store.labels = [];
  store.taskLabels = [];
  store.checklist = [];
  store.savedFilters = [];
  store.deps = [];
  store.githubConnections = [];
  store.githubLinks = [];
  store.githubDeliveries = [];
  store.commentReactions = [];
  store.chatReactions = [];
  store.apiTokens = [];
  store.prCards = [];
  store.issueCards = [];
  activitySeq = 0;
  chatSeq = 0;
}

const pub = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  is_active: u.is_active,
  created_at: u.created_at,
  preferences: u.preferences ?? {},
  github_login: u.github_login ?? null,
  password_set: u.password_set,
});

let reactionSeq = 0;
// 반응 행을 [{ key, users: [{id,name}] }] 로 묶는다(처음 달린 순서). SQL 의 json_agg 와 같은 모양.
const groupReactions = (rows) => {
  const byKey = new Map();
  for (const r of [...rows].sort((a, b) => a.at - b.at)) {
    if (!byKey.has(r.emoji)) byKey.set(r.emoji, []);
    byKey
      .get(r.emoji)
      .push({ id: r.user_id, name: store.users.find((u) => u.id === r.user_id)?.name });
  }
  return [...byKey].map(([key, users]) => ({ key, users }));
};

export const usersRepo = {
  async insertUser(client, { email, passwordHash, name }) {
    if (store.users.some((u) => u.email === email)) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      password_hash: passwordHash,
      name,
      role: store.users.length === 0 ? 'admin' : 'member',
      is_active: true,
      created_at: new Date(),
    };
    store.users.push(user);
    return pub(user);
  },
  async insertGithubUser(client, { email, passwordHash, name, githubId, login }) {
    if (store.users.some((u) => u.email === email)) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    const user = {
      id: crypto.randomUUID(),
      email,
      password_hash: passwordHash,
      name,
      role: store.users.length === 0 ? 'admin' : 'member',
      is_active: true,
      created_at: new Date(),
      github_id: githubId,
      github_login: login,
      password_set: false,
    };
    store.users.push(user);
    return pub(user);
  },
  async exportData(userId) {
    const mine = store.members.filter((m) => m.user_id === userId);
    return {
      projects: mine.map((m) => store.projects.find((p) => p.id === m.project_id)).filter(Boolean),
      assignedTasks: store.tasks.filter((t) => t.assignee_id === userId),
      createdTasks: store.tasks.filter((t) => t.created_by === userId),
      comments: store.comments.filter((c) => c.author_id === userId && !c.deleted_at),
    };
  },
  async ownedProjectNames(userId) {
    return store.projects.filter((p) => p.owner_id === userId).map((p) => p.name);
  },
  async anonymize(userId, passwordHash) {
    const u = store.users.find((x) => x.id === userId);
    Object.assign(u, {
      email: `deleted-${u.id}@deleted.invalid`,
      name: '탈퇴한 사용자',
      password_hash: passwordHash,
      password_set: false,
      is_active: false,
      github_id: null,
      github_login: null,
      preferences: {},
    });
    for (const t of store.tasks) if (t.assignee_id === userId) t.assignee_id = null;
    store.members = store.members.filter((m) => m.user_id !== userId);
    store.notifications = store.notifications.filter((n) => n.user_id !== userId);
  },
  async unlinkGithub(id) {
    const u = store.users.find((x) => x.id === id);
    if (!u?.github_id) return false;
    u.github_id = null;
    u.github_login = null;
    return true;
  },
  async findByGithubId(githubId) {
    return store.users.find((u) => String(u.github_id) === String(githubId)) ?? null;
  },
  async linkGithub(id, githubId, login) {
    if (store.users.some((x) => x.id !== id && String(x.github_id) === String(githubId))) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    const u = store.users.find((x) => x.id === id);
    if (u) Object.assign(u, { github_id: githubId, github_login: login });
  },
  async countUsers() {
    return store.users.length;
  },
  async findByEmail(email) {
    return store.users.find((u) => u.email === email) ?? null;
  },
  async findById(id) {
    return store.users.find((u) => u.id === id) ?? null;
  },
  async search({ q, limit, offset }) {
    const hit = (u) =>
      !q || u.name.toLowerCase().includes(q.toLowerCase()) || u.email.includes(q.toLowerCase());
    const all = store.users.filter(hit);
    return { rows: all.slice(offset, offset + limit).map(pub), total: all.length };
  },
  async countActiveAdmins() {
    return store.users.filter((u) => u.role === 'admin' && u.is_active).length;
  },
  async updateRole(id, role) {
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    u.role = role;
    return pub(u);
  },
  async updateStatus(id, isActive) {
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    u.is_active = isActive;
    return pub(u);
  },
  async updatePreferences(id, patch) {
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    const { notifications, ...rest } = patch;
    u.preferences = { ...(u.preferences ?? {}), ...rest };
    if (notifications) {
      u.preferences.notifications = { ...(u.preferences.notifications ?? {}), ...notifications };
    }
    return pub(u);
  },
  async updateProfile(id, { name, passwordHash }) {
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    if (name) u.name = name;
    if (passwordHash) {
      u.password_hash = passwordHash;
      u.password_set = true;
    }
    return pub(u);
  },
};

export const authRepo = {
  async insertRefreshToken({ userId, tokenHash, expiresAt, sessionId, userAgent, ip }) {
    store.tokens.push({
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked_at: null,
      session_id: sessionId ?? crypto.randomUUID(),
      user_agent: userAgent ?? null,
      ip: ip ?? null,
      created_at: new Date(),
    });
  },
  async listSessions(userId) {
    const groups = new Map();
    for (const t of store.tokens.filter((x) => x.user_id === userId)) {
      const sid = t.session_id ?? t.id;
      if (!groups.has(sid)) groups.set(sid, []);
      groups.get(sid).push(t);
    }
    return [...groups]
      .filter(([, ts]) => ts.some((t) => !t.revoked_at && t.expires_at > new Date()))
      .map(([id, ts]) => {
        const latest = ts.reduce((a, b) => (b.created_at >= a.created_at ? b : a));
        return {
          id,
          user_agent: latest.user_agent,
          ip: latest.ip,
          started_at: ts.reduce((a, b) => (b.created_at < a ? b.created_at : a), ts[0].created_at),
          last_used_at: latest.created_at,
        };
      });
  },
  async revokeSession(userId, sessionId) {
    let n = 0;
    for (const t of store.tokens) {
      if (t.user_id === userId && (t.session_id ?? t.id) === sessionId && !t.revoked_at) {
        t.revoked_at = new Date();
        n += 1;
      }
    }
    return n > 0;
  },
  async revokeOtherSessions(userId, exceptSessionId) {
    const gone = new Set();
    for (const t of store.tokens) {
      const sid = t.session_id ?? t.id;
      if (t.user_id === userId && !t.revoked_at && sid !== exceptSessionId) {
        t.revoked_at = new Date();
        gone.add(sid);
      }
    }
    return gone.size;
  },
  async findRefreshToken(tokenHash) {
    const t = store.tokens.find((x) => x.token_hash === tokenHash);
    if (!t) return null;
    return { ...t, revoked_ago_ms: t.revoked_at ? Date.now() - t.revoked_at.getTime() : null };
  },
  async revokeRefreshToken(id) {
    const t = store.tokens.find((x) => x.id === id);
    if (!t || t.revoked_at) return false;
    t.revoked_at = new Date();
    return true;
  },
  async revokeAllForUser(userId) {
    for (const t of store.tokens) {
      if (t.user_id === userId && !t.revoked_at) t.revoked_at = new Date();
    }
  },
  async deleteExpired() {
    return 0;
  },
  async insertEmailToken({ userId, kind, tokenHash, expiresAt }) {
    for (const t of store.emailTokens) {
      if (t.user_id === userId && t.kind === kind && !t.used_at) t.used_at = new Date();
    }
    store.emailTokens.push({
      user_id: userId,
      kind,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used_at: null,
      created_at: new Date(),
    });
  },
  async secondsSinceLastEmailToken(userId, kind) {
    const times = store.emailTokens
      .filter((t) => t.user_id === userId && t.kind === kind)
      .map((t) => t.created_at.getTime());
    return times.length ? (Date.now() - Math.max(...times)) / 1000 : null;
  },
  async consumeEmailToken(tokenHash, kind) {
    const t = store.emailTokens.find(
      (x) =>
        x.token_hash === tokenHash && x.kind === kind && !x.used_at && x.expires_at > new Date(),
    );
    if (!t) return null;
    t.used_at = new Date();
    return t.user_id;
  },
};

let activitySeq = 0;
export const activityRepo = {
  RETENTION_DAYS: 180,
  toActivity: (row) =>
    row && {
      id: row.id,
      seq: Number(row.seq),
      action: row.action,
      taskId: row.task_id,
      actor: row.actor_id ? { id: row.actor_id, name: row.actor_name } : null,
      meta: row.meta,
      createdAt: row.created_at,
    },
  async insert({ projectId, taskId = null, actorId = null, action, meta = {} }) {
    activitySeq += 1;
    store.activities.push({
      id: crypto.randomUUID(),
      seq: activitySeq,
      project_id: projectId,
      task_id: taskId,
      actor_id: actorId,
      action,
      meta: JSON.parse(JSON.stringify(meta)),
      created_at: new Date(),
    });
  },
  async list(projectId, { limit, before, taskId, action, excludeActions }) {
    return store.activities
      .filter(
        (a) =>
          a.project_id === projectId &&
          (before === undefined || a.seq < before) &&
          (!taskId || a.task_id === taskId) &&
          (!action || a.action === action) &&
          !excludeActions?.includes(a.action),
      )
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit + 1)
      .map((a) => ({ ...a, actor_name: store.users.find((u) => u.id === a.actor_id)?.name }));
  },
  async deleteOlderThan(days) {
    const cutoff = Date.now() - days * 86400_000;
    const before = store.activities.length;
    store.activities = store.activities.filter((a) => a.created_at.getTime() >= cutoff);
    return before - store.activities.length;
  },
};

let chatSeq = 0;
export const chatRepo = {
  RETENTION_DAYS: 90,
  MAX_PER_PROJECT: 5000,
  toMessage: (row) =>
    row && {
      id: row.id,
      seq: Number(row.seq),
      body: row.body,
      author: row.author_id ? { id: row.author_id, name: row.author_name } : null,
      mentions: row.mentions ?? [],
      reactions: row.reactions ?? [],
      createdAt: row.created_at,
    },
  _withName: (m) => ({
    ...m,
    author_name: store.users.find((u) => u.id === m.author_id)?.name,
    reactions: groupReactions(store.chatReactions.filter((r) => r.target_id === m.id)),
  }),
  async setReaction(messageId, userId, emoji, on) {
    store.chatReactions = store.chatReactions.filter(
      (r) => !(r.target_id === messageId && r.user_id === userId && r.emoji === emoji),
    );
    if (on) {
      store.chatReactions.push({ target_id: messageId, user_id: userId, emoji, at: ++reactionSeq });
    }
  },
  async insert({ projectId, authorId, body, mentions = [] }) {
    chatSeq += 1;
    const row = {
      id: crypto.randomUUID(),
      seq: chatSeq,
      project_id: projectId,
      author_id: authorId,
      body,
      mentions: mentions.map((x) => ({ ...x })),
      created_at: new Date(),
    };
    store.chat.push(row);
    return chatRepo._withName(row);
  },
  async findById(projectId, id) {
    const m = store.chat.find((x) => x.project_id === projectId && x.id === id);
    return m ? chatRepo._withName(m) : null;
  },
  async list(projectId, { limit, before }) {
    return store.chat
      .filter((m) => m.project_id === projectId && (before === undefined || m.seq < before))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit + 1)
      .map(chatRepo._withName);
  },
  async remove(projectId, id) {
    const before = store.chat.length;
    store.chat = store.chat.filter((m) => !(m.project_id === projectId && m.id === id));
    store.chatReactions = store.chatReactions.filter((r) => r.target_id !== id);
    return store.chat.length < before;
  },
  async trim(projectId, keep) {
    const mine = store.chat.filter((m) => m.project_id === projectId).sort((a, b) => b.seq - a.seq);
    const drop = new Set(mine.slice(keep).map((m) => m.id));
    store.chat = store.chat.filter((m) => !drop.has(m.id));
    return drop.size;
  },
  async deleteOlderThan(days) {
    const cutoff = Date.now() - days * 86400_000;
    const before = store.chat.length;
    store.chat = store.chat.filter((m) => m.created_at.getTime() >= cutoff);
    return before - store.chat.length;
  },
};

// 검색 저장소: SQL 의 권한 필터(멤버 프로젝트, Admin 은 전체)와 ILIKE 의미를 메모리로 흉내 낸다.
const unlike = (pattern) => pattern.slice(1, -1).replace(/\\(.)/g, '$1').toLowerCase();
const accessible = (userId, isAdmin) => (projectId) =>
  isAdmin || store.members.some((m) => m.project_id === projectId && m.user_id === userId);
const has = (text, needle) => Boolean(text) && text.toLowerCase().includes(needle);
const searchProjectName = (id) => store.projects.find((p) => p.id === id)?.name;
const searchUserName = (id) => store.users.find((u) => u.id === id)?.name;
export const searchRepo = {
  async searchProjects({ userId, isAdmin, pattern, limit }) {
    const n = unlike(pattern);
    return store.projects
      .filter((p) => accessible(userId, isAdmin)(p.id) && has(p.name, n))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  },
  async searchTasks({ userId, isAdmin, pattern, limit }) {
    const n = unlike(pattern);
    return store.tasks
      .filter(
        (t) =>
          accessible(userId, isAdmin)(t.project_id) && (has(t.title, n) || has(t.description, n)),
      )
      .slice(0, limit)
      .map((t) => ({ ...t, project_name: searchProjectName(t.project_id) }));
  },
  async searchComments({ userId, isAdmin, pattern, limit }) {
    const n = unlike(pattern);
    return store.comments
      .map((c) => ({ c, t: store.tasks.find((t) => t.id === c.task_id) }))
      .filter(
        ({ c, t }) =>
          t && !c.deleted_at && accessible(userId, isAdmin)(t.project_id) && has(c.body, n),
      )
      .sort((a, b) => b.c.created_at - a.c.created_at)
      .slice(0, limit)
      .map(({ c, t }) => ({
        ...c,
        task_title: t.title,
        project_id: t.project_id,
        project_name: searchProjectName(t.project_id),
        author_name: searchUserName(c.author_id),
      }));
  },
  async searchChat({ userId, isAdmin, pattern, limit }) {
    const n = unlike(pattern);
    return store.chat
      .filter((m) => accessible(userId, isAdmin)(m.project_id) && has(m.body, n))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
      .map((m) => ({
        ...m,
        project_name: searchProjectName(m.project_id),
        author_name: searchUserName(m.author_id),
      }));
  },
};

// 모아보기 저장소: SQL 의 "내가 멤버인 프로젝트" 필터와 조건을 메모리로 흉내 낸다.
const myProject = (userId) => (projectId) =>
  store.members.some((m) => m.project_id === projectId && m.user_id === userId);
export const feedRepo = {
  async dueTasks(userId, until, limit) {
    const mine = myProject(userId);
    return store.tasks
      .filter((t) => {
        const p = store.projects.find((x) => x.id === t.project_id);
        return (
          t.assignee_id === userId &&
          t.status !== 'done' &&
          t.due_date &&
          String(t.due_date).slice(0, 10) <= until &&
          p?.status === 'active' &&
          mine(t.project_id)
        );
      })
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, limit)
      .map((t) => ({ ...t, project_name: store.projects.find((p) => p.id === t.project_id).name }));
  },
  async mentions(userId, limit) {
    const mine = myProject(userId);
    return store.comments
      .map((c) => ({ c, t: store.tasks.find((t) => t.id === c.task_id) }))
      .filter(
        ({ c, t }) =>
          t &&
          !c.deleted_at &&
          c.author_id !== userId &&
          c.mentions?.some((m) => m.id === userId) &&
          mine(t.project_id),
      )
      .sort((a, b) => b.c.created_at - a.c.created_at)
      .slice(0, limit)
      .map(({ c, t }) => ({
        ...c,
        task_title: t.title,
        project_id: t.project_id,
        project_name: store.projects.find((p) => p.id === t.project_id).name,
        author_name: store.users.find((u) => u.id === c.author_id)?.name,
      }));
  },
  async activities(userId, limit) {
    const mine = myProject(userId);
    return store.activities
      .filter((a) => mine(a.project_id) && a.actor_id !== userId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
      .map((a) => ({
        ...a,
        project_name: store.projects.find((p) => p.id === a.project_id)?.name,
        actor_name: store.users.find((u) => u.id === a.actor_id)?.name,
      }));
  },
};

// 투표 저장소: 지금 멤버의 표만 세는 집계와 "마감 후에는 표가 안 들어감"을 메모리로 흉내 낸다.
export const pollsRepo = {
  MAX_POLLS_PER_PROJECT: 100,
  async countByProject(projectId) {
    return store.polls.filter((p) => p.project_id === projectId).length;
  },
  async insertPoll({ projectId, createdBy, question, multiple, options }) {
    const poll = {
      id: crypto.randomUUID(),
      project_id: projectId,
      created_by: createdBy,
      question,
      multiple,
      closed_at: null,
      created_at: new Date(Date.now() + store.polls.length),
    };
    store.polls.push(poll);
    options.forEach((label, position) =>
      store.pollOptions.push({ id: crypto.randomUUID(), poll_id: poll.id, label, position }),
    );
    return poll.id;
  },
  async findById(projectId, pollId) {
    return store.polls.find((p) => p.project_id === projectId && p.id === pollId) ?? null;
  },
  async optionIds(pollId) {
    return store.pollOptions.filter((o) => o.poll_id === pollId).map((o) => o.id);
  },
  async setVotes(pollId, userId, optionIds) {
    const poll = store.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed_at) return false;
    store.pollVotes = store.pollVotes.filter(
      (v) => !(v.poll_id === pollId && v.user_id === userId),
    );
    for (const optionId of optionIds) {
      store.pollVotes.push({ poll_id: pollId, option_id: optionId, user_id: userId });
    }
    return true;
  },
  async close(pollId) {
    const poll = store.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed_at) return false;
    poll.closed_at = new Date();
    return true;
  },
  async remove(pollId) {
    store.polls = store.polls.filter((p) => p.id !== pollId);
    store.pollOptions = store.pollOptions.filter((o) => o.poll_id !== pollId);
    store.pollVotes = store.pollVotes.filter((v) => v.poll_id !== pollId);
  },
  async list(projectId, userId, { pollId = null, limit = 50 } = {}) {
    const isMember = (uid) =>
      store.members.some((m) => m.project_id === projectId && m.user_id === uid);
    return store.polls
      .filter((p) => p.project_id === projectId && (!pollId || p.id === pollId))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, pollId ? 1 : limit)
      .map((p) => {
        const votes = store.pollVotes.filter((v) => v.poll_id === p.id);
        return {
          id: p.id,
          question: p.question,
          multiple: p.multiple,
          closed: Boolean(p.closed_at),
          closedAt: p.closed_at,
          createdBy: p.created_by
            ? { id: p.created_by, name: store.users.find((u) => u.id === p.created_by)?.name }
            : null,
          createdAt: p.created_at,
          options: store.pollOptions
            .filter((o) => o.poll_id === p.id)
            .sort((a, b) => a.position - b.position)
            .map((o) => ({
              id: o.id,
              label: o.label,
              votes: votes.filter((v) => v.option_id === o.id && isMember(v.user_id)).length,
            })),
          totalVoters: new Set(votes.filter((v) => isMember(v.user_id)).map((v) => v.user_id)).size,
          myVotes: votes.filter((v) => v.user_id === userId).map((v) => v.option_id),
        };
      });
  },
};

export const labelsRepo = {
  MAX_LABELS_PER_PROJECT: 20,
  MAX_LABELS_PER_TASK: 10,
  async list(projectId) {
    return store.labels
      .filter((l) => l.project_id === projectId)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
  async countByProject(projectId) {
    return store.labels.filter((l) => l.project_id === projectId).length;
  },
  async findById(projectId, labelId) {
    return store.labels.find((l) => l.project_id === projectId && l.id === labelId) ?? null;
  },
  async insert({ projectId, name, color, createdBy }) {
    const dup = store.labels.some(
      (l) => l.project_id === projectId && l.name.toLowerCase() === name.toLowerCase(),
    );
    if (dup) return null;
    const row = {
      id: crypto.randomUUID(),
      project_id: projectId,
      name,
      color,
      created_by: createdBy,
    };
    store.labels.push(row);
    return row;
  },
  async update(labelId, { name, color }) {
    const row = store.labels.find((l) => l.id === labelId);
    const dup =
      name &&
      store.labels.some(
        (l) =>
          l.id !== labelId &&
          l.project_id === row.project_id &&
          l.name.toLowerCase() === name.toLowerCase(),
      );
    if (dup) return null;
    if (name) row.name = name;
    if (color) row.color = color;
    return row;
  },
  async remove(labelId) {
    store.labels = store.labels.filter((l) => l.id !== labelId);
    store.taskLabels = store.taskLabels.filter((tl) => tl.label_id !== labelId);
  },
  async existingIds(projectId, labelIds) {
    return store.labels
      .filter((l) => l.project_id === projectId && labelIds.includes(l.id))
      .map((l) => l.id);
  },
  async setTaskLabels(task, labelIds) {
    store.taskLabels = store.taskLabels.filter((tl) => tl.task_id !== task.id);
    for (const labelId of labelIds) store.taskLabels.push({ task_id: task.id, label_id: labelId });
  },
};

export const checklistRepo = {
  MAX_ITEMS_PER_TASK: 50,
  async list(taskId) {
    return store.checklist
      .filter((i) => i.task_id === taskId)
      .sort((a, b) => a.position - b.position);
  },
  async findById(taskId, itemId) {
    return store.checklist.find((i) => i.task_id === taskId && i.id === itemId) ?? null;
  },
  async insert(taskId, content) {
    const items = store.checklist.filter((i) => i.task_id === taskId);
    if (items.length >= checklistRepo.MAX_ITEMS_PER_TASK) return null;
    const row = {
      id: crypto.randomUUID(),
      task_id: taskId,
      content,
      is_done: false,
      position: Math.max(0, ...items.map((i) => i.position)) + STEP,
    };
    store.checklist.push(row);
    return row;
  },
  async update(itemId, { content, isDone }) {
    const row = store.checklist.find((i) => i.id === itemId);
    if (content !== undefined) row.content = content;
    if (isDone !== undefined) row.is_done = isDone;
    return row;
  },
  async remove(itemId) {
    store.checklist = store.checklist.filter((i) => i.id !== itemId);
  },
};

export const dependenciesRepo = {
  MAX_BLOCKERS_PER_TASK: 10,
  async list(taskId) {
    const linked = (id) => {
      const t = store.tasks.find((x) => x.id === id);
      return { id: t.id, title: t.title, status: t.status, due_date: t.due_date };
    };
    return {
      blockedBy: store.deps.filter((d) => d.task_id === taskId).map((d) => linked(d.depends_on_id)),
      blocks: store.deps.filter((d) => d.depends_on_id === taskId).map((d) => linked(d.task_id)),
    };
  },
  async add(task, dependsOnId) {
    const mine = store.deps.filter((d) => d.task_id === task.id);
    if (mine.some((d) => d.depends_on_id === dependsOnId)) return 'exists';
    if (mine.length >= dependenciesRepo.MAX_BLOCKERS_PER_TASK) return 'full';
    // dependsOn 의 선행 사슬에 이 작업이 있으면 순환
    const seen = new Set();
    const stack = [dependsOnId];
    while (stack.length) {
      const id = stack.pop();
      for (const d of store.deps.filter((x) => x.task_id === id)) {
        if (d.depends_on_id === task.id) return 'cycle';
        if (!seen.has(d.depends_on_id)) {
          seen.add(d.depends_on_id);
          stack.push(d.depends_on_id);
        }
      }
    }
    store.deps.push({ task_id: task.id, depends_on_id: dependsOnId });
    return 'ok';
  },
  async remove(taskId, dependsOnId) {
    const before = store.deps.length;
    store.deps = store.deps.filter(
      (d) => !(d.task_id === taskId && d.depends_on_id === dependsOnId),
    );
    return store.deps.length < before;
  },
};

export const githubRepo = {
  toConnection: (row) =>
    row && {
      id: row.id,
      projectId: row.project_id,
      repo: row.repo,
      moveOnOpen: row.move_on_open,
      doneOnMerge: row.done_on_merge,
      createOnPr: row.create_on_pr ?? false,
      syncIssues: row.sync_issues ?? false,
      lastEventAt: row.last_event_at,
    },
  toLink: (row) => ({
    id: row.id,
    kind: row.kind,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    state: row.state,
    author: row.author,
    updatedAt: row.updated_at,
  }),
  async getByProject(projectId) {
    return store.githubConnections.find((c) => c.project_id === projectId) ?? null;
  },
  async getById(id) {
    return store.githubConnections.find((c) => c.id === id) ?? null;
  },
  async upsert({ projectId, repo, moveOnOpen, doneOnMerge, createOnPr, syncIssues, createdBy }) {
    const taken = store.githubConnections.find(
      (c) => c.project_id !== projectId && c.repo.toLowerCase() === repo.toLowerCase(),
    );
    if (taken) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
    let row = store.githubConnections.find((c) => c.project_id === projectId);
    if (row) {
      row.repo = repo;
      if (moveOnOpen !== undefined) row.move_on_open = moveOnOpen;
      if (doneOnMerge !== undefined) row.done_on_merge = doneOnMerge;
      if (createOnPr !== undefined) row.create_on_pr = createOnPr;
      if (syncIssues !== undefined) row.sync_issues = syncIssues;
    } else {
      row = {
        id: crypto.randomUUID(),
        project_id: projectId,
        repo,
        secret_version: 1,
        move_on_open: moveOnOpen ?? false,
        done_on_merge: doneOnMerge ?? false,
        create_on_pr: createOnPr ?? false,
        sync_issues: syncIssues ?? false,
        created_by: createdBy,
        last_event_at: null,
      };
      store.githubConnections.push(row);
    }
    return row;
  },
  async rotateSecret(projectId) {
    const row = store.githubConnections.find((c) => c.project_id === projectId);
    if (row) row.secret_version += 1;
    return row ?? null;
  },
  async remove(projectId) {
    const before = store.githubConnections.length;
    store.githubConnections = store.githubConnections.filter((c) => c.project_id !== projectId);
    return store.githubConnections.length < before;
  },
  async claimPrCard(projectId, prNumber) {
    if (store.prCards.some((c) => c.project_id === projectId && c.pr_number === prNumber)) {
      return false;
    }
    store.prCards.push({ project_id: projectId, pr_number: prNumber, task_id: null });
    return true;
  },
  async setPrCardTask(projectId, prNumber, taskId) {
    const row = store.prCards.find((c) => c.project_id === projectId && c.pr_number === prNumber);
    if (row) row.task_id = taskId;
  },
  async releasePrCard(projectId, prNumber) {
    store.prCards = store.prCards.filter(
      (c) => !(c.project_id === projectId && c.pr_number === prNumber),
    );
  },
  async claimIssueCard(projectId, number) {
    if (store.issueCards.some((c) => c.project_id === projectId && c.issue_number === number)) {
      return false;
    }
    store.issueCards.push({ project_id: projectId, issue_number: number, task_id: null });
    return true;
  },
  async setIssueCardTask(projectId, number, taskId) {
    const row = store.issueCards.find(
      (c) => c.project_id === projectId && c.issue_number === number,
    );
    if (row) row.task_id = taskId;
  },
  async releaseIssueCard(projectId, number) {
    store.issueCards = store.issueCards.filter(
      (c) => !(c.project_id === projectId && c.issue_number === number),
    );
  },
  async getIssueCardTaskId(projectId, number) {
    const row = store.issueCards.find(
      (c) => c.project_id === projectId && c.issue_number === number,
    );
    // 카드를 지웠으면(SQL 의 ON DELETE SET NULL) null
    return row && store.tasks.some((t) => t.id === row.task_id) ? row.task_id : null;
  },
  async findMemberByGithubLogin(projectId, login) {
    const user = store.users.find(
      (u) =>
        u.is_active &&
        u.github_login?.toLowerCase() === login.toLowerCase() &&
        store.members.some((m) => m.project_id === projectId && m.user_id === u.id),
    );
    return user?.id ?? null;
  },
  async touch(id) {
    const row = store.githubConnections.find((c) => c.id === id);
    if (row) row.last_event_at = new Date();
  },
  async claimDelivery(deliveryId) {
    if (store.githubDeliveries.includes(deliveryId)) return false;
    store.githubDeliveries.push(deliveryId);
    return true;
  },
  async deleteOldDeliveries() {
    return 0;
  },
  async findTasksByNumbers(projectId, numbers) {
    return store.tasks
      .filter((t) => t.project_id === projectId && numbers.includes(t.number))
      .map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status }));
  },
  async upsertLink({ taskId, projectId, kind, externalId, title, url, state, author }) {
    const found = store.githubLinks.find(
      (l) => l.task_id === taskId && l.kind === kind && l.external_id === externalId,
    );
    if (found) {
      const prevState = found.state;
      Object.assign(found, { title, url, state: state ?? null, updated_at: Date.now() });
      if (author) found.author = author;
      return { id: found.id, inserted: false, prevState };
    }
    const row = {
      id: crypto.randomUUID(),
      task_id: taskId,
      project_id: projectId,
      kind,
      external_id: externalId,
      title,
      url,
      state: state ?? null,
      author: author ?? null,
      updated_at: Date.now(),
    };
    store.githubLinks.push(row);
    return { id: row.id, inserted: true, prevState: null };
  },
  async listLinks(taskId) {
    return store.githubLinks
      .filter((l) => l.task_id === taskId)
      .sort((a, b) => b.updated_at - a.updated_at);
  },
};

export const savedFiltersRepo = {
  MAX_FILTERS_PER_USER: 20,
  async list(projectId, userId) {
    return store.savedFilters
      .filter((f) => f.project_id === projectId && f.user_id === userId)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  },
  async findOwn(projectId, userId, filterId) {
    return (
      store.savedFilters.find(
        (f) => f.project_id === projectId && f.user_id === userId && f.id === filterId,
      ) ?? null
    );
  },
  async insert({ projectId, userId, name, filters }) {
    const mine = store.savedFilters.filter(
      (f) => f.project_id === projectId && f.user_id === userId,
    );
    if (mine.length >= savedFiltersRepo.MAX_FILTERS_PER_USER) return { full: true };
    if (mine.some((f) => f.name.toLowerCase() === name.toLowerCase())) return { duplicate: true };
    const row = {
      id: crypto.randomUUID(),
      project_id: projectId,
      user_id: userId,
      name,
      filters,
      created_at: new Date(),
    };
    store.savedFilters.push(row);
    return { row };
  },
  async remove(filterId) {
    store.savedFilters = store.savedFilters.filter((f) => f.id !== filterId);
  },
};

export const shareRepo = {
  MAX_ACTIVE_PER_PROJECT: 5,
  STALE_DAYS: 30,
  toLink: (row) =>
    row && {
      id: row.id,
      createdBy: row.created_by ? { id: row.created_by, name: row.creator_name } : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewCount: row.view_count,
      lastViewedAt: row.last_viewed_at,
    },
  _active: (l) => !l.revoked_at && l.expires_at > new Date(),
  async countActive(projectId) {
    return store.shareLinks.filter((l) => l.project_id === projectId && shareRepo._active(l))
      .length;
  },
  async insert({ projectId, createdBy, tokenHash, expiresInDays }) {
    const row = {
      id: crypto.randomUUID(),
      project_id: projectId,
      created_by: createdBy,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + expiresInDays * 86400_000),
      revoked_at: null,
      view_count: 0,
      last_viewed_at: null,
      created_at: new Date(),
    };
    store.shareLinks.push(row);
    return { id: row.id, expires_at: row.expires_at };
  },
  async listActive(projectId) {
    return store.shareLinks
      .filter((l) => l.project_id === projectId && shareRepo._active(l))
      .map((l) => ({ ...l, creator_name: store.users.find((u) => u.id === l.created_by)?.name }))
      .sort((a, b) => b.created_at - a.created_at);
  },
  async revoke(projectId, linkId) {
    const l = store.shareLinks.find(
      (x) => x.id === linkId && x.project_id === projectId && !x.revoked_at,
    );
    if (!l) return false;
    l.revoked_at = new Date();
    return true;
  },
  async findActiveByHash(tokenHash) {
    const l = store.shareLinks.find((x) => x.token_hash === tokenHash && shareRepo._active(x));
    if (!l) return null;
    const p = store.projects.find((x) => x.id === l.project_id);
    return {
      id: l.id,
      project_id: l.project_id,
      expires_at: l.expires_at,
      project_name: p?.name,
      project_status: p?.status,
    };
  },
  async touchView(id) {
    const l = store.shareLinks.find((x) => x.id === id);
    if (l) {
      l.view_count += 1;
      l.last_viewed_at = new Date();
    }
  },
  async deleteStale() {
    const cutoff = Date.now() - 30 * 86400_000;
    const before = store.shareLinks.length;
    store.shareLinks = store.shareLinks.filter(
      (l) => l.expires_at.getTime() >= cutoff && !(l.revoked_at && l.revoked_at.getTime() < cutoff),
    );
    return before - store.shareLinks.length;
  },
};

export const projectsRepo = {
  async countOwned(userId) {
    return store.projects.filter((p) => p.owner_id === userId).length;
  },
  async countMembers(projectId) {
    return store.members.filter((m) => m.project_id === projectId).length;
  },
  async listForUser(user, { status, limit, offset }) {
    const mine = (p) => store.members.find((m) => m.project_id === p.id && m.user_id === user.id);
    let rows = store.projects.filter(
      (p) =>
        (user.role === 'admin' ||
          store.members.some((m) => m.project_id === p.id && m.user_id === user.id)) &&
        (!status || p.status === status),
    );
    rows = [...rows].sort(
      (a, b) =>
        Number(Boolean(mine(b)?.pinned)) - Number(Boolean(mine(a)?.pinned)) ||
        b.created_at - a.created_at,
    );
    const withExtras = rows.map((p) => ({
      ...p,
      my_muted: Boolean(mine(p)?.muted),
      my_pinned: Boolean(mine(p)?.pinned),
      owner_name: store.users.find((u) => u.id === p.owner_id)?.name,
      member_count: store.members.filter((m) => m.project_id === p.id).length,
    }));
    return { rows: withExtras.slice(offset, offset + limit), total: rows.length };
  },
  async getMySettings(projectId, userId) {
    const m = store.members.find((x) => x.project_id === projectId && x.user_id === userId);
    return { muted: Boolean(m?.muted), pinned: Boolean(m?.pinned) };
  },
  async updateMySettings(projectId, userId, { muted, pinned }) {
    const m = store.members.find((x) => x.project_id === projectId && x.user_id === userId);
    if (!m) return null;
    if (muted !== undefined) m.muted = muted;
    if (pinned !== undefined) m.pinned = pinned;
    return { muted: Boolean(m.muted), pinned: Boolean(m.pinned) };
  },
  async findById(id) {
    return store.projects.find((p) => p.id === id) ?? null;
  },
  async isMember(projectId, userId) {
    return store.members.some((m) => m.project_id === projectId && m.user_id === userId);
  },
  async keyTaken(key) {
    return store.projects.some((p) => p.key === key);
  },
  async insertProject(client, { name, description, ownerId, key }) {
    if (store.projects.some((p) => p.key === key)) {
      throw Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'projects_key_key',
      });
    }
    const row = {
      id: crypto.randomUUID(),
      key,
      task_seq: 0,
      name,
      description: description ?? null,
      owner_id: ownerId,
      status: 'active',
      created_at: new Date(Date.now() + store.projects.length), // 생성 순서 보장
      updated_at: new Date(),
    };
    store.projects.push(row);
    return row;
  },
  async addMembers(client, projectId, userIds) {
    for (const userId of userIds) {
      if (!store.members.some((m) => m.project_id === projectId && m.user_id === userId)) {
        store.members.push({ project_id: projectId, user_id: userId, joined_at: new Date() });
      }
    }
  },
  async updateProject(id, patch) {
    const p = store.projects.find((x) => x.id === id);
    if (!p) return null;
    if (patch.key !== undefined && store.projects.some((x) => x.id !== id && x.key === patch.key)) {
      throw Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'projects_key_key',
      });
    }
    for (const key of ['name', 'description', 'status', 'key']) {
      if (patch[key] !== undefined) p[key] = patch[key];
    }
    p.updated_at = new Date();
    return p;
  },
  async deleteProject(id) {
    const before = store.projects.length;
    const gone = new Set(store.tasks.filter((t) => t.project_id === id).map((t) => t.id));
    store.comments = store.comments.filter((c) => !gone.has(c.task_id));
    store.tasks = store.tasks.filter((t) => t.project_id !== id);
    store.projects = store.projects.filter((p) => p.id !== id);
    store.members = store.members.filter((m) => m.project_id !== id);
    return store.projects.length < before;
  },
  async listMembers(projectId) {
    const project = store.projects.find((p) => p.id === projectId);
    return store.members
      .filter((m) => m.project_id === projectId)
      .map((m) => {
        const u = store.users.find((x) => x.id === m.user_id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          is_active: u.is_active,
          joined_at: m.joined_at,
          is_owner: u.id === project.owner_id,
        };
      })
      .sort((a, b) => Number(b.is_owner) - Number(a.is_owner));
  },
  async addMember(projectId, userId) {
    if (store.members.some((m) => m.project_id === projectId && m.user_id === userId)) {
      return false;
    }
    store.members.push({ project_id: projectId, user_id: userId, joined_at: new Date() });
    return true;
  },
  async removeMember(projectId, userId) {
    const before = store.members.length;
    store.members = store.members.filter(
      (m) => !(m.project_id === projectId && m.user_id === userId),
    );
    return store.members.length < before;
  },
  async filterActiveUserIds(ids) {
    return ids.filter((id) => store.users.some((u) => u.id === id && u.is_active));
  },
};

const STEP = 1024;
const withNames = (t) => ({
  ...t,
  assignee_name: store.users.find((u) => u.id === t.assignee_id)?.name ?? null,
  project_name: store.projects.find((p) => p.id === t.project_id)?.name,
  project_key: store.projects.find((p) => p.id === t.project_id)?.key,
  comment_count: store.comments.filter((c) => c.task_id === t.id && !c.deleted_at).length,
  blocked_by: store.deps
    .filter((d) => d.task_id === t.id)
    .map((d) => store.tasks.find((x) => x.id === d.depends_on_id))
    .filter(Boolean)
    .map((b) => ({ id: b.id, title: b.title, status: b.status, dueDate: b.due_date })),
  pull_requests: store.githubLinks
    .filter((l) => l.task_id === t.id && l.kind === 'pull_request')
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 3)
    .map((l) => ({ number: l.external_id, state: l.state, url: l.url })),
  checklist_total: store.checklist.filter((i) => i.task_id === t.id).length,
  checklist_done: store.checklist.filter((i) => i.task_id === t.id && i.is_done).length,
  labels: store.taskLabels
    .filter((tl) => tl.task_id === t.id)
    .map((tl) => store.labels.find((l) => l.id === tl.label_id))
    .filter(Boolean)
    .map((l) => ({ id: l.id, name: l.name, color: l.color }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
});
const matches = (t, f, meId) =>
  (!f.status || t.status === f.status) &&
  (!f.priority || t.priority === f.priority) &&
  (!f.label || store.taskLabels.some((tl) => tl.task_id === t.id && tl.label_id === f.label)) &&
  (!f.dueBefore || (t.due_date && t.due_date <= f.dueBefore)) &&
  (!f.q ||
    t.title.toLowerCase().includes(f.q.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(f.q.toLowerCase())) &&
  (!f.assignee ||
    (f.assignee === 'unassigned'
      ? t.assignee_id === null
      : t.assignee_id === (f.assignee === 'me' ? meId : f.assignee)));
const nextPosition = (projectId, status) =>
  Math.max(
    0,
    ...store.tasks
      .filter((t) => t.project_id === projectId && t.status === status)
      .map((t) => t.position),
  ) + STEP;

export const tasksRepo = {
  async countByProject(projectId) {
    return store.tasks.filter((t) => t.project_id === projectId).length;
  },
  async findById(id) {
    const t = store.tasks.find((x) => x.id === id);
    return t ? withNames(t) : null;
  },
  async listByProject(projectId, filters, meId, paging) {
    let rows = store.tasks.filter((t) => t.project_id === projectId && matches(t, filters, meId));
    rows = filters.grouped
      ? rows.sort((a, b) => a.position - b.position)
      : rows.sort((a, b) => b.created_at - a.created_at);
    const total = rows.length;
    if (paging) rows = rows.slice(paging.offset, paging.offset + paging.limit);
    return { rows: rows.map(withNames), total };
  },
  async listAssignedTo(user, filters, { limit, offset }) {
    const rows = store.tasks.filter(
      (t) =>
        t.assignee_id === user.id &&
        matches(t, { ...filters, assignee: undefined }, user.id) &&
        (user.role === 'admin' ||
          store.members.some((m) => m.project_id === t.project_id && m.user_id === user.id)),
    );
    return { rows: rows.slice(offset, offset + limit).map(withNames), total: rows.length };
  },
  async findByKey(projectKey, number) {
    const p = store.projects.find((x) => x.key === projectKey.toUpperCase());
    const t = p && store.tasks.find((x) => x.project_id === p.id && x.number === number);
    return t ? withNames(t) : null;
  },
  async insertTask(input) {
    const now = new Date(Date.now() + store.tasks.length);
    const project = store.projects.find((p) => p.id === input.projectId);
    project.task_seq = (project.task_seq ?? 0) + 1;
    const row = {
      id: crypto.randomUUID(),
      number: project.task_seq,
      project_id: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      assignee_id: input.assigneeId ?? null,
      created_by: input.createdBy,
      start_date: input.startDate ?? null,
      due_date: input.dueDate ?? null,
      position: nextPosition(input.projectId, input.status),
      completed_at: input.status === 'done' ? new Date() : null,
      due_notified_at: null,
      overdue_notified_at: null,
      created_at: now,
      updated_at: now,
    };
    store.tasks.push(row);
    return withNames(row);
  },
  async updateTask(id, patch, current) {
    const t = store.tasks.find((x) => x.id === id);
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.description !== undefined) t.description = patch.description;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.assigneeId !== undefined) t.assignee_id = patch.assigneeId;
    if (patch.startDate !== undefined) t.start_date = patch.startDate;
    if (patch.dueDate !== undefined) {
      t.due_date = patch.dueDate;
      t.due_notified_at = null;
      t.overdue_notified_at = null;
    }
    if (patch.status !== undefined && patch.status !== current.status) {
      t.position = nextPosition(t.project_id, patch.status);
      t.status = patch.status;
      t.completed_at = patch.status === 'done' ? new Date() : null;
    }
    t.updated_at = new Date();
    return withNames(t);
  },
  // 실제 repository.moveTask 와 같은 규칙을 메모리에서 재현한다. (SQL 은 실DB 스모크가 검증)
  async moveTask(client, task, { status, beforeId, afterId }) {
    const column = () =>
      store.tasks.filter((t) => t.project_id === task.project_id && t.status === status);
    const ids = [beforeId, afterId].filter(Boolean);
    const read = () => {
      const byId = Object.fromEntries(
        column()
          .filter((t) => t.id !== task.id)
          .map((t) => [t.id, t.position]),
      );
      if (ids.some((id) => byId[id] === undefined)) {
        throw badRequest('이웃 작업이 대상 컬럼에 없습니다.');
      }
      return { before: byId[beforeId], after: byId[afterId] };
    };

    let position;
    if (ids.length === 0) {
      const others = column().filter((t) => t.id !== task.id);
      position = positionBetween(
        others.length ? Math.max(...others.map((t) => t.position)) : undefined,
        undefined,
      );
    } else {
      let { before, after } = read();
      position = positionBetween(before, after);
      if (position === null) {
        column()
          .sort((a, b) => a.position - b.position || a.created_at - b.created_at)
          .forEach((t, i) => {
            t.position = (i + 1) * STEP;
          });
        ({ before, after } = read());
        position = positionBetween(before, after);
        if (position === null) throw conflict('STALE_POSITION', '작업 순서가 바뀌었습니다.');
      }
    }
    const t = store.tasks.find((x) => x.id === task.id);
    if (status === 'done') {
      if (t.status !== 'done') t.completed_at = new Date();
    } else {
      t.completed_at = null;
    }
    t.status = status;
    t.position = position;
    t.updated_at = new Date();
  },
  async deleteTask(id) {
    const before = store.tasks.length;
    store.comments = store.comments.filter((c) => c.task_id !== id);
    store.deps = store.deps.filter((d) => d.task_id !== id && d.depends_on_id !== id);
    store.githubLinks = store.githubLinks.filter((l) => l.task_id !== id);
    store.checklist = store.checklist.filter((i) => i.task_id !== id);
    store.taskLabels = store.taskLabels.filter((tl) => tl.task_id !== id);
    store.notifications = store.notifications.filter((n) => n.task_id !== id);
    store.tasks = store.tasks.filter((t) => t.id !== id);
    return store.tasks.length < before;
  },
  async unassignUserInProject(client, projectId, userId) {
    for (const t of store.tasks) {
      if (t.project_id === projectId && t.assignee_id === userId) t.assignee_id = null;
    }
  },
};

const withAuthor = (c) => ({
  ...c,
  author_name: store.users.find((u) => u.id === c.author_id)?.name,
  project_id: store.tasks.find((t) => t.id === c.task_id)?.project_id,
  task_title: store.tasks.find((t) => t.id === c.task_id)?.title,
  mentions: (c.mentions ?? []).map((m) => ({ ...m })),
  reactions: groupReactions(store.commentReactions.filter((r) => r.target_id === c.id)),
});

export const commentsRepo = {
  async setReaction(commentId, userId, emoji, on) {
    store.commentReactions = store.commentReactions.filter(
      (r) => !(r.target_id === commentId && r.user_id === userId && r.emoji === emoji),
    );
    if (on) {
      store.commentReactions.push({
        target_id: commentId,
        user_id: userId,
        emoji,
        at: ++reactionSeq,
      });
    }
  },
  async findById(id) {
    const c = store.comments.find((x) => x.id === id);
    return c ? withAuthor(c) : null;
  },
  async listByTask(taskId) {
    return store.comments
      .filter((c) => c.task_id === taskId)
      .sort((a, b) => a.created_at - b.created_at)
      .map(withAuthor);
  },
  async memberNames(projectId, ids) {
    return ids
      .map((id) => store.users.find((u) => u.id === id))
      .filter(
        (u) =>
          u?.is_active &&
          store.members.some((m) => m.project_id === projectId && m.user_id === u.id),
      )
      .map((u) => ({ id: u.id, name: u.name }));
  },
  async insertComment({ taskId, authorId, body, mentions = [], parentId = null }) {
    const now = new Date(Date.now() + store.comments.length);
    const row = {
      id: crypto.randomUUID(),
      task_id: taskId,
      author_id: authorId,
      parent_id: parentId,
      body,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      mentions: mentions.map((m) => ({ ...m })),
    };
    store.comments.push(row);
    return withAuthor(row);
  },
  async updateBody(id, body, mentions = []) {
    const c = store.comments.find((x) => x.id === id && !x.deleted_at);
    if (!c) return null;
    c.body = body;
    c.mentions = mentions.map((m) => ({ ...m }));
    c.updated_at = new Date(c.created_at.getTime() + 5000);
    return withAuthor(c);
  },
  async softDelete(id) {
    const c = store.comments.find((x) => x.id === id && !x.deleted_at);
    if (!c) return false;
    c.deleted_at = new Date();
    return true;
  },
};

const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const withNotificationNames = (n) => ({
  ...n,
  project_id: store.tasks.find((t) => t.id === n.task_id)?.project_id ?? n.project_id,
  actor_name: store.users.find((u) => u.id === n.actor_id)?.name ?? null,
});

export const notificationsRepo = {
  // 실제 insertMany 와 같은 규칙: 받는 사람이 끈 알림 종류는 만들지 않는다
  async insertMany(rows) {
    const KEY = {
      task_assigned: 'assigned',
      due_soon: 'due',
      task_overdue: 'due',
      comment_added: 'comment',
      mention: 'mention',
    };
    const projectOf = (r) => r.projectId ?? store.tasks.find((t) => t.id === r.taskId)?.project_id;
    rows = rows.filter(
      (r) =>
        store.users.find((u) => u.id === r.userId)?.preferences?.notifications?.[KEY[r.type]] !==
          false &&
        !store.members.some(
          (m) => m.user_id === r.userId && m.project_id === projectOf(r) && m.muted,
        ),
    );
    return rows.map((r, i) => {
      const row = {
        id: crypto.randomUUID(),
        user_id: r.userId,
        type: r.type,
        task_id: r.taskId ?? null,
        project_id: r.projectId ?? null,
        actor_id: r.actorId ?? null,
        message: r.message,
        is_read: false,
        created_at: new Date(Date.now() + store.notifications.length + i),
      };
      store.notifications.push(row);
      return withNotificationNames(row);
    });
  },
  async list(userId, { unread, limit, offset }) {
    const rows = store.notifications
      .filter((n) => n.user_id === userId && (!unread || !n.is_read))
      .sort((a, b) => b.created_at - a.created_at);
    return {
      rows: rows.slice(offset, offset + limit).map(withNotificationNames),
      total: rows.length,
    };
  },
  async unreadCount(userId) {
    return store.notifications.filter((n) => n.user_id === userId && !n.is_read).length;
  },
  async markRead(id, userId) {
    const n = store.notifications.find((x) => x.id === id && x.user_id === userId);
    if (!n) return false;
    n.is_read = true;
    return true;
  },
  async markAllRead(userId) {
    const unread = store.notifications.filter((n) => n.user_id === userId && !n.is_read);
    unread.forEach((n) => {
      n.is_read = true;
    });
    return unread.length;
  },
  async deleteOlderThan(days) {
    const cutoff = Date.now() - days * 86_400_000;
    const before = store.notifications.length;
    store.notifications = store.notifications.filter((n) => n.created_at.getTime() >= cutoff);
    return before - store.notifications.length;
  },
  async filterNotifiable(projectId, userIds) {
    return userIds.filter(
      (id) =>
        store.users.some((u) => u.id === id && u.is_active) &&
        store.members.some((m) => m.project_id === projectId && m.user_id === id),
    );
  },
  async claimDueTasks(client, kind, today) {
    const column = kind === 'overdue' ? 'overdue_notified_at' : 'due_notified_at';
    const claimed = store.tasks.filter((t) => {
      const project = store.projects.find((p) => p.id === t.project_id);
      const assignee = store.users.find((u) => u.id === t.assignee_id);
      const due = t.due_date;
      return (
        t.status !== 'done' &&
        !t[column] &&
        due &&
        (kind === 'overdue' ? due < today : due >= today && due <= addDays(today, 1)) &&
        project?.status === 'active' &&
        assignee?.is_active &&
        store.members.some((m) => m.project_id === t.project_id && m.user_id === t.assignee_id)
      );
    });
    claimed.forEach((t) => {
      t[column] = new Date();
    });
    return claimed.map((t) => ({
      id: t.id,
      title: t.title,
      assignee_id: t.assignee_id,
      due_date: t.due_date,
    }));
  },
};

// 대시보드 집계(실제 repository 와 같은 정의). SQL 은 실DB 스모크가 검증한다.
const sortOverdue = (rows) =>
  rows.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.created_at - b.created_at);
const overdueRows = (tasks, today) =>
  sortOverdue(tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today));
const statusRows = (tasks) =>
  Object.entries(
    tasks.reduce((acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }), {}),
  ).map(([status, n]) => ({ status, n }));
const dueThisWeek = (tasks, today, weekEnd) =>
  tasks.filter(
    (t) => t.status !== 'done' && t.due_date && t.due_date >= today && t.due_date <= weekEnd,
  ).length;
const userName = (id) => store.users.find((u) => u.id === id)?.name ?? null;

export const dashboardRepo = {
  async projectStats(projectId, today, weekEnd) {
    const tasks = store.tasks.filter((t) => t.project_id === projectId);
    const overdue = overdueRows(tasks, today);
    const open = tasks.filter((t) => t.status !== 'done');
    const groups = new Map();
    for (const t of open) groups.set(t.assignee_id, (groups.get(t.assignee_id) ?? 0) + 1);
    return {
      byStatus: statusRows(tasks),
      overdue: overdue.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date,
        assignee_id: t.assignee_id,
        assignee_name: userName(t.assignee_id),
        total: overdue.length,
      })),
      dueThisWeek: dueThisWeek(tasks, today, weekEnd),
      byAssignee: [...groups.entries()]
        .map(([assignee_id, n]) => ({ assignee_id, name: userName(assignee_id), open: n }))
        .sort(
          (a, b) =>
            b.open - a.open ||
            (a.name === null) - (b.name === null) || // 미배정은 동점에서 마지막
            (a.name ?? '').localeCompare(b.name ?? ''),
        ),
    };
  },
  async overallStats(user, today, weekEnd) {
    const projects = store.projects
      .filter(
        (p) =>
          p.status === 'active' &&
          (user.role === 'admin' ||
            store.members.some((m) => m.project_id === p.id && m.user_id === user.id)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const ids = new Set(projects.map((p) => p.id));
    const tasks = store.tasks.filter((t) => ids.has(t.project_id));
    const overdue = overdueRows(tasks, today);
    return {
      byStatus: statusRows(tasks),
      overdue: overdue.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date,
        project_id: t.project_id,
        project_name: projects.find((p) => p.id === t.project_id).name,
        assignee_id: t.assignee_id,
        assignee_name: userName(t.assignee_id),
        total: overdue.length,
      })),
      dueThisWeek: dueThisWeek(tasks, today, weekEnd),
      myOpen: tasks.filter((t) => t.assignee_id === user.id && t.status !== 'done').length,
      projects: projects.map((p) => {
        const own = tasks.filter((t) => t.project_id === p.id);
        return {
          id: p.id,
          name: p.name,
          total: own.length,
          done: own.filter((t) => t.status === 'done').length,
          overdue: overdueRows(own, today).length,
        };
      }),
    };
  },
};

export const apiTokensRepo = {
  toToken: (row) =>
    row && {
      id: row.id,
      name: row.name,
      scope: row.scope,
      prefix: row.prefix,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    },
  async insert({ userId, name, scope, tokenHash, prefix, expiresAt }) {
    const row = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      scope,
      token_hash: tokenHash,
      prefix,
      expires_at: expiresAt,
      last_used_at: null,
      revoked_at: null,
      created_at: new Date(),
    };
    store.apiTokens.push(row);
    return row;
  },
  async listForUser(userId) {
    return store.apiTokens.filter((t) => t.user_id === userId && !t.revoked_at).reverse();
  },
  async countActive(userId) {
    return store.apiTokens.filter(
      (t) => t.user_id === userId && !t.revoked_at && (!t.expires_at || t.expires_at > new Date()),
    ).length;
  },
  async revoke(userId, id) {
    const t = store.apiTokens.find((x) => x.id === id && x.user_id === userId && !x.revoked_at);
    if (!t) return false;
    t.revoked_at = new Date();
    return true;
  },
  async findByHash(hash) {
    const t = store.apiTokens.find((x) => x.token_hash === hash);
    if (!t) return null;
    return { ...t, is_active: store.users.find((u) => u.id === t.user_id)?.is_active ?? false };
  },
  async touch(id) {
    const t = store.apiTokens.find((x) => x.id === id);
    if (t) t.last_used_at = new Date();
  },
  async deleteForUser(userId) {
    store.apiTokens = store.apiTokens.filter((t) => t.user_id !== userId);
  },
  async deleteStale(days) {
    const cutoff = Date.now() - days * 86_400_000;
    const before = store.apiTokens.length;
    store.apiTokens = store.apiTokens.filter(
      (t) =>
        !(
          (t.revoked_at && new Date(t.revoked_at).getTime() < cutoff) ||
          (t.expires_at && new Date(t.expires_at).getTime() < cutoff)
        ),
    );
    return before - store.apiTokens.length;
  },
};

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
};

export function reset() {
  store.users = [];
  store.tokens = [];
  store.projects = [];
  store.members = [];
  store.tasks = [];
  store.comments = [];
  store.notifications = [];
}

const pub = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  is_active: u.is_active,
  created_at: u.created_at,
});

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
  async updateProfile(id, { name, passwordHash }) {
    const u = store.users.find((x) => x.id === id);
    if (!u) return null;
    if (name) u.name = name;
    if (passwordHash) u.password_hash = passwordHash;
    return pub(u);
  },
};

export const authRepo = {
  async insertRefreshToken({ userId, tokenHash, expiresAt }) {
    store.tokens.push({
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked_at: null,
    });
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
};

export const projectsRepo = {
  async countOwned(userId) {
    return store.projects.filter((p) => p.owner_id === userId).length;
  },
  async countMembers(projectId) {
    return store.members.filter((m) => m.project_id === projectId).length;
  },
  async listForUser(user, { status, limit, offset }) {
    let rows = store.projects.filter(
      (p) =>
        (user.role === 'admin' ||
          store.members.some((m) => m.project_id === p.id && m.user_id === user.id)) &&
        (!status || p.status === status),
    );
    rows = [...rows].sort((a, b) => b.created_at - a.created_at);
    const withExtras = rows.map((p) => ({
      ...p,
      owner_name: store.users.find((u) => u.id === p.owner_id)?.name,
      member_count: store.members.filter((m) => m.project_id === p.id).length,
    }));
    return { rows: withExtras.slice(offset, offset + limit), total: rows.length };
  },
  async findById(id) {
    return store.projects.find((p) => p.id === id) ?? null;
  },
  async isMember(projectId, userId) {
    return store.members.some((m) => m.project_id === projectId && m.user_id === userId);
  },
  async insertProject(client, { name, description, ownerId }) {
    const row = {
      id: crypto.randomUUID(),
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
    for (const key of ['name', 'description', 'status']) {
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
  comment_count: store.comments.filter((c) => c.task_id === t.id && !c.deleted_at).length,
});
const matches = (t, f, meId) =>
  (!f.status || t.status === f.status) &&
  (!f.priority || t.priority === f.priority) &&
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
  async insertTask(input) {
    const now = new Date(Date.now() + store.tasks.length);
    const row = {
      id: crypto.randomUUID(),
      project_id: input.projectId,
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      assignee_id: input.assigneeId ?? null,
      created_by: input.createdBy,
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
});

export const commentsRepo = {
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
  async insertComment({ taskId, authorId, body }) {
    const now = new Date(Date.now() + store.comments.length);
    const row = {
      id: crypto.randomUUID(),
      task_id: taskId,
      author_id: authorId,
      body,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    store.comments.push(row);
    return withAuthor(row);
  },
  async updateBody(id, body) {
    const c = store.comments.find((x) => x.id === id && !x.deleted_at);
    if (!c) return null;
    c.body = body;
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
  project_id: store.tasks.find((t) => t.id === n.task_id)?.project_id,
  actor_name: store.users.find((u) => u.id === n.actor_id)?.name ?? null,
});

export const notificationsRepo = {
  async insertMany(rows) {
    return rows.map((r, i) => {
      const row = {
        id: crypto.randomUUID(),
        user_id: r.userId,
        type: r.type,
        task_id: r.taskId,
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

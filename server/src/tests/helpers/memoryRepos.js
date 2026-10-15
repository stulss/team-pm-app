// DB 없이 서비스/라우트 로직을 검증하기 위한 메모리 저장소.
// repository.js 와 같은 시그니처를 가지며, 행은 DB 행(snake_case)과 같은 모양이다.
// SQL 자체는 검증하지 못한다 — 실제 DB 가 연결되면 통합 테스트로 보강한다.
import crypto from 'node:crypto';

export const store = { users: [], tokens: [], projects: [], members: [] };

export function reset() {
  store.users = [];
  store.tokens = [];
  store.projects = [];
  store.members = [];
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
  async deleteExpired() {},
};

export const projectsRepo = {
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

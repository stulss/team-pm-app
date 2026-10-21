import { query } from '../../config/db.js';

export const toProject = (row) =>
  row && {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    ownerId: row.owner_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.member_count !== undefined && { memberCount: row.member_count }),
    ...(row.owner_name !== undefined && { ownerName: row.owner_name }),
    ...(row.my_pinned !== undefined && {
      mySettings: { muted: row.my_muted, pinned: row.my_pinned },
    }),
  };

export const toMember = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  isActive: row.is_active,
  isOwner: row.is_owner,
  joinedAt: row.joined_at,
});

// Admin 은 전체, 그 외는 멤버로 속한 프로젝트만.
export async function listForUser(user, { status, limit, offset }) {
  const params = [user.id];
  const where = [];
  // 내 멤버 행(없을 수 있음: 멤버가 아닌 Admin). 일반 사용자는 멤버인 프로젝트만 본다.
  const join = 'LEFT JOIN project_members me ON me.project_id = p.id AND me.user_id = $1';
  if (user.role !== 'admin') where.push('me.user_id IS NOT NULL');
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT p.*, o.name AS owner_name,
            COALESCE(me.muted, false) AS my_muted, COALESCE(me.pinned, false) AS my_pinned,
            (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count
     FROM projects p
     JOIN users o ON o.id = p.owner_id
     ${join}
     ${whereSql}
     ORDER BY COALESCE(me.pinned, false) DESC, p.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const count = await query(
    `SELECT count(*)::int AS total FROM projects p ${join} ${whereSql}`,
    params,
  );
  return { rows, total: count.rows[0].total };
}

export async function findById(id) {
  const { rows } = await query('SELECT * FROM projects WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function isMember(projectId, userId) {
  const { rowCount } = await query(
    'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return rowCount === 1;
}

export async function countOwned(userId) {
  const { rows } = await query('SELECT count(*)::int AS n FROM projects WHERE owner_id = $1', [
    userId,
  ]);
  return rows[0].n;
}

export async function countMembers(projectId) {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM project_members WHERE project_id = $1',
    [projectId],
  );
  return rows[0].n;
}

export async function keyTaken(key) {
  const { rowCount } = await query('SELECT 1 FROM projects WHERE key = $1', [key]);
  return rowCount > 0;
}

export async function insertProject(client, { name, description, ownerId, key }) {
  const { rows } = await client.query(
    'INSERT INTO projects (name, description, owner_id, key) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, description ?? null, ownerId, key],
  );
  return rows[0];
}

export async function addMembers(client, projectId, userIds) {
  await client.query(
    `INSERT INTO project_members (project_id, user_id)
     SELECT $1, unnest($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [projectId, userIds],
  );
}

const PATCHABLE = { name: 'name', description: 'description', status: 'status', key: 'key' };

export async function updateProject(id, patch) {
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(PATCHABLE)) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return findById(id);
  const { rows } = await query(
    `UPDATE projects SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteProject(id) {
  const { rowCount } = await query('DELETE FROM projects WHERE id = $1', [id]);
  return rowCount === 1;
}

export async function listMembers(projectId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, m.joined_at,
            (u.id = p.owner_id) AS is_owner
     FROM project_members m
     JOIN users u ON u.id = m.user_id
     JOIN projects p ON p.id = m.project_id
     WHERE m.project_id = $1
     ORDER BY is_owner DESC, m.joined_at ASC`,
    [projectId],
  );
  return rows;
}

export async function addMember(projectId, userId) {
  const { rowCount } = await query(
    'INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [projectId, userId],
  );
  return rowCount === 1;
}

export async function removeMember(projectId, userId, client = { query }) {
  const { rowCount } = await client.query(
    'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return rowCount === 1;
}

// 존재하고 활성인 사용자 ID 만 돌려준다.
export async function filterActiveUserIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await query('SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active', [
    ids,
  ]);
  return rows.map((r) => r.id);
}

export async function getMySettings(projectId, userId) {
  const { rows } = await query(
    'SELECT muted, pinned FROM project_members WHERE project_id = $1 AND user_id = $2',
    [projectId, userId],
  );
  return rows[0] ?? { muted: false, pinned: false };
}

// 멤버가 아니면 null. 받은 키만 바꾼다.
export async function updateMySettings(projectId, userId, { muted, pinned }) {
  const { rows } = await query(
    `UPDATE project_members
        SET muted = COALESCE($3, muted), pinned = COALESCE($4, pinned)
      WHERE project_id = $1 AND user_id = $2
      RETURNING muted, pinned`,
    [projectId, userId, muted ?? null, pinned ?? null],
  );
  return rows[0] ?? null;
}

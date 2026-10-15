import { query } from '../../config/db.js';

export const toProject = (row) =>
  row && {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.member_count !== undefined && { memberCount: row.member_count }),
    ...(row.owner_name !== undefined && { ownerName: row.owner_name }),
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
  const params = [];
  const where = [];
  let join = '';
  if (user.role !== 'admin') {
    params.push(user.id);
    join = `JOIN project_members me ON me.project_id = p.id AND me.user_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    where.push(`p.status = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT p.*, o.name AS owner_name,
            (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count
     FROM projects p
     JOIN users o ON o.id = p.owner_id
     ${join}
     ${whereSql}
     ORDER BY p.created_at DESC
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

export async function insertProject(client, { name, description, ownerId }) {
  const { rows } = await client.query(
    'INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *',
    [name, description ?? null, ownerId],
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

const PATCHABLE = { name: 'name', description: 'description', status: 'status' };

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

export async function removeMember(projectId, userId) {
  const { rowCount } = await query(
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

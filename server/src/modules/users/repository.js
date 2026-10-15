import { query } from '../../config/db.js';

const PUBLIC_COLUMNS = 'id, email, name, role, is_active, created_at';

export const toUser = (row) =>
  row && {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
  };

// 첫 가입자는 자동 Admin. 동시 가입으로 Admin 이 둘 생기지 않도록 트랜잭션 + advisory lock 안에서 호출한다.
export async function insertUser(client, { email, passwordHash, name }) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('users:first-admin'))");
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3,
       CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'member'::user_role ELSE 'admin'::user_role END)
     RETURNING ${PUBLIC_COLUMNS}`,
    [email, passwordHash, name],
  );
  return rows[0];
}

export async function findByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] ?? null;
}

export async function findById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function search({ q, limit, offset }) {
  const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const where = pattern ? 'WHERE name ILIKE $1 OR email ILIKE $1' : '';
  const params = pattern ? [pattern] : [];
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM users ${where}
     ORDER BY created_at ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const count = await query(`SELECT count(*)::int AS total FROM users ${where}`, params);
  return { rows, total: count.rows[0].total };
}

export async function countActiveAdmins() {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active",
  );
  return rows[0].n;
}

export async function updateRole(id, role) {
  const { rows } = await query(
    `UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, role],
  );
  return rows[0] ?? null;
}

export async function updateStatus(id, isActive) {
  const { rows } = await query(
    `UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, isActive],
  );
  return rows[0] ?? null;
}

export async function updateProfile(id, { name, passwordHash }) {
  const { rows } = await query(
    `UPDATE users
       SET name = COALESCE($2, name),
           password_hash = COALESCE($3, password_hash),
           updated_at = now()
     WHERE id = $1
     RETURNING ${PUBLIC_COLUMNS}`,
    [id, name ?? null, passwordHash ?? null],
  );
  return rows[0] ?? null;
}

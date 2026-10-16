import { query } from '../../config/db.js';

// 권한 필터는 SQL 에서 건다: 내가 멤버인 프로젝트(Admin 은 전체)만 대상이다.
// $1 = 사용자 ID, $2 = Admin 여부, $3 = LIKE 패턴(와일드카드는 이스케이프됨), $4 = 건수
const ACCESS = `($2::boolean OR EXISTS (
  SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $1))`;

const run = (sql, { userId, isAdmin, pattern, limit }) =>
  query(sql, [userId, isAdmin, pattern, limit]).then((r) => r.rows);

export const searchProjects = (args) =>
  run(
    `SELECT p.id, p.name, p.status
     FROM projects p
     WHERE ${ACCESS} AND p.name ILIKE $3 ESCAPE '\\'
     ORDER BY p.name
     LIMIT $4`,
    args,
  );

export const searchTasks = (args) =>
  run(
    `SELECT t.id, t.title, t.description, t.status, t.project_id, p.name AS project_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE ${ACCESS} AND (t.title ILIKE $3 ESCAPE '\\' OR t.description ILIKE $3 ESCAPE '\\')
     ORDER BY t.updated_at DESC
     LIMIT $4`,
    args,
  );

export const searchComments = (args) =>
  run(
    `SELECT c.id, c.body, c.created_at, c.task_id, t.title AS task_title, t.project_id,
            p.name AS project_name, c.author_id, u.name AS author_name
     FROM comments c
     JOIN tasks t ON t.id = c.task_id
     JOIN projects p ON p.id = t.project_id
     JOIN users u ON u.id = c.author_id
     WHERE ${ACCESS} AND c.deleted_at IS NULL AND c.body ILIKE $3 ESCAPE '\\'
     ORDER BY c.created_at DESC
     LIMIT $4`,
    args,
  );

export const searchChat = (args) =>
  run(
    `SELECT m.id, m.seq, m.body, m.created_at, m.project_id, p.name AS project_name,
            m.author_id, u.name AS author_name
     FROM chat_messages m
     JOIN projects p ON p.id = m.project_id
     LEFT JOIN users u ON u.id = m.author_id
     WHERE ${ACCESS} AND m.body ILIKE $3 ESCAPE '\\'
     ORDER BY m.seq DESC
     LIMIT $4`,
    args,
  );

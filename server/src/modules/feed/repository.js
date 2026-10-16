import { query } from '../../config/db.js';

// 모든 질의는 "내가 지금 멤버인 프로젝트"로 한정한다(project_members 조인). Admin 도 마찬가지다(내 피드).

// 나에게 배정된, 끝나지 않은, 보관되지 않은 프로젝트의 작업 중 마감이 지났거나 until(YYYY-MM-DD) 이내인 것.
export async function dueTasks(userId, until, limit) {
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, p.name AS project_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id AND p.status = 'active'
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     WHERE t.assignee_id = $1 AND t.status <> 'done'
       AND t.due_date IS NOT NULL AND t.due_date <= $2::date
     ORDER BY t.due_date, t.created_at
     LIMIT $3`,
    [userId, until, limit],
  );
  return rows;
}

// 나를 멘션한 삭제되지 않은 댓글(내가 쓴 것 제외), 최신순.
export async function mentions(userId, limit) {
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, c.task_id, t.title AS task_title, t.project_id,
            p.name AS project_name, c.author_id, u.name AS author_name
     FROM comment_mentions cm
     JOIN comments c ON c.id = cm.comment_id AND c.deleted_at IS NULL AND c.author_id <> $1
     JOIN tasks t ON t.id = c.task_id
     JOIN projects p ON p.id = t.project_id
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     JOIN users u ON u.id = c.author_id
     WHERE cm.user_id = $1
     ORDER BY cm.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

// 내 프로젝트들의 최근 활동 중 내가 한 것을 뺀 것(내가 없는 동안 일어난 일).
export async function activities(userId, limit) {
  const { rows } = await query(
    `SELECT l.id, l.seq, l.action, l.task_id, l.actor_id, l.meta, l.created_at,
            l.project_id, p.name AS project_name, a.name AS actor_name
     FROM activity_logs l
     JOIN projects p ON p.id = l.project_id
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     LEFT JOIN users a ON a.id = l.actor_id
     WHERE l.actor_id IS DISTINCT FROM $1
     ORDER BY l.seq DESC
     LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

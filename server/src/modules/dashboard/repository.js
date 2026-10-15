import { query } from '../../config/db.js';

// 모든 집계는 "오늘(today)"과 "이번 주 끝(weekEnd)"을 호출자가 정해 넘긴다(시간대는 서비스에서 처리).
// 지연 = 마감일 < 오늘 이면서 완료가 아닌 작업. 이번 주 마감 = 오늘 ≤ 마감일 ≤ 이번 주 일요일 이면서 완료가 아닌 작업.

const OVERDUE_LIMIT = 10;

export async function projectStats(projectId, today, weekEnd) {
  const [status, overdue, week, assignees] = await Promise.all([
    query('SELECT status, count(*)::int AS n FROM tasks WHERE project_id = $1 GROUP BY status', [
      projectId,
    ]),
    query(
      `SELECT t.id, t.title, t.due_date, t.assignee_id, a.name AS assignee_name,
              count(*) OVER ()::int AS total
       FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
       WHERE t.project_id = $1 AND t.status <> 'done' AND t.due_date < $2::date
       ORDER BY t.due_date ASC, t.created_at ASC
       LIMIT ${OVERDUE_LIMIT}`,
      [projectId, today],
    ),
    query(
      `SELECT count(*)::int AS n FROM tasks
       WHERE project_id = $1 AND status <> 'done'
         AND due_date >= $2::date AND due_date <= $3::date`,
      [projectId, today, weekEnd],
    ),
    query(
      `SELECT t.assignee_id, a.name, count(*)::int AS open
       FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
       WHERE t.project_id = $1 AND t.status <> 'done'
       GROUP BY t.assignee_id, a.name
       ORDER BY open DESC, a.name ASC NULLS LAST`,
      [projectId],
    ),
  ]);
  return {
    byStatus: status.rows,
    overdue: overdue.rows,
    dueThisWeek: week.rows[0].n,
    byAssignee: assignees.rows,
  };
}

// 내 전체 요약: 진행 중(active) 프로젝트만. Admin 은 전체, 그 외는 소속 프로젝트.
const SCOPE = `
  WITH scoped AS (
    SELECT p.id, p.name FROM projects p
    WHERE p.status = 'active'
      AND ($2::boolean OR EXISTS (
        SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1))
  )`;

export async function overallStats(user, today, weekEnd) {
  const isAdmin = user.role === 'admin';
  const base = [user.id, isAdmin];
  const [status, overdue, week, mine, projects] = await Promise.all([
    query(
      `${SCOPE}
       SELECT t.status, count(*)::int AS n FROM tasks t JOIN scoped s ON s.id = t.project_id
       GROUP BY t.status`,
      base,
    ),
    query(
      `${SCOPE}
       SELECT t.id, t.title, t.due_date, t.project_id, s.name AS project_name,
              t.assignee_id, a.name AS assignee_name, count(*) OVER ()::int AS total
       FROM tasks t JOIN scoped s ON s.id = t.project_id
       LEFT JOIN users a ON a.id = t.assignee_id
       WHERE t.status <> 'done' AND t.due_date < $3::date
       ORDER BY t.due_date ASC, t.created_at ASC
       LIMIT ${OVERDUE_LIMIT}`,
      [...base, today],
    ),
    query(
      `${SCOPE}
       SELECT count(*)::int AS n FROM tasks t JOIN scoped s ON s.id = t.project_id
       WHERE t.status <> 'done' AND t.due_date >= $3::date AND t.due_date <= $4::date`,
      [...base, today, weekEnd],
    ),
    query(
      `${SCOPE}
       SELECT count(*)::int AS n FROM tasks t JOIN scoped s ON s.id = t.project_id
       WHERE t.assignee_id = $1 AND t.status <> 'done'`,
      base,
    ),
    query(
      `${SCOPE}
       SELECT s.id, s.name,
              count(t.id)::int AS total,
              (count(t.id) FILTER (WHERE t.status = 'done'))::int AS done,
              (count(t.id) FILTER (WHERE t.status <> 'done' AND t.due_date < $3::date))::int AS overdue
       FROM scoped s LEFT JOIN tasks t ON t.project_id = s.id
       GROUP BY s.id, s.name
       ORDER BY s.name ASC`,
      [...base, today],
    ),
  ]);
  return {
    byStatus: status.rows,
    overdue: overdue.rows,
    dueThisWeek: week.rows[0].n,
    myOpen: mine.rows[0].n,
    projects: projects.rows,
  };
}

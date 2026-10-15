import { STATUSES } from '../tasks/repository.js';
import { todayIn } from '../notifications/service.js';
import * as repo from './repository.js';

export const UNASSIGNED = '미배정';

// 이번 주 끝 = 오늘이 속한 주의 일요일 (오늘이 일요일이면 오늘). today: 'YYYY-MM-DD'
export function weekEndOf(today) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

// 진행률(%) — 소수 첫째 자리까지. 작업이 없으면 0.
export const percentOf = (done, total) =>
  total === 0 ? 0 : Math.round((done / total) * 1000) / 10;

function summarize(byStatusRows) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of byStatusRows) byStatus[row.status] = row.n;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    byStatus,
    progress: { total, done: byStatus.done, percent: percentOf(byStatus.done, total) },
  };
}

const assignee = (row) =>
  row.assignee_id ? { id: row.assignee_id, name: row.assignee_name } : null;

export async function projectDashboard(project, today = todayIn()) {
  const stats = await repo.projectStats(project.id, today, weekEndOf(today));
  return {
    projectId: project.id,
    ...summarize(stats.byStatus),
    overdue: {
      count: stats.overdue[0]?.total ?? 0,
      tasks: stats.overdue.map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.due_date,
        assignee: assignee(r),
      })),
    },
    dueThisWeek: stats.dueThisWeek,
    byAssignee: stats.byAssignee.map((r) => ({
      userId: r.assignee_id,
      name: r.assignee_id ? r.name : UNASSIGNED,
      open: r.open,
    })),
  };
}

export async function overallDashboard(user, today = todayIn()) {
  const stats = await repo.overallStats(user, today, weekEndOf(today));
  return {
    ...summarize(stats.byStatus),
    overdue: {
      count: stats.overdue[0]?.total ?? 0,
      tasks: stats.overdue.map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: r.due_date,
        projectId: r.project_id,
        projectName: r.project_name,
        assignee: assignee(r),
      })),
    },
    dueThisWeek: stats.dueThisWeek,
    myOpen: stats.myOpen,
    projects: stats.projects.map((p) => ({
      id: p.id,
      name: p.name,
      total: p.total,
      done: p.done,
      percent: percentOf(p.done, p.total),
      overdue: p.overdue,
    })),
  };
}

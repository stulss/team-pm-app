import { list as listNotifications, todayIn } from '../notifications/service.js';
import * as repo from './repository.js';

export const DUE_WINDOW_DAYS = 7;
const DUE_LIMIT = 10;
const MENTION_LIMIT = 10;
const ACTIVITY_LIMIT = 15;
const NOTIFICATION_PREVIEW = 5;

// 'YYYY-MM-DD' 에 days 일을 더한다(시간대 영향 없이 날짜만 계산).
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 댓글 본문 앞부분(한 줄). 일치 검색이 아니라 처음부터 자른다.
const preview = (body) => {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
};

const dateOnly = (v) =>
  v instanceof Date ? v.toLocaleDateString('sv-SE') : String(v).slice(0, 10);

export async function feed(user, today = todayIn()) {
  const [due, mentioned, activities, unread] = await Promise.all([
    repo.dueTasks(user.id, addDays(today, DUE_WINDOW_DAYS), DUE_LIMIT),
    repo.mentions(user.id, MENTION_LIMIT),
    repo.activities(user.id, ACTIVITY_LIMIT),
    listNotifications(user, { unread: true, page: 1, limit: NOTIFICATION_PREVIEW }),
  ]);

  return {
    today,
    dueTasks: due.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: dateOnly(t.due_date),
      overdue: dateOnly(t.due_date) < today,
      projectId: t.project_id,
      projectName: t.project_name,
    })),
    mentions: mentioned.map((c) => ({
      commentId: c.id,
      taskId: c.task_id,
      taskTitle: c.task_title,
      projectId: c.project_id,
      projectName: c.project_name,
      author: c.author_id ? { id: c.author_id, name: c.author_name } : null,
      snippet: preview(c.body),
      createdAt: c.created_at,
    })),
    notifications: { unread: unread.meta.total, items: unread.data },
    activities: activities.map((l) => ({
      id: l.id,
      seq: Number(l.seq),
      action: l.action,
      taskId: l.task_id,
      actor: l.actor_id ? { id: l.actor_id, name: l.actor_name } : null,
      meta: l.meta,
      createdAt: l.created_at,
      projectId: l.project_id,
      projectName: l.project_name,
    })),
  };
}

import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { emitToUser } from '../../sockets/emitter.js';
import { notFound } from '../../utils/errors.js';
import * as authRepo from '../auth/repository.js';
import * as activityRepo from '../activity/repository.js';
import * as shareRepo from '../share/repository.js';
import * as repo from './repository.js';
import { logger } from '../../utils/logger.js';

// 알림 생성은 부가 기능이다. 실패해도 원래 요청(작업 수정, 댓글 작성 등)을 깨뜨리지 않는다.
async function push(inserted) {
  await Promise.all(
    inserted.map((row) =>
      emitToUser(row.user_id, 'notification:new', { notification: repo.toNotification(row) }),
    ),
  );
}

async function createAndPush(rows) {
  try {
    await push(await repo.insertMany(rows));
  } catch (err) {
    logger.error({ err: err.message }, 'notification create failed');
  }
}

// 담당자 지정·변경 → 새 담당자 (본인이 본인에게 지정한 경우는 제외)
export async function notifyTaskAssigned({ task, actor }) {
  const assigneeId = task.assignee?.id;
  if (!assigneeId || assigneeId === actor.id) return;
  await createAndPush([
    {
      userId: assigneeId,
      type: 'task_assigned',
      taskId: task.id,
      actorId: actor.id,
      message: `${actor.name}님이 '${task.title}' 작업을 배정했습니다.`,
    },
  ]);
}

// 댓글 → 작업의 담당자와 작성자 (댓글 작성자 본인 제외, 활성 프로젝트 멤버만)
export async function notifyCommentAdded({ task, actor, excludeUserIds = [] }) {
  try {
    const candidates = [...new Set([task.assignee_id, task.created_by])].filter(
      (id) => id && id !== actor.id && !excludeUserIds.includes(id),
    );
    const recipients = await repo.filterNotifiable(task.project_id, candidates);
    await createAndPush(
      recipients.map((userId) => ({
        userId,
        type: 'comment_added',
        taskId: task.id,
        actorId: actor.id,
        message: `${actor.name}님이 '${task.title}' 작업에 댓글을 남겼습니다.`,
      })),
    );
  } catch (err) {
    logger.error({ err: err.message }, 'comment notification failed');
  }
}

// 댓글에서 멘션된 사용자 (본인 제외, 활성 프로젝트 멤버만)
export async function notifyMentioned({ task, actor, userIds }) {
  try {
    const candidates = [...new Set(userIds)].filter((id) => id !== actor.id);
    const recipients = await repo.filterNotifiable(task.project_id, candidates);
    await createAndPush(
      recipients.map((userId) => ({
        userId,
        type: 'mention',
        taskId: task.id,
        actorId: actor.id,
        message: `${actor.name}님이 '${task.title}' 작업의 댓글에서 회원님을 언급했습니다.`,
      })),
    );
  } catch (err) {
    logger.error({ err: err.message }, 'mention notification failed');
  }
}

export async function list(user, { unread, page, limit }) {
  const { rows, total } = await repo.list(user.id, { unread, limit, offset: (page - 1) * limit });
  return { data: rows.map(repo.toNotification), meta: { page, limit, total } };
}

export const unreadCount = (user) => repo.unreadCount(user.id);

export async function markRead(user, id) {
  if (!(await repo.markRead(id, user.id))) throw notFound('알림을 찾을 수 없습니다.');
}

export const markAllRead = (user) => repo.markAllRead(user.id);

// 설정된 시간대 기준의 오늘 날짜(YYYY-MM-DD)
export const todayIn = (timeZone = env.APP_TIMEZONE) =>
  new Date().toLocaleDateString('sv-SE', { timeZone });

const DUE_MESSAGES = {
  soon: (t, today) => `'${t.title}' 마감이 ${t.due_date === today ? '오늘' : '내일'}입니다.`,
  overdue: (t) => `'${t.title}' 마감일(${t.due_date})이 지났습니다.`,
};

// 하루 1회(Vercel Cron): 마감 임박/지연 알림 + 오래된 데이터 정리.
// 알림 대상 확보(표시 컬럼 갱신)와 알림 생성을 한 트랜잭션에서 해서, 중복 실행에도 한 번만 알린다.
export async function runDailyJobs({ today = todayIn() } = {}) {
  const result = { today, dueSoon: 0, overdue: 0, notificationsDeleted: 0, tokensDeleted: 0 };

  for (const [kind, type, key] of [
    ['soon', 'due_soon', 'dueSoon'],
    ['overdue', 'task_overdue', 'overdue'],
  ]) {
    const inserted = await withTransaction(async (client) => {
      const tasks = await repo.claimDueTasks(client, kind, today);
      return repo.insertMany(
        tasks.map((t) => ({
          userId: t.assignee_id,
          type,
          taskId: t.id,
          actorId: null,
          message: DUE_MESSAGES[kind](t, today),
        })),
        client,
      );
    });
    result[key] = inserted.length;
    await push(inserted);
  }

  result.notificationsDeleted = await repo.deleteOlderThan(repo.RETENTION_DAYS);
  result.tokensDeleted = await authRepo.deleteExpired();
  result.activitiesDeleted = await activityRepo.deleteOlderThan(activityRepo.RETENTION_DAYS);
  result.shareLinksDeleted = await shareRepo.deleteStale();
  return result;
}

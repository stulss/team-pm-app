import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { emitToProject } from '../../sockets/emitter.js';
import * as projectsRepo from '../projects/repository.js';
import * as usersRepo from '../users/repository.js';
import * as tasks from '../tasks/service.js';
import { recordTaskCreated } from '../activity/service.js';
import { notifyTaskAssigned } from '../notifications/service.js';
import * as repo from './repository.js';
import { addDays, firstOnOrAfter, nextAfter } from './schedule.js';

export const list = async (project) => (await repo.list(project.id)).map(repo.toRecurrence);

// 주기에 맞는 값(weekly 는 weekday, monthly 는 monthDay)만 남긴다.
function normalizeRule({ frequency, weekday, monthDay }) {
  const fail = (field) =>
    badRequest('반복 주기 설정이 올바르지 않습니다.', [{ field, issue: 'invalid_for_frequency' }]);
  if (frequency === 'weekly' && (weekday === null || weekday === undefined)) throw fail('weekday');
  if (frequency === 'monthly' && (monthDay === null || monthDay === undefined)) {
    throw fail('monthDay');
  }
  return {
    frequency,
    weekday: frequency === 'weekly' ? weekday : null,
    monthDay: frequency === 'monthly' ? monthDay : null,
  };
}

export async function create(project, user, body, today) {
  tasks.assertWritable(project);
  await tasks.assertAssignable(project.id, body.assigneeId);
  const rule = normalizeRule(body);
  const result = await repo.insert({
    ...body,
    ...rule,
    projectId: project.id,
    createdBy: user.id,
    nextRunDate: firstOnOrAfter(rule, today),
    active: body.active ?? true,
  });
  if (result.full) {
    throw conflict(
      'LIMIT_REACHED',
      `반복 작업은 프로젝트당 최대 ${repo.MAX_PER_PROJECT}개까지 만들 수 있습니다.`,
    );
  }
  return repo.toRecurrence(result.row);
}

export async function update(project, id, patch, today) {
  tasks.assertWritable(project);
  const found = await repo.findInProject(project.id, id);
  if (!found) throw notFound('반복 작업을 찾을 수 없습니다.');
  if (patch.assigneeId && patch.assigneeId !== found.assignee_id) {
    await tasks.assertAssignable(project.id, patch.assigneeId);
  }
  const next = { ...patch };
  const scheduleChanged =
    patch.frequency !== undefined || patch.weekday !== undefined || patch.monthDay !== undefined;
  if (scheduleChanged) {
    const rule = normalizeRule({
      frequency: patch.frequency ?? found.frequency,
      weekday: patch.weekday === undefined ? found.weekday : patch.weekday,
      monthDay: patch.monthDay === undefined ? found.month_day : patch.monthDay,
    });
    Object.assign(next, rule);
  }
  // 주기를 바꾸거나 다시 켜면 오늘 이후의 첫 실행일로 다시 맞춘다(꺼 둔 동안 밀린 날짜를 따라잡지 않는다).
  if (scheduleChanged || (patch.active === true && !found.active)) {
    next.nextRunDate = firstOnOrAfter(
      {
        frequency: next.frequency ?? found.frequency,
        weekday: next.weekday === undefined ? found.weekday : next.weekday,
        monthDay: next.monthDay === undefined ? found.month_day : next.monthDay,
      },
      today,
    );
  }
  return repo.toRecurrence(await repo.update(found.id, next));
}

export async function remove(project, id) {
  const found = await repo.findInProject(project.id, id);
  if (!found) throw notFound('반복 작업을 찾을 수 없습니다.');
  await repo.remove(found.id);
}

// 일일 cron: 오늘 만들 차례인 규칙마다 카드를 하나 만든다. 한 규칙의 실패가 나머지를 막지 않는다.
export async function createDueTasks(today) {
  let created = 0;
  for (const row of await repo.listDue(today)) {
    try {
      if (!(await repo.claim(row.id, row.next_run_date, nextAfter(repo.ruleOf(row), today)))) {
        continue; // 다른 실행이 먼저 맡았다
      }
      if (await createOne(row, today)) created += 1;
    } catch (err) {
      logger.error({ err: err.message, recurrenceId: row.id }, 'recurring task failed');
    }
  }
  return created;
}

async function createOne(row, today) {
  const project = await projectsRepo.findById(row.project_id);
  const creator = await usersRepo.findById(row.created_by);
  if (!project || !creator?.is_active) {
    logger.warn({ recurrenceId: row.id }, 'recurring task skipped: project or creator unavailable');
    return false;
  }
  const body = {
    title: row.title,
    description: row.description ?? undefined,
    status: 'todo',
    priority: row.priority,
    assigneeId: row.assignee_id ?? undefined,
    dueDate: row.due_after_days === null ? undefined : addDays(today, row.due_after_days),
  };
  let task;
  try {
    task = await createWithFallback(project, creator, body);
  } catch (err) {
    logger.warn({ err: err.message, recurrenceId: row.id }, 'recurring task skipped');
    return false;
  }
  await emitToProject(null, project.id, 'task:created', { projectId: project.id, task });
  await notifyTaskAssigned({ task, actor: creator });
  await recordTaskCreated({ project, task, actor: creator, meta: { recurrenceId: row.id } });
  return true;
}

// 담당자가 더는 활성 멤버가 아니면 담당자 없이라도 만든다.
async function createWithFallback(project, creator, body) {
  try {
    return await tasks.create(project, creator, body);
  } catch (err) {
    if (!body.assigneeId || err.status !== 400) throw err;
    return tasks.create(project, creator, { ...body, assigneeId: undefined });
  }
}

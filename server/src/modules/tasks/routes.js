import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireProjectMember } from '../../middleware/requireProjectMember.js';
import { requireTaskAccess } from '../../middleware/requireTaskAccess.js';
import { STATUSES } from './repository.js';
import { emitToProject } from '../../sockets/emitter.js';
import { notifyTaskAssigned } from '../notifications/service.js';
import {
  record,
  recordTaskCreated,
  recordTaskMoved,
  recordTaskUpdated,
} from '../activity/service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { TASK_KEY_PATTERN } from '../projects/key.js';
import * as service from './service.js';

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

const status = z.enum(STATUSES);
const priority = z.enum(PRIORITIES);
const date = z.iso.date('마감일은 YYYY-MM-DD 형식이어야 합니다.');
const title = z.string().trim().min(1, '제목을 입력해 주세요.').max(200);
const description = z.string().max(10_000);
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(200).default(100);

const filters = {
  status: status.optional(),
  priority: priority.optional(),
  due_before: date.optional(),
  q: z.string().trim().max(100).optional(),
  label: z.uuid().optional(),
};
const listQuery = z
  .object({
    ...filters,
    assignee: z.union([z.literal('me'), z.literal('unassigned'), z.uuid()]).optional(),
    groupBy: z.literal('status').optional(),
    page,
    limit,
  })
  .transform(({ due_before, ...rest }) => ({ ...rest, dueBefore: due_before }));
const mineQuery = z
  .object({ ...filters, page, limit })
  .transform(({ due_before, ...rest }) => ({ ...rest, dueBefore: due_before }));

const createBody = z.object({
  title,
  description: description.nullish(),
  status: status.default('todo'),
  priority: priority.default('medium'),
  assigneeId: z.uuid('올바르지 않은 담당자 ID 입니다.').nullish(),
  startDate: date.nullish(),
  dueDate: date.nullish(),
});
const patchBody = z
  .object({
    title: title.optional(),
    description: description.nullable().optional(),
    status: status.optional(),
    priority: priority.optional(),
    assigneeId: z.uuid('올바르지 않은 담당자 ID 입니다.').nullable().optional(),
    startDate: date.nullable().optional(),
    dueDate: date.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });

const moveBody = z
  .object({
    status,
    // 대상 컬럼에서 이동 후 바로 위(before)·바로 아래(after)에 올 작업. 둘 다 없으면 맨 아래.
    beforeTaskId: z.uuid().nullish(),
    afterTaskId: z.uuid().nullish(),
  })
  .refine((v) => !v.beforeTaskId || v.beforeTaskId !== v.afterTaskId, {
    message: 'beforeTaskId 와 afterTaskId 는 달라야 합니다.',
  });

// 일괄 수정·삭제: 한 번에 50개까지(중복 id 는 한 번만).
const bulkIds = z
  .array(z.uuid('올바르지 않은 작업 ID 입니다.'))
  .min(1, '작업을 하나 이상 선택해 주세요.')
  .max(50, '한 번에 최대 50개까지 처리할 수 있습니다.')
  .transform((ids) => [...new Set(ids)]);
const bulkUpdateBody = z.object({
  taskIds: bulkIds,
  patch: z
    .object({
      status: status.optional(),
      priority: priority.optional(),
      assigneeId: z.uuid('올바르지 않은 담당자 ID 입니다.').nullable().optional(),
      dueDate: date.nullable().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' }),
});
const bulkDeleteBody = z.object({ taskIds: bulkIds });
// CSV 가져오기: 한 번에 200행까지. 알 수 없는 키는 거부한다.
const importBody = z.object({
  rows: z
    .array(
      z.strictObject({
        title,
        description: description.nullish(),
        status: status.default('todo'),
        priority: priority.default('medium'),
        assigneeId: z.uuid('올바르지 않은 담당자 ID 입니다.').nullish(),
        startDate: date.nullish(),
        dueDate: date.nullish(),
      }),
    )
    .min(1, '가져올 작업이 없습니다.')
    .max(200, '한 번에 최대 200개까지 가져올 수 있습니다.'),
});

// /projects/:id/tasks
export const projectTasksRouter = Router({ mergeParams: true });
projectTasksRouter.use(authenticate);

projectTasksRouter.get(
  '/',
  requireProjectMember(),
  validate(listQuery, 'query'),
  async (req, res) => {
    res.json(await service.listForProject(req.project, req.user, req.query));
  },
);

projectTasksRouter.post('/', requireProjectMember(), validate(createBody), async (req, res) => {
  const task = await service.create(req.project, req.user, req.body);
  await emitToProject(req, req.project.id, 'task:created', { projectId: req.project.id, task });
  await notifyTaskAssigned({ task, actor: req.user });
  await recordTaskCreated({ project: req.project, task, actor: req.user });
  res.status(201).json(task);
});

projectTasksRouter.post(
  '/import',
  requireProjectMember(),
  validate(importBody),
  async (req, res) => {
    const { rows } = req.body;
    await service.assertImportable(req.project, rows);
    const tasks = [];
    for (const row of rows) {
      const task = await service.create(req.project, req.user, row);
      await emitToProject(req, req.project.id, 'task:created', {
        projectId: req.project.id,
        task,
      });
      await notifyTaskAssigned({ task, actor: req.user });
      await recordTaskCreated({
        project: req.project,
        task,
        actor: req.user,
        meta: { imported: true },
      });
      tasks.push(task);
    }
    res.status(201).json({ created: tasks.length, tasks });
  },
);

projectTasksRouter.patch(
  '/bulk',
  requireProjectMember(),
  validate(bulkUpdateBody),
  async (req, res) => {
    const { taskIds, patch } = req.body;
    const rows = await service.loadForBulk(req.project, taskIds);
    await service.assertBulkUpdatable(req.project, rows, patch);
    const tasks = [];
    for (const before of rows) {
      const task = await service.update(before, req.project, patch);
      await emitToProject(req, req.project.id, 'task:updated', {
        projectId: req.project.id,
        task,
      });
      if (task.assignee?.id !== (before.assignee_id ?? undefined)) {
        await notifyTaskAssigned({ task, actor: req.user });
      }
      await recordTaskUpdated({ project: req.project, before, after: task, actor: req.user });
      tasks.push(task);
    }
    res.json({ updated: tasks.length, tasks });
  },
);

projectTasksRouter.post(
  '/bulk-delete',
  requireProjectMember(),
  validate(bulkDeleteBody),
  async (req, res) => {
    const rows = await service.loadForBulk(req.project, req.body.taskIds);
    service.assertBulkDeletable(req.project, req.user, rows);
    for (const task of rows) {
      await service.remove(task, req.project, req.user);
      await emitToProject(req, req.project.id, 'task:deleted', {
        projectId: req.project.id,
        taskId: task.id,
      });
      await record({
        projectId: req.project.id,
        taskId: task.id,
        actorId: req.user.id,
        action: 'task.deleted',
        meta: { title: task.title },
      });
    }
    res.json({ deleted: rows.length });
  },
);

// /tasks
export const tasksRouter = Router();
tasksRouter.use(authenticate);

// '/mine' 은 '/:id' 보다 먼저 선언해야 한다.
tasksRouter.get('/mine', validate(mineQuery, 'query'), async (req, res) => {
  res.json(await service.listMine(req.user, req.query));
});

// 작업 키(TPM-12)로 조회. 키를 id 로 바꿔 requireTaskAccess 의 멤버 검사를 그대로 쓴다.
tasksRouter.get(
  '/key/:key',
  async (req, res, next) => {
    try {
      const m = TASK_KEY_PATTERN.exec(req.params.key);
      if (!m) throw badRequest('작업 키 형식이 올바르지 않습니다. 예: TPM-12');
      const task = await service.findByKey(m[1], Number(m[2]));
      if (!task) throw notFound('작업을 찾을 수 없습니다.');
      req.params.id = task.id;
      next();
    } catch (err) {
      next(err);
    }
  },
  requireTaskAccess(),
  (req, res) => {
    res.json(service.toResponse(req.task));
  },
);

tasksRouter.get('/:id', requireTaskAccess(), (req, res) => {
  res.json(service.toResponse(req.task));
});

tasksRouter.patch('/:id', requireTaskAccess(), validate(patchBody), async (req, res) => {
  const task = await service.update(req.task, req.project, req.body);
  await emitToProject(req, req.project.id, 'task:updated', { projectId: req.project.id, task });
  // 담당자가 새로 지정/변경된 경우에만 알린다.
  if (task.assignee?.id !== (req.task.assignee_id ?? undefined)) {
    await notifyTaskAssigned({ task, actor: req.user });
  }
  await recordTaskUpdated({ project: req.project, before: req.task, after: task, actor: req.user });
  res.json(task);
});

tasksRouter.patch('/:id/move', requireTaskAccess(), validate(moveBody), async (req, res) => {
  const task = await service.move(req.task, req.project, req.body);
  await emitToProject(req, req.project.id, 'task:moved', {
    projectId: req.project.id,
    taskId: task.id,
    status: task.status,
    position: task.position,
    movedBy: req.user.id,
    task,
  });
  await recordTaskMoved({ project: req.project, before: req.task, after: task, actor: req.user });
  res.json(task);
});

tasksRouter.delete('/:id', requireTaskAccess(), async (req, res) => {
  await service.remove(req.task, req.project, req.user);
  await emitToProject(req, req.project.id, 'task:deleted', {
    projectId: req.project.id,
    taskId: req.task.id,
  });
  await record({
    projectId: req.project.id,
    taskId: req.task.id,
    actorId: req.user.id,
    action: 'task.deleted',
    meta: { title: req.task.title },
  });
  res.status(204).end();
});

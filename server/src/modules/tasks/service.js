import { withTransaction } from '../../config/db.js';
import { badRequest, conflict, forbidden } from '../../utils/errors.js';
import * as projectsRepo from '../projects/repository.js';
import * as usersRepo from '../users/repository.js';
import * as repo from './repository.js';

export const toResponse = repo.toTask;

// 보관된 프로젝트는 읽기 전용이다.
export function assertWritable(project) {
  if (project.status === 'archived') {
    throw conflict('PROJECT_ARCHIVED', '보관된 프로젝트의 작업은 수정할 수 없습니다.');
  }
}

// 담당자는 활성 상태인 프로젝트 멤버여야 한다.
async function assertAssignable(projectId, assigneeId) {
  if (!assigneeId) return;
  const user = await usersRepo.findById(assigneeId);
  const ok = user && user.is_active && (await projectsRepo.isMember(projectId, assigneeId));
  if (!ok) {
    throw badRequest('담당자는 프로젝트의 활성 멤버여야 합니다.', [
      { field: 'assigneeId', issue: 'not_a_project_member' },
    ]);
  }
}

// Admin/Manager 는 모두, Member 는 본인이 만든 작업만 삭제할 수 있다.
export const canDelete = (user, task) =>
  user.role === 'admin' || user.role === 'manager' || task.created_by === user.id;

export async function listForProject(project, user, query) {
  const { page, limit, groupBy, ...filters } = query;
  if (groupBy === 'status') {
    const { rows } = await repo.listByProject(project.id, { ...filters, grouped: true }, user.id);
    const columns = Object.fromEntries(repo.STATUSES.map((s) => [s, []]));
    for (const row of rows) columns[row.status].push(repo.toTask(row));
    return { columns };
  }
  const { rows, total } = await repo.listByProject(project.id, filters, user.id, {
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows.map(repo.toTask), meta: { page, limit, total } };
}

export async function listMine(user, query) {
  const { page, limit, ...filters } = query;
  const { rows, total } = await repo.listAssignedTo(user, filters, {
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows.map(repo.toTask), meta: { page, limit, total } };
}

export async function create(project, user, body) {
  assertWritable(project);
  await assertAssignable(project.id, body.assigneeId);
  const task = await repo.insertTask({ ...body, projectId: project.id, createdBy: user.id });
  return repo.toTask(task);
}

export async function update(task, project, patch) {
  assertWritable(project);
  // 담당자를 새로 지정/변경할 때만 검사한다(이미 담당자인 사람이 비활성화돼도 다른 필드 수정은 막지 않는다).
  if (patch.assigneeId && patch.assigneeId !== task.assignee_id) {
    await assertAssignable(project.id, patch.assigneeId);
  }
  return repo.toTask(await repo.updateTask(task.id, patch, task));
}

// 칸반 이동: 대상 컬럼의 앞/뒤 이웃을 알려주면 서버가 position 을 계산한다. 상태가 바뀌면 completed_at 도 맞춘다.
export async function move(task, project, { status, beforeTaskId, afterTaskId }) {
  assertWritable(project);
  await withTransaction((client) =>
    repo.moveTask(client, task, { status, beforeId: beforeTaskId, afterId: afterTaskId }),
  );
  return repo.toTask(await repo.findById(task.id));
}

export async function remove(task, project, user) {
  assertWritable(project);
  if (!canDelete(user, task)) throw forbidden('이 작업을 삭제할 권한이 없습니다.');
  await repo.deleteTask(task.id);
}

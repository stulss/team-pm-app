import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as tasksRepo from '../tasks/repository.js';
import * as repo from './repository.js';

// 선행(blockedBy)·후행(blocks) 목록과, 카드 갱신용으로 바뀐 작업을 함께 돌려준다.
async function snapshot(task) {
  const { blockedBy, blocks } = await repo.list(task.id);
  return {
    blockedBy: blockedBy.map(repo.toLinked),
    blocks: blocks.map(repo.toLinked),
    task: tasksRepo.toTask(await tasksRepo.findById(task.id)),
  };
}

export async function list(task) {
  const { blockedBy, blocks } = await repo.list(task.id);
  return { blockedBy: blockedBy.map(repo.toLinked), blocks: blocks.map(repo.toLinked) };
}

export async function add(task, project, dependsOnId) {
  assertWritable(project);
  if (dependsOnId === task.id) throw badRequest('자기 자신을 선행 작업으로 지정할 수 없습니다.');
  // 없는 작업과 다른 프로젝트의 작업을 구별하지 않는다(존재 여부를 알리지 않으려고).
  const other = await tasksRepo.findById(dependsOnId);
  if (!other || other.project_id !== project.id) {
    throw badRequest('같은 프로젝트의 작업을 선택해 주세요.', [
      { field: 'dependsOnId', issue: 'task_not_in_project' },
    ]);
  }
  const result = await repo.add(task, dependsOnId);
  if (result === 'exists')
    throw conflict('DEPENDENCY_EXISTS', '이미 선행 작업으로 지정돼 있습니다.');
  if (result === 'full') {
    throw conflict(
      'LIMIT_REACHED',
      `선행 작업은 작업당 최대 ${repo.MAX_BLOCKERS_PER_TASK}개까지 지정할 수 있습니다.`,
    );
  }
  if (result === 'cycle') {
    throw conflict('DEPENDENCY_CYCLE', '서로 기다리는 순환 관계가 만들어져 지정할 수 없습니다.');
  }
  return snapshot(task);
}

export async function remove(task, project, dependsOnId) {
  assertWritable(project);
  if (!(await repo.remove(task.id, dependsOnId))) {
    throw notFound('지정된 선행 작업이 아닙니다.');
  }
  return snapshot(task);
}

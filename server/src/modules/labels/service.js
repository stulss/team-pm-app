import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as tasksRepo from '../tasks/repository.js';
import * as repo from './repository.js';

// 이름 변경·삭제는 만든 사람, 프로젝트 소유자, Admin.
export const canManageLabel = (user, label, project) =>
  label.created_by === user.id || user.role === 'admin' || project.owner_id === user.id;

const exists = () => conflict('LABEL_EXISTS', '같은 이름의 라벨이 이미 있습니다.');

export async function list(project) {
  return (await repo.list(project.id)).map(repo.toLabel);
}

export async function create(project, user, { name, color }) {
  assertWritable(project);
  if ((await repo.countByProject(project.id)) >= repo.MAX_LABELS_PER_PROJECT) {
    throw conflict(
      'LIMIT_REACHED',
      `라벨은 프로젝트당 최대 ${repo.MAX_LABELS_PER_PROJECT}개까지 만들 수 있습니다.`,
    );
  }
  const label = await repo.insert({ projectId: project.id, name, color, createdBy: user.id });
  if (!label) throw exists();
  return repo.toLabel(label);
}

async function loadLabel(project, labelId) {
  const label = await repo.findById(project.id, labelId);
  if (!label) throw notFound('라벨을 찾을 수 없습니다.');
  return label;
}

export async function update(project, user, labelId, patch) {
  assertWritable(project);
  const label = await loadLabel(project, labelId);
  if (!canManageLabel(user, label, project)) throw forbidden('이 라벨을 고칠 권한이 없습니다.');
  const updated = await repo.update(label.id, patch);
  if (!updated) throw exists();
  return repo.toLabel(updated);
}

export async function remove(project, user, labelId) {
  assertWritable(project);
  const label = await loadLabel(project, labelId);
  if (!canManageLabel(user, label, project)) throw forbidden('이 라벨을 지울 권한이 없습니다.');
  await repo.remove(label.id);
}

// 작업의 라벨을 교체하고, 바뀐 작업(라벨 포함)을 돌려준다.
export async function setForTask(task, project, labelIds) {
  assertWritable(project);
  const unique = [...new Set(labelIds)];
  if (unique.length > repo.MAX_LABELS_PER_TASK) {
    throw conflict(
      'LIMIT_REACHED',
      `라벨은 작업당 최대 ${repo.MAX_LABELS_PER_TASK}개까지 붙일 수 있습니다.`,
    );
  }
  const valid = new Set(await repo.existingIds(project.id, unique));
  if (!unique.every((id) => valid.has(id))) {
    throw badRequest('이 프로젝트의 라벨이 아닙니다.', [
      { field: 'labelIds', issue: 'label_not_in_project' },
    ]);
  }
  await repo.setTaskLabels(task, unique);
  return tasksRepo.toTask(await tasksRepo.findById(task.id));
}

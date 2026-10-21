import { conflict, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as tasksRepo from '../tasks/repository.js';
import * as repo from './repository.js';

export async function list(task) {
  return (await repo.list(task.id)).map(repo.toItem);
}

async function loadItem(task, itemId) {
  const item = await repo.findById(task.id, itemId);
  if (!item) throw notFound('체크리스트 항목을 찾을 수 없습니다.');
  return item;
}

// 항목을 바꾼 뒤 카드의 진행률이 갱신되도록 바뀐 작업을 함께 돌려준다.
const withTask = async (task, item) => ({
  item: item && repo.toItem(item),
  task: tasksRepo.toTask(await tasksRepo.findById(task.id)),
});

export async function add(task, project, { content }) {
  assertWritable(project);
  const item = await repo.insert(task.id, content);
  if (!item) {
    throw conflict(
      'LIMIT_REACHED',
      `체크리스트는 작업당 최대 ${repo.MAX_ITEMS_PER_TASK}개까지 만들 수 있습니다.`,
    );
  }
  return withTask(task, item);
}

export async function update(task, project, itemId, patch) {
  assertWritable(project);
  const item = await loadItem(task, itemId);
  return withTask(task, await repo.update(item.id, patch));
}

export async function remove(task, project, itemId) {
  assertWritable(project);
  const item = await loadItem(task, itemId);
  await repo.remove(item.id);
  return withTask(task, null);
}

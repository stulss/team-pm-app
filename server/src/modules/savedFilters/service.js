import { conflict, notFound } from '../../utils/errors.js';
import * as repo from './repository.js';

export async function list(project, user) {
  return (await repo.list(project.id, user.id)).map(repo.toSavedFilter);
}

export async function create(project, user, { name, filters }) {
  const result = await repo.insert({ projectId: project.id, userId: user.id, name, filters });
  if (result.full) {
    throw conflict(
      'LIMIT_REACHED',
      `저장된 필터는 프로젝트당 최대 ${repo.MAX_FILTERS_PER_USER}개까지 만들 수 있습니다.`,
    );
  }
  if (result.duplicate) throw conflict('FILTER_EXISTS', '같은 이름의 필터가 이미 있습니다.');
  return repo.toSavedFilter(result.row);
}

// 남의 필터는 존재 여부를 알리지 않으려고 404 로 답한다.
export async function remove(project, user, filterId) {
  const found = await repo.findOwn(project.id, user.id, filterId);
  if (!found) throw notFound('저장된 필터를 찾을 수 없습니다.');
  await repo.remove(found.id);
}

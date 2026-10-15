import { withTransaction } from '../../config/db.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import * as repo from './repository.js';
import * as usersRepo from '../users/repository.js';

// Admin, 또는 해당 프로젝트를 소유한 Manager 만 관리(수정/멤버 관리)할 수 있다.
export const canManage = (user, project) =>
  user.role === 'admin' || (user.role === 'manager' && project.owner_id === user.id);

export async function list(user, { status, page, limit }) {
  const { rows, total } = await repo.listForUser(user, {
    status,
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows.map(repo.toProject), meta: { page, limit, total } };
}

export async function create(user, { name, description, memberIds }) {
  const wanted = [...new Set([...memberIds, user.id])];
  const valid = await repo.filterActiveUserIds(wanted);
  const invalid = wanted.filter((id) => !valid.includes(id));
  if (invalid.length > 0) {
    throw badRequest('존재하지 않거나 비활성화된 사용자가 포함되어 있습니다.', [
      { field: 'memberIds', issue: 'invalid_user', ids: invalid },
    ]);
  }

  const project = await withTransaction(async (client) => {
    const row = await repo.insertProject(client, { name, description, ownerId: user.id });
    await repo.addMembers(client, row.id, wanted); // 생성자는 항상 멤버
    return row;
  });
  return detail(project);
}

export async function detail(project) {
  const members = await repo.listMembers(project.id);
  return { ...repo.toProject(project), members: members.map(repo.toMember) };
}

export async function update(project, patch) {
  return repo.toProject(await repo.updateProject(project.id, patch));
}

export async function remove(project) {
  await repo.deleteProject(project.id);
}

export async function listMembers(project) {
  return (await repo.listMembers(project.id)).map(repo.toMember);
}

export async function addMember(project, userId) {
  const target = await usersRepo.findById(userId);
  if (!target) throw notFound('사용자를 찾을 수 없습니다.');
  if (!target.is_active) throw badRequest('비활성화된 사용자는 추가할 수 없습니다.');
  const added = await repo.addMember(project.id, userId);
  if (!added) throw conflict('ALREADY_MEMBER', '이미 프로젝트 멤버입니다.');
  return usersRepo.toUser(target);
}

export async function removeMember(project, userId) {
  if (userId === project.owner_id) {
    throw conflict('OWNER_CANNOT_BE_REMOVED', '프로젝트 소유자는 제거할 수 없습니다.');
  }
  const removed = await repo.removeMember(project.id, userId);
  if (!removed) throw notFound('프로젝트 멤버가 아닙니다.');
}

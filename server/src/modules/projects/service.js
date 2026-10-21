import { withTransaction } from '../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import * as repo from './repository.js';
import * as usersRepo from '../users/repository.js';
import * as tasksRepo from '../tasks/repository.js';
import { env } from '../../config/env.js';
import { uniqueKey } from './key.js';

// Admin, 또는 해당 프로젝트를 만든 소유자(시스템 역할과 무관)가 관리(수정/삭제/멤버 관리)할 수 있다.
export const canManage = (user, project) => user.role === 'admin' || project.owner_id === user.id;

const limitReached = (message) => conflict('LIMIT_REACHED', message);

export async function list(user, { status, page, limit }) {
  const { rows, total } = await repo.listForUser(user, {
    status,
    limit,
    offset: (page - 1) * limit,
  });
  return { data: rows.map(repo.toProject), meta: { page, limit, total } };
}

const keyTakenError = () => conflict('KEY_TAKEN', '이미 사용 중인 프로젝트 키입니다.');
const isKeyConflict = (err) => err?.code === '23505' && /key/.test(err.constraint ?? '');

export async function create(user, { name, description, memberIds, key }) {
  if (user.role !== 'admin' && (await repo.countOwned(user.id)) >= env.MAX_PROJECTS_PER_USER) {
    throw limitReached(`프로젝트는 최대 ${env.MAX_PROJECTS_PER_USER}개까지 만들 수 있습니다.`);
  }
  const wanted = [...new Set([...memberIds, user.id])];
  if (wanted.length > env.MAX_MEMBERS_PER_PROJECT) {
    throw limitReached(`프로젝트 멤버는 최대 ${env.MAX_MEMBERS_PER_PROJECT}명까지 가능합니다.`);
  }
  const valid = await repo.filterActiveUserIds(wanted);
  const invalid = wanted.filter((id) => !valid.includes(id));
  if (invalid.length > 0) {
    throw badRequest('존재하지 않거나 비활성화된 사용자가 포함되어 있습니다.', [
      { field: 'memberIds', issue: 'invalid_user', ids: invalid },
    ]);
  }

  // 키를 주지 않으면 이름에서 만든다. 동시에 같은 키를 잡으면(유일 제약) 다시 만든다.
  let projectKey = key ?? (await uniqueKey(name, repo.keyTaken));
  let project;
  for (let attempt = 0; !project; attempt += 1) {
    try {
      project = await withTransaction(async (client) => {
        const row = await repo.insertProject(client, {
          name,
          description,
          ownerId: user.id,
          key: projectKey,
        });
        await repo.addMembers(client, row.id, wanted); // 생성자는 항상 멤버
        return row;
      });
    } catch (err) {
      if (!isKeyConflict(err)) throw err;
      if (key || attempt >= 3) throw keyTakenError();
      projectKey = await uniqueKey(name, repo.keyTaken);
    }
  }
  return detail(project, user.id);
}

// userId 가 있으면 그 사용자의 개인 설정(mySettings)을 함께 돌려준다.
export async function detail(project, userId) {
  const members = await repo.listMembers(project.id);
  return {
    ...repo.toProject(project),
    ...(userId && { mySettings: await repo.getMySettings(project.id, userId) }),
    members: members.map(repo.toMember),
  };
}

export async function updateMySettings(project, user, patch) {
  const settings = await repo.updateMySettings(project.id, user.id, patch);
  if (!settings) throw forbidden('프로젝트 멤버만 개인 설정을 바꿀 수 있습니다.');
  return settings;
}

export async function update(project, patch) {
  try {
    return repo.toProject(await repo.updateProject(project.id, patch));
  } catch (err) {
    if (isKeyConflict(err)) throw keyTakenError();
    throw err;
  }
}

export async function remove(project) {
  await repo.deleteProject(project.id);
}

export async function listMembers(project) {
  return (await repo.listMembers(project.id)).map(repo.toMember);
}

// userId 또는 이메일(정확히 일치)로 멤버를 추가한다. 공개 가입이라 사용자 목록은 노출하지 않으므로
// 일반 소유자는 이메일로 초대한다.
export async function addMember(project, { userId, email }) {
  const target = userId
    ? await usersRepo.findById(userId)
    : await usersRepo.findByEmail(email.toLowerCase());
  if (!target) throw notFound('사용자를 찾을 수 없습니다.');
  if (!target.is_active) throw badRequest('비활성화된 사용자는 추가할 수 없습니다.');
  if ((await repo.countMembers(project.id)) >= env.MAX_MEMBERS_PER_PROJECT) {
    throw limitReached(`프로젝트 멤버는 최대 ${env.MAX_MEMBERS_PER_PROJECT}명까지 가능합니다.`);
  }
  const userIdToAdd = target.id;
  const added = await repo.addMember(project.id, userIdToAdd);
  if (!added) throw conflict('ALREADY_MEMBER', '이미 프로젝트 멤버입니다.');
  return usersRepo.toUser(target);
}

export async function removeMember(project, userId) {
  if (userId === project.owner_id) {
    throw conflict('OWNER_CANNOT_BE_REMOVED', '프로젝트 소유자는 제거할 수 없습니다.');
  }
  // 제거되는 멤버에게 배정된 이 프로젝트의 작업은 미배정으로 돌린다(담당자는 항상 프로젝트 멤버여야 하므로).
  const removed = await withTransaction(async (client) => {
    const done = await repo.removeMember(project.id, userId, client);
    if (done) await tasksRepo.unassignUserInProject(client, project.id, userId);
    return done;
  });
  if (!removed) throw notFound('프로젝트 멤버가 아닙니다.');
}

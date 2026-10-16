import { AppError, conflict, forbidden, notFound } from '../../utils/errors.js';
import { assertWritable } from '../tasks/service.js';
import * as repo from './repository.js';

const invalidVote = (message) => new AppError(400, 'INVALID_VOTE', message);

// 마감·삭제는 만든 사람, 프로젝트 소유자, Admin.
export const canManagePoll = (user, poll, project) =>
  poll.created_by === user.id || user.role === 'admin' || project.owner_id === user.id;

export const list = (project, user) => repo.list(project.id, user.id);

async function loadPoll(project, pollId) {
  const poll = await repo.findById(project.id, pollId);
  if (!poll) throw notFound('투표를 찾을 수 없습니다.');
  return poll;
}

const one = async (project, user, pollId) => (await repo.list(project.id, user.id, { pollId }))[0];

export async function create(project, user, { question, options, multiple = false }) {
  assertWritable(project);
  const seen = new Set();
  for (const label of options) {
    const key = label.toLowerCase();
    if (seen.has(key)) throw new AppError(400, 'VALIDATION_ERROR', '같은 선택지가 중복됩니다.');
    seen.add(key);
  }
  if ((await repo.countByProject(project.id)) >= repo.MAX_POLLS_PER_PROJECT) {
    throw conflict(
      'LIMIT_REACHED',
      `투표는 프로젝트당 최대 ${repo.MAX_POLLS_PER_PROJECT}개까지 만들 수 있습니다.`,
    );
  }
  const pollId = await repo.insertPoll({
    projectId: project.id,
    createdBy: user.id,
    question,
    multiple,
    options,
  });
  return one(project, user, pollId);
}

export async function vote(project, user, pollId, optionIds) {
  assertWritable(project);
  const poll = await loadPoll(project, pollId);
  if (poll.closed_at) throw conflict('POLL_CLOSED', '마감된 투표입니다.');
  if (new Set(optionIds).size !== optionIds.length) throw invalidVote('같은 선택지가 중복됩니다.');
  if (!poll.multiple && optionIds.length > 1) {
    throw invalidVote('이 투표는 하나만 고를 수 있습니다.');
  }
  const valid = new Set(await repo.optionIds(poll.id));
  if (!optionIds.every((id) => valid.has(id))) {
    throw invalidVote('이 투표의 선택지가 아닙니다.');
  }
  // 잠금 안에서 마감 여부를 다시 확인하므로, 확인 직후 마감돼도 표가 새로 들어가지 않는다.
  if (!(await repo.setVotes(poll.id, user.id, optionIds))) {
    throw conflict('POLL_CLOSED', '마감된 투표입니다.');
  }
  return one(project, user, poll.id);
}

export async function close(project, user, pollId) {
  assertWritable(project);
  const poll = await loadPoll(project, pollId);
  if (!canManagePoll(user, poll, project)) throw forbidden('이 투표를 마감할 권한이 없습니다.');
  await repo.close(poll.id); // 이미 마감돼 있어도 같은 결과(멱등)
  return one(project, user, poll.id);
}

export async function remove(project, user, pollId) {
  assertWritable(project);
  const poll = await loadPoll(project, pollId);
  if (!canManagePoll(user, poll, project)) throw forbidden('이 투표를 삭제할 권한이 없습니다.');
  await repo.remove(poll.id);
}

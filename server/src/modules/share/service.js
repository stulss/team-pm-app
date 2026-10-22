import crypto from 'node:crypto';
import { AppError, conflict, notFound } from '../../utils/errors.js';
import { sha256 } from '../../utils/crypto.js';
import * as activity from '../activity/service.js';
import * as repo from './repository.js';

// 공개 조회에서 숨기는 기록: 팀원 정보와 "공유했다"는 사실 자체는 외부에 보이지 않게 한다.
export const HIDDEN_ACTIONS = ['member.added', 'member.removed', 'share.created', 'share.revoked'];

const notFoundLink = () =>
  new AppError(404, 'SHARE_LINK_NOT_FOUND', '공유 링크가 없거나 만료되었습니다.');

export async function create(project, user, expiresInDays) {
  if ((await repo.countActive(project.id)) >= repo.MAX_ACTIVE_PER_PROJECT) {
    throw conflict(
      'LIMIT_REACHED',
      `유효한 공유 링크는 프로젝트당 최대 ${repo.MAX_ACTIVE_PER_PROJECT}개입니다. 안 쓰는 링크를 먼저 폐기해 주세요.`,
    );
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const row = await repo.insert({
    projectId: project.id,
    createdBy: user.id,
    tokenHash: sha256(token),
    expiresInDays,
  });
  await activity.record({
    projectId: project.id,
    actorId: user.id,
    action: 'share.created',
    meta: { expiresAt: row.expires_at, days: expiresInDays },
  });
  // 토큰 원문은 이 응답에서만 볼 수 있다.
  return { id: row.id, token, expiresAt: row.expires_at };
}

export async function list(project) {
  return (await repo.listActive(project.id)).map(repo.toLink);
}

export async function revoke(project, user, linkId) {
  if (!(await repo.revoke(project.id, linkId))) throw notFound('공유 링크를 찾을 수 없습니다.');
  await activity.record({
    projectId: project.id,
    actorId: user.id,
    action: 'share.revoked',
    meta: {},
  });
}

const withoutToken = ({ token: _token, ...meta } = {}) => meta;

// 로그인 없이 호출된다. 없는·만료된·폐기된 토큰은 구분할 수 없게 같은 404 를 준다.
export async function view(token, { before, limit }) {
  const link = await repo.findActiveByHash(sha256(token));
  if (!link) throw notFoundLink();
  if (before === undefined) await repo.touchView(link.id); // 첫 페이지만 조회수에 센다
  const page = await activity.list(link.project_id, {
    limit,
    before,
    excludeActions: HIDDEN_ACTIONS,
  });
  return {
    project: { name: link.project_name, status: link.project_status },
    expiresAt: link.expires_at,
    ...page,
    // API 토큰 이름은 멤버에게만 보인다(공개 페이지에는 누가 어떤 연동을 쓰는지 알리지 않는다).
    data: page.data.map((a) => ({ ...a, meta: withoutToken(a.meta) })),
  };
}

import crypto from 'node:crypto';
import { conflict, notFound } from '../../utils/errors.js';
import * as repo from './repository.js';

export const TOKEN_PREFIX = 'tpm_';
export const MAX_TOKENS = 10;
export const SCOPES = ['read', 'write'];

// 토큰은 높은 엔트로피의 난수라 솔트 없는 SHA-256 으로 충분하다(조회 키로도 쓴다).
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function create(user, { name, scope, expiresInDays }) {
  if ((await repo.countActive(user.id)) >= MAX_TOKENS) {
    throw conflict(
      'TOKEN_LIMIT',
      `API 토큰은 ${MAX_TOKENS}개까지 만들 수 있습니다. 안 쓰는 토큰을 폐기해 주세요.`,
    );
  }
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
  const row = await repo.insert({
    userId: user.id,
    name,
    scope,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 12),
    expiresAt,
  });
  return { ...repo.toToken(row), token }; // 값은 이 응답에서 한 번만 보인다
}

export async function list(userId) {
  return (await repo.listForUser(userId)).map(repo.toToken);
}

export async function revoke(userId, id) {
  if (!(await repo.revoke(userId, id))) throw notFound('토큰을 찾을 수 없습니다.');
}

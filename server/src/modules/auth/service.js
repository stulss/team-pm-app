import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthorized } from '../../utils/errors.js';
import { DUMMY_HASH, hashPassword, sha256, verifyPassword } from '../../utils/crypto.js';
import {
  REFRESH_TTL_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import * as users from '../users/repository.js';
import * as tokens from './repository.js';

// 회전 직후 다른 탭/요청이 이전 토큰으로 도착하는 경우(경쟁)는 재사용 공격으로 보지 않는 유예 시간.
const REUSE_GRACE_MS = 10_000;

const INVALID_CREDENTIALS = '이메일 또는 비밀번호가 올바르지 않습니다.';
const SESSION_EXPIRED = '세션이 만료되었습니다.';

const invalidRefresh = () => unauthorized(SESSION_EXPIRED, 'INVALID_REFRESH_TOKEN');

export async function createSession(userId) {
  const refreshToken = signRefreshToken(userId);
  await tokens.insertRefreshToken({
    userId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  return { accessToken: signAccessToken(userId), refreshToken };
}

export async function register({ email, password, name }) {
  // 팀 구성이 끝난 뒤 ALLOW_REGISTRATION=false 로 신규 가입을 닫는다. 첫 계정(관리자)은 항상 만들 수 있다.
  if (!env.ALLOW_REGISTRATION && (await users.countUsers()) > 0) {
    throw new AppError(403, 'REGISTRATION_CLOSED', '현재 신규 가입을 받지 않습니다.');
  }
  const passwordHash = await hashPassword(password);
  let row;
  try {
    row = await withTransaction((client) =>
      users.insertUser(client, { email, passwordHash, name }),
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('EMAIL_TAKEN', '이미 사용 중인 이메일입니다.');
    throw err;
  }
  const session = await createSession(row.id);
  return { user: users.toUser(row), ...session };
}

export async function login({ email, password }) {
  const row = await users.findByEmail(email);
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.is_active) {
    throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
  }
  const session = await createSession(row.id);
  return { user: users.toUser(row), ...session };
}

export async function refresh(rawToken) {
  const payload = rawToken && verifyRefreshToken(rawToken);
  if (!payload) throw invalidRefresh();

  const record = await tokens.findRefreshToken(sha256(rawToken));
  if (!record) throw invalidRefresh();

  if (record.revoked_at) {
    // 폐기된 토큰의 재사용 = 토큰 탈취 가능성. 유예 시간이 지났다면 해당 사용자의 모든 세션을 끊는다.
    if (record.revoked_ago_ms > REUSE_GRACE_MS) {
      await tokens.revokeAllForUser(record.user_id);
    }
    throw invalidRefresh();
  }
  if (new Date(record.expires_at) <= new Date()) throw invalidRefresh();

  const row = await users.findById(record.user_id);
  if (!row || !row.is_active) throw invalidRefresh();

  // 회전: 기존 토큰 폐기에 성공한 요청만 새 토큰을 받는다.
  const revoked = await tokens.revokeRefreshToken(record.id);
  if (!revoked) throw invalidRefresh();

  const session = await createSession(row.id);
  return { user: users.toUser(row), ...session };
}

export async function logout(rawToken) {
  if (!rawToken) return;
  const record = await tokens.findRefreshToken(sha256(rawToken));
  if (record) await tokens.revokeRefreshToken(record.id);
}

export const revokeAllSessions = (userId) => tokens.revokeAllForUser(userId);

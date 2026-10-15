import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthorized } from '../../utils/errors.js';
import crypto from 'node:crypto';
import { DUMMY_HASH, hashPassword, sha256, verifyPassword } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { mailEnabled, sendMail } from '../../utils/mailer.js';
import { resetPasswordMessage, verifyEmailMessage } from '../../utils/mailTemplates.js';
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

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
// 같은 사용자에게 같은 종류의 메일을 이 시간 안에 다시 보내지 않는다(메일 폭탄·한도 소진 방지).
const RESEND_COOLDOWN_SECONDS = 60;

const emailNotVerified = () =>
  new AppError(
    403,
    'EMAIL_NOT_VERIFIED',
    '이메일 인증이 필요합니다. 가입할 때 받은 메일의 링크를 눌러 주세요.',
  );
const invalidToken = () =>
  new AppError(400, 'INVALID_TOKEN', '링크가 만료되었거나 이미 사용되었습니다.');

// 메일 때문에 가입·요청 자체가 실패하면 안 되고, 실패 사유로 계정 존재 여부가 드러나도 안 된다.
async function issueAndSend(row, kind) {
  const since = await tokens.secondsSinceLastEmailToken(row.id, kind);
  if (since !== null && since < RESEND_COOLDOWN_SECONDS) return;
  const token = crypto.randomBytes(32).toString('base64url');
  await tokens.insertEmailToken({
    userId: row.id,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + (kind === 'verify' ? VERIFY_TTL_MS : RESET_TTL_MS)),
  });
  const message =
    kind === 'verify' ? verifyEmailMessage(row.name, token) : resetPasswordMessage(row.name, token);
  try {
    await sendMail({ to: row.email, ...message });
  } catch (err) {
    logger.warn({ err: err.message, userId: row.id, kind }, 'mail send failed');
  }
}

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
  // 메일이 켜져 있으면 이메일 인증 전에는 세션을 주지 않는다.
  if (mailEnabled()) {
    await issueAndSend({ ...row, name }, 'verify');
    return { user: users.toUser(row), needsVerification: true };
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
  // 비밀번호가 맞은 사람에게만 인증 필요 여부를 알려 준다(계정 존재 여부 노출 최소화).
  if (mailEnabled() && !row.email_verified_at) throw emailNotVerified();
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
  if (mailEnabled() && !row.email_verified_at) throw invalidRefresh();

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

export async function verifyEmail(token) {
  const userId = await tokens.consumeEmailToken(sha256(token), 'verify');
  if (!userId) throw invalidToken();
  await users.markEmailVerified(userId);
}

// 존재 여부와 상관없이 같은 응답을 위해 아무것도 돌려주지 않는다.
export async function resendVerification(email) {
  const row = await users.findByEmail(email);
  if (row && row.is_active && !row.email_verified_at && mailEnabled()) {
    await issueAndSend(row, 'verify');
  }
}

export async function forgotPassword(email) {
  const row = await users.findByEmail(email);
  if (row && row.is_active && mailEnabled()) await issueAndSend(row, 'reset');
}

export async function resetPassword(token, password) {
  const userId = await tokens.consumeEmailToken(sha256(token), 'reset');
  if (!userId) throw invalidToken();
  const row = await users.findById(userId);
  if (!row || !row.is_active) throw invalidToken();
  await users.updateProfile(userId, { passwordHash: await hashPassword(password) });
  // 메일 링크로 소유를 증명했으므로 이메일도 인증된 것으로 본다. 기존 세션은 모두 끊는다.
  await users.markEmailVerified(userId);
  await tokens.revokeAllForUser(userId);
}

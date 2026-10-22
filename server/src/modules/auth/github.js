import crypto from 'node:crypto';
import { withTransaction } from '../../config/db.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { hashPassword } from '../../utils/crypto.js';
import { appUrl } from '../../utils/mailTemplates.js';
import * as users from '../users/repository.js';
import { createSession } from './service.js';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
const TIMEOUT_MS = 8000;

export const githubEnabled = () => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);

// 콜백 주소는 설정값으로만 만든다(Host 헤더 조작 방지). GitHub OAuth App 에 같은 주소를 등록해야 한다.
export const callbackUrl = () => `${appUrl()}/api/v1/auth/github/callback`;

export const newState = () => crypto.randomBytes(24).toString('base64url');

export function sameState(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string' || !expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function authorizeUrl(state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('scope', 'read:user user:email');
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

// 로그인 화면으로 돌려보낼 때 쓰는 사유 코드. 화면이 문구로 바꾼다.
const fail = (reason) => new AppError(400, 'GITHUB_LOGIN_FAILED', reason);

async function githubFetch(url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw fail('unreachable');
  }
  if (!res.ok) throw fail('github_error');
  return res.json();
}

// 승인 코드를 액세스 토큰으로 바꾼다. 토큰은 저장하지 않고 이 요청 안에서만 쓴다.
async function exchangeCode(code) {
  const body = await githubFetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(),
    }),
  });
  if (!body.access_token) throw fail('bad_code');
  return body.access_token;
}

// GitHub 가 인증했다고 알려 주는 기본 이메일만 신뢰한다.
export const pickEmail = (emails) =>
  (Array.isArray(emails) ? emails : []).find((e) => e?.primary && e?.verified && e?.email)?.email;

// requireEmail=false 는 이미 로그인한 사용자의 "연결" 용: 누구의 GitHub 계정인지만 알면 된다.
export async function fetchProfile(code, { requireEmail = true } = {}) {
  const token = await exchangeCode(code);
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'team-pm-app',
  };
  const [profile, emails] = await Promise.all([
    githubFetch(`${API}/user`, { headers }),
    githubFetch(`${API}/user/emails`, { headers }),
  ]);
  const email = pickEmail(emails)?.toLowerCase();
  if (!Number.isSafeInteger(profile?.id) || !profile?.login) throw fail('github_error');
  if (!email && requireEmail) throw fail('no_verified_email');
  const name =
    String(profile.name || profile.login)
      .trim()
      .slice(0, 50) || profile.login;
  return { githubId: profile.id, login: profile.login, email, name };
}

// ---- 설정에서 연결 (M28) ----
// 콜백에는 bearer 토큰이 없으므로 "누구의 연결인지"를 state 와 사용자 id 를 묶은 서명 쿠키로 확인한다.
const linkSig = (state, userId) =>
  crypto
    .createHmac('sha256', env.JWT_REFRESH_SECRET)
    .update(`gh-link:${state}:${userId}`)
    .digest('base64url');

export function makeLinkCookie(state, userId) {
  return `${state}.${userId}.${linkSig(state, userId)}`;
}

// 서명이 맞으면 { state, userId }, 아니면 null.
export function parseLinkCookie(value) {
  if (typeof value !== 'string') return null;
  const [state, userId, sig, ...rest] = value.split('.');
  if (!state || !userId || !sig || rest.length > 0) return null;
  return sameState(linkSig(state, userId), sig) ? { state, userId } : null;
}

export async function linkAccount(userId, { githubId, login }) {
  const row = await users.findById(userId);
  if (!row || !row.is_active) throw fail('inactive');
  const owner = await users.findByGithubId(githubId);
  if (owner && owner.id !== userId) throw fail('github_taken');
  try {
    await users.linkGithub(userId, githubId, login);
  } catch (err) {
    if (err.code === '23505') throw fail('github_taken');
    throw err;
  }
}

// 프로필로 계정을 찾아 세션을 만든다: github_id → 같은 이메일(연결) → 새 계정.
export async function loginWithProfile({ githubId, login, email, name }, meta) {
  let row = await users.findByGithubId(githubId);
  if (!row) {
    const existing = await users.findByEmail(email);
    if (existing) {
      // 이미 다른 GitHub 계정이 연결된 사용자는 이메일이 같아도 가져가지 못한다.
      if (existing.github_id && String(existing.github_id) !== String(githubId)) {
        throw fail('email_linked_elsewhere');
      }
      await users.linkGithub(existing.id, githubId, login);
      row = existing;
    } else {
      if (!env.ALLOW_REGISTRATION && (await users.countUsers()) > 0)
        throw fail('registration_closed');
      // 비밀번호로는 로그인할 수 없는 계정: 임의 비밀번호의 해시를 둔다("비밀번호 찾기"로 설정 가능).
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString('base64url'));
      try {
        row = await withTransaction((client) =>
          users.insertGithubUser(client, { email, passwordHash, name, githubId, login }),
        );
      } catch (err) {
        if (err.code === '23505') throw fail('email_taken');
        throw err;
      }
    }
  }
  if (!row.is_active) throw fail('inactive');
  return createSession(row.id, meta);
}

import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { REFRESH_TTL_SECONDS } from '../../utils/jwt.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { loginLimiter, mailLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import * as service from './service.js';
import { AppError } from '../../utils/errors.js';
import {
  authorizeUrl,
  fetchProfile,
  githubEnabled,
  linkAccount,
  loginWithProfile,
  makeLinkCookie,
  parseLinkCookie,
  newState,
  sameState,
} from './github.js';
import { appUrl } from '../../utils/mailTemplates.js';
import { logger } from '../../utils/logger.js';
import * as users from '../users/repository.js';

export const COOKIE_NAME = 'refresh_token';

// refresh 토큰은 이 경로로만 전송된다(Path 한정) + JS 접근 불가 + 동일 사이트 한정.
export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
};

export const setRefreshCookie = (res, token) =>
  res.cookie(COOKIE_NAME, token, { ...refreshCookieOptions, maxAge: REFRESH_TTL_SECONDS * 1000 });

const email = z.string().trim().toLowerCase().email('올바른 이메일을 입력해 주세요.').max(255);
const password = z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(128);

const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
});
const emailOnlySchema = z.object({ email });
const resetSchema = z.object({ token: z.string().min(20).max(200), password });
const loginSchema = z.object({ email, password: z.string().min(1, '비밀번호를 입력해 주세요.') });

export const authRouter = Router();

// 로그인한 기기 목록에 보여 줄 정보(브라우저 문자열·접속 IP). 신뢰 프록시 한 단계를 기준으로 req.ip 를 쓴다.
export const clientMeta = (req) => ({
  userAgent: req.get('user-agent')?.slice(0, 300),
  ip: req.ip?.slice(0, 64),
});

const sendSession = (res, status, { user, accessToken, refreshToken }) => {
  setRefreshCookie(res, refreshToken);
  res.status(status).json({ user, accessToken });
};

authRouter.post('/register', registerLimiter, validate(registerSchema), async (req, res) => {
  const result = await service.register(req.body, clientMeta(req));
  sendSession(res, 201, result);
});

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  sendSession(res, 200, await service.login(req.body, clientMeta(req)));
});

authRouter.post('/refresh', async (req, res) => {
  try {
    sendSession(res, 200, await service.refresh(req.cookies?.[COOKIE_NAME], clientMeta(req)));
  } catch (err) {
    // 실패한 refresh 후에는 브라우저의 쿠키도 정리한다.
    res.clearCookie(COOKIE_NAME, refreshCookieOptions);
    throw err;
  }
});

// 쿠키 기반으로 동작한다: access 토큰이 이미 만료된 상태에서도 로그아웃할 수 있어야 하기 때문.
authRouter.post('/logout', async (req, res) => {
  await service.logout(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, refreshCookieOptions);
  res.status(204).end();
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ---- 로그인한 기기 (M29) ----
authRouter.get('/sessions', authenticate, async (req, res) => {
  res.json({ data: await service.listSessions(req.user.id, req.cookies?.[COOKIE_NAME]) });
});

authRouter.delete('/sessions', authenticate, async (req, res) => {
  const revoked = await service.revokeOtherSessions(req.user.id, req.cookies?.[COOKIE_NAME]);
  res.json({ revoked });
});

authRouter.delete('/sessions/:id', authenticate, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError(400, 'VALIDATION_ERROR', '올바르지 않은 ID 입니다.');
  await service.revokeSession(req.user.id, id.data, req.cookies?.[COOKIE_NAME]);
  res.status(204).end();
});

const accepted = (res) => res.status(202).json({ ok: true });

// 가입 여부와 관계없이 항상 202. 같은 사용자에게는 60초에 한 번만 실제로 보낸다.
authRouter.post('/forgot-password', mailLimiter, validate(emailOnlySchema), async (req, res) => {
  await service.forgotPassword(req.body.email);
  accepted(res);
});

authRouter.post('/reset-password', validate(resetSchema), async (req, res) => {
  await service.resetPassword(req.body.token, req.body.password);
  res.clearCookie(COOKIE_NAME, refreshCookieOptions);
  res.json({ ok: true });
});

// ---- GitHub 로그인 (M27) ----
const STATE_COOKIE = 'gh_oauth_state';
const LINK_COOKIE = 'gh_oauth_link';
// 콜백은 github.com 에서 넘어오는 요청이므로 state 쿠키는 Lax 여야 한다. 이 경로로만 전송된다.
const stateCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/v1/auth/github',
};

authRouter.get('/providers', (req, res) => {
  res.json({ github: githubEnabled() });
});

authRouter.get('/github/start', loginLimiter, (req, res) => {
  if (!githubEnabled()) {
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'GitHub 로그인이 꺼져 있습니다.' } });
  }
  const state = newState();
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions, maxAge: 10 * 60 * 1000 });
  res.redirect(302, authorizeUrl(state));
});

// 설정에서 GitHub 계정을 연결: 로그인한 사용자만. 승인 주소를 돌려주면 화면이 그 주소로 이동한다.
authRouter.post('/github/link', authenticate, loginLimiter, (req, res) => {
  if (!githubEnabled()) {
    return res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'GitHub 로그인이 꺼져 있습니다.' } });
  }
  const state = newState();
  res.cookie(LINK_COOKIE, makeLinkCookie(state, req.user.id), {
    ...stateCookieOptions,
    maxAge: 10 * 60 * 1000,
  });
  res.json({ url: authorizeUrl(state) });
});

// 로그인 수단이 하나도 남지 않게 하지 않는다: GitHub 로 가입해 비밀번호가 없으면 먼저 비밀번호를 정해야 한다.
authRouter.delete('/github', authenticate, async (req, res) => {
  if (req.user.emailLogin === false) {
    return res.status(409).json({
      error: {
        code: 'PASSWORD_REQUIRED',
        message:
          '비밀번호가 없는 계정입니다. 로그인 화면의 "비밀번호 찾기"로 비밀번호를 먼저 설정해 주세요.',
      },
    });
  }
  await users.unlinkGithub(req.user.id);
  res.status(204).end();
});

authRouter.get('/github/callback', loginLimiter, async (req, res) => {
  const link = parseLinkCookie(req.cookies?.[LINK_COOKIE]);
  res.clearCookie(LINK_COOKIE, stateCookieOptions);
  if (link && sameState(link.state, req.query.state)) {
    // 설정에서 시작한 연결
    const done = (reason) => res.redirect(302, `${appUrl()}/settings?github=${reason}#security`);
    if (!githubEnabled()) return done('disabled');
    if (req.query.error) return done('denied');
    if (typeof req.query.code !== 'string') return done('bad_state');
    try {
      await linkAccount(link.userId, await fetchProfile(req.query.code, { requireEmail: false }));
      return done('linked');
    } catch (err) {
      if (err.code !== 'GITHUB_LOGIN_FAILED')
        logger.error({ err: err.message }, 'github link failed');
      return done(err.code === 'GITHUB_LOGIN_FAILED' ? err.message : 'error');
    }
  }
  const back = (reason) => res.redirect(302, `${appUrl()}/login?github=${reason}`);
  const expected = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, stateCookieOptions);
  if (!githubEnabled()) return back('disabled');
  if (req.query.error) return back('denied');
  if (!sameState(expected, req.query.state) || typeof req.query.code !== 'string') {
    return back('bad_state');
  }
  try {
    const session = await loginWithProfile(await fetchProfile(req.query.code), clientMeta(req));
    setRefreshCookie(res, session.refreshToken);
    res.redirect(302, `${appUrl()}/`);
  } catch (err) {
    if (err.code !== 'GITHUB_LOGIN_FAILED')
      logger.error({ err: err.message }, 'github login failed');
    back(err.code === 'GITHUB_LOGIN_FAILED' ? err.message : 'error');
  }
});

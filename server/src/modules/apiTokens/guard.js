import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError, unauthorized } from '../../utils/errors.js';
import { TOKEN_PREFIX, hashToken } from './service.js';
import * as repo from './repository.js';

// 요청 문맥: 활동 기록이 "어떤 API 토큰으로 한 일인지"를 남길 때 읽는다.
export const tokenContext = new AsyncLocalStorage();

const forbiddenToken = (code, message) => new AppError(403, code, message);

// 토큰이 호출할 수 있는 경로. 계정·세션·토큰 관리, 사용자 관리, 알림은 JWT 로그인만 된다.
const ALLOWED = /^\/(projects|tasks|comments|search|dashboard|feed)(\/|$)/;
const DENIED = [
  /^\/projects\/[^/]+\/(github|share-links|recurrences)(\/|$)/, // 연동 설정·공개 링크·반복 규칙은 토큰으로 건드리지 않는다
];
const MEMBERS = /^\/projects\/[^/]+\/members(\/|$)/; // 조회는 되지만 추가·제거는 안 된다
const PROJECT_ITSELF = /^\/projects\/[^/]+\/?$/; // 프로젝트 삭제는 안 된다

export function assertAllowed(scope, method, path) {
  const read = method === 'GET' || method === 'HEAD';
  const allowed = path === '/auth/me' || ALLOWED.test(path);
  if (
    !allowed ||
    DENIED.some((re) => re.test(path)) ||
    (!read && MEMBERS.test(path)) ||
    (method === 'DELETE' && PROJECT_ITSELF.test(path))
  ) {
    throw forbiddenToken('TOKEN_FORBIDDEN', 'API 토큰으로는 호출할 수 없는 기능입니다.');
  }
  if (scope === 'read' && !read) {
    throw forbiddenToken('TOKEN_READ_ONLY', '읽기 전용 토큰으로는 데이터를 바꿀 수 없습니다.');
  }
}

export const bearerOf = (req) => {
  const [scheme, value] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && value ? value : null;
};

// 토큰 값을 해시로 조회해 폐기·만료·비활성 사용자를 걸러낸다. 토큰 형식이 아니면 null.
export async function loadApiToken(req) {
  const raw = bearerOf(req);
  if (!raw?.startsWith(TOKEN_PREFIX)) return null;
  const row = await repo.findByHash(hashToken(raw));
  if (
    !row ||
    row.revoked_at ||
    !row.is_active ||
    (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
  ) {
    throw unauthorized();
  }
  try {
    await repo.touch(row.id);
  } catch {
    // 사용 시각 기록 실패가 요청을 막지 않게 한다
  }
  return { id: row.id, name: row.name, scope: row.scope, userId: row.user_id };
}

// REST: 라우터보다 앞에서 토큰을 확인하고 경로·권한 범위를 검사한다. JWT 요청은 그대로 지나간다.
export async function resolveApiToken(req, res, next) {
  try {
    const token = await loadApiToken(req);
    if (!token) return next();
    assertAllowed(token.scope, req.method, req.path);
    req.apiToken = token;
    tokenContext.run({ name: token.name }, next);
  } catch (err) {
    next(err);
  }
}

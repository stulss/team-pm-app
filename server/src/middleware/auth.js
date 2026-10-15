import { forbidden, unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { findById, toUser } from '../modules/users/repository.js';

// Access JWT 검증 후 사용자를 DB 에서 다시 읽는다.
// 역할 변경·비활성화가 토큰 만료(15분)를 기다리지 않고 즉시 반영되게 하기 위함.
export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    const payload = scheme === 'Bearer' && token ? verifyAccessToken(token) : null;
    if (!payload) throw unauthorized();

    const row = await findById(payload.sub);
    if (!row || !row.is_active) throw unauthorized();
    req.user = toUser(row);
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

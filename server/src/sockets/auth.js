import { verifyAccessToken } from '../utils/jwt.js';
import { findById } from '../modules/users/repository.js';

// 소켓 연결 인증: io(url, { auth: { token: accessToken } }).
// 유효한 access JWT 가 있고 활성 사용자일 때만 연결을 허용한다. (REST 의 authenticate 와 같은 규칙)
export async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    const payload = typeof token === 'string' ? verifyAccessToken(token) : null;
    const row = payload && (await findById(payload.sub));
    if (!row || !row.is_active) return next(new Error('UNAUTHORIZED'));
    socket.data.user = { id: row.id, role: row.role };
    next();
  } catch (err) {
    next(err);
  }
}

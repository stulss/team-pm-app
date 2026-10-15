import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { logger } from '../utils/logger.js';

// 안전한 형식(영문·숫자·_-, 64자 이하)의 요청 ID 만 받아들이고, 아니면 새로 만든다.
const SAFE_ID = /^[\w-]{1,64}$/;

// 요청마다 한 줄의 구조화 로그: 메서드, 경로(쿼리 제외), 상태, 소요 시간, 요청 ID, 사용자 ID.
// 본문·헤더(Authorization/Cookie)는 남기지 않는다. 응답 헤더 x-request-id 로 사용자가 문의 시 추적할 수 있다.
export const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const given = req.headers['x-request-id'];
    const id = typeof given === 'string' && SAFE_ID.test(given) ? given : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    return res.statusCode >= 400 ? 'warn' : 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
    res: (res) => ({ status: res.statusCode }),
  },
  customProps: (req) => ({ userId: req.user?.id }),
  autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
});

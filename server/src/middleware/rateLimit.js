import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const tooMany = (req, res) =>
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
  });

// 로그인: IP + 이메일 기준.
// 서버리스에서는 인스턴스별 메모리 저장소라 완벽한 제한은 아니다. M9 에서 Redis 저장소로 보강을 검토한다.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
  handler: tooMany,
});

// 가입: IP 기준
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: tooMany,
});

import pino from 'pino';
import { env } from '../config/env.js';

// 구조화(JSON) 로그. 토큰·쿠키·비밀번호는 절대 남기지 않는다(redact).
// Vercel 런타임 로그에서 reqId 로 한 요청의 로그를 묶어서 볼 수 있다.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
});

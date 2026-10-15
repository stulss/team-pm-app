import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { query } from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { projectsRouter } from './modules/projects/routes.js';

export const app = express();

app.disable('x-powered-by');
// Vercel 프록시 뒤에서 req.ip(레이트리밋 키)가 실제 클라이언트 IP 가 되도록 한다.
app.set('trust proxy', 1);
app.use(helmet());
// 동일 오리진 배포가 기본. CLIENT_ORIGIN 이 있을 때만 CORS 허용(로컬 개발 등).
if (env.CLIENT_ORIGIN) {
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
}
app.use(express.json());
app.use(cookieParser());

const api = express.Router();

// 토큰·개인정보가 오가는 API 응답은 어떤 캐시에도 저장되지 않게 한다.
api.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

api.get('/health', async (req, res) => {
  try {
    await query('select 1');
    res.json({ status: 'ok', db: 'ok', env: env.NODE_ENV });
  } catch (err) {
    console.error('health check failed', err.message);
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

api.use('/auth', authRouter);
api.use('/users', usersRouter);
api.use('/projects', projectsRouter);

app.use('/api/v1', api);
app.use(notFound);
app.use(errorHandler);

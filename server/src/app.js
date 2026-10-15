import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { query } from './config/db.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
// 동일 오리진 배포가 기본. CLIENT_ORIGIN 이 있을 때만 CORS 허용(로컬 개발 등).
if (env.CLIENT_ORIGIN) {
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
}
app.use(express.json());
app.use(cookieParser());

const api = express.Router();

api.get('/health', async (req, res) => {
  try {
    await query('select 1');
    res.json({ status: 'ok', db: 'ok', env: env.NODE_ENV });
  } catch (err) {
    console.error('health check failed', err.message);
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use('/api/v1', api);
app.use(notFound);
app.use(errorHandler);

import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { runDailyJobs, todayIn } from '../notifications/service.js';
import { createDueTasks } from '../recurrences/service.js';
import { recordJobRun } from './repository.js';

// Vercel Cron 전용 엔드포인트(/api/cron/*). Vercel 은 CRON_SECRET 이 설정돼 있으면
// `Authorization: Bearer <CRON_SECRET>` 헤더를 붙여 GET 으로 호출한다.
export const cronRouter = Router();

function authorized(req) {
  if (!env.CRON_SECRET) return false;
  const given = Buffer.from(req.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

cronRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!env.CRON_SECRET) {
    return res
      .status(503)
      .json({ error: { code: 'CRON_DISABLED', message: 'CRON_SECRET 이 설정되지 않았습니다.' } });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다.' } });
  }
  next();
});

// 하루 1회: 마감 임박/지연 알림 생성 + 90일 지난 알림·만료 refresh 토큰 정리
cronRouter.get('/daily', async (req, res) => {
  const result = await runDailyJobs();
  // 반복 작업 카드 생성: 실패해도 위의 정리·알림 결과를 막지 않는다(규칙마다 실패는 안에서 로그로 남긴다).
  result.recurringCreated = await createDueTasks(todayIn());
  await recordJobRun('daily', result);
  res.json(result);
});

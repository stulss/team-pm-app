import { query } from '../../config/db.js';
import { logger } from '../../utils/logger.js';

// 예약 작업의 마지막 실행을 남긴다. Vercel 이 부른 것과 수동·로컬 호출은 source 로 구분한다.
// 기록이 실패해도 작업 결과를 막지 않는다.
export async function recordJobRun(name, result) {
  const source = process.env.VERCEL ? 'vercel' : 'manual';
  try {
    await query(
      `INSERT INTO job_runs (name, source, ran_at, result) VALUES ($1, $2, now(), $3::jsonb)
       ON CONFLICT (name, source) DO UPDATE SET ran_at = now(), result = EXCLUDED.result`,
      [name, source, JSON.stringify(result)],
    );
  } catch (err) {
    logger.error({ err: err.message, name }, 'job run record failed');
  }
}

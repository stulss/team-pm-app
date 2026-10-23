-- Up Migration

-- 예약 작업(일일 cron)의 마지막 실행 기록. 실제로 도는지 DB 에서 바로 확인하기 위한 것이다.
-- 작업 이름당 한 행만 두고 실행할 때마다 덮어쓴다. source 는 Vercel 에서 돈 것('vercel')과 그 밖(수동·로컬)을 구분한다.
CREATE TABLE job_runs (
  name    text        NOT NULL,
  source  text        NOT NULL,
  ran_at  timestamptz NOT NULL DEFAULT now(),
  result  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (name, source)
);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS job_runs;

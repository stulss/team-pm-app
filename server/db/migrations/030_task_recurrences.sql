-- Up Migration

-- 반복 작업(M41). 일일 cron 이 next_run_date 가 된 규칙마다 작업 카드를 하나 만든다.
CREATE TABLE task_recurrences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title          varchar(200) NOT NULL CHECK (char_length(title) >= 1),
  description    text,
  priority       varchar(10)  NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  assignee_id    uuid         REFERENCES users (id) ON DELETE SET NULL,
  frequency      varchar(10)  NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  weekday        smallint     CHECK (weekday BETWEEN 0 AND 6),
  month_day      smallint     CHECK (month_day BETWEEN 1 AND 31),
  due_after_days smallint     CHECK (due_after_days BETWEEN 0 AND 60),
  next_run_date  date         NOT NULL,
  active         boolean      NOT NULL DEFAULT true,
  created_by     uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  -- 주기에 맞는 값만 둔다.
  CHECK (
    (frequency = 'daily'   AND weekday IS NULL     AND month_day IS NULL) OR
    (frequency = 'weekly'  AND weekday IS NOT NULL AND month_day IS NULL) OR
    (frequency = 'monthly' AND weekday IS NULL     AND month_day IS NOT NULL)
  )
);
CREATE INDEX task_recurrences_due_idx ON task_recurrences (next_run_date) WHERE active;
CREATE INDEX task_recurrences_project_idx ON task_recurrences (project_id);

ALTER TABLE task_recurrences ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS task_recurrences;

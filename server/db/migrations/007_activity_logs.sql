-- Up Migration

-- 프로젝트 활동 기록(타임라인·작업별 변경 이력). 이름·제목은 기록 시점 값을 meta 에 복사해 둔다.
CREATE TABLE activity_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq        bigint       GENERATED ALWAYS AS IDENTITY,
  project_id uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id    uuid,
  actor_id   uuid         REFERENCES users (id) ON DELETE SET NULL,
  action     varchar(40)  NOT NULL,
  meta       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX activity_logs_seq_key ON activity_logs (seq);
CREATE INDEX activity_logs_project_seq_idx ON activity_logs (project_id, seq DESC);
CREATE INDEX activity_logs_task_seq_idx ON activity_logs (task_id, seq DESC) WHERE task_id IS NOT NULL;
CREATE INDEX activity_logs_created_at_idx ON activity_logs (created_at);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE activity_logs;

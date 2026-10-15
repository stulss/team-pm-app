-- Up Migration

CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid          NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title           varchar(200)  NOT NULL,
  description     text,
  status          task_status   NOT NULL DEFAULT 'todo',
  priority        task_priority NOT NULL DEFAULT 'medium',
  -- 담당자가 비활성화돼도 값은 유지한다. 프로젝트 멤버 여부는 애플리케이션에서 검증한다.
  assignee_id     uuid          REFERENCES users (id) ON DELETE SET NULL,
  created_by      uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  due_date        date,
  -- 칸반 순서. 사이에 끼우는 방식(double)이라 이동 시 한 행만 UPDATE 한다. (M4)
  position        double precision NOT NULL,
  completed_at    timestamptz,
  due_notified_at timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT tasks_title_length CHECK (char_length(title) BETWEEN 1 AND 200)
);

-- 칸반 보드 조회/정렬
CREATE INDEX tasks_project_status_position_idx ON tasks (project_id, status, position);
-- 내 작업 조회
CREATE INDEX tasks_assignee_status_idx ON tasks (assignee_id, status);
-- 마감 스캔 (partial index)
CREATE INDEX tasks_due_date_open_idx ON tasks (due_date) WHERE status <> 'done';

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE tasks;
DROP TYPE task_priority;
DROP TYPE task_status;

-- Up Migration

-- 타임라인 막대의 시작. 마감일과 함께 쓸 때는 시작일이 마감일보다 늦을 수 없다.
ALTER TABLE tasks ADD COLUMN start_date date;
ALTER TABLE tasks ADD CONSTRAINT tasks_start_before_due
  CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date);

-- task_id 작업은 depends_on_id(선행 작업)가 끝나야 시작할 수 있다. 순환은 서버가 막는다.
CREATE TABLE task_dependencies (
  task_id       uuid        NOT NULL,
  depends_on_id uuid        NOT NULL,
  project_id    uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id),
  -- 두 작업이 모두 이 프로젝트의 작업이어야 한다(tasks 의 UNIQUE (project_id, id) 는 마이그레이션 014).
  FOREIGN KEY (project_id, task_id)       REFERENCES tasks (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, depends_on_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE
);
CREATE INDEX task_dependencies_depends_on_idx ON task_dependencies (depends_on_id);

ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE task_dependencies;
ALTER TABLE tasks DROP CONSTRAINT tasks_start_before_due;
ALTER TABLE tasks DROP COLUMN start_date;

-- Up Migration

-- 하위 작업(체크리스트) 항목. 작업이 지워지면 함께 지워진다.
CREATE TABLE checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid             NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  content    varchar(200)     NOT NULL CHECK (char_length(content) >= 1),
  is_done    boolean          NOT NULL DEFAULT false,
  -- 사이에 끼우는 방식(칸반과 같음). 지금은 항상 맨 아래에 추가한다.
  position   double precision NOT NULL,
  created_at timestamptz      NOT NULL DEFAULT now()
);
CREATE INDEX checklist_items_task_idx ON checklist_items (task_id, position);

-- 복합 외래키의 대상. 작업·라벨이 같은 프로젝트임을 DB 가 보장하게 한다.
ALTER TABLE tasks ADD CONSTRAINT tasks_project_id_id_key UNIQUE (project_id, id);

CREATE TABLE labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       varchar(30)  NOT NULL CHECK (char_length(name) >= 1),
  color      varchar(10)  NOT NULL
             CHECK (color IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray')),
  created_by uuid         REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (project_id, id)
);
CREATE UNIQUE INDEX labels_project_name_key ON labels (project_id, lower(name));

CREATE TABLE task_labels (
  task_id    uuid NOT NULL,
  label_id   uuid NOT NULL,
  project_id uuid NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (project_id, task_id)  REFERENCES tasks (project_id, id)  ON DELETE CASCADE,
  FOREIGN KEY (project_id, label_id) REFERENCES labels (project_id, id) ON DELETE CASCADE
);
CREATE INDEX task_labels_label_idx ON task_labels (label_id);

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE task_labels;
DROP TABLE labels;
ALTER TABLE tasks DROP CONSTRAINT tasks_project_id_id_key;
DROP TABLE checklist_items;

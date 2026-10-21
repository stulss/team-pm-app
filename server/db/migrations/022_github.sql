-- Up Migration

-- 프로젝트 ↔ GitHub 저장소 연결(프로젝트당 1개, 저장소는 한 프로젝트에만). 웹훅 서명 비밀은 저장하지 않고
-- 서버 비밀과 (연결 id, secret_version) 에서 계산한다(secret_version 을 올리면 비밀이 바뀐다).
CREATE TABLE github_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid         NOT NULL UNIQUE REFERENCES projects (id) ON DELETE CASCADE,
  repo           varchar(140) NOT NULL CHECK (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  secret_version integer      NOT NULL DEFAULT 1,
  -- PR 이 열리면 "할 일" 작업을 "진행 중" 으로, PR 이 머지되면 작업을 "완료" 로 자동 이동
  move_on_open   boolean      NOT NULL DEFAULT false,
  done_on_merge  boolean      NOT NULL DEFAULT false,
  created_by     uuid         REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  last_event_at  timestamptz
);
CREATE UNIQUE INDEX github_connections_repo_key ON github_connections (lower(repo));

-- 작업에 연결된 PR·커밋. 같은 작업에 같은 PR/커밋은 한 행(재전송·수정 이벤트는 갱신).
CREATE TABLE github_task_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid         NOT NULL,
  project_id  uuid         NOT NULL,
  kind        varchar(12)  NOT NULL CHECK (kind IN ('pull_request', 'commit')),
  external_id varchar(64)  NOT NULL,
  title       varchar(300) NOT NULL,
  url         varchar(500) NOT NULL,
  state       varchar(10)  CHECK (state IS NULL OR state IN ('open', 'draft', 'merged', 'closed')),
  author      varchar(100),
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (task_id, kind, external_id),
  FOREIGN KEY (project_id, task_id) REFERENCES tasks (project_id, id) ON DELETE CASCADE
);
CREATE INDEX github_task_links_task_idx ON github_task_links (task_id, updated_at DESC);

-- 같은 웹훅 전달(X-GitHub-Delivery)을 두 번 처리하지 않기 위한 기록. 오래된 것은 매일 작업이 지운다.
CREATE TABLE github_deliveries (
  delivery_id   varchar(80) PRIMARY KEY,
  connection_id uuid        NOT NULL REFERENCES github_connections (id) ON DELETE CASCADE,
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_deliveries_received_idx ON github_deliveries (received_at);

ALTER TABLE github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_deliveries ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE github_deliveries;
DROP TABLE github_task_links;
DROP TABLE github_connections;

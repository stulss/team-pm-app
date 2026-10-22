-- Up Migration

-- GitHub 이슈 동기화(M35). 옵션은 기본 꺼짐이라 이전 코드·기존 연결에는 영향이 없다.
ALTER TABLE github_connections ADD COLUMN sync_issues boolean NOT NULL DEFAULT false;

-- 작업에 연결되는 외부 항목에 이슈를 더한다.
ALTER TABLE github_task_links DROP CONSTRAINT github_task_links_kind_check;
ALTER TABLE github_task_links
  ADD CONSTRAINT github_task_links_kind_check CHECK (kind IN ('pull_request', 'commit', 'issue'));

-- 이슈 하나를 한 번만 카드로 만들기 위한 기록. 카드를 지워도 행은 남는다(task_id 만 NULL).
CREATE TABLE github_issue_cards (
  project_id   uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  issue_number integer     NOT NULL,
  task_id      uuid        REFERENCES tasks (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, issue_number)
);

ALTER TABLE github_issue_cards ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS github_issue_cards;
DELETE FROM github_task_links WHERE kind = 'issue';
ALTER TABLE github_task_links DROP CONSTRAINT github_task_links_kind_check;
ALTER TABLE github_task_links
  ADD CONSTRAINT github_task_links_kind_check CHECK (kind IN ('pull_request', 'commit'));
ALTER TABLE github_connections DROP COLUMN IF EXISTS sync_issues;

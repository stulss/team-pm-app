-- Up Migration

-- PR → 작업 카드 자동 등록(M34). 옵션은 기본 꺼짐이라 이전 코드·기존 연결에는 영향이 없다.
ALTER TABLE github_connections ADD COLUMN create_on_pr boolean NOT NULL DEFAULT false;

-- PR 하나를 한 번만 카드로 만들기 위한 기록. 카드를 지워도 행은 남아(task_id 만 NULL) 같은 PR 을 다시 만들지 않는다.
CREATE TABLE github_pr_cards (
  project_id uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  pr_number  integer     NOT NULL,
  task_id    uuid        REFERENCES tasks (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, pr_number)
);

ALTER TABLE github_pr_cards ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS github_pr_cards;
ALTER TABLE github_connections DROP COLUMN IF EXISTS create_on_pr;

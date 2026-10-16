-- Up Migration

-- 프로젝트 안 투표. 집계는 지금 프로젝트 멤버의 표만 센다(애플리케이션 쿼리에서 조인).
CREATE TABLE polls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid          NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by uuid          REFERENCES users (id) ON DELETE SET NULL,
  question   varchar(200)  NOT NULL CHECK (char_length(question) >= 1),
  multiple   boolean       NOT NULL DEFAULT false,
  closed_at  timestamptz,
  created_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX polls_project_created_idx ON polls (project_id, created_at DESC);

CREATE TABLE poll_options (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id  uuid          NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label    varchar(100)  NOT NULL CHECK (char_length(label) >= 1),
  position smallint      NOT NULL,
  -- 표가 "같은 투표의 선택지"만 가리키도록 복합 외래키의 대상으로 쓴다.
  UNIQUE (poll_id, id)
);
CREATE INDEX poll_options_poll_idx ON poll_options (poll_id, position);

CREATE TABLE poll_votes (
  poll_id    uuid         NOT NULL,
  option_id  uuid         NOT NULL,
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, option_id, user_id),
  FOREIGN KEY (poll_id, option_id) REFERENCES poll_options (poll_id, id) ON DELETE CASCADE
);
CREATE INDEX poll_votes_user_idx ON poll_votes (user_id);

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE poll_votes;
DROP TABLE poll_options;
DROP TABLE polls;

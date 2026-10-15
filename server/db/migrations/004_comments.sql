-- Up Migration

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid        NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- 소프트 삭제: 행은 남기고 응답에서 본문을 "삭제된 댓글"로 가린다.
  deleted_at timestamptz,
  CONSTRAINT comments_body_length CHECK (char_length(body) BETWEEN 1 AND 5000)
);
CREATE INDEX comments_task_created_idx ON comments (task_id, created_at);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE comments;

-- Up Migration

-- 프로젝트 채팅(프로젝트당 방 1개). 90일 지난 메시지와 프로젝트당 5000건 초과분은 서버가 지운다.
CREATE TABLE chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq        bigint       GENERATED ALWAYS AS IDENTITY,
  project_id uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  author_id  uuid         REFERENCES users (id) ON DELETE SET NULL,
  body       text         NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX chat_messages_seq_key ON chat_messages (seq);
CREATE INDEX chat_messages_project_seq_idx ON chat_messages (project_id, seq DESC);
CREATE INDEX chat_messages_created_at_idx ON chat_messages (created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE chat_messages;

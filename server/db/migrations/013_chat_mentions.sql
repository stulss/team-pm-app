-- Up Migration

-- 채팅 멘션 알림은 작업이 없으므로 task_id 를 선택값으로 바꾸고, 프로젝트를 직접 가리키는 project_id 를 더한다.
-- 작업 알림은 이전처럼 task_id → 작업 → 프로젝트로 구한다(project_id 는 NULL).
ALTER TABLE notifications ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE notifications
  ADD COLUMN project_id uuid REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_target_check CHECK (task_id IS NOT NULL OR project_id IS NOT NULL);

-- 채팅 메시지가 누구를 멘션했는지(comment_mentions 와 같은 방식). 이름은 멘션 시점의 값.
CREATE TABLE chat_message_mentions (
  message_id uuid         NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       varchar(100) NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX chat_message_mentions_user_created_idx
  ON chat_message_mentions (user_id, created_at DESC);

ALTER TABLE chat_message_mentions ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE chat_message_mentions;
DELETE FROM notifications WHERE task_id IS NULL;
ALTER TABLE notifications DROP CONSTRAINT notifications_target_check;
ALTER TABLE notifications DROP COLUMN project_id;
ALTER TABLE notifications ALTER COLUMN task_id SET NOT NULL;

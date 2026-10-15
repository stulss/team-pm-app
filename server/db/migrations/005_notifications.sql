-- Up Migration

CREATE TYPE notification_type AS ENUM ('task_assigned', 'due_soon', 'comment_added', 'task_overdue');

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  task_id    uuid              NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_id   uuid              REFERENCES users (id) ON DELETE SET NULL,
  message    text              NOT NULL,
  is_read    boolean           NOT NULL DEFAULT false,
  created_at timestamptz       NOT NULL DEFAULT now()
);

-- 목록/안 읽은 개수 조회
CREATE INDEX notifications_user_read_created_idx
  ON notifications (user_id, is_read, created_at DESC);

-- 마감 지연 알림 중복 방지 (due_notified_at 은 마감 임박 알림용). 마감일이 바뀌면 둘 다 초기화한다.
ALTER TABLE tasks ADD COLUMN overdue_notified_at timestamptz;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Down Migration

ALTER TABLE tasks DROP COLUMN overdue_notified_at;
DROP TABLE notifications;
DROP TYPE notification_type;

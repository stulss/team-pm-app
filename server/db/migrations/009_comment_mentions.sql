-- Up Migration

-- 멘션 알림 종류. (PostgreSQL 은 enum 값을 지울 수 없어 down 에서도 값은 남는다.)
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'mention';

-- 댓글이 누구를 멘션했는지 명시적으로 저장한다. name 은 멘션 시점의 이름(본문의 @이름 과 짝).
CREATE TABLE comment_mentions (
  comment_id uuid         NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       varchar(50)  NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
-- "나를 멘션한 글" 조회(모아보기)용
CREATE INDEX comment_mentions_user_created_idx ON comment_mentions (user_id, created_at DESC);

ALTER TABLE comment_mentions ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE comment_mentions;
-- 'mention' enum 값은 PostgreSQL 에서 제거할 수 없어 그대로 둔다(사용하지 않으면 무해).

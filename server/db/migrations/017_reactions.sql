-- Up Migration

-- 댓글·채팅 메시지의 이모지 반응. emoji 는 그림이 아니라 키를 저장하고 허용 목록만 받는다.
CREATE TABLE comment_reactions (
  comment_id uuid        NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      varchar(16) NOT NULL
             CHECK (emoji IN ('thumbs_up', 'heart', 'laugh', 'party', 'wow', 'thanks', 'eyes', 'check')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, emoji)
);
CREATE INDEX comment_reactions_comment_idx ON comment_reactions (comment_id, created_at);

CREATE TABLE chat_message_reactions (
  message_id uuid        NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      varchar(16) NOT NULL
             CHECK (emoji IN ('thumbs_up', 'heart', 'laugh', 'party', 'wow', 'thanks', 'eyes', 'check')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX chat_message_reactions_message_idx ON chat_message_reactions (message_id, created_at);

ALTER TABLE comment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_message_reactions ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE chat_message_reactions;
DROP TABLE comment_reactions;

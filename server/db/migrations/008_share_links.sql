-- Up Migration

-- 활동 기록을 로그인 없이 읽기 전용으로 공유하는 링크. 토큰 원문은 저장하지 않고 SHA-256 해시만 저장한다.
CREATE TABLE share_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_by     uuid         REFERENCES users (id) ON DELETE SET NULL,
  token_hash     varchar(64)  NOT NULL,
  expires_at     timestamptz  NOT NULL,
  revoked_at     timestamptz,
  view_count     integer      NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  created_at     timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX share_links_token_hash_key ON share_links (token_hash);
CREATE INDEX share_links_project_created_idx ON share_links (project_id, created_at DESC);
CREATE INDEX share_links_expires_at_idx ON share_links (expires_at);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE share_links;

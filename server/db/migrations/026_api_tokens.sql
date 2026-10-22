-- Up Migration

-- 개인 API 토큰(M32). 값은 저장하지 않고 SHA-256 해시만 둔다. prefix 는 목록에서 어느 토큰인지 알아보는 용도(앞 12자).
CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         varchar(60)  NOT NULL,
  scope        varchar(10)  NOT NULL CHECK (scope IN ('read', 'write')),
  token_hash   char(64)     NOT NULL UNIQUE,
  prefix       varchar(16)  NOT NULL,
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id, created_at DESC);

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE IF EXISTS api_tokens;

-- Up Migration

-- 이메일 인증 시각. NULL 이면 미인증. 이 마이그레이션 이전에 가입한 계정은 이미 쓰고 있으므로 인증된 것으로 본다.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = now();

-- 이메일 인증/비밀번호 재설정 링크용 일회용 토큰. 원문은 저장하지 않고 SHA-256 해시만 저장한다.
CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       varchar(10)  NOT NULL CHECK (kind IN ('verify', 'reset')),
  token_hash varchar(64)  NOT NULL,
  expires_at timestamptz  NOT NULL,
  used_at    timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_tokens_token_hash_key ON email_tokens (token_hash);
CREATE INDEX email_tokens_user_kind_idx ON email_tokens (user_id, kind, created_at DESC);

ALTER TABLE email_tokens ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE email_tokens;
ALTER TABLE users DROP COLUMN email_verified_at;

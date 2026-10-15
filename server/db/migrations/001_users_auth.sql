-- Up Migration

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'member');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(255) NOT NULL,
  password_hash varchar(100) NOT NULL,
  name          varchar(50)  NOT NULL,
  role          user_role    NOT NULL DEFAULT 'member',
  is_active     boolean      NOT NULL DEFAULT true,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_name_length CHECK (char_length(name) BETWEEN 1 AND 50)
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash varchar(64)  NOT NULL,
  expires_at timestamptz  NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

-- Supabase 는 public 스키마를 anon key 로 PostgREST 에 노출한다.
-- RLS 를 켜고 정책을 두지 않으면 anon/authenticated 직접 접근은 차단되고,
-- 서버(postgres 역할)는 RLS 를 우회해 정상 동작한다.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE refresh_tokens;
DROP TABLE users;
DROP TYPE user_role;

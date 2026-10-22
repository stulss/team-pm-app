-- Up Migration

-- 로그인한 기기 목록(M29). refresh 토큰은 회전하므로 같은 로그인(세션)의 토큰을 session_id 로 묶는다.
-- 이전 코드가 만든 행은 session_id 가 NULL 이고, 그때는 토큰 id 자체를 세션 id 로 본다(COALESCE(session_id, id)).
ALTER TABLE refresh_tokens ADD COLUMN session_id uuid;
ALTER TABLE refresh_tokens ADD COLUMN user_agent varchar(300);
ALTER TABLE refresh_tokens ADD COLUMN ip varchar(64);
CREATE INDEX refresh_tokens_user_session_idx ON refresh_tokens (user_id, session_id);

-- Down Migration

DROP INDEX IF EXISTS refresh_tokens_user_session_idx;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS ip;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS user_agent;
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS session_id;

-- Up Migration

-- GitHub 로그인(M27). 이전 코드는 이 컬럼을 모르지만 NULL 허용이라 그대로 동작한다.
ALTER TABLE users ADD COLUMN github_id bigint;
ALTER TABLE users ADD COLUMN github_login varchar(39);
CREATE UNIQUE INDEX users_github_id_key ON users (github_id) WHERE github_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS users_github_id_key;
ALTER TABLE users DROP COLUMN IF EXISTS github_login;
ALTER TABLE users DROP COLUMN IF EXISTS github_id;

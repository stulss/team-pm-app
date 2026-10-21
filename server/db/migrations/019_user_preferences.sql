-- Up Migration

-- 사용자별 개인 설정(테마·포인트 색·밀도·기본 작업 보기 등). 허용 키·값은 서버가 검증한다.
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD CONSTRAINT users_preferences_is_object
  CHECK (jsonb_typeof(preferences) = 'object');

-- Down Migration

ALTER TABLE users DROP CONSTRAINT users_preferences_is_object;
ALTER TABLE users DROP COLUMN preferences;

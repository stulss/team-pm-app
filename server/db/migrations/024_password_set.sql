-- Up Migration

-- GitHub 로 가입한 계정은 비밀번호를 모른다(임의 해시). 설정에서 GitHub 연결을 해제하면
-- 로그인 수단이 사라지지 않도록 "사용자가 비밀번호를 정했는가"를 따로 기록한다. 이전 코드는 모르지만 기본값 true 라 그대로 동작한다.
ALTER TABLE users ADD COLUMN password_set boolean NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS password_set;

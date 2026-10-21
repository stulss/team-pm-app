-- Up Migration

-- 멤버 개인의 프로젝트별 설정: 알림 음소거(muted), 사이드바·목록 상단 고정(pinned).
-- 본인에게만 적용되며 다른 멤버에게는 보이지 않는다.
ALTER TABLE project_members ADD COLUMN muted  boolean NOT NULL DEFAULT false;
ALTER TABLE project_members ADD COLUMN pinned boolean NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE project_members DROP COLUMN pinned;
ALTER TABLE project_members DROP COLUMN muted;

-- Up Migration

-- 프로젝트 화면의 필터 조합을 이름 붙여 저장한다. 만든 사용자만 쓰는 개인용 설정이다.
CREATE TABLE saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid         NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       varchar(40)  NOT NULL CHECK (char_length(name) >= 1),
  filters    jsonb        NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(filters) = 'object'),
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saved_filters_owner_name_key
  ON saved_filters (project_id, user_id, lower(name));

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE saved_filters;

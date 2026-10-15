-- Up Migration

CREATE TYPE project_status AS ENUM ('active', 'archived');

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(100)   NOT NULL,
  description text,
  owner_id    uuid           NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status      project_status NOT NULL DEFAULT 'active',
  created_at  timestamptz    NOT NULL DEFAULT now(),
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT projects_name_length CHECK (char_length(name) BETWEEN 1 AND 100)
);
CREATE INDEX projects_owner_id_idx ON projects (owner_id);

CREATE TABLE project_members (
  project_id uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
-- "내 프로젝트" 조회용
CREATE INDEX project_members_user_id_idx ON project_members (user_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP TABLE project_members;
DROP TABLE projects;
DROP TYPE project_status;

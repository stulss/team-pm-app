-- Up Migration

-- 프로젝트 키(TPM) + 작업 번호(12) → 작업 키 TPM-12
ALTER TABLE projects ADD COLUMN key varchar(10);
ALTER TABLE projects ADD COLUMN task_seq integer NOT NULL DEFAULT 0;

-- 기존 프로젝트: 생성순으로 P1, P2, …
UPDATE projects p SET key = 'P' || r.rn
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM projects) r
WHERE r.id = p.id;

ALTER TABLE projects ALTER COLUMN key SET NOT NULL;
ALTER TABLE projects ADD CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');
CREATE UNIQUE INDEX projects_key_key ON projects (key);

ALTER TABLE tasks ADD COLUMN number integer;

-- 기존 작업: 프로젝트 안에서 생성순으로 1, 2, …
UPDATE tasks t SET number = r.rn
FROM (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn FROM tasks
) r
WHERE r.id = t.id;

ALTER TABLE tasks ALTER COLUMN number SET NOT NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_number_positive CHECK (number > 0);
ALTER TABLE tasks ADD CONSTRAINT tasks_project_number_key UNIQUE (project_id, number);

UPDATE projects p SET task_seq = COALESCE((SELECT max(number) FROM tasks t WHERE t.project_id = p.id), 0);

-- 배포 순서 안전장치: 마이그레이션이 코드보다 먼저 적용되므로, 아직 key/number 를 모르는 이전 코드가
-- 프로젝트·작업을 만들어도 실패하지 않게 비어 있으면 DB 가 값을 채운다. (새 코드는 직접 값을 넣는다)
CREATE SEQUENCE projects_key_seq START 1000;

CREATE FUNCTION projects_assign_key() RETURNS trigger AS $$
BEGIN
  IF NEW.key IS NULL THEN
    LOOP
      NEW.key := 'P' || nextval('projects_key_seq');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM projects WHERE key = NEW.key);
    END LOOP;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER projects_assign_key BEFORE INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION projects_assign_key();

CREATE FUNCTION tasks_assign_number() RETURNS trigger AS $$
BEGIN
  IF NEW.number IS NULL THEN
    UPDATE projects SET task_seq = task_seq + 1 WHERE id = NEW.project_id RETURNING task_seq INTO NEW.number;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tasks_assign_number BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_assign_number();

-- Down Migration

DROP TRIGGER tasks_assign_number ON tasks;
DROP FUNCTION tasks_assign_number();
DROP TRIGGER projects_assign_key ON projects;
DROP FUNCTION projects_assign_key();
DROP SEQUENCE projects_key_seq;
ALTER TABLE tasks DROP CONSTRAINT tasks_project_number_key;
ALTER TABLE tasks DROP CONSTRAINT tasks_number_positive;
ALTER TABLE tasks DROP COLUMN number;
DROP INDEX projects_key_key;
ALTER TABLE projects DROP CONSTRAINT projects_key_format;
ALTER TABLE projects DROP COLUMN task_seq;
ALTER TABLE projects DROP COLUMN key;

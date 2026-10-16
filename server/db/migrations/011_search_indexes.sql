-- Up Migration

-- 통합검색(부분 일치 ILIKE)을 인덱스로 받치기 위한 trigram 인덱스. 새 테이블은 없다.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX projects_name_trgm_idx ON projects USING gin (name gin_trgm_ops);
CREATE INDEX tasks_title_trgm_idx ON tasks USING gin (title gin_trgm_ops);
CREATE INDEX tasks_description_trgm_idx ON tasks USING gin (description gin_trgm_ops);
CREATE INDEX comments_body_trgm_idx ON comments USING gin (body gin_trgm_ops);
CREATE INDEX chat_messages_body_trgm_idx ON chat_messages USING gin (body gin_trgm_ops);

-- Down Migration

DROP INDEX chat_messages_body_trgm_idx;
DROP INDEX comments_body_trgm_idx;
DROP INDEX tasks_description_trgm_idx;
DROP INDEX tasks_title_trgm_idx;
DROP INDEX projects_name_trgm_idx;

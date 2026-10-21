-- Up Migration

-- 댓글에 한 단계 답글. 답글은 같은 작업의 댓글만 가리킬 수 있다(복합 외래키).
-- 답글에 다시 답글을 다는 것은 서비스가 막는다(parent_id 는 만든 뒤 바뀌지 않는다).
ALTER TABLE comments ADD CONSTRAINT comments_task_id_id_key UNIQUE (task_id, id);
ALTER TABLE comments ADD COLUMN parent_id uuid;
ALTER TABLE comments ADD CONSTRAINT comments_parent_fk
  FOREIGN KEY (task_id, parent_id) REFERENCES comments (task_id, id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT comments_not_own_parent
  CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX comments_parent_idx ON comments (parent_id) WHERE parent_id IS NOT NULL;

-- Down Migration

DROP INDEX comments_parent_idx;
ALTER TABLE comments DROP CONSTRAINT comments_not_own_parent;
ALTER TABLE comments DROP CONSTRAINT comments_parent_fk;
ALTER TABLE comments DROP COLUMN parent_id;
ALTER TABLE comments DROP CONSTRAINT comments_task_id_id_key;

import * as repo from './repository.js';

const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 50;

// ILIKE 의 와일드카드(% _)와 이스케이프 문자(\)를 글자 그대로 찾게 한다.
export const likePattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

// 일치 부분 주변을 잘라 한 줄 텍스트로 만든다. HTML 이 아니다. 일치가 없으면 null.
export function snippet(text, q) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(flat.length, at + q.length + SNIPPET_AFTER);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

const author = (row) => (row.author_id ? { id: row.author_id, name: row.author_name } : null);

const shape = {
  project: (rows) => rows.map((r) => ({ id: r.id, name: r.name, status: r.status })),
  task: (rows, q) =>
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      projectId: r.project_id,
      projectName: r.project_name,
      // 제목에 이미 일치하면 보여 줄 필요가 없고, 설명에만 일치할 때 그 주변을 보여 준다.
      snippet: r.title.toLowerCase().includes(q.toLowerCase()) ? null : snippet(r.description, q),
    })),
  comment: (rows, q) =>
    rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      taskTitle: r.task_title,
      projectId: r.project_id,
      projectName: r.project_name,
      author: author(r),
      snippet: snippet(r.body, q),
      createdAt: r.created_at,
    })),
  chat: (rows, q) =>
    rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      projectName: r.project_name,
      author: author(r),
      snippet: snippet(r.body, q),
      createdAt: r.created_at,
    })),
};

const searchers = {
  project: [repo.searchProjects, 'projects'],
  task: [repo.searchTasks, 'tasks'],
  comment: [repo.searchComments, 'comments'],
  chat: [repo.searchChat, 'chat'],
};

export async function search(user, { q, type, limit }) {
  const args = {
    userId: user.id,
    isAdmin: user.role === 'admin',
    pattern: likePattern(q),
    limit,
  };
  const kinds = type === 'all' ? Object.keys(searchers) : [type];
  const result = { projects: [], tasks: [], comments: [], chat: [] };
  await Promise.all(
    kinds.map(async (kind) => {
      const [fn, key] = searchers[kind];
      result[key] = shape[kind](await fn(args), q);
    }),
  );
  return result;
}

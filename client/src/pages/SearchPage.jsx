import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { search } from '../api/search.js';
import { errorMessage } from '../api/http.js';
import { highlight } from '../utils/highlight.js';
import { formatWhen } from '../constants/activity.js';
import { STATUS_LABELS } from '../constants/task.js';

const taskLink = (projectId, taskId) => `/projects/${projectId}?task=${taskId}`;

function Group({ title, items, children }) {
  if (items.length === 0) return null;
  return (
    <section className="search-group" aria-label={title}>
      <h2>
        {title} <span className="muted small">{items.length}</span>
      </h2>
      <ul className="search-list">{children}</ul>
    </section>
  );
}

// 통합검색 결과. 서버가 내가 접근할 수 있는 프로젝트의 결과만 돌려준다.
export default function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();
  const valid = q.length >= 2;

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['search', q],
    queryFn: () => search(q),
    enabled: valid,
  });

  const total = data
    ? data.projects.length + data.tasks.length + data.comments.length + data.chat.length
    : 0;

  return (
    <div className="stack">
      <h1>검색{valid && <>: “{q}”</>}</h1>
      {!valid && <p className="muted">검색어를 2자 이상 입력해 주세요.</p>}
      {valid && isPending && <p className="muted">검색 중…</p>}
      {valid && isError && (
        <p role="alert" className="error">
          {errorMessage(error, '검색에 실패했습니다.')}
        </p>
      )}
      {valid && data && total === 0 && (
        <p className="muted">
          “{q}” 에 대한 결과가 없습니다. 접근할 수 있는 프로젝트만 검색됩니다.
        </p>
      )}
      {data && (
        <>
          <Group title="프로젝트" items={data.projects}>
            {data.projects.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`}>{highlight(p.name, q)}</Link>
                {p.status === 'archived' && <span className="badge badge-archived">보관됨</span>}
              </li>
            ))}
          </Group>
          <Group title="작업" items={data.tasks}>
            {data.tasks.map((t) => (
              <li key={t.id}>
                <Link to={taskLink(t.projectId, t.id)}>{highlight(t.title, q)}</Link>
                <span className="muted small">
                  {t.projectName} · {STATUS_LABELS[t.status] ?? t.status}
                </span>
                {t.snippet && <p className="search-snippet">{highlight(t.snippet, q)}</p>}
              </li>
            ))}
          </Group>
          <Group title="댓글" items={data.comments}>
            {data.comments.map((c) => (
              <li key={c.id}>
                <Link to={taskLink(c.projectId, c.taskId)}>{c.taskTitle}</Link>
                <span className="muted small">
                  {c.projectName} · {c.author?.name ?? '알 수 없는 사용자'} ·{' '}
                  {formatWhen(c.createdAt)}
                </span>
                <p className="search-snippet">{highlight(c.snippet, q)}</p>
              </li>
            ))}
          </Group>
          <Group title="채팅" items={data.chat}>
            {data.chat.map((m) => (
              <li key={m.id}>
                <Link to={`/projects/${m.projectId}`}>{m.projectName}</Link>
                <span className="muted small">
                  {m.author?.name ?? '알 수 없는 사용자'} · {formatWhen(m.createdAt)}
                </span>
                <p className="search-snippet">{highlight(m.snippet, q)}</p>
              </li>
            ))}
          </Group>
        </>
      )}
    </div>
  );
}

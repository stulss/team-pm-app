import { useQuery } from '@tanstack/react-query';
import { listGithubLinks } from '../../api/github.js';
import { PR_STATE_LABELS } from '../../constants/github.js';

// 작업 모달의 GitHub 영역: 웹훅으로 연결된 PR·커밋을 보여 준다(읽기 전용).
export default function GithubLinks({ taskId }) {
  const { data = [] } = useQuery({
    queryKey: ['github-links', taskId],
    queryFn: () => listGithubLinks(taskId),
  });
  if (data.length === 0) return null;
  return (
    <section className="github-links" aria-label="GitHub">
      <h3>GitHub</h3>
      <ul className="linked-list">
        {data.map((l) => (
          <li key={l.id}>
            {l.kind === 'pull_request' ? (
              <span className={`pr-state pr-${l.state}`}>
                PR #{l.externalId} {PR_STATE_LABELS[l.state] ?? ''}
              </span>
            ) : (
              <code className="commit-ref">{l.externalId.slice(0, 7)}</code>
            )}
            {l.url ? (
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="linked-title">
                {l.title}
              </a>
            ) : (
              <span className="linked-title">{l.title}</span>
            )}
            {l.author && <span className="muted small">{l.author}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

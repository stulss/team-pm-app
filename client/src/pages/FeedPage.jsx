import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getFeed } from '../api/feed.js';
import { errorMessage } from '../api/http.js';
import { actorName, describeActivity, formatWhen } from '../constants/activity.js';
import { PRIORITY_LABELS, STATUS_LABELS } from '../constants/task.js';

const taskLink = (projectId, taskId) => `/projects/${projectId}?task=${taskId}`;

function Block({ title, count, empty, children }) {
  return (
    <section className="card feed-block" aria-label={title}>
      <h2>
        {title} {count > 0 && <span className="muted small">{count}</span>}
      </h2>
      {count === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="feed-list">{children}</ul>
      )}
    </section>
  );
}

// 모아보기: 내가 확인해야 할 것을 한 화면에. 서버가 내가 멤버인 프로젝트의 것만 돌려준다.
export default function FeedPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['feed'],
    queryFn: getFeed,
    refetchOnWindowFocus: true,
  });

  return (
    <div className="stack">
      <h1>모아보기</h1>
      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '모아보기를 불러오지 못했습니다.')}
        </p>
      )}
      {data && (
        <>
          <Block
            title="마감 임박·지연 작업"
            count={data.dueTasks.length}
            empty="7일 안에 마감이거나 지난 내 작업이 없습니다."
          >
            {data.dueTasks.map((t) => (
              <li key={t.id}>
                <Link to={taskLink(t.projectId, t.id)}>{t.title}</Link>
                {t.overdue ? (
                  <span className="badge badge-overdue">지연</span>
                ) : (
                  <span className="muted small">마감 {t.dueDate}</span>
                )}
                <span className="muted small">
                  {t.projectName} · {STATUS_LABELS[t.status]} · {PRIORITY_LABELS[t.priority]}
                  {t.overdue && ` · 마감 ${t.dueDate}`}
                </span>
              </li>
            ))}
          </Block>

          <Block
            title="나를 멘션한 댓글"
            count={data.mentions.length}
            empty="최근에 나를 멘션한 댓글이 없습니다."
          >
            {data.mentions.map((m) => (
              <li key={m.commentId}>
                <Link to={taskLink(m.projectId, m.taskId)}>{m.taskTitle}</Link>
                <span className="muted small">
                  {m.projectName} · {m.author?.name ?? '알 수 없는 사용자'} ·{' '}
                  {formatWhen(m.createdAt)}
                </span>
                <p className="feed-snippet">{m.snippet}</p>
              </li>
            ))}
          </Block>

          <Block
            title="안 읽은 알림"
            count={data.notifications.items.length}
            empty="안 읽은 알림이 없습니다."
          >
            {data.notifications.items.map((n) => (
              <li key={n.id}>
                <Link to={n.taskId ? taskLink(n.projectId, n.taskId) : `/projects/${n.projectId}`}>
                  {n.message}
                </Link>
                <span className="muted small">{formatWhen(n.createdAt)}</span>
              </li>
            ))}
            {data.notifications.unread > data.notifications.items.length && (
              <li className="muted small">
                외 {data.notifications.unread - data.notifications.items.length}건은 상단 벨에서
                확인하세요.
              </li>
            )}
          </Block>

          <Block
            title="내가 없는 동안의 활동"
            count={data.activities.length}
            empty="다른 사람의 최근 활동이 없습니다."
          >
            {data.activities.map((a) => (
              <li key={a.id}>
                <span>
                  <strong>{actorName(a)}</strong>님이 {describeActivity(a)}
                </span>
                <span className="muted small">
                  <Link to={`/projects/${a.projectId}`}>{a.projectName}</Link> ·{' '}
                  {formatWhen(a.createdAt)}
                </span>
              </li>
            ))}
          </Block>
        </>
      )}
    </div>
  );
}

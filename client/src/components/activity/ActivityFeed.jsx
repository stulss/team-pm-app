import { useInfiniteQuery } from '@tanstack/react-query';
import { listActivities } from '../../api/activity.js';
import { errorMessage } from '../../api/http.js';
import { actorName, describeActivity, formatWhen } from '../../constants/activity.js';

// 프로젝트 전체 활동(taskId 없음) 또는 한 작업의 변경 이력(taskId 있음).
// 실시간 이벤트가 오면 useProjectRealtime 이 ['activities', projectId] 를 무효화해 다시 불러온다.
export default function ActivityFeed({ projectId, taskId, title = '활동 기록', limit = 20 }) {
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['activities', projectId, taskId ?? null],
      queryFn: ({ pageParam }) => listActivities(projectId, { before: pageParam, taskId, limit }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    });

  const items = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section className="activity" aria-label={title}>
      <h2>{title}</h2>
      {isPending && <p className="muted small">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '활동 기록을 불러오지 못했습니다.')}
        </p>
      )}
      {!isPending && !isError && items.length === 0 && (
        <p className="muted small">아직 기록이 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul className="activity-list">
          {items.map((a) => (
            <li key={a.id}>
              <span className="activity-text">
                <strong>{actorName(a)}</strong>님이 {describeActivity(a, { showTask: !taskId })}
              </span>
              <time className="muted small" dateTime={a.createdAt}>
                {formatWhen(a.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {hasNextPage && (
        <button
          type="button"
          className="secondary"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
        </button>
      )}
    </section>
  );
}

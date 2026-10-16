import { useInfiniteQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { getShared } from '../api/share.js';
import { actorName, describeActivity, formatWhen } from '../constants/activity.js';

// 로그인 없이 열리는 읽기 전용 활동 기록. 없는·만료된·폐기된 링크는 구분 없이 같은 안내를 보여 준다.
export default function SharedHistoryPage() {
  const { token } = useParams();
  const { data, isPending, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['shared', token],
      queryFn: ({ pageParam }) => getShared(token, { before: pageParam }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      retry: false,
    });

  if (isPending) return <p className="center muted">불러오는 중…</p>;

  if (isError) {
    const notFound = error.response?.status === 404 || error.response?.status === 400;
    return (
      <div className="card">
        <h1>{notFound ? '열 수 없는 링크입니다' : '불러오지 못했습니다'}</h1>
        <p className="muted">
          {notFound
            ? '링크가 만료되었거나 폐기되었거나 주소가 올바르지 않습니다. 공유한 사람에게 새 링크를 요청해 주세요.'
            : '잠시 후 다시 시도해 주세요.'}
        </p>
      </div>
    );
  }

  const first = data.pages[0];
  const items = data.pages.flatMap((p) => p.data);

  return (
    <div className="card">
      <p className="muted small">읽기 전용 공유 · {formatWhen(first.expiresAt)} 까지 유효</p>
      <h1>
        {first.project.name}{' '}
        {first.project.status === 'archived' && (
          <span className="badge badge-archived">보관됨</span>
        )}
      </h1>
      <section className="activity" aria-label="활동 기록">
        <h2>활동 기록</h2>
        {items.length === 0 && <p className="muted small">아직 기록이 없습니다.</p>}
        {items.length > 0 && (
          <ul className="activity-list">
            {items.map((a) => (
              <li key={a.id}>
                <span className="activity-text">
                  <strong>{actorName(a)}</strong>님이 {describeActivity(a)}
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
    </div>
  );
}

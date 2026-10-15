import { useQuery } from '@tanstack/react-query';
import { getProjectDashboard } from '../../api/dashboard.js';
import { errorMessage } from '../../api/http.js';
import { AssigneeBars, OverdueList, ProgressBar, Stat, StatusBars } from './Charts.jsx';

// 프로젝트 화면의 요약 카드. 쿼리 키가 ['tasks', projectId, ...] 로 시작해서
// 작업이 바뀌거나 실시간 이벤트가 오면 다른 작업 쿼리와 함께 자동으로 다시 불러온다.
export default function ProjectDashboard({ projectId }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tasks', projectId, 'dashboard'],
    queryFn: () => getProjectDashboard(projectId),
  });

  return (
    <section className="card" aria-label="프로젝트 요약">
      <h2>요약</h2>
      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '요약을 불러오지 못했습니다.')}
        </p>
      )}
      {data && (
        <>
          <div className="stats">
            <Stat label="전체" value={data.progress.total} testId="stat-total" />
            <Stat label="완료" value={data.progress.done} testId="stat-done" />
            <Stat
              label="지연"
              value={data.overdue.count}
              tone={data.overdue.count > 0 ? 'bad' : undefined}
              testId="stat-overdue"
            />
            <Stat label="이번 주 마감" value={data.dueThisWeek} testId="stat-week" />
          </div>
          <ProgressBar
            percent={data.progress.percent}
            done={data.progress.done}
            total={data.progress.total}
          />
          <div className="dash-grid">
            <div>
              <h3>상태별</h3>
              <StatusBars byStatus={data.byStatus} />
            </div>
            <div>
              <h3>담당자별 미완료</h3>
              <AssigneeBars items={data.byAssignee} />
            </div>
          </div>
          <div>
            <h3>지연된 작업</h3>
            <OverdueList overdue={data.overdue} projectId={projectId} />
          </div>
        </>
      )}
    </section>
  );
}

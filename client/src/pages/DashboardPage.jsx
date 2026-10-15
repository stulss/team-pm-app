import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getOverallDashboard } from '../api/dashboard.js';
import { errorMessage } from '../api/http.js';
import { OverdueList, ProgressBar, Stat, StatusBars } from '../components/dashboard/Charts.jsx';

// 내 전체 요약: 소속 진행 중 프로젝트를 합산한다(Admin 은 전체). 쿼리 키가 ['mytasks', ...] 로 시작해서
// 작업이 바뀌면 "내 작업"과 함께 다시 불러온다.
export default function DashboardPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['mytasks', 'dashboard'],
    queryFn: getOverallDashboard,
  });

  return (
    <>
      <h1>대시보드</h1>
      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '대시보드를 불러오지 못했습니다.')}
        </p>
      )}
      {data && data.projects.length === 0 && (
        <p className="muted">
          진행 중인 프로젝트가 없습니다. 프로젝트에 참여하면 요약이 나타납니다.
        </p>
      )}
      {data && data.projects.length > 0 && (
        <>
          <div className="card">
            <div className="stats">
              <Stat label="전체 작업" value={data.progress.total} testId="stat-total" />
              <Stat label="완료" value={data.progress.done} testId="stat-done" />
              <Stat
                label="지연"
                value={data.overdue.count}
                tone={data.overdue.count > 0 ? 'bad' : undefined}
                testId="stat-overdue"
              />
              <Stat label="이번 주 마감" value={data.dueThisWeek} testId="stat-week" />
              <Stat label="내 미완료" value={data.myOpen} testId="stat-mine" />
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
                <h3>지연된 작업</h3>
                <OverdueList overdue={data.overdue} />
              </div>
            </div>
          </div>

          <div className="card">
            <h2>프로젝트별 진행률</h2>
            <ul className="project-progress">
              {data.projects.map((p) => (
                <li key={p.id} data-project-id={p.id}>
                  <div className="row between">
                    <Link to={`/projects/${p.id}`}>{p.name}</Link>
                    <span className="muted small">
                      {p.done}/{p.total} · <strong>{p.percent}%</strong>
                      {p.overdue > 0 && <span className="overdue"> · 지연 {p.overdue}</span>}
                    </span>
                  </div>
                  <div
                    className="bar-track"
                    role="progressbar"
                    aria-label={`${p.name} 진행률`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={p.percent}
                  >
                    <div className="bar-fill bar-primary" style={{ width: `${p.percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}

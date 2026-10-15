import { Link } from 'react-router';
import { STATUSES, STATUS_LABELS } from '../../constants/task.js';

// 차트 라이브러리 없이 CSS 로 그리는 단순한 막대. 모든 수치는 텍스트로도 보여 접근성을 유지한다.

export function Stat({ label, value, tone, testId }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <span className="muted small">{label}</span>
      <strong data-testid={testId}>{value}</strong>
    </div>
  );
}

export function ProgressBar({ percent, done, total }) {
  return (
    <div>
      <div className="row between">
        <span>진행률</span>
        <strong data-testid="progress-percent">{percent}%</strong>
      </div>
      <div
        className="bar-track"
        role="progressbar"
        aria-label="진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="bar-fill bar-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="muted small">
        완료 {done} / 전체 {total}
      </span>
    </div>
  );
}

function BarRow({ label, value, max, tone = 'primary' }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track" role="presentation">
        <div
          className={`bar-fill bar-${tone}`}
          style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}

export function StatusBars({ byStatus }) {
  const max = Math.max(1, ...STATUSES.map((s) => byStatus[s]));
  return (
    <div className="bars" aria-label="상태별 작업 수">
      {STATUSES.map((s) => (
        <BarRow
          key={s}
          label={STATUS_LABELS[s]}
          value={byStatus[s]}
          max={max}
          tone={s === 'done' ? 'done' : 'primary'}
        />
      ))}
    </div>
  );
}

export function AssigneeBars({ items }) {
  if (items.length === 0) return <p className="muted small">미완료 작업이 없습니다.</p>;
  const max = Math.max(1, ...items.map((i) => i.open));
  return (
    <div className="bars" aria-label="담당자별 미완료 작업 수">
      {items.map((i) => (
        <BarRow key={i.userId ?? 'none'} label={i.name} value={i.open} max={max} />
      ))}
    </div>
  );
}

// projectId 는 전체 대시보드에서 작업이 속한 프로젝트로 이동할 때 쓴다.
export function OverdueList({ overdue, projectId }) {
  if (overdue.count === 0) return <p className="muted small">지연된 작업이 없습니다.</p>;
  return (
    <>
      <ul className="overdue-list">
        {overdue.tasks.map((t) => (
          <li key={t.id}>
            <Link to={`/projects/${t.projectId ?? projectId}?task=${t.id}`}>{t.title}</Link>
            <span className="muted small">
              {t.projectName ? `${t.projectName} · ` : ''}
              {t.assignee?.name ?? '미배정'} · 마감 {t.dueDate}
            </span>
          </li>
        ))}
      </ul>
      {overdue.count > overdue.tasks.length && (
        <p className="muted small">외 {overdue.count - overdue.tasks.length}건</p>
      )}
    </>
  );
}

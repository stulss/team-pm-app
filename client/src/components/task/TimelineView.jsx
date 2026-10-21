import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectTasks } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { STATUS_LABELS, todayString } from '../../constants/task.js';
import {
  WINDOW_DAYS,
  addDays,
  barSpan,
  openBlockers,
  scheduleConflicts,
  taskRange,
  weekStart,
  windowKeys,
} from '../../utils/timeline.js';

const rangeText = (task) => {
  const r = taskRange(task);
  return r.start === r.end ? r.start : `${r.start} ~ ${r.end}`;
};

// 시작일~마감일 막대로 보는 타임라인(간트). 선행 작업이 끝나지 않았거나 일정이 겹치면 표시한다.
export default function TimelineView({ project, params, onOpenTask }) {
  const today = todayString();
  const [from, setFrom] = useState(() => weekStart(today));

  const query = { ...params, limit: 200 };
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tasks', project.id, 'timeline', query],
    queryFn: () => listProjectTasks(project.id, query),
    placeholderData: (prev) => prev,
  });

  const tasks = data?.data ?? [];
  const keys = windowKeys(from);
  const last = keys[keys.length - 1];
  const todayIndex = keys.indexOf(today);

  const dated = tasks.filter((t) => taskRange(t));
  const undated = tasks.filter((t) => !taskRange(t));
  const rows = dated
    .map((task) => ({ task, span: barSpan(task, from) }))
    .filter((r) => r.span)
    .sort(
      (a, b) =>
        taskRange(a.task).start.localeCompare(taskRange(b.task).start) ||
        a.task.title.localeCompare(b.task.title),
    );
  const outside = dated.length - rows.length;

  return (
    <div className="timeline" aria-label="타임라인">
      <div className="row between">
        <div className="row">
          <button
            type="button"
            className="secondary"
            aria-label="이전 기간"
            onClick={() => setFrom(addDays(from, -14))}
          >
            ‹
          </button>
          <strong data-testid="timeline-title">
            {from} ~ {last}
          </strong>
          <button
            type="button"
            className="secondary"
            aria-label="다음 기간"
            onClick={() => setFrom(addDays(from, 14))}
          >
            ›
          </button>
        </div>
        <button type="button" className="secondary" onClick={() => setFrom(weekStart(today))}>
          오늘
        </button>
      </div>

      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '작업을 불러오지 못했습니다.')}
        </p>
      )}
      {data && data.meta.total > tasks.length && (
        <p className="muted small">
          작업이 많아 일부({tasks.length}개)만 표시합니다. 필터로 좁혀 보세요.
        </p>
      )}

      <div className="timeline-scroll">
        <div className="timeline-grid">
          <div className="tl-row tl-head">
            <div className="tl-label muted small">작업</div>
            <div className="tl-track tl-days" style={{ '--days': WINDOW_DAYS }}>
              {keys.map((k) => {
                const day = Number(k.slice(8));
                const weekend = [0, 6].includes(new Date(`${k}T00:00:00Z`).getUTCDay());
                return (
                  <span
                    key={k}
                    className={`tl-day${weekend ? ' weekend' : ''}${k === today ? ' today' : ''}`}
                    title={k}
                  >
                    {day === 1 ? `${Number(k.slice(5, 7))}/1` : day}
                  </span>
                );
              })}
            </div>
          </div>

          {rows.map(({ task, span }) => {
            const conflicts = scheduleConflicts(task);
            const blocked = openBlockers(task);
            return (
              <div className="tl-row" key={task.id} data-task-id={task.id}>
                <div className="tl-label">
                  <button type="button" className="linklike title" onClick={() => onOpenTask(task)}>
                    {task.title}
                  </button>
                  {blocked.length > 0 && (
                    <span
                      className="blocked-badge"
                      title={`선행 작업: ${blocked.map((b) => b.title).join(', ')}`}
                    >
                      ⛔ {blocked.length}
                    </span>
                  )}
                  {conflicts.length > 0 && (
                    <span
                      className="conflict-badge"
                      title={`일정 충돌: 선행 작업 ${conflicts.map((b) => `"${b.title}"(${b.dueDate})`).join(', ')} 의 마감이 이 작업의 시작보다 늦습니다.`}
                    >
                      ⚠ 일정 충돌
                    </span>
                  )}
                </div>
                <div className="tl-track" style={{ '--days': WINDOW_DAYS }}>
                  {todayIndex >= 0 && (
                    <span
                      className="tl-today"
                      style={{ gridColumn: `${todayIndex + 1} / ${todayIndex + 2}` }}
                    />
                  )}
                  <button
                    type="button"
                    className={`tl-bar status-${task.status}${conflicts.length ? ' conflict' : ''}${span.clippedLeft ? ' cut-left' : ''}${span.clippedRight ? ' cut-right' : ''}`}
                    style={{ gridColumn: `${span.start + 1} / ${span.end + 2}` }}
                    aria-label={`${task.title} ${rangeText(task)} ${STATUS_LABELS[task.status]}`}
                    title={`${task.title}\n${rangeText(task)} · ${STATUS_LABELS[task.status]}`}
                    onClick={() => onOpenTask(task)}
                  />
                </div>
              </div>
            );
          })}
          {rows.length === 0 && !isPending && (
            <p className="muted small tl-empty">이 기간에 걸치는 작업이 없습니다.</p>
          )}
        </div>
      </div>

      {outside > 0 && (
        <p className="muted small">이 기간 밖에 날짜가 있는 작업이 {outside}개 더 있습니다.</p>
      )}
      {undated.length > 0 && (
        <section className="stack" aria-label="날짜 없는 작업">
          <h3>날짜 없음 ({undated.length})</h3>
          <div className="cal-undated">
            {undated.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`cal-task${t.status === 'done' ? ' done' : ''}`}
                title={t.title}
                onClick={() => onOpenTask(t)}
              >
                {t.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

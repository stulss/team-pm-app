import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProjectTasks } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { isOverdue, todayString } from '../../constants/task.js';
import { dateKey, groupByDueDate, monthCells } from '../../utils/calendar.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_PER_DAY = 3;

// 마감일 기준 월간 캘린더. 마감일이 없는 작업은 아래에 따로 모아 보여 준다.
export default function CalendarView({ project, params, onOpenTask }) {
  const today = todayString();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [expanded, setExpanded] = useState(() => new Set());

  const query = { ...params, limit: 200 };
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['tasks', project.id, 'calendar', query],
    queryFn: () => listProjectTasks(project.id, query),
    placeholderData: (prev) => prev,
  });

  const tasks = data?.data ?? [];
  const { byDay, undated } = groupByDueDate(tasks);

  const move = (delta) =>
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  const cells = monthCells(cursor.year, cursor.month);
  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const chip = (t) => (
    <button
      key={t.id}
      type="button"
      className={`cal-task${t.status === 'done' ? ' done' : ''}${isOverdue(t) ? ' overdue' : ''}`}
      title={t.title}
      onClick={() => onOpenTask(t)}
    >
      {t.title}
    </button>
  );

  return (
    <div className="calendar" aria-label="캘린더">
      <div className="row between">
        <div className="row">
          <button type="button" className="secondary" aria-label="이전 달" onClick={() => move(-1)}>
            ‹
          </button>
          <strong data-testid="calendar-title">
            {cursor.year}년 {cursor.month + 1}월
          </strong>
          <button type="button" className="secondary" aria-label="다음 달" onClick={() => move(1)}>
            ›
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const now = new Date();
            setCursor({ year: now.getFullYear(), month: now.getMonth() });
          }}
        >
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

      <div className="calendar-scroll">
        <div className="calendar-grid" role="grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="cal-head" role="columnheader">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`blank-${i}`} className="cal-cell blank" />;
            const key = dateKey(cursor.year, cursor.month, day);
            const list = byDay.get(key) ?? [];
            const open = expanded.has(key);
            const shown = open ? list : list.slice(0, MAX_PER_DAY);
            return (
              <div
                key={key}
                className={`cal-cell${key === today ? ' today' : ''}`}
                role="gridcell"
                data-date={key}
              >
                <span className="cal-day">{day}</span>
                {shown.map(chip)}
                {list.length > MAX_PER_DAY && (
                  <button type="button" className="linklike small" onClick={() => toggle(key)}>
                    {open ? '접기' : `+${list.length - MAX_PER_DAY}개 더`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {undated.length > 0 && (
        <section className="stack" aria-label="마감일 없는 작업">
          <h3>마감일 없음 ({undated.length})</h3>
          <div className="cal-undated">{undated.map(chip)}</div>
        </section>
      )}
    </div>
  );
}

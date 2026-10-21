// 타임라인(간트) 계산용 순수 함수. 날짜는 'YYYY-MM-DD' 문자열이고, 시간대·서머타임에 밀리지 않도록 UTC 로 계산한다.
export const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 28;

const parse = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const format = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (key, n) => format(parse(key) + n * DAY_MS);
// b - a (일 수)
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY_MS);

// 그 날이 속한 주의 월요일.
export function weekStart(key) {
  const dow = new Date(parse(key)).getUTCDay(); // 0=일 … 6=토
  return addDays(key, -((dow + 6) % 7));
}

export const windowKeys = (start, days = WINDOW_DAYS) =>
  Array.from({ length: days }, (_, i) => addDays(start, i));

// 막대의 기간: 시작일(없으면 마감일) ~ 마감일(없으면 시작일). 날짜가 없으면 null.
export function taskRange(task) {
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  return start ? { start, end } : null;
}

// 창(windowStart 부터 days 일)에 걸치는 막대의 열 위치(0부터, 끝 포함). 창 밖이면 null.
export function barSpan(task, windowStart, days = WINDOW_DAYS) {
  const range = taskRange(task);
  if (!range) return null;
  const from = diffDays(windowStart, range.start);
  const to = diffDays(windowStart, range.end);
  if (to < 0 || from >= days) return null;
  return {
    start: Math.max(from, 0),
    end: Math.min(to, days - 1),
    clippedLeft: from < 0,
    clippedRight: to >= days,
  };
}

export const openBlockers = (task) => (task.blockedBy ?? []).filter((b) => b.status !== 'done');

// 일정 충돌: 아직 끝나지 않은 선행 작업의 마감일이 이 작업의 시작(시작일, 없으면 마감일)보다 늦다.
export function scheduleConflicts(task) {
  const range = taskRange(task);
  if (!range) return [];
  return openBlockers(task).filter((b) => b.dueDate && b.dueDate > range.start);
}

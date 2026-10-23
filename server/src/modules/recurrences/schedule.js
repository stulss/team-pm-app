// 반복 규칙의 날짜 계산. 날짜는 'YYYY-MM-DD' 문자열이고 시간대와 무관하게 달력만 다룬다.

const DAY_MS = 86_400_000;

const toDate = (ymd) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (date) => date.toISOString().slice(0, 10);

export const addDays = (ymd, days) => toYmd(new Date(toDate(ymd).getTime() + days * DAY_MS));

const daysInMonth = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// from 이상(같은 날 포함)에서 규칙에 맞는 첫 날짜. 매달 31일은 짧은 달에서 말일로 당겨진다.
export function firstOnOrAfter(rule, from) {
  if (rule.frequency === 'daily') return from;
  const start = toDate(from);
  if (rule.frequency === 'weekly') {
    return addDays(from, (rule.weekday - start.getUTCDay() + 7) % 7);
  }
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  for (;;) {
    const day = Math.min(rule.monthDay, daysInMonth(year, month));
    const candidate = toYmd(new Date(Date.UTC(year, month, day)));
    if (candidate >= from) return candidate;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
}

// today 이후(오늘은 제외)의 다음 실행일. 밀린 회차는 따라잡지 않는다.
export const nextAfter = (rule, today) => firstOnOrAfter(rule, addDays(today, 1));

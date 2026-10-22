import { setTimeFormat } from '../utils/displayFormat.js';

// 설정 선택지. 서버가 허용하는 값(server/src/modules/users/preferences.js)과 같은 목록이다(테스트가 일치를 확인한다).
export const THEMES = [
  { value: 'system', label: '시스템 설정 따르기' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

// swatch 는 선택 칩에 보여 줄 대표 색이다. 실제 적용은 styles/tokens.css 의 [data-accent] 가 한다.
export const ACCENTS = [
  { value: 'indigo', label: '인디고', swatch: '#4f46e5' },
  { value: 'blue', label: '블루', swatch: '#2563eb' },
  { value: 'teal', label: '틸', swatch: '#0d9488' },
  { value: 'green', label: '그린', swatch: '#16a34a' },
  { value: 'rose', label: '로즈', swatch: '#e11d48' },
  { value: 'orange', label: '오렌지', swatch: '#ea580c' },
];

export const DENSITIES = [
  { value: 'comfortable', label: '보통', hint: '여유 있는 간격' },
  { value: 'compact', label: '촘촘하게', hint: '한 화면에 더 많이' },
];

export const VIEWS = [
  { value: 'board', label: '보드' },
  { value: 'list', label: '목록' },
  { value: 'calendar', label: '캘린더' },
  { value: 'timeline', label: '타임라인' },
];

export const WEEK_STARTS = [
  { value: 'sun', label: '일요일' },
  { value: 'mon', label: '월요일' },
];

export const TIME_FORMATS = [
  { value: '12h', label: '12시간', hint: '오후 3:05' },
  { value: '24h', label: '24시간', hint: '15:05' },
];

// 알림 종류별 받기 여부(앱 안 알림). key 는 서버의 NOTIFICATION_KEYS 와 같다.
export const NOTIFICATIONS = [
  { value: 'assigned', label: '작업 배정', hint: '나에게 작업이 배정되면 알립니다.' },
  {
    value: 'due',
    label: '마감 임박·지연',
    hint: '내 작업의 마감이 다가오거나 지났을 때 하루 한 번 알립니다.',
  },
  {
    value: 'comment',
    label: '댓글',
    hint: '내가 맡았거나 만든 작업에 새 댓글·답글이 달리면 알립니다.',
  },
  { value: 'mention', label: '멘션', hint: '댓글이나 채팅에서 누군가 나를 @로 언급하면 알립니다.' },
];

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  accent: 'indigo',
  density: 'comfortable',
  defaultView: 'board',
  weekStart: 'sun',
  timeFormat: '12h',
  notifications: { assigned: true, due: true, comment: true, mention: true },
};

// 화면에 적용한다: <html> 의 data 속성이 CSS 토큰을 바꾼다. 로그인 전에도 깜빡임 없이 쓰려고
// 마지막 값을 localStorage 에도 두고(저장소를 못 쓰면 무시), 로그인하면 계정 값이 이긴다.
const STORAGE_KEY = 'team-pm:prefs';

export function applyPreferences(prefs, root = document.documentElement) {
  const p = { ...DEFAULT_PREFERENCES, ...prefs };
  root.dataset.theme = p.theme;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  setTimeFormat(p.timeFormat);
  return p;
}

export function loadStoredPreferences() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function storePreferences(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* 저장소를 쓸 수 없어도 동작해야 한다 */
  }
}

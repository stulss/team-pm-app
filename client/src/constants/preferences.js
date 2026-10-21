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

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  accent: 'indigo',
  density: 'comfortable',
  defaultView: 'board',
};

// 화면에 적용한다: <html> 의 data 속성이 CSS 토큰을 바꾼다. 로그인 전에도 깜빡임 없이 쓰려고
// 마지막 값을 localStorage 에도 두고(저장소를 못 쓰면 무시), 로그인하면 계정 값이 이긴다.
const STORAGE_KEY = 'team-pm:prefs';

export function applyPreferences(prefs, root = document.documentElement) {
  const p = { ...DEFAULT_PREFERENCES, ...prefs };
  root.dataset.theme = p.theme;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
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

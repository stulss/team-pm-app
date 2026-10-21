import { z } from 'zod';

// 허용하는 설정 키·값. 클라이언트의 constants/preferences.js 와 같은 목록이다(테스트가 일치를 확인한다).
export const THEMES = ['system', 'light', 'dark'];
export const ACCENTS = ['indigo', 'blue', 'teal', 'green', 'rose', 'orange'];
export const DENSITIES = ['comfortable', 'compact'];
export const VIEWS = ['board', 'list', 'calendar', 'timeline'];

export const DEFAULT_PREFERENCES = {
  theme: 'system',
  accent: 'indigo',
  density: 'comfortable',
  defaultView: 'board',
};

const ALLOWED = {
  theme: THEMES,
  accent: ACCENTS,
  density: DENSITIES,
  defaultView: VIEWS,
};

// 일부만 바꾸는 요청. 알 수 없는 키·값은 거부한다(임의 JSON 저장 방지).
export const preferencesPatch = z
  .strictObject({
    theme: z.enum(THEMES).optional(),
    accent: z.enum(ACCENTS).optional(),
    density: z.enum(DENSITIES).optional(),
    defaultView: z.enum(VIEWS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 항목이 없습니다.' });

// 저장된 값에 기본값을 채운다. 허용 목록에 없는 값(과거 값 등)은 기본값으로 대체한다.
export function withDefaults(stored) {
  const out = { ...DEFAULT_PREFERENCES };
  for (const [key, allowed] of Object.entries(ALLOWED)) {
    if (allowed.includes(stored?.[key])) out[key] = stored[key];
  }
  return out;
}

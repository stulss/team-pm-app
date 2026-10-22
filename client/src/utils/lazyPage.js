import { lazy } from 'react';

const RELOAD_KEY = 'chunk-reload-at';
const RELOAD_WINDOW_MS = 10_000;

// 페이지를 필요할 때 내려받는 lazy 컴포넌트. 새 버전을 배포하면 열어 둔 탭이 가진 이전 파일 이름이 사라져
// 내려받기가 실패한다 — 그때는 한 번만 새로고침해 새 버전을 받는다(새로고침 직후에도 실패하면 오류를 그대로 보인다).
export function lazyPage(load) {
  return lazy(() =>
    load().catch((err) => {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (Date.now() - last > RELOAD_WINDOW_MS) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return new Promise(() => {}); // 새로고침되는 동안 대기
        }
      } catch {
        // sessionStorage 를 못 쓰는 환경이면 새로고침하지 않고 오류를 보인다
      }
      throw err;
    }),
  );
}

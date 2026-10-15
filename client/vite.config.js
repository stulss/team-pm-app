import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    // 배포(동일 오리진)와 같은 경로 구조를 로컬에서도 유지한다.
    proxy: {
      '/api': { target, ws: true },
    },
  },
});

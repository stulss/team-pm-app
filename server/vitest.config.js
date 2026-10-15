import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0123456789',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-0123456789',
    },
  },
});

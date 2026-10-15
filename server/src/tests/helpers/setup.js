// 인증 테스트 공용 헬퍼. (vi.mock 은 호이스팅 때문에 각 테스트 파일에서 직접 호출한다.)
import request from 'supertest';

export const PASSWORD = 'S3cure!pass';

export const cookieOf = (res) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='));

// "refresh_token=abc; Path=..." → "refresh_token=abc"
export const cookieHeader = (res) => cookieOf(res)?.split(';')[0];

export async function register(app, overrides = {}) {
  const body = { email: 'jiho@example.com', password: PASSWORD, name: '지호', ...overrides };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  return { res, body };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

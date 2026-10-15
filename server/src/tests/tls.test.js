import { X509Certificate } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { buildSsl } from '../config/ssl.js';
import { SUPABASE_CA } from '../config/supabaseCa.js';

const { normalizeDbUrl } = await import('../config/env.js');

describe('buildSsl', () => {
  const remote = 'postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

  it('로컬 DB 는 TLS 를 쓰지 않는다', () => {
    expect(buildSsl('postgres://u:p@localhost:5432/db')).toBeUndefined();
    expect(buildSsl('postgres://u:p@127.0.0.1:5432/db')).toBeUndefined();
  });

  it('원격 DB 는 내장한 Supabase CA 로 서버 인증서를 검증한다 (기본)', () => {
    const ssl = buildSsl(remote);
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toBe(SUPABASE_CA);
  });

  it('DB_SSL_VERIFY=false 비상 스위치: 암호화만 하고 검증하지 않는다', () => {
    expect(buildSsl(remote, false)).toEqual({ rejectUnauthorized: false });
  });
});

describe('내장 Supabase CA', () => {
  it('유효한 CA 인증서이고 알려진 지문과 같다(변조 방지)', () => {
    const cert = new X509Certificate(SUPABASE_CA);
    expect(cert.ca).toBe(true);
    expect(cert.subject).toContain('Supabase Root 2021 CA');
    expect(cert.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    );
  });

  it('만료까지 1년 넘게 남아 있다 (교체 시점을 놓치지 않도록)', () => {
    const cert = new X509Certificate(SUPABASE_CA);
    const daysLeft = (new Date(cert.validTo).getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(365);
  });
});

describe('normalizeDbUrl', () => {
  it('sslmode / supa / pgbouncer 를 제거하고 나머지는 유지한다', () => {
    const out = normalizeDbUrl(
      'postgres://u:p@host.example.com:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true&application_name=app',
    );
    const u = new URL(out);
    expect(u.searchParams.has('sslmode')).toBe(false);
    expect(u.searchParams.has('supa')).toBe(false);
    expect(u.searchParams.has('pgbouncer')).toBe(false);
    expect(u.searchParams.get('application_name')).toBe('app');
  });

  it('빈 값은 그대로', () => {
    expect(normalizeDbUrl(undefined)).toBeUndefined();
  });
});

import { SUPABASE_CA } from './supabaseCa.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

// DB 연결의 TLS 설정. 로컬 DB 는 TLS 없음, 그 외(Supabase)는 내장한 Supabase CA 로 서버 인증서를 검증한다.
// verify=false 는 비상용 스위치다(DB_SSL_VERIFY=false): 암호화는 유지하지만 서버 신원은 확인하지 않는다.
export function buildSsl(connectionString, verify = true) {
  const { hostname } = new URL(connectionString);
  if (LOCAL_HOSTS.includes(hostname)) return undefined;
  return verify ? { ca: SUPABASE_CA, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

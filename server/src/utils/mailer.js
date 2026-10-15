import { env } from '../config/env.js';
import { logger } from './logger.js';

// 메일은 Brevo 트랜잭션 API(무료 플랜)로 보낸다. BREVO_API_KEY 와 MAIL_FROM 이 모두 있어야 켜진다.
// 꺼져 있으면 이메일 인증을 요구하지 않고(가입 즉시 사용), 비밀번호 재설정 메일도 나가지 않는다.
export const mailEnabled = () => Boolean(env.BREVO_API_KEY && env.MAIL_FROM);

// RFC 2606 예약 도메인(.test 등)은 실제로 존재할 수 없다. 스모크/e2e 테스트 계정이 실제 발송 한도와
// 발신 평판을 쓰지 않도록 보내지 않는다.
const RESERVED = /\.(test|invalid|example|localhost)$/i;
export const isDeliverable = (to) => !RESERVED.test(to.split('@').pop() ?? '');

const SEND_TIMEOUT_MS = 8000;

// 성공하면 true, 보내지 않았으면(꺼짐/예약 도메인) false. 전송 실패는 예외로 던진다.
// 서버리스는 응답을 끝내면 실행이 멈출 수 있어서 호출하는 쪽이 await 해야 한다.
export async function sendMail({ to, subject, text, html }) {
  if (!mailEnabled() || !isDeliverable(to)) return false;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    // 응답 본문에는 수신자 주소가 들어 있을 수 있어 상태 코드만 남긴다.
    throw new Error(`mail provider responded ${res.status}`);
  }
  logger.info({ subject }, 'mail sent');
  return true;
}

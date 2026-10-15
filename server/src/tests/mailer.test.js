import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubEnv('BREVO_API_KEY', 'test-brevo-key');
vi.stubEnv('MAIL_FROM', 'noreply@example.org');
vi.stubEnv('APP_URL', 'https://pm.example.org/');

vi.mock('../config/db.js', () => ({ query: vi.fn(), pool: {}, withTransaction: (fn) => fn({}) }));

const { sendMail, mailEnabled, isDeliverable } = await import('../utils/mailer.js');
const { verifyEmailMessage, resetPasswordMessage, appUrl } =
  await import('../utils/mailTemplates.js');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendMail', () => {
  it('Brevo API 키와 발신 주소가 있으면 켜진다', () => {
    expect(mailEnabled()).toBe(true);
  });

  it('Brevo 트랜잭션 API 로 키를 헤더에 담아 보낸다', async () => {
    const sent = await sendMail({
      to: 'a@real.org',
      subject: '제목',
      text: '본문',
      html: '<p>x</p>',
    });
    expect(sent).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-brevo-key');
    expect(JSON.parse(init.body)).toMatchObject({
      sender: { email: 'noreply@example.org', name: 'Team PM' },
      to: [{ email: 'a@real.org' }],
      subject: '제목',
      textContent: '본문',
    });
  });

  it('예약 도메인(.test 등)으로는 실제 발송하지 않는다', async () => {
    expect(isDeliverable('smoke-1@example.test')).toBe(false);
    expect(isDeliverable('x@foo.invalid')).toBe(false);
    expect(isDeliverable('x@real.org')).toBe(true);
    expect(await sendMail({ to: 'smoke@example.test', subject: 's', text: 't' })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('제공자 오류는 상태 코드만 담아 던진다(응답 본문을 노출하지 않음)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'secret detail a@real.org',
    });
    const err = await sendMail({ to: 'a@real.org', subject: 's', text: 't' }).catch((e) => e);
    expect(err.message).toBe('mail provider responded 401');
  });
});

describe('메일 템플릿', () => {
  it('링크는 설정한 APP_URL 로만 만들고 토큰은 URL 인코딩한다', () => {
    expect(appUrl()).toBe('https://pm.example.org');
    expect(verifyEmailMessage('지호', 'a+b/c').text).toContain(
      'https://pm.example.org/verify-email?token=a%2Bb%2Fc',
    );
    expect(resetPasswordMessage('지호', 'tok').text).toContain(
      'https://pm.example.org/reset-password?token=tok',
    );
  });

  it('이름의 HTML 은 이스케이프한다', () => {
    const m = verifyEmailMessage('<script>x</script>', 'tok');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});

import { env } from '../config/env.js';

// 링크는 요청 헤더가 아니라 설정값으로만 만든다(Host 헤더 조작으로 링크가 바뀌지 않게).
export function appUrl() {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return env.CLIENT_ORIGIN?.replace(/\/$/, '') || 'http://localhost:5173';
}

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function layout({ title, intro, buttonLabel, link, outro }) {
  const text = `${title}\n\n${intro}\n\n${buttonLabel}: ${link}\n\n${outro}\n`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h2>${escapeHtml(title)}</h2>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(buttonLabel)}</a></p>
<p style="color:#555;font-size:13px">버튼이 열리지 않으면 아래 주소를 브라우저에 붙여 넣으세요.<br>${escapeHtml(link)}</p>
<p style="color:#555;font-size:13px">${escapeHtml(outro)}</p></div>`;
  return { text, html };
}

export function resetPasswordMessage(name, token) {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: '[Team PM] 비밀번호 재설정 안내',
    ...layout({
      title: '비밀번호 재설정',
      intro: `${name}님, 비밀번호 재설정을 요청하셨습니다. 아래 버튼으로 새 비밀번호를 설정하세요. 링크는 1시간 동안 유효하며 한 번만 쓸 수 있습니다.`,
      buttonLabel: '비밀번호 재설정하기',
      link,
      outro: '요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않습니다.',
    }),
  };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---- 저장소 이름 ----
export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// 'owner/repo', 'https://github.com/owner/repo', '…/repo.git', '…/repo/pull/1' 모두 owner/repo 로 정리한다. 형식이 틀리면 null.
export function normalizeRepo(input) {
  let text = String(input ?? '').trim();
  text = text.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  const [owner, repo] = text.split('/');
  if (!owner || !repo) return null;
  const full = `${owner}/${repo.replace(/\.git$/i, '')}`;
  return REPO_PATTERN.test(full) && full.length <= 140 ? full : null;
}

// ---- 작업 키 찾기 ----
// 텍스트에서 이 프로젝트 키(예: TPM)의 작업 번호를 모두 찾는다. 대소문자 무시, 다른 글자와 붙어 있으면 제외
// (예: "XTPM-1", "TPM-12abc" 는 아님). 중복 없이 오름차순.
export function extractNumbers(text, projectKey) {
  if (!text || !projectKey) return [];
  const escaped = projectKey.replace(/[^A-Za-z0-9]/g, '');
  const re = new RegExp(`(?<![A-Za-z0-9])${escaped}-(\\d{1,6})(?![A-Za-z0-9])`, 'gi');
  const found = new Set();
  for (const m of String(text).matchAll(re)) {
    const n = Number(m[1]);
    if (n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

// 여러 텍스트(제목·본문·브랜치 이름…)에서 한꺼번에 찾는다.
export const extractNumbersFrom = (texts, projectKey) =>
  [...new Set(texts.flatMap((t) => extractNumbers(t, projectKey)))].sort((a, b) => a - b);

// ---- PR 상태 ----
export function prState(pr) {
  if (pr?.merged === true || pr?.merged_at) return 'merged';
  if (pr?.state === 'closed') return 'closed';
  if (pr?.draft === true) return 'draft';
  return 'open';
}

// ---- 웹훅 서명 ----
// 비밀은 저장하지 않고 서버 비밀과 (연결 id, 버전) 에서 계산한다. 버전을 올리면 이전 비밀은 즉시 무효가 된다.
export function webhookSecret(connection, serverSecret) {
  return createHmac('sha256', serverSecret)
    .update(`github-webhook:v${connection.secret_version}:${connection.id}`)
    .digest('hex');
}

// X-Hub-Signature-256 ("sha256=<hex>") 를 원문 바이트로 검증한다(상수 시간 비교).
export function verifySignature(secret, rawBody, header) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const signBody = (secret, rawBody) =>
  `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

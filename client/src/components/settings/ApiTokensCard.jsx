import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/http.js';
import { createApiToken, listApiTokens, revokeApiToken } from '../../api/apiTokens.js';
import { formatWhen } from '../../constants/activity.js';

// 개인 API 토큰. AI 클라이언트(MCP)나 스크립트가 내 권한으로 이 앱을 쓰게 한다. 값은 만든 직후에만 보인다.
const TOKEN_SCOPES = [
  { value: 'read', label: '읽기 전용', hint: '조회만 할 수 있습니다.' },
  { value: 'write', label: '읽기 + 쓰기', hint: '작업·댓글을 만들고 바꿀 수 있습니다.' },
];
const TOKEN_EXPIRIES = [
  { value: '30', label: '30일' },
  { value: '90', label: '90일' },
  { value: '', label: '만료 없음' },
];

export default function ApiTokensCard() {
  const queryClient = useQueryClient();
  const key = ['api-tokens'];
  const { data } = useQuery({ queryKey: key, queryFn: listApiTokens });
  const [form, setForm] = useState({ name: '', scope: 'read', expires: '90' });
  const [created, setCreated] = useState(null); // 방금 만든 토큰(값 포함)
  const [copied, setCopied] = useState(false);
  const origin = window.location.origin;

  const create = useMutation({
    mutationFn: () =>
      createApiToken({
        name: form.name,
        scope: form.scope,
        expiresInDays: form.expires ? Number(form.expires) : null,
      }),
    onSuccess: (token) => {
      setCreated(token);
      setCopied(false);
      setForm((f) => ({ ...f, name: '' }));
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeApiToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false); // 클립보드를 못 쓰면 직접 선택해서 복사한다
    }
  };
  const remove = (t) => {
    if (!window.confirm(`“${t.name}” 토큰을 폐기할까요? 이 토큰을 쓰는 연결은 바로 끊깁니다.`))
      return;
    if (created?.id === t.id) setCreated(null);
    revoke.mutate(t.id);
  };
  const submit = (e) => {
    e.preventDefault();
    if (form.name.trim()) create.mutate();
  };
  const error = [create, revoke].find((m) => m.isError)?.error;
  const tokens = data ?? [];

  return (
    <section className="card settings-card" id="api" aria-label="API 토큰">
      <h2>API 토큰</h2>
      <p className="muted">
        AI 클라이언트(Claude 등)나 스크립트가 내 계정의 권한으로 작업을 읽고 쓰게 합니다. 토큰으로
        한 일은 활동 기록에 토큰 이름과 함께 남습니다. 계정·보안 설정은 토큰으로 바꿀 수 없습니다.
      </p>

      <form className="stack settings-form" onSubmit={submit}>
        <label>
          토큰 이름
          <input
            type="text"
            maxLength={60}
            placeholder="예: Claude 데스크톱"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <label>
          권한
          <select
            value={form.scope}
            onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
          >
            {TOKEN_SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.hint}
              </option>
            ))}
          </select>
        </label>
        <label>
          만료
          <select
            value={form.expires}
            onChange={(e) => setForm((f) => ({ ...f, expires: e.target.value }))}
          >
            {TOKEN_EXPIRIES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {errorMessage(error, '처리하지 못했습니다.')}
          </p>
        )}
        <div className="row">
          <button type="submit" disabled={!form.name.trim() || create.isPending}>
            {create.isPending ? '만드는 중…' : '토큰 만들기'}
          </button>
        </div>
      </form>

      {created && (
        <div className="token-reveal" role="status">
          <p>
            <strong>“{created.name}” 토큰을 만들었습니다.</strong> 이 값은 지금만 볼 수 있으니
            안전한 곳에 복사해 두세요.
          </p>
          <code className="token-value" data-testid="new-api-token">
            {created.token}
          </code>
          <div className="row">
            <button type="button" className="secondary" onClick={copy}>
              {copied ? '복사됨' : '복사'}
            </button>
            <button type="button" className="secondary" onClick={() => setCreated(null)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="session-list">
          {tokens.map((t) => {
            const expired = t.expiresAt && new Date(t.expiresAt) <= new Date();
            return (
              <li key={t.id} className="session-item">
                <div>
                  <strong>{t.name}</strong>
                  <span className="badge">{t.scope === 'write' ? '읽기+쓰기' : '읽기 전용'}</span>
                  {expired && <span className="badge">만료됨</span>}
                  <span className="muted small">
                    {t.prefix}… · {t.expiresAt ? `만료 ${t.expiresAt.slice(0, 10)}` : '만료 없음'} ·{' '}
                    {t.lastUsedAt ? `마지막 사용 ${formatWhen(t.lastUsedAt)}` : '아직 사용 안 함'}
                  </span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={revoke.isPending}
                  aria-label={`${t.name} 토큰 폐기`}
                  onClick={() => remove(t)}
                >
                  폐기
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <details className="token-help">
        <summary>연결 방법</summary>
        <p className="muted small">
          MCP 를 지원하는 AI 클라이언트에는 아래 주소와 헤더를 넣으세요. 도구는 프로젝트·작업 조회와
          검색, 작업 생성·수정·이동, 댓글 작성입니다(읽기 전용 토큰은 조회 도구만 보입니다).
        </p>
        <pre className="token-snippet">{`# Claude Code
claude mcp add --transport http team-pm ${origin}/api/mcp \\
  --header "Authorization: Bearer <토큰>"`}</pre>
        <p className="muted small">REST API 는 같은 헤더로 직접 호출할 수도 있습니다.</p>
        <pre className="token-snippet">{`curl -H "Authorization: Bearer <토큰>" ${origin}/api/v1/projects`}</pre>
      </details>
    </section>
  );
}

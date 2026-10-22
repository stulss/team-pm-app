import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, updateMySettings } from '../api/projects.js';
import Avatar from '../components/common/Avatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, http } from '../api/http.js';
import { githubErrorMessage } from '../constants/githubLogin.js';
import { describeDevice } from '../constants/device.js';
import { createApiToken, listApiTokens, revokeApiToken } from '../api/apiTokens.js';
import { formatWhen } from '../constants/activity.js';
import {
  ACCENTS,
  DENSITIES,
  NOTIFICATIONS,
  THEMES,
  TIME_FORMATS,
  VIEWS,
  WEEK_STARTS,
} from '../constants/preferences.js';

// 선택지 하나가 라디오 버튼인 그룹. 고르면 바로 적용·저장된다.
function ChoiceGroup({ label, name, options, value, onChange, render }) {
  return (
    <fieldset className="choice-group" aria-label={label}>
      {options.map((o) => (
        <label key={o.value} className="choice">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {render ? render(o) : o.label}
        </label>
      ))}
    </fieldset>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// 알림 종류별 받기/끄기. 켜고 끄는 즉시 저장된다(서버가 끈 종류의 알림은 만들지 않는다).
function NotificationCard() {
  const { user, savePreferences } = useAuth();
  const current = user.preferences.notifications;
  const [state, setState] = useState({ error: '', saved: false });

  const toggle = async (key, value) => {
    setState({ error: '', saved: false });
    try {
      await savePreferences({ notifications: { [key]: value } });
      setState({ error: '', saved: true });
    } catch (err) {
      setState({ error: errorMessage(err, '설정을 저장하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="notifications" aria-label="알림">
      <div className="card-head">
        <h2>알림</h2>
        <span role="status" className="save-state">
          {state.saved ? '저장했습니다.' : ''}
        </span>
      </div>
      <p className="muted">
        끈 종류의 알림은 새로 만들어지지 않습니다. 이미 받은 알림은 그대로 남습니다.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {NOTIFICATIONS.map((n) => (
        <Row key={n.value} title={n.label} hint={n.hint}>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={`${n.label} 알림 받기`}
              checked={current[n.value]}
              onChange={(e) => toggle(n.value, e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            <span>{current[n.value] ? '받는 중' : '꺼짐'}</span>
          </label>
        </Row>
      ))}
    </section>
  );
}

// 프로젝트별 개인 설정: 목록·사이드바 상단 고정, 알림 음소거. 켜고 끄는 즉시 저장된다.
function ProjectsCard() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['projects', 'settings'],
    queryFn: () => listProjects({ limit: 100 }),
  });
  const save = useMutation({
    mutationFn: ({ id, patch }) => updateMySettings(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
    },
  });
  const projects = (data?.data ?? []).filter((p) => p.mySettings);

  return (
    <section className="card settings-card" id="projects" aria-label="프로젝트">
      <h2>프로젝트</h2>
      <p className="muted">
        고정한 프로젝트는 목록과 사이드바 맨 위에 보입니다. 알림을 끈 프로젝트의 알림(배정·댓글·
        멘션·마감)은 나에게 새로 만들어지지 않습니다. 다른 멤버에게는 영향이 없습니다.
      </p>
      {isPending && <span className="skeleton" style={{ height: 40 }} />}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '프로젝트를 불러오지 못했습니다.')}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="error">
          {errorMessage(save.error, '설정을 저장하지 못했습니다.')}
        </p>
      )}
      {data && projects.length === 0 && <p className="muted">참여 중인 프로젝트가 없습니다.</p>}
      <ul className="project-settings">
        {projects.map((p) => (
          <li key={p.id} data-project-id={p.id}>
            <Avatar name={p.name} shape="square" />
            <span className="project-settings-name">
              {p.name}
              {p.status === 'archived' && <span className="badge badge-archived">보관됨</span>}
            </span>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`${p.name} 고정`}
                checked={p.mySettings.pinned}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ id: p.id, patch: { pinned: e.target.checked } })}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>고정</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`${p.name} 알림 끄기`}
                checked={p.mySettings.muted}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ id: p.id, patch: { muted: e.target.checked } })}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>알림 끄기</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileCard() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [state, setState] = useState({ busy: false, error: '', saved: false });

  const dirty = name.trim() !== user.name && name.trim().length > 0;
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, error: '', saved: false });
    try {
      await updateProfile({ name: name.trim() });
      setState({ busy: false, error: '', saved: true });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '저장하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="profile" aria-label="프로필">
      <h2>프로필</h2>
      <form className="stack settings-form" onSubmit={submit}>
        <label>
          이름
          <input
            required
            maxLength={50}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setState((s) => ({ ...s, saved: false }));
            }}
          />
        </label>
        <label>
          이메일
          <input value={user.email} readOnly disabled />
        </label>
        <p className="muted small">
          역할: <span className={`role role-${user.role}`}>{user.role}</span> (역할은 관리자가 바꿀
          수 있습니다)
        </p>
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        <div className="row">
          <button type="submit" disabled={!dirty || state.busy}>
            {state.busy ? '저장 중…' : '이름 저장'}
          </button>
          {state.saved && (
            <span role="status" className="save-state">
              저장했습니다.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

// 내 데이터 내려받기와 계정 삭제(탈퇴). 삭제는 이메일을 직접 입력해야 눌린다.
function DataCard() {
  const { user, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [form, setForm] = useState({ email: '', password: '' });
  const [del, setDel] = useState({ busy: false, error: '' });
  const needsPassword = user.emailLogin !== false;
  const canDelete =
    form.email.trim().toLowerCase() === user.email && (!needsPassword || form.password.length > 0);

  const download = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await http.get('/users/me/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `team-pm-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(errorMessage(err, '내려받지 못했습니다.'));
    } finally {
      setExporting(false);
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    if (!canDelete) return;
    if (!window.confirm('계정을 삭제할까요? 되돌릴 수 없습니다.')) return;
    setDel({ busy: true, error: '' });
    try {
      await http.delete('/users/me', {
        data: {
          confirmEmail: form.email,
          currentPassword: needsPassword ? form.password : undefined,
        },
      });
      await logout();
    } catch (err) {
      setDel({ busy: false, error: errorMessage(err, '삭제하지 못했습니다.') });
    }
  };

  return (
    <section className="card settings-card" id="data" aria-label="내 데이터">
      <h2>내 데이터</h2>
      <Row
        title="내 데이터 내려받기"
        hint="프로필, 소속 프로젝트, 내가 맡았거나 만든 작업, 내가 쓴 댓글을 JSON 파일로 받습니다."
      >
        <button type="button" className="secondary" disabled={exporting} onClick={download}>
          {exporting ? '준비 중…' : 'JSON 으로 내려받기'}
        </button>
        {exportError && (
          <p role="alert" className="error">
            {exportError}
          </p>
        )}
      </Row>
      <form className="stack settings-form danger-zone" onSubmit={remove}>
        <h3>계정 삭제</h3>
        <p className="muted small">
          계정은 되돌릴 수 없게 비활성화되고 이메일·이름이 지워집니다. 내가 쓴 작업과 댓글은 “탈퇴한
          사용자”로 남고, 프로젝트 소속과 알림은 사라집니다. 소유한 프로젝트가 있으면 먼저 삭제해야
          합니다.
        </p>
        <label>
          확인을 위해 내 이메일({user.email})을 입력하세요
          <input
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        {needsPassword && (
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
        )}
        {del.error && (
          <p role="alert" className="error">
            {del.error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="danger" disabled={!canDelete || del.busy}>
            {del.busy ? '삭제 중…' : '계정 삭제'}
          </button>
        </div>
      </form>
    </section>
  );
}

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

function ApiTokensCard() {
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

// 로그인한 기기 목록. 기기별로, 또는 지금 기기만 남기고 모두 로그아웃한다.
function SessionsCard() {
  const queryClient = useQueryClient();
  const key = ['sessions'];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => http.get('/auth/sessions').then((res) => res.data.data),
  });
  const [notice, setNotice] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const revoke = useMutation({
    mutationFn: (id) => http.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      setNotice('');
      refresh();
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => http.delete('/auth/sessions').then((res) => res.data),
    onSuccess: ({ revoked }) => {
      setNotice(`${revoked}개 기기에서 로그아웃했습니다.`);
      refresh();
    },
  });

  const sessions = data ?? [];
  const others = sessions.filter((s) => !s.current);
  const error = [revoke, revokeOthers].find((m) => m.isError)?.error;

  return (
    <section className="card settings-card" id="sessions" aria-label="로그인한 기기">
      <h2>로그인한 기기</h2>
      <p className="muted">
        내 계정에 로그인된 기기입니다. 모르는 기기가 있으면 로그아웃하고 비밀번호를 바꾸세요.
        로그아웃된 기기는 최대 15분 안에 접근이 끊깁니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {errorMessage(error, '처리하지 못했습니다.')}
        </p>
      )}
      {notice && (
        <p role="status" className="save-state">
          {notice}
        </p>
      )}
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id} className="session-item">
            <div>
              <strong>{describeDevice(s.device)}</strong>
              {s.current && <span className="badge session-current">지금 기기</span>}
              <span className="muted small">
                {s.ip ? `${s.ip} · ` : ''}마지막 사용 {formatWhen(s.lastUsedAt)}
              </span>
            </div>
            {!s.current && (
              <button
                type="button"
                className="secondary"
                disabled={revoke.isPending}
                aria-label={`${describeDevice(s.device)} 로그아웃`}
                onClick={() => revoke.mutate(s.id)}
              >
                로그아웃
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <div className="row">
          <button
            type="button"
            className="danger"
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate()}
          >
            다른 모든 기기에서 로그아웃
          </button>
        </div>
      )}
    </section>
  );
}

// 이메일 계정에 GitHub 계정을 연결·해제한다. 연결하면 GitHub 로 로그인할 수 있다.
function GithubAccountCard() {
  const { user, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const result = params.get('github');
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => http.get('/auth/providers').then((res) => res.data),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const [state, setState] = useState({ busy: false, error: '' });

  const linkedNow = result === 'linked';
  const flash = result ? githubErrorMessage(result) : '';

  const connect = async () => {
    setState({ busy: true, error: '' });
    try {
      const { data } = await http.post('/auth/github/link');
      window.location.assign(data.url);
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '연결을 시작하지 못했습니다.') });
    }
  };
  const disconnect = async () => {
    if (
      !window.confirm('GitHub 계정 연결을 해제할까요? 이후에는 이메일과 비밀번호로만 로그인합니다.')
    )
      return;
    setState({ busy: true, error: '' });
    try {
      await http.delete('/auth/github');
      setParams({}, { replace: true });
      await refreshUser();
      setState({ busy: false, error: '' });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '해제하지 못했습니다.') });
    }
  };

  // 서버에 GitHub 로그인이 꺼져 있고 연결된 것도 없으면 보여 줄 게 없다
  if (!providers.data?.github && !user.githubLogin) return null;

  return (
    <section className="card settings-card" id="github" aria-label="GitHub 계정">
      <h2>GitHub 계정</h2>
      <p className="muted">
        연결하면 로그인 화면에서 “GitHub 로 계속하기”로 이 계정에 로그인할 수 있습니다.
      </p>
      {flash && (
        <p role={linkedNow ? 'status' : 'alert'} className={linkedNow ? 'save-state' : 'error'}>
          {flash}
        </p>
      )}
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {user.githubLogin ? (
        <div className="row">
          <span>
            <strong>@{user.githubLogin}</strong> 연결됨
          </span>
          <button type="button" className="secondary" disabled={state.busy} onClick={disconnect}>
            연결 해제
          </button>
        </div>
      ) : (
        <div className="row">
          <button type="button" disabled={state.busy} onClick={connect}>
            {state.busy ? '이동 중…' : 'GitHub 계정 연결'}
          </button>
        </div>
      )}
      {user.githubLogin && !user.emailLogin && (
        <p className="muted small">
          GitHub 로 가입한 계정이라 비밀번호가 없습니다. 연결을 해제하려면 로그인 화면의 “비밀번호
          찾기”로 먼저 비밀번호를 설정해 주세요.
        </p>
      )}
    </section>
  );
}

function PasswordCard() {
  const { updateProfile } = useAuth();
  const empty = { current: '', next: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [state, setState] = useState({ busy: false, error: '', saved: false });
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setState((s) => ({ ...s, saved: false }));
  };

  const mismatch = form.confirm.length > 0 && form.next !== form.confirm;
  const valid = form.current && form.next.length >= 8 && form.next === form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setState({ busy: true, error: '', saved: false });
    try {
      await updateProfile({ currentPassword: form.current, newPassword: form.next });
      setForm(empty);
      setState({ busy: false, error: '', saved: true });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, '변경하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="security" aria-label="보안">
      <h2>보안</h2>
      <p className="muted">
        비밀번호를 바꾸면 다른 기기의 로그인은 모두 종료되고, 지금 기기만 로그인 상태로 남습니다.
      </p>
      <form className="stack settings-form" onSubmit={submit}>
        <label>
          현재 비밀번호
          <input
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={set('current')}
          />
        </label>
        <label>
          새 비밀번호 (8자 이상)
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={form.next}
            onChange={set('next')}
          />
        </label>
        <label>
          새 비밀번호 확인
          <input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={set('confirm')}
          />
        </label>
        {mismatch && (
          <p role="alert" className="error">
            새 비밀번호가 서로 다릅니다.
          </p>
        )}
        {state.error && (
          <p role="alert" className="error">
            {state.error}
          </p>
        )}
        <div className="row">
          <button type="submit" disabled={!valid || state.busy}>
            {state.busy ? '변경 중…' : '비밀번호 변경'}
          </button>
          {state.saved && (
            <span role="status" className="save-state">
              비밀번호를 바꿨습니다.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function AppearanceCard() {
  const { user, savePreferences } = useAuth();
  const prefs = user.preferences;
  const [state, setState] = useState({ error: '', saved: false });

  const save = async (patch) => {
    setState({ error: '', saved: false });
    try {
      await savePreferences(patch);
      setState({ error: '', saved: true });
    } catch (err) {
      setState({ error: errorMessage(err, '설정을 저장하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="appearance" aria-label="화면">
      <div className="card-head">
        <h2>화면</h2>
        <span role="status" className="save-state">
          {state.saved ? '저장했습니다.' : ''}
        </span>
      </div>
      <p className="muted">계정에 저장되어 다른 기기에서도 같게 보입니다.</p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <Row title="테마" hint="밝은 화면, 어두운 화면, 또는 운영체제 설정을 따릅니다.">
        <ChoiceGroup
          label="테마"
          name="theme"
          options={THEMES}
          value={prefs.theme}
          onChange={(theme) => save({ theme })}
        />
      </Row>
      <Row title="포인트 색" hint="버튼·선택 표시·링크에 쓰는 색입니다.">
        <ChoiceGroup
          label="포인트 색"
          name="accent"
          options={ACCENTS}
          value={prefs.accent}
          onChange={(accent) => save({ accent })}
          render={(o) => (
            <>
              <span className="swatch" style={{ '--sw': o.swatch }} aria-hidden="true" />
              {o.label}
            </>
          )}
        />
      </Row>
      <Row title="밀도" hint="글자와 간격 크기를 정합니다.">
        <ChoiceGroup
          label="밀도"
          name="density"
          options={DENSITIES}
          value={prefs.density}
          onChange={(density) => save({ density })}
          render={(o) => (
            <>
              {o.label} <small>{o.hint}</small>
            </>
          )}
        />
      </Row>
      <Row title="한 주의 시작" hint="캘린더에서 한 주가 시작되는 요일입니다.">
        <ChoiceGroup
          label="한 주의 시작"
          name="weekStart"
          options={WEEK_STARTS}
          value={prefs.weekStart}
          onChange={(weekStart) => save({ weekStart })}
        />
      </Row>
      <Row title="시각 표기" hint="활동·댓글·알림에 보이는 시각의 표기 방식입니다.">
        <ChoiceGroup
          label="시각 표기"
          name="timeFormat"
          options={TIME_FORMATS}
          value={prefs.timeFormat}
          onChange={(timeFormat) => save({ timeFormat })}
          render={(o) => (
            <>
              {o.label} <small>{o.hint}</small>
            </>
          )}
        />
      </Row>
      <Row title="기본 작업 보기" hint="프로젝트를 열 때 처음 보이는 보기입니다.">
        <ChoiceGroup
          label="기본 작업 보기"
          name="defaultView"
          options={VIEWS}
          value={prefs.defaultView}
          onChange={(defaultView) => save({ defaultView })}
        />
      </Row>
    </section>
  );
}

// 내 설정 페이지. 항목은 카드 단위로 나뉘고, 왼쪽 목록(좁은 화면에서는 위쪽)으로 바로 이동한다.
export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>설정</h1>
          <p className="muted">내 프로필, 화면, 알림, 프로젝트, 보안을 관리합니다.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="설정 항목">
          <a href="#profile">프로필</a>
          <a href="#appearance">화면</a>
          <a href="#notifications">알림</a>
          <a href="#projects">프로젝트</a>
          <a href="#security">보안</a>
          <a href="#sessions">기기</a>
          <a href="#api">API 토큰</a>
          <a href="#github">GitHub</a>
          <a href="#data">내 데이터</a>
        </nav>
        <div className="settings-content">
          <ProfileCard />
          <AppearanceCard />
          <NotificationCard />
          <ProjectsCard />
          <PasswordCard />
          <SessionsCard />
          <ApiTokensCard />
          <GithubAccountCard />
          <DataCard />
        </div>
      </div>
    </>
  );
}

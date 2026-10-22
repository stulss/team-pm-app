import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, updateMySettings } from '../api/projects.js';
import Avatar from '../components/common/Avatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, http } from '../api/http.js';
import { githubErrorMessage } from '../constants/githubLogin.js';
import { ACCENTS, DENSITIES, NOTIFICATIONS, THEMES, VIEWS } from '../constants/preferences.js';

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
          <a href="#github">GitHub</a>
        </nav>
        <div className="settings-content">
          <ProfileCard />
          <AppearanceCard />
          <NotificationCard />
          <ProjectsCard />
          <PasswordCard />
          <GithubAccountCard />
        </div>
      </div>
    </>
  );
}

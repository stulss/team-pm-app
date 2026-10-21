import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/http.js';
import { ACCENTS, DENSITIES, THEMES, VIEWS } from '../constants/preferences.js';

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
          <p className="muted">내 프로필, 화면, 보안을 관리합니다.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="설정 항목">
          <a href="#profile">프로필</a>
          <a href="#appearance">화면</a>
          <a href="#security">보안</a>
        </nav>
        <div className="settings-content">
          <ProfileCard />
          <AppearanceCard />
          <PasswordCard />
        </div>
      </div>
    </>
  );
}

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../api/http.js';

export default function ProfileCard() {
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

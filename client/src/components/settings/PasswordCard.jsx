import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../api/http.js';

export default function PasswordCard() {
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

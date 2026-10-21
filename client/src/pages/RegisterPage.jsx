import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/http.js';
import ResendVerification from '../components/auth/ResendVerification.jsx';
import GithubLoginButton from '../components/auth/GithubLoginButton.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await register(form);
      if (result.needsVerification) setPendingEmail(form.email);
      else navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, '가입에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (pendingEmail) {
    return (
      <div className="card">
        <h1>이메일을 확인해 주세요</h1>
        <p role="status">
          <strong>{pendingEmail}</strong> 로 인증 메일을 보냈습니다. 메일의 링크를 누르면 가입이
          완료됩니다. 링크는 24시간 동안 유효합니다.
        </p>
        <p className="muted small">
          메일이 오지 않으면 스팸함을 확인하거나 아래 버튼으로 다시 받으세요.
        </p>
        <ResendVerification email={pendingEmail} />
        <p className="muted">
          <Link to="/login">로그인</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>회원가입</h1>
      <GithubLoginButton label="GitHub 로 가입하기" />
      <label>
        이름
        <input
          autoComplete="name"
          required
          maxLength={50}
          value={form.name}
          onChange={set('name')}
        />
      </label>
      <label>
        이메일
        <input
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
        />
      </label>
      <label>
        비밀번호 (8자 이상)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={form.password}
          onChange={set('password')}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? '가입 중…' : '가입하기'}
      </button>
      <p className="muted">
        이미 계정이 있나요? <Link to="/login">로그인</Link>
      </p>
    </form>
  );
}

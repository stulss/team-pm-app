import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/http.js';
import { returnPath } from '../routes/guards.jsx';
import GithubLoginButton from '../components/auth/GithubLoginButton.jsx';
import { githubErrorMessage } from '../constants/githubLogin.js';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(githubErrorMessage(searchParams.get('github')));
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate(returnPath(location.state?.from), { replace: true });
    } catch (err) {
      setError(errorMessage(err, '로그인에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>로그인</h1>
      <GithubLoginButton />
      <label>
        이메일
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label>
        비밀번호
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? '로그인 중…' : '로그인'}
      </button>
      <p className="muted">
        <Link to="/forgot-password">비밀번호를 잊으셨나요?</Link>
      </p>
      <p className="muted">
        계정이 없나요? <Link to="/register">회원가입</Link>
      </p>
    </form>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/http.js';
import { forgotPassword } from '../api/auth.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, '요청에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="card">
        <h1>메일을 확인해 주세요</h1>
        <p role="status">
          가입된 이메일이라면 비밀번호 재설정 링크를 보냈습니다. 링크는 1시간 동안 유효합니다.
          메일이 오지 않으면 스팸함을 확인하거나 잠시 후 다시 요청해 주세요.
        </p>
        <p className="muted">
          <Link to="/login">로그인으로 돌아가기</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>비밀번호 찾기</h1>
      <p className="muted">가입한 이메일을 입력하면 재설정 링크를 보내 드립니다.</p>
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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? '보내는 중…' : '재설정 링크 보내기'}
      </button>
      <p className="muted">
        <Link to="/login">로그인으로 돌아가기</Link>
      </p>
    </form>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { errorMessage } from '../api/http.js';
import { resetPassword } from '../api/auth.js';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('비밀번호가 서로 다릅니다.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, '비밀번호를 바꾸지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="card">
        <h1>올바르지 않은 링크</h1>
        <p className="muted">메일의 링크를 그대로 열어 주세요.</p>
        <Link to="/forgot-password">비밀번호 찾기</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card">
        <h1>비밀번호를 바꿨습니다</h1>
        <p role="status">모든 기기에서 로그아웃되었습니다. 새 비밀번호로 로그인해 주세요.</p>
        <Link to="/login">로그인</Link>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>새 비밀번호 설정</h1>
      <label>
        새 비밀번호 (8자 이상)
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        새 비밀번호 확인
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? '바꾸는 중…' : '비밀번호 바꾸기'}
      </button>
      <p className="muted">
        링크가 만료되었다면 <Link to="/forgot-password">다시 요청</Link>해 주세요.
      </p>
    </form>
  );
}

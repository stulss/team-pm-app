import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { errorMessage } from '../api/http.js';
import { verifyEmail } from '../api/auth.js';

// 메일 링크로 들어오면 자동으로 인증한다. 토큰은 일회용이라 StrictMode 의 이중 실행에도 한 번만 보낸다.
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState(token ? 'verifying' : 'invalid'); // verifying | ok | invalid
  const [message, setMessage] = useState('');
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err) => {
        setMessage(errorMessage(err, '인증하지 못했습니다.'));
        setState('invalid');
      });
  }, [token]);

  if (state === 'verifying') return <p className="center muted">인증하는 중…</p>;

  if (state === 'ok') {
    return (
      <div className="card">
        <h1>이메일 인증이 완료되었습니다</h1>
        <p role="status">이제 로그인할 수 있습니다.</p>
        <Link to="/login">로그인</Link>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>인증하지 못했습니다</h1>
      <p role="alert" className="error">
        {message || '링크가 올바르지 않습니다.'}
      </p>
      <p className="muted">
        이미 인증했다면 <Link to="/login">로그인</Link>해 보세요. 로그인 화면에서 인증 메일을 다시
        받을 수 있습니다.
      </p>
    </div>
  );
}

import { useState } from 'react';
import { errorMessage } from '../../api/http.js';
import { resendVerification } from '../../api/auth.js';

// 인증 메일을 다시 받는다. 서버는 가입 여부와 상관없이 같은 응답을 주므로 결과 문구도 같다.
export default function ResendVerification({ email }) {
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  const onClick = async () => {
    setState('sending');
    try {
      await resendVerification(email);
      setState('sent');
    } catch (err) {
      setMessage(errorMessage(err, '다시 보내지 못했습니다.'));
      setState('error');
    }
  };

  return (
    <div className="stack">
      <button type="button" className="secondary" disabled={state === 'sending'} onClick={onClick}>
        {state === 'sending' ? '보내는 중…' : '인증 메일 다시 받기'}
      </button>
      {state === 'sent' && (
        <p role="status" className="muted small">
          메일을 다시 보냈습니다. 스팸함도 확인해 주세요. (같은 주소로는 1분에 한 번만 보냅니다)
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="error">
          {message}
        </p>
      )}
    </div>
  );
}

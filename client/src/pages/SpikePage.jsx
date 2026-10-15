// M0/M1.5 연결 점검용 화면: 서버/DB 상태 + WebSocket 스파이크. M5 에서 제거한다.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { http } from '../api/http.js';
import SocketSpike from '../SocketSpike.jsx';

export default function SpikePage() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    http
      .get('/health')
      .then((res) => setHealth({ state: 'ok', body: res.data }))
      .catch((err) =>
        setHealth({ state: 'error', body: err.response?.data ?? { message: err.message } }),
      );
  }, []);

  return (
    <div className="card">
      <h1>연결 상태</h1>
      <p>
        서버:{' '}
        {health.state === 'loading'
          ? '확인 중…'
          : health.state === 'ok'
            ? '정상 (DB 연결됨)'
            : '오류'}
      </p>
      {health.body && <pre>{JSON.stringify(health.body, null, 2)}</pre>}
      <SocketSpike />
      <p>
        <Link to="/">홈으로</Link>
      </p>
    </div>
  );
}

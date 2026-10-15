import { useEffect, useState } from 'react';
import SocketSpike from './SocketSpike.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export default function App() {
  const [health, setHealth] = useState({ state: 'loading' });

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(async (res) => setHealth({ state: res.ok ? 'ok' : 'error', body: await res.json() }))
      .catch((err) => setHealth({ state: 'error', body: { message: err.message } }));
  }, []);

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '2rem auto',
        padding: '0 1rem',
      }}
    >
      <h1>Team PM</h1>
      <section>
        <h2>서버 상태</h2>
        <p>
          {health.state === 'loading' && '확인 중…'}
          {health.state === 'ok' && '정상 (DB 연결됨)'}
          {health.state === 'error' && '오류'}
        </p>
        {health.body && <pre>{JSON.stringify(health.body, null, 2)}</pre>}
      </section>
      <SocketSpike />
    </main>
  );
}

// M0 스파이크 화면: 배포본에서 WebSocket + Redis adapter 가 동작하는지 확인한다. M5 에서 제거.
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export default function SocketSpike() {
  const socketRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const [me, setMe] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');

  useEffect(() => {
    const socket = io({
      path: '/api/socket.io',
      transports: ['websocket'], // Vercel 에서는 long-polling 이 동작하지 않는다
    });
    socketRef.current = socket;
    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', (e) => setStatus(`error: ${e.message}`));
    socket.on('spike:hello', setMe);
    socket.on('spike:message', (m) => setMessages((prev) => [m, ...prev].slice(0, 20)));
    return () => socket.disconnect();
  }, []);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    socketRef.current?.emit('spike:send', text);
    setText('');
  };

  return (
    <section>
      <h2>실시간 스파이크</h2>
      <p>
        상태: {status}
        {me && ` · 내 연결 인스턴스: ${me.instanceId}`}
      </p>
      <form onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지" />
        <button type="submit">보내기</button>
      </form>
      <ul>
        {messages.map((m, i) => (
          <li key={i}>
            [{m.fromInstance}] {m.text}
          </li>
        ))}
      </ul>
      <small>브라우저 두 개를 열어 한쪽에서 보낸 메시지가 다른 쪽에 보이면 통과.</small>
    </section>
  );
}

import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';

// M2 에서 프로젝트 목록으로 대체된다. 지금은 세션/역할 확인용 화면.
export default function HomePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="card">
      <h1>안녕하세요, {user.name}님</h1>
      <p className="muted">
        {user.email} · 역할: <strong>{user.role}</strong>
      </p>
      <p>
        {user.role === 'admin' && <Link to="/admin/users">사용자 관리</Link>}
        {user.role === 'admin' && ' · '}
        <Link to="/spike">연결 상태</Link>
      </p>
      <button type="button" onClick={onLogout}>
        로그아웃
      </button>
    </div>
  );
}

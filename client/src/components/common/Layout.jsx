import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onLogout = async () => {
    await logout();
    queryClient.clear(); // 다음 사용자에게 이전 사용자의 캐시가 보이지 않게 한다
    navigate('/login', { replace: true });
  };

  return (
    <>
      <header className="topbar">
        <nav>
          <strong className="brand">Team PM</strong>
          <NavLink to="/" end>
            프로젝트
          </NavLink>
          <NavLink to="/tasks/mine">내 작업</NavLink>
          {user.role === 'admin' && <NavLink to="/admin/users">사용자 관리</NavLink>}
        </nav>
        <div className="topbar-user">
          <span>{user.name}</span>
          <span className={`badge badge-${user.role}`}>{user.role}</span>
          <button type="button" className="secondary" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}

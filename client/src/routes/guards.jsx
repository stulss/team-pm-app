import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';

function Loading() {
  return <p className="center muted">불러오는 중…</p>;
}

// 로그인 필요. 아니면 /login 으로 보내고, 로그인 후 원래 위치로 돌아오게 한다.
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

// 로그인한 사용자가 /login, /register 에 들어오면 홈으로 보낸다.
export function PublicOnlyRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'authed') return <Navigate to="/" replace />;
  return <Outlet />;
}

// 역할 제한. ProtectedRoute 안쪽에서 사용한다. (서버가 최종 권한 검사를 하며, 이건 화면 차단용이다.)
export function RoleRoute({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return (
      <div className="card">
        <h1>접근 권한이 없습니다</h1>
        <p className="muted">이 페이지는 {roles.join(', ')} 만 볼 수 있습니다.</p>
      </div>
    );
  }
  return <Outlet />;
}

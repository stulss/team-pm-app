import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext.jsx';
import { useUserRealtime } from '../../hooks/useUserRealtime.js';
import CommandPalette from './CommandPalette.jsx';
import NotificationBell from './NotificationBell.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useUserRealtime();
  const [term, setTerm] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Ctrl+K(Mac 은 ⌘K)로 명령 팔레트를 열고 닫는다. 브라우저의 기본 동작(주소창 검색)은 막는다.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSearch = (e) => {
    e.preventDefault();
    const q = term.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  };

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
          <NavLink to="/feed">모아보기</NavLink>
          <NavLink to="/dashboard">대시보드</NavLink>
          <NavLink to="/tasks/mine">내 작업</NavLink>
          {user.role === 'admin' && <NavLink to="/admin/users">사용자 관리</NavLink>}
        </nav>
        <form className="topbar-search" role="search" onSubmit={onSearch}>
          <input
            type="search"
            aria-label="통합검색"
            placeholder="검색 (작업·댓글·채팅·프로젝트)"
            maxLength={50}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </form>
        <button
          type="button"
          className="secondary palette-button"
          aria-label="명령 팔레트 열기"
          title="Ctrl+K"
          onClick={() => setPaletteOpen(true)}
        >
          빠른 실행 <kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-user">
          <NotificationBell />
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
      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} />}
    </>
  );
}

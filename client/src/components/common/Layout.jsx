import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects } from '../../api/projects.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useUserRealtime } from '../../hooks/useUserRealtime.js';
import Avatar from './Avatar.jsx';
import CommandPalette from './CommandPalette.jsx';
import Icon from './Icon.jsx';
import NotificationBell from './NotificationBell.jsx';

const NAV = [
  { to: '/', label: '프로젝트', icon: 'folder', end: true },
  { to: '/feed', label: '모아보기', icon: 'inbox' },
  { to: '/dashboard', label: '대시보드', icon: 'chart' },
  { to: '/tasks/mine', label: '내 작업', icon: 'tasks' },
];

const MAX_SIDE_PROJECTS = 8;

// 앱 셸: 왼쪽 사이드바(내비게이션·내 프로젝트·계정) + 위쪽 바(검색·빠른 실행·알림).
// 좁은 화면에서는 사이드바가 하단 탭 바로 바뀐다(CSS).
export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useUserRealtime();
  const [term, setTerm] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const projects = useQuery({
    queryKey: ['projects', { status: 'active' }],
    queryFn: () => listProjects({ status: 'active', limit: 100 }),
  });
  const sideProjects = (projects.data?.data ?? []).slice(0, MAX_SIDE_PROJECTS);

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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="logo-mark" aria-hidden="true">
            <Icon name="check" size={16} />
          </span>
          <strong className="brand">Team PM</strong>
        </div>

        <nav className="side-nav" aria-label="주 메뉴">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          {user.role === 'admin' && (
            <NavLink to="/admin/users">
              <Icon name="users" />
              <span>사용자 관리</span>
            </NavLink>
          )}
          <NavLink to="/settings" className="nav-settings">
            <Icon name="sliders" />
            <span>설정</span>
          </NavLink>
        </nav>

        {sideProjects.length > 0 && (
          <nav className="side-projects" aria-label="내 프로젝트">
            <div className="side-title">내 프로젝트</div>
            <ul>
              {sideProjects.map((p) => (
                <li key={p.id}>
                  <NavLink to={`/projects/${p.id}`} title={p.name}>
                    <Avatar name={p.name} size="xs" shape="square" />
                    <span className="side-project-name">{p.name}</span>
                    {p.mySettings?.pinned && <Icon name="pin" size={13} className="side-flag" />}
                    {p.mySettings?.muted && <Icon name="bellOff" size={13} className="side-flag" />}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="side-user">
          <Avatar name={user.name} />
          <div className="side-user-info">
            <strong>{user.name}</strong>
            <span className={`role role-${user.role}`}>{user.role}</span>
          </div>
          <button type="button" className="secondary side-logout" onClick={onLogout}>
            <Icon name="logout" size={16} />
            로그아웃
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <strong className="topbar-brand">
            <span className="logo-mark" aria-hidden="true">
              <Icon name="check" size={14} />
            </span>
            Team PM
          </strong>
          <form className="topbar-search" role="search" onSubmit={onSearch}>
            <Icon name="search" size={16} className="search-icon" />
            <input
              type="search"
              aria-label="통합검색"
              placeholder="검색 (작업·댓글·채팅·프로젝트)"
              maxLength={50}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </form>
          <div className="topbar-actions">
            <button
              type="button"
              className="secondary palette-button"
              aria-label="명령 팔레트 열기"
              title="Ctrl+K"
              onClick={() => setPaletteOpen(true)}
            >
              <Icon name="command" size={16} />
              <span className="palette-label">빠른 실행</span> <kbd>Ctrl K</kbd>
            </button>
            <NotificationBell />
            <div className="user-menu">
              <button
                type="button"
                className="icon-btn user-menu-button"
                aria-label="내 계정"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Avatar name={user.name} size="sm" />
              </button>
              {menuOpen && (
                <div className="user-menu-panel" role="menu">
                  <div className="user-menu-head">
                    <Avatar name={user.name} />
                    <div>
                      <strong>{user.name}</strong>
                      <span className={`role role-${user.role}`}>{user.role}</span>
                    </div>
                  </div>
                  <NavLink to="/settings" onClick={() => setMenuOpen(false)}>
                    설정
                  </NavLink>
                  <button type="button" className="secondary" onClick={onLogout}>
                    <Icon name="logout" size={16} />
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
      {paletteOpen && <CommandPalette open onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

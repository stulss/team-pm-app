import { Suspense } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from './context/AuthContext.jsx';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './routes/guards.jsx';
import Layout from './components/common/Layout.jsx';
import Icon from './components/common/Icon.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import { lazyPage } from './utils/lazyPage.js';

// 로그인한 뒤의 화면은 처음 열 때 내려받는다(첫 화면 번들을 줄인다). 로그인·가입 화면은 바로 쓰이므로 묶어 둔다.
const SharedHistoryPage = lazyPage(() => import('./pages/SharedHistoryPage.jsx'));
const ProjectListPage = lazyPage(() => import('./pages/ProjectListPage.jsx'));
const ProjectDetailPage = lazyPage(() => import('./pages/ProjectDetailPage.jsx'));
const MyTasksPage = lazyPage(() => import('./pages/MyTasksPage.jsx'));
const SearchPage = lazyPage(() => import('./pages/SearchPage.jsx'));
const FeedPage = lazyPage(() => import('./pages/FeedPage.jsx'));
const DashboardPage = lazyPage(() => import('./pages/DashboardPage.jsx'));
const AdminUsersPage = lazyPage(() => import('./pages/AdminUsersPage.jsx'));
const SettingsPage = lazyPage(() => import('./pages/SettingsPage.jsx'));

function PageLoading() {
  return <p className="center muted">불러오는 중…</p>;
}

// 로그인·가입 등 인증 화면: 왼쪽에 서비스 소개, 오른쪽에 폼. 좁은 화면에서는 폼만 보인다.
function AuthLayout() {
  return (
    <div className="auth-shell">
      <section className="auth-hero" aria-hidden="true">
        <div className="brand-row">
          <span className="logo-mark">
            <Icon name="check" size={16} />
          </span>
          Team PM
        </div>
        <div>
          <h2>흩어진 팀 업무를 한 곳에서, 한눈에.</h2>
          <p>원격 팀을 위한 프로젝트 관리. 작업·일정·대화를 하나의 화면에서 같이 봅니다.</p>
        </div>
        <ul className="auth-points">
          <li>
            <Icon name="board" />
            드래그로 옮기는 칸반 보드, 캘린더, 타임라인
          </li>
          <li>
            <Icon name="message" />
            작업 댓글·프로젝트 채팅·멘션과 실시간 알림
          </li>
          <li>
            <Icon name="chart" />
            진행률과 지연을 바로 보는 대시보드
          </li>
        </ul>
      </section>
      <main className="auth-main">
        <div className="auth-card">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// 로그인 없이 보는 공유 화면: 소개 없이 가운데 정렬된 읽기 전용 페이지.
function PublicLayout() {
  return (
    <main className="page public">
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            </Route>
          </Route>
          {/* 메일 링크는 로그인 여부와 상관없이 열려야 한다 */}
          <Route element={<AuthLayout />}>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
          <Route element={<PublicLayout />}>
            <Route path="/share/:token" element={<SharedHistoryPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<ProjectListPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/tasks/mine" element={<MyTasksPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/feed" element={<FeedPage />} />
              <Route element={<RoleRoute roles={['admin']} />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
              </Route>
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <main className="page public">
                <div className="empty-state">
                  <strong>페이지를 찾을 수 없습니다</strong>
                  <p>주소가 올바른지 확인해 주세요.</p>
                </div>
              </main>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

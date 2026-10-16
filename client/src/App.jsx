import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from './context/AuthContext.jsx';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './routes/guards.jsx';
import Layout from './components/common/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import SharedHistoryPage from './pages/SharedHistoryPage.jsx';
import ProjectListPage from './pages/ProjectListPage.jsx';
import ProjectDetailPage from './pages/ProjectDetailPage.jsx';
import MyTasksPage from './pages/MyTasksPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import FeedPage from './pages/FeedPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';

function AuthLayout() {
  return (
    <main className="page narrow">
      <Outlet />
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
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/share/:token" element={<SharedHistoryPage />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<ProjectListPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/tasks/mine" element={<MyTasksPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/feed" element={<FeedPage />} />
              <Route element={<RoleRoute roles={['admin']} />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
              </Route>
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <main className="page narrow">
                <p className="center muted">페이지를 찾을 수 없습니다.</p>
              </main>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

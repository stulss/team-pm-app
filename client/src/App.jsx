import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { AuthProvider } from './context/AuthContext.jsx';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './routes/guards.jsx';
import Layout from './components/common/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProjectListPage from './pages/ProjectListPage.jsx';
import ProjectDetailPage from './pages/ProjectDetailPage.jsx';
import MyTasksPage from './pages/MyTasksPage.jsx';
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
            </Route>
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<ProjectListPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/tasks/mine" element={<MyTasksPage />} />
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

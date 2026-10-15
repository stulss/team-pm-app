import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './context/AuthContext.jsx';
import { ProtectedRoute, PublicOnlyRoute, RoleRoute } from './routes/guards.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import SpikePage from './pages/SpikePage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <main className="page">
          <Routes>
            <Route element={<PublicOnlyRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
            </Route>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/spike" element={<SpikePage />} />
              <Route element={<RoleRoute roles={['admin']} />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
              </Route>
            </Route>
            <Route path="*" element={<p className="center muted">페이지를 찾을 수 없습니다.</p>} />
          </Routes>
        </main>
      </AuthProvider>
    </BrowserRouter>
  );
}

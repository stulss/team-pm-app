import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { http, refreshSession, setAccessToken, setOnSessionExpired } from '../api/http.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authed | anon

  const applySession = useCallback(({ user: nextUser, accessToken }) => {
    setAccessToken(accessToken);
    setUser(nextUser);
    setStatus('authed');
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

  // 새로고침 후 세션 복구: refresh 쿠키로 access 토큰과 사용자 정보를 다시 받는다.
  useEffect(() => {
    setOnSessionExpired(clearSession);
    refreshSession().then(applySession).catch(clearSession);
  }, [applySession, clearSession]);

  const value = useMemo(
    () => ({
      user,
      status,
      async login(email, password) {
        const { data } = await http.post('/auth/login', { email, password });
        applySession(data);
      },
      async register(input) {
        const { data } = await http.post('/auth/register', input);
        applySession(data);
      },
      async logout() {
        try {
          await http.post('/auth/logout');
        } finally {
          clearSession();
        }
      },
    }),
    [user, status, applySession, clearSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

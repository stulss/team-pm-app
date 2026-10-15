import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { http, refreshSession, setAccessToken, setOnSessionExpired } from '../api/http.js';
import { connectSocket, disconnectSocket } from '../socket/index.js';

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

  // 로그인 중에는 실시간 소켓을 연결하고, 로그아웃하면 끊는다.
  useEffect(() => {
    if (status === 'authed') connectSocket();
    else if (status === 'anon') disconnectSocket();
  }, [status]);

  const value = useMemo(
    () => ({
      user,
      status,
      async login(email, password) {
        const { data } = await http.post('/auth/login', { email, password });
        applySession(data);
      },
      // 서버가 이메일 인증을 요구하면 세션 없이 { needsVerification: true } 만 온다.
      async register(input) {
        const { data } = await http.post('/auth/register', input);
        if (data.needsVerification) return { needsVerification: true };
        applySession(data);
        return { needsVerification: false };
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

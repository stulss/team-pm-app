import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { http, refreshSession, setAccessToken, setOnSessionExpired } from '../api/http.js';
import { connectSocket, disconnectSocket } from '../socket/index.js';
import { updateMe, updatePreferences } from '../api/users.js';
import { applyPreferences, storePreferences } from '../constants/preferences.js';

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

  // 계정에 저장된 설정을 화면에 적용한다(로그인·새로고침·다른 기기에서 바꾼 뒤 갱신 모두).
  useEffect(() => {
    if (!user) return;
    storePreferences(applyPreferences(user.preferences));
  }, [user]);

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
      // 이름·비밀번호 변경. 비밀번호를 바꾸면 서버가 다른 세션을 모두 끊고 새 세션을 준다.
      async updateProfile(body) {
        const data = await updateMe(body);
        if (data.accessToken) applySession(data);
        else setUser(data.user);
      },
      // 화면에는 먼저 적용하고(낙관적), 서버 저장이 실패하면 되돌린다.
      async savePreferences(patch) {
        const before = user;
        setUser({ ...user, preferences: { ...user.preferences, ...patch } });
        try {
          const data = await updatePreferences(patch);
          setUser(data.user);
        } catch (err) {
          setUser(before);
          throw err;
        }
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

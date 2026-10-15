import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

// Access 토큰은 메모리에만 둔다(localStorage 금지). 새로고침하면 refresh 쿠키로 복구한다.
let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

// 변경 요청에 현재 소켓 ID 를 실어 보내면, 서버가 그 소켓에는 실시간 이벤트를 다시 보내지 않는다.
let socketIdGetter = () => undefined;
export const setSocketIdGetter = (fn) => {
  socketIdGetter = fn;
};

let onSessionExpired = () => {};
export const setOnSessionExpired = (fn) => {
  onSessionExpired = fn;
};

export const http = axios.create({ baseURL: API_BASE, withCredentials: true });

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  const socketId = socketIdGetter();
  if (socketId) config.headers['X-Socket-Id'] = socketId;
  return config;
});

// 동시에 여러 요청이 401 을 받아도(또는 StrictMode 로 두 번 호출돼도) refresh 는 한 번만 보낸다.
// refresh 토큰이 회전되므로 중복 호출은 세션을 깨뜨릴 수 있다.
let refreshing = null;
export function refreshSession() {
  refreshing ??= axios
    .post(`${API_BASE}/auth/refresh`, null, { withCredentials: true })
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    const isAuthCall = config?.url?.startsWith('/auth/');
    if (response?.status === 401 && config && !config._retried && !isAuthCall) {
      config._retried = true;
      try {
        await refreshSession();
        return http(config);
      } catch {
        setAccessToken(null);
        onSessionExpired();
      }
    }
    throw error;
  },
);

export const errorMessage = (err, fallback = '요청에 실패했습니다.') =>
  err?.response?.data?.error?.message ?? fallback;

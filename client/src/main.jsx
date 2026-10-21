import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import './styles/index.css';
import { applyPreferences, loadStoredPreferences } from './constants/preferences.js';

// 로그인 전 화면(로그인·가입)도 마지막으로 쓴 테마로 깜빡임 없이 보이게 한다. 로그인하면 계정 설정이 이어받는다.
applyPreferences(loadStoredPreferences());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // 4xx(권한/없음)는 재시도해도 같은 결과이므로 재시도하지 않는다.
      retry: (count, err) => (err?.response?.status ?? 500) >= 500 && count < 2,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);

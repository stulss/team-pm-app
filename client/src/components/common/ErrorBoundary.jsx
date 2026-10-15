import { Component } from 'react';

// 화면 렌더링 중 예상치 못한 오류가 나도 빈 화면 대신 안내와 복구 방법을 보여 준다.
// (API 오류는 각 화면에서 처리한다. 이건 코드 오류에 대한 마지막 안전망이다.)
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // 운영에서는 브라우저 콘솔에만 남긴다(외부 수집 서비스는 쓰지 않는다).
    console.error('UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page narrow">
        <div className="card" role="alert">
          <h1>문제가 발생했습니다</h1>
          <p className="muted">
            화면을 표시하는 중 오류가 났습니다. 새로고침하면 대부분 해결됩니다. 계속되면 관리자에게
            알려 주세요.
          </p>
          <div className="row">
            <button type="button" onClick={() => window.location.reload()}>
              새로고침
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              처음으로
            </button>
          </div>
        </div>
      </main>
    );
  }
}

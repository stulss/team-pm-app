import { Link } from 'react-router';

// M2 에서 사용자 목록/역할 변경 UI 로 채운다. 지금은 역할별 라우트 차단 확인용 자리.
export default function AdminUsersPage() {
  return (
    <div className="card">
      <h1>사용자 관리</h1>
      <p className="muted">관리자 전용 페이지입니다. (M2 에서 구현)</p>
      <Link to="/">홈으로</Link>
    </div>
  );
}

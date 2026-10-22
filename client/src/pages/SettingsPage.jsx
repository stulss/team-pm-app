import NotificationCard from '../components/settings/NotificationCard.jsx';
import ProjectsCard from '../components/settings/ProjectsCard.jsx';
import ProfileCard from '../components/settings/ProfileCard.jsx';
import DataCard from '../components/settings/DataCard.jsx';
import ApiTokensCard from '../components/settings/ApiTokensCard.jsx';
import SessionsCard from '../components/settings/SessionsCard.jsx';
import GithubAccountCard from '../components/settings/GithubAccountCard.jsx';
import PasswordCard from '../components/settings/PasswordCard.jsx';
import AppearanceCard from '../components/settings/AppearanceCard.jsx';

// 내 설정 페이지. 항목은 카드 단위로 나뉘고, 왼쪽 목록(좁은 화면에서는 위쪽)으로 바로 이동한다.
export default function SettingsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>설정</h1>
          <p className="muted">내 프로필, 화면, 알림, 프로젝트, 보안을 관리합니다.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="설정 항목">
          <a href="#profile">프로필</a>
          <a href="#appearance">화면</a>
          <a href="#notifications">알림</a>
          <a href="#projects">프로젝트</a>
          <a href="#security">보안</a>
          <a href="#sessions">기기</a>
          <a href="#api">API 토큰</a>
          <a href="#github">GitHub</a>
          <a href="#data">내 데이터</a>
        </nav>
        <div className="settings-content">
          <ProfileCard />
          <AppearanceCard />
          <NotificationCard />
          <ProjectsCard />
          <PasswordCard />
          <SessionsCard />
          <ApiTokensCard />
          <GithubAccountCard />
          <DataCard />
        </div>
      </div>
    </>
  );
}

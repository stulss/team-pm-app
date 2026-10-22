import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../api/http.js';
import { NOTIFICATIONS } from '../../constants/preferences.js';
import { Row } from './SettingsParts.jsx';

// 알림 종류별 받기/끄기. 켜고 끄는 즉시 저장된다(서버가 끈 종류의 알림은 만들지 않는다).
export default function NotificationCard() {
  const { user, savePreferences } = useAuth();
  const current = user.preferences.notifications;
  const [state, setState] = useState({ error: '', saved: false });

  const toggle = async (key, value) => {
    setState({ error: '', saved: false });
    try {
      await savePreferences({ notifications: { [key]: value } });
      setState({ error: '', saved: true });
    } catch (err) {
      setState({ error: errorMessage(err, '설정을 저장하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="notifications" aria-label="알림">
      <div className="card-head">
        <h2>알림</h2>
        <span role="status" className="save-state">
          {state.saved ? '저장했습니다.' : ''}
        </span>
      </div>
      <p className="muted">
        끈 종류의 알림은 새로 만들어지지 않습니다. 이미 받은 알림은 그대로 남습니다.
      </p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {NOTIFICATIONS.map((n) => (
        <Row key={n.value} title={n.label} hint={n.hint}>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={`${n.label} 알림 받기`}
              checked={current[n.value]}
              onChange={(e) => toggle(n.value, e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            <span>{current[n.value] ? '받는 중' : '꺼짐'}</span>
          </label>
        </Row>
      ))}
    </section>
  );
}

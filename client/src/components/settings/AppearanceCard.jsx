import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage } from '../../api/http.js';
import {
  ACCENTS,
  DENSITIES,
  THEMES,
  TIME_FORMATS,
  VIEWS,
  WEEK_STARTS,
} from '../../constants/preferences.js';
import { ChoiceGroup, Row } from './SettingsParts.jsx';

export default function AppearanceCard() {
  const { user, savePreferences } = useAuth();
  const prefs = user.preferences;
  const [state, setState] = useState({ error: '', saved: false });

  const save = async (patch) => {
    setState({ error: '', saved: false });
    try {
      await savePreferences(patch);
      setState({ error: '', saved: true });
    } catch (err) {
      setState({ error: errorMessage(err, '설정을 저장하지 못했습니다.'), saved: false });
    }
  };

  return (
    <section className="card settings-card" id="appearance" aria-label="화면">
      <div className="card-head">
        <h2>화면</h2>
        <span role="status" className="save-state">
          {state.saved ? '저장했습니다.' : ''}
        </span>
      </div>
      <p className="muted">계정에 저장되어 다른 기기에서도 같게 보입니다.</p>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <Row title="테마" hint="밝은 화면, 어두운 화면, 또는 운영체제 설정을 따릅니다.">
        <ChoiceGroup
          label="테마"
          name="theme"
          options={THEMES}
          value={prefs.theme}
          onChange={(theme) => save({ theme })}
        />
      </Row>
      <Row title="포인트 색" hint="버튼·선택 표시·링크에 쓰는 색입니다.">
        <ChoiceGroup
          label="포인트 색"
          name="accent"
          options={ACCENTS}
          value={prefs.accent}
          onChange={(accent) => save({ accent })}
          render={(o) => (
            <>
              <span className="swatch" style={{ '--sw': o.swatch }} aria-hidden="true" />
              {o.label}
            </>
          )}
        />
      </Row>
      <Row title="밀도" hint="글자와 간격 크기를 정합니다.">
        <ChoiceGroup
          label="밀도"
          name="density"
          options={DENSITIES}
          value={prefs.density}
          onChange={(density) => save({ density })}
          render={(o) => (
            <>
              {o.label} <small>{o.hint}</small>
            </>
          )}
        />
      </Row>
      <Row title="한 주의 시작" hint="캘린더에서 한 주가 시작되는 요일입니다.">
        <ChoiceGroup
          label="한 주의 시작"
          name="weekStart"
          options={WEEK_STARTS}
          value={prefs.weekStart}
          onChange={(weekStart) => save({ weekStart })}
        />
      </Row>
      <Row title="시각 표기" hint="활동·댓글·알림에 보이는 시각의 표기 방식입니다.">
        <ChoiceGroup
          label="시각 표기"
          name="timeFormat"
          options={TIME_FORMATS}
          value={prefs.timeFormat}
          onChange={(timeFormat) => save({ timeFormat })}
          render={(o) => (
            <>
              {o.label} <small>{o.hint}</small>
            </>
          )}
        />
      </Row>
      <Row title="기본 작업 보기" hint="프로젝트를 열 때 처음 보이는 보기입니다.">
        <ChoiceGroup
          label="기본 작업 보기"
          name="defaultView"
          options={VIEWS}
          value={prefs.defaultView}
          onChange={(defaultView) => save({ defaultView })}
        />
      </Row>
    </section>
  );
}

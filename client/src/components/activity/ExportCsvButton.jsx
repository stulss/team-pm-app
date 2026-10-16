import { useState } from 'react';
import { listActivities } from '../../api/activity.js';
import { errorMessage } from '../../api/http.js';
import { actorName, describeActivity } from '../../constants/activity.js';
import { buildCsv, downloadCsv } from '../../utils/csv.js';

const PAGE = 200;
const MAX_PAGES = 10; // 최근 2000건까지

const pad = (n) => String(n).padStart(2, '0');
const stamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 본인이 볼 수 있는 활동 기록을 CSV 로 내려받는다. 서버 API 를 그대로 쓰므로 권한도 같다.
export default function ExportCsvButton({ project }) {
  const [state, setState] = useState('idle'); // idle | busy | error
  const [message, setMessage] = useState('');

  const onClick = async () => {
    setState('busy');
    try {
      const all = [];
      let before;
      for (let i = 0; i < MAX_PAGES; i += 1) {
        const page = await listActivities(project.id, { before, limit: PAGE });
        all.push(...page.data);
        if (!page.nextCursor) break;
        before = page.nextCursor;
      }
      const rows = [
        ['일시', '행위자', '내용', '동작'],
        // 오래된 것부터 읽기 쉽게 시간 오름차순으로 내보낸다
        ...[...all]
          .reverse()
          .map((a) => [stamp(a.createdAt), actorName(a), describeActivity(a), a.action]),
      ];
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`활동기록-${project.name}-${today}.csv`, buildCsv(rows));
      setState('idle');
    } catch (err) {
      setMessage(errorMessage(err, '내보내지 못했습니다.'));
      setState('error');
    }
  };

  return (
    <>
      <button type="button" className="secondary" disabled={state === 'busy'} onClick={onClick}>
        {state === 'busy' ? '만드는 중…' : 'CSV 내보내기'}
      </button>
      {state === 'error' && (
        <span role="alert" className="error small">
          {message}
        </span>
      )}
    </>
  );
}

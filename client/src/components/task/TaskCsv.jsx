import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importTasks, listProjectTasks } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { buildCsv, downloadCsv, parseCsv } from '../../utils/csv.js';
import { HEADERS, MAX_IMPORT_ROWS, readTasks, taskRows } from '../../utils/taskCsv.js';
import Modal from '../common/Modal.jsx';

const PAGE = 200;
const MAX_PAGES = 5; // 프로젝트 작업 상한(1000)

// 작업 목록을 CSV 로 내보내거나 CSV 에서 가져온다. 서버 API 를 그대로 쓰므로 권한도 같다.
export default function TaskCsv({ project, archived }) {
  const queryClient = useQueryClient();
  const fileInput = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState(null); // { name, tasks, errors }
  const [done, setDone] = useState('');
  const [sure, setSure] = useState(false); // 같은 제목이 이미 있어도 가져오겠다는 확인

  const fetchAll = async () => {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await listProjectTasks(project.id, { page, limit: PAGE });
      all.push(...res.data);
      if (all.length >= res.meta.total) break;
    }
    return all;
  };

  const exportAll = async () => {
    setExporting(true);
    setExportError('');
    try {
      const all = await fetchAll();
      const today = new Date().toISOString().slice(0, 10);
      downloadCsv(`작업-${project.name}-${today}.csv`, buildCsv(taskRows(all, project.members)));
    } catch (err) {
      setExportError(errorMessage(err, '내보내지 못했습니다.'));
    } finally {
      setExporting(false);
    }
  };

  const save = useMutation({
    mutationFn: () => importTasks(project.id, parsed.tasks),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      setDone(`${res.created}개 작업을 가져왔습니다.`);
      close();
    },
  });

  const close = () => {
    setImporting(false);
    setParsed(null);
    setSure(false);
    save.reset();
  };

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    save.reset();
    try {
      const { tasks, errors } = readTasks(parseCsv(await file.text()), project.members);
      setSure(false);
      // 내보낸 파일을 그대로 다시 가져오면 같은 작업이 또 생기므로, 이미 있는 제목은 미리 알려 준다.
      let duplicates = 0;
      if (errors.length === 0) {
        try {
          const existing = new Set((await fetchAll()).map((t) => t.title.trim().toLowerCase()));
          duplicates = tasks.filter((t) => existing.has(t.title.trim().toLowerCase())).length;
        } catch {
          /* 확인하지 못해도 가져오기는 막지 않는다 */
        }
      }
      setParsed({ name: file.name, tasks, errors, duplicates });
    } catch {
      setParsed({
        name: file.name,
        tasks: [],
        errors: [{ line: 0, message: '파일을 읽지 못했습니다.' }],
      });
    }
  };

  const downloadTemplate = () =>
    downloadCsv(
      '작업-가져오기-양식.csv',
      buildCsv([
        HEADERS.slice(0, 7),
        [
          '로그인 화면 만들기',
          '설명은 비워도 됩니다',
          '진행 중',
          '높음',
          '',
          '2030-05-01',
          '2030-05-09',
        ],
      ]),
    );

  return (
    <>
      <button type="button" className="secondary" disabled={exporting} onClick={exportAll}>
        {exporting ? '내보내는 중…' : '작업 내보내기'}
      </button>
      {!archived && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setDone('');
            setImporting(true);
          }}
        >
          작업 가져오기
        </button>
      )}
      {exportError && (
        <p role="alert" className="error">
          {exportError}
        </p>
      )}
      {done && (
        <p role="status" className="save-state">
          {done}
        </p>
      )}

      {importing && (
        <Modal title="CSV 에서 작업 가져오기" onClose={close}>
          <p className="muted small">
            첫 줄은 머리글(<code>제목</code> 필수, 설명·상태·우선순위·담당자(멤버 이메일)·시작일·
            마감일)이어야 합니다. 상태는 할 일/진행 중/검토/완료, 우선순위는 낮음/보통/높음/긴급. 한
            번에 최대 {MAX_IMPORT_ROWS}개까지, 하나라도 문제가 있으면 아무것도 만들지 않습니다.
            "작업 내보내기" 파일도 가져올 수 있지만 번호·라벨·댓글 수 열은 무시하고 새 작업으로
            만듭니다(같은 작업이 중복될 수 있습니다).
          </p>
          <div className="row">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV 파일 선택"
              onChange={choose}
            />
            <button type="button" className="link" onClick={downloadTemplate}>
              양식 내려받기
            </button>
          </div>

          {parsed && parsed.errors.length > 0 && (
            <div role="alert" className="error">
              <strong>
                {parsed.name}: 문제 {parsed.errors.length}건 — 고친 뒤 다시 선택해 주세요.
              </strong>
              <ul>
                {parsed.errors.slice(0, 20).map((er, i) => (
                  <li key={i}>
                    {er.line > 0 ? `${er.line}번째 줄: ` : ''}
                    {er.message}
                  </li>
                ))}
              </ul>
              {parsed.errors.length > 20 && <p>…외 {parsed.errors.length - 20}건</p>}
            </div>
          )}
          {parsed && parsed.errors.length === 0 && (
            <>
              <p role="status">
                <strong>{parsed.tasks.length}개</strong> 작업을 가져올 수 있습니다.
              </p>
              <ul className="import-preview">
                {parsed.tasks.slice(0, 5).map((t, i) => (
                  <li key={i}>{t.title}</li>
                ))}
                {parsed.tasks.length > 5 && (
                  <li className="muted">…외 {parsed.tasks.length - 5}개</li>
                )}
              </ul>
            </>
          )}
          {parsed && parsed.errors.length === 0 && parsed.duplicates > 0 && (
            <div role="alert" className="notice">
              <p>
                이 프로젝트에 같은 제목의 작업이 이미 있는 줄이{' '}
                <strong>{parsed.duplicates}개</strong> 있습니다. 가져오면 같은 작업이 한 번 더
                만들어집니다.
              </p>
              <label className="inline">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                중복이어도 가져옵니다
              </label>
            </div>
          )}
          {save.isError && (
            <p role="alert" className="error">
              {errorMessage(save.error, '가져오지 못했습니다.')}
            </p>
          )}
          <div className="row">
            <button
              type="button"
              disabled={
                !parsed ||
                parsed.errors.length > 0 ||
                (parsed.duplicates > 0 && !sure) ||
                save.isPending
              }
              onClick={() => save.mutate()}
            >
              {save.isPending ? '가져오는 중…' : '가져오기'}
            </button>
            <button type="button" className="secondary" onClick={close}>
              닫기
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

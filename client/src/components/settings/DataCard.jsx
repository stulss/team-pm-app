import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { errorMessage, http } from '../../api/http.js';
import { Row } from './SettingsParts.jsx';

// 내 데이터 내려받기와 계정 삭제(탈퇴). 삭제는 이메일을 직접 입력해야 눌린다.
export default function DataCard() {
  const { user, logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [form, setForm] = useState({ email: '', password: '' });
  const [del, setDel] = useState({ busy: false, error: '' });
  const needsPassword = user.emailLogin !== false;
  const canDelete =
    form.email.trim().toLowerCase() === user.email && (!needsPassword || form.password.length > 0);

  const download = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await http.get('/users/me/export', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `team-pm-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(errorMessage(err, '내려받지 못했습니다.'));
    } finally {
      setExporting(false);
    }
  };

  const remove = async (e) => {
    e.preventDefault();
    if (!canDelete) return;
    if (!window.confirm('계정을 삭제할까요? 되돌릴 수 없습니다.')) return;
    setDel({ busy: true, error: '' });
    try {
      await http.delete('/users/me', {
        data: {
          confirmEmail: form.email,
          currentPassword: needsPassword ? form.password : undefined,
        },
      });
      await logout();
    } catch (err) {
      setDel({ busy: false, error: errorMessage(err, '삭제하지 못했습니다.') });
    }
  };

  return (
    <section className="card settings-card" id="data" aria-label="내 데이터">
      <h2>내 데이터</h2>
      <Row
        title="내 데이터 내려받기"
        hint="프로필, 소속 프로젝트, 내가 맡았거나 만든 작업, 내가 쓴 댓글을 JSON 파일로 받습니다."
      >
        <button type="button" className="secondary" disabled={exporting} onClick={download}>
          {exporting ? '준비 중…' : 'JSON 으로 내려받기'}
        </button>
        {exportError && (
          <p role="alert" className="error">
            {exportError}
          </p>
        )}
      </Row>
      <form className="stack settings-form danger-zone" onSubmit={remove}>
        <h3>계정 삭제</h3>
        <p className="muted small">
          계정은 되돌릴 수 없게 비활성화되고 이메일·이름이 지워집니다. 내가 쓴 작업과 댓글은 “탈퇴한
          사용자”로 남고, 프로젝트 소속과 알림은 사라집니다. 소유한 프로젝트가 있으면 먼저 삭제해야
          합니다.
        </p>
        <label>
          확인을 위해 내 이메일({user.email})을 입력하세요
          <input
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        {needsPassword && (
          <label>
            현재 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
        )}
        {del.error && (
          <p role="alert" className="error">
            {del.error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="danger" disabled={!canDelete || del.busy}>
            {del.busy ? '삭제 중…' : '계정 삭제'}
          </button>
        </div>
      </form>
    </section>
  );
}

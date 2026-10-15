import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../api/projects.js';
import { errorMessage } from '../api/http.js';
import CreateProjectForm from '../components/project/CreateProjectForm.jsx';

export default function ProjectListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['projects', { status }],
    queryFn: () => listProjects({ status, limit: 100 }),
  });

  return (
    <>
      <div className="row between">
        <h1>프로젝트</h1>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            새 프로젝트
          </button>
        )}
      </div>

      {creating && (
        <CreateProjectForm
          onCancel={() => setCreating(false)}
          onDone={(project) => navigate(`/projects/${project.id}`)}
        />
      )}

      <div className="tabs" role="tablist">
        {[
          ['active', '진행 중'],
          ['archived', '보관됨'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={status === value ? 'tab active' : 'tab'}
            onClick={() => setStatus(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {isPending && <p className="muted">불러오는 중…</p>}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '프로젝트 목록을 불러오지 못했습니다.')}
        </p>
      )}
      {data && data.data.length === 0 && (
        <p className="muted">
          {status === 'active'
            ? '아직 프로젝트가 없습니다. 새 프로젝트를 만들거나, 다른 프로젝트 소유자에게 이메일로 초대를 요청해 보세요.'
            : '보관된 프로젝트가 없습니다.'}
        </p>
      )}
      <ul className="grid">
        {data?.data.map((p) => (
          <li key={p.id} className="card">
            <h2>
              <Link to={`/projects/${p.id}`}>{p.name}</Link>
            </h2>
            {p.description && <p className="muted clamp">{p.description}</p>}
            <p className="muted small">
              소유자 {p.ownerName} · 멤버 {p.memberCount}명
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

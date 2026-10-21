import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listProjects } from '../api/projects.js';
import { errorMessage } from '../api/http.js';
import CreateProjectForm from '../components/project/CreateProjectForm.jsx';
import Avatar from '../components/common/Avatar.jsx';
import Icon from '../components/common/Icon.jsx';

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
      <div className="page-header">
        <div>
          <h1>프로젝트</h1>
          <p className="muted">참여 중인 프로젝트를 한곳에서 보고 바로 이동합니다.</p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />새 프로젝트
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

      {isPending && (
        <ul className="grid" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <li key={i} className="card project-card">
              <span className="skeleton" style={{ height: 40 }} />
              <span className="skeleton" style={{ height: 14 }} />
              <span className="skeleton" style={{ height: 14, width: '60%' }} />
            </li>
          ))}
        </ul>
      )}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '프로젝트 목록을 불러오지 못했습니다.')}
        </p>
      )}
      {data && data.data.length === 0 && (
        <div className="empty-state">
          <Icon name="folder" size={26} />
          <strong>
            {status === 'active' ? '아직 프로젝트가 없습니다' : '보관된 프로젝트가 없습니다'}
          </strong>
          <p>
            {status === 'active'
              ? '새 프로젝트를 만들거나, 다른 프로젝트 소유자에게 이메일로 초대를 요청해 보세요.'
              : '끝난 프로젝트를 보관하면 여기에 모입니다.'}
          </p>
        </div>
      )}
      <ul className="grid">
        {data?.data.map((p) => (
          <li key={p.id} className="card project-card">
            <div className="project-card-top">
              <Avatar name={p.name} size="lg" shape="square" />
              <h2>
                <Link to={`/projects/${p.id}`}>{p.name}</Link>
              </h2>
              {p.mySettings?.pinned && (
                <span className="badge" title="고정한 프로젝트">
                  <Icon name="pin" size={12} />
                  고정
                </span>
              )}
              {p.mySettings?.muted && (
                <span className="badge" title="알림을 꺼 둔 프로젝트">
                  <Icon name="bellOff" size={12} />
                  알림 꺼짐
                </span>
              )}
            </div>
            {p.description && <p className="muted clamp">{p.description}</p>}
            <div className="project-card-meta">
              <span>
                소유자 {p.ownerName} · 멤버 {p.memberCount}명
              </span>
              <Icon name="chevronRight" size={16} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

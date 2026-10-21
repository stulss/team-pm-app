import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addProjectMember,
  canManageProject,
  canSearchUsers,
  deleteProject,
  getProject,
  removeProjectMember,
  updateMySettings,
  updateProject,
} from '../api/projects.js';
import { errorMessage } from '../api/http.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useProjectRealtime } from '../hooks/useProjectRealtime.js';
import UserSearch from '../components/project/UserSearch.jsx';
import MemberEmailAdd from '../components/project/MemberEmailAdd.jsx';
import TaskSection from '../components/task/TaskSection.jsx';
import ProjectDashboard from '../components/dashboard/ProjectDashboard.jsx';
import PollPanel from '../components/poll/PollPanel.jsx';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import ActivityFeed from '../components/activity/ActivityFeed.jsx';
import ExportCsvButton from '../components/activity/ExportCsvButton.jsx';
import ShareLinks from '../components/activity/ShareLinks.jsx';
import GithubConnect from '../components/project/GithubConnect.jsx';
import Avatar from '../components/common/Avatar.jsx';
import Icon from '../components/common/Icon.jsx';

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { offline } = useProjectRealtime(id);

  const key = ['project', id];
  const {
    data: project,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: key,
    queryFn: () => getProject(id),
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['tasks', id] }); // 프로젝트 키가 바뀌면 작업 키도 바뀐다
  };
  const update = useMutation({
    mutationFn: (body) => updateProject(id, body),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const addMember = useMutation({
    mutationFn: (body) => addProjectMember(id, body),
    onSuccess: refresh,
  });
  const removeMember = useMutation({
    mutationFn: (userId) => removeProjectMember(id, userId),
    onSuccess: refresh,
  });
  const mySettings = useMutation({
    mutationFn: (patch) => updateMySettings(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/', { replace: true });
    },
  });

  if (isPending) return <p className="muted">불러오는 중…</p>;
  if (isError) {
    const status = error.response?.status;
    return (
      <div className="card">
        <h1>{status === 403 ? '접근 권한이 없습니다' : '프로젝트를 불러오지 못했습니다'}</h1>
        <p className="muted">
          {status === 403
            ? '이 프로젝트의 멤버가 아닙니다. 프로젝트 관리자에게 초대를 요청하세요.'
            : errorMessage(error)}
        </p>
        <Link to="/">프로젝트 목록으로</Link>
      </div>
    );
  }

  const canManage = canManageProject(user, project);
  const archived = project.status === 'archived';
  const mutationError = [update, addMember, removeMember, remove].find((m) => m.isError)?.error;

  return (
    <>
      <Link to="/" className="breadcrumb">
        ← 프로젝트
      </Link>
      {offline && (
        <p role="status" className="notice">
          실시간 연결이 끊겼습니다. 다시 연결하는 중입니다… 변경 사항은 연결되면 자동으로
          반영됩니다.
        </p>
      )}

      <div className="project-layout">
        <div className="project-main">
          <div className="card">
            {editing ? (
              <EditForm
                project={project}
                busy={update.isPending}
                onCancel={() => setEditing(false)}
                onSave={(body) => update.mutate(body)}
              />
            ) : (
              <div className="project-header">
                <Avatar name={project.name} size="xl" shape="square" />
                <div className="grow">
                  <h1>
                    {project.name}
                    {archived && <span className="badge badge-archived">보관됨</span>}
                  </h1>
                  {project.description && <p>{project.description}</p>}
                  <p className="muted small">
                    프로젝트 키 <strong>{project.key}</strong> · 소유자{' '}
                    {project.members.find((m) => m.isOwner)?.name ?? '-'} · 멤버{' '}
                    {project.members.length}명
                  </p>
                </div>
                <div className="project-actions">
                  {project.mySettings && (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        aria-pressed={project.mySettings.pinned}
                        disabled={mySettings.isPending}
                        onClick={() => mySettings.mutate({ pinned: !project.mySettings.pinned })}
                      >
                        <Icon name="pin" size={15} />
                        {project.mySettings.pinned ? '고정 해제' : '고정하기'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        aria-pressed={project.mySettings.muted}
                        disabled={mySettings.isPending}
                        onClick={() => mySettings.mutate({ muted: !project.mySettings.muted })}
                      >
                        <Icon name={project.mySettings.muted ? 'bellOff' : 'bell'} size={15} />
                        {project.mySettings.muted ? '알림 켜기' : '알림 끄기'}
                      </button>
                    </>
                  )}
                  {canManage && (
                    <>
                      <button type="button" className="secondary" onClick={() => setEditing(true)}>
                        <Icon name="edit" size={15} />
                        수정
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ status: archived ? 'active' : 'archived' })}
                      >
                        <Icon name="archive" size={15} />
                        {archived ? '보관 해제' : '보관'}
                      </button>
                      <button
                        type="button"
                        className="danger-ghost"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `"${project.name}" 프로젝트를 영구 삭제할까요? 되돌릴 수 없습니다.`,
                            )
                          ) {
                            remove.mutate();
                          }
                        }}
                      >
                        <Icon name="trash" size={15} />
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {mutationError && (
            <p role="alert" className="error">
              {errorMessage(mutationError)}
            </p>
          )}

          <ProjectDashboard projectId={project.id} />

          <TaskSection project={project} archived={archived} />

          <div className="card">
            <PollPanel project={project} archived={archived} />
          </div>
        </div>
        <aside className="project-side" aria-label="프로젝트 사이드">
          <div className="card">
            <ChatPanel project={project} archived={archived} />
          </div>

          <div className="card">
            <ActivityFeed projectId={project.id} actions={<ExportCsvButton project={project} />} />
            {canManage && <ShareLinks projectId={project.id} />}
            {canManage && <GithubConnect projectId={project.id} />}
          </div>

          <div className="card">
            <h2>멤버 ({project.members.length})</h2>
            <ul className="members">
              {project.members.map((m) => (
                <li key={m.id}>
                  <Avatar name={m.name} />
                  <span className="member-info">
                    <strong>
                      {m.name}
                      {m.isOwner && <span className="badge badge-owner">소유자</span>}
                      {!m.isActive && <span className="badge badge-archived">비활성</span>}
                    </strong>
                    <span className="muted">{m.email}</span>
                  </span>
                  {canManage && !m.isOwner && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={removeMember.isPending}
                      onClick={() => removeMember.mutate(m.id)}
                    >
                      제거
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canManage && (
              <div>
                <span className="field-label">멤버 추가</span>
                {canSearchUsers(user) && (
                  <UserSearch
                    excludeIds={project.members.map((m) => m.id)}
                    disabled={addMember.isPending}
                    onPick={(u) => addMember.mutate({ userId: u.id })}
                  />
                )}
                <MemberEmailAdd
                  disabled={addMember.isPending}
                  onAdd={(email) => addMember.mutate({ email })}
                />
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

function EditForm({ project, busy, onSave, onCancel }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [key, setKey] = useState(project.key);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, description, ...(key !== project.key && { key }) });
      }}
    >
      <label>
        이름
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        프로젝트 키
        <input
          required
          minLength={2}
          maxLength={10}
          pattern="[A-Za-z][A-Za-z0-9]{1,9}"
          title="영문으로 시작하는 2~10자의 영문·숫자"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
        />
        <span className="muted small">
          작업 키(예: {key || 'TPM'}-12)의 앞부분입니다. 바꾸면 이전 키로 적은 커밋·PR 은 연결되지
          않습니다.
        </span>
      </label>
      <label>
        설명
        <textarea
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>
          저장
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

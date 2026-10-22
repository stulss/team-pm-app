import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjects, updateMySettings } from '../../api/projects.js';
import Avatar from '../common/Avatar.jsx';
import { errorMessage } from '../../api/http.js';

// 프로젝트별 개인 설정: 목록·사이드바 상단 고정, 알림 음소거. 켜고 끄는 즉시 저장된다.
export default function ProjectsCard() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['projects', 'settings'],
    queryFn: () => listProjects({ limit: 100 }),
  });
  const save = useMutation({
    mutationFn: ({ id, patch }) => updateMySettings(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
    },
  });
  const projects = (data?.data ?? []).filter((p) => p.mySettings);

  return (
    <section className="card settings-card" id="projects" aria-label="프로젝트">
      <h2>프로젝트</h2>
      <p className="muted">
        고정한 프로젝트는 목록과 사이드바 맨 위에 보입니다. 알림을 끈 프로젝트의 알림(배정·댓글·
        멘션·마감)은 나에게 새로 만들어지지 않습니다. 다른 멤버에게는 영향이 없습니다.
      </p>
      {isPending && <span className="skeleton" style={{ height: 40 }} />}
      {isError && (
        <p role="alert" className="error">
          {errorMessage(error, '프로젝트를 불러오지 못했습니다.')}
        </p>
      )}
      {save.isError && (
        <p role="alert" className="error">
          {errorMessage(save.error, '설정을 저장하지 못했습니다.')}
        </p>
      )}
      {data && projects.length === 0 && <p className="muted">참여 중인 프로젝트가 없습니다.</p>}
      <ul className="project-settings">
        {projects.map((p) => (
          <li key={p.id} data-project-id={p.id}>
            <Avatar name={p.name} shape="square" />
            <span className="project-settings-name">
              {p.name}
              {p.status === 'archived' && <span className="badge badge-archived">보관됨</span>}
            </span>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`${p.name} 고정`}
                checked={p.mySettings.pinned}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ id: p.id, patch: { pinned: e.target.checked } })}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>고정</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`${p.name} 알림 끄기`}
                checked={p.mySettings.muted}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ id: p.id, patch: { muted: e.target.checked } })}
              />
              <span className="switch-track" aria-hidden="true" />
              <span>알림 끄기</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

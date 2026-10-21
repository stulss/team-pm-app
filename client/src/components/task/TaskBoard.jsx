import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listProjectTasks, moveTask } from '../../api/tasks.js';
import { errorMessage } from '../../api/http.js';
import { PRIORITY_LABELS, STATUSES, STATUS_LABELS, isOverdue } from '../../constants/task.js';
import { checklistText } from '../../constants/labels.js';
import { openBlockers } from '../../utils/timeline.js';
import LabelChip from './LabelChip.jsx';

const COLUMN_PREFIX = 'col:';

function TaskCard({ task, disabled, overlay = false, onOpen }) {
  const sortable = useSortable({ id: task.id, disabled });
  const style = overlay
    ? undefined
    : {
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
        opacity: sortable.isDragging ? 0.4 : 1,
      };

  return (
    <div
      ref={overlay ? undefined : sortable.setNodeRef}
      style={style}
      className={`task-card${overlay ? ' overlay' : ''}`}
      data-task-id={task.id}
      {...(overlay ? {} : sortable.attributes)}
      {...(overlay ? {} : sortable.listeners)}
      onClick={() => onOpen?.(task)}
    >
      <strong className="task-card-title">{task.title}</strong>
      {task.labels?.length > 0 && (
        <div className="task-card-labels">
          {task.labels.map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
        </div>
      )}
      <div className="task-card-meta">
        <span className={`badge badge-p-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
        {task.assignee && <span className="muted small">{task.assignee.name}</span>}
        {task.commentCount > 0 && <span className="muted small">댓글 {task.commentCount}</span>}
        {openBlockers(task).length > 0 && (
          <span
            className="blocked-badge"
            title={`선행 작업: ${openBlockers(task)
              .map((b) => b.title)
              .join(', ')}`}
          >
            ⛔ 선행 {openBlockers(task).length}
          </span>
        )}
        {checklistText(task.checklist) && (
          <span
            className={
              task.checklist.done === task.checklist.total
                ? 'checklist-badge done'
                : 'checklist-badge'
            }
            title="체크리스트 진행률"
          >
            ✓ {checklistText(task.checklist)}
          </span>
        )}
        {task.dueDate && (
          <span className={isOverdue(task) ? 'overdue small' : 'muted small'}>{task.dueDate}</span>
        )}
      </div>
    </div>
  );
}

function Column({ status, tasks, disabled, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${status}` });
  return (
    <section
      ref={setNodeRef}
      className={`column${isOver ? ' over' : ''}`}
      aria-label={STATUS_LABELS[status]}
      data-status={status}
    >
      <h3>
        {STATUS_LABELS[status]} <span className="muted small">{tasks.length}</span>
      </h3>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="column-body">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} disabled={disabled} onOpen={onOpen} />
          ))}
          {tasks.length === 0 && <p className="muted small empty">여기로 끌어다 놓으세요</p>}
        </div>
      </SortableContext>
    </section>
  );
}

// 칸반 보드. 드래그 결과는 즉시(낙관적으로) 반영하고, 서버 요청이 실패하면 되돌린다.
export default function TaskBoard({ project, archived, filters, onOpenTask }) {
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = useState(null);

  const params = { ...filters, groupBy: 'status', limit: undefined };
  const key = ['tasks', project.id, 'board', params];
  const { data, isPending, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => listProjectTasks(project.id, params),
    placeholderData: (prev) => prev,
  });
  const columns = data?.columns;

  const sensors = useSensors(
    // 클릭(모달 열기)과 드래그를 구분하기 위해 일정 거리 이상 움직여야 드래그가 시작된다.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = useMutation({
    mutationFn: ({ id, body }) => moveTask(id, body),
    onMutate: async ({ next }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', project.id] });
      const snapshot = queryClient.getQueryData(key);
      queryClient.setQueryData(key, { columns: next });
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => queryClient.setQueryData(key, ctx.snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', project.id] }),
  });

  const columnOf = (id) => STATUSES.find((s) => columns[s].some((t) => t.id === id));

  const onDragEnd = ({ active, over }) => {
    setActiveTask(null);
    if (!over || archived || !columns) return;

    const from = columnOf(active.id);
    const overIsColumn = String(over.id).startsWith(COLUMN_PREFIX);
    const to = overIsColumn ? String(over.id).slice(COLUMN_PREFIX.length) : columnOf(over.id);
    if (!from || !to) return;

    const moving = columns[from].find((t) => t.id === active.id);
    const oldIndex = columns[from].findIndex((t) => t.id === active.id);
    const target = columns[to].filter((t) => t.id !== active.id);

    let index = target.length; // 컬럼 영역에 놓으면 맨 아래
    if (!overIsColumn) {
      const overIndex = target.findIndex((t) => t.id === over.id);
      const dragged = active.rect.current.translated;
      const below =
        dragged && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2;
      index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
    }
    if (from === to && index === oldIndex) return;

    const next = { ...columns };
    next[from] = columns[from].filter((t) => t.id !== active.id);
    next[to] = [...target.slice(0, index), { ...moving, status: to }, ...target.slice(index)];

    move.mutate({
      id: active.id,
      next,
      body: {
        status: to,
        beforeTaskId: target[index - 1]?.id ?? null,
        afterTaskId: target[index]?.id ?? null,
      },
    });
  };

  if (isPending) return <p className="muted">불러오는 중…</p>;
  if (isError) {
    return (
      <p role="alert" className="error">
        {errorMessage(error, '보드를 불러오지 못했습니다.')}
      </p>
    );
  }

  return (
    <>
      {move.isError && (
        <p role="alert" className="error">
          {errorMessage(move.error, '작업을 이동하지 못했습니다.')}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) =>
          setActiveTask(STATUSES.flatMap((s) => columns[s]).find((t) => t.id === active.id))
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="board">
          {STATUSES.map((s) => (
            <Column key={s} status={s} tasks={columns[s]} disabled={archived} onOpen={onOpenTask} />
          ))}
        </div>
        <DragOverlay>{activeTask ? <TaskCard task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    </>
  );
}

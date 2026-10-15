import { z } from 'zod';
import * as usersRepo from '../modules/users/repository.js';
import * as projectsRepo from '../modules/projects/repository.js';
import { projectRoom } from './emitter.js';
import { logger } from '../utils/logger.js';

const uuid = z.uuid();

// 소켓 룸 입장도 REST 와 같은 멤버십 규칙을 따른다. (Admin 은 모든 프로젝트)
// 매 입장마다 사용자의 활성 여부와 역할을 DB 에서 다시 확인한다.
export function registerRoomHandlers(socket) {
  socket.on('project:join', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const parsed = uuid.safeParse(payload?.projectId);
      if (!parsed.success) return reply({ ok: false, error: 'INVALID_PROJECT_ID' });

      const user = await usersRepo.findById(socket.data.user.id);
      if (!user || !user.is_active) return reply({ ok: false, error: 'UNAUTHORIZED' });

      const project = await projectsRepo.findById(parsed.data);
      if (!project) return reply({ ok: false, error: 'NOT_FOUND' });

      if (user.role !== 'admin' && !(await projectsRepo.isMember(project.id, user.id))) {
        return reply({ ok: false, error: 'FORBIDDEN' });
      }
      await socket.join(projectRoom(project.id));
      reply({ ok: true });
    } catch (err) {
      logger.error({ err: err.message }, 'socket project:join failed');
      reply({ ok: false, error: 'INTERNAL_ERROR' });
    }
  });

  socket.on('project:leave', async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const parsed = uuid.safeParse(payload?.projectId);
    if (parsed.success) await socket.leave(projectRoom(parsed.data));
    reply({ ok: true });
  });
}

import { conflict, notFound, unauthorized } from '../../utils/errors.js';
import { hashPassword, verifyPassword } from '../../utils/crypto.js';
import * as repo from './repository.js';
import * as auth from '../auth/service.js';

export async function list({ q, page, limit }) {
  const { rows, total } = await repo.search({ q, limit, offset: (page - 1) * limit });
  return { data: rows.map(repo.toUser), meta: { page, limit, total } };
}

// 마지막 활성 Admin 을 강등/비활성화하면 아무도 관리할 수 없게 되므로 막는다.
async function assertNotLastAdmin(target) {
  if (target.role === 'admin' && target.is_active && (await repo.countActiveAdmins()) <= 1) {
    throw conflict('LAST_ADMIN', '마지막 관리자는 변경할 수 없습니다.');
  }
}

export async function changeRole(id, role) {
  const target = await repo.findById(id);
  if (!target) throw notFound('사용자를 찾을 수 없습니다.');
  if (role !== 'admin') await assertNotLastAdmin(target);
  return repo.toUser(await repo.updateRole(id, role));
}

export async function changeStatus(id, isActive) {
  const target = await repo.findById(id);
  if (!target) throw notFound('사용자를 찾을 수 없습니다.');
  if (!isActive) await assertNotLastAdmin(target);
  const row = await repo.updateStatus(id, isActive);
  if (!isActive) await auth.revokeAllSessions(id); // 비활성화 즉시 모든 세션 종료
  return repo.toUser(row);
}

// 비밀번호를 바꾸면 기존 세션을 모두 종료하고 새 세션을 발급한다.
export async function updateMe(userId, { name, currentPassword, newPassword }) {
  let passwordHash;
  if (newPassword) {
    const row = await repo.findById(userId);
    if (!currentPassword || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw unauthorized('현재 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
    }
    passwordHash = await hashPassword(newPassword);
  }
  const updated = await repo.updateProfile(userId, { name, passwordHash });
  const user = repo.toUser(updated);
  if (!passwordHash) return { user };

  await auth.revokeAllSessions(userId);
  return { user, ...(await auth.createSession(userId)) };
}

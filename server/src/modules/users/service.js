import crypto from 'node:crypto';
import { AppError, conflict, notFound, unauthorized } from '../../utils/errors.js';
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

export async function updatePreferences(userId, patch) {
  return repo.toUser(await repo.updatePreferences(userId, patch));
}

// ---- 내 데이터 (M30) ----
export async function exportMyData(userId) {
  const row = await repo.findById(userId);
  const data = await repo.exportData(userId);
  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
      githubLogin: row.github_login ?? null,
      preferences: repo.toUser(row).preferences,
    },
    ...data,
  };
}

// 탈퇴: 이메일을 똑같이 입력하고(비밀번호가 있으면 비밀번호도), 소유한 프로젝트가 없어야 한다.
export async function deleteMe(userId, { confirmEmail, currentPassword }) {
  const row = await repo.findById(userId);
  if (!row) throw notFound('사용자를 찾을 수 없습니다.');
  if (
    String(confirmEmail ?? '')
      .trim()
      .toLowerCase() !== row.email
  ) {
    throw new AppError(400, 'EMAIL_MISMATCH', '확인용 이메일이 계정 이메일과 다릅니다.');
  }
  if (row.password_set !== false) {
    if (!currentPassword || !(await verifyPassword(currentPassword, row.password_hash))) {
      throw unauthorized('현재 비밀번호가 올바르지 않습니다.', 'INVALID_CREDENTIALS');
    }
  }
  await assertNotLastAdmin(row);
  const owned = await repo.ownedProjectNames(userId);
  if (owned.length > 0) {
    const shown = owned.slice(0, 3).join(', ');
    throw conflict(
      'OWNS_PROJECTS',
      `소유한 프로젝트가 있습니다(${shown}${owned.length > 3 ? ' 외' : ''}). 프로젝트를 삭제한 뒤 다시 시도해 주세요.`,
    );
  }
  await repo.anonymize(userId, await hashPassword(crypto.randomBytes(32).toString('base64url')));
  await auth.revokeAllSessions(userId);
}

// 비밀번호를 바꾸면 기존 세션을 모두 종료하고 새 세션을 발급한다.
export async function updateMe(userId, { name, currentPassword, newPassword }, meta) {
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
  return { user, ...(await auth.createSession(userId, meta)) };
}

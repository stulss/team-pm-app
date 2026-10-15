export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = '인증이 필요합니다.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
export const forbidden = (message = '권한이 없습니다.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = '찾을 수 없습니다.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new AppError(409, code, message);

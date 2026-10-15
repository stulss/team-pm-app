import { logger } from '../utils/logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // 요청 본문이 너무 큼(express.json limit)
  if (err.type === 'entity.too.large') {
    return res
      .status(413)
      .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '요청 내용이 너무 큽니다.' } });
  }
  // express.json() 파싱 실패 등 body-parser 에러
  if (err.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 JSON 형식입니다.' } });
  }

  const status = err.status ?? 500;
  if (status >= 500) logger.error({ err, reqId: req.id }, 'unhandled error');
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: status >= 500 ? 'Internal server error' : err.message,
      ...(err.details && { details: err.details }),
    },
  });
}

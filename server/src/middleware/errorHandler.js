export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // express.json() 파싱 실패 등 body-parser 에러
  if (err.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: '잘못된 JSON 형식입니다.' } });
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: status >= 500 ? 'Internal server error' : err.message,
      ...(err.details && { details: err.details }),
    },
  });
}

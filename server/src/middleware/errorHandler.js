export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'),
      message: status >= 500 ? 'Internal server error' : err.message,
    },
  });
}

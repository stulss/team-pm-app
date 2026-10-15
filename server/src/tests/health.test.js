import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const query = vi.fn();
vi.mock('../config/db.js', () => ({ query, pool: {} }));

const { app } = await import('../app.js');

describe('GET /api/v1/health', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('200 when the database responds', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('503 when the database is down', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', db: 'down' });
  });

  it('404 with the standard error format for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

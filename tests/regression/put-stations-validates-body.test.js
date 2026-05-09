'use strict';

const { startTestServer } = require('../helpers/server');

function adminToken(ctx) {
  return ctx.signToken({
    name: 'Admin',
    email: 'admin@ec.gc.ca',
    permissions: 'Full Admin',
    admin: 'Yes'
  });
}

describe('PUT /api/stations validates request body', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('rejects missing body with 400', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: { authorization: `Bearer ${adminToken(ctx)}` }
    });
    expect(res.statusCode).toBe(400);
  });

  test('rejects null body with 400', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: {
        authorization: `Bearer ${adminToken(ctx)}`,
        'content-type': 'application/json'
      },
      payload: 'null'
    });
    expect(res.statusCode).toBe(400);
  });

  test('rejects empty-object body (no stationData) with 400', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: { authorization: `Bearer ${adminToken(ctx)}` },
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  test('rejects array body with 400', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: {
        authorization: `Bearer ${adminToken(ctx)}`,
        'content-type': 'application/json'
      },
      payload: '[]'
    });
    expect(res.statusCode).toBe(400);
  });

  test('rejects non-object stationData with 400', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: { authorization: `Bearer ${adminToken(ctx)}` },
      payload: { stationData: 'notanobject' }
    });
    expect(res.statusCode).toBe(400);
  });

  test('valid body does NOT 400 (handler proceeds)', async () => {
    const res = await ctx.fastify.inject({
      method: 'PUT',
      url: '/api/stations',
      headers: { authorization: `Bearer ${adminToken(ctx)}` },
      payload: { stationData: { station_id: 'test-1', name: 'Test Station' } }
    });
    expect(res.statusCode).not.toBe(400);
  });
});

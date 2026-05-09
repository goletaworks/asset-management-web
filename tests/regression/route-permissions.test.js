'use strict';

const { startTestServer } = require('../helpers/server');

const ENDPOINTS = [
  { method: 'POST', url: '/api/algo/optimize-workplan', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/algo/group-repairs-into-trips', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/algo/assign-trips-to-years', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/algo/assign-repairs-individually', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/algo/group-trips-within-years', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/algo/assign-repairs-with-deadlines', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/excel/list-sheets', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/excel/parse-rows-from-sheet', required: 'READ_EDIT' },
  { method: 'POST', url: '/api/stations/invalidate', required: 'READ_EDIT' },
  { method: 'GET',  url: '/api/auth/users', required: 'FULL_ADMIN' },
];

const LEVEL_VALUES = {
  READ_ONLY: { permissions: 'Read Only', admin: 'No' },
  READ_EDIT: { permissions: 'Read and Edit', admin: 'No' },
  READ_EDIT_GI: { permissions: 'Read and Edit, including General Info, and Add Infrastructure', admin: 'No' },
  FULL_ADMIN: { permissions: 'Full Admin', admin: 'Yes' }
};

function tokenFor(ctx, level, name = 'Tester') {
  const claims = {
    name,
    email: `${level.toLowerCase()}@ec.gc.ca`,
    ...LEVEL_VALUES[level]
  };
  return ctx.signToken(claims);
}

describe('Permission preHandlers gate previously open routes', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  for (const ep of ENDPOINTS) {
    test(`${ep.method} ${ep.url} → 403 for READ_ONLY`, async () => {
      const token = tokenFor(ctx, 'READ_ONLY');
      const res = await ctx.fastify.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${token}` },
        payload: ep.method === 'POST' ? {} : undefined
      });
      expect(res.statusCode).toBe(403);
    });

    test(`${ep.method} ${ep.url} → not 403 with ${ep.required} access`, async () => {
      const token = tokenFor(ctx, ep.required);
      const res = await ctx.fastify.inject({
        method: ep.method,
        url: ep.url,
        headers: { authorization: `Bearer ${token}` },
        payload: ep.method === 'POST' ? {} : undefined
      });
      // We don't care whether the handler returns 200, 400, or 500 — just
      // that the permission gate did not produce 403.
      expect(res.statusCode).not.toBe(403);
    });
  }
});

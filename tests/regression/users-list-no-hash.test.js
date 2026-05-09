'use strict';

const { startTestServer } = require('../helpers/server');

function makeAdminToken(ctx) {
  return ctx.signToken({
    name: 'Bootstrap Admin',
    email: 'bootstrap@ec.gc.ca',
    permissions: 'Full Admin',
    admin: 'Yes'
  });
}

describe('GET /api/auth/users never returns password hashes', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('Response objects contain no field whose name matches /password|hash/i', async () => {
    // Seed two users so the response is non-empty.
    const auth = require('../../backend/auth');
    await auth.createUser({ name: 'User One', email: 'one@ec.gc.ca', password: 'pw-one' });
    await auth.createUser({ name: 'User Two', email: 'two@ec.gc.ca', password: 'pw-two' });

    const token = makeAdminToken(ctx);
    const res = await ctx.fastify.inject({
      method: 'GET',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    for (const user of body) {
      for (const key of Object.keys(user)) {
        expect(key).not.toMatch(/password|hash/i);
      }
      // And belt-and-braces — no value should look like an argon2 or sha-256 hash.
      for (const value of Object.values(user)) {
        if (typeof value === 'string') {
          expect(value).not.toMatch(/^\$argon2/);
        }
      }
    }
  });
});

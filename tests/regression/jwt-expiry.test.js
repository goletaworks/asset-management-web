'use strict';

const { startTestServer } = require('../helpers/server');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('JWT tokens expire', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('a token signed with a short expiresIn is rejected after it has expired', async () => {
    // Warm the persistence layer so the first token-protected request below
    // does not race against the JWT expiry by paying a cold-start latency.
    const warm = ctx.signToken({
      name: 'Warm', email: 'warm@ec.gc.ca', permissions: 'Full Admin', admin: 'Yes'
    });
    await ctx.fastify.inject({
      method: 'GET', url: '/api/auth/users', headers: { authorization: `Bearer ${warm}` }
    });

    const token = ctx.signToken({
      name: 'Expiring User',
      email: 'expiring@ec.gc.ca',
      permissions: 'Full Admin',
      admin: 'Yes'
    }, { expiresIn: '2s' });

    // Sanity: token currently works
    const before = await ctx.fastify.inject({
      method: 'GET',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(before.statusCode).toBe(200);

    await sleep(2500);

    const after = await ctx.fastify.inject({
      method: 'GET',
      url: '/api/auth/users',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(after.statusCode).toBe(401);
  }, 15000);

  test('login endpoint stamps an exp claim on issued tokens', async () => {
    // Create a real user and log them in
    const auth = require('../../backend/auth');
    await auth.createUser({ name: 'Alice', email: 'alice@ec.gc.ca', password: 'alice-pw' });

    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { name: 'alice@ec.gc.ca', password: 'alice-pw' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');

    const parts = body.token.split('.');
    expect(parts.length).toBe(3);
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(typeof claims.exp).toBe('number');
    expect(typeof claims.iat).toBe('number');
    // 8 hours = 28800 seconds; allow ±60s for clock drift
    const ttl = claims.exp - claims.iat;
    expect(Math.abs(ttl - 28800)).toBeLessThan(60);
  });
});

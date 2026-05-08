'use strict';

const crypto = require('crypto');
const { startTestServer } = require('../helpers/server');

describe('Auth bypass cannot be enabled', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('GET /api/stations without token returns 401', async () => {
    const res = await ctx.fastify.inject({ method: 'GET', url: '/api/stations' });
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/auth/users without token returns 401', async () => {
    const res = await ctx.fastify.inject({ method: 'GET', url: '/api/auth/users' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/algo/optimize-workplan without token returns 401', async () => {
    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/algo/optimize-workplan',
      payload: {}
    });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/algo/optimize-workplan with token signed by a different secret returns 401', async () => {
    // fastify/jwt verifies HS256 with the configured secret. A token signed with
    // any other secret must not be accepted.
    const otherSecret = crypto.randomBytes(64).toString('hex');
    // Build a minimal HS256 token by hand to avoid taking on a JWT lib dep here.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      name: 'Attacker',
      email: 'attacker@evil.com',
      permissions: 'Full Admin',
      admin: 'Yes',
      iat: Math.floor(Date.now() / 1000)
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', otherSecret).update(`${header}.${payload}`).digest('base64url');
    const token = `${header}.${payload}.${sig}`;

    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/algo/optimize-workplan',
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
  });

  test('no path produces a Developer-identity user', () => {
    // Verify the source no longer contains any reference to the bypass user
    // or the legacy bypass flag. This is a defense-in-depth assertion.
    const fs = require('fs');
    const path = require('path');
    const REPO = path.resolve(__dirname, '..', '..');

    const filesToCheck = [
      'plugins/auth.js',
      'backend/auth.js',
      'backend/feature_flags.js',
      'backend/feature-flags.json'
    ];
    for (const rel of filesToCheck) {
      const contents = fs.readFileSync(path.join(REPO, rel), 'utf8');
      expect(contents).not.toMatch(/authEnabled/);
      expect(contents).not.toMatch(/DEV_USER/);
    }
  });
});

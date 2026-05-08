'use strict';

const fs = require('fs');
const path = require('path');
const { startTestServer } = require('../helpers/server');

describe('Access-request flow ignores self-elected permissionLevel', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('Approved access request creates a Read Only user even when Full Admin requested', async () => {
    // Submit the request with a self-elected Full Admin level. The API must ignore it.
    const submit = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/access-request',
      payload: {
        name: 'Mallory',
        email: 'mallory@ec.gc.ca',
        password: 'mallory-pw',
        reason: 'I want all the powers',
        approver: 'Khodayar Ahktarhavari',
        permissionLevel: 'Full Admin'
      }
    });
    expect(submit.statusCode).toBe(200);

    // Read the access code out of the persisted requests file (the email is
    // simulated to the console in tests, so we recover the code by inspecting
    // the on-disk record and consuming it via the create-with-code flow).
    const requestsFile = path.join(ctx.dataDir, 'login', 'access_requests.json');
    expect(fs.existsSync(requestsFile)).toBe(true);
    const requests = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
    const record = requests.find(r => r.email === 'mallory@ec.gc.ca');
    expect(record).toBeTruthy();
    // The persisted record must not carry a self-elected permissionLevel.
    expect(record.permissionLevel).toBeUndefined();

    // Recover the plain code by brute-forcing the 6-digit space against
    // record.codeHash. (Faster + simpler than wiring a fake mailer.)
    const crypto = require('crypto');
    function hashCode(c) {
      return crypto.createHash('sha256').update(String(c)).digest('hex');
    }
    let plain = null;
    for (let i = 100000; i <= 999999; i++) {
      if (hashCode(String(i)) === record.codeHash) { plain = String(i); break; }
    }
    expect(plain).not.toBeNull();

    const consume = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/create-with-code',
      payload: {
        nameOrEmail: 'mallory@ec.gc.ca',
        password: 'mallory-pw',
        accessCode: plain
      }
    });
    expect(consume.statusCode).toBe(200);

    // Inspect persistence: created user must be Read Only / not admin.
    const { getPersistence } = require('../../backend/persistence');
    const persistence = await getPersistence();
    const users = (await persistence.getAllAuthUsers()).users || [];
    const me = users.find(u => String(u.email).toLowerCase() === 'mallory@ec.gc.ca');
    expect(me).toBeTruthy();
    expect(me.permissions).toBe('Read Only');
    expect(me.admin === 'No' || me.admin === false).toBe(true);
  });
});

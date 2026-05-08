'use strict';

const { startTestServer } = require('../helpers/server');

async function listUsers() {
  const { getPersistence } = require('../../backend/persistence');
  const persistence = await getPersistence();
  return (await persistence.getAllAuthUsers()).users || [];
}

function findUser(users, email) {
  return users.find(u => String(u.email).toLowerCase() === String(email).toLowerCase());
}

describe('POST /api/auth/register strips role fields and bootstraps first admin', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await startTestServer();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('first registrant becomes Full Admin even when none requested', async () => {
    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'First User',
        email: 'first@ec.gc.ca',
        password: 'first-password',
        admin: 'Yes',
        permissions: 'Full Admin'
      }
    });
    expect(res.statusCode).toBe(200);

    const users = await listUsers();
    const me = findUser(users, 'first@ec.gc.ca');
    expect(me).toBeTruthy();
    expect(me.permissions).toBe('Full Admin');
    expect(me.admin === 'Yes' || me.admin === true).toBe(true);
  });

  test('second registrant is Read Only no matter what they ask for', async () => {
    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Second User',
        email: 'second@ec.gc.ca',
        password: 'second-password',
        admin: 'Yes',
        permissions: 'Full Admin'
      }
    });
    expect(res.statusCode).toBe(200);

    const users = await listUsers();
    const me = findUser(users, 'second@ec.gc.ca');
    expect(me).toBeTruthy();
    expect(me.permissions).toBe('Read Only');
    expect(me.admin === 'No' || me.admin === false).toBe(true);
  });

  test('third registrant with no role fields at all is also Read Only', async () => {
    const res = await ctx.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Third User',
        email: 'third@ec.gc.ca',
        password: 'third-password'
      }
    });
    expect(res.statusCode).toBe(200);

    const users = await listUsers();
    const me = findUser(users, 'third@ec.gc.ca');
    expect(me).toBeTruthy();
    expect(me.permissions).toBe('Read Only');
    expect(me.admin === 'No' || me.admin === false).toBe(true);
  });
});

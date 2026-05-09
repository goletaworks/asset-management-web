'use strict';

const crypto = require('crypto');
const { startTestServer } = require('../helpers/server');
const { hashPassword, verifyPassword } = require('../../backend/password');

function legacySha256(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex');
}

describe('Password hashing — argon2id with legacy SHA-256 fallback', () => {
  test('hashPassword produces an argon2id digest', async () => {
    const hash = await hashPassword('s3cret-passw0rd!');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  test('verifyPassword accepts the correct plaintext for an argon2id hash', async () => {
    const pw = 'correct horse battery staple';
    const hash = await hashPassword(pw);
    const result = await verifyPassword(pw, hash);
    expect(result).toEqual({ valid: true, needsRehash: false });
  });

  test('verifyPassword rejects the wrong plaintext for an argon2id hash', async () => {
    const hash = await hashPassword('one');
    const result = await verifyPassword('two', hash);
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  test('verifyPassword accepts the right plaintext for a legacy SHA-256 hash and signals rehash', async () => {
    const pw = 'legacy-pw';
    const stored = legacySha256(pw);
    const result = await verifyPassword(pw, stored);
    expect(result).toEqual({ valid: true, needsRehash: true });
  });

  test('verifyPassword rejects the wrong plaintext for a legacy SHA-256 hash', async () => {
    const stored = legacySha256('one');
    const result = await verifyPassword('two', stored);
    expect(result).toEqual({ valid: false, needsRehash: false });
  });

  test('verifyPassword rejects empty/non-string stored hashes', async () => {
    expect(await verifyPassword('x', '')).toEqual({ valid: false, needsRehash: false });
    expect(await verifyPassword('x', null)).toEqual({ valid: false, needsRehash: false });
    expect(await verifyPassword('x', undefined)).toEqual({ valid: false, needsRehash: false });
  });
});

describe('Login flow upgrades legacy SHA-256 to argon2id transparently', () => {
  let ctx;
  let fs;
  let path;

  beforeAll(async () => {
    ctx = await startTestServer();
    fs = require('fs');
    path = require('path');
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  test('legacy SHA-256 stored hash is upgraded to argon2 after a successful login', async () => {
    // Seed a user directly via the persistence layer with a SHA-256 hash so we
    // can exercise the legacy-upgrade code path on login.
    const auth = require('../../backend/auth');
    const { getPersistence } = require('../../backend/persistence');
    const persistence = await getPersistence();

    const email = 'legacy-upgrade@ec.gc.ca';
    const password = 'legacy-secret';

    const sha = legacySha256(password);
    const create = await persistence.createAuthUser({
      name: 'Legacy User',
      email,
      password: sha,
      admin: 'No',
      permissions: 'Read Only',
      status: 'Inactive',
      created: new Date().toISOString(),
      lastLogin: ''
    });
    expect(create.success).toBe(true);

    // Sanity: stored hash starts as the SHA-256 hex
    let users = (await persistence.getAllAuthUsers()).users;
    let me = users.find(u => String(u.email).toLowerCase() === email);
    expect(me).toBeTruthy();
    expect(me.password).toBe(sha);

    // Log in with the plaintext
    const login = await auth.loginUser(email, password);
    expect(login.success).toBe(true);

    // Stored hash should now be argon2id
    users = (await persistence.getAllAuthUsers()).users;
    me = users.find(u => String(u.email).toLowerCase() === email);
    expect(me).toBeTruthy();
    expect(String(me.password)).toMatch(/^\$argon2id\$/);

    // Subsequent login still works with the same plaintext
    const second = await auth.loginUser(email, password);
    expect(second.success).toBe(true);
  });
});

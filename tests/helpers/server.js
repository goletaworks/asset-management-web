'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function purgeRequireCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(REPO_ROOT) && !key.includes(path.join('node_modules', ''))) {
      delete require.cache[key];
    }
  }
}

async function startTestServer({ jwtSecret, env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasmgt-test-'));
  const dbConfigPath = path.join(dataDir, 'db-config.json');
  fs.writeFileSync(
    dbConfigPath,
    JSON.stringify({
      database: { type: 'mongodb', connectionString: 'mongodb://localhost:27017/asmgt-test' },
      read: { source: 'excel' },
      write: { targets: ['excel'] }
    }),
    'utf8'
  );

  const secret = jwtSecret || crypto.randomBytes(64).toString('hex');

  process.env.JWT_SECRET = secret;
  process.env.KASMGT_DATA_DIR = dataDir;
  process.env.KASMGT_DB_CONFIG = dbConfigPath;
  process.env.NODE_ENV = 'test';
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }

  // Reset any cached modules so they pick up new env vars (KASMGT_DATA_DIR, etc.)
  purgeRequireCache();

  const fastify = require('fastify')({ logger: false });
  fastify.register(require('@fastify/cors'), { origin: true, credentials: true });
  fastify.register(require('@fastify/cookie'));
  fastify.register(require('@fastify/jwt'), {
    secret,
    cookie: { cookieName: 'token', signed: false }
  });
  fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 100 * 1024 * 1024 }
  });
  fastify.register(require('@fastify/formbody'));

  fastify.register(require(path.join(REPO_ROOT, 'plugins/auth')));
  fastify.register(require(path.join(REPO_ROOT, 'plugins/permissions')));

  fastify.register(require(path.join(REPO_ROOT, 'routes/auth')), { prefix: '/api/auth' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/stations')), { prefix: '/api/stations' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/lookups')), { prefix: '/api/lookups' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/colors')), { prefix: '/api/colors' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/materials')), { prefix: '/api/materials' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/inspections')), { prefix: '/api/inspections' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/projects')), { prefix: '/api/projects' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/repairs')), { prefix: '/api/repairs' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/photos')), { prefix: '/api/photos' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/documents')), { prefix: '/api/documents' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/excel')), { prefix: '/api/excel' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/algorithms')), { prefix: '/api/algo' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/settings')), { prefix: '/api/settings' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/nuke')), { prefix: '/api/nuke' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/config')), { prefix: '/api/config' });
  fastify.register(require(path.join(REPO_ROOT, 'routes/progress')), { prefix: '/api/progress' });

  await fastify.ready();

  function signToken(claims, opts) {
    return fastify.jwt.sign(claims, opts);
  }

  async function cleanup() {
    try { await fastify.close(); } catch (_) {}
    try {
      // Best-effort cleanup; ignore errors
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  }

  return { fastify, dataDir, jwtSecret: secret, signToken, cleanup };
}

module.exports = { startTestServer };

'use strict';

require('dotenv').config();
const path = require('path');
const fastify = require('fastify')({ logger: true });

// ── Core plugins ──────────────────────────────────────────────────────────────
fastify.register(require('@fastify/cors'), { origin: true, credentials: true });
fastify.register(require('@fastify/cookie'));
fastify.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET || 'change-me-to-a-real-secret',
  cookie: { cookieName: 'token', signed: false }
});
fastify.register(require('@fastify/multipart'), {
  limits: { fileSize: 100 * 1024 * 1024 }
});
fastify.register(require('@fastify/formbody'));
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'frontend'),
  prefix: '/'
});

// ── App plugins ───────────────────────────────────────────────────────────────
fastify.register(require('./plugins/auth'));
fastify.register(require('./plugins/permissions'));

// ── API routes ────────────────────────────────────────────────────────────────
fastify.register(require('./routes/auth'),       { prefix: '/api/auth' });
fastify.register(require('./routes/stations'),   { prefix: '/api/stations' });
fastify.register(require('./routes/lookups'),    { prefix: '/api/lookups' });
fastify.register(require('./routes/colors'),     { prefix: '/api/colors' });
fastify.register(require('./routes/materials'),  { prefix: '/api/materials' });
fastify.register(require('./routes/inspections'),{ prefix: '/api/inspections' });
fastify.register(require('./routes/projects'),   { prefix: '/api/projects' });
fastify.register(require('./routes/repairs'),    { prefix: '/api/repairs' });
fastify.register(require('./routes/photos'),     { prefix: '/api/photos' });
fastify.register(require('./routes/documents'),  { prefix: '/api/documents' });
fastify.register(require('./routes/excel'),      { prefix: '/api/excel' });
fastify.register(require('./routes/algorithms'), { prefix: '/api/algo' });
fastify.register(require('./routes/settings'),   { prefix: '/api/settings' });
fastify.register(require('./routes/nuke'),       { prefix: '/api/nuke' });
fastify.register(require('./routes/config'),     { prefix: '/api/config' });
fastify.register(require('./routes/progress'),   { prefix: '/api/progress' });

// ── Bootstrap (mirrors Electron main.js app.whenReady) ────────────────────────
const config  = require('./backend/config');
const lookups = require('./backend/lookups_repo');
const { getPersistence } = require('./backend/persistence');

async function bootstrap() {
  const dbConfig = config.getDbConfig();
  const useExcel = dbConfig.read?.source === 'excel' ||
                   (dbConfig.write?.targets || []).includes('excel');

  await getPersistence();
  console.log('[Server] Persistence layer initialized');

  if (typeof lookups.ensureDataFoldersSync === 'function') {
    lookups.ensureDataFoldersSync();
  }

  if (useExcel) {
    const excel = require('./backend/excel_worker_client');
    await excel.warm();
    console.log('[Server] Excel worker warmed');
    await lookups.ensureLookupsReady?.();
    excel.normalizeFundingOverrides?.().catch(() => {});
  }

  await lookups.primeAllCaches?.();
  console.log('[Server] Lookups caches primed');

  const auth = require('./backend/auth');
  await auth.initAuthWorkbook();
  console.log('[Server] Auth workbook initialized');
}

bootstrap()
  .then(() => fastify.listen({ port: parseInt(process.env.PORT, 10) || 3000, host: '0.0.0.0' }))
  .then((addr) => fastify.log.info(`Server listening on ${addr}`))
  .catch((err) => {
    console.error('[Server] Fatal startup error:', err);
    process.exit(1);
  });

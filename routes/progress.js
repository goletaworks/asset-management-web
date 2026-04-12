'use strict';

const config = require('../backend/config');

async function progressRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial heartbeat
    reply.raw.write('data: {"type":"connected"}\n\n');

    const dbConfig = config.getDbConfig();
    const useExcel = dbConfig.read?.source === 'excel' ||
                     (dbConfig.write?.targets || []).includes('excel');

    let unsubscribe = null;
    if (useExcel) {
      try {
        const excel = require('../backend/excel_worker_client');
        unsubscribe = excel.onProgress((data) => {
          try {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
          } catch (_) {}
        });
      } catch (_) {}
    }

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); }
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      if (typeof unsubscribe === 'function') unsubscribe();
    });

    // Prevent Fastify from closing the response
    reply.hijack();
  });
}

module.exports = progressRoutes;

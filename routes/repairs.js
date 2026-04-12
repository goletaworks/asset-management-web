'use strict';

const repairsBackend = require('../backend/repairs');
const backend = require('../backend/app');

async function repairRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/', async (request) => {
    const { siteName, stationId } = request.query;
    return repairsBackend.listRepairs(siteName, stationId);
  });

  fastify.post('/save', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Save repairs')],
  }, async (request) => {
    const { siteName, stationId, items } = request.body;
    return repairsBackend.saveRepairs(siteName, stationId, items);
  });

  fastify.post('/append', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Append repairs')],
  }, async (request) => {
    return backend.appendRepair(request.body);
  });

  fastify.get('/all', async () => repairsBackend.getAllRepairs());

  fastify.post('/add', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add repairs')],
  }, async (request) => {
    const { location, assetType, repair } = request.body;
    return repairsBackend.addRepair(location, assetType, repair);
  });
}

module.exports = repairRoutes;

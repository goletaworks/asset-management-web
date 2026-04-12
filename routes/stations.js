'use strict';

const backend = require('../backend/app');
const { getPersistence } = require('../backend/persistence');

async function stationRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/', async (request) => {
    return backend.getStationData(request.query || {});
  });

  fastify.post('/invalidate', async () => {
    return backend.invalidateStationCache();
  });

  fastify.post('/import', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Import stations')],
  }, async (request) => {
    return backend.addStationsFromSelection(request.body);
  });

  fastify.post('/manual', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Add infrastructure manually')],
  }, async (request) => {
    return backend.manualAddInstance(request.body);
  });

  fastify.put('/', async (request, reply) => {
    const { stationData, schema } = request.body || {};

    if (!fastify.hasPermission(request.user, PL.READ_EDIT)) {
      return reply.code(403).send({
        success: false,
        code: 'forbidden',
        message: 'Update station data requires Read and Edit access.'
      });
    }

    const requiresGI = fastify.touchesGeneralInformation(stationData);
    if (!requiresGI) {
      const sanitized = fastify.stripGeneralInformation(stationData);
      return backend.updateStationData(sanitized, schema);
    }

    if (!fastify.hasPermission(request.user, PL.READ_EDIT_GI)) {
      return reply.code(403).send({
        success: false,
        code: 'forbidden',
        message: 'Update General Information requires Read and Edit, including General Info, and Add Infrastructure access.'
      });
    }
    return backend.updateStationData(stationData, schema);
  });

  fastify.delete('/:company/:location/:stationId', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Delete station')],
  }, async (request) => {
    const { company, location, stationId } = request.params;
    const persistence = await getPersistence();
    const result = await persistence.deleteStation(company, location, stationId);
    if (result.success) {
      await backend.invalidateStationCache();
    }
    return result;
  });
}

module.exports = stationRoutes;

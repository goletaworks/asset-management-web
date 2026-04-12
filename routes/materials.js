'use strict';

const backend = require('../backend/app');

async function materialRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/', async (request) => {
    return backend.getMaterialsForCompany(request.query.company);
  });

  fastify.post('/location', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add storage location')],
  }, async (request) => {
    const { company, payload } = request.body;
    return backend.saveStorageLocation(company, payload);
  });

  fastify.post('/material', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit materials')],
  }, async (request) => {
    const { company, payload } = request.body;
    return backend.saveMaterial(company, payload);
  });

  fastify.delete('/material', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete materials')],
  }, async (request) => {
    const { company, materialId } = request.body;
    return backend.deleteMaterial(company, materialId);
  });

  fastify.post('/filters', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit material filters')],
  }, async (request) => {
    const { company, filters } = request.body;
    return backend.saveMaterialFilters(company, filters);
  });
}

module.exports = materialRoutes;

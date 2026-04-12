'use strict';

const lookups = require('../backend/lookups_repo');

async function settingsRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/status', async () => lookups.getStatusAndRepairSettings());

  fastify.put('/status-color', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit status colors')],
  }, async (request) => {
    const { key, color } = request.body;
    return lookups.setStatusColor(key, color);
  });

  fastify.delete('/status', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete status rows')],
  }, async (request) => {
    return lookups.deleteStatus(request.body.key);
  });

  fastify.put('/apply-status-colors', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Toggle status colors')],
  }, async (request) => {
    return lookups.setApplyStatusColors(!!request.body.flag);
  });

  fastify.put('/apply-repair-colors', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Toggle repair colors')],
  }, async (request) => {
    return lookups.setApplyRepairColors(!!request.body.flag);
  });

  fastify.put('/status-priority', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit status priority')],
  }, async (request) => {
    return lookups.setStatusOverridesRepair(!!request.body.flag);
  });

  // Photos base path
  fastify.get('/photos-base', async (request) => {
    return lookups.getPhotosBase(request.query);
  });
}

module.exports = settingsRoutes;

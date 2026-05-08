'use strict';

const algorithms = require('../backend/algorithms');

async function algorithmRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.post('/optimize-workplan', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Optimize workplan')],
  }, async (request) => {
    return algorithms.optimizeWorkplan(request.body);
  });

  fastify.post('/group-repairs-into-trips', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Group repairs into trips')],
  }, async (request) => {
    return algorithms.groupRepairsIntoTrips(request.body);
  });

  fastify.post('/assign-trips-to-years', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Assign trips to years')],
  }, async (request) => {
    return algorithms.assignTripsToYears(request.body);
  });

  fastify.post('/assign-repairs-individually', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Assign repairs individually')],
  }, async (request) => {
    return algorithms.assignRepairsToYearsIndividually(request.body);
  });

  fastify.post('/group-trips-within-years', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Group trips within years')],
  }, async (request) => {
    return algorithms.groupTripsWithinYears(request.body);
  });

  fastify.post('/assign-repairs-with-deadlines', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Assign repairs with deadlines')],
  }, async (request) => {
    try {
      return await algorithms.assignRepairsToYearsWithDeadlines(request.body);
    } catch (err) {
      return { success: false, message: err.message };
    }
  });
}

module.exports = algorithmRoutes;

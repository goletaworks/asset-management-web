'use strict';

const algorithms = require('../backend/algorithms');

async function algorithmRoutes(fastify) {
  fastify.post('/optimize-workplan', async (request) => {
    return algorithms.optimizeWorkplan(request.body);
  });

  fastify.post('/group-repairs-into-trips', async (request) => {
    return algorithms.groupRepairsIntoTrips(request.body);
  });

  fastify.post('/assign-trips-to-years', async (request) => {
    return algorithms.assignTripsToYears(request.body);
  });

  fastify.post('/assign-repairs-individually', async (request) => {
    return algorithms.assignRepairsToYearsIndividually(request.body);
  });

  fastify.post('/group-trips-within-years', async (request) => {
    return algorithms.groupTripsWithinYears(request.body);
  });

  fastify.post('/assign-repairs-with-deadlines', async (request) => {
    try {
      return await algorithms.assignRepairsToYearsWithDeadlines(request.body);
    } catch (err) {
      return { success: false, message: err.message };
    }
  });
}

module.exports = algorithmRoutes;

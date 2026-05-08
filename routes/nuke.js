'use strict';

const nukeBackend = require('../backend/nuke');
const backend = require('../backend/app');
const lookups = require('../backend/lookups_repo');
const { assertSafePathSegment } = require('../backend/utils/path_safety');

async function nukeRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.post('/run', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Nuke data')],
  }, async () => {
    try {
      const res = await nukeBackend.nuke();
      if (!res || res.success === false) return res || { success: false };
      return { success: true };
    } catch (e) {
      return { success: false, message: String(e) };
    }
  });

  fastify.post('/delete-company', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Delete company')],
  }, async (request, reply) => {
    const { companyName } = request.body || {};
    try {
      assertSafePathSegment(companyName, 'companyName');
    } catch (err) {
      return reply.code(err.statusCode || 400).send({ success: false, message: err.message });
    }
    const result = await nukeBackend.deleteCompany(companyName);
    if (result.success) {
      await backend.invalidateStationCache();
      lookups.primeAllCaches();
    }
    return result;
  });

  fastify.post('/delete-location', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Delete location')],
  }, async (request, reply) => {
    const { companyName, locationName } = request.body || {};
    try {
      assertSafePathSegment(companyName, 'companyName');
      assertSafePathSegment(locationName, 'locationName');
    } catch (err) {
      return reply.code(err.statusCode || 400).send({ success: false, message: err.message });
    }
    const result = await nukeBackend.deleteLocation(companyName, locationName);
    if (result.success) {
      await backend.invalidateStationCache();
      lookups.primeAllCaches();
    }
    return result;
  });

  fastify.post('/delete-asset-type', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Delete asset type')],
  }, async (request, reply) => {
    const { companyName, locationName, assetTypeName } = request.body || {};
    try {
      assertSafePathSegment(companyName, 'companyName');
      assertSafePathSegment(locationName, 'locationName');
      assertSafePathSegment(assetTypeName, 'assetTypeName');
    } catch (err) {
      return reply.code(err.statusCode || 400).send({ success: false, message: err.message });
    }
    const result = await nukeBackend.deleteAssetType(companyName, locationName, assetTypeName);
    if (result.success) {
      await backend.invalidateStationCache();
      lookups.primeAllCaches();
    }
    return result;
  });
}

module.exports = nukeRoutes;

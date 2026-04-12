'use strict';

const lookups = require('../backend/lookups_repo');

async function colorRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/maps', async () => {
    const maps = await lookups.getColorMaps();
    const toObj = (m) => Object.fromEntries(m instanceof Map ? m : new Map(Object.entries(m || {})));
    const byLocObj = {};
    for (const [loc, inner] of (maps.byLocation instanceof Map ? maps.byLocation : new Map(Object.entries(maps.byLocation || {}))).entries()) {
      byLocObj[loc] = toObj(inner);
    }
    const byCoLocObj = {};
    for (const [co, locMapLike] of (maps.byCompanyLocation instanceof Map ? maps.byCompanyLocation : new Map(Object.entries(maps.byCompanyLocation || {}))).entries()) {
      const locMap = locMapLike instanceof Map ? locMapLike : new Map(Object.entries(locMapLike));
      byCoLocObj[co] = {};
      for (const [loc, inner] of locMap.entries()) byCoLocObj[co][loc] = toObj(inner);
    }
    return { global: toObj(maps.global), byLocation: byLocObj, byCompanyLocation: byCoLocObj };
  });

  fastify.put('/asset-type', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Set asset type color')],
  }, async (request) => {
    const { assetType, color } = request.body;
    return lookups.setAssetTypeColor(assetType, color);
  });

  fastify.put('/asset-type-location', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Set asset type color for location')],
  }, async (request) => {
    const { assetType, location, color } = request.body;
    return lookups.setAssetTypeColorForLocation(assetType, location, color);
  });

  fastify.put('/asset-type-company-location', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Set asset type color for company/location')],
  }, async (request) => {
    const { assetType, company, location, color } = request.body;
    return lookups.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
  });

  fastify.get('/repair-maps', async () => {
    const maps = await lookups.getRepairColorMaps();
    const toObj = (m) => Object.fromEntries(m instanceof Map ? m : new Map(Object.entries(m || {})));
    const byCoLocObj = {};
    const byCo = maps.byCompanyLocation instanceof Map
      ? maps.byCompanyLocation
      : new Map(Object.entries(maps.byCompanyLocation || {}));
    for (const [co, locMapLike] of byCo.entries()) {
      const locMap = locMapLike instanceof Map ? locMapLike : new Map(Object.entries(locMapLike || {}));
      byCoLocObj[co] = {};
      for (const [loc, inner] of locMap.entries()) {
        byCoLocObj[co][loc] = toObj(inner);
      }
    }
    return { byCompanyLocation: byCoLocObj };
  });

  fastify.put('/repair-company-location', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Set repair color')],
  }, async (request) => {
    const { assetType, company, location, color } = request.body;
    return lookups.setRepairColorForCompanyLocation(assetType, company, location, color);
  });
}

module.exports = colorRoutes;

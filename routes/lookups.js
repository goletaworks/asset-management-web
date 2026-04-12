'use strict';

const backend = require('../backend/app');

async function lookupRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/tree', async () => backend.getLookupTree());

  fastify.get('/companies', async () => backend.getActiveCompanies());

  fastify.get('/locations', async (request) => {
    return backend.getLocationsForCompany(request.query.company);
  });

  fastify.get('/asset-types', async (request) => {
    const { company, location } = request.query;
    return backend.getAssetTypesForLocation(company, location);
  });

  fastify.post('/company', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Add or edit a company')],
  }, async (request) => {
    const { name, active, description, email } = request.body;
    return backend.upsertCompany(name, !!active, description, email);
  });

  fastify.post('/location', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Add or edit a location')],
  }, async (request) => {
    const { location, company } = request.body;
    return backend.upsertLocation(location, company);
  });

  fastify.post('/asset-type', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Add or edit an asset type')],
  }, async (request) => {
    const { assetType, company, location } = request.body;
    return backend.upsertAssetType(assetType, company, location);
  });

  fastify.put('/location-link', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit map pin links')],
  }, async (request) => {
    const lookups = require('../backend/lookups_repo');
    const { company, location, link } = request.body;
    return lookups.setLocationLink(company, location, link);
  });

  fastify.put('/asset-type-link', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit map pin links')],
  }, async (request) => {
    const lookups = require('../backend/lookups_repo');
    const { assetType, company, location, link } = request.body;
    return lookups.setAssetTypeLink(assetType, company, location, link);
  });
}

module.exports = lookupRoutes;

'use strict';

const fs = require('fs');
const path = require('path');
const backend = require('../backend/app');
const lookupsRepo = require('../backend/lookups_repo');

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
    const { name, active, description, email, mapProfile } = request.body;
    return backend.upsertCompany(name, !!active, description, email, mapProfile || null);
  });

  fastify.post('/company-map-asset-upload', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Upload company map assets')],
  }, async (request) => {
    const parts = request.parts();
    const fields = {};
    let filePart = null;
    for await (const part of parts) {
      if (part.type === 'file') filePart = part;
      else fields[part.fieldname] = part.value;
    }
    const company = String(fields.company || '').trim();
    if (!company) return { success: false, message: 'Company is required.' };
    if (!filePart) return { success: false, message: 'A file is required.' };
    const buf = await filePart.toBuffer();
    return lookupsRepo.saveCompanyMapAsset(company, {
      name: filePart.filename,
      mimeType: filePart.mimetype,
      data: buf.toString('base64'),
    });
  });

  fastify.get('/company-map-asset', async (request, reply) => {
    const relativePath = String(request.query?.path || '');
    const localPath = lookupsRepo.resolveCompanyMapAssetPath(relativePath);
    if (!localPath) return reply.code(404).send({ success: false, message: 'Map asset not found.' });
    const ext = path.extname(localPath).toLowerCase();
    const mime = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.pdf': 'application/pdf',
    }[ext] || 'application/octet-stream';
    reply.type(mime);
    return reply.send(fs.createReadStream(localPath));
  });

  fastify.get('/company-blueprint-polygons', async (request) => {
    const company = String(request.query?.company || '').trim();
    return lookupsRepo.getCompanyBlueprintPolygons(company);
  });

  fastify.post('/company-blueprint-polygons', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Save company blueprint polygons')],
  }, async (request) => {
    const company = String(request.body?.company || '').trim();
    const polygons = Array.isArray(request.body?.polygons) ? request.body.polygons : [];
    const points = Array.isArray(request.body?.points) ? request.body.points : [];
    return lookupsRepo.saveCompanyBlueprintPolygons(company, polygons, points);
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

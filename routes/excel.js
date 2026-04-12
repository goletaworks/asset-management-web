'use strict';

const backend = require('../backend/app');

let _excelClient = null;
function getExcelClient() {
  if (!_excelClient) {
    _excelClient = require('../backend/excel_worker_client');
  }
  return _excelClient;
}

async function excelRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  // Sheet listing from base64 workbook
  fastify.post('/list-sheets', async (request) => {
    return backend.listExcelSheets(request.body.b64);
  });

  fastify.post('/parse-rows-from-sheet', async (request) => {
    const { b64, sheetName } = request.body;
    return getExcelClient().parseRowsFromSheet(b64, sheetName);
  });

  fastify.post('/import-repairs', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Import repairs from Excel')],
  }, async (request) => {
    return getExcelClient().parseRows(request.body.b64);
  });

  // Location workbook
  fastify.get('/location-workbook', async (request) => {
    const { company, locationName } = request.query;
    return getExcelClient().readLocationWorkbook(company, locationName);
  });

  fastify.get('/sheet-data', async (request) => {
    const { company, locationName, sheetName } = request.query;
    return getExcelClient().readSheetData(company, locationName, sheetName);
  });

  fastify.post('/update-schema', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Update asset type schema')],
  }, async (request) => {
    const { assetType, schema, excludeStationId } = request.body;
    return getExcelClient().updateAssetTypeSchema(assetType, schema, excludeStationId);
  });

  // Schema
  fastify.post('/sync-schema', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Sync schema')],
  }, async (request) => {
    const schemaSync = require('../backend/schema_sync');
    const { assetType, schema, excludeStationId } = request.body;
    return schemaSync.syncAssetTypeSchema(assetType, schema, excludeStationId);
  });

  fastify.get('/existing-schema', async (request) => {
    const schemaSync = require('../backend/schema_sync');
    return schemaSync.getExistingSchemaForAssetType(request.query.assetType);
  });

  // Workbook field catalog
  fastify.get('/field-catalog', async (request) => {
    const { company, locationName } = request.query;
    return getExcelClient().getWorkbookFieldCatalog(company, locationName);
  });

  // Funding settings
  fastify.get('/funding-settings', async (request) => {
    const { company, location } = request.query;
    return getExcelClient().getFundingSettings(company, location);
  });

  fastify.post('/funding-settings', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Edit funding settings')],
  }, async (request) => {
    const { company, location, settings } = request.body;
    return getExcelClient().saveFundingSettings(company, location, settings);
  });

  fastify.post('/funding-settings-asset-type', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Edit funding settings for asset type')],
  }, async (request) => {
    const { company, location, assetType, settings } = request.body;
    return getExcelClient().saveFundingSettingsForAssetType(company, location, assetType, settings);
  });

  fastify.get('/all-funding-settings', async (request) => {
    return getExcelClient().getAllFundingSettings(request.query.company);
  });

  fastify.post('/normalize-funding-overrides', {
    preHandler: [fastify.withPermission(PL.READ_EDIT_GI, 'Normalize funding overrides')],
  }, async () => {
    return getExcelClient().normalizeFundingOverrides();
  });

  // Algorithm parameters
  fastify.get('/algorithm-parameters', async () => backend.getAlgorithmParameters());
  fastify.post('/algorithm-parameters', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit algorithm parameters')],
  }, async (request) => {
    return backend.saveAlgorithmParameters(request.body.rows);
  });

  // Workplan constants
  fastify.get('/workplan-constants', async () => backend.getWorkplanConstants());
  fastify.post('/workplan-constants', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit workplan constants')],
  }, async (request) => {
    return backend.saveWorkplanConstants(request.body.rows);
  });

  // Custom weights
  fastify.get('/custom-weights', async () => backend.getCustomWeights());
  fastify.post('/custom-weight', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit custom weights')],
  }, async (request) => {
    const { weight, active } = request.body;
    return backend.addCustomWeight(weight, active);
  });

  // Fixed parameters
  fastify.get('/fixed-parameters', async () => backend.getFixedParameters());
  fastify.post('/fixed-parameters', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit fixed parameters')],
  }, async (request) => {
    return backend.saveFixedParameters(request.body.params);
  });
}

module.exports = excelRoutes;

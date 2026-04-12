// backend/excel_worker_client.js
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');

let w = null;
let seq = 1;
const pending = new Map();
const emitter = new EventEmitter();
const operationQueue = [];
let isProcessing = false;

function ensureWorker() {
  if (w && w.threadId) return;
  const workerPath = path.join(__dirname, 'excel_worker.js');
  w = new Worker(workerPath, { workerData: {} });
  w.on('message', (msg) => {
    // Progress messages have no id
    if (msg && msg.type === 'progress') {
      try {
        emitter.emit('progress', msg);
      } catch (e) {
        // Silently ignore - listeners might have been removed
      }
      return;
    }
    const { id, ok, result, error } = msg || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    try {
      ok ? p.resolve(result) : p.reject(new Error(error || 'Worker error'));
    } catch (e) {
      // Promise might have been cancelled
    }
    // Process next queued operation
    processQueue();
  });
  w.on('error', (err) => {
    for (const [, p] of pending) {
      try {
        p.reject(err);
      } catch (e) {
        // Ignore - promise might be already resolved
      }
    }
    pending.clear();
    isProcessing = false;
    // Clear the queue on error
    while (operationQueue.length > 0) {
      const op = operationQueue.shift();
      op.reject(err);
    }
  });
  w.on('exit', (code) => {
    // Clear all pending operations
    for (const [, p] of pending) {
      try {
        p.reject(new Error('Worker exited'));
      } catch (e) {
        // Ignore
      }
    }
    pending.clear();
    w = null;
    isProcessing = false;
    // Clear the queue on exit
    while (operationQueue.length > 0) {
      const op = operationQueue.shift();
      op.reject(new Error('Worker exited'));
    }
  });
}

async function processQueue() {
  if (isProcessing || operationQueue.length === 0) return;
  
  isProcessing = true;
  const { cmd, args, resolve, reject } = operationQueue.shift();
  
  try {
    ensureWorker();
    const id = seq++;
    
    // No timeout for critical operations
    const criticalOps = ['ensureLookupsReady', 'readLookupsSnapshot', 'warm', 'ping'];
    const shouldTimeout = !criticalOps.includes(cmd);
    
    let timeout = null;
    if (shouldTimeout) {
      const timeoutMs = cmd === 'readStationsAggregate' ? 60000 : 45000;
      timeout = setTimeout(() => {
        pending.delete(id);
        isProcessing = false;
        reject(new Error(`Operation '${cmd}' timed out after ${timeoutMs}ms`));
        processQueue();
      }, timeoutMs);
    }
    
    const clearAndResolve = (result) => {
      if (timeout) clearTimeout(timeout);
      isProcessing = false;
      resolve(result);
    };
    
    const clearAndReject = (error) => {
      if (timeout) clearTimeout(timeout);
      isProcessing = false;
      reject(error);
    };
    
    pending.set(id, { resolve: clearAndResolve, reject: clearAndReject });
    w.postMessage({ id, cmd, args });
  } catch (e) {
    isProcessing = false;
    reject(e);
    processQueue();
  }
}

function call(cmd, ...args) {
  return new Promise((resolve, reject) => {
    operationQueue.push({ cmd, args, resolve, reject });
    processQueue();
  });
}

module.exports = {
  warm: () => { ensureWorker(); return call('ping').catch(() => {}); },
  onProgress: (cb) => { emitter.on('progress', cb); },
  // Excel from base64
  listSheets: (b64) => call('listSheets', b64),
  parseRows:  (b64) => call('parseRows',  b64),
  parseRowsFromSheet: (b64, sheetName) => call('parseRowsFromSheet', b64, sheetName),
  writeLocationRows: (company, location, sheetName, sections, headers, rows) =>
    call('writeLocationRows', company, location, sheetName, sections, headers, rows),
  readStationsAggregate: () => call('readStationsAggregate'),
  // Lookups workbook
  ensureLookupsReady:   () => call('ensureLookupsReady'),
  readLookupsSnapshot:  () => call('readLookupsSnapshot'),
  upsertCompany:        (name, active, description, email) =>
    call('upsertCompany', name, !!active, description, email),
  upsertLocation:       (location, company) => call('upsertLocation', location, company),
  upsertAssetType:      (assetType, company, location) => call('upsertAssetType', assetType, company, location),
  setAssetTypeColor:    (assetType, color) => call('setAssetTypeColor', assetType, color),
  setAssetTypeColorForLocation: (assetType, location, color) =>
    call('setAssetTypeColorForLocation', assetType, location, color),
  setAssetTypeColorForCompanyLocation: (assetType, company, location, color) =>
    call('setAssetTypeColorForCompanyLocation', assetType, company, location, color),
  setRepairColorForCompanyLocation: (assetType, company, location, color) =>
    call('setRepairColorForCompanyLocation', assetType, company, location, color),
  updateStationInLocationFile: (company, locationName, stationId, updatedRowData, schema) =>
    call('updateStationInLocationFile', company, locationName, stationId, updatedRowData, schema),
  readLocationWorkbook: (company, locationName) => call('readLocationWorkbook', company, locationName),
  readSheetData: (company, locationName, sheetName) => call('readSheetData', company, locationName, sheetName),
  updateAssetTypeSchema: (assetType, schema, excludeStationId) => 
    call('updateAssetTypeSchema', assetType, schema, excludeStationId),
  setStatusColor: (statusKey, color) => call('setStatusColor', statusKey, color),
  deleteStatusRow: (statusKey) => call('deleteStatusRow', statusKey),
  setSettingBoolean: (key, flag) => call('setSettingBoolean', key, !!flag),
  setLocationLink: (company, location, link) =>
    call('setLocationLink', company, location, link),
  setAssetTypeLink: (assetType, company, location, link) =>
    call('setAssetTypeLink', assetType, company, location, link),
  // Repairs (new single-sheet model)
  appendRepair: (company, location, assetType, repair) =>
    call('appendRepair', company, location, assetType, repair),
  listRepairsForStation: (company, location, assetType, stationId) =>
    call('listRepairsForStation', company, location, assetType, stationId),
  saveStationRepairs: (company, location, assetType, stationId, repairs) =>
    call('saveStationRepairs', company, location, assetType, stationId, repairs),
  getAllRepairs: () => call('getAllRepairs'),
  deleteRepair: (company, location, assetType, stationId, repairIndex) =>
    call('deleteRepair', company, location, assetType, stationId, repairIndex),
  // Inspection keywords (global list stored in lookups.xlsx)
  setInspectionKeywords: (keywords) =>
    call('setInspectionKeywords', Array.isArray(keywords) ? keywords : []),
  // Project keywords (global list stored in lookups.xlsx)
  setProjectKeywords: (keywords) =>
    call('setProjectKeywords', Array.isArray(keywords) ? keywords : []),
  // NEW: Algorithm/Workplan
  getAlgorithmParameters: () => call('getAlgorithmParameters'),
  saveAlgorithmParameters: (rows) => call('saveAlgorithmParameters', rows),
  getWorkplanConstants: () => call('getWorkplanConstants'),
  saveWorkplanConstants: (rows) => call('saveWorkplanConstants', rows),
  getCustomWeights: () => call('getCustomWeights'),
  addCustomWeight: (weight, active) => call('addCustomWeight', weight, !!active),
  // Fixed parameters (for Optimization I constraint filtering)
  getFixedParameters: () => call('getFixedParameters'),
  saveFixedParameters: (params) => call('saveFixedParameters', params),
  // Auth functions
  createAuthWorkbook: () => call('createAuthWorkbook'),
  createAuthUser: (userData) => call('createAuthUser', userData),
  loginAuthUser: (name, hashedPassword) => call('loginAuthUser', name, hashedPassword),
  logoutAuthUser: (name) => call('logoutAuthUser', name),
  getAllAuthUsers: () => call('getAllAuthUsers'),
  hasAuthUsers: () => call('hasAuthUsers'),
  updateAuthUser: (nameOrEmail, updates) => call('updateAuthUser', nameOrEmail, updates),
  deleteAuthUser: (nameOrEmail) => call('deleteAuthUser', nameOrEmail),
  getFundingSettings: (company, location) => call('getFundingSettings', company, location),
  saveFundingSettings: (company, location, settings) => call('saveFundingSettings', company, location, settings),
  saveFundingSettingsForAssetType: (company, location, assetType, settings) =>
    call('saveFundingSettingsForAssetType', company, location, assetType, settings),
  getAllFundingSettings: (company) =>
    call('getAllFundingSettings', company),
  normalizeFundingOverrides: () => call('normalizeFundingOverrides'),
  getWorkbookFieldCatalog: (company, locationName) =>
    call('getWorkbookFieldCatalog', company, locationName),
  deleteCompanyFromLookups: (companyName) =>
    call('deleteCompanyFromLookups', companyName),
  deleteLocationFromLookups: (companyName, locationName) =>
    call('deleteLocationFromLookups', companyName, locationName),
  deleteAssetTypeFromLookups: (companyName, locationName, assetTypeName) =>
    call('deleteAssetTypeFromLookups', companyName, locationName, assetTypeName),
  deleteAssetTypeFromLocation: (companyName, locationName, assetTypeName) =>
    call('deleteAssetTypeFromLocation', companyName, locationName, assetTypeName),
  deleteStation: (company, location, stationId) => 
    call('deleteStation', company, location, stationId),
};

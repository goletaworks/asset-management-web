// Excel-based persistence implementation
// This wraps the existing excel_worker_client functionality

const IPersistence = require('./IPersistence');

// Lazy-load excel_worker_client to avoid starting the worker thread on import
let excel = null;
function getExcel() {
  if (!excel) {
    console.log('[ExcelPersistence] Lazy-loading excel_worker_client');
    excel = require('../excel_worker_client');
  }
  return excel;
}

class ExcelPersistence extends IPersistence {
  constructor() {
    super();
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  async initialize() {
    try {
      console.log('[ExcelPersistence] Initializing...');
      const excel = getExcel();
      await excel.ensureLookupsReady();
      this.initialized = true;
      console.log('[ExcelPersistence] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[ExcelPersistence] Initialization failed:', error.message);
      return false;
    }
  }

  async close() {
    console.log('[ExcelPersistence] Closing');
    // Excel doesn't need explicit cleanup
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COMPANIES
  // ════════════════════════════════════════════════════════════════════════════

  async getActiveCompanies() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.companies || [];
  }

  async upsertCompany(name, active = true, description = '', email = '') {
    const excel = getExcel();
    return await excel.upsertCompany(name, active, description, email);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - LOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async getLocationsForCompany(company) {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.locsByCompany[company] || [];
  }

  async upsertLocation(location, company) {
    const excel = getExcel();
    return await excel.upsertLocation(location, company);
  }

  async setLocationLink(company, location, link) {
    const excel = getExcel();
    return await excel.setLocationLink(company, location, link);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - ASSET TYPES
  // ════════════════════════════════════════════════════════════════════════════

  async getAssetTypesForCompanyLocation(company, location) {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    const companyAssets = snapshot.assetsByCompanyLocation[company] || {};
    return companyAssets[location] || [];
  }

  async upsertAssetType(assetType, company, location) {
    const excel = getExcel();
    return await excel.upsertAssetType(assetType, company, location);
  }

  async setAssetTypeLink(assetType, company, location, link) {
    const excel = getExcel();
    return await excel.setAssetTypeLink(assetType, company, location, link);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COLORS
  // ════════════════════════════════════════════════════════════════════════════

  async getColorMaps() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();

    // Convert plain objects to Maps
    const global = new Map(Object.entries(snapshot.colorsGlobal || {}));

    const byLocation = new Map(
      Object.entries(snapshot.colorsByLoc || {}).map(
        ([loc, obj]) => [loc, new Map(Object.entries(obj))]
      )
    );

    const byCompanyLocation = new Map(
      Object.entries(snapshot.colorsByCompanyLoc || {}).map(
        ([company, locObj]) => [
          company,
          new Map(Object.entries(locObj).map(
            ([loc, obj]) => [loc, new Map(Object.entries(obj))]
          ))
        ]
      )
    );

    return { global, byLocation, byCompanyLocation };
  }

  async setAssetTypeColor(assetType, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColor(assetType, color);
  }

  async setAssetTypeColorForLocation(assetType, location, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColorForLocation(assetType, location, color);
  }

  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    const excel = getExcel();
    return await excel.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
  }

  async getRepairColorMaps() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    const byCompanyLocation = new Map(
      Object.entries(snapshot.repairColors || {}).map(
        ([company, locObj]) => [
          company,
          new Map(Object.entries(locObj).map(
            ([loc, obj]) => [loc, new Map(Object.entries(obj))]
          ))
        ]
      )
    );
    return { byCompanyLocation };
  }

  async setRepairColorForCompanyLocation(assetType, company, location, color) {
    const excel = getExcel();
    return await excel.setRepairColorForCompanyLocation(assetType, company, location, color);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - SNAPSHOT & TREE
  // ════════════════════════════════════════════════════════════════════════════

  async readLookupsSnapshot() {
    const excel = getExcel();
    return await excel.readLookupsSnapshot();
  }

  async getLookupTree() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return {
      companies: snapshot.companies || [],
      locationsByCompany: snapshot.locsByCompany || {},
      assetsByCompanyLocation: snapshot.assetsByCompanyLocation || {}
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - STATUS & REPAIR SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async getStatusAndRepairSettings() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return {
      statusColors: snapshot.statusColors || {},
      applyStatusColorsOnMap: snapshot.applyStatusColorsOnMap || false,
      repairColors: snapshot.repairColors || {},
      applyRepairColorsOnMap: snapshot.applyRepairColorsOnMap || false
    };
  }

  async setStatusColor(statusKey, color) {
    const excel = getExcel();
    return await excel.setStatusColor(statusKey, color);
  }

  async setSettingBoolean(key, value) {
    const excel = getExcel();
    return await excel.setSettingBoolean(key, value);
  }

  async deleteStatusRow(statusKey) {
    const excel = getExcel();
    return await excel.deleteStatusRow(statusKey);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - INSPECTION KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getInspectionKeywords() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.inspectionKeywords || [];
  }

  async setInspectionKeywords(keywords) {
    const excel = getExcel();
    return await excel.setInspectionKeywords(keywords);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - PROJECT KEYWORDS (NEW IMPLEMENTATION)
  // ════════════════════════════════════════════════════════════════════════════

  async getProjectKeywords() {
    const excel = getExcel();
    const snapshot = await excel.readLookupsSnapshot();
    return snapshot.projectKeywords || [];
  }

  async setProjectKeywords(keywords) {
    const excel = getExcel();
    return await excel.setProjectKeywords(keywords);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - READ
  // ════════════════════════════════════════════════════════════════════════════

  async readStationsAggregate() {
    const excel = getExcel();
    return await excel.readStationsAggregate();
  }

  async readLocationWorkbook(company, locationName) {
    const excel = getExcel();
    return await excel.readLocationWorkbook(company, locationName);
  }

  async readSheetData(company, locationName, sheetName) {
    const excel = getExcel();
    return await excel.readSheetData(company, locationName, sheetName);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    const excel = getExcel();
    return await excel.writeLocationRows(company, location, sheetName, sections, headers, rows);
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    const excel = getExcel();
    return await excel.updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema);
  }

  async deleteStation(company, locationName, stationId) {
    const excel = getExcel();
    return await excel.deleteStation(company, locationName, stationId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIRS
  // ════════════════════════════════════════════════════════════════════════════

  async listRepairsForStation(company, location, assetType, stationId) {
    const excel = getExcel();
    return await excel.listRepairsForStation(company, location, assetType, stationId);
  }

  async getAllRepairs() {
    const excel = getExcel();
    return await excel.getAllRepairs();
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    const excel = getExcel();
    return await excel.saveStationRepairs(company, location, assetType, stationId, repairs);
  }

  async appendRepair(company, location, assetType, repair) {
    const excel = getExcel();
    return await excel.appendRepair(company, location, assetType, repair);
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    const excel = getExcel();
    return await excel.deleteRepair(company, location, assetType, stationId, repairIndex);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ALGORITHM DATA
  // ════════════════════════════════════════════════════════════════════════════

  async getAlgorithmParameters() {
    const excel = getExcel();
    return await excel.getAlgorithmParameters();
  }

  async saveAlgorithmParameters(rows) {
    const excel = getExcel();
    return await excel.saveAlgorithmParameters(rows);
  }

  async getWorkplanConstants() {
    const excel = getExcel();
    return await excel.getWorkplanConstants();
  }

  async saveWorkplanConstants(rows) {
    const excel = getExcel();
    return await excel.saveWorkplanConstants(rows);
  }

  async getCustomWeights() {
    const excel = getExcel();
    return await excel.getCustomWeights();
  }

  async addCustomWeight(weight, active) {
    const excel = getExcel();
    return await excel.addCustomWeight(weight, active);
  }

  async getFixedParameters() {
    const excel = getExcel();
    return await excel.getFixedParameters();
  }

  async saveFixedParameters(params) {
    const excel = getExcel();
    return await excel.saveFixedParameters(params);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - DELETE OPERATIONS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async deleteCompanyFromLookups(companyName) {
    const excel = getExcel();
    return await excel.deleteCompanyFromLookups(companyName);
  }

  async deleteLocationFromLookups(companyName, locationName) {
    const excel = getExcel();
    return await excel.deleteLocationFromLookups(companyName, locationName);
  }

  async deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
    const excel = getExcel();
    return await excel.deleteAssetTypeFromLookups(companyName, locationName, assetTypeName);
  }

  async deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
    const excel = getExcel();
    return await excel.deleteAssetTypeFromLocation(companyName, locationName, assetTypeName);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEMA MANAGEMENT (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async updateAssetTypeSchema(assetType, schema, excludeStationId) {
    const excel = getExcel();
    return await excel.updateAssetTypeSchema(assetType, schema, excludeStationId);
  }

  async getWorkbookFieldCatalog(company, locationName) {
    const excel = getExcel();
    return await excel.getWorkbookFieldCatalog(company, locationName);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION SYSTEM (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async createAuthWorkbook() {
    const excel = getExcel();
    return await excel.createAuthWorkbook();
  }

  async createAuthUser(userData) {
    const excel = getExcel();
    return await excel.createAuthUser(userData);
  }

  async loginAuthUser(name, hashedPassword) {
    const excel = getExcel();
    return await excel.loginAuthUser(name, hashedPassword);
  }

  async logoutAuthUser(name) {
    const excel = getExcel();
    return await excel.logoutAuthUser(name);
  }

  async getAllAuthUsers() {
    const excel = getExcel();
    return await excel.getAllAuthUsers();
  }

  async hasAuthUsers() {
    const excel = getExcel();
    return await excel.hasAuthUsers();
  }

  async updateAuthUser(nameOrEmail, updates) {
    const excel = getExcel();
    return await excel.updateAuthUser(nameOrEmail, updates);
  }

  async deleteAuthUser(nameOrEmail) {
    const excel = getExcel();
    return await excel.deleteAuthUser(nameOrEmail);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING SETTINGS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async getFundingSettings(company, location) {
    const excel = getExcel();
    return await excel.getFundingSettings(company, location);
  }

  async saveFundingSettings(company, location, settings) {
    const excel = getExcel();
    return await excel.saveFundingSettings(company, location, settings);
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    const excel = getExcel();
    return await excel.saveFundingSettingsForAssetType(company, location, assetType, settings);
  }

  async getAllFundingSettings(company) {
    const excel = getExcel();
    return await excel.getAllFundingSettings(company);
  }

  async normalizeFundingOverrides() {
    const excel = getExcel();
    return await excel.normalizeFundingOverrides();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  async listSheets(b64) {
    const excel = getExcel();
    return await excel.listSheets(b64);
  }

  async ensureLookupsReady() {
    const excel = getExcel();
    return await excel.ensureLookupsReady();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Nuke
  // ════════════════════════════════════════════════════════════════════════════

  async nuke() {
    // Excel file deletion is handled by the FS logic in nuke.js
    return { success: true };
  }

  
  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING SETTINGS (NEW) - Delegating to excel_worker_client
  // ════════════════════════════════════════════════════════════════════════════

  async getFundingSettings(company, location) {
    const excel = getExcel();
    return await excel.getFundingSettings(company, location);
  }

  async saveFundingSettings(company, location, settings) {
    const excel = getExcel();
    return await excel.saveFundingSettings(company, location, settings);
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    const excel = getExcel();
    return await excel.saveFundingSettingsForAssetType(company, location, assetType, settings);
  }

  async getAllFundingSettings(company) {
    const excel = getExcel();
    return await excel.getAllFundingSettings(company);
  }

  async normalizeFundingOverrides() {
    const excel = getExcel();
    return await excel.normalizeFundingOverrides();
  }

}

module.exports = ExcelPersistence;

// backend/persistence/IPersistence.js

// Interface documentation for persistence layer
// All persistence implementations (Excel, MongoDB, etc.) must implement these methods

/**
 * IPersistence Interface
 *
 * This interface defines all CRUD operations for the Asset Management system.
 * Both ExcelPersistence and MongoPersistence implement this interface.
 */

class IPersistence {
  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the persistence layer (connect to database, setup folders, etc.)
   * @returns {Promise<boolean>} - Success status
   */
  async initialize() {
    throw new Error('Method "initialize()" must be implemented');
  }

  /**
   * Close/cleanup the persistence layer
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Method "close()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COMPANIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get all active companies
   * @returns {Promise<string[]>} - Array of company names
   */
  async getActiveCompanies() {
    throw new Error('Method "getActiveCompanies()" must be implemented');
  }

  /**
   * Upsert a company
   * @param {string} name - Company name (maps to 'company' field in MongoDB)
   * @param {boolean} active - Active status
   * @param {string} description - Description
   * @param {string} email - Email
   * @param {Object|null} mapProfile - Company map profile
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async upsertCompany(name, active = true, description = '', email = '', mapProfile = null) {
    throw new Error('Method "upsertCompany()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - LOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get locations for a company
   * @param {string} company - Company name
   * @returns {Promise<string[]>} - Array of location names
   */
  async getLocationsForCompany(company) {
    throw new Error('Method "getLocationsForCompany()" must be implemented');
  }

  /**
   * Upsert a location
   * @param {string} location - Location name
   * @param {string} company - Company name
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async upsertLocation(location, company) {
    throw new Error('Method "upsertLocation()" must be implemented');
  }

  /**
   * Set location link (photos base path)
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} link - Link/path
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setLocationLink(company, location, link) {
    throw new Error('Method "setLocationLink()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - ASSET TYPES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get asset types for a company and location
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @returns {Promise<string[]>} - Array of asset type names
   */
  async getAssetTypesForCompanyLocation(company, location) {
    throw new Error('Method "getAssetTypesForCompanyLocation()" must be implemented');
  }

  /**
   * Upsert an asset type
   * @param {string} assetType - Asset type name (maps to 'asset_type' field)
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async upsertAssetType(assetType, company, location) {
    throw new Error('Method "upsertAssetType()" must be implemented');
  }

  /**
   * Set asset type link (photos base path)
   * @param {string} assetType - Asset type name
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} link - Link/path
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setAssetTypeLink(assetType, company, location, link) {
    throw new Error('Method "setAssetTypeLink()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COLORS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get color maps (global, by location, by company+location)
   * @returns {Promise<Object>} - { global: Map, byLocation: Map, byCompanyLocation: Map }
   */
  async getColorMaps() {
    throw new Error('Method "getColorMaps()" must be implemented');
  }

  /**
   * Set global asset type color
   * @param {string} assetType - Asset type name
   * @param {string} color - Hex color code
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setAssetTypeColor(assetType, color) {
    throw new Error('Method "setAssetTypeColor()" must be implemented');
  }

  /**
   * Set asset type color for a location
   * @param {string} assetType - Asset type name
   * @param {string} location - Location name
   * @param {string} color - Hex color code
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setAssetTypeColorForLocation(assetType, location, color) {
    throw new Error('Method "setAssetTypeColorForLocation()" must be implemented');
  }

  /**
   * Set asset type color for a company and location
   * @param {string} assetType - Asset type name
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} color - Hex color code
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    throw new Error('Method "setAssetTypeColorForCompanyLocation()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIR COLORS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get repair color maps
   * @returns {Promise<Object>} - { byCompanyLocation: Map }
   */
  async getRepairColorMaps() {
    throw new Error('Method "getRepairColorMaps()" must be implemented');
  }

  /**
   * Set repair color for a company/location/asset combination
   */
  async setRepairColorForCompanyLocation(assetType, company, location, color) {
    throw new Error('Method "setRepairColorForCompanyLocation()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - SNAPSHOT & TREE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Read complete lookups snapshot (for caching)
   * @returns {Promise<Object>} - Complete lookups data structure
   */
  async readLookupsSnapshot() {
    throw new Error('Method "readLookupsSnapshot()" must be implemented');
  }

  /**
   * Get lookup tree (companies, locations by company, assets by company+location)
   * @returns {Promise<Object>} - { companies, locationsByCompany, assetsByCompanyLocation }
   */
  async getLookupTree() {
    throw new Error('Method "getLookupTree()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - STATUS & REPAIR SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get status and repair color settings
   * @returns {Promise<Object>} - { statusColors, applyStatusColorsOnMap, repairColors, applyRepairColorsOnMap }
   */
  async getStatusAndRepairSettings() {
    throw new Error('Method "getStatusAndRepairSettings()" must be implemented');
  }

  /**
   * Set status color (maps to 'Status' and 'Color' fields)
   * @param {string} statusKey - Status key (e.g., "inactive")
   * @param {string} color - Hex color code
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setStatusColor(statusKey, color) {
    throw new Error('Method "setStatusColor()" must be implemented');
  }

  /**
   * Set a boolean setting (maps to 'Key' and 'Value' fields)
   * @param {string} key - Setting key
   * @param {boolean} value - Boolean value
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setSettingBoolean(key, value) {
    throw new Error('Method "setSettingBoolean()" must be implemented');
  }

  /**
   * Delete a status row
   * @param {string} statusKey - Status key to delete
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async deleteStatusRow(statusKey) {
    throw new Error('Method "deleteStatusRow()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - INSPECTION KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get inspection keywords
   * @returns {Promise<string[]>} - Array of keywords
   */
  async getInspectionKeywords() {
    throw new Error('Method "getInspectionKeywords()" must be implemented');
  }

  /**
   * Set inspection keywords
   * @param {string[]} keywords - Array of keywords
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setInspectionKeywords(keywords) {
    throw new Error('Method "setInspectionKeywords()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - PROJECT KEYWORDS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get project keywords
   * @returns {Promise<string[]>} - Array of keywords
   */
  async getProjectKeywords() {
    throw new Error('Method "getProjectKeywords()" must be implemented');
  }

  /**
   * Set project keywords
   * @param {string[]} keywords - Array of keywords
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async setProjectKeywords(keywords) {
    throw new Error('Method "setProjectKeywords()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - READ
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Read all stations (aggregate from all companies/locations)
   * @returns {Promise<Object>} - { success: boolean, rows: Array }
   */
  async readStationsAggregate() {
    throw new Error('Method "readStationsAggregate()" must be implemented');
  }

  /**
   * Read a specific location workbook
   * @param {string} company - Company name
   * @param {string} locationName - Location name
   * @returns {Promise<Object>} - Workbook data structure
   */
  async readLocationWorkbook(company, locationName) {
    throw new Error('Method "readLocationWorkbook()" must be implemented');
  }

  /**
   * Read sheet data from a location workbook
   * @param {string} company - Company name
   * @param {string} locationName - Location name
   * @param {string} sheetName - Sheet name
   * @returns {Promise<Object>} - Sheet data
   */
  async readSheetData(company, locationName, sheetName) {
    throw new Error('Method "readSheetData()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Write rows to a location workbook
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} sheetName - Sheet name
   * @param {Array} sections - Section headers (two-row header)
   * @param {Array} headers - Field headers
   * @param {Array} rows - Data rows
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    throw new Error('Method "writeLocationRows()" must be implemented');
  }

  /**
   * Update a station in a location file
   * @param {string} company - Company name
   * @param {string} locationName - Location name
   * @param {string} stationId - Station ID
   * @param {Object} updatedRowData - Updated data
   * @param {Object} schema - Schema (optional)
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    throw new Error('Method "updateStationInLocationFile()" must be implemented');
  }

  /**
   * Delete a station and its associated data
   * @param {string} company - Company name
   * @param {string} locationName - Location name
   * @param {string} stationId - Station ID
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async deleteStation(company, locationName, stationId) {
    throw new Error('Method "deleteStation()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIRS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * List repairs for a station
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} assetType - Asset type
   * @param {string} stationId - Station ID
   * @returns {Promise<Array>} - Array of repair objects
   */
  async listRepairsForStation(company, location, assetType, stationId) {
    throw new Error('Method "listRepairsForStation()" must be implemented');
  }

  /**
   * Get all repairs across all locations
   * @returns {Promise<Array>} - Array of all repair objects
   */
  async getAllRepairs() {
    throw new Error('Method "getAllRepairs()" must be implemented');
  }

  /**
   * Save repairs for a station (replaces all)
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} assetType - Asset type
   * @param {string} stationId - Station ID
   * @param {Array} repairs - Array of repair objects
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    throw new Error('Method "saveStationRepairs()" must be implemented');
  }

  /**
   * Append a single repair
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} assetType - Asset type
   * @param {Object} repair - Repair object
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async appendRepair(company, location, assetType, repair) {
    throw new Error('Method "appendRepair()" must be implemented');
  }

  /**
   * Delete a repair by index
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} assetType - Asset type
   * @param {string} stationId - Station ID
   * @param {number} repairIndex - Index of repair to delete
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    throw new Error('Method "deleteRepair()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ALGORITHM DATA
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get algorithm parameters
   * @returns {Promise<Array>} - Array of parameter objects
   */
  async getAlgorithmParameters() {
    throw new Error('Method "getAlgorithmParameters()" must be implemented');
  }

  /**
   * Save algorithm parameters
   * @param {Array} rows - Parameter rows
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async saveAlgorithmParameters(rows) {
    throw new Error('Method "saveAlgorithmParameters()" must be implemented');
  }

  /**
   * Get workplan constants
   * @returns {Promise<Array>} - Array of constant objects
   */
  async getWorkplanConstants() {
    throw new Error('Method "getWorkplanConstants()" must be implemented');
  }

  /**
   * Save workplan constants
   * @param {Array} rows - Constant rows
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async saveWorkplanConstants(rows) {
    throw new Error('Method "saveWorkplanConstants()" must be implemented');
  }

  /**
   * Get custom weights
   * @returns {Promise<Array>} - Array of weight objects
   */
  async getCustomWeights() {
    throw new Error('Method "getCustomWeights()" must be implemented');
  }

  /**
   * Add a custom weight
   * @param {number} weight - Weight value
   * @param {boolean} active - Active status
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async addCustomWeight(weight, active) {
    throw new Error('Method "addCustomWeight()" must be implemented');
  }

  /**
   * Get fixed parameters
   * @returns {Promise<Array>} - Array of parameter objects
   */
  async getFixedParameters() {
    throw new Error('Method "getFixedParameters()" must be implemented');
  }

  /**
   * Save fixed parameters
   * @param {Array} params - Parameter array
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async saveFixedParameters(params) {
    throw new Error('Method "saveFixedParameters()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * List sheets in an Excel file (from base64)
   * @param {string} b64 - Base64 encoded Excel file
   * @returns {Promise<Object>} - { success: boolean, sheets?: Array }
   */
  async listSheets(b64) {
    throw new Error('Method "listSheets()" must be implemented');
  }

  /**
   * Ensure lookups are ready (create if needed)
   * @returns {Promise<Object>} - { success: boolean, message?: string }
   */
  async ensureLookupsReady() {
    throw new Error('Method "ensureLookupsReady()" must be implemented');
  }

  /**
   * Reset the database (Drop DB or return success for FS handler)
   * @returns {Promise<Object>}
   */
  async nuke() {
    throw new Error('Method "nuke()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION SYSTEM (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async createAuthWorkbook() { throw new Error('Method not implemented'); }
  async createAuthUser(userData) { throw new Error('Method not implemented'); }
  async loginAuthUser(name, pass) { throw new Error('Method not implemented'); }
  async logoutAuthUser(name) { throw new Error('Method not implemented'); }
  async getAllAuthUsers() { throw new Error('Method not implemented'); }
  async hasAuthUsers() { throw new Error('Method not implemented'); }
  async updateAuthUser(nameOrEmail, updates) { throw new Error('Method not implemented'); }
  async deleteAuthUser(nameOrEmail) { throw new Error('Method not implemented'); }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING SETTINGS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get funding settings for a specific location (representative sample)
   */
  async getFundingSettings(company, location) {
    throw new Error('Method "getFundingSettings()" must be implemented');
  }

  /**
   * Save funding settings (overrides) for a location
   */
  async saveFundingSettings(company, location, settings) {
    throw new Error('Method "saveFundingSettings()" must be implemented');
  }

  /**
   * Save funding settings for a specific asset type within a location
   */
  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    throw new Error('Method "saveFundingSettingsForAssetType()" must be implemented');
  }

  /**
   * Get all funding settings for a company (for the settings tree)
   */
  async getAllFundingSettings(company) {
    throw new Error('Method "getAllFundingSettings()" must be implemented');
  }

  /**
   * Auto-populate missing overrides based on Funding Split tokens
   */
  async normalizeFundingOverrides() {
    throw new Error('Method "normalizeFundingOverrides()" must be implemented');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEMA & UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  async updateAssetTypeSchema(assetType, schema, excludeStationId) { throw new Error('Method not implemented'); }
  async getWorkbookFieldCatalog(company, locationName) { throw new Error('Method not implemented'); }
  
  async deleteCompanyFromLookups(companyName) { throw new Error('Method not implemented'); }
  async deleteLocationFromLookups(companyName, loc) { throw new Error('Method not implemented'); }
  async deleteAssetTypeFromLookups(companyName, loc, asset) { throw new Error('Method not implemented'); }
  async deleteAssetTypeFromLocation(companyName, loc, asset) { throw new Error('Method not implemented'); }

}

module.exports = IPersistence;

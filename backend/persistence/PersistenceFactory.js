// backend/persistence/PersistenceFactory.js

// Factory to create and manage persistence layer instances

const mongoClient = require('../db/mongoClient');
require('dotenv').config();
const DEFAULT_MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/asmgt';

// Lazy-load persistence implementations to avoid loading Excel worker unnecessarily
let ExcelPersistence = null;
let MongoPersistence = null;

function getExcelPersistence() {
  if (!ExcelPersistence) {
    console.log('[PersistenceFactory] Lazy-loading ExcelPersistence');
    ExcelPersistence = require('./ExcelPersistence');
  }
  return ExcelPersistence;
}

function getMongoPersistence() {
  if (!MongoPersistence) {
    console.log('[PersistenceFactory] Lazy-loading MongoPersistence');
    MongoPersistence = require('./MongoPersistence');
  }
  return MongoPersistence;
}

/**
 * DualWritePersistence - Wrapper that writes to multiple persistence layers
 */
class DualWritePersistence {
  constructor(readPersistence, writePersistences) {
    this.readPersistence = readPersistence;
    this.writePersistences = writePersistences; // Array of persistence layers
  }

  async initialize() {
    // Initialize all persistence layers
    const results = await Promise.all([
      this.readPersistence.initialize(),
      ...this.writePersistences.map(p => p.initialize())
    ]);

    return results.every(r => r);
  }

  async close() {
    await Promise.all([
      this.readPersistence.close(),
      ...this.writePersistences.map(p => p.close())
    ]);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // READ OPERATIONS - Delegate to read persistence
  // ════════════════════════════════════════════════════════════════════════════

  async getActiveCompanies() {
    return await this.readPersistence.getActiveCompanies();
  }

  async getLocationsForCompany(company) {
    return await this.readPersistence.getLocationsForCompany(company);
  }

  async getAssetTypesForCompanyLocation(company, location) {
    return await this.readPersistence.getAssetTypesForCompanyLocation(company, location);
  }

  async getColorMaps() {
    return await this.readPersistence.getColorMaps();
  }

  async getRepairColorMaps() {
    return await this.readPersistence.getRepairColorMaps();
  }

  async readLookupsSnapshot() {
    return await this.readPersistence.readLookupsSnapshot();
  }

  async getLookupTree() {
    return await this.readPersistence.getLookupTree();
  }

  async getStatusAndRepairSettings() {
    return await this.readPersistence.getStatusAndRepairSettings();
  }

  async getInspectionKeywords() {
    return await this.readPersistence.getInspectionKeywords();
  }

  // ADDED: Project Keywords read method
  async getProjectKeywords() {
    return await this.readPersistence.getProjectKeywords();
  }
  // END ADDED

  async readStationsAggregate() {
    return await this.readPersistence.readStationsAggregate();
  }

  async readLocationWorkbook(company, locationName) {
    return await this.readPersistence.readLocationWorkbook(company, locationName);
  }

  async readSheetData(company, locationName, sheetName) {
    return await this.readPersistence.readSheetData(company, locationName, sheetName);
  }

  async listRepairsForStation(company, location, assetType, stationId) {
    return await this.readPersistence.listRepairsForStation(company, location, assetType, stationId);
  }

  async getAllRepairs() {
    return await this.readPersistence.getAllRepairs();
  }

  async getAlgorithmParameters() {
    return await this.readPersistence.getAlgorithmParameters();
  }

  async getWorkplanConstants() {
    return await this.readPersistence.getWorkplanConstants();
  }

  async getCustomWeights() {
    return await this.readPersistence.getCustomWeights();
  }

  async getFixedParameters() {
    return await this.readPersistence.getFixedParameters();
  }

  async listSheets(b64) {
    return await this.readPersistence.listSheets(b64);
  }
  
  async getAllFundingSettings(company) {
    return await this.readPersistence.getAllFundingSettings(company);
  }
  
  async getFundingSettings(company, location) {
    return await this.readPersistence.getFundingSettings(company, location);
  }
  
  async getWorkbookFieldCatalog(company, locationName) {
    return await this.readPersistence.getWorkbookFieldCatalog(company, locationName);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // WRITE OPERATIONS - Write to all target persistence layers
  // ════════════════════════════════════════════════════════════════════════════

  async _writeToAll(method, ...args) {
    const results = await Promise.all(
      this.writePersistences.map(p => p[method](...args).catch(err => {
        console.error(`[DualWrite] Error in ${method}:`, err.message);
        return { success: false, message: err.message };
      }))
    );

    // Return success only if all writes succeeded
    const allSuccess = results.every(r => r.success);
    const messages = results.filter(r => !r.success).map(r => r.message);

    return {
      success: allSuccess,
      message: allSuccess ? undefined : messages.join('; ')
    };
  }

  async upsertCompany(name, active, description, email, mapProfile = null) {
    return await this._writeToAll('upsertCompany', name, active, description, email, mapProfile);
  }

  async upsertLocation(location, company) {
    return await this._writeToAll('upsertLocation', location, company);
  }

  async setLocationLink(company, location, link) {
    return await this._writeToAll('setLocationLink', company, location, link);
  }

  async upsertAssetType(assetType, company, location) {
    return await this._writeToAll('upsertAssetType', assetType, company, location);
  }

  async setAssetTypeLink(assetType, company, location, link) {
    return await this._writeToAll('setAssetTypeLink', assetType, company, location, link);
  }

  async setAssetTypeColor(assetType, color) {
    return await this._writeToAll('setAssetTypeColor', assetType, color);
  }

  async setAssetTypeColorForLocation(assetType, location, color) {
    return await this._writeToAll('setAssetTypeColorForLocation', assetType, location, color);
  }

  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    return await this._writeToAll('setAssetTypeColorForCompanyLocation', assetType, company, location, color);
  }

  async setRepairColorForCompanyLocation(assetType, company, location, color) {
    return await this._writeToAll('setRepairColorForCompanyLocation', assetType, company, location, color);
  }

  async setStatusColor(statusKey, color) {
    return await this._writeToAll('setStatusColor', statusKey, color);
  }

  async setSettingBoolean(key, value) {
    return await this._writeToAll('setSettingBoolean', key, value);
  }

  async deleteStatusRow(statusKey) {
    return await this._writeToAll('deleteStatusRow', statusKey);
  }

  async setInspectionKeywords(keywords) {
    return await this._writeToAll('setInspectionKeywords', keywords);
  }

  // ADDED: Project Keywords write method
  async setProjectKeywords(keywords) {
    return await this._writeToAll('setProjectKeywords', keywords);
  }
  // END ADDED

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    return await this._writeToAll('writeLocationRows', company, location, sheetName, sections, headers, rows);
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    return await this._writeToAll('updateStationInLocationFile', company, locationName, stationId, updatedRowData, schema);
  }

  async deleteStation(company, locationName, stationId) {
    return await this._writeToAll('deleteStation', company, locationName, stationId);
  }
  
  async updateAssetTypeSchema(assetType, schema, excludeStationId) {
     return await this._writeToAll('updateAssetTypeSchema', assetType, schema, excludeStationId);
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    return await this._writeToAll('saveStationRepairs', company, location, assetType, stationId, repairs);
  }

  async appendRepair(company, location, assetType, repair) {
    return await this._writeToAll('appendRepair', company, location, assetType, repair);
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    return await this._writeToAll('deleteRepair', company, location, assetType, stationId, repairIndex);
  }

  async saveAlgorithmParameters(rows) {
    return await this._writeToAll('saveAlgorithmParameters', rows);
  }

  async saveWorkplanConstants(rows) {
    return await this._writeToAll('saveWorkplanConstants', rows);
  }

  async addCustomWeight(weight, active) {
    return await this._writeToAll('addCustomWeight', weight, active);
  }

  async saveFixedParameters(params) {
    return await this._writeToAll('saveFixedParameters', params);
  }

  async ensureLookupsReady() {
    return await this._writeToAll('ensureLookupsReady');
  }
  
  async saveFundingSettings(company, location, settings) {
    return await this._writeToAll('saveFundingSettings', company, location, settings);
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    return await this._writeToAll('saveFundingSettingsForAssetType', company, location, assetType, settings);
  }

  async normalizeFundingOverrides() {
    return await this._writeToAll('normalizeFundingOverrides');
  }
  
  async deleteCompanyFromLookups(companyName) {
    return await this._writeToAll('deleteCompanyFromLookups', companyName);
  }

  async deleteLocationFromLookups(companyName, locationName) {
    return await this._writeToAll('deleteLocationFromLookups', companyName, locationName);
  }

  async deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
    return await this._writeToAll('deleteAssetTypeFromLookups', companyName, locationName, assetTypeName);
  }

  async deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
    return await this._writeToAll('deleteAssetTypeFromLocation', companyName, locationName, assetTypeName);
  }
}

/**
 * PersistenceFactory - Creates persistence layer instances based on configuration
 */
class PersistenceFactory {
  /**
   * Create persistence layer based on configuration
   * @param {Object} config - Database configuration
   * @returns {Promise<Object>} - Persistence layer instance
   */
  static async create(config) {
    if (!config) {
      throw new Error('Database configuration is required');
    }

    const readSource = config.read?.source || 'excel';
    const writeTargets = config.write?.targets || ['excel'];
    const connectionString = config.database?.connectionString || DEFAULT_MONGODB_URI;

    console.log(`[PersistenceFactory] Creating persistence layer: read=${readSource}, write=[${writeTargets.join(', ')}]`);

    // Create read persistence
    let readPersistence;
    if (readSource === 'mongodb') {
      // Connect to MongoDB if needed
      if (!mongoClient.connected()) {
        const connected = await mongoClient.connect(connectionString);
        if (!connected) {
          throw new Error('Failed to connect to MongoDB');
        }
      }
      const MongoPersistenceClass = getMongoPersistence();
      readPersistence = new MongoPersistenceClass();
    } else {
      const ExcelPersistenceClass = getExcelPersistence();
      readPersistence = new ExcelPersistenceClass();
    }

    // Create write persistence layers
    const writePersistences = [];
    for (const target of writeTargets) {
      if (target === 'mongodb') {
        // Connect to MongoDB if needed
        if (!mongoClient.connected()) {
          const connected = await mongoClient.connect(connectionString);
          if (!connected) {
            console.warn('[PersistenceFactory] Failed to connect to MongoDB for write');
            continue;
          }
        }
        const MongoPersistenceClass = getMongoPersistence();
        writePersistences.push(new MongoPersistenceClass());
      } else if (target === 'excel') {
        const ExcelPersistenceClass = getExcelPersistence();
        writePersistences.push(new ExcelPersistenceClass());
      } else {
        console.warn(`[PersistenceFactory] Unknown write target: ${target}`);
      }
    }

    if (writePersistences.length === 0) {
      // If we failed to connect to MongoDB, but Excel was a write target, we should still allow Excel mode.
      // However, if the config requires at least one writer and we failed all attempts, throw.
      if (writeTargets.length > 0) {
         // Only throw if NO valid write targets could be created.
         if (writeTargets.includes('mongodb') && !writeTargets.includes('excel') && readSource !== 'mongodb') {
            throw new Error('No valid write persistence layers configured');
         }
      }
    }

    // If single read/write to the same source, return single instance
    if (writeTargets.length === 1 && readSource === writeTargets[0] && writePersistences.length === 1) {
      await readPersistence.initialize();
      return readPersistence;
    }

    // Otherwise, return dual-write wrapper
    const dualWrite = new DualWritePersistence(readPersistence, writePersistences);
    await dualWrite.initialize();
    return dualWrite;
  }

  /**
   * Create persistence from config file path
   * @param {string} configPath - Path to db-config.json
   * @returns {Promise<Object>} - Persistence layer instance
   */
  static async createFromFile(configPath) {
    const fs = require('fs');
    const path = require('path');

    const fullPath = path.isAbsolute(configPath) ? configPath : path.join(__dirname, '..', configPath);

    if (!fs.existsSync(fullPath)) {
      console.warn(`[PersistenceFactory] Config file not found: ${fullPath}, using Excel default`);
      return await this.create({
        read: { source: 'excel' },
        write: { targets: ['excel'] }
      });
    }

    const configContent = fs.readFileSync(fullPath, 'utf8');
    const config = JSON.parse(configContent);

    const envMongoUri = process.env.MONGODB_URI;
    if (envMongoUri) {
      config.database = {
        ...(config.database || {}),
        connectionString: envMongoUri
      };
    } else if (!config.database?.connectionString) {
      config.database = {
        ...(config.database || { type: 'mongodb' }),
        connectionString: DEFAULT_MONGODB_URI
      };
    }

    return await this.create(config);
  }
}

module.exports = PersistenceFactory;

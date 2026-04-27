// backend/persistence/MongoPersistence.js

// MongoDB-based persistence implementation

const IPersistence = require('./IPersistence');
const mongoClient = require('../db/mongoClient');
const { COLLECTIONS, addMetadata, stripMetadata } = require('../db/mongoSchemas');

// Lazy-load excel worker client for import utilities (parsing Excel files)
let excelWorker = null;
function getExcelWorker() {
  if (!excelWorker) {
    console.log('[MongoPersistence] Lazy-loading excel_worker_client for file parsing');
    excelWorker = require('../excel_worker_client');
  }
  return excelWorker;
}

// ─── Funding Helpers (Ported for Parity) ──────────────────────────────────────
function parseFundingSplitTokens(splitStr) {
  const raw = String(splitStr || '').trim();
  if (!raw) return [];
  return raw
    .split('-')
    .map(s => s.trim())
    .filter(Boolean);
}

function randHexColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

function formatEqualSplitForTokens(tokens) {
  const n = Array.isArray(tokens) ? tokens.length : 0;
  if (!n) return '';
  // Use one decimal place and adjust last to hit 100 exactly
  const base = Math.round((1000 / n)) / 10;
  const parts = new Array(n).fill(base);
  let sum = parts.reduce((a, b) => a + b, 0);
  parts[n - 1] = Math.round((100 - (sum - parts[n - 1])) * 10) / 10;
  return tokens.map((t, i) => `${parts[i]}%${t}`).join('-');
}

// Simple validation for Mongo (skip global token check for performance/complexity reasons for now)
function validateFundingOverrideString(value) {
  const str = String(value || '').trim();
  if (!str) return { ok: true }; // Blank is valid (trigger calculation)
  
  const terms = str.split('-').map(s => s.trim()).filter(Boolean);
  if (!terms.length) return { ok: false, reason: 'No terms' };
  
  let sum = 0;
  for (const term of terms) {
    const m = term.match(/^([0-9]+(?:\.[0-9]+)?)%(.+)$/);
    if (!m) return { ok: false, reason: `Invalid term: ${term}` };
    const pct = parseFloat(m[1]);
    if (isNaN(pct)) return { ok: false, reason: 'Invalid percentage' };
    sum += pct;
  }
  if (sum < 99 || sum > 101) return { ok: false, reason: `Percent sum ${sum} out of range` };
  return { ok: true };
}

function sanitizeMapProfile(mapProfile) {
  if (!mapProfile || typeof mapProfile !== 'object') {
    return {
      mode: 'world',
      worldScope: null,
      blueprintAsset: null,
    };
  }

  const mode = mapProfile.mode === 'blueprint' ? 'blueprint' : 'world';
  const worldScope = mapProfile.worldScope && typeof mapProfile.worldScope === 'object'
    ? { ...mapProfile.worldScope }
    : null;
  const blueprintAsset = mapProfile.blueprintAsset && typeof mapProfile.blueprintAsset === 'object'
    ? { ...mapProfile.blueprintAsset }
    : null;

  return { mode, worldScope, blueprintAsset };
}

const FUNDING_SECTION = 'Funding Type Override Settings';
const FUNDING_FIELDS = ['O&M', 'Capital', 'Decommission'];

function getFundingKey(field) {
  return `${FUNDING_SECTION} – ${field}`;
}

// ─────────────────────────────────────────────────────────────────────────────

class MongoPersistence extends IPersistence {
  constructor() {
    super();
    this.initialized = false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  async initialize() {
    // Connection should be established via config, but we can verify here
    if (!mongoClient.connected()) {
      console.error('[MongoPersistence] MongoDB not connected');
      return false;
    }

    try {
      // Create indexes for collections
      await this._createIndexes();
      this.initialized = true;
      console.log('[MongoPersistence] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[MongoPersistence] Initialization failed:', error.message);
      return false;
    }
  }

  async close() {
    await mongoClient.disconnect();
    this.initialized = false;
  }

  async _createIndexes() {
    try {
      // Companies
      await mongoClient.createIndexes(COLLECTIONS.COMPANIES, [
        { key: { company: 1 }, unique: true }
      ]);

      // Locations
      await mongoClient.createIndexes(COLLECTIONS.LOCATIONS, [
        { key: { location: 1, company: 1 }, unique: true },
        { key: { company: 1 } }
      ]);

      // Asset Types
      await mongoClient.createIndexes(COLLECTIONS.ASSET_TYPES, [
        { key: { asset_type: 1, location: 1, company: 1 }, unique: true },
        { key: { asset_type: 1 } },
        { key: { company: 1, location: 1 } }
      ]);

      // Workplan Constants
      await mongoClient.createIndexes(COLLECTIONS.WORKPLAN_CONSTANTS, [
        { key: { Field: 1 }, unique: true }
      ]);

      // Algorithm Parameters
      await mongoClient.createIndexes(COLLECTIONS.ALGORITHM_PARAMETERS, [
        { key: { Parameter: 1 }, unique: true }
      ]);

      // Fixed Parameters
      await mongoClient.createIndexes(COLLECTIONS.FIXED_PARAMETERS, [
        { key: { Name: 1 }, unique: true }
      ]);

      // Status Colors
      await mongoClient.createIndexes(COLLECTIONS.STATUS_COLORS, [
        { key: { Status: 1 }, unique: true }
      ]);

      // Settings
      await mongoClient.createIndexes(COLLECTIONS.SETTINGS, [
        { key: { Key: 1 }, unique: true }
      ]);

      // Inspection Keywords
      await mongoClient.createIndexes(COLLECTIONS.INSPECTION_KEYWORDS, [
        { key: { Keyword: 1 }, unique: true }
      ]);

      // Project Keywords
      await mongoClient.createIndexes(COLLECTIONS.PROJECT_KEYWORDS, [
        { key: { Keyword: 1 }, unique: true }
      ]);

      // Repair Colors
      await mongoClient.createIndexes(COLLECTIONS.REPAIR_COLORS, [
        { key: { company: 1, location: 1, asset_type: 1 }, unique: true }
      ]);

      console.log('[MongoPersistence] Indexes created successfully');
    } catch (error) {
      console.warn('[MongoPersistence] Some indexes may already exist:', error.message);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COMPANIES
  // ════════════════════════════════════════════════════════════════════════════

  async getActiveCompanies() {
    const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
    const companies = await collection.find({ active: true }).toArray();
    return companies.map(c => c.company);
  }

  async upsertCompany(name, active = true, description = '', email = '', mapProfile = null) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const now = new Date();
      const cleanMapProfile = sanitizeMapProfile(mapProfile);

      await collection.updateOne(
        { company: name },
        {
          $set: { company: name, active, description, email, mapProfile: cleanMapProfile, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertCompany failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - LOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async getLocationsForCompany(company) {
    const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
    const locations = await collection.find({ company }).toArray();
    return locations.map(l => l.location);
  }

  async upsertLocation(location, company) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const now = new Date();

      await collection.updateOne(
        { location, company },
        {
          $set: { location, company, _updatedAt: now },
          $setOnInsert: { link: '', _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setLocationLink(company, location, link) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const now = new Date();

      await collection.updateOne(
        { location, company },
        { $set: { link: link || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setLocationLink failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - ASSET TYPES
  // ════════════════════════════════════════════════════════════════════════════

  async getAssetTypesForCompanyLocation(company, location) {
    const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
    const assets = await collection.find({ company, location }).toArray();
    return assets.map(a => a.asset_type);
  }

  async upsertAssetType(assetType, company, location) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location, company },
        {
          $set: { asset_type: assetType, location, company, _updatedAt: now },
          $setOnInsert: { color: randHexColor(), link: '', _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] upsertAssetType failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeLink(assetType, company, location, link) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { $set: { link: link || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeLink failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - COLORS
  // ════════════════════════════════════════════════════════════════════════════

  async getColorMaps() {
    const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
    const assets = await collection.find({ color: { $ne: '' } }).toArray();

    const global = new Map();
    const byLocation = new Map();
    const byCompanyLocation = new Map();

    for (const asset of assets) {
      const { asset_type, location, company, color } = asset;

      if (!color) continue;

      if (company && location) {
        if (!byCompanyLocation.has(company)) {
          byCompanyLocation.set(company, new Map());
        }
        const locMap = byCompanyLocation.get(company);

        if (!locMap.has(location)) {
          locMap.set(location, new Map());
        }
        const assetMap = locMap.get(location);
        assetMap.set(asset_type, color);
      }
    }

    return { global, byLocation, byCompanyLocation };
  }

  async setAssetTypeColor(assetType, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location: '', company: '' },
        {
          $set: { asset_type: assetType, location: '', company: '', color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColor failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeColorForLocation(assetType, location, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, location, company: '' },
        {
          $set: { asset_type: assetType, location, company: '', color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColorForLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { $set: { color: color || '', _updatedAt: now } }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setAssetTypeColorForCompanyLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIR COLORS
  // ════════════════════════════════════════════════════════════════════════════

  async getRepairColorMaps() {
    const collection = mongoClient.getCollection(COLLECTIONS.REPAIR_COLORS);
    const docs = await collection.find({}).toArray();

    const byCompanyLocation = new Map();

    for (const doc of docs) {
      const { asset_type, location, company, color } = doc;
      if (!color || !company || !location) continue;

      if (!byCompanyLocation.has(company)) {
        byCompanyLocation.set(company, new Map());
      }
      const locMap = byCompanyLocation.get(company);

      if (!locMap.has(location)) {
        locMap.set(location, new Map());
      }
      const assetMap = locMap.get(location);
      assetMap.set(asset_type, color);
    }

    return { byCompanyLocation };
  }

  async setRepairColorForCompanyLocation(assetType, company, location, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.REPAIR_COLORS);
      const now = new Date();

      await collection.updateOne(
        { asset_type: assetType, company, location },
        { 
          $set: { color: color || '', _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setRepairColorForCompanyLocation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - SNAPSHOT & TREE
  // ════════════════════════════════════════════════════════════════════════════

  async readLookupsSnapshot() {
    try {
      const companiesCollection = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const companiesDocs = await companiesCollection.find({ active: true }).toArray();
      
      // Map to Objects to support frontend filters.js
      const companies = companiesDocs.map(c => ({
        name: c.company,
        description: c.description || '',
        email: c.email || '',
        mapProfile: sanitizeMapProfile(c.mapProfile)
      }));

      const locsByCompany = {};
      const locationsCollection = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const allLocations = await locationsCollection.find({}).toArray();
      for (const loc of allLocations) {
        if (!locsByCompany[loc.company]) {
          locsByCompany[loc.company] = [];
        }
        locsByCompany[loc.company].push(loc.location);
      }

      const assetsByCompanyLocation = {};
      const assetsCollection = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      const allAssets = await assetsCollection.find({}).toArray();
      for (const asset of allAssets) {
        if (!asset.company || !asset.location) continue;
        if (!assetsByCompanyLocation[asset.company]) {
          assetsByCompanyLocation[asset.company] = {};
        }
        if (!assetsByCompanyLocation[asset.company][asset.location]) {
          assetsByCompanyLocation[asset.company][asset.location] = [];
        }
        assetsByCompanyLocation[asset.company][asset.location].push(asset.asset_type);
      }

      const colorsGlobal = {};
      const colorsByLoc = {};
      const colorsByCompanyLoc = {};

      for (const asset of allAssets) {
        if (!asset.color) continue;
        if (!asset.location && !asset.company) {
          colorsGlobal[asset.asset_type] = asset.color;
        } else if (asset.location && !asset.company) {
          if (!colorsByLoc[asset.location]) colorsByLoc[asset.location] = {};
          colorsByLoc[asset.location][asset.asset_type] = asset.color;
        } else if (asset.company && asset.location) {
          if (!colorsByCompanyLoc[asset.company]) colorsByCompanyLoc[asset.company] = {};
          if (!colorsByCompanyLoc[asset.company][asset.location]) colorsByCompanyLoc[asset.company][asset.location] = {};
          colorsByCompanyLoc[asset.company][asset.location][asset.asset_type] = asset.color;
        }
      }

      // Helper to normalize location keys (lowercase) to match app.js/config.js expectation
      const normKey = (s) => String(s || '').trim().toLowerCase();

      const locationLinks = {};
      for (const loc of allLocations) {
        if (loc.link) {
          if (!locationLinks[loc.company]) locationLinks[loc.company] = {};
          locationLinks[loc.company][normKey(loc.location)] = loc.link;
        }
      }

      const assetTypeLinks = {};
      for (const asset of allAssets) {
        if (asset.link && asset.company && asset.location) {
          if (!assetTypeLinks[asset.company]) assetTypeLinks[asset.company] = {};
          const lKey = normKey(asset.location);
          if (!assetTypeLinks[asset.company][lKey]) assetTypeLinks[asset.company][lKey] = {};
          assetTypeLinks[asset.company][lKey][asset.asset_type] = asset.link;
        }
      }

      const statusColorsMap = {};
      const statusColorsCollection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      const statusColorsDocs = await statusColorsCollection.find({}).toArray();
      for (const doc of statusColorsDocs) {
        // FIX: Normalize status keys to lowercase so app.js can match them
        if (doc.Status) {
          statusColorsMap[doc.Status.toLowerCase()] = doc.Color;
        }
      }

      const settingsCollection = mongoClient.getCollection(COLLECTIONS.SETTINGS);
      // Fetch all settings and helper to find case-insensitive keys
      const settingsDocs = await settingsCollection.find({}).toArray();
      const getSetting = (key) => {
        const found = settingsDocs.find(d => d.Key && d.Key.toLowerCase() === key.toLowerCase());
        return found ? found.Value : false;
      };

      const inspectionKeywordsCollection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
      const inspectionKeywordsDocs = await inspectionKeywordsCollection.find({}).toArray();
      const inspectionKeywords = inspectionKeywordsDocs.map(k => k.Keyword);

      const projectKeywordsCollection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
      const projectKeywordsDocs = await projectKeywordsCollection.find({}).toArray();
      const projectKeywords = projectKeywordsDocs.map(k => k.Keyword);

      // Load Repair Colors for Snapshot
      const repairColorsCollection = mongoClient.getCollection(COLLECTIONS.REPAIR_COLORS);
      const repairColorsDocs = await repairColorsCollection.find({}).toArray();
      
      const repairColorsByCompanyLoc = {};
      for (const doc of repairColorsDocs) {
        if (!doc.color) continue;
        if (!repairColorsByCompanyLoc[doc.company]) repairColorsByCompanyLoc[doc.company] = {};
        if (!repairColorsByCompanyLoc[doc.company][doc.location]) repairColorsByCompanyLoc[doc.company][doc.location] = {};
        repairColorsByCompanyLoc[doc.company][doc.location][doc.asset_type] = doc.color;
      }

      return {
        mtimeMs: Date.now(),
        companies,
        locsByCompany,
        assetsByCompanyLocation,
        colorsGlobal,
        colorsByLoc,
        colorsByCompanyLoc,
        locationLinks,
        assetTypeLinks,
        statusColors: statusColorsMap,
        applyStatusColorsOnMap: !!getSetting('applyStatusColorsOnMap'),
        repairColors: repairColorsByCompanyLoc,
        applyRepairColorsOnMap: !!getSetting('applyRepairColorsOnMap'),
        statusOverridesRepair: !!getSetting('statusOverridesRepair'),
        inspectionKeywords,
        projectKeywords
      };
    } catch (error) {
      console.error('[MongoPersistence] readLookupsSnapshot failed:', error.message);
      return {
        mtimeMs: Date.now(),
        companies: [],
        locsByCompany: {},
        assetsByCompanyLocation: {},
        colorsGlobal: {},
        colorsByLoc: {},
        colorsByCompanyLoc: {},
        locationLinks: {},
        assetTypeLinks: {},
        statusColors: {},
        applyStatusColorsOnMap: false,
        repairColors: {},
        applyRepairColorsOnMap: false,
        statusOverridesRepair: false,
        inspectionKeywords: [],
        projectKeywords: []
      };
    }
  }

  async getLookupTree() {
    const snapshot = await this.readLookupsSnapshot();
    return {
      companies: snapshot.companies,
      locationsByCompany: snapshot.locsByCompany,
      assetsByCompanyLocation: snapshot.assetsByCompanyLocation
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - STATUS & REPAIR SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async getStatusAndRepairSettings() {
    const snapshot = await this.readLookupsSnapshot();
    return {
      statusColors: snapshot.statusColors,
      applyStatusColorsOnMap: snapshot.applyStatusColorsOnMap,
      repairColors: snapshot.repairColors,
      applyRepairColorsOnMap: snapshot.applyRepairColorsOnMap
    };
  }

  async setStatusColor(statusKey, color) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      const now = new Date();

      await collection.updateOne(
        { Status: statusKey },
        {
          $set: { Status: statusKey, Color: color, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setStatusColor failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async setSettingBoolean(key, value) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.SETTINGS);
      const now = new Date();

      await collection.updateOne(
        { Key: key },
        {
          $set: { Key: key, Value: !!value, _updatedAt: now },
          $setOnInsert: { _createdAt: now, _source: 'manual' }
        },
        { upsert: true }
      );

      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setSettingBoolean failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteStatusRow(statusKey) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.STATUS_COLORS);
      await collection.deleteOne({ Status: statusKey });
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] deleteStatusRow failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - INSPECTION KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getInspectionKeywords() {
    const collection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
    const keywords = await collection.find({}).toArray();
    return keywords.map(k => k.Keyword);
  }

  async setInspectionKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.INSPECTION_KEYWORDS);
      await collection.deleteMany({});
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ Keyword: keyword }, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setInspectionKeywords failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - PROJECT KEYWORDS
  // ════════════════════════════════════════════════════════════════════════════

  async getProjectKeywords() {
    const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
    const keywords = await collection.find({}).toArray();
    return keywords.map(k => k.Keyword);
  }

  async setProjectKeywords(keywords) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.PROJECT_KEYWORDS);
      await collection.deleteMany({});
      if (keywords.length > 0) {
        const docs = keywords.map(keyword => addMetadata({ Keyword: keyword }, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] setProjectKeywords failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - READ
  // ════════════════════════════════════════════════════════════════════════════

  async readStationsAggregate() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      // Filter station data collections (suffix _stationData)
      const stationCollections = collections.filter(name => name.endsWith('_stationData'));
      console.log(`[MongoPersistence] Found ${stationCollections.length} station collections.`);

      const allStations = [];

      for (const collName of stationCollections) {
        const collection = db.collection(collName);
        const stations = await collection.find({}).toArray();
        
        // ══════════════════════════════════════════════════════════════════════
        // FIX: Flatten Composite Keys for Algorithm Compatibility
        // The Optimization Algorithm expects plain keys (e.g. "City of Travel"),
        // but the DB stores "General Information – City of Travel".
        // We also polyfill "Access Type" from the core "asset_type" field.
        // ══════════════════════════════════════════════════════════════════════
        const flattened = stations.map(st => {
          const flat = { ...st };
          
          Object.keys(st).forEach(key => {
            if (key.includes(' – ')) {
              const parts = key.split(' – ');
              // parts[0] is Section, parts[1] is Field Name
              if (parts.length === 2) {
                const fieldName = parts[1].trim();
                // Only set if not already present (prefer explicit core fields)
                if (flat[fieldName] === undefined) {
                  flat[fieldName] = st[key];
                }
              }
            }
          });

          // Ensure Algorithm-critical fields exist
          if (!flat['Access Type']) flat['Access Type'] = st.asset_type;
          if (!flat['Category']) flat['Category'] = st.asset_type;
          if (!flat['Station ID']) flat['Station ID'] = st.station_id;
          
          return flat;
        });

        allStations.push(...flattened);
      }

      console.log(`[MongoPersistence] Read ${allStations.length} total stations from MongoDB`);
      return { success: true, rows: allStations };
    } catch (error) {
      console.error('[MongoPersistence] readStationsAggregate failed:', error.message);
      return { success: false, rows: [] };
    }
  }

  async readLocationWorkbook(company, locationName) {
    try {
      // In MongoDB, we treat collections as "sheets".
      // We look for collections named {Company}_{Location}_*
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      // Find all collections matching the company/location prefix
      const matching = collections.filter(name => name.startsWith(prefix));
      
      // Convert collection names to friendly "Sheet Names"
      const sheets = matching.map(collName => {
        // Remove prefix
        let suffix = collName.replace(prefix, '');
        
        if (suffix.endsWith('_stationData')) {
          // E.g. "Cableway_stationData" -> "Cableway"
          return suffix.replace('_stationData', '').replace(/_/g, ' ');
        } else if (suffix === 'repairs') {
          // "repairs" -> "Repairs"
          return 'Repairs';
        }
        return suffix;
      });

      return { success: true, sheets: sheets.sort() };
    } catch (error) {
      console.error('[MongoPersistence] readLocationWorkbook failed:', error.message);
      return { success: false, sheets: [] };
    }
  }

  async readSheetData(company, locationName, sheetName) {
    try {
      let collectionName;
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

      if (sheetName.toLowerCase() === 'repairs') {
        collectionName = mongoClient.getRepairsCollectionName(company, locationName);
      } else {
        // ═══════════════════════════════════════════════════════════════════
        // FIX: Parse sheet name to extract asset type properly
        // Sheet names come in as "AssetType Location" format from readLocationWorkbook
        // But we need just the asset type part for the collection name
        // ═══════════════════════════════════════════════════════════════════
        
        let assetType = sheetName;
        
        // Remove location suffix if present (e.g., "Cableway BC" -> "Cableway")
        const locationLower = locationName.toLowerCase();
        const sheetLower = sheetName.toLowerCase();
        
        if (sheetLower.endsWith(' ' + locationLower)) {
          assetType = sheetName.substring(0, sheetName.length - locationName.length - 1).trim();
        }
        
        collectionName = mongoClient.getStationCollectionName(company, locationName, assetType);
      }

      const collection = mongoClient.getCollection(collectionName);
      const rows = await collection.find({}).toArray();

      // ═══════════════════════════════════════════════════════════════════
      // FIX: Return schema metadata (sections/fields) for import compatibility
      // Extract sections and fields from the first document's composite keys
      // ═══════════════════════════════════════════════════════════════════
      
      const sections = [];
      const fields = [];
      
      if (rows.length > 0) {
        const sampleDoc = rows[0];
        const SEP = ' – ';
        const GI_FIELDS = ['station_id', 'asset_type', 'name', 'province', 'lat', 'lon', 'status', 'company', 'location_file'];
        
        // Build sections/fields from composite keys (excluding GI and metadata)
        Object.keys(sampleDoc).forEach(key => {
          // Skip internal fields
          if (key.startsWith('_')) return;
          // Skip core GI fields
          if (GI_FIELDS.includes(key)) return;
          
          // Check if it's a composite key
          if (key.includes(SEP)) {
            const [section, field] = key.split(SEP, 2);
            sections.push(section.trim());
            fields.push(field.trim());
          } else {
            // Plain field - treat as "Extra Information" section
            sections.push('');
            fields.push(key);
          }
        });
      }

      return { 
        success: true, 
        rows,
        sections,
        fields
      };
    } catch (error) {
      console.error('[MongoPersistence] readSheetData failed:', error);
      // Collection might not exist yet, which is fine
      return { success: true, rows: [], sections: [], fields: [] };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIONS - WRITE
  // ════════════════════════════════════════════════════════════════════════════

  async writeLocationRows(company, location, sheetName, sections, headers, rows) {
    try {
      // 1. Determine Collection Name based on sheetName (Asset Type)
      let assetType = sheetName;
      if (sheetName.endsWith(' ' + location)) {
        assetType = sheetName.substring(0, sheetName.lastIndexOf(' ' + location));
      }
      
      const collectionName = mongoClient.getStationCollectionName(company, location, assetType);
      console.log(`[MongoPersistence] Writing ${rows.length} stations to collection: ${collectionName}`);

      const collection = mongoClient.getCollection(collectionName);
      const now = new Date();

      // Use bulkWrite for performance
      const operations = rows.map(row => {
        const stationId = row['Station ID'] || row['station_id'] || row['StationID'] || row['ID'];
        if (!stationId) return null; // Skip invalid rows

        // Normalize specific core fields for the aggregate view
        const coreFields = {
          station_id: String(stationId).trim(),
          asset_type: row['Category'] || row['asset_type'] || assetType,
          name: row['Site Name'] || row['name'] || row['Station Name'] || '',
          province: row['Province'] || row['province'] || row['Location'] || location,
          lat: row['Latitude'] || row['lat'] || '',
          lon: row['Longitude'] || row['lon'] || '',
          status: row['Status'] || row['status'] || 'Active',
          company: company,
          location_file: location,
          _updatedAt: now
        };

        // Strip metadata from incoming row
        const { _id, _createdAt, ...dynamicData } = row;

        // ═══════════════════════════════════════════════════════════════════
        // FIX: Find Funding Split/Type value to auto-populate funding override fields
        // ═══════════════════════════════════════════════════════════════════
        let fundingSplitVal = '';
        const fundingSplitVariants = ['Funding Split', 'Funding Type'];
        
        for (const variant of fundingSplitVariants) {
          // Check plain key first
          if (dynamicData[variant]) {
            fundingSplitVal = String(dynamicData[variant]).trim();
            break;
          }
          // Check composite keys (any section prefix)
          for (const key of Object.keys(dynamicData)) {
            const keyLower = key.toLowerCase();
            const variantLower = variant.toLowerCase();
            // Match patterns like "Section – Funding Split" or "Section - Funding Type"
            if (keyLower.endsWith(` – ${variantLower}`) || 
                keyLower.endsWith(` - ${variantLower}`)) {
              fundingSplitVal = String(dynamicData[key] || '').trim();
              break;
            }
          }
          if (fundingSplitVal) break;
        }

        // Parse tokens and generate default funding value
        const tokens = parseFundingSplitTokens(fundingSplitVal);
        const defaultFundingValue = formatEqualSplitForTokens(tokens);

        // Ensure Funding Type Override Settings fields exist and are populated
        FUNDING_FIELDS.forEach(field => {
          const compositeKey = getFundingKey(field);

          // 1. If plain key exists (e.g. from import), migrate it to composite
          if (dynamicData[field] !== undefined && dynamicData[compositeKey] === undefined) {
            dynamicData[compositeKey] = dynamicData[field];
            delete dynamicData[field];
          }

          // 2. FIX: If composite key is empty/missing AND we have tokens, populate with default
          const currentVal = dynamicData[compositeKey];
          if ((!currentVal || String(currentVal).trim() === '') && defaultFundingValue) {
            dynamicData[compositeKey] = defaultFundingValue;
          }

          // 3. If still undefined, initialize to empty string
          if (dynamicData[compositeKey] === undefined) {
            dynamicData[compositeKey] = '';
          }
        });
        // ═══════════════════════════════════════════════════════════════════

        const doc = {
          ...dynamicData,
          ...coreFields
        };

        return {
          updateOne: {
            filter: { station_id: coreFields.station_id },
            update: {
              $set: doc,
              $setOnInsert: { _createdAt: now, _source: 'manual' }
            },
            upsert: true
          }
        };
      }).filter(op => op !== null);

      if (operations.length > 0) {
        await collection.bulkWrite(operations);
      }

      console.log(`[MongoPersistence] Successfully wrote ${operations.length} stations to ${collectionName}`);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] writeLocationRows failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      // 1. Find the EXISTING station
      const candidates = collections.filter(name => 
        name.startsWith(prefix) && name.endsWith('_stationData')
      );

      let found = false;
      let existingDoc = null;
      let sourceCollectionName = null;
      let sourceCollection = null;

      for (const collName of candidates) {
        const collection = db.collection(collName);
        const existing = await collection.findOne({ station_id: stationId });
        if (existing) {
          existingDoc = existing;
          sourceCollectionName = collName;
          sourceCollection = collection;
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, message: 'Station not found in any asset collection for this location' };
      }

      // 2. Prepare the Updated Data (Merge existing with updates)
      const { _id, _createdAt, ...rest } = updatedRowData;
      const updatedData = { ...rest }; // Copy so we don't mutate input

      // ═══════════════════════════════════════════════════════════════════
      // CORE FIELD MAPPING (Composite -> Core)
      // ═══════════════════════════════════════════════════════════════════
      Object.keys(updatedData).forEach(key => {
        if (key.startsWith('General Information – ')) {
          const field = key.replace('General Information – ', '');
          if (field === 'Station ID') updatedData.station_id = updatedData[key];
          else if (field === 'Category' || field === 'Asset Type') updatedData.asset_type = updatedData[key];
          else if (field === 'Station Name' || field === 'Site Name') updatedData.name = updatedData[key];
          else if (field === 'Province' || field === 'Location') updatedData.province = updatedData[key];
          else if (field === 'Latitude') updatedData.lat = updatedData[key];
          else if (field === 'Longitude') updatedData.lon = updatedData[key];
          else if (field === 'Status') updatedData.status = updatedData[key];
        }
      });

      // 3. Determine NEW Coordinates (Location / Asset Type)
      // Fallback to existing doc if not in update
      const newProv = String(updatedData.province || existingDoc.province || locationName).trim();
      const newAssetType = String(updatedData.asset_type || existingDoc.asset_type).trim();
      
      // Calculate target collection name based on NEW values
      // NOTE: We force 'company' to remain the same to satisfy the requirement
      const targetCollectionName = mongoClient.getStationCollectionName(company, newProv, newAssetType);

      // 4. Schema Processing (Prepare final document)
      let finalDoc = {};
      
      if (schema && schema.sections && schema.fields && schema.sections.length > 0) {
        // ... (Existing Schema Deletion Logic) ...
        const GI_FIELDS = [
          'station_id', 'asset_type', 'name', 'province', 'lat', 'lon', 'status',
          'company', 'location_file', '_updatedAt', '_createdAt', '_source'
        ];
        
        // Preserve GI from Existing or Update
        Object.keys(existingDoc).forEach(key => {
          if (GI_FIELDS.includes(key) || key.startsWith('_')) finalDoc[key] = existingDoc[key];
        });
        
        // Overwrite with Updates
        ['station_id', 'asset_type', 'name', 'province', 'lat', 'lon', 'status'].forEach(field => {
          if (updatedData[field] !== undefined) finalDoc[field] = updatedData[field];
        });

        // Apply Schema Fields
        schema.fields.forEach((field, idx) => {
          const section = schema.sections[idx];
          if (section && section.toLowerCase() === 'general information') return;
          
          const composite = `${section} – ${field}`;
          let value = '';
          if (updatedData[composite] !== undefined) value = updatedData[composite];
          else if (updatedData[field] !== undefined) value = updatedData[field];
          else if (existingDoc[composite] !== undefined) value = existingDoc[composite];
          else if (existingDoc[field] !== undefined) value = existingDoc[field];
          
          finalDoc[composite] = value;
        });
      } else {
        // No Schema: Simple Merge
        finalDoc = { ...existingDoc, ...updatedData };
      }

      // Ensure Core Metadata is set for the move
      finalDoc.company = company; // Enforce company lock
      finalDoc.location_file = newProv; // Sync location_file property
      finalDoc.asset_type = newAssetType;
      finalDoc._updatedAt = new Date();

      // 5. CHECK FOR MOVE (Different Collection?)
      if (targetCollectionName !== sourceCollectionName) {
        console.log(`[MongoPersistence] Moving station ${stationId}: ${sourceCollectionName} -> ${targetCollectionName}`);

        // A. Insert into NEW collection
        const targetCollection = db.collection(targetCollectionName);
        
        // FIX: Extract _createdAt AND _source so they aren't in $set (avoiding conflict with $setOnInsert)
        // We also strip _id so MongoDB generates a new one for the new collection
        const { _id: oldId, _createdAt, _source, ...docToInsert } = finalDoc; 
       
        await targetCollection.updateOne(
          { station_id: docToInsert.station_id },
          { 
            $set: docToInsert,
            // Use the original creation date/source if available, otherwise defaults
            $setOnInsert: { 
              _createdAt: _createdAt || new Date(), 
              _source: _source || 'manual' 
            }
          },
          { upsert: true }
        );

        // B. Delete from OLD collection
        await sourceCollection.deleteOne({ _id: existingDoc._id });

        // C. Update Lookups (Create filters if they don't exist)
        await this.upsertLocation(newProv, company);
        await this.upsertAssetType(newAssetType, company, newProv);

        return { success: true, moved: true, newLocation: newProv, newAssetType: newAssetType };

      } else {
        // 6. IN-PLACE UPDATE (Same Collection)
        // Use replaceOne to handle field deletions if using schema
        if (schema) {
          await sourceCollection.replaceOne({ _id: existingDoc._id }, finalDoc);
        } else {
          await sourceCollection.updateOne({ _id: existingDoc._id }, { $set: finalDoc });
        }
        return { success: true, moved: false };
      }

    } catch (error) {
      console.error('[MongoPersistence] updateStationInLocationFile failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteStation(company, locationName, stationId) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;
      
      // Find potential collections
      const targets = collections.filter(name => name.startsWith(prefix) && name.endsWith('_stationData'));
      
      let deleted = false;

      for (const collName of targets) {
        const collection = db.collection(collName);
        const result = await collection.deleteOne({ station_id: stationId });
        
        if (result.deletedCount > 0) {
          deleted = true;
          // Optionally: also delete repairs associated with this station?
          // For now, adhering strictly to "Delete Station" requirements.
          break;
        }
      }

      if (deleted) return { success: true };
      return { success: false, message: 'Station not found' };
    } catch (error) {
      console.error('[MongoPersistence] deleteStation failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPAIRS
  // ════════════════════════════════════════════════════════════════════════════

  async listRepairsForStation(company, location, assetType, stationId) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);
      const repairs = await collection.find({ station_id: stationId }).toArray();
      return repairs;
    } catch (error) {
      // Collection might not exist yet
      return [];
    }
  }

  async getAllRepairs() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();

      // Filter repair collections
      const repairCollections = collections.filter(name => name.endsWith('_repairs'));

      const allRepairs = [];

      for (const collName of repairCollections) {
        const collection = db.collection(collName);
        const repairs = await collection.find({}).toArray();

        // Extract company and location from collection name
        const parts = collName.replace('_repairs', '').split('_');
        const company = parts[0];
        const location = parts.slice(1).join('_');

        // Add location info to each repair
        const enriched = repairs.map(r => ({
          ...r,
          company: r.company || company,
          location: r.location || location
        }));

        allRepairs.push(...enriched);
      }

      return allRepairs;
    } catch (error) {
      console.error('[MongoPersistence] getAllRepairs failed:', error.message);
      return [];
    }
  }

  async saveStationRepairs(company, location, assetType, stationId, repairs) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      // Delete existing repairs for this station
      await collection.deleteMany({ station_id: stationId });

      if (repairs.length > 0) {
        const now = new Date();
        const docs = repairs.map(repair => {
          const { _id, ...clean } = repair;
          return {
            ...clean,
            station_id: stationId,
            assetType: clean.assetType || assetType,
            location,
            company,
            _createdAt: now,
            _updatedAt: now,
            _source: 'manual'
          };
        });
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] saveStationRepairs failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async appendRepair(company, location, assetType, repair) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      const { _id, ...clean } = repair;
      const now = new Date();
      
      const doc = {
        ...clean,
        station_id: clean.station_id || clean['Station ID'],
        assetType: clean.assetType || assetType,
        location,
        company,
        _createdAt: now,
        _updatedAt: now,
        _source: 'manual'
      };

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] appendRepair failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  async deleteRepair(company, location, assetType, stationId, repairIndex) {
    try {
      const collectionName = mongoClient.getRepairsCollectionName(company, location);
      const collection = mongoClient.getCollection(collectionName);

      const repairs = await collection.find({ station_id: stationId }).sort({ date: 1 }).toArray();

      if (repairIndex >= 0 && repairIndex < repairs.length) {
        const target = repairs[repairIndex];
        await collection.deleteOne({ _id: target._id });
        return { success: true };
      }
      return { success: false, message: 'Invalid repair index' };
    } catch (error) {
      console.error('[MongoPersistence] deleteRepair failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ALGORITHM DATA
  // ════════════════════════════════════════════════════════════════════════════

  async getAlgorithmParameters() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ALGORITHM_PARAMETERS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveAlgorithmParameters(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.ALGORITHM_PARAMETERS);
      await collection.deleteMany({});
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getWorkplanConstants() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveWorkplanConstants(rows) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.WORKPLAN_CONSTANTS);
      await collection.deleteMany({});
      if (rows.length > 0) {
        const docs = rows.map(row => addMetadata(row, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getCustomWeights() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.CUSTOM_WEIGHTS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async addCustomWeight(weight, active) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.CUSTOM_WEIGHTS);
      const doc = addMetadata({ weight, active: !!active }, 'manual');
      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getFixedParameters() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);
      return await collection.find({}).toArray();
    } catch (error) {
      return [];
    }
  }

  async saveFixedParameters(params) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.FIXED_PARAMETERS);
      await collection.deleteMany({});
      if (params.length > 0) {
        const docs = params.map(param => addMetadata(param, 'manual'));
        await collection.insertMany(docs);
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════════════════════════════════════

  // The Import Wizard (Step 3 & 4) requires parsing the user-uploaded Excel file.
  // We delegate this parsing to the Excel Worker, even if we are in "MongoDB Mode".

  async listSheets(b64) {
    const excel = getExcelWorker();
    return await excel.listSheets(b64);
  }

  async parseRows(b64) {
    const excel = getExcelWorker();
    return await excel.parseRows(b64);
  }

  async parseRowsFromSheet(b64, sheetName) {
    const excel = getExcelWorker();
    return await excel.parseRowsFromSheet(b64, sheetName);
  }

  async ensureLookupsReady() {
    return { success: true };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOOKUPS - DELETE OPERATIONS (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async deleteCompanyFromLookups(companyName) {
    try {
      const companies = mongoClient.getCollection(COLLECTIONS.COMPANIES);
      const locations = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);

      // Delete from Companies
      await companies.deleteOne({ company: companyName });

      // Cascade delete from Locations
      await locations.deleteMany({ company: companyName });

      // Cascade delete from AssetTypes
      await assets.deleteMany({ company: companyName });

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteLocationFromLookups(companyName, locationName) {
    try {
      const locations = mongoClient.getCollection(COLLECTIONS.LOCATIONS);
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);

      // Delete specific location
      await locations.deleteOne({ company: companyName, location: locationName });

      // Cascade delete associated AssetTypes
      await assets.deleteMany({ company: companyName, location: locationName });

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
    try {
      const assets = mongoClient.getCollection(COLLECTIONS.ASSET_TYPES);
      await assets.deleteOne({
        company: companyName,
        location: locationName,
        asset_type: assetTypeName
      });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
    try {
      // In MongoDB, this means dropping the specific collection for this asset type
      const collectionName = mongoClient.getStationCollectionName(companyName, locationName, assetTypeName);
      const db = mongoClient.getDatabase();
      
      // Check if collection exists before dropping to avoid error
      const collections = await mongoClient.listCollections();
      if (collections.includes(collectionName)) {
        await db.collection(collectionName).drop();
      }
      
      return { success: true };
    } catch (error) {
      // Ignore "ns not found" errors, strictly speaking success if it's gone
      return { success: true, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCHEMA MANAGEMENT (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async updateAssetTypeSchema(assetType, schema, excludeStationId) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      
      // Find all collections that might match this asset type
      const targets = collections.filter(c => 
        c.endsWith('_stationData') && c.toLowerCase().includes(assetType.toLowerCase())
      );

      let totalUpdated = 0;
      const results = [];

      // ═══════════════════════════════════════════════════════════════════
      // FIX: Proper deletion sync - Clear and rebuild non-GI fields
      // ═══════════════════════════════════════════════════════════════════
      
      // Define General Information fields to preserve
      const GI_FIELDS = [
        'station_id', 'asset_type', 'name', 'province', 'lat', 'lon', 'status',
        'company', 'location_file', '_updatedAt', '_createdAt', '_source'
      ];
      
      for (const collName of targets) {
        const collection = db.collection(collName);
        
        // Build schema field map for quick lookup
        const schemaFields = new Map();
        schema.fields.forEach((field, idx) => {
          const section = schema.sections[idx];
          const composite = section ? `${section} – ${field}` : field;
          schemaFields.set(composite, true);
        });
        
        // Filter: exclude the specific station that triggered this sync
        const filter = excludeStationId ? { station_id: { $ne: excludeStationId } } : {};
        
        const cursor = collection.find(filter);
        const bulkOps = [];
        
        while(await cursor.hasNext()) {
          const doc = await cursor.next();
          
          // 1. Preserve GI fields and existing values
          const preserved = {};
          const existingValues = {};
          
          Object.keys(doc).forEach(key => {
            if (GI_FIELDS.includes(key) || key.startsWith('_')) {
              preserved[key] = doc[key];
            } else {
              // Store for potential reuse if field still exists in schema
              existingValues[key.toLowerCase()] = doc[key];
            }
          });
          
          // 2. Build updates object with ONLY schema fields
          const updates = { ...preserved };
          
          schema.fields.forEach((field, idx) => {
            const section = schema.sections[idx];
            const composite = section ? `${section} – ${field}` : field;
            
            // Try to find existing value
            let value = '';
            const compositeLower = composite.toLowerCase();
            const fieldLower = field.toLowerCase();
            
            if (existingValues[compositeLower] !== undefined) {
              value = existingValues[compositeLower];
            } else if (existingValues[fieldLower] !== undefined) {
              value = existingValues[fieldLower];
            }
            
            updates[composite] = value;
          });
          
          // 3. Use $set to update with ONLY the fields we want (implicit deletion of others)
          bulkOps.push({
            replaceOne: {
              filter: { _id: doc._id },
              replacement: updates
            }
          });
          
          totalUpdated++;
        }
        
        if (bulkOps.length > 0) {
          await collection.bulkWrite(bulkOps);
          results.push({ collection: collName, updated: true });
        }
      }

      return { 
        success: true, 
        totalUpdated, 
        results, 
        message: `Updated schema for ${totalUpdated} stations across ${results.length} collections`
      };
    } catch (error) {
      console.error('[MongoPersistence] updateAssetTypeSchema failed:', error);
      return { success: false, message: error.message };
    }
  }

  async getWorkbookFieldCatalog(company, locationName) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const result = { repairs: [], sheets: {} };
      
      // ═══════════════════════════════════════════════════════════════════
      // FIX: Return full composite keys (with sections) for proper import mapping
      // Helper to get ALL keys from a doc (including composite "Section – Field" keys)
      // ═══════════════════════════════════════════════════════════════════
      const getKeys = (doc) => {
        if (!doc) return [];
        return Object.keys(doc).filter(k => {
          // Exclude internal metadata
          if (k.startsWith('_')) return false;
          // Exclude core GI fields that are always present
          if (['station_id', 'asset_type', 'name', 'province', 'lat', 'lon', 'status', 'company', 'location_file'].includes(k)) return false;
          return true;
        });
      };

      // MODE 1: GLOBAL SCAN (No arguments provided) - Used for Autocomplete
      if (!company && !locationName) {
        const repairFields = new Set();
        const sheetFields = {}; // Map<AssetType, Set<Field>>

        for (const collName of collections) {
          if (collName.endsWith('_repairs')) {
            const doc = await db.collection(collName).findOne({});
            if (doc) getKeys(doc).forEach(k => repairFields.add(k));
          } else if (collName.endsWith('_stationData')) {
            const doc = await db.collection(collName).findOne({});
            if (doc) {
              // Use asset_type field if available, otherwise fallback to collection name parsing
              let assetType = doc.asset_type;
              if (!assetType) {
                // Fallback parsing if field missing
                // Collection format: Company_Location_AssetType_stationData
                const parts = collName.replace('_stationData', '').split('_');
                assetType = parts.slice(2).join(' '); 
              }
              
              if (assetType) {
                if (!sheetFields[assetType]) sheetFields[assetType] = new Set();
                getKeys(doc).forEach(k => sheetFields[assetType].add(k));
              }
            }
          }
        }

        result.repairs = Array.from(repairFields).sort();
        Object.keys(sheetFields).forEach(sheet => {
          result.sheets[sheet] = Array.from(sheetFields[sheet]).sort();
        });
        
        return result;
      }

      // MODE 2: SPECIFIC LOCATION SCAN
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(locationName)}_`;

      // 1. Get Repairs Fields (with composite keys)
      const repairsCollName = mongoClient.getRepairsCollectionName(company, locationName);
      if (collections.includes(repairsCollName)) {
        const sample = await db.collection(repairsCollName).findOne({});
        if (sample) {
          result.repairs = getKeys(sample).sort();
        }
      }

      // 2. Get Station Sheets Fields (with composite keys)
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));
      
      for (const collName of stationColls) {
        let suffix = collName.replace(prefix, '').replace('_stationData', '');
        const sheetName = suffix.replace(/_/g, ' ');

        const sample = await db.collection(collName).findOne({});
        if (sample) {
          result.sheets[sheetName] = getKeys(sample).sort();
        } else {
          result.sheets[sheetName] = [];
        }
      }

      return result;
    } catch (error) {
      console.error('[MongoPersistence] getWorkbookFieldCatalog failed:', error);
      return { repairs: [], sheets: {} };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUTHENTICATION SYSTEM (NEW)
  // ════════════════════════════════════════════════════════════════════════════

  async createAuthWorkbook() {
    // In MongoDB, we just ensure the collection exists with an index
    try {
      await mongoClient.createIndexes(COLLECTIONS.AUTH_USERS, [
        { key: { name: 1 }, unique: true },
        { key: { email: 1 }, unique: true }
      ]);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async createAuthUser(userData) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      
      // Check duplicates
      const existing = await collection.findOne({ 
        $or: [
          { name: new RegExp(`^${userData.name}$`, 'i') },
          { email: new RegExp(`^${userData.email}$`, 'i') }
        ]
      });

      if (existing) {
        return { success: false, message: 'User already exists' };
      }

      const now = new Date();
      const doc = {
        name: userData.name,
        email: userData.email,
        password: userData.password, // Note: In a real app, hash this. Matching Excel implementation which stores plain.
        admin: userData.admin,
        permissions: userData.permissions,
        status: userData.status,
        created: userData.created || now.toISOString(),
        lastLogin: userData.lastLogin || '',
        _createdAt: now,
        _updatedAt: now
      };

      await collection.insertOne(doc);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async loginAuthUser(nameOrEmail, hashedPassword) {
    try {
      const loginId = String(nameOrEmail || '').trim();
      if (!loginId) {
        return { success: false, message: 'Invalid credentials' };
      }

      const escapeRegex = (val) => String(val || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const loginRegex = new RegExp(`^${escapeRegex(loginId)}$`, 'i');

      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const user = await collection.findOne({
        password: hashedPassword,
        $or: [
          { name: loginRegex },
          { email: loginRegex }
        ]
      });

      if (!user) {
        return { success: false, message: 'Invalid credentials' };
      }

      // Update status and login time
      await collection.updateOne(
        { _id: user._id },
        { 
          $set: { 
            status: 'Active', 
            lastLogin: new Date().toISOString(),
            _updatedAt: new Date()
          }
        }
      );

      return {
        success: true,
        user: {
          name: user.name,
          email: user.email,
          admin: user.admin === 'Yes' || user.admin === true, // Handle Excel string vs Boolean
          permissions: user.permissions
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async logoutAuthUser(name) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      await collection.updateOne(
        { name },
        { $set: { status: 'Inactive', _updatedAt: new Date() } }
      );
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getAllAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const docs = await collection.find({}).toArray();
      
      const users = docs.map(doc => ({
        name: doc.name,
        email: doc.email,
        password: doc.password,
        admin: doc.admin,
        permissions: doc.permissions,
        status: doc.status,
        created: doc.created,
        lastLogin: doc.lastLogin
      }));

      return { users };
    } catch (error) {
      return { users: [] };
    }
  }

  async hasAuthUsers() {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const count = await collection.countDocuments();
      return { hasUsers: count > 0 };
    } catch (error) {
      return { hasUsers: false };
    }
  }

  async updateAuthUser(nameOrEmail, updates = {}) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const loginId = String(nameOrEmail || '').trim();
      const escapeRegex = (val) => String(val || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const loginRegex = new RegExp(`^${escapeRegex(loginId)}$`, 'i');

      const existing = await collection.findOne({
        $or: [{ name: loginRegex }, { email: loginRegex }]
      });
      if (!existing) return { success: false, message: 'User not found' };

      const toSet = { _updatedAt: new Date() };
      if (updates.name) toSet.name = updates.name;
      if (updates.email) toSet.email = updates.email;
      if (updates.passwordHash) toSet.password = updates.passwordHash;
      if (updates.admin !== undefined) toSet.admin = updates.admin;
      if (updates.permissions) toSet.permissions = updates.permissions;
      if (updates.status) toSet.status = updates.status;

      // Duplicate checks for name/email
      if (updates.name || updates.email) {
        const dupQuery = [];
        if (updates.name) dupQuery.push({ name: new RegExp(`^${escapeRegex(updates.name)}$`, 'i') });
        if (updates.email) dupQuery.push({ email: new RegExp(`^${escapeRegex(updates.email)}$`, 'i') });
        if (dupQuery.length) {
          const dup = await collection.findOne({
            _id: { $ne: existing._id },
            $or: dupQuery
          });
          if (dup) return { success: false, message: 'Another user already has that name or email' };
        }
      }

      await collection.updateOne({ _id: existing._id }, { $set: toSet });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async deleteAuthUser(nameOrEmail) {
    try {
      const collection = mongoClient.getCollection(COLLECTIONS.AUTH_USERS);
      const loginId = String(nameOrEmail || '').trim();
      const escapeRegex = (val) => String(val || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const loginRegex = new RegExp(`^${escapeRegex(loginId)}$`, 'i');
      const result = await collection.deleteOne({ $or: [{ name: loginRegex }, { email: loginRegex }] });
      if (!result.deletedCount) return { success: false, message: 'User not found' };
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNDING SETTINGS (UPDATED FOR PARITY)
  // ════════════════════════════════════════════════════════════════════════════

  async getFundingSettings(company, location) {
    // Logic: Try to find ONE document in any collection for this location that has funding set.
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(location)}_`;
      
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));

      // Iterate collections until we find one with data
      for (const collName of stationColls) {
        const doc = await db.collection(collName).findOne({});
        if (doc) {
          // Extract values if they exist, preferring composite keys
          const getVal = (key) => doc[getFundingKey(key)] || doc[key] || '';
          return {
            om: getVal('O&M'),
            capital: getVal('Capital'),
            decommission: getVal('Decommission')
          };
        }
      }
      return { om: '', capital: '', decommission: '' };
    } catch (error) {
      return { om: '', capital: '', decommission: '' };
    }
  }

  async saveFundingSettings(company, location, settings) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const prefix = `${normalize(company)}_${normalize(location)}_`;
      
      // Update ALL station collections for this location
      const stationColls = collections.filter(c => c.startsWith(prefix) && c.endsWith('_stationData'));
      let touchedSheets = 0;

      for (const collName of stationColls) {
        const collection = db.collection(collName);
        const cursor = collection.find({});
        const bulkOps = [];

        // Process each document individually to support re-calculation based on per-row tokens
        while(await cursor.hasNext()) {
            const doc = await cursor.next();
            const splitVal = doc['Funding Split'] || '';
            const tokens = parseFundingSplitTokens(splitVal);
            
            const updates = {};
            let changed = false;

            // Helper: decide value (same logic as excel_worker.js)
            const decide = (incoming, currentVal) => {
                 const v = String(incoming ?? '').trim();
                 // If setting is blank, revert to default calc based on tokens
                 if (!v) {
                    if (tokens.length > 0) return formatEqualSplitForTokens(tokens);
                    return ''; // No tokens -> blank
                 }
                 // Validate override format (simple check)
                 const valCheck = validateFundingOverrideString(v);
                 if (!valCheck.ok) throw new Error(`Invalid funding override "${v}": ${valCheck.reason}`);
                 return v;
            };

            const updateField = (field, settingVal) => {
              if (settingVal !== undefined) {
                const key = getFundingKey(field);
                // Check composite key first, then plain
                const currentVal = doc[key] || doc[field];
                const newVal = decide(settingVal, currentVal);

                if (newVal !== (currentVal || '')) {
                  updates[key] = newVal;
                  changed = true;
                }
              }
            };

            updateField('O&M', settings.om);
            updateField('Capital', settings.capital);
            updateField('Decommission', settings.decommission);

            if (changed) {
                bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: updates } } });
            }
        }
        
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps);
            touchedSheets++;
        }
      }

      return { success: true, updatedSheets: touchedSheets };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async saveFundingSettingsForAssetType(company, location, assetType, settings) {
    try {
      const collectionName = mongoClient.getStationCollectionName(company, location, assetType);
      const collection = mongoClient.getCollection(collectionName);
      
      // Use same logic as saveFundingSettings but only for this specific collection
      const cursor = collection.find({});
      const bulkOps = [];

      while(await cursor.hasNext()) {
        const doc = await cursor.next();
        const splitVal = doc['Funding Split'] || '';
        const tokens = parseFundingSplitTokens(splitVal);
        
        const updates = {};
        let changed = false;

        const decide = (incoming, currentVal) => {
          const v = String(incoming ?? '').trim();
          if (!v) {
            if (tokens.length > 0) return formatEqualSplitForTokens(tokens);
            return '';
          }
          const valCheck = validateFundingOverrideString(v);
          if (!valCheck.ok) throw new Error(`Invalid funding override "${v}": ${valCheck.reason}`);
          return v;
        };

        const updateField = (field, settingVal) => {
          if (settingVal !== undefined) {
            const key = getFundingKey(field);
            // Check composite key first, then plain
            const currentVal = doc[key] || doc[field];
            const newVal = decide(settingVal, currentVal);

            if (newVal !== (currentVal || '')) {
              updates[key] = newVal;
              changed = true;
            }
          }
        };

        updateField('O&M', settings.om);
        updateField('Capital', settings.capital);
        updateField('Decommission', settings.decommission);

        if (changed) {
            bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: updates } } });
        }
      }
      
      if (bulkOps.length > 0) {
          await collection.bulkWrite(bulkOps);
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async getAllFundingSettings(company) {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const normalize = (str) => String(str || '').trim().replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      
      // Filter for this company
      const coPrefix = `${normalize(company)}_`;
      const stationColls = collections.filter(c => c.startsWith(coPrefix) && c.endsWith('_stationData'));

      const result = new Map();

      for (const collName of stationColls) {
        // Parse name back to parts
        const parts = collName.replace('_stationData', '').split('_');
        // Format: Company_Location_AssetType
        const loc = parts[1];
        const assetType = parts.slice(2).join('_'); // handle spaces in asset type if they became underscores
        
        const doc = await db.collection(collName).findOne({});
        
        const getVal = (k) => doc[getFundingKey(k)] || doc[k];

        if (doc && (getVal('O&M') || getVal('Capital') || getVal('Decommission'))) {
          const key = `${company}|${loc}|${assetType}`; // Replicating Excel Map key format
          result.set(key, {
            om: getVal('O&M') || '',
            capital: getVal('Capital') || '',
            decommission: getVal('Decommission') || ''
          });
        }

      }
      return Object.fromEntries(result);
    } catch (error) {
      return {};
    }
  }

  async normalizeFundingOverrides() {
    try {
      const db = mongoClient.getDatabase();
      const collections = await mongoClient.listCollections();
      const stationColls = collections.filter(c => c.endsWith('_stationData'));
      let filesTouched = 0;

      for (const collName of stationColls) {
        const collection = db.collection(collName);
        
        // FIX: Get all documents - we need to search for Funding Split/Type 
        // in both plain and composite key formats
        const docs = await collection.find({}).toArray();
        const bulkOps = [];

        for (const doc of docs) {
          // ═══════════════════════════════════════════════════════════════════
          // FIX: Find Funding Split/Type value - check both plain and composite keys
          // ═══════════════════════════════════════════════════════════════════
          let fundingSplitVal = '';
          const fundingSplitVariants = ['Funding Split', 'Funding Type'];
          
          for (const variant of fundingSplitVariants) {
            // Check plain key first
            if (doc[variant]) {
              fundingSplitVal = String(doc[variant]).trim();
              break;
            }
            // Check composite keys (any section prefix)
            for (const key of Object.keys(doc)) {
              const keyLower = key.toLowerCase();
              const variantLower = variant.toLowerCase();
              // Match patterns like "Section – Funding Split" or "Section - Funding Type"
              if (keyLower.endsWith(` – ${variantLower}`) || 
                  keyLower.endsWith(` - ${variantLower}`)) {
                fundingSplitVal = String(doc[key] || '').trim();
                break;
              }
            }
            if (fundingSplitVal) break;
          }
          // ═══════════════════════════════════════════════════════════════════

          if (!fundingSplitVal) continue;

          const tokens = parseFundingSplitTokens(fundingSplitVal);
          if (!tokens.length) continue;

          const def = formatEqualSplitForTokens(tokens);
          const updates = {};
          let changed = false;

          FUNDING_FIELDS.forEach(field => {
            const key = getFundingKey(field);
            // If both composite and plain are missing/empty, set default
            const val = doc[key] || doc[field];
            if (!val || String(val).trim() === '') {
              updates[key] = def;
              changed = true;
            }
          });

          if (changed) {
            bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: updates } } });
          }
        }
        
        if (bulkOps.length > 0) {
          await collection.bulkWrite(bulkOps);
          filesTouched++;
        }
      }
      return { success: true, filesTouched };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NUKE (RESET)
  // ════════════════════════════════════════════════════════════════════════════

  async nuke() {
    try {
      const db = mongoClient.getDatabase();
      await db.dropDatabase();
      console.log('[MongoPersistence] Database dropped successfully');
      
      // Re-create indexes immediately so app can restart cleanly without crash
      await this._createIndexes();
      
      return { success: true };
    } catch (error) {
      console.error('[MongoPersistence] Nuke failed:', error);
      return { success: false, message: error.message };
    }
  }

}

module.exports = MongoPersistence;

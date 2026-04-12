// backend/config.js
// Default UNC/base folder where station photo folders live

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// BC - saved to easily copy paste into the application
// const DEFAULT_PHOTOS_BASE = '\\Ecbcv6cwvfsp001.ncr.int.ec.gc.ca\msc$\401\WSCConstruction\Stations';

// AB - saved to easily copy paste into the application
// const DEFAULT_PHOTOS_BASE = '\\int.ec.gc.ca\shares\ECCC\PVM\GV1\WSCInfrastructure\Stations_Alberta';

// Justin's PC - exists for debugging (because I am not on Justin's PC so this link fails)
const DEFAULT_PHOTOS_BASE = 'C:\Users\nitsu\OneDrive\Documents\Stations';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff'];
const DEFAULT_MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/asmgt';

// Database configuration path
const DB_CONFIG_PATH = path.join(__dirname, 'db-config.json');

/**
 * Load database configuration from db-config.json
 * @returns {Object|null} - Database configuration or null if not found
 */
function getDbConfig() {
  try {
    if (!fs.existsSync(DB_CONFIG_PATH)) {
      console.warn('[config] db-config.json not found, using default Excel configuration');
      return {
        database: {
          type: 'mongodb',
          connectionString: DEFAULT_MONGODB_URI
        },
        read: {
          source: 'excel'
        },
        write: {
          targets: ['excel']
        }
      };
    }

    const configContent = fs.readFileSync(DB_CONFIG_PATH, 'utf8');
    const config = JSON.parse(configContent);

    // Validate configuration
    if (!config.read || !config.read.source) {
      throw new Error('Invalid db-config.json: missing read.source');
    }

    if (!config.write || !Array.isArray(config.write.targets) || config.write.targets.length === 0) {
      throw new Error('Invalid db-config.json: missing or empty write.targets');
    }

    const validSources = ['excel', 'mongodb'];
    if (!validSources.includes(config.read.source)) {
      throw new Error(`Invalid read source: ${config.read.source}. Must be "excel" or "mongodb"`);
    }

    for (const target of config.write.targets) {
      if (!validSources.includes(target)) {
        throw new Error(`Invalid write target: ${target}. Must be "excel" or "mongodb"`);
      }
    }

    console.log('[config] Loaded db-config.json successfully');
    const connectionString = process.env.MONGODB_URI || config.database?.connectionString || DEFAULT_MONGODB_URI;

    return {
      ...config,
      database: {
        type: config.database?.type || 'mongodb',
        ...config.database,
        connectionString
      }
    };
  } catch (error) {
    console.error('[config] Error loading db-config.json:', error.message);
    // Return default Excel configuration on error
    return {
      database: {
        type: 'mongodb',
        connectionString: DEFAULT_MONGODB_URI
      },
      read: {
        source: 'excel'
      },
      write: {
        targets: ['excel']
      }
    };
  }
}

/**
 * Resolve the base folder using lookups.xlsx:
 * - If AssetTypes.link exists (for {company,location,assetType}) → use it
 * - else if Locations.link exists (for {company,location}) → use it
 * - else → DEFAULT_PHOTOS_BASE
 */
async function getPhotosBase(ctx = {}) {
  try {
    console.log(`[DEBUG config.getPhotosBase] Input ctx:`, ctx);
    const lookups = require('./lookups_repo');
    const fromLookups = await lookups.getPhotosBase({
      company: ctx.company || '',
      location: ctx.location || '',
      assetType: ctx.assetType || '',
    });
    console.log(`[DEBUG config.getPhotosBase] fromLookups result:`, fromLookups);
    console.log(`[DEBUG config.getPhotosBase] DEFAULT_PHOTOS_BASE:`, DEFAULT_PHOTOS_BASE);
    const result = fromLookups || DEFAULT_PHOTOS_BASE;
    console.log(`[DEBUG config.getPhotosBase] Final result:`, result);
    return result;
  } catch (e) {
    console.error(`[DEBUG config.getPhotosBase] Error:`, e);
    return DEFAULT_PHOTOS_BASE;
  }
}

module.exports = {
  DEFAULT_PHOTOS_BASE,           // raw default (string)
  IMAGE_EXTS,                    // unchanged
  getPhotosBase,                 // async resolver (preferred)
  getDbConfig,                   // NEW: load database configuration
  DB_CONFIG_PATH,                // NEW: config file path
  // keep a simple PHOTOS_BASE export for code that reads the constant
  PHOTOS_BASE: DEFAULT_PHOTOS_BASE,
};

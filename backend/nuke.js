// backend/nuke.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { getPersistence } = require('./persistence');
const config = require('./config');

function isXlsx(name) {
  return /\.xlsx$/i.test(name);
}

async function deleteXlsxRecursive(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  // Skip auth/login data to preserve login state
  if (path.basename(dir).toLowerCase() === 'login') {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        await deleteXlsxRecursive(full);
      } else if (ent.isFile() && isXlsx(ent.name)) {
        await fsp.unlink(full).catch(() => {});
      }
    } catch (_) { /* best-effort */ }
  }
}

async function nuke() {
  // Check configuration to decide strategy
  const dbConfig = config.getDbConfig();
  const isMongo = dbConfig.read?.source === 'mongodb';

  if (isMongo) {
    const persistence = await getPersistence();
    // Delegate to MongoPersistence to drop the database
    if (typeof persistence.nuke === 'function') {
      return await persistence.nuke();
    }
    return { success: false, message: 'Persistence layer does not support nuke' };
  }

  // --- EXCEL / FILE SYSTEM NUKE ---
  const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');

  if (!DATA_DIR) {
    return { success: false, message: 'DATA_DIR not resolved' };
  }

  // 1) Delete all .xlsx files under data/ recursively
  await deleteXlsxRecursive(DATA_DIR);

  // 2) Delete cache file
  const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
  try { await fsp.unlink(cachePath); } catch (_) {}

  return { success: true };
}

// Delete a specific company and all its locations/assets
async function deleteCompany(companyName) {
  try {
    const persistence = await getPersistence();

    // 1. If in Excel mode, delete the directory
    const dbConfig = config.getDbConfig();
    const useExcel = (dbConfig.write?.targets || []).includes('excel');

    if (useExcel) {
      const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
      const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
      const companyDir = path.join(COMPANIES_DIR, companyName);
      if (fs.existsSync(companyDir)) {
        await fsp.rm(companyDir, { recursive: true, force: true });
      }
    }
    
    // 2. Remove from persistence (Lookups + Metadata)
    await persistence.deleteCompanyFromLookups(companyName);
   
    // 3. Invalidate cache
    if (useExcel) {
      const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
      const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
      try { await fsp.unlink(cachePath); } catch (_) {}
    }

    return { success: true };
  } catch (error) {
    console.error('[deleteCompany] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Delete a specific location and all its assets
async function deleteLocation(companyName, locationName) {
  try {
    const persistence = await getPersistence();
    const dbConfig = config.getDbConfig();
    const useExcel = (dbConfig.write?.targets || []).includes('excel');

    if (useExcel) {
      const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
      const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
      const locationFile = path.join(COMPANIES_DIR, companyName, `${locationName}.xlsx`);
      if (fs.existsSync(locationFile)) {
        await fsp.unlink(locationFile);
      }
    }
    
    // 2. Remove from persistence
    await persistence.deleteLocationFromLookups(companyName, locationName);

    // 3. Invalidate cache
    if (useExcel) {
      const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
      const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
      try { await fsp.unlink(cachePath); } catch (_) {}
    }

    return { success: true };
  } catch (error) {
    console.error('[deleteLocation] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Delete a specific asset type
async function deleteAssetType(companyName, locationName, assetTypeName) {
  try {
    const persistence = await getPersistence();
    
    // 1. Remove asset type data (drop table/sheet)
    await persistence.deleteAssetTypeFromLocation(companyName, locationName, assetTypeName);

    // 2. Remove from lookups
    await persistence.deleteAssetTypeFromLookups(companyName, locationName, assetTypeName);
    
    // 3. Invalidate cache
    const dbConfig = config.getDbConfig();
    if ((dbConfig.write?.targets || []).includes('excel')) {
      const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
      const cachePath = path.join(DATA_DIR, '.lookups_cache.json');
      try { await fsp.unlink(cachePath); } catch (_) {}
    }
    
    return { success: true };
  } catch (error) {
    console.error('[deleteAssetType] Error:', error);
    return { success: false, message: String(error) };
  }
}

module.exports = { nuke, deleteCompany, deleteLocation, deleteAssetType };

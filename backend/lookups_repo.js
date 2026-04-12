// backend/lookups_repo.js

const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./utils/fs_utils');

const { getPersistence } = require('./persistence');

// ─── Paths ─────────────────────────────────────────────────────────────────
const DATA_DIR      = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
const LOOKUPS_PATH  = path.join(DATA_DIR, 'lookups.xlsx');
const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
const CACHE_PATH    = path.join(DATA_DIR, '.lookups_cache.json');

// ─── Helpers ───────────────────────────────────────────────────────────────
function normStr(v) { return String(v ?? '').trim(); }
function lc(v) { return normStr(v).toLowerCase(); }
function toBool(v) {
  const t = lc(v);
  return t === 'true' || t === '1' || t === 'yes' || t === 'y' || t === 't';
}
function uniqSorted(arr) {
  return Array.from(new Set(arr.map(normStr).filter(Boolean)))
    .sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
function randHexColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

// ─── FS-only, synchronous folder bootstrap (no ExcelJS) ───────────────────
function ensureDataFoldersSync() {
  try {
    // Create required directories
    ensureDir(DATA_DIR);
    ensureDir(COMPANIES_DIR);
  } catch (e) { /* swallow — better to not crash on first run */ }
}

// ─── Lightweight in-memory caches ──────────────────────────────────────────
// We cache everything needed for fast boot and rendering.
let _cache = {
  mtimeMs: -1,
  colorsGlobal: new Map(),         // Map<assetType, color>
  colorsByLoc: new Map(),          // Map<location, Map<assetType, color>>
  colorsByCompanyLoc: new Map(),   // Map<company, Map<location, Map<assetType, color>>>
  companies: [],
  locsByCompany: {},               // { [company]: string[] }
  assetsByLocation: {},            // { [location]: string[] }
  assetsByCompanyLocation: {},     // { [company]: { [location]: string[] } }
  // NEW: status/repair settings
  statusColors: new Map(),         // Map<statusKey, color> (keys lowercased: inactive, mothballed, unknown)
  applyStatusColorsOnMap: false,
  repairColors: new Map(),         // Map<company, Map<location, Map<assetType, color>>>
  applyRepairColorsOnMap: false,
  statusOverridesRepair: false,    // New priority setting
  // NEW: links
  locationLinks: new Map(),        // Map<company, Map<location, link>>
  assetTypeLinks: new Map(),       // Map<company, Map<location, Map<assetType, link>>>
  inspectionKeywords: [],
  projectKeywords: [],
};

function _invalidateAllCaches() { _cache.mtimeMs = -1; try { fs.unlinkSync(CACHE_PATH); } catch(_) {} }

function _loadJsonCache(mtimeMs) {
  try {
    if (!fs.existsSync(CACHE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (raw.mtimeMs !== mtimeMs) return false;
    // hydrate Maps
    _cache = {
      mtimeMs,
      colorsGlobal: new Map(Object.entries(raw.colorsGlobal || {})),
      colorsByLoc: new Map(Object.entries(raw.colorsByLoc || {}).map(
        ([loc, obj]) => [loc, new Map(Object.entries(obj))]
      )),
      colorsByCompanyLoc: new Map(
        Object.entries(raw.colorsByCompanyLoc || {}).map(
          ([company, locObj]) => [
            company,
            new Map(Object.entries(locObj).map(
              ([loc, obj]) => [loc, new Map(Object.entries(obj))]
            ))
          ]
        )
      ),
      companies: raw.companies || [],
      locsByCompany: raw.locsByCompany || {},
      assetsByCompanyLocation: raw.assetsByCompanyLocation || {},
      // NEW
      statusColors: new Map(Object.entries(raw.statusColors || {})),
      applyStatusColorsOnMap: !!raw.applyStatusColorsOnMap,
      repairColors: new Map(
        Object.entries(raw.repairColors || {}).map(
          ([company, locObj]) => [
            company,
            new Map(Object.entries(locObj).map(
              ([loc, obj]) => [loc, new Map(Object.entries(obj))]
            ))
          ]
        )
      ),
      applyRepairColorsOnMap: !!raw.applyRepairColorsOnMap,
      statusOverridesRepair: !!raw.statusOverridesRepair,
      // NEW: links
      locationLinks: new Map(
        Object.entries(raw.locationLinks || {}).map(
          ([co, locObj]) => [lc(co), new Map(Object.entries(locObj).map(
            ([loc, link]) => [lc(loc), link]
          ))]
        )
      ),
      assetTypeLinks: new Map(
        Object.entries(raw.assetTypeLinks || {}).map(
          ([co, locObj]) => [
            lc(co),
            new Map(Object.entries(locObj).map(
              ([loc, atObj]) => [lc(loc), new Map(Object.entries(atObj).map(
                ([at, link]) => [lc(at), link]
              ))]
            ))
          ]
        )
      ),
      inspectionKeywords: Array.isArray(raw.inspectionKeywords) ? raw.inspectionKeywords : [],
      projectKeywords: Array.isArray(raw.projectKeywords) ? raw.projectKeywords : [],
    };
    return true;
  } catch(_) { return false; }
}

function _saveJsonCache() {
  try {
    const json = {
      mtimeMs: _cache.mtimeMs,
      colorsGlobal: Object.fromEntries(_cache.colorsGlobal),
      colorsByLoc: Object.fromEntries(
        Array.from(_cache.colorsByLoc.entries()).map(
          ([loc, m]) => [loc, Object.fromEntries(m)]
       )
      ),
      colorsByCompanyLoc: Object.fromEntries(
        Array.from(_cache.colorsByCompanyLoc.entries()).map(
          ([company, locMap]) => [
            company,
            Object.fromEntries(
              Array.from(locMap.entries()).map(
                ([loc, m]) => [loc, Object.fromEntries(m)]
              )
            )
          ]
        )
      ),
      companies: _cache.companies,
      locsByCompany: _cache.locsByCompany,
      assetsByCompanyLocation: _cache.assetsByCompanyLocation,
      // NEW
      statusColors: Object.fromEntries(_cache.statusColors),
      applyStatusColorsOnMap: _cache.applyStatusColorsOnMap,
      repairColors: Object.fromEntries(
        Array.from(_cache.repairColors.entries()).map(
          ([company, locMap]) => [
            company,
            Object.fromEntries(
              Array.from(locMap.entries()).map(
                ([loc, m]) => [loc, Object.fromEntries(m)]
              )
            )
          ]
        )
      ),
      applyRepairColorsOnMap: _cache.applyRepairColorsOnMap,
      statusOverridesRepair: _cache.statusOverridesRepair,
      // NEW: links
      locationLinks: Object.fromEntries(
        Array.from(_cache.locationLinks.entries()).map(
          ([co, m]) => [co, Object.fromEntries(m)]
        )
      ),
      assetTypeLinks: Object.fromEntries(
        Array.from(_cache.assetTypeLinks.entries()).map(
          ([co, locMap]) => [
            co,
            Object.fromEntries(
              Array.from(locMap.entries()).map(
                ([loc, atMap]) => [loc, Object.fromEntries(atMap)]
              )
            )
          ]
        )
      ),
      inspectionKeywords: Array.from(_cache.inspectionKeywords || []),
      projectKeywords: Array.from(_cache.projectKeywords || []),
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(json));
  } catch(_) {}
}

let isBusy = false;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function withRetry(fn, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      if (isBusy && i > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      if (e.message && e.message.includes('timeout')) {
        console.log(`[withRetry] Attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      } else {
        throw e;
      }
    }
  }
}

async function _primeAllCaches() {
  if (isBusy) {
    console.log('[_primeAllCaches] Already busy, skipping');
    return;
  }
  
  isBusy = true;
  try {
  ensureDir(DATA_DIR);
  // Ask the persistence layer for a snapshot
  const persistence = await getPersistence();
  const snap = await withRetry(() => persistence.readLookupsSnapshot());
  const mtimeMs = snap?.mtimeMs || 0;
  if (_cache.mtimeMs === mtimeMs) return;

  const global = new Map(Object.entries(snap.colorsGlobal || {}));
  const byLoc  = new Map(
    Object.entries(snap.colorsByLoc || {}).map(([loc, obj]) => [loc, new Map(Object.entries(obj))])
  );
  const byCoLoc = new Map(
    Object.entries(snap.colorsByCompanyLoc || {}).map(([co, locObj]) => {
      return [co, new Map(Object.entries(locObj).map(([loc, obj]) => [loc, new Map(Object.entries(obj))]))];
    })
  );

  // Companies
  const companies = snap.companies || []; // This is now an array of objects

  // Locations + assets relations
  const locsByCompany = snap.locsByCompany || {};
  const assetsByCompanyLocation = snap.assetsByCompanyLocation || {};

  // NEW: status/repair settings from snapshot
  const statusColors = new Map(Object.entries(snap.statusColors || {}));
  const applyStatusColorsOnMap = !!snap.applyStatusColorsOnMap;
  const repairColors = new Map(
    Object.entries(snap.repairColors || {}).map(([co, locObj]) => {
      return [co, new Map(Object.entries(locObj).map(([loc, obj]) => [loc, new Map(Object.entries(obj))]))];
    })
  );
  const applyRepairColorsOnMap = !!snap.applyRepairColorsOnMap;
  const statusOverridesRepair = !!snap.statusOverridesRepair;

  // NEW: hydrate link maps from snapshot
 const locLinks = new Map(
   Object.entries(snap.locationLinks || {}).map(
     ([co, obj]) => [lc(co), new Map(Object.entries(obj).map(
       ([loc, link]) => [lc(loc), link]
     ))]
   )
 );
 const atLinks = new Map(
   Object.entries(snap.assetTypeLinks || {}).map(
     ([co, locObj]) => [
       lc(co),
      new Map(Object.entries(locObj).map(
         ([loc, atObj]) => [lc(loc), new Map(Object.entries(atObj).map(
           ([at, link]) => [lc(at), link]
         ))]
       ))
     ]
   )
 );

  _cache = {
    mtimeMs,
    colorsGlobal: global,
    colorsByLoc: byLoc,
    colorsByCompanyLoc: byCoLoc,
    companies: companies, // Store the array of objects directly
    locsByCompany,
    assetsByCompanyLocation,
    // NEW
    statusColors,
    applyStatusColorsOnMap,
    repairColors,
    applyRepairColorsOnMap,
    statusOverridesRepair,
    // NEW: links
    locationLinks: locLinks,
    assetTypeLinks: atLinks,
    // NEW: inspection keywords
    inspectionKeywords: Array.isArray(snap.inspectionKeywords)
      ? snap.inspectionKeywords
      : ['inspection'],
    // NEW: project keywords
    projectKeywords: Array.isArray(snap.projectKeywords)
      ? snap.projectKeywords
      : ['project', 'construction', 'maintenance', 'repair', 'decommission'],
  };
  _saveJsonCache()
  } finally {
    isBusy = false;
  }
}

// Public: fast one-pass accessors for the app to use when rendering
async function getColorMaps() {
  await _primeAllCaches();
  return {
    global: _cache.colorsGlobal,
    byLocation: _cache.colorsByLoc,
    byCompanyLocation: _cache.colorsByCompanyLoc,
  };
}

// ─── Ensure folders & workbook ─────────────────────────────────────────────
async function ensureLookupsReady() {
  const persistence = await getPersistence();
  return persistence.ensureLookupsReady();
}

// ─── Inspection keywords (global) ─────────────────────────────────────────
async function getInspectionKeywords() {
  await _primeAllCaches();
  return Array.from(_cache.inspectionKeywords || []);
}

async function setInspectionKeywords(keywords = []) {
  const list = Array.isArray(keywords)
    ? keywords.map(normStr).filter(Boolean)
    : [];
  const persistence = await getPersistence();
  const res = await persistence.setInspectionKeywords(list);
  _invalidateAllCaches();
  return res;
}

// ─── Project keywords (global) ────────────────────────────────────────────
async function getProjectKeywords() {
  await _primeAllCaches();
  return Array.from(_cache.projectKeywords || []);
}

async function setProjectKeywords(keywords = []) {
  const list = Array.isArray(keywords)
    ? keywords.map(normStr).filter(Boolean)
    : [];
  const persistence = await getPersistence();
  const res = await persistence.setProjectKeywords(list);
  _invalidateAllCaches();
  return res;
}

// ─── Public read APIs ──────────────────────────────────────────────────────
async function getActiveCompanies() {
  await _primeAllCaches();
  return _cache.companies;
}

async function getLocationsForCompany(company) {
  await _primeAllCaches();
  const arr = _cache.locsByCompany[normStr(company)] || [];
  return Array.from(arr);
}

async function getAssetTypesForCompanyLocation(company, location) {
  await _primeAllCaches();
  const companyAssets = _cache.assetsByCompanyLocation[normStr(company)] || {};
  const arr = companyAssets[normStr(location)] || [];
  return Array.from(arr);
}

// ─── Colors ────────────────────────────────────────────────────────────────
async function getAssetTypeColor(assetType) {
  await _primeAllCaches();
  const col = _cache.colorsGlobal.get(normStr(assetType));
  return col || null;
}

async function getAssetTypeColorForLocation(assetType, location) {
  await _primeAllCaches();
  const map = _cache.colorsByLoc.get(normStr(location));
  if (!map) return null;
  const col = map.get(normStr(assetType));
  return col || null;
}

async function getAssetTypeColorForCompanyLocation(assetType, company, location) {
  await _primeAllCaches();
  const co = normStr(company);
  const loc = normStr(location);
  const at = normStr(assetType);
  const coMap = _cache.colorsByCompanyLoc.get(co);
  if (!coMap) return null;
  const locMap = coMap.get(loc);
  if (!locMap) return null;
  return locMap.get(at) || null;
}

async function setAssetTypeColor(assetType, color) {
  const persistence = await getPersistence();
  const res = await persistence.setAssetTypeColor(assetType, color);
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  const persistence = await getPersistence();
  const res = await persistence.setAssetTypeColorForLocation(assetType, location, color);
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
  const persistence = await getPersistence();
  const res = await persistence.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
  _invalidateAllCaches();
  return res;
}

// ─── Repair Colors ────────────────────────────────────────────────────────
async function getRepairColorMaps() {
  await _primeAllCaches();
  return { byCompanyLocation: _cache.repairColors };
}

async function setRepairColorForCompanyLocation(assetType, company, location, color) {
  const persistence = await getPersistence();
  const res = await persistence.setRepairColorForCompanyLocation(assetType, company, location, color);
  _invalidateAllCaches();
  return res;
}

// ─── Writes / Upserts ─────────────────────────────────────────────────────
async function upsertCompany(name, active = true, description = '', email = '') {
  const persistence = await getPersistence();
  const res = await persistence.upsertCompany(name, active, description, email);
  _invalidateAllCaches();
  return res;
}

async function upsertLocation(location, company) {
  const persistence = await getPersistence();
  const res = await persistence.upsertLocation(location, company);
  _invalidateAllCaches();
  return res;
}

// ─── Links / Photos Base Resolver ─────────────────────────────────────────
async function getPhotosBase({ company, location, assetType } = {}) {
  console.log(`[DEBUG getPhotosBase] Input: company="${company}", location="${location}", assetType="${assetType}"`);
  
  await _primeAllCaches();
 const co  = lc(company);
 const loc = lc(location);  
 const at  = lc(assetType);

  console.log(`[DEBUG getPhotosBase] Normalized: co="${co}", loc="${loc}", at="${at}"`);
  console.log(`[DEBUG getPhotosBase] AssetType cache keys:`, Array.from(_cache.assetTypeLinks.keys()));
  console.log(`[DEBUG getPhotosBase] Location cache keys:`, Array.from(_cache.locationLinks.keys()));

  // 1) AssetTypes.link (company+location+assetType)
  if (co && loc && at) {
    const locMap = _cache.assetTypeLinks.get(co);
    console.log(`[DEBUG getPhotosBase] AssetTypes locMap for company "${co}":`, locMap ? Array.from(locMap.keys()) : 'null');
    
    const atMap = locMap && locMap.get(loc);
    console.log(`[DEBUG getPhotosBase] AssetTypes atMap for location "${loc}":`, atMap ? Array.from(atMap.keys()) : 'null');
    
    const link = atMap && atMap.get(at);
    console.log(`[DEBUG getPhotosBase] AssetTypes link for assetType "${at}":`, link);
    
    if (link) {
      console.log(`[DEBUG getPhotosBase] Found AssetTypes link: ${link}`);
      return link;
    }
  }

  // 2) Locations.link (company+location)
  if (co && loc) {
    const locMap = _cache.locationLinks.get(co);
    console.log(`[DEBUG getPhotosBase] Locations locMap for company "${co}":`, locMap ? Array.from(locMap.keys()) : 'null');
    
    const link = locMap && locMap.get(loc);
    console.log(`[DEBUG getPhotosBase] Locations link for location "${loc}":`, link);
    
    if (link) {
      console.log(`[DEBUG getPhotosBase] Found Locations link: ${link}`);
      return link;
    }
  }

  // 3) nothing
  console.log(`[DEBUG getPhotosBase] No link found, returning null`);
  return null;
}

// ─── Link Writers ─────────────────────────────────────────────────────────
async function setLocationLink(company, location, link) {
  const persistence = await getPersistence();
  const res = await persistence.setLocationLink(company, location, link || '');
  _invalidateAllCaches();
  return res;
}

async function setAssetTypeLink(assetType, company, location, link) {
  const persistence = await getPersistence();
  const res = await persistence.setAssetTypeLink(assetType, company, location, link || '');
  _invalidateAllCaches();
  return res;
}

// ─── NEW: Status/Repair settings APIs ──────────────────────────────────────
async function getStatusAndRepairSettings() {
  await _primeAllCaches();
  return {
    statusColors: Object.fromEntries(_cache.statusColors),
    applyStatusColorsOnMap: _cache.applyStatusColorsOnMap,
    // Convert repair colors map to plain object for IPC/serialization safety
    repairColors: Object.fromEntries(
      Array.from(_cache.repairColors.entries()).map(
        ([company, locMap]) => [
          company,
          Object.fromEntries(
            Array.from(locMap.entries()).map(
              ([loc, atMap]) => [loc, Object.fromEntries(atMap)]
            )
          )
        ]
      )
    ),
    applyRepairColorsOnMap: _cache.applyRepairColorsOnMap,
    statusOverridesRepair: _cache.statusOverridesRepair
  };
}

async function setStatusColor(statusKey, color) {
  const persistence = await getPersistence();
  const res = await persistence.setStatusColor(statusKey, color);
  _invalidateAllCaches();
  return res;
}

async function setApplyStatusColors(flag) {
  const persistence = await getPersistence();
  const res = await persistence.setSettingBoolean('applyStatusColorsOnMap', !!flag);
  _invalidateAllCaches();
  return res;
}

async function setApplyRepairColors(flag) {
  const persistence = await getPersistence();
  const res = await persistence.setSettingBoolean('applyRepairColorsOnMap', !!flag);
  _invalidateAllCaches();
  return res;
}

async function setStatusOverridesRepair(flag) {
  const persistence = await getPersistence();
  const res = await persistence.setSettingBoolean('statusOverridesRepair', !!flag);
  _invalidateAllCaches();
  return res;
}

async function deleteStatus(statusKey) {
  const persistence = await getPersistence();
  const res = await persistence.deleteStatusRow(statusKey);
  _invalidateAllCaches();
  return res;
}

module.exports = {
  // ensure/init
  ensureLookupsReady,
  primeAllCaches: _primeAllCaches,
  ensureDataFoldersSync,
  getColorMaps,
  async getLookupTree() {
    await _primeAllCaches();
    return {
      companies: _cache.companies,
      locationsByCompany: _cache.locsByCompany,
      assetsByCompanyLocation: _cache.assetsByCompanyLocation,
    };
  },
  // reads
  getActiveCompanies,
  getLocationsForCompany,
  getAssetTypesForCompanyLocation,
  getAssetTypeColor,
  getAssetTypeColorForLocation,
  getAssetTypeColorForCompanyLocation,
  // NEW: links
  getPhotosBase,
  setLocationLink,
  setAssetTypeLink,
  // writes
  upsertCompany,
  upsertLocation,
  upsertAssetType: async (assetType, company, location) => {
    const persistence = await getPersistence();
    const res = await persistence.upsertAssetType(assetType, company, location);
    _invalidateAllCaches();
    return res;
  },
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  setAssetTypeColorForCompanyLocation,
  // NEW: repair colors
  getRepairColorMaps,
  setRepairColorForCompanyLocation,
  // NEW: status/repair settings
  getStatusAndRepairSettings,
  setStatusColor,
  setApplyStatusColors,
  setApplyRepairColors,
  setStatusOverridesRepair,
  deleteStatus,
  // NEW: inspection keywords
  getInspectionKeywords,
  setInspectionKeywords,
  // NEW: project keywords
  getProjectKeywords,
  setProjectKeywords,
  // paths
  LOOKUPS_PATH,
  DATA_DIR, COMPANIES_DIR,
};

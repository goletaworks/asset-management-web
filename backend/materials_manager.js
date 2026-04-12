'use strict';

/**
 * Materials Manager backend
 * - Per-company workbook: data/companies/<Company>/materials.xlsx
 * - Sheet "StorageLocations" stores locations (name acts as the identifier)
 * - One sheet per storage location for materials
 * - Filters are derived from locations; no dedicated Filters sheet
 * - Dual-write to MongoDB when configured (collections: materials_locations, materials_items, materials_filters)
 */

const path = require('path');
const fse = require('fs-extra');
const ExcelJS = require('exceljs');
const config = require('./config');
const mongoClient = require('./db/mongoClient');

const DATA_DIR = path.join(__dirname, '..', 'data', 'companies');
const STORAGE_SHEET = 'StorageLocations';
const DEFAULT_COLUMNS_LOCATIONS = [
  { header: 'Location Name', key: 'name', width: 28 },
  { header: 'Description', key: 'description', width: 32 },
  { header: 'Notes', key: 'notes', width: 32 },
];
const DEFAULT_COLUMNS_MATERIALS = [
  { header: 'Material ID', key: 'id', width: 24 },
  { header: 'Location', key: 'location_id', width: 28 },
  { header: 'Material Name', key: 'name', width: 32 },
  { header: 'Quantity', key: 'quantity', width: 14 },
  { header: 'Unit', key: 'unit', width: 10 },
  { header: 'Value', key: 'value', width: 14 },
  { header: 'Updated At', key: 'updated_at', width: 22 },
];

const dbConfig = config.getDbConfig();
const SHOULD_READ_MONGO = (dbConfig?.read?.source || '').toLowerCase() === 'mongodb';
const SHOULD_WRITE_MONGO = (dbConfig?.write?.targets || []).map(t => String(t).toLowerCase()).includes('mongodb');
const SHOULD_WRITE_EXCEL = (dbConfig?.write?.targets || []).map(t => String(t).toLowerCase()).includes('excel') || !SHOULD_WRITE_MONGO;

function safeCompanyFolder(company) {
  return String(company || '').trim().replace(/[<>:"/\\|?*]/g, '_') || 'Company';
}
function safeSheetName(name) {
  const cleaned = String(name || '').trim() || 'Storage';
  return cleaned.replace(/[\\/?*\\[\\]:]/g, '_').substring(0, 31);
}
function ensureMaterialSheetColumns(sheet) {
  if (!sheet) return;
  const hasKeys = Array.isArray(sheet.columns) && sheet.columns.every(c => c && c.key);
  const header = (sheet.getRow(1).values || []).map(v => String(v || '').toLowerCase());
  const needsReset = header.length - 1 !== DEFAULT_COLUMNS_MATERIALS.length ||
    header[1] !== 'material id' ||
    header[2] !== 'location' ||
    !hasKeys;
  if (needsReset) {
    sheet.columns = DEFAULT_COLUMNS_MATERIALS;
  }
}
function makeMaterialsPath(company) {
  return path.join(DATA_DIR, safeCompanyFolder(company), 'materials.xlsx');
}
function makeId(prefix = 'mat') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
async function ensureMongoCollections() {
  if (!SHOULD_WRITE_MONGO && !SHOULD_READ_MONGO) return null;
  try {
    const connectionString = dbConfig?.database?.connectionString;
    if (!mongoClient.connected()) {
      const ok = await mongoClient.connect(connectionString);
      if (!ok) return null;
    }
    const db = mongoClient.getDatabase();
    const collections = {
      locations: db.collection('materials_locations'),
      materials: db.collection('materials_items'),
      filters: db.collection('materials_filters'),
    };
    // best-effort indexes
    await mongoClient.createIndexes('materials_locations', [{ key: { company: 1, id: 1 }, unique: true }]);
    await mongoClient.createIndexes('materials_items', [{ key: { company: 1, id: 1 }, unique: true }]);
    await mongoClient.createIndexes('materials_filters', [{ key: { company: 1, id: 1 }, unique: true }]);
    return collections;
  } catch (e) {
    console.error('[materials][mongo] Failed to ensure collections:', e.message);
    return null;
  }
}

async function ensureWorkbook(company) {
  const filePath = makeMaterialsPath(company);
  const dir = path.dirname(filePath);
  await fse.ensureDir(dir);

  const workbook = new ExcelJS.Workbook();
  if (await fse.pathExists(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }

  let storageSheet = workbook.getWorksheet(STORAGE_SHEET);
  if (!storageSheet) {
    storageSheet = workbook.addWorksheet(STORAGE_SHEET);
    storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
  } else {
    // Migrate old schema (with ID/SheetName/CreatedAt) to the simplified layout
    const header = (storageSheet.getRow(1).values || []).map(v => String(v || '').toLowerCase());
    const needsMigration = header.length - 1 !== DEFAULT_COLUMNS_LOCATIONS.length ||
      header[1] !== 'location name';
    if (needsMigration) {
      const rows = [];
      const seen = new Set();
      storageSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const name = String(row.getCell(2).value || row.getCell(1).value || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          name,
          description: row.getCell(3).value || row.getCell(2).value || '',
          notes: row.getCell(5).value || row.getCell(3).value || '',
        });
      });
      workbook.removeWorksheet(storageSheet.id);
      storageSheet = workbook.addWorksheet(STORAGE_SHEET);
      storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
      rows.forEach(r => storageSheet.addRow(r));
    } else if (storageSheet.getRow(1).cellCount !== DEFAULT_COLUMNS_LOCATIONS.length) {
      storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
    }
  }

  // Deduplicate by location name if legacy rows created duplicates
  if (storageSheet) {
    const seen = new Set();
    const rows = [];
    let needsRewrite = false;
    storageSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = String(row.getCell(1).value || row.getCell(2).value || '').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (seen.has(key)) {
        needsRewrite = true;
        return;
      }
      seen.add(key);
      rows.push({
        name,
        description: row.getCell(2).value || '',
        notes: row.getCell(3).value || '',
      });
    });
    if (needsRewrite) {
      workbook.removeWorksheet(storageSheet.id);
      storageSheet = workbook.addWorksheet(STORAGE_SHEET);
      storageSheet.columns = DEFAULT_COLUMNS_LOCATIONS;
      rows.forEach(r => storageSheet.addRow(r));
    }
  }

  // Remove legacy Filters sheet if present; filters are implicit from storage locations now
  const filterSheet = workbook.getWorksheet('Filters');
  if (filterSheet) workbook.removeWorksheet(filterSheet.id);

  return { workbook, filePath };
}

function upsertRow(sheet, matcher, values) {
  let targetRow = null;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (matcher(row)) targetRow = row;
  });
  if (!targetRow) {
    targetRow = sheet.addRow(values);
  } else {
    Object.entries(values).forEach(([k, v]) => {
      const col = sheet.getColumn(k);
      if (col && col.number) targetRow.getCell(col.number).value = v;
    });
  }
  return targetRow;
}

async function saveFiltersMongo(company, filters) {
  const cols = await ensureMongoCollections();
  if (!cols) return;
  const bulk = (filters || []).map(f => ({
    updateOne: {
      filter: { company, id: f.id },
      update: { $set: { company, ...f } },
      upsert: true,
    }
  }));
  const ids = new Set((filters || []).map(f => f.id));
  await cols.filters.deleteMany({ company, id: { $nin: Array.from(ids) } });
  if (bulk.length) await cols.filters.bulkWrite(bulk, { ordered: false });
}

async function upsertStorageLocation(company, payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'Location name is required' };
  const id = name; // Use the human-readable name as the identifier
  const sheetName = safeSheetName(name);
  const record = {
    id,
    name,
    description: payload.description || '',
    notes: payload.notes || '',
  };

  if (SHOULD_WRITE_EXCEL) {
    const { workbook, filePath } = await ensureWorkbook(company);
    const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
    upsertRow(storageSheet, (row) => {
      const rname = row.getCell(1).value || row.getCell(2).value;
      return String(rname || '').trim().toLowerCase() === name.toLowerCase();
    }, record);

    let locSheet = workbook.getWorksheet(sheetName);
    if (!locSheet) locSheet = workbook.addWorksheet(sheetName);
    ensureMaterialSheetColumns(locSheet);

    await workbook.xlsx.writeFile(filePath);
  }

  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      await cols.locations.updateOne(
        { company, id },
        { $set: { company, ...record } },
        { upsert: true }
      );
    }
  }

  return { success: true, location: record };
}

async function upsertMaterial(company, payload = {}) {
  const locationKey = payload.location_id || payload.locationId || payload.location || payload.location_name;
  if (!locationKey) return { success: false, message: 'Location is required' };
  const name = String(payload.name || '').trim();
  if (!name) return { success: false, message: 'Material name is required' };
  const id = payload.id || makeId('mat');
  const locationName = String(locationKey).trim();

  const material = {
    id,
    location_id: locationName,
    name,
    quantity: payload.quantity ?? '',
    unit: payload.unit || '',
    value: payload.value ?? '',
    updated_at: new Date().toISOString(),
  };

  if (SHOULD_WRITE_EXCEL) {
    const { workbook, filePath } = await ensureWorkbook(company);
    const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
    let targetSheetName = null;
    storageSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rname = row.getCell(1).value || row.getCell(2).value;
      if (String(rname || '').trim().toLowerCase() === locationName.toLowerCase()) {
        targetSheetName = row.getCell(1).value || row.getCell(2).value;
      }
    });
    targetSheetName = safeSheetName(targetSheetName || locationName || 'Storage');
    let locSheet = workbook.getWorksheet(targetSheetName);
    if (!locSheet) locSheet = workbook.addWorksheet(targetSheetName);
    ensureMaterialSheetColumns(locSheet);
    upsertRow(locSheet, (row) => String(row.getCell(1).value) === String(id), material);
    await workbook.xlsx.writeFile(filePath);
  }

  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      await cols.materials.updateOne(
        { company, id },
        { $set: { company, ...material } },
        { upsert: true }
      );
    }
  }

  return { success: true, material };
}

async function deleteMaterial(company, materialId) {
  const id = String(materialId || '').trim();
  if (!company) return { success: false, message: 'company is required' };
  if (!id) return { success: false, message: 'material id is required' };

  let removedExcel = false;
  if (SHOULD_WRITE_EXCEL) {
    const { workbook, filePath } = await ensureWorkbook(company);
    workbook.worksheets.forEach((sheet) => {
      if (sheet.name === STORAGE_SHEET) return;
      ensureMaterialSheetColumns(sheet);
      for (let r = sheet.rowCount; r >= 2; r--) {
        const row = sheet.getRow(r);
        if (String(row.getCell(1).value) === id) {
          sheet.spliceRows(r, 1);
          removedExcel = true;
        }
      }
    });
    if (removedExcel) {
      await workbook.xlsx.writeFile(filePath);
    }
  }

  let removedMongo = false;
  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      const res = await cols.materials.deleteOne({ company, id });
      removedMongo = (res?.deletedCount || 0) > 0;
    }
  }

  const success = removedExcel || removedMongo;
  return { success, removedExcel, removedMongo, message: success ? undefined : 'Material not found' };
}

async function saveFilters(company, filters = []) {
  // Filters sheet is no longer persisted to Excel; optional Mongo write is kept for parity.
  if (SHOULD_WRITE_MONGO) await saveFiltersMongo(company, filters);
  return { success: true };
}

async function readFromExcel(company) {
  const { workbook } = await ensureWorkbook(company);
  const storageSheet = workbook.getWorksheet(STORAGE_SHEET);
  const locations = [];
  const nameToSheet = new Map(); // lowercased name -> { name, sheetName }
  storageSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = row.getCell(1).value || row.getCell(2).value || '';
    if (!name) return;
    const cleanName = String(name).trim();
    const sheetName = safeSheetName(cleanName);
    nameToSheet.set(cleanName.toLowerCase(), { name: cleanName, sheetName });
    locations.push({
      id: cleanName,
      name: cleanName,
      description: row.getCell(2).value || '',
      sheetName,
      notes: row.getCell(3).value || '',
    });
  });

  const materials = [];
  const skip = new Set([STORAGE_SHEET]);
  workbook.worksheets.forEach((sheet) => {
    if (skip.has(sheet.name)) return;
    ensureMaterialSheetColumns(sheet);
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const id = row.getCell(1).value || '';
      const name = row.getCell(3).value || '';
      if (!id && !name) return;
      const rawLoc = String(row.getCell(2).value || '').trim();
      const locKey = rawLoc.toLowerCase();
      const byName = nameToSheet.get(locKey);
      let resolvedLoc = rawLoc;
      if (byName) {
        resolvedLoc = byName.name;
      } else {
        for (const info of nameToSheet.values()) {
          if (info.sheetName.toLowerCase() === locKey) {
            resolvedLoc = info.name;
            break;
          }
        }
      }
      materials.push({
        id: String(id),
        location_id: resolvedLoc,
        name: String(name),
        quantity: row.getCell(4).value ?? '',
        unit: row.getCell(5).value || '',
        value: row.getCell(6).value ?? '',
        updated_at: row.getCell(7).value || '',
      });
    });
  });

  const filters = locations.map(l => ({ id: l.id, name: l.name }));
  return { locations, materials, filters };
}

async function readFromMongo(company) {
  const cols = await ensureMongoCollections();
  if (!cols) return { locations: [], materials: [], filters: [] };
  const [locations, materials, filters] = await Promise.all([
    cols.locations.find({ company }).toArray(),
    cols.materials.find({ company }).toArray(),
    cols.filters.find({ company }).toArray(),
  ]);
  const locMap = new Map();
  locations.forEach(l => {
    const id = String(l.id);
    const name = String(l.name || l.id || '');
    locMap.set(id, name);
    locMap.set(name.toLowerCase(), name);
  });
  return {
    locations: locations.map(l => {
      const name = String(l.name || l.id || '');
      return { ...l, id: name, name };
    }),
    materials: materials.map(m => ({
      ...m,
      id: String(m.id),
      location_id: (() => {
        const raw = String(m.location_id || m.locationId || m.location || '');
        return locMap.get(raw) || locMap.get(raw.toLowerCase()) || raw;
      })(),
    })),
    filters: filters.map(f => ({ ...f, id: String(f.id) })),
  };
}

async function getCompanyData(company) {
  if (!company) return { locations: [], materials: [], filters: [] };
  if (SHOULD_READ_MONGO) {
    try {
      return await readFromMongo(company);
    } catch (e) {
      console.warn('[materials] Mongo read failed, falling back to Excel:', e.message);
    }
  }
  const excelData = await readFromExcel(company);
  // opportunistic dual-write to Mongo to keep in sync
  if (SHOULD_WRITE_MONGO) {
    const cols = await ensureMongoCollections();
    if (cols) {
      try {
        const locBulk = excelData.locations.map(l => ({
          updateOne: { filter: { company, id: l.id }, update: { $set: { company, ...l } }, upsert: true }
        }));
        if (locBulk.length) await cols.locations.bulkWrite(locBulk, { ordered: false });
        const matBulk = excelData.materials.map(m => ({
          updateOne: { filter: { company, id: m.id }, update: { $set: { company, ...m } }, upsert: true }
        }));
        if (matBulk.length) await cols.materials.bulkWrite(matBulk, { ordered: false });
        const filBulk = excelData.filters.map(f => ({
          updateOne: { filter: { company, id: f.id }, update: { $set: { company, ...f } }, upsert: true }
        }));
        if (filBulk.length) await cols.filters.bulkWrite(filBulk, { ordered: false });
      } catch (e) {
        console.warn('[materials] Mongo sync skipped:', e.message);
      }
    }
  }
  return excelData;
}

async function ensureCompanyWorkbook(company) {
  if (!company) return { success: false, message: 'company is required' };
  await ensureWorkbook(company);
  return { success: true };
}

module.exports = {
  ensureCompanyWorkbook,
  getCompanyData,
  upsertStorageLocation,
  upsertMaterial,
  deleteMaterial,
  saveFilters,
  health() {
    return { success: true };
  },
};

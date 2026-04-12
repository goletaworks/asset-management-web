// backend/excel_worker.js
// All ExcelJS I/O happens here, off the main thread.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
let ExcelJS; // lazy
function progress(stage, pct, msg) {
  try { parentPort.postMessage({ type: 'progress', stage, pct, msg }); } catch (_) {}
}
function getExcel() {
  if (ExcelJS) return ExcelJS;
  progress('exceljs', 10, 'Starting Excel worker…');
  ExcelJS = require('exceljs');
  progress('exceljs', 35, 'ExcelJS loaded');
  return ExcelJS;
}

// ─── Paths ────────────────────────────────────────────────────────────────
const DATA_DIR      = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
const LOGIN_DIR     = path.join(DATA_DIR, 'login');
const LOOKUPS_PATH  = path.join(DATA_DIR, 'lookups.xlsx');
const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
const SEED_PATH     = path.join(__dirname, 'templates', 'lookups.template.xlsx');

// Helper to get company directory
function getCompanyDir(company) {
  return path.join(COMPANIES_DIR, normStr(company));
}
function getLocationFilePath(company, location) {
  return path.join(getCompanyDir(company), `${normStr(location)}.xlsx`);
}

const IH_KEYWORDS_SHEET = 'Inspection History Keywords';
const PH_KEYWORDS_SHEET = 'Project History Keywords';

// ─── Helpers ──────────────────────────────────────────────────────────────
const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };
const normStr = (v) => String(v ?? '').trim();
const lc = (v) => normStr(v).toLowerCase();
const toBool = (v) => ['true','1','yes','y','t'].includes(lc(v));
const uniqSorted = (arr) => Array.from(new Set(arr.map(normStr).filter(Boolean)))
  .sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const getSheet = (wb, name) => wb.getWorksheet(name) || wb.worksheets.find(ws => lc(ws.name) === lc(name));
const REPAIRS_SHEET = 'Repairs';
const REPAIRS_HEADERS = [
  'Date',        // leftmost
  'Station ID',
  'Asset Type',
  'Repair Name',
  'Severity',
  'Priority',
  'Cost',
  'Category',
  'Type',
  'Days',
  'O&M',
  'Capital',
  'Decommission'
];

// Funding helpers
function parseFundingSplitTokens(splitStr) {
  const raw = String(splitStr || '').trim();
  if (!raw) return [];
  return raw
    .split('-')
    .map(s => s.trim())
    .filter(Boolean)
    .map(tok => tok);
}

function formatEqualSplitForTokens(tokens) {
  const n = Array.isArray(tokens) ? tokens.length : 0;
  if (!n) return '';
  // Use one decimal place and adjust last to hit 100 exactly
  const base = Math.round((1000 / n)) / 10; // one decimal
  const parts = new Array(n).fill(base);
  let sum = parts.reduce((a, b) => a + b, 0);
  // Adjust last to fix rounding drift
  parts[n - 1] = Math.round((100 - (sum - parts[n - 1])) * 10) / 10;
  return tokens.map((t, i) => `${parts[i]}%${t}`).join('-');
}

function validateFundingOverrideString(value, allowedTokens) {
  const str = String(value || '').trim();
  if (!str) return { ok: false, reason: 'Empty value' };
  const allow = allowedTokens ? new Set(Array.from(allowedTokens).map(String)) : null;
  const seen = new Set();
  let sum = 0;
  const terms = str.split('-').map(s => s.trim()).filter(Boolean);
  if (!terms.length) return { ok: false, reason: 'No terms' };
  for (const term of terms) {
    const m = term.match(/^([0-9]+(?:\.[0-9]+)?)%(.+)$/);
    if (!m) return { ok: false, reason: `Invalid term: ${term}` };
    const pct = parseFloat(m[1]);
    const tok = m[2].trim();
    if (!tok) return { ok: false, reason: 'Empty token' };
    if (seen.has(tok)) return { ok: false, reason: `Duplicate token: ${tok}` };
    if (allow && !allow.has(tok)) return { ok: false, reason: `Unknown token: ${tok}` };
    seen.add(tok);
    sum += isFinite(pct) ? pct : 0;
  }
  if (sum < 99 || sum > 100) return { ok: false, reason: `Percent sum ${sum} out of range` };
  return { ok: true };
}

let __globalFundingTokensCache = null;
async function getGlobalFundingTokens() {
  if (__globalFundingTokensCache) return __globalFundingTokensCache;
  const tokens = new Set();
  // Scan all company/location workbooks for "Funding Split" tokens
  try {
    ensureDir(COMPANIES_DIR);
    const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    const _ExcelJS = getExcel();
    for (const company of companies) {
      const dir = getCompanyDir(company);
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
      for (const f of files) {
        const fp = path.join(dir, f);
        const wb = new _ExcelJS.Workbook();
        try { await wb.xlsx.readFile(fp); } catch (_) { continue; }
        for (const ws of wb.worksheets) {
          if (!ws || ws.rowCount < 2) continue;
          const splitCol = findColumnByField(ws, 'Funding Split');
          if (splitCol < 1) continue;
          const lastRow = ws.actualRowCount || ws.rowCount || 2;
          for (let r = 3; r <= lastRow; r++) {
            const sv = takeText(ws.getRow(r).getCell(splitCol));
            for (const t of parseFundingSplitTokens(sv)) tokens.add(t);
          }
        }
      }
    }
  } catch (_) {}
  __globalFundingTokensCache = tokens;
  return tokens;
}

function findColumnByField(ws, targetFieldName) {
  // Returns column index for a field name, tolerant of one/two-row headers
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const maxCol = ws.actualColumnCount || Math.max(row1.cellCount || 0, row2.cellCount || 0);
  const want = String(targetFieldName || '').trim().toLowerCase();
  const seps = [' - ', ' – ', ' — ', '-', '–', '—'];
  for (let c = 1; c <= maxCol; c++) {
    const s1 = String(takeText(row1.getCell(c))).trim();
    const s2 = String(takeText(row2.getCell(c))).trim();
    if (s2) {
      if (s2.toLowerCase() === want) return c;
    } else if (s1) {
      let fieldOnly = s1;
      for (const sep of seps) {
        const idx = s1.indexOf(sep);
        if (idx >= 0) fieldOnly = s1.substring(idx + sep.length);
      }
      if (fieldOnly.trim().toLowerCase() === want) return c;
    }
  }
  return -1;
}


// ─── Helper: read O&M/Capital/Decommission from station data sheet ─────────
async function lookupFundingOverridesFor(company, location, assetType, stationId) {
  const filePath = getLocationFilePath(company, location);
  const _ExcelJS = getExcel();
  const result = { om: '', capital: '', decommission: '' };
  if (!fs.existsSync(filePath)) return result;
  if (!assetType || !stationId) return result;

  const wb = new _ExcelJS.Workbook();
  try { await wb.xlsx.readFile(filePath); } catch { return result; }

  const at = String(assetType).toLowerCase();
  const isTwoRow = (ws) => (ws?.getRow(2)?.actualCellCount || 0) > 0;
  const like = (name) => String(name || '').toLowerCase().includes(at);

  // Candidate sheets: name contains asset type; exclude Repairs
  const candidates = (wb.worksheets || [])
    .filter(ws => ws && ws.name && like(ws.name) && !/\brepairs$/i.test(ws.name));

  for (const ws of candidates) {
    const sidCol = findColumnByField(ws, 'Station ID');
    if (sidCol < 1) continue;

    // Funding columns: prefer 2-row "Funding Type Override Settings" section, else plain field names
    let omCol = -1, capCol = -1, decCol = -1;
    const maxCol = ws.actualColumnCount || Math.max(ws.getRow(1).cellCount || 0, ws.getRow(2).cellCount || 0);
    if (isTwoRow(ws)) {
      const r1 = ws.getRow(1), r2 = ws.getRow(2);
      for (let c = 1; c <= maxCol; c++) {
        const sec = takeText(r1.getCell(c));
        const fld = takeText(r2.getCell(c));
        if (sec === 'Funding Type Override Settings') {
          if (fld === 'O&M') omCol = c;
          else if (fld === 'Capital') capCol = c;
          else if (fld === 'Decommission') decCol = c;
        }
      }
      // Fallback: match by field-only if section not present
      if (omCol < 0 || capCol < 0 || decCol < 0) {
        for (let c = 1; c <= maxCol; c++) {
          const fld = takeText(r2.getCell(c));
          if (fld === 'O&M' && omCol < 0) omCol = c;
          if (fld === 'Capital' && capCol < 0) capCol = c;
          if (fld === 'Decommission' && decCol < 0) decCol = c;
        }
      }
    } else {
      const r1 = ws.getRow(1);
      for (let c = 1; c <= maxCol; c++) {
        const fld = takeText(r1.getCell(c));
        if (fld === 'O&M' && omCol < 0) omCol = c;
        if (fld === 'Capital' && capCol < 0) capCol = c;
        if (fld === 'Decommission' && decCol < 0) decCol = c;
      }
    }
    const startRow = isTwoRow(ws) ? 3 : 2;
    const lastRow = ws.actualRowCount || ws.rowCount || startRow;
    for (let r = startRow; r <= lastRow; r++) {
      const row = ws.getRow(r);
      if (takeText(row.getCell(sidCol)) !== String(stationId)) continue;
      if (omCol > 0) result.om = takeText(row.getCell(omCol));
      if (capCol > 0) result.capital = takeText(row.getCell(capCol));
      if (decCol > 0) result.decommission = takeText(row.getCell(decCol));
      return result;
    }
  }
  return result;
}

// ─── GI normalization helpers ─────────────────────────────────────────────
function isGIAnchorName(s) {
  const l = String(s || '').trim().toLowerCase();
  return [
    'station id','stationid','id','category',
    'site name','station name','name',
    'province','location','state','region',
    'latitude','lat','y','longitude','long','lng','lon','x',
    'status'
  ].includes(l);
}

function giSectionForFieldName(field) {
  const f = String(field || '').trim().toLowerCase();
  if (f === 'asset type' || f === 'type') return 'General Information';
  if (isGIAnchorName(field)) return 'General Information';
  return 'Extra Information';
}

function normalizeHeaderPair(sec, fld) {
  const s = String(sec || '').trim();
  const f = String(fld || '').trim();
  const fl = f.toLowerCase();
  // Collapse synonyms into GI/Category (but NEVER "Structure Type")
  if (fl === 'asset type' || fl === 'type' || fl === 'category') {
    return { sec: 'General Information', fld: 'Category' };
  }
  // Canonicalize name to "Station Name"
  if (['site name','station name','name'].includes(fl)) {
    return { sec: 'General Information', fld: 'Station Name' };
  }
  if (isGIAnchorName(f)) return { sec: 'General Information', fld: f };
  // If section is blank for a non-GI field, force "Extra Information"
  return { sec: s || giSectionForFieldName(f), fld: f };
}

// Ensure a sheet has a two-row header; synthesize sections if missing
function ensureTwoRowHeader(ws) {
  const row2HasAny = (ws.getRow(2)?.actualCellCount || ws.getRow(2)?.cellCount || 0) > 0;
  if (row2HasAny) return;
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
  const sections = [];
  const fields = [];
  for (let c = 1; c <= maxCol; c++) {
    const fld = takeText(headerRow.getCell(c));
    fields.push(fld);
    sections.push(giSectionForFieldName(fld));
  }
  // Insert a new row at the top for sections; original header becomes row 2
  ws.spliceRows(1, 0, []);
  ws.getRow(1).values = [, ...sections];
  ws.getRow(2).values = [, ...fields];
}


// ─── New sheet names ───────────────────────────────────────────────────────
const ALG_PARAMS_SHEET       = 'Algorithm Parameters';
const WORKPLAN_CONST_SHEET   = 'Workplan Constants';
const CUSTOM_WEIGHTS_SHEET   = 'Custom Weights';
const FIXED_PARAMS_SHEET     = 'Fixed Parameters';
const REPAIR_COLOURS_SHEET   = 'Repair Colours';

// ─── Ensure workbook exists with canonical sheets ─────────────────────────
async function ensureLookupsReady() {
  progress('ensure', 40, 'Ensuring data folders…');
  ensureDir(DATA_DIR); ensureDir(COMPANIES_DIR);
  if (!fs.existsSync(LOOKUPS_PATH)) {
    if (fs.existsSync(SEED_PATH)) {
      progress('ensure', 45, 'Copying seed workbook…');
      fs.copyFileSync(SEED_PATH, LOOKUPS_PATH);
      progress('ensure', 55, 'Seed workbook copied');
      // fall through to post-creation validation to add new sheets if seed lacks them
    }
  }
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();

  if (fs.existsSync(LOOKUPS_PATH)) {
    progress('ensure', 55, 'Opening lookups.xlsx…');
    await wb.xlsx.readFile(LOOKUPS_PATH);
    progress('ensure', 65, 'Validating sheets…');

    const need = (n) => !wb.worksheets.some(ws => ws.name === n);
    let changed = false;

    if (need('Companies'))          { wb.addWorksheet('Companies').addRow(['company','active','description','email']); changed = true; }
    if (need('Locations'))          { wb.addWorksheet('Locations').addRow(['location','company','link']); changed = true; }
    if (need('AssetTypes'))         { wb.addWorksheet('AssetTypes').addRow(['asset_type','location','company','color','link']); changed = true; }

    if (need('Custom Weights'))     { wb.addWorksheet('Custom Weights').addRow(['weight','active']); changed = true; }
    if (need('Workplan Constants')) { wb.addWorksheet('Workplan Constants').addRow(['Field','Value']); changed = true; }
    if (need('Algorithm Parameters')) {
      wb.addWorksheet('Algorithm Parameters').addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']); changed = true;
    }
    if (need('Fixed Parameters')) {
      const ws = wb.addWorksheet('Fixed Parameters');
      ws.addRow(['Name', 'Type', 'Configuration']);
      changed = true;
    }

    // NEW sheets
    if (need('Status Colors')) {
      const ws = wb.addWorksheet('Status Colors');
      ws.addRow(['Status','Color']);
      ws.addRow(['Inactive',    '#ff0000']);
      ws.addRow(['Mothballed',  '#a87ecb']);
      ws.addRow(['Unknown',     '#999999']);
      changed = true;
    }
    if (need('Settings')) {
      const ws = wb.addWorksheet('Settings');
      ws.addRow(['Key','Value']);
      ws.addRow(['applyStatusColorsOnMap','FALSE']);
      ws.addRow(['applyRepairColorsOnMap','FALSE']);
      changed = true;
    }
    if (need(IH_KEYWORDS_SHEET)) {
      const ws = wb.addWorksheet(IH_KEYWORDS_SHEET);
      ws.addRow(['Keyword']);
      ws.addRow(['inspection']); // default on creation
      changed = true;
    }
    // NEW: Repair Colours sheet
    if (need(REPAIR_COLOURS_SHEET)) {
      const ws = wb.addWorksheet(REPAIR_COLOURS_SHEET);
      ws.addRow(['company','location','asset type','repair colour']);
      changed = true;
    }
    if (changed) {
      progress('ensure', 75, 'Writing workbook changes…');
      await wb.xlsx.writeFile(LOOKUPS_PATH);
    }
    progress('ensure', 80, 'Workbook ready');
    return true;
  } else {
    progress('ensure', 55, 'Creating workbook…');
    wb.addWorksheet('Companies').addRow(['company','active','description','email']);
    wb.addWorksheet('Locations').addRow(['location','company','link']);
    wb.addWorksheet('AssetTypes').addRow(['asset_type','location','company','color','link']);
    wb.addWorksheet('Custom Weights').addRow(['weight','active']);
    wb.addWorksheet('Workplan Constants').addRow(['Field','Value']);
    wb.addWorksheet('Algorithm Parameters').addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
   
    const wsFP = wb.addWorksheet('Fixed Parameters');
    wsFP.addRow(['Name', 'Type', 'Configuration']);

    // NEW: default Status Colors & Settings
    const wsS = wb.addWorksheet('Status Colors');
    wsS.addRow(['Status','Color']);
    wsS.addRow(['Inactive','#ff0000']);
    wsS.addRow(['Mothballed','#a87ecb']);
    wsS.addRow(['Unknown','#999999']);

    const wsCfg = wb.addWorksheet('Settings');
    wsCfg.addRow(['Key','Value']);
    wsCfg.addRow(['applyStatusColorsOnMap','FALSE']);
    wsCfg.addRow(['applyRepairColorsOnMap','FALSE']);

    // NEW: Inspection History Keywords (global)
    const wsIH = wb.addWorksheet(IH_KEYWORDS_SHEET);
    wsIH.addRow(['Keyword']);
    wsIH.addRow(['inspection']); // default

    // NEW: Project History Keywords (global)
    const wsPH = wb.addWorksheet(PH_KEYWORDS_SHEET);
    wsPH.addRow(['Keyword']);
    wsPH.addRow(['project']);
    wsPH.addRow(['construction']);
    wsPH.addRow(['maintenance']);
    wsPH.addRow(['repair']);
    wsPH.addRow(['decommission']);

    const wsRC = wb.addWorksheet(REPAIR_COLOURS_SHEET);
    wsRC.addRow(['company','location','asset type','repair colour']);

    progress('ensure', 70, 'Saving new workbook…');
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    progress('ensure', 80, 'Workbook ready');
    return true;
  }
}

// ─── Read snapshot for caches ─────────────────────────────────────────────
async function readLookupsSnapshot() {
  await ensureLookupsReady();
  progress('snapshot', 82, 'Reading lookups snapshot…');
  const stat = fs.statSync(LOOKUPS_PATH);
  const mtimeMs = stat ? stat.mtimeMs : 0;

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  progress('snapshot', 88, 'Parsing sheets…');
  const wsA = getSheet(wb, 'AssetTypes');
  const wsC = getSheet(wb, 'Companies');
  const wsL = getSheet(wb, 'Locations');
  const wsK = getSheet(wb, IH_KEYWORDS_SHEET);
  const wsPK = getSheet(wb, PH_KEYWORDS_SHEET);
  const wsRC = getSheet(wb, REPAIR_COLOURS_SHEET);

  // NEW: link caches
  const locationLinks = {};        // { company: { location: link } }
  const assetTypeLinks = {};       // { company: { location: { asset_type: link } } }

  const colorsGlobal = {};               // { assetType: color }
  const colorsByLoc  = {};               // { location: { assetType: color } }
  const colorsByCompanyLoc = {};         // { company: { location: { assetType: color } } }
  
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at   = normStr(row.getCell(1)?.text);
      const loc  = normStr(row.getCell(2)?.text);
      const co   = normStr(row.getCell(3)?.text);
      const col  = normStr(row.getCell(4)?.text);
      if (!at || !col) return;
      if (!loc && !co) {
        if (!colorsGlobal[at]) colorsGlobal[at] = col;
      } else if (loc && co) {
        ((colorsByCompanyLoc[co] ||= {})[loc] ||= {});
        if (!colorsByCompanyLoc[co][loc][at]) colorsByCompanyLoc[co][loc][at] = col;
      } else if (loc) {
        (colorsByLoc[loc] ||= {});
        if (!colorsByLoc[loc][at]) colorsByLoc[loc][at] = col;
      }
    });
  }

  const companies = [];
  if (wsC) {
    wsC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const name = normStr(row.getCell(1)?.text);
      const active = toBool(row.getCell(2)?.text);
      if (name && active) {
        companies.push({
          name: name,
          description: normStr(row.getCell(3)?.text),
          email: normStr(row.getCell(4)?.text),
        });
      }
    });
  }

  const locsByCompany = {};  // { company: [locations] }
  const assetsByCompanyLocation = {}; // { company: { location: [assetTypes] } }
  if (wsL) {
    wsL.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const loc = normStr(row.getCell(1)?.text);
      const comp= normStr(row.getCell(2)?.text);
      const link= normStr(row.getCell(3)?.text);
      if (!loc || !comp) return;
      (locsByCompany[comp] ||= new Set()).add(loc);
      if (link) {
        ((locationLinks[comp] ||= {}))[loc] = link;
      }
    });
  }
  if (wsA) {
    wsA.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const at  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      const co  = normStr(row.getCell(3)?.text);
      const link = normStr(row.getCell(5)?.text); // 5th column = link
      if (!at || !loc || !co) return;
      // Scope by company AND location
      ((assetsByCompanyLocation[co] ||= {})[loc] ||= new Set()).add(at);
      if (at && loc && co && link) {
        (((assetTypeLinks[co] ||= {})[loc] ||= {}))[at] = link;
      }
    });
  }

  // NEW: Read Repair Colours
  const repairColors = {};
  if (wsRC) {
    wsRC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const co  = normStr(row.getCell(1)?.text);
      const loc = normStr(row.getCell(2)?.text);
      const at  = normStr(row.getCell(3)?.text);
      const col = normStr(row.getCell(4)?.text);
      if (co && loc && at && col) {
        if (!repairColors[co]) repairColors[co] = {};
        if (!repairColors[co][loc]) repairColors[co][loc] = {};
        repairColors[co][loc][at] = col;
      }
    });
  }

  // NEW: Status Colors + Settings
  const wsSC = getSheet(wb, 'Status Colors');
  const statusColors = {};
  if (wsSC) {
    wsSC.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const k = normStr(row.getCell(1)?.text).toLowerCase(); // inactive/mothballed/unknown
      const col = normStr(row.getCell(2)?.text);
      if (k) statusColors[k] = col || '';
    });
  }

  const wsCfg = getSheet(wb, 'Settings');
  let applyStatusColorsOnMap = false;
  let applyRepairColorsOnMap = false;
  let statusOverridesRepair = false;
  if (wsCfg) {
    wsCfg.eachRow({ includeEmpty:false }, (row, i) => {
      if (i === 1) return;
      const key = normStr(row.getCell(1)?.text);
      const val = normStr(row.getCell(2)?.text);
      if (key.toLowerCase() === 'applystatuscolorsonmap') applyStatusColorsOnMap = toBool(val);
      if (key.toLowerCase() === 'applyrepaircolorsonmap') applyRepairColorsOnMap = toBool(val);
      if (key.toLowerCase() === 'statusoverridesrepair') statusOverridesRepair = toBool(val);
    });
  }

  Object.keys(locsByCompany).forEach(k => { locsByCompany[k] = Array.from(locsByCompany[k]).sort((a,b)=>a.localeCompare(b)); });
  Object.keys(assetsByCompanyLocation).forEach(co => {
    Object.keys(assetsByCompanyLocation[co]).forEach(loc => {
      assetsByCompanyLocation[co][loc] = Array.from(assetsByCompanyLocation[co][loc]).sort((a,b)=>a.localeCompare(b));
    });
  });

  const payload = {
    mtimeMs, colorsGlobal, colorsByLoc, colorsByCompanyLoc,
    companies: companies, // Now an array of objects
    locsByCompany, 
    assetsByCompanyLocation,
    statusColors,
    applyStatusColorsOnMap,
    repairColors,
    applyRepairColorsOnMap,
    statusOverridesRepair,
    // NEW:
    locationLinks,
    assetTypeLinks,
    // NEW: inspection keywords
    inspectionKeywords: (function () {
      const out = [];
      if (wsK) {
        wsK.eachRow({ includeEmpty:false }, (row) => {
          const v = normStr(row.getCell(1)?.text);
          if (!v) return;
          if (v.toLowerCase() === 'keyword') return; // skip header anywhere
          out.push(v);
        });
      }
      return wsK ? uniqSorted(out) : ['inspection'];
    })(),
    // NEW: project keywords
    projectKeywords: (function () {
      const out = [];
      if (wsPK) {
        wsPK.eachRow({ includeEmpty:false }, (row) => {
          const v = normStr(row.getCell(1)?.text);
          if (!v) return;
          if (v.toLowerCase() === 'keyword') return; // skip header anywhere
          out.push(v);
        });
      }
      return wsPK ? uniqSorted(out) : ['project', 'construction', 'maintenance', 'repair', 'decommission'];
    })(),
  };
  progress('done', 100, 'Excel ready');
  return payload;
}

// ─── Writes: Inspection Keywords (global list) ─────────────────────────────
async function setInspectionKeywords(keywords = []) {
  await ensureLookupsReady();
  const list = Array.isArray(keywords)
    ? uniqSorted(keywords.map(v => normStr(v)).filter(Boolean))
    : [];

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);

  const existing = getSheet(wb, IH_KEYWORDS_SHEET);
  if (existing) {
    // safest: remove and recreate to avoid phantom/Formatted rows
    wb.removeWorksheet(existing.id);
  }
  const ws = wb.addWorksheet(IH_KEYWORDS_SHEET);

  ws.addRow(['Keyword']);
  for (const k of list) ws.addRow([k]);

  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true, count: list.length };
}

// ─── Writes: Project Keywords (global list) ────────────────────────────────
async function setProjectKeywords(keywords = []) {
  await ensureLookupsReady();
  const list = Array.isArray(keywords)
    ? uniqSorted(keywords.map(v => normStr(v)).filter(Boolean))
    : [];

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);

  const existing = getSheet(wb, PH_KEYWORDS_SHEET);
  if (existing) {
    // safest: remove and recreate to avoid phantom/Formatted rows
    wb.removeWorksheet(existing.id);
  }
  const ws = wb.addWorksheet(PH_KEYWORDS_SHEET);

  ws.addRow(['Keyword']);
  for (const k of list) ws.addRow([k]);

  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true, count: list.length };
}


// ─── Writes ───────────────────────────────────────────────────────────────
function randHexColor() { return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0'); }

async function setAssetTypeColor(assetType, color) {
  await ensureLookupsReady();
  // Global colors are deliberately disabled in the strict model.
  // Kept for backward calls: no-op with explicit response.
  return { success: false, disabled: true, message: 'Global colors are disabled; use setAssetTypeColorForCompanyLocation' };
}

// NEW: write location link
async function setLocationLink(company, location, link) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Locations') || wb.addWorksheet('Locations');
  if (ws.rowCount === 0) ws.addRow(['location','company','link']);
  const tgtLoc = lc(location), tgtComp = lc(company);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const loc = lc(row.getCell(1)?.text);
    const comp= lc(row.getCell(2)?.text);
    if (loc === tgtLoc && comp === tgtComp) {
      row.getCell(3).value = normStr(link || '');
      found = true;
    }
  });
  if (!found) ws.addRow([normStr(location), normStr(company), normStr(link || '')]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// NEW: write asset type link
async function setAssetTypeLink(assetType, company, location, link) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes') || wb.addWorksheet('AssetTypes');
  if (ws.rowCount === 0) ws.addRow(['asset_type','location','company','color','link']);
  const tgtAt = lc(assetType), tgtLoc = lc(location), tgtComp = lc(company);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const co  = lc(row.getCell(3)?.text);
    if (at === tgtAt && loc === tgtLoc && co === tgtComp) {
      // keep color if present
      if (!normStr(row.getCell(4)?.text)) row.getCell(4).value = randHexColor();
      row.getCell(5).value = normStr(link || '');
      found = true;
    }
  });
  if (!found) {
    ws.addRow([normStr(assetType), normStr(location), normStr(company), randHexColor(), normStr(link || '')]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

async function setStatusColor(statusKey, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Status Colors') || wb.addWorksheet('Status Colors');
  if (ws.rowCount === 0) ws.addRow(['Status','Color']);
  
  const tgt = lc(statusKey);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = color;
      found = true;
    }
  });
  if (!found) ws.addRow([statusKey, color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// NEW: delete a status row by key (case-insensitive on "Status" column)
async function deleteStatusRow(statusKey) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Status Colors') || wb.addWorksheet('Status Colors');
  if (ws.rowCount === 0) ws.addRow(['Status','Color']);
  const tgt = lc(statusKey);
  let removed = false;
  // Find the row index (1-based); header is row 1
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      ws.spliceRows(i, 1);
      removed = true;
    }
  });
  if (removed) {
    await wb.xlsx.writeFile(LOOKUPS_PATH);
  }
  return { success:true, removed };
}

async function setSettingBoolean(key, flag) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Settings') || wb.addWorksheet('Settings');
  if (ws.rowCount === 0) ws.addRow(['Key','Value']);
  const tgt = lc(key);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = flag ? 'TRUE' : 'FALSE';
      found = true;
    }
  });
  if (!found) ws.addRow([key, flag ? 'TRUE' : 'FALSE']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// ─── Repairs I/O (Unified per-location sheet model) ──────────────────────────
// All repairs for a <location>.xlsx are stored in a single sheet named "Repairs".
// Legacy sheets like "Cableway BC Repairs" are auto-migrated into "Repairs" on write.
// "Repairs" is always kept as the LAST sheet in the workbook.

function ensureRepairsHeader(ws) {
  if (!ws.rowCount || ws.getRow(1).cellCount === 0) {
    ws.addRow(REPAIRS_HEADERS);
    return;
  }
  const r1 = ws.getRow(1);
  const existing = (r1.values || []).slice(1).map(v => String(v ?? '').trim());
  const same = REPAIRS_HEADERS.every((h, i) => (existing[i] || '').toLowerCase() === h.toLowerCase());
  if (!same) r1.values = [, ...REPAIRS_HEADERS];
}

function moveSheetToEnd(wb, ws) {
  const idx = wb.worksheets.findIndex(x => x === ws);
  if (idx >= 0 && idx !== wb.worksheets.length - 1) {
    wb.worksheets.splice(idx, 1);
    wb.worksheets.push(ws);
  }
}

/**
 * Migrate any legacy "* Repairs" sheets into the unified "Repairs" sheet.
 * Removes the legacy sheets after copying rows.
 */
function migrateLegacyRepairsSheetsInto(wb, target) {
  const legacy = wb.worksheets.filter(s => {
    const name = String(s?.name || '');
    if (!name) return false;
    if (lc(name) === lc(REPAIRS_SHEET)) return false;
    return /\brepairs$/i.test(name);
  });

  if (!legacy.length) return;

  // Build a fast map for header indices on target
  ensureRepairsHeader(target);

  for (const s of legacy) {
    const headerRow = s.getRow(1);
    const maxCol = s.actualColumnCount || headerRow.cellCount || 0;
    const headerNames = [];
    for (let c = 1; c <= maxCol; c++) headerNames.push(takeText(headerRow.getCell(c)));
    const idxOf = (want) => headerNames.findIndex(h => (h || '').toLowerCase() === want.toLowerCase()) + 1;

    const mapIdx = REPAIRS_HEADERS.map(h => idxOf(h)); // 1-based or 0 if missing
    const lastRow = s.actualRowCount || s.rowCount || 1;

    for (let r = 2; r <= lastRow; r++) {
      const row = s.getRow(r);
      const values = REPAIRS_HEADERS.map((h, i) => {
        const ci = mapIdx[i];
        return ci > 0 ? takeText(row.getCell(ci)) : '';
      });
      // Skip truly empty rows / missing Station ID
      if (!String(values[1] || '').trim()) continue;
      target.addRow(values);
    }

    wb.removeWorksheet(s.id);
  }
}

/**
 * Get or create the unified Repairs sheet for a location workbook
 * (ignores assetType; kept for API compatibility).
 */
async function _ensureRepairsSheet(company, location, _assetType) {
  const _ExcelJS = getExcel();
  const companyDir = getCompanyDir(company);
  ensureDir(companyDir);
  const filePath = getLocationFilePath(company, location);

  const wb = new _ExcelJS.Workbook();
  if (fs.existsSync(filePath)) {
    await wb.xlsx.readFile(filePath);
  } else {
    // Create location workbook if it doesn't exist
    await wb.xlsx.writeFile(filePath);
  }

  let ws = getSheet(wb, REPAIRS_SHEET);
  if (!ws) {
    ws = wb.addWorksheet(REPAIRS_SHEET);
  }
  ensureRepairsHeader(ws);

  // Migrate any legacy "* Repairs" sheets into this one
  migrateLegacyRepairsSheetsInto(wb, ws);

  // Ensure "Repairs" is the LAST sheet
  moveSheetToEnd(wb, ws);

  return { wb, ws, filePath, sheetName: REPAIRS_SHEET };
}

/**
 * List all repairs for a specific station from the unified Repairs sheet.
 * Backward compatible: if "Repairs" doesn't exist, falls back to legacy sheets.
 */
async function listRepairsForStation(company, location, _assetType, stationId) {
  const filePath = getLocationFilePath(company, location);
  if (!fs.existsSync(filePath)) return [];

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const out = [];
  const addFromSheet = (ws) => {
    if (!ws) return;
    const headerRow = ws.getRow(1);
    const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
    // Build header→index map
    const headers = [];
    for (let c = 1; c <= maxCol; c++) headers.push(takeText(headerRow.getCell(c)));
    const find = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase()) + 1;

    const sidCol = find('Station ID');
    if (sidCol < 1) return;

    const last = ws.actualRowCount || ws.rowCount || 1;
    for (let r = 2; r <= last; r++) {
      const row = ws.getRow(r);
      if (takeText(row.getCell(sidCol)) !== stationId) continue;
      out.push({
        date:      takeText(row.getCell(find('Date'))),
        station_id: stationId,
        assetType: takeText(row.getCell(find('Asset Type'))),
        name:      takeText(row.getCell(find('Repair Name'))),
        severity:  takeText(row.getCell(find('Severity'))),
        priority:  takeText(row.getCell(find('Priority'))),
        cost:      takeText(row.getCell(find('Cost'))),
        category:  takeText(row.getCell(find('Category'))),
        type:      takeText(row.getCell(find('Type'))),
        days:      takeText(row.getCell(find('Days'))),
        // NOTE: Funding triplet deliberately returned here but never displayed by frontend
        om:        takeText(row.getCell(find('O&M'))),
        capital_o: takeText(row.getCell(find('Capital'))),
        decommission: takeText(row.getCell(find('Decommission'))),
      });
    }
  };

  // Prefer unified "Repairs"
  let ws = getSheet(wb, REPAIRS_SHEET);
  if (ws) {
    addFromSheet(ws);
    return out;
  }

  // Legacy fallback (read-only)
  for (const s of wb.worksheets) {
    if (s && /\brepairs$/i.test(s.name)) addFromSheet(s);
  }
  return out;
}

/**
 * Append a repair row to the unified Repairs sheet
 */
async function appendRepair(company, location, _assetType, repair = {}) {
  await ensureLookupsReady();
  const { wb, ws, filePath } = await _ensureRepairsSheet(company, location, null);

  const stationId = normStr(repair['Station ID'] || repair['station_id'] || repair['StationID'] || repair['ID']);
  if (!stationId) {
    return { success: false, message: 'Station ID is required in the repair payload.' };
  }

  // Canonical header maintenance (same as before)
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
  const cur = [];
  for (let c = 1; c <= maxCol; c++) cur.push(takeText(headerRow.getCell(c)));

  const haveCI = new Set(cur.map(h => h.toLowerCase()));
  const required = REPAIRS_HEADERS.slice(); // Date..Days

  // Ensure all required headers exist
  for (const req of required) {
    if (!haveCI.has(req.toLowerCase())) {
      cur.push(req);
      haveCI.add(req.toLowerCase());
    }
  }

  // Final header order = canonical + extras (if any)
  const standardOrder = REPAIRS_HEADERS.slice();
  const standardSet = new Set(standardOrder.map(h => h.toLowerCase()));
  const extras = cur.filter(h => !standardSet.has(h.toLowerCase()));
  const headers = [...standardOrder, ...extras];
  ws.getRow(1).values = [, ...headers];

  // Locate Station ID column
  const sidCol = headers.findIndex(h => (h || '').toLowerCase() === 'station id') + 1;

  // Find last row for this Station ID (for grouped insert)
  const lastRowIdx = ws.actualRowCount || ws.rowCount || 1;
  let lastForStation = 0;
  for (let r = 2; r <= lastRowIdx; r++) {
    const row = ws.getRow(r);
    const curSid = takeText(row.getCell(sidCol));
    if (curSid && curSid.toLowerCase() === stationId.toLowerCase()) {
      lastForStation = r;
    }
  }

  // Build row values aligned to headers
  const today = new Date().toISOString().slice(0, 10);
  const get = (k) => repair[k] !== undefined ? repair[k] : '';
  const at = normStr(get('Asset Type') || repair.assetType || _assetType || '');
  // Pull O&M/Capital/Decommission from station workbook for this station/asset
  const funding = await lookupFundingOverridesFor(company, location, at, stationId);
  // Determine which funding column to populate based on Category
  const rawCat = normStr(get('Category') || get('category'));
  let chosenCat = 'Capital';
  if (/^o&?m$/i.test(rawCat)) chosenCat = 'O&M';
  else if (/^decomm/i.test(rawCat)) chosenCat = 'Decommission';

  const getAny = (...keys) => {
    for (const k of keys) {
      const v = repair[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  };

  const newValues = headers.map(h => {
    const l = (h || '').toLowerCase();
    if (l === 'date')        return get('Date') || getAny('date') || today;
    if (l === 'station id')  return stationId;
    if (l === 'asset type')  return at;
    if (l === 'repair name') return get('Repair Name') || getAny('name', 'repair_name') || '';
    if (l === 'type')        return get('Type') || getAny('type') || 'Repair';
    if (l === 'category')    return get('Category') || getAny('category') || 'Capital';
    if (l === 'o&m')         return chosenCat === 'O&M' ? (funding.om || '') : '';
    if (l === 'capital')     return chosenCat === 'Capital' ? (funding.capital || '') : '';
    if (l === 'decommission')return chosenCat === 'Decommission' ? (funding.decommission || '') : '';
    if (l === 'severity')    return get('Severity') || getAny('severity') || '';
    if (l === 'priority')    return get('Priority') || getAny('priority') || '';
    if (l === 'cost')        return get('Cost') || getAny('cost') || '';
    if (l === 'days')        return get('Days') || getAny('days') || '';
    return get(h) || '';
  });

  // Insert grouped
  let insertedAt;
  if (lastForStation >= 2) {
    ws.spliceRows(lastForStation + 1, 0, newValues);
    insertedAt = lastForStation + 1;
  } else {
    const newRow = ws.addRow(newValues);
    insertedAt = newRow.number;
  }

  // Keep Repairs last
  moveSheetToEnd(wb, ws);

  await wb.xlsx.writeFile(filePath);
  return { success: true, file: filePath, sheet: REPAIRS_SHEET, insertedAt };
}

/**
 * Get all repairs across all locations (unified model).
 * If unified sheet exists, reads from it. Otherwise (legacy) reads from each "* Repairs" sheet.
 * For convenience, attempts to derive assetType by scanning non-Repairs sheets (by Station ID → Category).
 */
async function getAllRepairs() {
  ensureDir(COMPANIES_DIR);
  const _ExcelJS = getExcel();
  const allRepairs = [];

  const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const company of companies) {
    const companyDir = getCompanyDir(company);
    if (!fs.existsSync(companyDir)) continue;

    const locationFiles = fs.readdirSync(companyDir)
      .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
      .map(f => path.join(companyDir, f));

    for (const filePath of locationFiles) {
      const location = path.basename(filePath, '.xlsx');
      const wb = new _ExcelJS.Workbook();
      try { await wb.xlsx.readFile(filePath); } catch { continue; }

      // Build StationID → AssetType (Category) map from non-Repairs sheets
      const sidToAsset = new Map();
      for (const ws of wb.worksheets) {
        if (!ws || ws.rowCount < 2) continue;
        if (ws.name && ws.name.toLowerCase().includes('repairs')) continue;

        const twoRow = (ws.getRow(2)?.actualCellCount || 0) > 0;
        const dataStart = twoRow ? 3 : 2;
        const sidCol = findColumnByField(ws, 'Station ID');
        let catCol = findColumnByField(ws, 'Category');
        if (catCol < 1) catCol = findColumnByField(ws, 'Asset Type');
        if (catCol < 1) catCol = findColumnByField(ws, 'Type');
        if (sidCol < 1 || catCol < 1) continue;

        const lastRow = ws.actualRowCount || ws.rowCount || dataStart - 1;
        for (let r = dataStart; r <= lastRow; r++) {
          const row = ws.getRow(r);
          const sid = takeText(row.getCell(sidCol));
          const at  = takeText(row.getCell(catCol));
          if (sid) sidToAsset.set(sid, at);
        }
      }

      const addFromSheet = (ws) => {
        if (!ws) return;
        const headerRow = ws.getRow(1);
        const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
        const headers = [];
        for (let c = 1; c <= maxCol; c++) headers.push(takeText(headerRow.getCell(c)));
        const find = (name) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase()) + 1;
        const sidCol = find('Station ID');
        if (sidCol < 1) return;

        const last = ws.actualRowCount || ws.rowCount || 1;
        for (let r = 2; r <= last; r++) {
          const row = ws.getRow(r);
          const stationId = takeText(row.getCell(sidCol));
          if (!stationId) continue;
          const atFromRepairs = takeText(row.getCell(find('Asset Type')));
          allRepairs.push({
            date:     takeText(row.getCell(find('Date'))),
            station_id: stationId,
            name:     takeText(row.getCell(find('Repair Name'))),
            severity: takeText(row.getCell(find('Severity'))),
            priority: takeText(row.getCell(find('Priority'))),
            cost:     takeText(row.getCell(find('Cost'))),
            category: takeText(row.getCell(find('Category'))),
            type:     takeText(row.getCell(find('Type'))),
            days:     takeText(row.getCell(find('Days'))),
            location,
            assetType: atFromRepairs || sidToAsset.get(stationId) || '',
            company,
          });
        }
      };

      // Prefer unified "Repairs"
      const unified = getSheet(wb, REPAIRS_SHEET);
      if (unified) {
        addFromSheet(unified);
      } else {
        // Legacy fallback
        for (const ws of wb.worksheets) {
          if (ws && /\brepairs$/i.test(ws.name)) addFromSheet(ws);
        }
      }
    }
  }

  return allRepairs;
}

/**
 * Save (replace) all repairs for a station into the unified "Repairs" sheet.
 */
async function saveStationRepairs(company, location, _assetType, stationId, repairs = []) {
  await ensureLookupsReady();
  const { wb, ws, filePath } = await _ensureRepairsSheet(company, location, null);

  // Ensure header
  ensureRepairsHeader(ws);

  // Locate Station ID column
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) headers.push(takeText(headerRow.getCell(c)));
  const sidCol = headers.findIndex(h => (h || '').toLowerCase() === 'station id') + 1;

  // Remove existing rows for this station
  const maxRow = ws.actualRowCount || ws.rowCount || 1;
  const rowsToDelete = [];
  for (let r = 2; r <= maxRow; r++) {
    const row = ws.getRow(r);
    if (takeText(row.getCell(sidCol)) === stationId) rowsToDelete.push(r);
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    ws.spliceRows(rowsToDelete[i], 1);
  }

  // Add new rows
  const today = new Date().toISOString().slice(0, 10);
  for (const repair of repairs) {
    const at = normStr(repair.assetType || _assetType || '');
    const funding = await lookupFundingOverridesFor(company, location, at, stationId);
    const catRaw = normStr(repair.category || repair.Category || 'Capital');
    const isOM = /^o&?m$/i.test(catRaw);
    const isDec = /^decomm/i.test(catRaw);
    const isCap = !isOM && !isDec;
    const omOut  = isOM  ? (funding.om || '') : '';
    const capOut = isCap ? (funding.capital || '') : '';
    const decOut = isDec ? (funding.decommission || '') : '';
    const rowVals = [
      repair.date || today,
      stationId,
      at,
      repair.name || '',
      repair.severity || '',
      repair.priority || '',
      repair.cost || '',
      repair.category || 'Capital',
      repair.type || 'Repair',
      repair.days || '',
      omOut,
      capOut,
      decOut
    ];
    ws.addRow(rowVals);
  }

  // Keep "Repairs" as last
  moveSheetToEnd(wb, ws);

  await wb.xlsx.writeFile(filePath);
  return { success: true, file: filePath, sheet: REPAIRS_SHEET, count: repairs.length };
}

/**
 * Delete a single repair for a station by index (0-based), unified model.
 */
async function deleteRepair(company, location, assetType, stationId, repairIndex) {
  const repairs = await listRepairsForStation(company, location, assetType, stationId);
  if (repairIndex >= 0 && repairIndex < repairs.length) {
    repairs.splice(repairIndex, 1);
    return await saveStationRepairs(company, location, assetType, stationId, repairs);
  }
  return { success: false, message: 'Invalid repair index' };
}

async function setAssetTypeColorForLocation(assetType, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  // Redirect per-location → (company,location) using Locations sheet mapping.
  const wsA = getSheet(wb, 'AssetTypes');
  const wsL = getSheet(wb, 'Locations');
  if (!wsA || !wsL) throw new Error('Missing required sheets');
  let companyForLoc = '';
  wsL.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const loc = lc(row.getCell(1)?.text);
    const comp= normStr(row.getCell(2)?.text);
    if (loc === lc(location)) companyForLoc = comp;
  });
  if (!companyForLoc) throw new Error(`No company found for location "${location}" in Locations sheet`);
  // Forward to the strict triple writer
  return await setAssetTypeColorForCompanyLocation(assetType, companyForLoc, location, color);
}

async function upsertCompany(name, active = true, description = '', email = '') {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Companies');
  const tgt = lc(name);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = active ? 'TRUE' : '';
      row.getCell(3).value = normStr(description);
      row.getCell(4).value = normStr(email);
      found = true;
    }
  });
  if (!found) ws.addRow([normStr(name), active ? 'TRUE' : '', normStr(description), normStr(email)]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function upsertLocation(location, company) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'Locations');
  const tgtLoc = lc(location), tgtComp = lc(company);
  let exists = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    if (lc(row.getCell(1)?.text) === tgtLoc && lc(row.getCell(2)?.text) === tgtComp) exists = true;
  });
  if (!exists) ws.addRow([normStr(location), normStr(company)]); // link column (3) optional on insert
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  // create the location workbook if missing
  const companyDir = getCompanyDir(company);
  ensureDir(companyDir);
  const locPath = getLocationFilePath(company, location);
  if (!fs.existsSync(locPath)) {
    const nb = new ExcelJS.Workbook();
    await nb.xlsx.writeFile(locPath);
  }
  return { success: true };
}

async function upsertAssetType(assetType, company, location) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  
  const tgtAt = lc(assetType);
  const tgtLoc = lc(location || '');
  const tgtCo = lc(company || '');  let match = null, blank = null;
  
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const co  = normStr(row.getCell(3)?.text);
    if (at === tgtAt && loc === tgtLoc && lc(co) === tgtCo) match = row;
    if (at === tgtAt && !normStr(row.getCell(2)?.text) && !normStr(row.getCell(3)?.text)) blank = row;
  });
  if (match) return { success:true, added:false };
  if (blank) {
    blank.getCell(2).value = normStr(location || '');
    blank.getCell(3).value = normStr(company);
    if (!normStr(blank.getCell(4)?.text)) blank.getCell(4).value = randHexColor();
    await wb.xlsx.writeFile(LOOKUPS_PATH);
    return { success:true, added:true };
  }
  ws.addRow([normStr(assetType), normStr(location || ''), normStr(company), randHexColor()]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true, added:true };
}

// ─── Base64 helpers ───────────────────────────────────────────────────────
async function listSheets(b64) {
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheets = (wb.worksheets || []).map(ws => ws?.name || '').filter(Boolean);
  return { success: true, sheets };
}

function sheetToObjects(ws) {
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || ws.columnCount || headerRow.cellCount || 0;
  const lastRow = ws.actualRowCount || ws.rowCount || 1;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) {
    headers.push(String(headerRow.getCell(c)?.text ?? '').trim());
  }
  const out = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1; c <= maxCol; c++) {
      const key = headers[c - 1]; if (!key) continue;
      const val = row.getCell(c)?.text ?? '';
      if (val !== '') has = true;
      obj[key] = val;
    }
    if (has) out.push(obj);
  }
  return out;
}

async function parseRows(b64) {
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { success:false, message:'No sheets found.', rows: [] };
  const rows = sheetToObjectsOneRow(ws);
  return { success:true, rows };
}

// Helpers for headers
function takeText(cell) { return String(cell?.text ?? '').trim(); }
function sheetToObjectsOneRow(ws) {
  const headerRow = ws.getRow(1);
  const maxCol = ws.actualColumnCount || ws.columnCount || headerRow.cellCount || 0;
  const lastRow = ws.actualRowCount || ws.rowCount || 1;
  const headers = [];
  for (let c = 1; c <= maxCol; c++) headers.push(takeText(headerRow.getCell(c)));
  const out = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1; c <= maxCol; c++) {
      const key = headers[c - 1]; if (!key) continue;
      const val = takeText(row.getCell(c));
      if (val !== '') has = true;
      obj[key] = val;
    }
    if (has) out.push(obj);
  }
  return out;
}

// Decide if a string labels "General Information" (variants: case/underscore/hyphen/short)
function isGeneralHeaderText(t) {
  const s = String(t || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return s === 'general' || s === 'general info' || s === 'general information';
}

function sheetTwoRowMeta(ws) {
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const maxCol = Math.max(
    ws.actualColumnCount || 0,
    row1.actualCellCount || row1.cellCount || 0,
    row2.actualCellCount || row2.cellCount || 0
  );
  const sections = [], fields = [], keys = [];
  for (let c = 1; c <= maxCol; c++) {
    const sec = takeText(row1.getCell(c));
    const fld = takeText(row2.getCell(c));
    if (!sec && !fld) continue; // ignore empty column
    sections.push(sec);
    fields.push(fld);
    // we store both composite and plain so callers can find by field name alone
    keys.push(sec ? `${sec} – ${fld}` : fld);
  }
  return { sections, fields, keys, maxCol };
}

function sheetToObjectsTwoRow(ws) {
  const { sections, fields, keys, maxCol } = sheetTwoRowMeta(ws);
  const lastRow = ws.actualRowCount || ws.rowCount || 2;
  const out = [];
  for (let r = 3; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const obj = {}; let has = false;
    for (let c = 1, k = 0; c <= maxCol; c++) {
      const sec = takeText(ws.getRow(1).getCell(c));
      const fld = takeText(ws.getRow(2).getCell(c));
      if (!sec && !fld) continue;
      const v = takeText(row.getCell(c));
      if (v !== '') has = true;
      const composite = sec ? `${sec} – ${fld}` : fld;
      // Store under BOTH composite and plain field for easy lookups:
      if (fld) obj[fld] = v;
      obj[composite] = v;
    }
    if (has) out.push(obj);
  }
  return { rows: out, sections, fields };
}

// Parse a specific worksheet by name, preferring two-row headers.
async function parseRowsFromSheet(b64, sheetName) {
  const _ExcelJS = getExcel();
  const buf = Buffer.from(b64, 'base64');
  const wb  = new _ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets.find(w => w?.name === sheetName)
          || wb.worksheets.find(w => lc(w?.name) === lc(sheetName));
  if (!ws) return { success:false, message:`Sheet not found: ${sheetName}`, rows: [] };
  // Decide formatting using TOP-LEFT cell (authoritative per requirements)
  const topLeft = takeText(ws.getRow(1)?.getCell(1));
  const row2HasAny = (ws.getRow(2)?.actualCellCount || 0) > 0;
  const looksGeneral = isGeneralHeaderText(topLeft);

  // If A1 is a General* variant AND row2 has data => treat as two-row "normal" format
  if (looksGeneral && row2HasAny) {
    const { rows, sections, fields } = sheetToObjectsTwoRow(ws);
    return { success:true, rows, sections, headers: fields };
  } else {
    const rows = sheetToObjectsOneRow(ws);
    const headerRow = ws.getRow(1);
    const fields = [];
    const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
    for (let c = 1; c <= maxCol; c++) fields.push(takeText(headerRow.getCell(c)));
    // "No sections" situation → sections empty here; synthesis happens in writeLocationRows
    const sections = fields.map(() => '');
    return { success:true, rows, sections, headers: fields };
  }
}

// Write rows preserving TWO-ROW headers (sections + fields)
async function writeLocationRows(company, location, sheetName, sections, headers, rows) {
  if (!company) throw new Error('Company is required');
  if (!location) throw new Error('Location is required');
  if (!Array.isArray(headers) || !headers.length) throw new Error('Headers are required');
  if (!Array.isArray(sections) || sections.length !== headers.length)
    throw new Error('Sections must align with headers');
  const _ExcelJS = getExcel();
  await ensureLookupsReady(); // guarantees DATA_DIR etc.

  const companyDir = getCompanyDir(company);
  ensureDir(companyDir);
  const locPath = getLocationFilePath(company, location);
  const wb = new _ExcelJS.Workbook();
  if (fs.existsSync(locPath)) {
    await wb.xlsx.readFile(locPath);
  }
  let ws = getSheet(wb, sheetName) || wb.getWorksheet(sheetName);
  if (!ws) {
    ws = wb.addWorksheet(sheetName || 'Data');
    ws.addRow(sections);
    ws.addRow(headers);
  }

  // Build the existing two-row header, if present
  let curSecs = [], curFlds = [];
  if (ws.rowCount >= 2) {
    const r1 = ws.getRow(1), r2 = ws.getRow(2);
    const maxCol = Math.max(r1.actualCellCount || r1.cellCount || 0,
                            r2.actualCellCount || r2.cellCount || 0,
                            headers.length);
    for (let c = 1; c <= maxCol; c++) {
      curSecs.push(takeText(r1.getCell(c)));
      curFlds.push(takeText(r2.getCell(c)));
    }
  }
  if (!curFlds.some(Boolean)) { curSecs = sections.slice(); curFlds = headers.slice(); }

  // ── Synthesize sections for “unsectioned” sheets per spec ────────────────
  // If the parsed sheet had no meaningful section headers, create:
  //   - "General Information" for the 7 core fields (see giFields)
  //   - "Extra Information" for everything else
  const giFields = ['Station ID','Category','Station Name','Province','Latitude','Longitude','Status'];
  const isUnsectioned = !sections?.some(s => String(s || '').trim()) || (curSecs.every(s => !String(s || '').trim()));
  if (isUnsectioned && Array.isArray(headers) && headers.length) {
    curSecs = headers.map(h => {
      const l = String(h || '').trim().toLowerCase();
      const isGI =
        l === 'station id' || l === 'stationid' || l === 'id' ||
        l === 'category'   || l === 'asset type' || l === 'assettype' ||
        l === 'site name'  || l === 'station name' || l === 'name' ||
        l === 'province'   || l === 'location' || l === 'state' || l === 'region' ||
        l === 'latitude'   || l === 'lat'  || l === 'y' ||
        l === 'longitude'  || l === 'long' || l === 'lng' || l === 'lon' || l === 'x' ||
        l === 'status';
      return isGI ? 'General Information' : 'Extra Information';
    });
    curFlds = headers.slice();
  }  

  // Normalize incoming pairs first:
  //  - Coerce {Asset Type|Type|Category} → "General Information" / "Category"
  //  - Do NOT treat "Structure Type" as Category
  const normPairs = sections.map((s, i) => {
    const sec = String(s || '').trim();
    const fld = String(headers[i] || '').trim();
    const fl = fld.toLowerCase();
    if (fl === 'asset type' || fl === 'type' || fl === 'category') {
      return { sec: 'General Information', fld: 'Category' };
    }
    // Leave "Structure Type" untouched wherever it came from
    return { sec, fld };
  });

  // Union existing header pairs with normalized incoming pairs (preserve existing order)
  const pairKey = (s, h) => `${s}|||${h}`;
  const have = new Set(curFlds.map((h, i) => pairKey(curSecs[i], h)));
  normPairs.forEach(({sec, fld}) => {
    const k = pairKey(sec, fld);
    if (!have.has(k)) {
      curSecs.push(sec); curFlds.push(fld); have.add(k);
    }
  });

  // Ensure the 7 GI anchors ALWAYS exist (even if missing from the source),
  // so the main app can always show them; missing values stay blank.
  for (const must of giFields) {
    const k = pairKey('General Information', must);
    if (!have.has(k)) {
      curSecs.unshift('General Information');
      curFlds.unshift(must);
      have.add(k);
    }
  }

  // ── Reorder "General Information" anchors only (do not move Structure Type) ─
  // Goal: ensure "Category" appears under "General Information" between
  // "Station ID" and "Station Name"/"Site Name" in all newly written sheets.
  (function enforceGIOrder() {
    const GI = 'General Information';
    const lc = (s) => String(s || '').trim().toLowerCase();
    const isId   = (f) => ['station id','stationid','id'].includes(lc(f));
    // Category anchor must be *exactly* Category (or normalized to it), not Structure Type
    const isCat  = (f) => ['category'].includes(lc(f));
    const isName = (f) => ['site name','station name','name'].includes(lc(f));

    // Coerce GI section on key fields and build pair list
    const pairs = curFlds.map((fld, i) => {
      let sec = curSecs[i];
      if (isId(fld) || isCat(fld) || isName(fld)) sec = GI;
      return { sec, fld, i };
    });

    // Desired GI ordering: [ID, Category, Name], preserving original labels
    const idIdx   = pairs.findIndex(p => isId(p.fld));
    const catIdx  = pairs.findIndex(p => isCat(p.fld));
    const nameIdx = pairs.findIndex(p => isName(p.fld));

    // If none of the GI anchors exist, nothing to do
    if (idIdx === -1 && catIdx === -1 && nameIdx === -1) return;

    const giOthers = [];
    const nonGI    = [];
    pairs.forEach((p, idx) => {
      if (idx === idIdx || idx === catIdx || idx === nameIdx) return;
      if (lc(p.sec) === lc(GI)) giOthers.push(p);
      else nonGI.push(p);
    });

    const ordered = [];
    if (idIdx   !== -1) ordered.push({ sec: GI, fld: pairs[idIdx].fld });
    if (catIdx  !== -1) ordered.push({ sec: GI, fld: pairs[catIdx].fld });
    if (nameIdx !== -1) ordered.push({ sec: GI, fld: pairs[nameIdx].fld });
    // keep any other GI fields in original relative order
    ordered.push(...giOthers);
    // then all non-GI fields in original relative order
    ordered.push(...nonGI);

    curSecs = ordered.map(p => p.sec);
    curFlds = ordered.map(p => p.fld);
  })();

  // Normalize and de-duplicate synonyms (e.g., Asset Type/Type → Category)
  (function normalizeAndDedupPairs() {
    const pairs = [];
    const seen = new Set();
    for (let i = 0; i < curFlds.length; i++) {
      const { sec, fld } = normalizeHeaderPair(curSecs[i], curFlds[i]);
      const key = `${sec.toLowerCase()}|||${fld.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ sec, fld });
      }
    }
    curSecs = pairs.map(p => p.sec);
    curFlds = pairs.map(p => p.fld);
  })();

  // Final safety: no blank sections; default by field type
  curSecs = curSecs.map((s, i) => (String(s || '').trim() ? s : giSectionForFieldName(curFlds[i])));

  // Rewrite header rows to final union
  ws.getRow(1).values = [ , ...curSecs ];
  ws.getRow(2).values = [ , ...curFlds ];

  // Append rows mapping object keys -> [composite or plain] header positions
  // Also feed Category from Asset Type/Type if the source used those names
  const compositeKeys = curFlds.map((h, i) => (curSecs[i] ? `${curSecs[i]} – ${h}` : h));
  for (const obj of rows) {
    // Lightweight normalization per row (do not pull from "Structure Type")
    const rowObj = { ...obj };
    const catPlain = rowObj['Category'] ?? rowObj['category'];
    const catGI    = rowObj['General Information – Category'];
    const at1      = rowObj['Asset Type'] ?? rowObj['asset type'];
    const atGI     = rowObj['General Information – Asset Type'];
    const type1    = rowObj['Type'] ?? rowObj['type'];
    const typeGI   = rowObj['General Information – Type'];
    if (!catPlain && !catGI) {
      const v = atGI ?? at1 ?? typeGI ?? type1;
      if (v !== undefined) {
        rowObj['Category'] = v;
        rowObj['General Information – Category'] = v;
      }
    }

    // If Province missing, fall back to the workbook file's location tag
    const provPlain = rowObj['Province'] ?? rowObj['province'];
    const provGI    = rowObj['General Information – Province'];
    if ((provPlain === undefined || String(provPlain).trim() === '') &&
        (provGI   === undefined || String(provGI).trim()   === '')) {
      if (location) {
        rowObj['Province'] = location;
        rowObj['General Information – Province'] = location;
      }
    }

    const arr = compositeKeys.map((k, i) => {
      const plain = curFlds[i];
      return (rowObj?.[k] ?? rowObj?.[plain] ?? '');
    });
    ws.addRow(arr);
  }

  // After writing the main data, ensure Funding Type Override Settings section exists
  await ensureFundingSection(wb, ws);

  await wb.xlsx.writeFile(locPath);
  return { success:true, file: locPath, sheet: ws.name, added: rows.length };
}

// New function to ensure funding section exists
async function ensureFundingSection(workbook, worksheet) {
  // Find the rightmost column
  const maxCol = worksheet.actualColumnCount || 0;
  
  // Check if funding section already exists
  const row1 = worksheet.getRow(1);
  let fundingExists = false;
  
  for (let c = 1; c <= maxCol; c++) {
    const sectionName = takeText(row1.getCell(c));
    if (sectionName === 'Funding Type Override Settings') {
      fundingExists = true;
      break;
    }
  }
  
  if (!fundingExists) {
    // Add the funding section as the rightmost columns
    const startCol = maxCol + 1;
    
    // Add section headers
    row1.getCell(startCol).value = 'Funding Type Override Settings';
    row1.getCell(startCol + 1).value = 'Funding Type Override Settings';
    row1.getCell(startCol + 2).value = 'Funding Type Override Settings';
    
    // Add field headers
    const row2 = worksheet.getRow(2);
    row2.getCell(startCol).value = 'O&M';
    row2.getCell(startCol + 1).value = 'Capital';
    row2.getCell(startCol + 2).value = 'Decommission';
    
    // Initialize with blank values for all data rows
    const lastRow = worksheet.actualRowCount || worksheet.rowCount || 2;
    for (let r = 3; r <= lastRow; r++) {
      const dataRow = worksheet.getRow(r);
      dataRow.getCell(startCol).value = '';
      dataRow.getCell(startCol + 1).value = '';
      dataRow.getCell(startCol + 2).value = '';
    }
  }
}

// Add functions to read/write funding settings
async function getFundingSettings(company, location) {
  const filePath = getLocationFilePath(company, location);
  if (!fs.existsSync(filePath)) {
    return { om: '', capital: '', decommission: '' };
  }
  
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  
  // Get the first worksheet (or you could search for a specific sheet)
  const ws = wb.worksheets[0];
  if (!ws) return { om: '', capital: '', decommission: '' };
  
  // Find the funding columns
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);
  const maxCol = ws.actualColumnCount || 0;
  
  let omCol = -1, capitalCol = -1, decommissionCol = -1;
  
  for (let c = 1; c <= maxCol; c++) {
    const section = takeText(row1.getCell(c));
    const field = takeText(row2.getCell(c));
    
    if (section === 'Funding Type Override Settings') {
      if (field === 'O&M') omCol = c;
      else if (field === 'Capital') capitalCol = c;
      else if (field === 'Decommission') decommissionCol = c;
    }
  }
  
  // Read the first data row's values (row 3)
  const values = {
    om: omCol > 0 ? takeText(ws.getRow(3).getCell(omCol)) : '',
    capital: capitalCol > 0 ? takeText(ws.getRow(3).getCell(capitalCol)) : '',
    decommission: decommissionCol > 0 ? takeText(ws.getRow(3).getCell(decommissionCol)) : ''
  };
  
  return values;
}

async function saveFundingSettings(company, location, settings) {
  const filePath = getLocationFilePath(company, location);
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();

  if (!fs.existsSync(filePath)) {
    // If you really want to create new books here, also add a default sheet,
    // otherwise there's nothing to write into:
    const tmp = wb.addWorksheet('Data');
    await wb.xlsx.writeFile(filePath);
  }

  await wb.xlsx.readFile(filePath);

  let touchedSheets = 0;

  for (const ws of wb.worksheets) {
    if (!ws || ws.rowCount < 2) continue;

    // Make sure the Funding section exists on this sheet
    await ensureFundingSection(wb, ws);

    // Find columns each time (post-ensure)
    const row1 = ws.getRow(1);
    const row2 = ws.getRow(2);
    const maxCol = Math.max(
      ws.columnCount || 0,
      row1.actualCellCount || row1.cellCount || 0,
      row2.actualCellCount || row2.cellCount || 0
    );

    let omCol = -1, capitalCol = -1, decommissionCol = -1;
    for (let c = 1; c <= maxCol; c++) {
      const section = takeText(row1.getCell(c));
      const field   = takeText(row2.getCell(c));
      if (section === 'Funding Type Override Settings') {
        if (field === 'O&M') omCol = c;
        else if (field === 'Capital') capitalCol = c;
        else if (field === 'Decommission') decommissionCol = c;
      }
    }

    if (omCol < 0 && capitalCol < 0 && decommissionCol < 0) continue;

    // Locate Funding Split column (per-station) and global tokens
    const splitCol = findColumnByField(ws, 'Funding Split');
    const allowedTokens = await getGlobalFundingTokens();

    // Update all data rows on this sheet
    const lastRow = ws.actualRowCount || ws.rowCount || 2;
    for (let r = 3; r <= lastRow; r++) {
      const dataRow = ws.getRow(r);
      // Parse this row's funding split tokens
      const splitVal = splitCol > 0 ? takeText(dataRow.getCell(splitCol)) : '';
      const tokens = parseFundingSplitTokens(splitVal);

      // Helper to compute value to write (validate or auto-populate)
      const decide = (incoming) => {
        const v = String(incoming ?? '').trim();
        if (!v) return formatEqualSplitForTokens(tokens);
        const ok = validateFundingOverrideString(v, allowedTokens);
        if (!ok.ok) throw new Error(`Invalid funding override "${v}" for split "${splitVal}": ${ok.reason}`);
        return v;
      };

      if ('om' in settings && omCol > 0) {
        dataRow.getCell(omCol).value = decide(settings.om);
      }
      if ('capital' in settings && capitalCol > 0) {
        dataRow.getCell(capitalCol).value = decide(settings.capital);
      }
      if ('decommission' in settings && decommissionCol > 0) {
        dataRow.getCell(decommissionCol).value = decide(settings.decommission);
      }
    }

    touchedSheets++;
  }

  await wb.xlsx.writeFile(filePath);
  return { success: touchedSheets > 0, updatedSheets: touchedSheets };
}

async function saveFundingSettingsForAssetType(company, location, assetType, settings) {
  const filePath = getLocationFilePath(company, location);
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  
  if (!fs.existsSync(filePath)) {
    // Create new workbook if it doesn't exist
    await wb.xlsx.writeFile(filePath);
  }
  
  await wb.xlsx.readFile(filePath);
  
  // Iterate worksheets; match rows by Category field rather than brittle sheet-name parsing
  for (const ws of wb.worksheets) {
    if (!ws || ws.rowCount < 2) continue;
    // Do not filter by sheet name; some sheets include suffixes like "Repairs".
    // We'll rely on the Category/Asset Type column to target the correct rows.
    
    // Ensure funding section exists
    await ensureFundingSection(wb, ws);
    
    // Find the funding columns
    const row1 = ws.getRow(1);
    const row2 = ws.getRow(2);
    const maxCol = ws.actualColumnCount || 0;
    
    let omCol = -1, capitalCol = -1, decommissionCol = -1;
    
    for (let c = 1; c <= maxCol; c++) {
      const section = takeText(row1.getCell(c));
      const field = takeText(row2.getCell(c));
      
      if (section === 'Funding Type Override Settings') {
        if (field === 'O&M') omCol = c;
        else if (field === 'Capital') capitalCol = c;
        else if (field === 'Decommission') decommissionCol = c;
      }
    }
    
    // Find Category/Asset Type column to verify rows
    let categoryCol = -1;
    for (let c = 1; c <= maxCol; c++) {
      const field = takeText(row2.getCell(c)).toLowerCase();
      if (field === 'category' || field === 'asset type' || field === 'type') {
        categoryCol = c;
        break;
      }
    }
    
    // Locate per-row Funding Split column and global tokens
    const splitCol = findColumnByField(ws, 'Funding Split');
    const allowedTokens = await getGlobalFundingTokens();

    // Update rows that match the asset type
    const lastRow = ws.actualRowCount || ws.rowCount || 2;
    for (let r = 3; r <= lastRow; r++) {
      const dataRow = ws.getRow(r);
      
      // Check if this row is for our asset type
      if (categoryCol > 0) {
        const rowAssetType = takeText(dataRow.getCell(categoryCol));
        if (rowAssetType.toLowerCase() !== assetType.toLowerCase()) continue;
      }
      
      // Derive tokens for this row
      const splitVal = splitCol > 0 ? takeText(dataRow.getCell(splitCol)) : '';
      const tokens = parseFundingSplitTokens(splitVal);
      const decide = (incoming) => {
        const v = String(incoming ?? '').trim();
        if (!v) return formatEqualSplitForTokens(tokens);
        const ok = validateFundingOverrideString(v, allowedTokens);
        if (!ok.ok) throw new Error(`Invalid funding override "${v}" for split "${splitVal}": ${ok.reason}`);
        return v;
      };
      // Update funding values
      if (omCol > 0) dataRow.getCell(omCol).value = decide(settings.om);
      if (capitalCol > 0) dataRow.getCell(capitalCol).value = decide(settings.capital);
      if (decommissionCol > 0) dataRow.getCell(decommissionCol).value = decide(settings.decommission);
    }
  }
  
  await wb.xlsx.writeFile(filePath);
  return { success: true };
}

// Add function to get all funding settings for display
async function getAllFundingSettings(company) {
  const result = new Map();
  const companyDir = getCompanyDir(company);
  
  if (!fs.existsSync(companyDir)) return result;
  
  const locationFiles = fs.readdirSync(companyDir)
    .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
  
  for (const fileName of locationFiles) {
    const location = path.basename(fileName, '.xlsx');
    const filePath = path.join(companyDir, fileName);
    
    const _ExcelJS = getExcel();
    const wb = new _ExcelJS.Workbook();
    
    try {
      await wb.xlsx.readFile(filePath);
    } catch (e) {
      continue;
    }
    
    // Check each worksheet
    for (const ws of wb.worksheets) {
      if (!ws || ws.rowCount < 3) continue;
      
      // Find funding columns
      const row1 = ws.getRow(1);
      const row2 = ws.getRow(2);
      const maxCol = ws.actualColumnCount || 0;
      
      let omCol = -1, capitalCol = -1, decommissionCol = -1;
      
      for (let c = 1; c <= maxCol; c++) {
        const section = takeText(row1.getCell(c));
        const field = takeText(row2.getCell(c));
        
        if (section === 'Funding Type Override Settings') {
          if (field === 'O&M') omCol = c;
          else if (field === 'Capital') capitalCol = c;
          else if (field === 'Decommission') decommissionCol = c;
        }
      }
      
      if (omCol > 0 || capitalCol > 0 || decommissionCol > 0) {
        // Get values from first data row (they should all be the same)
        const dataRow = ws.getRow(3);
        const om = omCol > 0 ? takeText(dataRow.getCell(omCol)) : '';
        const capital = capitalCol > 0 ? takeText(dataRow.getCell(capitalCol)) : '';
        const decommission = decommissionCol > 0 ? takeText(dataRow.getCell(decommissionCol)) : '';
        
        // Determine asset type from sheet name
        const sheetName = ws.name;
        const sheetParts = sheetName.split(' ');
        let assetType = '';
        if (sheetParts.length >= 2) {
          assetType = sheetParts.slice(0, -1).join(' ');
        }
        
        const key = `${company}|${location}${assetType ? '|' + assetType : ''}`;
        result.set(key, { om, capital, decommission });
      }
    }
  }
  
  return Object.fromEntries(result);;
}

// Scan all company/location files and auto-populate blank Funding Type Override Settings
// values from each station's Funding Split. Also enforces header names for the section.
async function normalizeFundingOverrides() {
  ensureDir(COMPANIES_DIR);
  const _ExcelJS = getExcel();
  let filesTouched = 0;
  const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  for (const company of companies) {
    const dir = getCompanyDir(company);
    if (!fs.existsSync(dir)) continue;
    const xlsx = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    for (const file of xlsx) {
      const fp = path.join(dir, file);
      const wb = new _ExcelJS.Workbook();
      try { await wb.xlsx.readFile(fp); } catch (_) { continue; }
      let anyChange = false;
      for (const ws of wb.worksheets) {
        if (!ws || ws.rowCount < 2) continue;
        // Ensure two-row header
        ensureTwoRowHeader(ws);
        // Ensure funding section exists
        await ensureFundingSection(wb, ws);
        const row1 = ws.getRow(1), row2 = ws.getRow(2);
        // Re-detect funding columns
        let omCol=-1, capitalCol=-1, decommissionCol=-1;
        const maxCol = ws.actualColumnCount || Math.max(row1.cellCount||0,row2.cellCount||0);
        for (let c=1;c<=maxCol;c++){
          const section = takeText(row1.getCell(c));
          const field = takeText(row2.getCell(c));
          if (section === 'Funding Type Override Settings') {
            if (field === 'O&M') omCol = c;
            else if (field === 'Capital') capitalCol = c;
            else if (field === 'Decommission') decommissionCol = c;
          }
        }
        // Enforce headers integrity
        if (omCol>0) { row1.getCell(omCol).value = 'Funding Type Override Settings'; row2.getCell(omCol).value = 'O&M'; }
        if (capitalCol>0) { row1.getCell(capitalCol).value = 'Funding Type Override Settings'; row2.getCell(capitalCol).value = 'Capital'; }
        if (decommissionCol>0) { row1.getCell(decommissionCol).value = 'Funding Type Override Settings'; row2.getCell(decommissionCol).value = 'Decommission'; }

        const splitCol = findColumnByField(ws, 'Funding Split');
        const lastRow = ws.actualRowCount || ws.rowCount || 2;
        for (let r=3;r<=lastRow;r++){
          const dataRow = ws.getRow(r);
          const splitVal = splitCol > 0 ? takeText(dataRow.getCell(splitCol)) : '';
          const tokens = parseFundingSplitTokens(splitVal);
          if (!tokens.length) continue;
          const def = formatEqualSplitForTokens(tokens);
          if (omCol>0 && !String(takeText(dataRow.getCell(omCol))).trim()) { dataRow.getCell(omCol).value = def; anyChange = true; }
          if (capitalCol>0 && !String(takeText(dataRow.getCell(capitalCol))).trim()) { dataRow.getCell(capitalCol).value = def; anyChange = true; }
          if (decommissionCol>0 && !String(takeText(dataRow.getCell(decommissionCol))).trim()) { dataRow.getCell(decommissionCol).value = def; anyChange = true; }
        }
      }
      if (anyChange) { await wb.xlsx.writeFile(fp); filesTouched++; }
    }
  }
  return { success: true, filesTouched };
}


// Utility: pull a field from an object regardless of section prefix
function pick(obj, fieldName) {
  if (!obj) return '';
  // Exact key first
  if (obj[fieldName] !== undefined) return obj[fieldName];
  // Accept both en dash and hyphen composite headers, case-insensitive.
  const want = String(fieldName || '').trim().toLowerCase();
  if (!want) return '';
  const sepVariants = [' – ', ' - ', '—', ' — ', '–', '-'];
  for (const k of Object.keys(obj)) {
    const kl = String(k).toLowerCase().trim();
    if (kl === want) return obj[k];
    for (const sep of sepVariants) {
      if (kl.endsWith(sep + want)) return obj[k];
    }
  }
  return '';
}

// Utility: first non-empty match from a list of candidate field names
function pickOne(obj, candidates) {
  for (const name of candidates) {
    const v = pick(obj, name);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

// Recursively list .xlsx files under a root, skipping Excel lock files (~$...)
function listExcelFiles(root) {
  const out = [];
  try {
    if (!fs.existsSync(root)) return out;
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(root, ent.name);
      if (ent.isDirectory()) {
        out.push(...listExcelFiles(p));
      } else if (
        ent.isFile() &&
        /\.xlsx$/i.test(ent.name) &&
        !ent.name.startsWith('~$')
      ) {
        out.push(p);
      }
    }
  } catch (_) {}
  return out;
}

// Utility: first non-empty match from a list of candidate field names
function pickOne(obj, candidates) {
  for (const name of candidates) {
    const v = pick(obj, name);
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

// Aggregate stations from all location files for map pins
async function readStationsAggregate() {
  await ensureLookupsReady();
  ensureDir(COMPANIES_DIR);
  const _ExcelJS = getExcel();
  const out = [];
  let totalFiles = 0, totalSheets = 0, totalRows = 0, totalValid = 0;
  // Traverse companies/*/
  const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  for (const companyName of companies) {
    const companyDir = getCompanyDir(companyName);
    if (!fs.existsSync(companyDir)) continue;
    
    const locationFiles = fs.readdirSync(companyDir)
      .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
      .map(f => path.join(companyDir, f));
    
    for (const fn of locationFiles) {
      totalFiles++;
      const full = fn; // already absolute
      // Normalize now so downstream exact matching is trivial
      const locationFile = String(path.basename(full, path.extname(full))).trim(); // "BC"
      const wb = new _ExcelJS.Workbook();
      try { await wb.xlsx.readFile(full); }
      catch (e) {
        console.error(`[readStationsAggregate] Failed to read ${full}:`, e.message);
        continue;
      }
      for (const ws of wb.worksheets) {
        if (!ws || ws.rowCount < 2) continue;
        if (ws.name && ws.name.toLowerCase().includes('repairs')) continue;
        const twoRow = (ws.getRow(2)?.actualCellCount || 0) > 0;
        let rows = [];
        if (twoRow) {
          rows = sheetToObjectsTwoRow(ws).rows;
        } else {
          rows = sheetToObjectsOneRow(ws);
        }
        totalSheets++;
        for (const r of rows) {
          totalRows++;
          const st = {
            station_id: pickOne(r, ['Station ID','StationID','ID']),
            asset_type: pickOne(r, ['Category','Asset Type','Type']), // do NOT conflate "Structure Type"
            name:       pickOne(r, ['Site Name','Name','Station Name']),
            province:   pickOne(r, ['Province','Location','State','Region','General Information - Province','General Information – Province']),
            lat:        pickOne(r, ['Latitude','Lat','Y']),
            lon:        pickOne(r, ['Longitude','Long','Lng','X']),
            status:     pickOne(r, ['Status']),
          };
          const latOk = String(st.lat).trim() !== '' && !isNaN(Number(st.lat));
          const lonOk = String(st.lon).trim() !== '' && !isNaN(Number(st.lon));
          if (latOk && lonOk) totalValid++;
          // attach all original fields too, plus the file-derived location tag and company
          out.push({ ...r, ...st, location_file: locationFile, company: companyName });
        }
      }
    }
  }
  console.log(`[readStationsAggregate] Stats: ${totalFiles} files, ${totalSheets} sheets, ${totalRows} rows, ${totalValid} valid stations`);
  return { success:true, rows: out };
}

// Set color scoped to company+location (stored as "<COMPANY>@@<LOCATION>")
async function setAssetTypeColorForCompanyLocation(assetType, company, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, 'AssetTypes');
  if (!ws) throw new Error('Missing AssetTypes sheet');
  const tgtAt = lc(assetType);
  let updated = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const at  = lc(row.getCell(1)?.text);
    const loc = lc(normStr(row.getCell(2)?.text));
    const co  = lc(normStr(row.getCell(3)?.text));
    if (at === tgtAt && loc === lc(location) && co === lc(company)) { row.getCell(4).value = color; updated = true; }
  });
  if (!updated) ws.addRow([normStr(assetType), normStr(location), normStr(company), color]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

async function updateStationInLocationFile(company, locationName, stationId, updatedRowData, schema = null) {
  try {
    await ensureLookupsReady();
    const companyDir = getCompanyDir(company);
    ensureDir(companyDir);
    
    // 1. Locate the Source
    const locPath = getLocationFilePath(company, locationName);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }

    const _ExcelJS = getExcel();
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);

    let sourceSheet = null;
    let sourceRowIndex = -1;
    let sourceRowObj = null; // Snapshot of data before update
    let twoRowHeader = false;

    // Search sheets for the station
    for (const ws of wb.worksheets) {
      if (!ws || ws.rowCount < 2) continue;

      const isTwoRow = (ws.getRow(2)?.actualCellCount || 0) > 0;
      let headerRowNum = isTwoRow ? 2 : 1;
      const headerRow = ws.getRow(headerRowNum);
      const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;

      let sidCol = -1;
      for (let c = 1; c <= maxCol; c++) {
        const txt = takeText(headerRow.getCell(c)).toLowerCase();
        if (txt === 'station id' || txt === 'stationid' || txt === 'id') {
          sidCol = c; break;
        }
      }
      if (sidCol === -1) continue;

      const lastRow = ws.actualRowCount || ws.rowCount || headerRowNum;
      for (let r = headerRowNum + 1; r <= lastRow; r++) {
        const val = takeText(ws.getRow(r).getCell(sidCol));
        if (String(val).trim() === String(stationId).trim()) {
          sourceSheet = ws;
          sourceRowIndex = r;
          twoRowHeader = isTwoRow;
          // Capture existing data to allow merging
          if (isTwoRow) {
             sourceRowObj = sheetToObjectsTwoRow(ws).rows.find(row => 
               String(row['Station ID'] || row['station_id']).trim() === String(stationId).trim()
             );
          } else {
             sourceRowObj = sheetToObjectsOneRow(ws).find(row => 
               String(row['Station ID'] || row['station_id']).trim() === String(stationId).trim()
             );
          }
          break;
        }
      }
      if (sourceSheet) break;
    }

    if (!sourceSheet || !sourceRowObj) {
      return { success: false, message: `Station ${stationId} not found in ${locationName}.xlsx` };
    }

    // 2. Prepare Merged Data (Existing + Updates)
    const mergedData = { ...sourceRowObj, ...updatedRowData };

    // Helper to find value by possible keys
    const getVal = (keys) => {
      for (const k of keys) {
        if (mergedData[k] !== undefined && mergedData[k] !== null && String(mergedData[k]).trim() !== '') return String(mergedData[k]).trim();
      }
      return '';
    };

    // 3. Determine Targets
    // Check "General Information – Province" OR "Province" OR fallback to current file name
    let newLoc = getVal(['General Information – Province', 'Province', 'Location']);
    if (!newLoc) newLoc = locationName; // Fallback to current if cleared/missing

    // Check "General Information – Category" OR "Category" OR "Asset Type" OR fallback to existing
    let newAsset = getVal(['General Information – Category', 'Category', 'Asset Type', 'Type']);
    // Fallback logic for Asset Type if missing in row:
    if (!newAsset) {
      // Try to parse from sheet name "AssetType Location"
      const sheetParts = sourceSheet.name.split(' ');
      if (sheetParts.length > 1) {
        newAsset = sheetParts.slice(0, -1).join(' ');
      } else {
        newAsset = sourceSheet.name;
      }
    }

    // Normalize for comparison
    const cleanLoc = (s) => String(s).trim().toLowerCase();
    const cleanAt  = (s) => String(s).trim().toLowerCase();

    const isMove = cleanLoc(newLoc) !== cleanLoc(locationName) || cleanAt(newAsset) !== cleanAt(newAssetFromSheetName(sourceSheet.name, locationName));

    function newAssetFromSheetName(sName, lName) {
       // Helper to extract asset from "Cableway BC"
       const l = lName.toLowerCase();
       const s = sName.toLowerCase();
       if (s.endsWith(' ' + l)) return sName.substring(0, sName.length - lName.length - 1);
       return sName;
    }

    if (isMove) {
      console.log(`[ExcelWorker] Moving station ${stationId} to ${newLoc} / ${newAsset}`);

      // A. Delete from OLD Sheet
      sourceSheet.spliceRows(sourceRowIndex, 1);
      await wb.xlsx.writeFile(locPath);

      // B. Ensure Headers/Sections for New Sheet
      // We reuse the headers from the Schema if provided, or build standard ones
      let targetHeaders = [];
      let targetSections = [];

      if (schema && schema.fields && schema.sections) {
        targetHeaders = schema.fields;
        targetSections = schema.sections;
      } else {
        // Fallback: Use keys from mergedData, prioritizing GI fields
        const giFields = ['Station ID', 'Category', 'Site Name', 'Province', 'Latitude', 'Longitude', 'Status'];
        const extraKeys = Object.keys(mergedData).filter(k => 
          !giFields.includes(k) && !k.includes(' – ') && k !== 'Station ID'
        );
        targetHeaders = [...giFields, ...extraKeys];
        targetSections = targetHeaders.map(h => giFields.includes(h) ? 'General Information' : 'Extra Information');
      }

      // C. Insert into NEW Location File (this handles file creation + sheet creation)
      // Force the company to stay the same
      await writeLocationRows(company, newLoc, newAsset, targetSections, targetHeaders, [mergedData]);

      // D. Update Lookups (create filters)
      await upsertLocation(newLoc, company);
      await upsertAssetType(newAsset, company, newLoc);

      return { success: true, moved: true };

    } else {
      // 4. In-Place Update
      const row = sourceSheet.getRow(sourceRowIndex);
      await updateStationRow(sourceSheet, row, sourceRowIndex, updatedRowData, twoRowHeader, schema);
      await wb.xlsx.writeFile(locPath);
      return { success: true, moved: false };
    }

  } catch (error) {
    console.error('[updateStationInLocationFile] failed:', error);
    return { success: false, message: String(error) };
  }
}

async function updateStationRow(worksheet, row, rowNumber, updatedData, twoRowHeader, schema = null) {
  // Get current header structure
  let headerRowNum = twoRowHeader ? 2 : 1;
  let sectionRowNum = twoRowHeader ? 1 : null;

  // If the sheet is 1-row header, upgrade to 2-row with synthesized sections
  if (!twoRowHeader) {
    ensureTwoRowHeader(worksheet);
    twoRowHeader = true;
    headerRowNum = 2;
    sectionRowNum = 1;
  }
  
  let headerRow = worksheet.getRow(headerRowNum);
  let sectionRow = sectionRowNum ? worksheet.getRow(sectionRowNum) : null;
  
  let maxCol = worksheet.actualColumnCount || headerRow.cellCount || 0;
  
  if (schema && schema.sections && schema.fields && schema.sections.length > 0) {
    
    // ═══════════════════════════════════════════════════════════════════
    // FIX: Proper deletion handling - Clear and rebuild with schema
    // ═══════════════════════════════════════════════════════════════════
    
    // Define field synonym mappings for GI fields
    const fieldSynonyms = {
      'station id': ['stationid', 'id', 'station id'],
      'category': ['asset type', 'type', 'category'],
      'site name': ['station name', 'name', 'site name'],
      'station name': ['site name', 'name', 'station name'],
      'province': ['location', 'state', 'region', 'province'],
      'latitude': ['lat', 'y', 'latitude'],
      'longitude': ['long', 'lng', 'lon', 'x', 'longitude'],
      'status': ['status']
    };
    
    // Helper to find a value in updatedData considering synonyms
    function findValueWithSynonyms(field, section) {
      const fieldLower = field.toLowerCase();
      const compositeKey = section ? `${section} – ${field}` : field;
      
      // Try exact match first
      let value = updatedData[compositeKey] || updatedData[field];
      if (value !== undefined) return value;
      
      // Try synonyms
      for (const [canonical, synonyms] of Object.entries(fieldSynonyms)) {
        if (synonyms.includes(fieldLower)) {
          for (const syn of synonyms) {
            const synComposite = section ? `${section} – ${syn}` : syn;
            const synCapitalized = syn.charAt(0).toUpperCase() + syn.slice(1);
            const synCompositeCapitalized = section ? `${section} – ${synCapitalized}` : synCapitalized;
            
            value = updatedData[synComposite] || updatedData[syn] || 
                    updatedData[synCompositeCapitalized] || updatedData[synCapitalized];
            if (value !== undefined) return value;
          }
          const canonicalCapitalized = canonical.split(' ').map(w => 
            w.charAt(0).toUpperCase() + w.slice(1)
          ).join(' ');
          const canonicalComposite = section ? `${section} – ${canonicalCapitalized}` : canonicalCapitalized;
          value = updatedData[canonicalComposite] || updatedData[canonicalCapitalized] ||
                  updatedData[canonical];
          if (value !== undefined) return value;
        }
      }
      
      return undefined;
    }
    
    // Identify GI columns
    const giFields = ['station id', 'stationid', 'id', 'category', 'site name', 
                      'station name', 'name', 'province', 'location', 'latitude', 
                      'lat', 'longitude', 'lon', 'status'];
    
    let lastGICol = 0;
    for (let c = 1; c <= maxCol; c++) {
      const section = sectionRow ? takeText(sectionRow.getCell(c)).toLowerCase() : '';
      const field = takeText(headerRow.getCell(c)).toLowerCase();
      
      if (section === 'general information' || giFields.includes(field)) {
        lastGICol = c;
      }
    }
    
    // Update GI fields from updatedData if they exist
    for (let c = 1; c <= lastGICol; c++) {
      const section = sectionRow ? takeText(sectionRow.getCell(c)) : '';
      const field = takeText(headerRow.getCell(c));
      if (!field) continue;
      
      const value = findValueWithSynonyms(field, section);
      if (value !== undefined) {
        row.getCell(c).value = value;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // FIX: Snapshot old post-GI data for ALL rows (not just current)
    // ═══════════════════════════════════════════════════════════════════
    
    const oldSecs = []; 
    const oldFlds = []; 
    const oldKeys = [];
    
    for (let c = lastGICol + 1; c <= maxCol; c++) {
      const s = sectionRow ? takeText(sectionRow.getCell(c)) : '';
      const f = takeText(headerRow.getCell(c));
      oldSecs.push(s);
      oldFlds.push(f);
      oldKeys.push(s ? `${s} – ${f}` : f);
    }
    
    function buildRowMap(r) {
      const m = new Map();
      const targetRow = worksheet.getRow(r);
      for (let i = 0; i < oldKeys.length; i++) {
        const key = (oldKeys[i] || '').toLowerCase();
        if (!key) continue;
        const val = targetRow.getCell(lastGICol + 1 + i).value;
        if (val !== undefined && val !== null && String(val) !== '') {
          m.set(key, val);
          const fldOnly = (oldFlds[i] || '').toLowerCase();
          if (fldOnly) m.set(fldOnly, val);
        }
      }
      return m;
    }
    
    // Build new structure arrays FIRST
    const newSections = [];
    const newFields = [];
    const newValues = [];
    
    for (let i = 0; i < schema.fields.length; i++) {
      const section = schema.sections[i];
      const field = schema.fields[i];
      
      // Skip GI fields - already handled
      if (section.toLowerCase() === 'general information') continue;
      
      // STRICT key matching - use ONLY composite key
      const compositeKey = `${section} – ${field}`.toLowerCase();
      
      // Get value: first from updatedData (exact match only), then from current row
      let value = updatedData[`${section} – ${field}`];
      if (value === undefined) {
        value = updatedData[field];
      }
      if (value === undefined) {
        // Build map of current row's values
        const currentMap = buildRowMap(rowNumber);
        value = currentMap.get(compositeKey) || '';
      }
      
      newSections.push(section);
      newFields.push(field);
      newValues.push(value);
    }

    // Clear everything AFTER GI (headers + current row)
    for (let c = lastGICol + 1; c <= maxCol; c++) {
      if (sectionRow) sectionRow.getCell(c).value = null;
      headerRow.getCell(c).value = null;
      row.getCell(c).value = null;
    }
    
    // Write new structure (headers + current row)
    for (let i = 0; i < newFields.length; i++) {
      const colIndex = lastGICol + 1 + i;
      if (sectionRow) sectionRow.getCell(colIndex).value = newSections[i];
      headerRow.getCell(colIndex).value = newFields[i];
      row.getCell(colIndex).value = newValues[i];
    }

    // ═══════════════════════════════════════════════════════════════════
    // FIX: Remap ALL data rows to new header order
    // ═══════════════════════════════════════════════════════════════════
    
    const dataStart = headerRowNum + 1;
    const lastRow   = worksheet.actualRowCount || worksheet.rowCount || headerRowNum;
    const newSpan   = newFields.length;
    const newMax    = lastGICol + newSpan;

    function clearAfterGi(targetRow) {
      for (let c = lastGICol + 1; c <= Math.max(maxCol, newMax); c++) {
        targetRow.getCell(c).value = null;
      }
    }

    for (let r = dataStart; r <= lastRow; r++) {
      // Skip the row we just updated
      if (r === rowNumber) continue;
      
      const targetRow = worksheet.getRow(r);
      const map = buildRowMap(r);
      
      clearAfterGi(targetRow);
      
      for (let i = 0; i < newFields.length; i++) {
        const sec = newSections[i] || '';
        const fld = newFields[i] || '';
        const composite = (sec ? `${sec} – ${fld}` : fld).toLowerCase();
        
        let v = map.get(composite);
        if (v === undefined) v = map.get(String(fld).toLowerCase());
        targetRow.getCell(lastGICol + 1 + i).value = v ?? '';
      }
    }
    
  } else {
    // No schema: fallback to old append-at-end behavior
    const columnMap = new Map();
    for (let c = 1; c <= maxCol; c++) {
      const section = sectionRow ? takeText(sectionRow.getCell(c)) : '';
      const field = takeText(headerRow.getCell(c));
      if (!field) continue;
      
      const compositeKey = section ? `${section} – ${field}` : field;
      columnMap.set(compositeKey.toLowerCase(), c);
      columnMap.set(field.toLowerCase(), c);

      const f = field.toLowerCase();
      if (['station name','site name','name'].includes(f)) {
        ['station name','site name','name'].forEach(k => columnMap.set(k, c));
      }
      if (['category','asset type','type'].includes(f)) {
        ['category','asset type','type'].forEach(k => columnMap.set(k, c));
      }
    }

    const newColumns = [];
    
    Object.entries(updatedData).forEach(([key, value]) => {
      const keyLower = key.toLowerCase();
      let columnIndex = columnMap.get(keyLower);
      
      if (columnIndex) {
        row.getCell(columnIndex).value = value || '';
      } else {
        newColumns.push({ key, value: value || '' });
      }
    });

    if (newColumns.length > 0) {
      const startCol = maxCol + 1;
      newColumns.forEach((newCol, index) => {
        const colIndex = startCol + index;
        let section = 'Extra Information';
        let field = newCol.key;
        
        if (newCol.key.includes(' – ')) {
          [section, field] = newCol.key.split(' – ', 2);
        }
        
        if (sectionRow) sectionRow.getCell(colIndex).value = section;
        headerRow.getCell(colIndex).value = field;
        row.getCell(colIndex).value = newCol.value;
      });
    }
  }
}

// Read all sheets from a location workbook
async function readLocationWorkbook(company, locationName) {
  try {
    const _ExcelJS = getExcel();
    const companyDir = getCompanyDir(company);
    const locPath = getLocationFilePath(company, locationName);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }
    
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);
    
    const sheets = wb.worksheets.map(ws => ws.name).filter(Boolean);
    
    return { success: true, sheets, workbook: wb };
  } catch (error) {
    console.error('[readLocationWorkbook] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Read data from a specific sheet in a location workbook
async function readSheetData(company, locationName, sheetName) {
  try {
    const _ExcelJS = getExcel();
    const companyDir = getCompanyDir(company);
    const locPath = getLocationFilePath(company, locationName);
    
    if (!fs.existsSync(locPath)) {
      return { success: false, message: `Location file not found: ${locationName}.xlsx` };
    }
    
    const wb = new _ExcelJS.Workbook();
    await wb.xlsx.readFile(locPath);
    
    const ws = getSheet(wb, sheetName);
    if (!ws) {
      return { success: false, message: `Sheet not found: ${sheetName}` };
    }
    
    // Check if it's a two-row header sheet
    const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
    
    let rows, sections, fields;
    if (twoRowHeader) {
      const result = sheetToObjectsTwoRow(ws);
      rows = result.rows;
      sections = result.sections;
      fields = result.fields;
    } else {
      rows = sheetToObjectsOneRow(ws);
      sections = [];
      fields = [];
    }
    
    return { success: true, rows, sections, fields };
  } catch (error) {
    console.error('[readSheetData] Error:', error);
    return { success: false, message: String(error) };
  }
}

// Update all stations of a specific asset type with new schema
async function updateAssetTypeSchema(assetType, schema, excludeStationId) {
  try {
    await ensureLookupsReady();
    ensureDir(COMPANIES_DIR);
    
    const _ExcelJS = getExcel();
    
    let totalUpdated = 0;
    const results = [];
    
    // Traverse companies/*/
    const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    
    for (const companyName of companies) {
      const companyDir = getCompanyDir(companyName);
      if (!fs.existsSync(companyDir)) continue;
      
      const locationFiles = fs.readdirSync(companyDir)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
      
      for (const fileName of locationFiles) {
        const locationName = path.basename(fileName, '.xlsx');
        const filePath = path.join(companyDir, fileName);

        const wb = new _ExcelJS.Workbook();
        
        try {
          await wb.xlsx.readFile(filePath);
        } catch (e) {
          console.error(`[updateAssetTypeSchema] Failed to read ${filePath}:`, e.message);
          continue;
        }
      
        let workbookModified = false;
      
        for (const ws of wb.worksheets) {
          if (!ws || ws.rowCount < 2) continue;
          
          // Check if this sheet contains the asset type we're looking for
          // Sheet names are like "Cableway BC" - we need to match the asset type part
          const sheetName = ws.name;
          const sheetParts = sheetName.split(' ');
          if (sheetParts.length < 2) continue;
          
          // Extract asset type from sheet name (everything except last word which is location)
          const sheetAssetType = sheetParts.slice(0, -1).join(' ');
          
          // Also check the actual data for Category field
          const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
          const headerRowNum = twoRowHeader ? 2 : 1;
          const dataStartRow = headerRowNum + 1;
          
          // Find Category/Asset Type column
          let categoryColIndex = -1;
          const headerRow = ws.getRow(headerRowNum);
          const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
          
          for (let c = 1; c <= maxCol; c++) {
            const cellText = takeText(headerRow.getCell(c)).toLowerCase();
            if (cellText === 'category' || cellText === 'asset type' || cellText === 'type') {
              categoryColIndex = c;
              break;
            }
          }
        
          // Process rows if this sheet might contain our asset type
          const lastRow = ws.actualRowCount || ws.rowCount || headerRowNum;
        
          for (let r = dataStartRow; r <= lastRow; r++) {
            const row = ws.getRow(r);
          
            // Check if this row is for our asset type
            let rowAssetType = '';
            if (categoryColIndex > 0) {
              rowAssetType = takeText(row.getCell(categoryColIndex));
            }
          
            // Also check by sheet name
            const matchesByCategory = rowAssetType.toLowerCase() === assetType.toLowerCase();
            const matchesBySheetName = sheetAssetType.toLowerCase() === assetType.toLowerCase();
          
            if (!matchesByCategory && !matchesBySheetName) continue;
          
            // Get Station ID to check if we should skip this one
            let stationId = '';
            for (let c = 1; c <= maxCol; c++) {
              const cellText = takeText(headerRow.getCell(c)).toLowerCase();
              if (cellText === 'station id' || cellText === 'stationid' || cellText === 'id') {
                stationId = takeText(row.getCell(c));
                break;
              }
            }
          
            // Skip the station that triggered this update
            if (String(stationId) === String(excludeStationId)) continue;
          
            // Apply schema update to this row
            await applySchemaToRow(ws, row, r, schema, twoRowHeader);
            workbookModified = true;
            totalUpdated++;
          }
        }
      
        if (workbookModified) {
          await wb.xlsx.writeFile(filePath);
          results.push({ location: locationName, updated: true });
        }
      }
    }

    return { 
      success: true, 
      totalUpdated, 
      results,
      message: `Updated ${totalUpdated} stations across ${results.length} locations` 
    };
    
  } catch (error) {
    console.error('[updateAssetTypeSchema] Fatal error:', error);
    return { success: false, message: String(error) };
  }
}

// Helper to apply schema changes to a row in Excel
async function applySchemaToRow(worksheet, row, rowNumber, schema, twoRowHeader) {
  let headerRowNum = twoRowHeader ? 2 : 1;
  let sectionRowNum = twoRowHeader ? 1 : null;

  // Upgrade 1-row header sheets to two-row with synthesized sections
  if (!twoRowHeader) {
    ensureTwoRowHeader(worksheet);
    twoRowHeader = true;
    headerRowNum = 2;
    sectionRowNum = 1;
  }
  
  let headerRow = worksheet.getRow(headerRowNum);
  let sectionRow = sectionRowNum ? worksheet.getRow(sectionRowNum) : null;
  
  let maxCol = worksheet.actualColumnCount || headerRow.cellCount || 0;
  
  // ═══════════════════════════════════════════════════════════════════
  // FIX: Proper deletion sync - Clear and rebuild non-GI columns
  // ═══════════════════════════════════════════════════════════════════
  
  // 1. Identify General Information columns (to preserve)
  const giColumns = new Set();
  const giFields = ['station id', 'stationid', 'id', 'category', 'asset type', 'type',
                    'site name', 'station name', 'name', 'province', 'location',
                    'latitude', 'lat', 'longitude', 'lon', 'long', 'status'];
  
  let lastGICol = 0;
  for (let c = 1; c <= maxCol; c++) {
    const section = sectionRow ? takeText(sectionRow.getCell(c)).toLowerCase() : '';
    const field = takeText(headerRow.getCell(c)).toLowerCase();
    
    if (section === 'general information' || giFields.includes(field)) {
      giColumns.add(c);
      lastGICol = Math.max(lastGICol, c);
    }
  }
  
  // 2. Collect existing values from non-GI columns for this row
  const existingValues = new Map();
  for (let c = lastGICol + 1; c <= maxCol; c++) {
    const section = sectionRow ? takeText(sectionRow.getCell(c)) : '';
    const field = takeText(headerRow.getCell(c));
    if (!field) continue;
    
    const compositeKey = section ? `${section} – ${field}` : field;
    const value = row.getCell(c).value;
    
    // Store both composite and plain field for lookup flexibility
    existingValues.set(compositeKey.toLowerCase(), value);
    existingValues.set(field.toLowerCase(), value);
  }
  
  // 3. CLEAR all non-GI columns in this row (THIS IS THE KEY FIX)
  for (let c = lastGICol + 1; c <= maxCol; c++) {
    row.getCell(c).value = '';
  }
  
  // 4. Rebuild columns based ONLY on schema (deletions are now respected)
  let targetCol = lastGICol + 1;
  
  for (let i = 0; i < schema.sections.length; i++) {
    const section = schema.sections[i];
    const field = schema.fields[i];
    
    // Skip General Information fields
    if (section.toLowerCase() === 'general information') continue;
    
    const compositeKey = section ? `${section} – ${field}` : field;
    
    // Update headers for this column
    if (sectionRow) sectionRow.getCell(targetCol).value = section || 'Extra Information';
    headerRow.getCell(targetCol).value = field;
    
    // Try to find existing value for this field
    let value = existingValues.get(compositeKey.toLowerCase());
    if (value === undefined) {
      value = existingValues.get(field.toLowerCase()) || '';
    }
    
    row.getCell(targetCol).value = value || '';
    targetCol++;
  }
  
  // 5. Clear any remaining columns beyond what schema defines
  for (let c = targetCol; c <= maxCol; c++) {
    if (sectionRow) sectionRow.getCell(c).value = '';
    headerRow.getCell(c).value = '';
    row.getCell(c).value = '';
  }
}

// ─── Algorithm Parameters (read/write) ─────────────────────────────────────
async function getAlgorithmParameters() {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  // --- DEBUG: log file and sheet being read
  try {
    console.log('[excel_worker] getAlgorithmParameters: reading file:', LOOKUPS_PATH);
    await wb.xlsx.readFile(LOOKUPS_PATH);
  } catch (e) {
    console.error('[excel_worker] getAlgorithmParameters: failed to read', LOOKUPS_PATH, '-', (e && e.message) || e);
    throw e;
  }
  const ws = getSheet(wb, ALG_PARAMS_SHEET);
  console.log('[excel_worker] getAlgorithmParameters: sheet "%s" %s', ALG_PARAMS_SHEET, ws ? 'FOUND' : 'MISSING');
  const out = [];
  if (!ws) return out;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    const applies  = normStr(row.getCell(1)?.text);
    const param    = normStr(row.getCell(2)?.text);
    const cond     = normStr(row.getCell(3)?.text) || 'IF';
    const maxW     = parseInt(normStr(row.getCell(4)?.text) || '1', 10) || 1;
    const option   = normStr(row.getCell(5)?.text);
    const weight   = parseFloat(normStr(row.getCell(6)?.text) || '0') || 0;
    const selected = toBool(row.getCell(7)?.text);
    if (!param) return;
    out.push({
      applies_to: applies,
      parameter:  param,
      condition:  cond,
      max_weight: maxW,
      option,
      weight,
      selected
    });
  });
  console.log('[excel_worker] getAlgorithmParameters: parsed rows =', out.length);
  if (out.length) {
    const pnames = Array.from(new Set(out.map(r => r.parameter))).slice(0, 10);
    console.log('[excel_worker] getAlgorithmParameters: parameters =', pnames.join(', '));
    const sample = out.slice(0, 5).map(r => `${r.parameter} | ${r.option} -> ${r.weight}`);
    console.log('[excel_worker] getAlgorithmParameters: sample:', sample);
  }
  return out;
}

async function saveAlgorithmParameters(rows = []) {
  await ensureLookupsReady();
  const list = Array.isArray(rows) ? rows : [];
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const existing = getSheet(wb, ALG_PARAMS_SHEET);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(ALG_PARAMS_SHEET);
  ws.addRow(['Applies To','Parameter','Condition','MaxWeight','Option','Weight','Selected']);
  for (const r of list) {
    ws.addRow([
      normStr(r.applies_to),
      normStr(r.parameter),
      normStr(r.condition || 'IF'),
      parseInt(r.max_weight ?? 1, 10) || 1,
      normStr(r.option),
      r.weight ?? 0,
      (r.selected ? 'TRUE' : '')
    ]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true, count: list.length };
}

// ─── Workplan Constants (read/write) ───────────────────────────────────────
async function getWorkplanConstants() {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, WORKPLAN_CONST_SHEET);
  const out = [];
  if (!ws) return out;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    out.push({ field: normStr(row.getCell(1)?.text), value: normStr(row.getCell(2)?.text) });
  });
  return out;
}

async function saveWorkplanConstants(rows = []) {
  await ensureLookupsReady();
  const list = Array.isArray(rows) ? rows : [];
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const existing = getSheet(wb, WORKPLAN_CONST_SHEET);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(WORKPLAN_CONST_SHEET);
  ws.addRow(['Field','Value']);
  for (const r of list) ws.addRow([normStr(r.field), normStr(r.value)]);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true, count: list.length };
}

// ─── Custom Weights (read/upsert) ──────────────────────────────────────────
async function getCustomWeights() {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, CUSTOM_WEIGHTS_SHEET);
  const out = [];
  if (!ws) return out;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    const w = normStr(row.getCell(1)?.text);
    const active = toBool(row.getCell(2)?.text);
    if (w && (active || row.getCell(2)?.text === undefined)) out.push({ weight: w, active: !!active });
  });
  return out;
}

async function addCustomWeight(weight, active = true) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, CUSTOM_WEIGHTS_SHEET) || wb.addWorksheet(CUSTOM_WEIGHTS_SHEET);
  if (ws.rowCount === 0) ws.addRow(['weight','active']);
  const tgt = lc(weight);
  let found = false;
  ws.eachRow({ includeEmpty:false }, (row, i) => {
    if (i === 1) return;
    if (lc(row.getCell(1)?.text) === tgt) {
      row.getCell(2).value = active ? 'TRUE' : '';
      found = true;
    }
  });
  if (!found) ws.addRow([normStr(weight), active ? 'TRUE' : '']);
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success:true };
}

// ─── Fixed Parameters (read/write) ─────────────────────────────────────────
async function getFixedParameters() {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, FIXED_PARAMS_SHEET);
  const out = [];
  if (!ws) return out;
  
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return; // skip header
    
   const name = normStr(row.getCell(1)?.text);
    const type = normStr(row.getCell(2)?.text);
    const configJSON = normStr(row.getCell(3)?.text);
    
    if (!name || !type) return;
    
    try {
      const config = configJSON ? JSON.parse(configJSON) : {};
      out.push({
        name,
        type,
        ...config
      });
    } catch (e) {
     console.error('[getFixedParameters] Failed to parse config for', name, ':', e);
    }
  });
  
  return out;
}

async function saveFixedParameters(params = []) {
  await ensureLookupsReady();
  const list = Array.isArray(params) ? params : [];
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  
  const existing = getSheet(wb, FIXED_PARAMS_SHEET);
  if (existing) wb.removeWorksheet(existing.id);
  
  const ws = wb.addWorksheet(FIXED_PARAMS_SHEET);
  ws.addRow(['Name', 'Type', 'Configuration']);
  
  for (const param of list) {
    const { name, type, ...config } = param;
    if (!name || !type) continue;
    
    // Store the config as JSON (everything except name and type)
    const configJSON = JSON.stringify(config);
    ws.addRow([name, type, configJSON]);
  }
  
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true, count: list.length };
}

// ─── Auth Functions ─────────────────────────────────────────────────────
const AUTH_FILE = path.join(LOGIN_DIR, 'Login_Information.xlsx');
const AUTH_HEADERS = ['Name','Email','Password','Admin','Permissions','Status','Created','LastLogin'];

function ensureLoginDirs() {
  ensureDir(DATA_DIR);
  ensureDir(LOGIN_DIR);
}

function isAuthFileCorrupt() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return false;
    const stat = fs.statSync(AUTH_FILE);
    if (!stat.isFile() || stat.size < 8) return true;
    const buf = Buffer.alloc(4);
    let fd;
    try {
      fd = fs.openSync(AUTH_FILE, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
    } finally {
      if (fd) {
        try { fs.closeSync(fd); } catch (_) {}
      }
    }
    // XLSX files are ZIPs that start with "PK"
    return buf[0] !== 0x50 || buf[1] !== 0x4b;
  } catch (_) {
    return true;
  }
}

function backupCorruptAuthFile(tag = 'corrupt') {
  try {
    if (!fs.existsSync(AUTH_FILE)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = tag ? `-${tag}` : '';
    const backup = path.join(LOGIN_DIR, `Login_Information${suffix}-${stamp}.bak`);
    fs.copyFileSync(AUTH_FILE, backup);
  } catch (_) { /* best effort */ }
}

async function writeAuthWorkbookSafe(workbook) {
  ensureLoginDirs();
  const tmp = `${AUTH_FILE}.tmp`;
  const buffer = await workbook.xlsx.writeBuffer();
  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, AUTH_FILE);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
}

async function loadAuthWorkbook() {
  ensureLoginDirs();
  const _ExcelJS = getExcel();
  const workbook = new _ExcelJS.Workbook();
  const exists = fs.existsSync(AUTH_FILE);
  const corrupt = exists && isAuthFileCorrupt();
  let repaired = false;

  if (!exists || corrupt) {
    if (corrupt) backupCorruptAuthFile('corrupt');
    const sheet = workbook.addWorksheet('Users');
    sheet.addRow(AUTH_HEADERS);
    await writeAuthWorkbookSafe(workbook);
    return { workbook, sheet, created: !exists, repaired: corrupt };
  }

  try {
    await workbook.xlsx.readFile(AUTH_FILE);
  } catch (err) {
    backupCorruptAuthFile('readfail');
    const sheet = workbook.addWorksheet('Users');
    sheet.addRow(AUTH_HEADERS);
    await writeAuthWorkbookSafe(workbook);
    return { workbook, sheet, created: false, repaired: true };
  }

  let sheet = workbook.getWorksheet('Users');
  if (!sheet) {
    sheet = workbook.addWorksheet('Users');
    sheet.addRow(AUTH_HEADERS);
    repaired = true;
  } else if (sheet.rowCount < 1) {
    sheet.addRow(AUTH_HEADERS);
    repaired = true;
  }

  if (repaired) {
    await writeAuthWorkbookSafe(workbook);
  }

  return { workbook, sheet, created: false, repaired };
}

async function createAuthWorkbook() {
  const { created, repaired } = await loadAuthWorkbook();
  return { success: true, created, exists: !created, repaired };
}

async function createAuthUser(userData) {
  const { workbook, sheet } = await loadAuthWorkbook();
  
  if (!sheet) {
    return { success: false, message: 'Users sheet not found' };
  }
  
  // Check if user already exists (column indices: 1=Name, 2=Email)
  let userExists = false;
  const wantName  = String(userData.name  || '').trim().toLowerCase();
  const wantEmail = String(userData.email || '').trim().toLowerCase();
  
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const rname  = String(row.getCell(1).value || '').trim().toLowerCase();
    const remail = String(row.getCell(2).value || '').trim().toLowerCase();
    if (rname === wantName || (wantEmail && remail === wantEmail)) {
      userExists = true;
    }
  });

  if (userExists) {
    return { success: false, message: 'User already exists' };
  }

  // Add new user (columns: Name, Email, Password, Admin, Permissions, Status, Created, LastLogin)
  sheet.addRow([
    userData.name,
    userData.email,
    userData.password,
    userData.admin,
    userData.permissions,
    userData.status,
    userData.created,
    userData.lastLogin || ''
  ]);
  
  await writeAuthWorkbookSafe(workbook);
  return { success: true };
}

async function loginAuthUser(nameOrEmail, hashedPassword) {
  const { workbook, sheet } = await loadAuthWorkbook();
  
  if (!sheet) {
    return { success: false, message: 'Users sheet not found' };
  }

  let foundUser = null;
  let foundRowNum = 0;
  const loginId = String(nameOrEmail || '').trim().toLowerCase();

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const rowName = String(row.getCell(1).value || '').trim();
    const rowEmail = String(row.getCell(2).value || '').trim();
    const rowPassword = row.getCell(3).value;
    
    const matchesLogin =
      (rowName && rowName.toLowerCase() === loginId) ||
      (rowEmail && rowEmail.toLowerCase() === loginId);

    if (matchesLogin && rowPassword === hashedPassword) {
      foundUser = {
        name: rowName,
        email: row.getCell(2).value,
        admin: row.getCell(4).value === 'Yes',
        permissions: row.getCell(5).value
      };
      foundRowNum = rowNum;
    }
  });

  if (!foundUser) {
    return { success: false, message: 'Invalid credentials' };
  }

  // Update status and last login (columns: 6=Status, 8=LastLogin)
  const row = sheet.getRow(foundRowNum);
  row.getCell(6).value = 'Active';
  row.getCell(8).value = new Date().toISOString();
  
  await writeAuthWorkbookSafe(workbook);
  return { success: true, user: foundUser };
}

async function logoutAuthUser(name) {
  const { workbook, sheet } = await loadAuthWorkbook();
  
  if (!sheet) {
    return { success: true }; // Silent fail for logout
  }

  sheet.eachRow((row, rowNum) => {
    if (rowNum > 1 && row.getCell(1).value === name) {
      row.getCell(6).value = 'Inactive';
    }
  });

  await writeAuthWorkbookSafe(workbook);
  return { success: true };
}

async function getAllAuthUsers() {
  const { sheet } = await loadAuthWorkbook();
  if (!sheet) return { users: [] };
  
  const users = [];
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    users.push({
      name: row.getCell(1).value,
      email: row.getCell(2).value,
      password: row.getCell(3).value,
      admin: row.getCell(4).value === 'Yes',
      permissions: row.getCell(5).value,
      status: row.getCell(6).value,
      created: row.getCell(7).value,
      lastLogin: row.getCell(8).value
    });
  });
  
  return { users };
}

async function updateAuthUser(nameOrEmail, updates = {}) {
  const { workbook, sheet } = await loadAuthWorkbook();
  if (!sheet) return { success: false, message: 'Users sheet not found' };

  const target = String(nameOrEmail || '').trim().toLowerCase();
  let targetRow = null;
  let targetRowNum = -1;
  const norm = (v) => String(v || '').trim().toLowerCase();

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rname = norm(row.getCell(1).value);
    const remail = norm(row.getCell(2).value);
    if (rname === target || remail === target) {
      targetRow = row;
      targetRowNum = rowNum;
    }
  });

  if (!targetRow) return { success: false, message: 'User not found' };

  // Duplicate check for name/email changes
  const nextName = updates.name ? String(updates.name).trim() : targetRow.getCell(1).value;
  const nextEmail = updates.email ? String(updates.email).trim().toLowerCase() : String(targetRow.getCell(2).value || '').trim().toLowerCase();
  let hasDuplicate = false;
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1 || rowNum === targetRowNum) return;
    const rname = norm(row.getCell(1).value);
    const remail = norm(row.getCell(2).value);
    if (updates.name && rname === norm(nextName)) {
      hasDuplicate = true;
    }
    if (updates.email && remail === nextEmail) {
      hasDuplicate = true;
    }
  });
  if (hasDuplicate) return { success: false, message: 'Another user already has that name or email' };

  if (updates.name) targetRow.getCell(1).value = updates.name;
  if (updates.email) targetRow.getCell(2).value = updates.email;
  if (updates.passwordHash) targetRow.getCell(3).value = updates.passwordHash;
  if (updates.admin !== undefined) targetRow.getCell(4).value = updates.admin ? 'Yes' : 'No';
  if (updates.permissions) targetRow.getCell(5).value = updates.permissions;
  if (updates.status) targetRow.getCell(6).value = updates.status;

  await writeAuthWorkbookSafe(workbook);
  return { success: true };
}

async function deleteAuthUser(nameOrEmail) {
  const { workbook, sheet } = await loadAuthWorkbook();
  if (!sheet) return { success: false, message: 'Users sheet not found' };

  const target = String(nameOrEmail || '').trim().toLowerCase();
  const norm = (v) => String(v || '').trim().toLowerCase();
  let foundRow = -1;

  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rname = norm(row.getCell(1).value);
    const remail = norm(row.getCell(2).value);
    if (rname === target || remail === target) {
      foundRow = rowNum;
    }
  });

  if (foundRow === -1) return { success: false, message: 'User not found' };

  sheet.spliceRows(foundRow, 1);
  await writeAuthWorkbookSafe(workbook);
  return { success: true };
}

async function hasAuthUsers() {
  const { sheet } = await loadAuthWorkbook();
  if (!sheet) return { hasUsers: false };
  return { hasUsers: sheet.rowCount > 1 };
}

// Read a single row of headers and return trimmed, non-empty field names
function readRowHeaders(ws, rowIdx) {
  const row = ws.getRow(rowIdx);
  const maxCol = ws.actualColumnCount || row.cellCount || 0;
  const out = [];
  for (let c = 1; c <= maxCol; c++) {
    const v = takeText(row.getCell(c));
    if (v) out.push(v);
  }
  return out;
}

/**
 * Build a catalog of field names for a location workbook:
 * - Repairs sheet: fields are on ROW 1
 * - Other sheets:  fields are on ROW 2 (fallback to ROW 1 if row 2 is empty)
 * Returns: { repairs: string[], sheets: { [sheetName]: string[] } }
 */
async function getWorkbookFieldCatalog(company = null, locationName = null) {
  ensureDir(COMPANIES_DIR);
  const _ExcelJS = getExcel();
  const result = { repairs: [], sheets: {} };

  function readRowHeaders(ws, rowIdx) {
    const row = ws.getRow(rowIdx);
    const maxCol = ws.actualColumnCount || row.cellCount || 0;
    const out = [];
    for (let c = 1; c <= maxCol; c++) {
      const v = takeText(row.getCell(c));
      if (v) out.push(v);
    }
    return out;
  }

  try {
    let filesToScan = [];
    const skipMaterialsFile = (p) => {
      const base = path.basename(p).toLowerCase();
      return base.includes('material');
    };
    
    if (company && locationName) {
      const filePath = getLocationFilePath(company, locationName);
      if (fs.existsSync(filePath) && !skipMaterialsFile(filePath)) {
        filesToScan.push({ path: filePath, company, location: locationName });
      }
    } else {
      // Scan ALL files
      const companies = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      
      for (const comp of companies) {
        const dir = getCompanyDir(comp);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
        for (const f of files) {
          const full = path.join(dir, f);
          if (skipMaterialsFile(full)) continue; // Exclude materials workbooks from field catalog
          filesToScan.push({
            path: full,
            company: comp,
            location: path.basename(f, '.xlsx')
          });
        }
      }
    }

    const repairsFieldsSet = new Set();
    const sheetFieldsMap = new Map();

    for (const fileInfo of filesToScan) {
      const wb = new _ExcelJS.Workbook();
      try { await wb.xlsx.readFile(fileInfo.path); }
      catch (e) { continue; }

      for (const ws of wb.worksheets) {
        if (!ws || !ws.name) continue;
        const name = String(ws.name);
        const isRepairs = lc(name) === lc(REPAIRS_SHEET);

        if (isRepairs) {
          const fields = readRowHeaders(ws, 1);
          fields.forEach(f => repairsFieldsSet.add(f));
        } else {
          const row2HasAny = (ws.getRow(2)?.actualCellCount || 0) > 0;
          const fields = row2HasAny ? readRowHeaders(ws, 2) : readRowHeaders(ws, 1);
          
          if (!sheetFieldsMap.has(name)) {
            sheetFieldsMap.set(name, new Set());
          }
          fields.forEach(f => sheetFieldsMap.get(name).add(f));
        }
      }
    }

    result.repairs = Array.from(repairsFieldsSet).sort();
    for (const [sheetName, fieldsSet] of sheetFieldsMap.entries()) {
      result.sheets[sheetName] = Array.from(fieldsSet).sort();
    }

    return result;
  } catch (e) {
    console.error('[getWorkbookFieldCatalog] Error:', e);
    return { repairs: [], sheets: {} };
  }
}

// Delete company from lookups.xlsx
async function deleteCompanyFromLookups(companyName) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  
  const companyLower = lc(companyName);
  
  // Remove from Companies sheet
  const wsC = getSheet(wb, 'Companies');
  if (wsC) {
    const rowsToDelete = [];
    wsC.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(1)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsC.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  // Remove from Locations sheet
  const wsL = getSheet(wb, 'Locations');
  if (wsL) {
    const rowsToDelete = [];
    wsL.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(2)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsL.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  // Remove from AssetTypes sheet
  const wsA = getSheet(wb, 'AssetTypes');
  if (wsA) {
    const rowsToDelete = [];
    wsA.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(3)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsA.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

// Delete location from lookups.xlsx
async function deleteLocationFromLookups(companyName, locationName) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  
  const companyLower = lc(companyName);
  const locationLower = lc(locationName);
  
  // Remove from Locations sheet
  const wsL = getSheet(wb, 'Locations');
  if (wsL) {
    const rowsToDelete = [];
    wsL.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(1)?.text) === locationLower && 
          lc(row.getCell(2)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsL.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  // Remove from AssetTypes sheet
  const wsA = getSheet(wb, 'AssetTypes');
  if (wsA) {
    const rowsToDelete = [];
    wsA.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(2)?.text) === locationLower && 
          lc(row.getCell(3)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsA.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

// Delete asset type from lookups.xlsx
async function deleteAssetTypeFromLookups(companyName, locationName, assetTypeName) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  
  const companyLower = lc(companyName);
  const locationLower = lc(locationName);
  const assetTypeLower = lc(assetTypeName);
  
  // Remove from AssetTypes sheet
  const wsA = getSheet(wb, 'AssetTypes');
  if (wsA) {
    const rowsToDelete = [];
    wsA.eachRow({ includeEmpty: false }, (row, idx) => {
      if (idx === 1) return;
      if (lc(row.getCell(1)?.text) === assetTypeLower && 
          lc(row.getCell(2)?.text) === locationLower && 
          lc(row.getCell(3)?.text) === companyLower) {
        rowsToDelete.push(idx);
      }
    });
    for (let i = rowsToDelete.length - 1; i >= 0; i--) {
      wsA.spliceRows(rowsToDelete[i], 1);
    }
  }
  
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

// Delete asset type data from location file
async function deleteAssetTypeFromLocation(companyName, locationName, assetTypeName) {
  const filePath = getLocationFilePath(companyName, locationName);
  if (!fs.existsSync(filePath)) {
    return { success: true }; // Already deleted
  }
  
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  
  // Find and remove the sheet for this asset type
  const assetTypeLower = lc(assetTypeName);
  let sheetDeleted = false;
  
  for (const ws of wb.worksheets) {
    if (!ws || !ws.name) continue;
    const sheetName = ws.name.toLowerCase();
    
    // Check if sheet name contains the asset type
    if (sheetName.includes(assetTypeLower)) {
      wb.removeWorksheet(ws.id);
      sheetDeleted = true;
      break;
    }
  }
  
  if (sheetDeleted) {
    await wb.xlsx.writeFile(filePath);
  }
  
  return { success: true };
}

// NEW: Write Repair Colour
async function setRepairColorForCompanyLocation(assetType, company, location, color) {
  await ensureLookupsReady();
  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(LOOKUPS_PATH);
  const ws = getSheet(wb, REPAIR_COLOURS_SHEET) || wb.addWorksheet(REPAIR_COLOURS_SHEET);
  if (ws.rowCount === 0) ws.addRow(['company','location','asset type','repair colour']);
  
  const tgtAt  = lc(assetType);
  const tgtCo  = lc(company);
  const tgtLoc = lc(location);
  
  let updated = false;
  ws.eachRow({ includeEmpty:false }, (row, idx) => {
    if (idx === 1) return;
    const co  = lc(row.getCell(1)?.text);
    const loc = lc(row.getCell(2)?.text);
    const at  = lc(row.getCell(3)?.text);
    
    if (at === tgtAt && loc === tgtLoc && co === tgtCo) {
      row.getCell(4).value = normStr(color);
      updated = true;
    }
  });
  if (!updated) {
    ws.addRow([normStr(company), normStr(location), normStr(assetType), normStr(color)]);
  }
  await wb.xlsx.writeFile(LOOKUPS_PATH);
  return { success: true };
}

// Delete a specific station row from the location workbook
async function deleteStation(company, location, stationId) {
  await ensureLookupsReady();
  const filePath = getLocationFilePath(company, location);
  
  if (!fs.existsSync(filePath)) {
    return { success: false, message: 'Location file not found' };
  }

  const _ExcelJS = getExcel();
  const wb = new _ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  let deleted = false;
  let sheetNameFound = '';

  // Iterate all sheets to find the station
  for (const ws of wb.worksheets) {
    if (!ws || ws.rowCount < 2) continue;
    
    // Skip Repairs sheet
    if (ws.name && ws.name.toLowerCase().includes('repairs')) continue;

    // Find Station ID column (handle 1 or 2 row headers)
    const twoRowHeader = (ws.getRow(2)?.actualCellCount || 0) > 0;
    const headerRowNum = twoRowHeader ? 2 : 1;
    const headerRow = ws.getRow(headerRowNum);
    const maxCol = ws.actualColumnCount || headerRow.cellCount || 0;
    
    let sidCol = -1;
      for (let c = 1; c <= maxCol; c++) {
      const txt = takeText(headerRow.getCell(c)).toLowerCase();
      if (txt === 'station id' || txt === 'stationid' || txt === 'id') {
        sidCol = c;
        break;
      }
    }

    if (sidCol === -1) continue;

    // Find the row
    const lastRow = ws.actualRowCount || ws.rowCount || headerRowNum;
    for (let r = headerRowNum + 1; r <= lastRow; r++) {
      const val = takeText(ws.getRow(r).getCell(sidCol));
      if (String(val).trim() === String(stationId).trim()) {
        ws.spliceRows(r, 1);
        deleted = true;
        sheetNameFound = ws.name;
        break; 
      }
    }

    if (deleted) break;
  }

  if (deleted) {
    await wb.xlsx.writeFile(filePath);
    return { success: true, sheet: sheetNameFound };
  }

  return { success: false, message: 'Station ID not found in workbook' };
}

// ─── RPC shim ─────────────────────────────────────────────────────────────
const handlers = {
  ping: async () => 'pong',
  ensureLookupsReady,
  readLookupsSnapshot,
  setAssetTypeColor,
  setAssetTypeColorForLocation,
  setAssetTypeColorForCompanyLocation,
  setRepairColorForCompanyLocation,
  upsertCompany,
  upsertLocation,
  upsertAssetType,
  listSheets,
  parseRows,
  parseRowsFromSheet,
  writeLocationRows,
  readStationsAggregate,
  updateStationInLocationFile,
  readLocationWorkbook,
  readSheetData,
  updateAssetTypeSchema,
  setStatusColor,
  deleteStatusRow,
  setSettingBoolean,
  setLocationLink,
  setAssetTypeLink,
  appendRepair,
  setInspectionKeywords,
  setProjectKeywords,
  // New repairs functions
  listRepairsForStation,
  saveStationRepairs,
  deleteRepair,
  getAllRepairs,
  // NEW dashboard RPCs
  getAlgorithmParameters,
  saveAlgorithmParameters,
  getWorkplanConstants,
  saveWorkplanConstants,
  getCustomWeights,
  addCustomWeight,
  // Auth handlers
  getFixedParameters,
  saveFixedParameters,
  createAuthWorkbook,
  createAuthUser,
  loginAuthUser,
  logoutAuthUser,
  getAllAuthUsers,
  updateAuthUser,
  deleteAuthUser,
  hasAuthUsers,
  getFundingSettings,
  saveFundingSettings,
  saveFundingSettingsForAssetType,
  getAllFundingSettings,
  normalizeFundingOverrides,
  getWorkbookFieldCatalog,

  deleteCompanyFromLookups,
  deleteLocationFromLookups,
  deleteAssetTypeFromLookups,
  deleteAssetTypeFromLocation,
  deleteStation
};

parentPort.on('message', async (msg) => {
  const { id, cmd, args = [] } = msg || {};
  try {
    const fn = handlers[cmd];
    if (!fn) throw new Error('Unknown command: ' + cmd);
    const result = await fn(...args);
    parentPort.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String(e && e.stack || e) });
  }
});

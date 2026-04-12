// backend/algorithms.js
'use strict';

const lookupsRepo = require('./lookups_repo');

// ───────── helpers ─────────
const _norm = (x) => (x == null ? '' : String(x).trim());
const _canon = (s) => String(s ?? '')
  .trim()
  .replace(/[\u2013\u2014]/g, '-')
  .toLowerCase();
const _tryFloat = (s) => {
  const v = Number(String(s ?? '').replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};

// ───────── temporal unit helpers (hours as canonical base) ─────────
const _normalizeUnit = (u) => {
  const s = _canon(u);
  if (!s) return null;
  // hours
  if (/^(h|hr|hrs|hour|hours)$/.test(s)) return 'hours';
  // days
  if (/^(d|day|days)$/.test(s)) return 'days';
  // weeks
  if (/^(w|wk|wks|week|weeks)$/.test(s)) return 'weeks';
  // months (assume 30-day months)
  if (/^(mo|mon|mons|month|months)$/.test(s)) return 'months';
  // years (assume 365-day years)
  if (/^(y|yr|yrs|year|years)$/.test(s)) return 'years';
  return null;
};

const _detectUnitFromFieldName = (name) => {
  const s = _canon(name);
  if (!s) return null;
  if (/(^|\W)(h|hr|hrs|hour|hours)(\W|$)/.test(s)) return 'hours';
  if (/(^|\W)(d|day|days)(\W|$)/.test(s)) return 'days';
  if (/(^|\W)(w|wk|wks|week|weeks)(\W|$)/.test(s)) return 'weeks';
  if (/(^|\W)(mo|mon|mons|month|months)(\W|$)/.test(s)) return 'months';
  if (/(^|\W)(y|yr|yrs|year|years)(\W|$)/.test(s)) return 'years';
  return null;
};

const _toHours = (num, unitLike) => {
  const u = _normalizeUnit(unitLike) || 'hours';
  switch (u) {
    case 'hours':  return num;
    case 'days':   return num * 24;
    case 'weeks':  return num * 24 * 7;
    case 'months': return num * 24 * 30;   // approx
    case 'years':  return num * 24 * 365;  // approx
    default:       return num;             // if unknown, pass through
  }
};

// ===== monetary SPLIT helpers =====
// Parse split strings like "50%F-50%P", "100%P(OTH)", "84%H-192%W(D"
// Returns a map of canonicalized source -> multiplier (e.g., {"f":0.5,"p":0.5})
function _parseSplitSpec(spec) {
  if (!spec) return null;
  const parts = String(spec).split(/\s*-\s*/);
  const out = Object.create(null);
  let found = false;
  for (const seg of parts) {
    const m = String(seg).match(/(-?\d+(?:\.\d+)?)%\s*([A-Za-z0-9()[\]\/\-\s]+)$/);
    if (!m) continue;
    const pct = Number(m[1]);
    if (!Number.isFinite(pct)) continue;
    const src = _canon(m[2] || '');
    if (!src) continue;
    out[src] = (pct / 100);
    found = true;
  }
  return found ? out : null;
}

// Merge multiple split maps (later entries overwrite earlier ones for the same key)
function _mergeSplitMaps(...maps) {
  const out = Object.create(null);
  for (const m of maps || []) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) out[k] = v;
  }
  return out;
}

// Determine which category column (O&M / Capital / Decommission) has a value and parse it.
function _getRepairSplitMap(repair, station_data) {
  // Merge splits across O&M, Capital, and Decommission (from repair and station rows)
  const station = station_data[repair.station_id] || {};
  const om  = findFieldAnywhere(repair, station, 'O&M');
  const cap = findFieldAnywhere(repair, station, 'Capital');
  const dec = findFieldAnywhere(repair, station, 'Decommission');
  const mapOm  = _parseSplitSpec(om)  || {};
  const mapCap = _parseSplitSpec(cap) || {};
  const mapDec = _parseSplitSpec(dec) || {};
  return _mergeSplitMaps(mapOm, mapCap, mapDec);
}

// Apply split multiplier when configured on a monetary fixed parameter.
function _applyMonetarySplitIfAny(amount, param, repair, station_data) {

  const splitMap = _getRepairSplitMap(repair, station_data) || null;
  if (!splitMap) return amount;

  // CASE 1: Multi-select splits (Sum them up)
  if (Array.isArray(param.split_conditions) && param.split_conditions.length > 0) {
    let totalMul = 0;
    for (const src of param.split_conditions) {
      const m = splitMap[_canon(src)];
      if (Number.isFinite(m)) totalMul += m;
    }
    return amount * totalMul;
  }

  // CASE 2: Legacy single split
  if (param && param.split_condition && param.split_condition.enabled) {
    const srcRaw = param.split_condition.source;
    if (!srcRaw) return amount;
    const mul = splitMap[_canon(srcRaw)];
    return amount * (Number.isFinite(mul) ? mul : 0);
  }

  return amount;
}

// Build a unique key for monetary constraints; distinguishes split sources.
// e.g., cost__split__f, cost__split__p, cost__split__p(bch)
function _monKey(fieldName, splitSource) {
  const base = _canon(fieldName);
  const src  = _canon(splitSource || '');
  return src ? `${base}__split__${src}` : base;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 1 - REPAIR SCORING (Soft Parameters)
// ═══════════════════════════════════════════════════════════════════════════

function _buildParamIndex(parameters = []) {
  const out = Object.create(null);
  for (const row of parameters || []) {
    const pname = _norm(row?.parameter);
    if (!pname) continue;
    const grp = (out[pname] ||= {
      max_weight: null,
      options: Object.create(null),
    });
    if (row?.max_weight != null && row?.max_weight !== '') {
      const mw = _tryFloat(row.max_weight);
      if (mw != null) grp.max_weight = mw;
    }
    const optLabel = _norm(row?.option);
    if (optLabel !== '') {
      const w = row?.weight;
      const wnum = _tryFloat(w == null ? 0 : w);
      grp.options[optLabel] = wnum == null ? 0 : wnum;
    }
  }
  for (const [pname, grp] of Object.entries(out)) {
    if (grp.max_weight == null) {
      const vals = Object.values(grp.options);
      grp.max_weight = Math.max(1, ...vals.map(v => (Number.isFinite(v) ? v : 0)));
    }
  }
  return out;
}

function _normalizeOverallWeights(rawMap, paramIndex) {
  const cleaned = Object.create(null);
  for (const pname of Object.keys(paramIndex)) {
    const v = (rawMap && Object.prototype.hasOwnProperty.call(rawMap, pname)) ? rawMap[pname] : 0;
    const f = _tryFloat(v);
    cleaned[pname] = Math.max(0, f == null ? 0 : f);
  }
  const total = Object.values(cleaned).reduce((s, v) => s + v, 0);
  if (total > 0) {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(cleaned)) out[k] = v / total;
    return out;
  }
  const n = Math.max(1, Object.keys(paramIndex).length);
  const eq = 1 / n;
  const out = Object.create(null);
  for (const k of Object.keys(paramIndex)) out[k] = eq;
  return out;
}

function _matchOptionWeight(paramCfg, value) {
  const options = paramCfg?.options || {};
  const v = _canon(value);

  for (const [label, w] of Object.entries(options)) {
    if (_canon(label) === v) {
      const wn = _tryFloat(w);
      return { matched: true, weight: wn == null ? 0 : wn };
    }
  }
  
  const vnum = _tryFloat(v);
  if (vnum != null) {
    for (const [label, w] of Object.entries(options)) {
      const onum = _tryFloat(label);
      if (onum != null && onum === vnum) {
        const wn = _tryFloat(w);
        return { matched: true, weight: wn == null ? 0 : wn };
      }
    }
  }
  return { matched: false, weight: 0 };
}

// Parse a sheet-qualified field label like "Category (Repairs)" or "Category (Cableway BC)"
// Returns { field: "Category", scope: "repairs"|"station", sheet: "Repairs"|"Cableway BC"|null }
function _parseFieldRef(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return { field: '', scope: null, sheet: null };
  const m = raw.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (m) {
    const field = m[1].trim();
    const sheet = m[2].trim();
    const sc = (_canon(sheet) === 'repairs') ? 'repairs' : 'station';
    return { field, scope: sc, sheet };
  }
  // No explicit sheet → fallback legacy behavior
  return { field: raw, scope: null, sheet: null };
}

// Search for a field, honoring sheet-qualified labels when provided.
// - "<Field> (Repairs)" → only search repair row
// - "<Field> (<Asset Sheet>)" → only search station row
// - "<Field>" (no qualifier) → legacy: search repair then station
function findFieldAnywhere(repair, station, fieldName) {
  const ref = _parseFieldRef(fieldName);
  const want = _canon(ref.field);
  if (!want) return null;

  if (ref.scope === 'repairs') {
    for (const [k, v] of Object.entries(repair || {})) {
      if (_canon(k) === want) return v;
    }
    return null;
  }
  if (ref.scope === 'station') {
    for (const [k, v] of Object.entries(station || {})) {
      if (_canon(k) === want) return v;
    }
    return null;
  }
  // Legacy fallback (no qualifier)
  for (const [k, v] of Object.entries(repair || {})) {
    if (_canon(k) === want) return v;
  }
  for (const [k, v] of Object.entries(station || {})) {
    if (_canon(k) === want) return v;
  }
  return null;
}

// Prefer the Cost value coming directly from the Repairs sheet (repair object only)
function _extractRepairCost(repair) {
  if (!repair || typeof repair !== 'object') return 0;
  for (const [k, v] of Object.entries(repair)) {
    if (_canon(k) === 'cost') {
      const num = _tryFloat(v);
      return num == null ? 0 : num;
    }
  }
  return 0;
}

async function _loadParams() {
  if (typeof lookupsRepo.getAlgorithmParameters === 'function') {
    return await lookupsRepo.getAlgorithmParameters();
  }
  return [];
}

/**
 * OPTIMIZATION 1: Score and rank repairs using soft parameters
 * Now searches across all fields regardless of data_source
 */
async function optimizeWorkplan({ repairs = [], station_data = {}, param_overall = {}, parameters: paramsFromUI } = {}) {
  const parameters = Array.isArray(paramsFromUI) ? paramsFromUI : await _loadParams();
  console.log('[optimizeWorkplan] repairs=', repairs.length, 'parameters=', (parameters || []).length);
  
  const pindex = _buildParamIndex(parameters || []);
  if (!Object.keys(pindex).length) {
    return {
      success: false,
      optimized_count: 0,
      ranking: [],
      notes: 'No soft parameters loaded. Ensure parameters are saved and passed in.'
    };
  }
  
  const overallFrac = _normalizeOverallWeights(param_overall || {}, pindex);
  const paramNames = Object.keys(pindex);

  const results = [];
  for (let i = 0; i < repairs.length; i++) {
    const repair = repairs[i] || {};
    const stationId = repair.station_id ?? '';
    const repairName = repair.name ?? '';
    const location = repair.location ?? '';
    const assetType = repair.assetType ?? '';
    const station = station_data[stationId] || {};
    const cost = _extractRepairCost(repair);
    const splitMap = _getRepairSplitMap(repair, station_data) || {};
    const splitAmounts = Object.create(null);
    for (const [src, mul] of Object.entries(splitMap)) {
      const amt = Number.isFinite(mul) ? cost * mul : 0;
      if (amt > 0) splitAmounts[src] = amt;
    }

    const perParam = Object.create(null);
    let presentSum = 0;
    
    for (const pname of paramNames) {
      const cfg = pindex[pname];
      
      // Search both repair and station data
      const value = findFieldAnywhere(repair, station, pname);
      
      const { matched, weight } = _matchOptionWeight(cfg, value);
      const maxw = Number(cfg?.max_weight || 1);
      const frac = Number(overallFrac[pname] || 0);
      
      perParam[pname] = {
        matched,
        option_weight: weight,
        max_weight: maxw,
        overall_fraction: frac,
        value: value,
      };
      
      if (matched && maxw > 0 && frac > 0) presentSum += frac;
    }
    
    const renorm = presentSum > 0 ? (1 / presentSum) : 0;

    let score = 0;
    const breakdown = Object.create(null);
    
    for (const [pname, info] of Object.entries(perParam)) {
      const { matched, option_weight, max_weight, overall_fraction } = info;
      const effFrac = (matched && presentSum > 0) ? (overall_fraction * renorm) : 0;
      const contrib = (matched && max_weight > 0) ? ((option_weight / max_weight) * effFrac) : 0;
      score += contrib;
      breakdown[pname] = {
        value: info.value,
        option_weight,
        max_weight,
        overall_fraction,
        matched,
        effective_fraction: effFrac,
      };
    }

    results.push({
      row_index: i,
      station_id: stationId,
      repair_name: repairName,
      location,
      asset_type: assetType,
      cost,
      split_amounts: splitAmounts,
      score: Math.round(score * 10000) / 100,
      details: breakdown,
      original_repair: repair
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = String(a.station_id || '');
    const bn = String(b.station_id || '');
    if (an !== bn) return an.localeCompare(bn);
    const ao = String(a.repair_name || '');
    const bo = String(b.repair_name || '');
    return ao.localeCompare(bo);
  });
  
  results.forEach((r, idx) => (r.rank = idx + 1));

  return {
    success: true,
    optimized_count: results.length,
    ranking: results,
    notes: 'Repairs scored using soft parameters searching all fields.'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 2 - TRIP GROUPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Group repairs into trips by City of Travel and Access Type.
 * NOTE: This is **just grouping** and applies **no prioritization** or ordering
 * based on Optimization 1 scores. It can accept either:
 *   - scored_repairs: [{ original_repair, score, ... }]
 *   - repairs:        [rawRepairObjects]
 * If scored_repairs is empty, it will group raw repairs directly.
 */
async function groupRepairsIntoTrips({ scored_repairs = [], repairs = [], station_data = {}, priority_mode = 'tripmean', group_by_fields = ['Access Type','City of Travel'] } = {}) {
  console.log('[groupRepairsIntoTrips] scored_repairs=', scored_repairs.length);

  // Accept raw repairs if scored ones were not provided
  const inputRepairs = (Array.isArray(scored_repairs) && scored_repairs.length)
    ? scored_repairs
    : (Array.isArray(repairs) ? repairs.map(r => ({ original_repair: r })) : []);

  if (!inputRepairs.length) {
    return { success: false, message: 'No repairs provided', trips: [] };
  }

  // Group by user-selected fields (default: Access Type + City of Travel)
  const groupFields = (Array.isArray(group_by_fields) && group_by_fields.length)
    ? group_by_fields.slice(0, 2) // enforce exactly two for now
    : ['Access Type', 'City of Travel'];

  const tripGroups = new Map();

  for (const scoredRepair of inputRepairs) {
    const repair = scoredRepair.original_repair;
    const stationId = repair.station_id;
    const station = station_data[stationId] || {};

    // Resolve grouping values per selected fields
    const gvals = groupFields.map(name => findFieldAnywhere(repair, station, name) || 'Unknown');
    const g1 = gvals[0] ?? 'Unknown'; // first grouping field (default Access Type)
    const g2 = gvals[1] ?? 'Unknown'; // second grouping field (default City of Travel)
    const cityOfTravel = findFieldAnywhere(repair, station, 'City of Travel') || '';
    const timeToSite = findFieldAnywhere(repair, station, 'Time to Site (hr)') || '';
    const siteName = findFieldAnywhere(repair, station, 'Station Name') || '';

    const tripKey = gvals.join('|||');
    
    if (!tripGroups.has(tripKey)) {
      tripGroups.set(tripKey, {
        // Keep these two for downstream/back-compat (Opt-3/UI)
        access_type: g1,
        city_of_travel: g2,
        // Rich labels for the UI
        group_by_fields: groupFields.slice(0,2),
        group_values: gvals.slice(0,2),
        repairs: [],
        stations: new Map()
      });
    }

    const trip = tripGroups.get(tripKey);
    trip.repairs.push(scoredRepair);

    // Track unique stations
    if (!trip.stations.has(stationId)) {
      // Keep the full original station row so downstream constraints (Opt-3)
      // can see fields like "Access Type", regions, budgets, etc.
      trip.stations.set(stationId, {
        ...station,                 // full station metadata
        station_id: stationId,      // ensure canonical key present
        site_name: siteName,
        city_of_travel: cityOfTravel,
        time_to_site: timeToSite,
        repairs: []
      });
    }

    const stationInfo = trip.stations.get(stationId);
    stationInfo.repairs.push(repair);
  }

  // Convert to array and calculate totals
  const trips = [];
  
  for (const [tripKey, tripData] of tripGroups.entries()) {
    let totalDays = 0;
    let totalCost = 0;
    const tripSplitTotals = Object.create(null);
    const stationsArray = [];
    const repairScores = []; // collect Opt-1 scores for priority metrics

    for (const [stationId, stationInfo] of tripData.stations.entries()) {
      let stationDays = 0;
      let stationCost = 0;
      
      // Sum days for all repairs at this station
      for (const repair of stationInfo.repairs) {
        const days = _tryFloat(repair.days || repair.Days) || 0;
        stationDays += days;
        stationCost += _extractRepairCost(repair);
        // If this repair came from Opt-1, we can read its score via tripData.repairs later;
        // we still collect in a separate pass below for correctness.

        // Split totals (per repair)
        const splitMap = _getRepairSplitMap(repair, station_data) || {};
        const baseCost = _extractRepairCost(repair);
        if (baseCost > 0) {
          for (const [src, mul] of Object.entries(splitMap)) {
            if (!Number.isFinite(mul)) continue;
            const add = baseCost * mul;
            if (add <= 0) continue;
            tripSplitTotals[src] = (tripSplitTotals[src] || 0) + add;
          }
        }

      }

      stationInfo.total_days = stationDays;
      stationInfo.total_cost = stationCost;
      stationInfo.repair_count = stationInfo.repairs.length;
      totalDays += stationDays;
      totalCost += stationCost;
      
      stationsArray.push(stationInfo);
    }

    // Annotate each scored repair with trip context for downstream (Opt-3 / add-to-year)
    for (const sr of (tripData.repairs || [])) {
      try {
        sr._access_type     = tripData.access_type;      // first grouping dim
        sr._city_of_travel  = tripData.city_of_travel;   // second grouping dim
        sr._group_fields = tripData.group_by_fields;
        sr._group_values = tripData.group_values;
      } catch (e) { /* ignore */ }
    }

    // ── Score-only priority metrics from Optimization 1 ──
    // Use the scored repairs attached to this trip grouping.
    const scores = (tripData.repairs || []).map(r => Number(r.score) || 0).sort((a,b)=>b-a);
    const mean   = scores.length ? (scores.reduce((a,b)=>a+b,0) / scores.length) : 0;
    const max    = scores.length ? scores[0] : 0;
    const median = scores.length
      ? (scores.length % 2
          ? scores[(scores.length-1)/2]
          : (scores[scores.length/2 - 1] + scores[scores.length/2]) / 2)
      : 0;

    // choose priority score based on requested mode (default = tripmean)
    const mode = String(priority_mode || 'tripmean').toLowerCase();
    const priority_score = (mode === 'tripmax') ? max : mean;

    trips.push({
      // Back-compat fields (used elsewhere)
      city_of_travel: tripData.city_of_travel,
      access_type: tripData.access_type,
      // New, explicit grouping descriptors for the UI
      group_labels: tripData.group_by_fields.map((name, i) => ({ name, value: tripData.group_values[i] })),
      group_by_fields: tripData.group_by_fields,
      total_days: totalDays,
      total_cost: totalCost,
      total_split_costs: tripSplitTotals,
      repairs: tripData.repairs,
      stations: stationsArray,
      priority_score,
      priority_mode: mode,
      priority_metrics: { mean, max, median, scores }
    });
  }

  // Sort trips by score-only priority (desc). Tie-break: max score, then lexicographic by scores, then total_days.
  trips.sort((a, b) => {
    const ps = (b.priority_score ?? 0) - (a.priority_score ?? 0);
    if (ps) return ps;
    const mx = (b.priority_metrics?.max ?? 0) - (a.priority_metrics?.max ?? 0);
    if (mx) return mx;
    const as = a.priority_metrics?.scores || [];
    const bs = b.priority_metrics?.scores || [];
    const n = Math.max(as.length, bs.length);
    for (let i=0;i<n;i++){
      const diff = (bs[i] ?? -Infinity) - (as[i] ?? -Infinity);
      if (diff) return diff;
    }
    return (b.total_days ?? 0) - (a.total_days ?? 0);
  });

  return {
    success: true,
    notes: `Grouping only. Prioritized by ${String(priority_mode || 'tripmean')}.`,
    group_by_fields: groupFields,
    trips,
    total_trips: trips.length
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZATION 3 - YEARLY ASSIGNMENT WITH CONSTRAINTS
// ═══════════════════════════════════════════════════════════════════════════

function checkIfCondition(repair, param, station_data) {
  if (!param.if_condition) return true;
  
  const ifCond = param.if_condition;
  const station = station_data[repair.station_id] || {};
  
  // Search both repair and station for the field
  const value = findFieldAnywhere(repair, station, ifCond.field);
  
  if (!value) return false;
  
  const valueStr = _canon(String(value));
  const targetStr = _canon(String(ifCond.value));
  
  switch (ifCond.operator) {
    case '=':
      return valueStr === targetStr;
    case '!=':
      return valueStr !== targetStr;
    case 'contains':
      return valueStr.includes(targetStr);
    default:
      return true;
  }
}

function checkGeographicalConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const paramName = param.name; // may be sheet-qualified
  // Prefer year-specific allowed values if provided; fall back to base list.
  const yearVals =
    (param.years && year && param.years[year] && param.years[year].values) || null;
  const allowedValues = (yearVals || param.values || []).map(v => _canon(v));
  const station = station_data[repair.station_id] || {};
  
  const value = findFieldAnywhere(repair, station, paramName);
  
  if (!value) return false;
  
  const valueParts = String(value).split(/[\/,;]/)
    .map(part => _canon(part.trim()))
    .filter(part => part);
  
  return valueParts.every(part => allowedValues.includes(part));
}

function checkTemporalConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const paramName = param.name; // may be sheet-qualified
  const station = station_data[repair.station_id] || {};
  
  const value = findFieldAnywhere(repair, station, paramName);
  
  if (!value) return false;
  
  const repairNum = _tryFloat(value);
  if (repairNum === null) return false;
  
  const yearConstraint = param.years && param.years[year];
  if (!yearConstraint) return true;
  
  const constraintValue = _tryFloat(yearConstraint.value);
  if (constraintValue === null) return true;
  
  // ── Unit-aware comparison: convert both sides to hours ──
  // Prefer unit from field name; fall back to the param's configured unit.
  const repairUnit =
    _detectUnitFromFieldName(param.name) ||
    _normalizeUnit(param.unit) ||
    'hours';
  const constraintUnit = _normalizeUnit(param.unit) || repairUnit;

  const repairHours = _toHours(repairNum, repairUnit);
  const constraintHours = _toHours(constraintValue, constraintUnit);

  return _compare(param.conditional || '<=', repairHours, constraintHours);
}

function _compare(op, a, b) {
  switch (op) {
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '>=': return a >= b;
    case '=':  return a === b;
    case '!=': return a !== b;
    default:   return a <= b;
  }
}

// Design compare (strings case-insensitive; numeric ops require numbers)
function _compareDesign(op, rawA, rawB) {
  if (op === 'contains') {
    return _canon(String(rawA)).includes(_canon(String(rawB)));
  }
  if (op === '=' || op === '!=') {
    const eq = _canon(String(rawA)) === _canon(String(rawB));
    return op === '=' ? eq : !eq;
  }
  // numeric comparisons
  const a = _tryFloat(rawA);
  const b = _tryFloat(rawB);
  if (a === null || b === null) return false;
  return _compare(op, a, b);
}

function _findFieldInStation(station, fieldName) {
  const canon = _canon(fieldName);
  for (const [k, v] of Object.entries(station || {})) {
    if (_canon(k) === canon) return v;
  }
  return null;
}

function checkDesignConstraintStation(station, param, year) {
  if (!param || !station) return true;
  const target = (param.years && param.years[year] && param.years[year].value) ?? '';
  const value  = _findFieldInStation(station, param.name);
  if (value == null) return false;
  return _compareDesign(param.operator || '=', value, target);
}


function checkMonetaryConstraint(repair, param, station_data, year) {
  if (!checkIfCondition(repair, param, station_data)) {
    return true;
  }  
  
  const fieldName = param.field_name; // may be sheet-qualified
  const station = station_data[repair.station_id] || {};
  
  // Read and parse numeric; allow 0 as a valid value.
  const value = findFieldAnywhere(repair, station, fieldName);
  const repairCost = _tryFloat(value);
  if (repairCost === null) return false;

  // Apply SPLIT multiplier if configured (monetary only)
  const adjustedCost = _applyMonetarySplitIfAny(repairCost, param, repair, station_data);
  
  const yearConstraint = param.years && param.years[year];
  if (!yearConstraint) return true;
  
  const budget = _tryFloat(yearConstraint.value);
  if (budget === null) return true;
  
  return _compare(param.conditional || '<=', adjustedCost, budget);
}

/**
 * OPTIMIZATION 3: Assign trips to years based on fixed parameters
 */
async function assignTripsToYears({ trips = [], fixed_parameters = [], top_percent = 20 } = {}) {
  console.log('[assignTripsToYears] trips=', trips.length, 'fixed_parameters=', fixed_parameters.length);

  // Drop legacy/unsupported types (e.g., "designation") to be safe.
  fixed_parameters = (fixed_parameters || []).filter(p =>
    p && (p.type === 'geographical' || p.type === 'temporal' || p.type === 'monetary' || p.type === 'design')
  );

  if (!trips.length) {
    return {
      success: false,
      message: 'No trips provided for assignment',
      assignments: {}
    };
  }

  // IMPORTANT: Respect incoming trip order from Optimization 2
  // Do NOT re-sort 'trips' here. They are already ordered by priority mode (tripmean/tripmax).

  // ── Build Top-X% repair set for Year-1 warning reporting ─────────────────
  const getRepairKey = (sr) => {
    // Prefer stable row_index from Opt-1; fallback to a composite key.
    const oi = (sr && Number.isInteger(sr.row_index)) ? `idx:${sr.row_index}` : null;
    if (oi) return oi;
    const r = sr?.original_repair || {};
    return `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
  };

  const allScoredRepairs = [];
  for (const t of trips) {
    for (const sr of (t.repairs || [])) {
      allScoredRepairs.push(sr);
    }
  }
  const sortedByScore = allScoredRepairs.slice().sort((a,b) => {
    const sa = Number(a?.score) || 0;
    const sb = Number(b?.score) || 0;
    return sb - sa;
  });
  const topCount = Math.min(
    sortedByScore.length,
    Math.max(0, Math.ceil((Number(top_percent) || 0) / 100 * sortedByScore.length))
  );
  const topRepairs = sortedByScore.slice(0, topCount);
  const topRepairKeys = new Set(topRepairs.map(getRepairKey));

  // Get all years from fixed parameters
  const allYears = new Set();
  for (const param of fixed_parameters) {
    if (param.years) {
      Object.keys(param.years).forEach(year => allYears.add(year));
    }
  }
  
  const years = Array.from(allYears).sort();
  
  if (!years.length) {
    // No yearly constraints, assign all to current year
    const currentYear = new Date().getFullYear();
    return {
      success: true,
      assignments: {
        [currentYear]: trips
      }
    };
  }

  // Build station data map
  const stationDataMap = {};
  trips.forEach(trip => {
    trip.stations.forEach(station => {
      if (!stationDataMap[station.station_id]) {
        // Each trip's station now carries the full station row (from Opt-2).
        // Keep it as-is so findFieldAnywhere can access all columns.
        stationDataMap[station.station_id] = station;
      }
    });
  });

  // For a given year, filter out stations that fail any Design constraint.
  function _filterTripByDesign(trip, year) {
    const designParams = (fixed_parameters || []).filter(p => p && p.type === 'design' && (!p.years || p.years[year]));
    if (!designParams.length) return trip;
    const keepStationIds = new Set();
    for (const st of (trip.stations || [])) {
      const pass = designParams.every(p => checkDesignConstraintStation(st, p, year));
      if (pass) keepStationIds.add(st.station_id);
    }
    // Build filtered trip
    const filteredStations = (trip.stations || []).filter(s => keepStationIds.has(s.station_id));
    const filteredRepairs  = (trip.repairs  || []).filter(sr => {
      const r = sr?.original_repair || {};
      return keepStationIds.has(r.station_id);
    });
    // Recompute totals & priority metrics for the filtered trip
    let totalDays = 0, totalCost = 0;
    const splitTotals = Object.create(null);
    for (const st of filteredStations) {
      let sDays = 0, sCost = 0;
      for (const rp of (st.repairs || [])) {
        if (!keepStationIds.has(rp.station_id)) continue;
        const d = _tryFloat(rp.days || rp.Days) || 0;
        const c = _extractRepairCost(rp);
        sDays += d; sCost += c; totalDays += d; totalCost += c;
        const smap = _getRepairSplitMap(rp, stationDataMap) || {};
        for (const [k, mul] of Object.entries(smap)) {
          if (!Number.isFinite(mul)) continue;
          const add = c * mul;
          if (add > 0) splitTotals[k] = (splitTotals[k] || 0) + add;
        }
      }
      st.total_days = sDays;
      st.total_cost = sCost;
      st.repair_count = (st.repairs || []).filter(rp => keepStationIds.has(rp.station_id)).length;
    }
    const scores = filteredRepairs.map(r => Number(r.score) || 0).sort((a,b)=>b-a);
    const mean = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
    const max  = scores.length ? scores[0] : 0;
    const median = scores.length ? (scores.length % 2 ? scores[(scores.length-1)/2]
                          : (scores[scores.length/2-1] + scores[scores.length/2])/2) : 0;
    return {
      ...trip,
      stations: filteredStations,
      repairs: filteredRepairs,
      total_days: totalDays,
      total_cost: totalCost,
      total_split_costs: splitTotals,
      priority_metrics: { mean, max, median, scores },
      // keep existing priority_mode/score; recompute score from same rule
      priority_score: (trip.priority_mode === 'tripmax') ? max : mean
    };
  }

  // Track yearly budgets/constraints
  const yearlyBudgets = {};
  const yearlyTemporal = {};
  // Describe which constraints should be surfaced in UI (monetary/temporal only)
  const constraint_columns = [];

  // helper: build a unique key for monetary constraints
  const monKey = (p) => {
    const base = _canon(p.field_name); // keep qualifier in label elsewhere; key is canonical
    const splitOn = (p.split_condition && p.split_condition.enabled && p.split_condition.source)
      ? `__split__${_canon(p.split_condition.source)}`
      : '';
    return `${base}${splitOn}`;
  };

  for (const p of (fixed_parameters || [])) {
    if (!p) continue;
    if (p.type === 'monetary') {
      // Determine split source key: Single or Combined
      let splitSrc = null;
      let splitLabel = p.field_name;

      if (Array.isArray(p.split_conditions) && p.split_conditions.length) {
         // Combine sources into one key, e.g. "f+p" to ensure uniqueness
         splitSrc = p.split_conditions.map(s => _canon(s)).sort().join('+');
         splitLabel = p.split_conditions.join(' + ');
      } else if (p.split_condition && p.split_condition.enabled) {
         splitSrc = _canon(p.split_condition.source);
         splitLabel = p.split_condition.source;
      }
      constraint_columns.push({
        type: 'monetary',
        key: _monKey(p.field_name, splitSrc),                        // unique key
        field_name: p.field_name,
        // label shows source token if split to make per-source columns clear
        label: splitLabel,
        unit: p.unit || '$',
        cumulative: !!p.cumulative,
        split_source: splitSrc
      });
    } else if (p.type === 'temporal') {
      constraint_columns.push({
        type: 'temporal',
        key: _canon(p.name),
        name: p.name,
        label: p.name,
        unit: _normalizeUnit(p.unit) || 'hours', // display unit preference
        cumulative: !!p.cumulative
      });
    }
  }
  
  for (const year of years) {
    yearlyBudgets[year] = {};
    yearlyTemporal[year] = {};
    
    for (const param of fixed_parameters) {
      if (param.type === 'monetary' && param.years && param.years[year]) {
        let splitSrc = null;
        let splitLabel = param.field_name;

        if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
           splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
           splitLabel = param.split_conditions.join(' + ');
        } else if (param.split_condition && param.split_condition.enabled) {
           splitSrc = _canon(param.split_condition.source);
           splitLabel = String(param.split_condition.source);
        }
        const key = _monKey(param.field_name, splitSrc);             // unique key
        yearlyBudgets[year][key] = {
          total: _tryFloat(param.years[year].value) || 0,
          used: 0,
          cumulative: !!param.cumulative,
          label: splitLabel,
          split_source: splitSrc,
          type: 'monetary'
        };
      } else if (param.type === 'temporal' && param.years && param.years[year]) {
        const key = _canon(param.name);
        const rawTotal = _tryFloat(param.years[year].value) || 0;
        const totalHours = _toHours(rawTotal, _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours');
        yearlyTemporal[year][key] = {
          total: totalHours,     // store in hours
          used: 0,               // track in hours
          cumulative: !!param.cumulative,
          display_unit: _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours',
          type: 'temporal',
          label: param.name
        };
      }
    }
  }

  const assignments = {};
  years.forEach(year => assignments[year] = []);
  const unassigned = [];

  // Track which top-X% repairs ended up in Year-1
  const firstYear = years[0];
  const placedInYear1 = new Set();

  // Try to assign each trip starting from first year
  for (const trip of trips) {
    let assigned = false;
    
    for (const year of years) {
      let canAssign = true;
      // Apply Design filter first (output should exclude failing stations)
      const tripFiltered = _filterTripByDesign(trip, year);
      if (!tripFiltered.stations.length) { canAssign = false; }
      
      // Check all constraints for this trip's repairs
      for (const repair of (tripFiltered.repairs || [])) {
        const originalRepair = repair.original_repair;
        
        for (const param of fixed_parameters) {
          if (param.type === 'geographical') {
            if (!checkGeographicalConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          } else if (param.type === 'temporal' && !param.cumulative) {
            if (!checkTemporalConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          } else if (param.type === 'monetary' && !param.cumulative) {
            if (!checkMonetaryConstraint(originalRepair, param, stationDataMap, year)) {
              canAssign = false;
              break;
            }
          } else if (param.type === 'design') {
            const st = stationDataMap[originalRepair.station_id] || {};
            if (!checkDesignConstraintStation(st, param, year)) {
              canAssign = false;
              break;
            }
          }
        }
        
        if (!canAssign) break;
      }
      
      // Check cumulative budget/temporal availability
      if (canAssign) {
        // Calculate trip totals for cumulative constraints
        const tripTotals = {};
        
        for (const repair of (tripFiltered.repairs || [])) {
          const originalRepair = repair.original_repair;
          const stationId = originalRepair.station_id;
          const station = stationDataMap[stationId] || {};
          
          for (const param of fixed_parameters) {
            if (!param.cumulative) continue;
            if (!checkIfCondition(originalRepair, param, stationDataMap)) continue;
            
            if (param.type === 'monetary') {
              const fieldName = param.field_name; // may be sheet-qualified
            let splitSrc = null;
            if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
              splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
            } else if (param.split_condition && param.split_condition.enabled) {
              splitSrc = _canon(param.split_condition.source);
            }
              const key = _monKey(param.field_name, splitSrc);        // unique key
              const value = findFieldAnywhere(originalRepair, station, fieldName);
              let amount = _tryFloat(value) || 0;
              // Apply SPLIT multiplier if configured
              amount = _applyMonetarySplitIfAny(amount, param, originalRepair, stationDataMap);
              tripTotals[key] = (tripTotals[key] || 0) + amount;      // accumulate by unique key
            } else if (param.type === 'temporal') {
              const fieldName = param.name; // may be sheet-qualified
              const value = findFieldAnywhere(originalRepair, station, fieldName);
              const amount = _tryFloat(value) || 0;
              // Convert each repair's temporal value to hours before summing
              const repairUnit =
                _detectUnitFromFieldName(param.name) ||
                _normalizeUnit(param.unit) ||
                'hours';
              const hours = _toHours(amount, repairUnit);
              tripTotals[fieldName] = (tripTotals[fieldName] || 0) + hours;
            }
          }
        }
        
        // Check if cumulative budgets have room
        for (const [fieldName, budget] of Object.entries(yearlyBudgets[year])) {
          if (!budget.cumulative) continue;
          const tripAmount = tripTotals[fieldName] || 0;
          if (budget.used + tripAmount > budget.total) {
            canAssign = false;
            break;
          }
        }
        
        // Check if cumulative temporal limits have room
        for (const [fieldName, temporal] of Object.entries(yearlyTemporal[year])) {
          if (!temporal.cumulative) continue;
          const tripAmount = tripTotals[fieldName] || 0;
          if (temporal.used + tripAmount > temporal.total) {
            canAssign = false;
            break;
          }
        }
        
        if (canAssign) {
          // Update cumulative trackers
          for (const [fieldName, budget] of Object.entries(yearlyBudgets[year])) {
            if (budget.cumulative) {
              budget.used += (tripTotals[fieldName] || 0);
            }
          }
          for (const [fieldName, temporal] of Object.entries(yearlyTemporal[year])) {
            if (temporal.cumulative) {
              temporal.used += (tripTotals[fieldName] || 0);
            }
          }
          
          assignments[year].push(tripFiltered);
          // If placed in first year, mark all its repairs as placed for warning coverage.
          if (year === firstYear) {
            for (const sr of (trip.repairs || [])) {
              placedInYear1.add(getRepairKey(sr));
            }
          }
          assigned = true;
          break;
        }
      }
    }
    
    if (!assigned) {
      unassigned.push(trip);
    }
  }

  // Add unassigned trips to a later year or create a new year
  if (unassigned.length > 0) {
    const lastYear = parseInt(years[years.length - 1]);
    const nextYear = lastYear + 1;
    assignments[nextYear] = unassigned;
  }

  // Build {year -> Set(repairKey)} for quick membership tests
  const assigned_keys_by_year = {};
  for (const [yr, tripsInYear] of Object.entries(assignments)) {
    const s = new Set();
    for (const t of tripsInYear || []) {
      for (const sr of (t.repairs || [])) {
        const k1 = getRepairKey(sr);
        const r = sr?.original_repair || {};
        const k2 = `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
        s.add(k1);
        s.add(k2);
      }
    }
    assigned_keys_by_year[yr] = Array.from(s);
  }

  // Build lookup of repair -> trip context using the SAME key function
  const tripLookup = new Map();
  for (const t of trips) {
    for (const sr of (t.repairs || [])) {
      const k = getRepairKey(sr);
      tripLookup.set(k, { city_of_travel: t.city_of_travel, access_type: t.access_type });
    }
  }

  const highPriorityMissing = [];
  for (const sr of topRepairs) {
    const key = getRepairKey(sr);
    if (!placedInYear1.has(key)) {
      const r = sr?.original_repair || {};
      const ctx = tripLookup.get(key) || {};
      highPriorityMissing.push({
         _key: key,  // Preserve the canonical key for consistent lookups
        station_id: r.station_id ?? '',
        repair_name: r.name ?? r.repair_name ?? '',
        score: Number(sr.score) || 0,
        city_of_travel: (sr._city_of_travel ?? ctx.city_of_travel ?? ''),
        access_type: (sr._access_type ?? ctx.access_type ?? '')
      });
    }
  }

  // ── Yearly summaries: total $ cost, days, and split totals ───────────────
  const year_summaries = {};
  for (const [year, tripsInYear] of Object.entries(assignments)) {
    let yCost = 0;
    let yDays = 0;
    const ySplits = Object.create(null);
    for (const t of tripsInYear || []) {
      const tc = Number(t.total_cost || 0);
      const td = Number(t.total_days || 0);
      yCost += tc;
      yDays += td;
      const splits = t.total_split_costs || {};
      for (const [k, v] of Object.entries(splits)) {
        const n = Number(v || 0);
        if (n > 0) ySplits[k] = (ySplits[k] || 0) + n;
      }
    }
    year_summaries[year] = {
      total_cost: yCost,
      total_days: yDays,
      total_split_costs: ySplits
    };
  }

  // ── Constraints state with remaining amounts for UI ──────────────────────
  const constraints_state = {};
  for (const y of Object.keys(yearlyBudgets)) {
    const b = {};
    for (const [k, o] of Object.entries(yearlyBudgets[y] || {})) {
      b[k] = { ...o, remaining: Math.max(0, (o.total || 0) - (o.used || 0)) };
    }
    const t = {};
    for (const [k, o] of Object.entries(yearlyTemporal[y] || {})) {
      t[k] = { ...o, remaining: Math.max(0, (o.total || 0) - (o.used || 0)) };
    }
    constraints_state[y] = { budgets: b, temporal: t };
  }

  // ── Per-repair consumption & feasible years (for "Add to Year" buttons) ─
  const per_repair_usage = {};  // key/alias -> { monetary:{fieldKey:amount}, temporal:{nameKey:hours} }
  const feasible_years = {};    // key/alias -> [years...]
  for (const sr of allScoredRepairs) {
    const r = sr?.original_repair || {};
    const key = getRepairKey(sr);
    const alias = `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
    const station = stationDataMap[r.station_id] || {};
    // collect usage
    const mUse = Object.create(null);
    const tUse = Object.create(null);
    for (const c of constraint_columns) {
      if (c.type === 'monetary') {
        const raw = findFieldAnywhere(r, station, c.field_name); // sheet-qualified ok
        const base = _tryFloat(raw) || 0;

        // Calculate multiplier based on constraint split source (single or combined)
        let totalMul = 1;
        if (c.split_source) {
          totalMul = 0;
          const smap = _getRepairSplitMap(r, stationDataMap) || {};
          // c.split_source might be "f+p" or just "f"
          const parts = c.split_source.split('+');
          for (const p of parts) {
            const m = smap[p];
            if (Number.isFinite(m)) totalMul += m;
          }
        }
        const amt = base * totalMul;
        mUse[c.key] = amt;
      } else if (c.type === 'temporal') {
        const raw = findFieldAnywhere(r, station, c.name); // sheet-qualified ok
        const val = _tryFloat(raw) || 0;
        const ru = _detectUnitFromFieldName(c.name) || _normalizeUnit(c.unit) || 'hours';
        tUse[c.key] = _toHours(val, ru);
      }
    }
    per_repair_usage[key] = { monetary: mUse, temporal: tUse };
    per_repair_usage[alias] = { monetary: mUse, temporal: tUse }; // expose alias too

    // determine feasible years
    const yrs = [];
    for (const y of years) {
      let ok = true;
      // hard (non-cumulative) checks first
      for (const p of fixed_parameters) {
        if (!checkIfCondition(r, p, stationDataMap)) continue;
        if (p.type === 'geographical') {
          if (!checkGeographicalConstraint(r, p, stationDataMap, y)) { ok = false; break; }
        } else if (p.type === 'temporal' && !p.cumulative) {
          if (!checkTemporalConstraint(r, p, stationDataMap, y)) { ok = false; break; }
        } else if (p.type === 'monetary' && !p.cumulative) {
          if (!checkMonetaryConstraint(r, p, stationDataMap, y)) { ok = false; break; }
        } else if (p.type === 'design') {
          const st = stationDataMap[r.station_id] || {};
          if (!checkDesignConstraintStation(st, p, y)) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // cumulative capacity
      for (const c of constraint_columns) {
        if (!c.cumulative) continue;
        if (c.type === 'monetary') {
          const bucket = yearlyBudgets[y]?.[c.key];
          if (!bucket) continue;
          const need = mUse[c.key] || 0;
          if (bucket.used + need > bucket.total) { ok = false; break; }
        } else if (c.type === 'temporal') {
          const bucket = yearlyTemporal[y]?.[c.key];
          if (!bucket) continue;
          const need = tUse[c.key] || 0;
          if (bucket.used + need > bucket.total) { ok = false; break; }
        }
      }
      if (!ok) continue;
      // not already assigned into this year
      if ((assigned_keys_by_year[y] || []).includes(key)) continue;
      yrs.push(y);
    }
    feasible_years[key] = yrs;
    feasible_years[alias] = yrs.slice(); // alias for frontend lookups
  }

  return {
    success: true,
    assignments,
    total_years: Object.keys(assignments).length,
    year_summaries,
    constraints_state,
    constraint_columns,
    per_repair_usage,
    feasible_years,
    assigned_keys_by_year,
    warnings: {
      top_percent: Number(top_percent) || 0,
      total_top_repairs: topCount,
      missing_in_year1: highPriorityMissing
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REPAIR-FIRST MODE - Assign individual repairs to years, then group
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Assign individual repairs to years by priority score (greedy algorithm)
 * Similar to assignTripsToYears but operates on individual repairs
 */
async function assignRepairsToYearsIndividually({ 
  scored_repairs = [], 
  station_data = {},
  fixed_parameters = [], 
  top_percent = 20 
} = {}) {
  console.log('[assignRepairsToYearsIndividually] repairs=', scored_repairs.length, 'fixed_parameters=', fixed_parameters.length);

  // Drop legacy/unsupported types
  fixed_parameters = (fixed_parameters || []).filter(p =>
    p && (p.type === 'geographical' || p.type === 'temporal' || p.type === 'monetary' || p.type === 'design')
  );

  if (!scored_repairs.length) {
    return {
      success: false,
      message: 'No repairs provided for assignment',
      assignments: {}
    };
  }

  // Sort repairs by score (highest first)
  const sortedRepairs = scored_repairs.slice().sort((a, b) => {
    const sa = Number(a?.score) || 0;
    const sb = Number(b?.score) || 0;
    return sb - sa;
  });

  // Get all years from fixed parameters
  const allYears = new Set();
  for (const param of fixed_parameters) {
    if (param.years) {
      Object.keys(param.years).forEach(year => allYears.add(year));
    }
  }
  
  const years = Array.from(allYears).sort();
  
  if (!years.length) {
    // No yearly constraints, assign all to current year
    const currentYear = new Date().getFullYear();
    return {
      success: true,
      assignments: {
        [currentYear]: sortedRepairs.map(sr => sr.original_repair)
      }
    };
  }

  // Track yearly budgets/constraints (same as trip-first)
  const yearlyBudgets = {};
  const yearlyTemporal = {};
  const constraint_columns = [];

  // Build constraint tracking (same logic as assignTripsToYears)
  for (const p of (fixed_parameters || [])) {
    if (!p) continue;
    if (p.type === 'monetary') {
      let splitSrc = null;
      if (Array.isArray(p.split_conditions) && p.split_conditions.length) {
         splitSrc = p.split_conditions.map(s => _canon(s)).sort().join('+');
      } else if (p.split_condition && p.split_condition.enabled) {
         splitSrc = _canon(p.split_condition.source);
      }
      constraint_columns.push({
        type: 'monetary',
        key: _monKey(p.field_name, splitSrc),
        field_name: p.field_name,
        label: splitSrc ? (p.split_conditions ? p.split_conditions.join('+') : p.split_condition.source) : p.field_name,
        unit: p.unit || '$',
        cumulative: !!p.cumulative,
        split_source: splitSrc
      });
    } else if (p.type === 'temporal') {
      constraint_columns.push({
        type: 'temporal',
        key: _canon(p.name),
        name: p.name,
        label: p.name,
        unit: _normalizeUnit(p.unit) || 'hours',
        cumulative: !!p.cumulative
      });
    }
  }
  
  for (const year of years) {
    yearlyBudgets[year] = {};
    yearlyTemporal[year] = {};
    
    for (const param of fixed_parameters) {
      if (param.type === 'monetary' && param.years && param.years[year]) {
        let splitSrc = null;
        if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
           splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
        } else if (param.split_condition && param.split_condition.enabled) {
           splitSrc = _canon(param.split_condition.source);
        }
        const key = _monKey(param.field_name, splitSrc);
        yearlyBudgets[year][key] = {
          total: _tryFloat(param.years[year].value) || 0,
          used: 0,
          cumulative: !!param.cumulative,
          label: splitSrc ? (param.split_conditions ? param.split_conditions.join('+') : String(param.split_condition.source)) : param.field_name,
          split_source: splitSrc,
          type: 'monetary'
        };
      } else if (param.type === 'temporal' && param.years && param.years[year]) {
        const key = _canon(param.name);
        const rawTotal = _tryFloat(param.years[year].value) || 0;
        const totalHours = _toHours(rawTotal, _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours');
        yearlyTemporal[year][key] = {
          total: totalHours,
          used: 0,
          cumulative: !!param.cumulative,
          display_unit: _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours',
          type: 'temporal',
          label: param.name
        };
      }
    }
  }

  const assignments = {};
  years.forEach(year => assignments[year] = []);
  const unassigned = [];

  const firstYear = years[0];
  const placedInYear1 = new Set();

  const getRepairKey = (sr) => {
    const oi = (sr && Number.isInteger(sr.row_index)) ? `idx:${sr.row_index}` : null;
    if (oi) return oi;
    const r = sr?.original_repair || {};
    return `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
  };

  // Greedy assignment: for each repair (highest score first)
  for (const scoredRepair of sortedRepairs) {
    const repair = scoredRepair.original_repair;
    const station = station_data[repair.station_id] || {};
    let assigned = false;

    // Try each year in order
    for (const year of years) {
      let canAssign = true;

      // Check all non-cumulative constraints
      for (const param of fixed_parameters) {
        if (param.type === 'geographical') {
          if (!checkGeographicalConstraint(repair, param, station_data, year)) {
            canAssign = false;
            break;
          }
        } else if (param.type === 'temporal' && !param.cumulative) {
          if (!checkTemporalConstraint(repair, param, station_data, year)) {
            canAssign = false;
            break;
          }
        } else if (param.type === 'monetary' && !param.cumulative) {
          if (!checkMonetaryConstraint(repair, param, station_data, year)) {
            canAssign = false;
            break;
          }
        } else if (param.type === 'design') {
          const st = station_data[repair.station_id] || {};
          if (!checkDesignConstraintStation(st, param, year)) {
            canAssign = false;
            break;
          }
        }
      }

      if (!canAssign) continue;

      // Check cumulative budget/temporal availability
      const repairUsage = { monetary: {}, temporal: {} };

      for (const param of fixed_parameters) {
        if (!param.cumulative) continue;
        if (!checkIfCondition(repair, param, station_data)) continue;

        if (param.type === 'monetary') {
          const fieldName = param.field_name;
        let splitSrc = null;
        if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
            splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
        } else if (param.split_condition && param.split_condition.enabled) {
            splitSrc = _canon(param.split_condition.source);
        }
          const key = _monKey(param.field_name, splitSrc);
          const value = findFieldAnywhere(repair, station, fieldName);
         let amount = _tryFloat(value) || 0;
          amount = _applyMonetarySplitIfAny(amount, param, repair, station_data);
          repairUsage.monetary[key] = amount;

          const budget = yearlyBudgets[year][key];
          if (budget && budget.used + amount > budget.total) {
            canAssign = false;
            break;
          }
        } else if (param.type === 'temporal') {
          const fieldName = param.name;
          const value = findFieldAnywhere(repair, station, fieldName);
          const amount = _tryFloat(value) || 0;
          const repairUnit = _detectUnitFromFieldName(param.name) || _normalizeUnit(param.unit) || 'hours';
          const hours = _toHours(amount, repairUnit);
          repairUsage.temporal[fieldName] = hours;

          const temporal = yearlyTemporal[year][fieldName];
          if (temporal && temporal.used + hours > temporal.total) {
            canAssign = false;
            break;
          }
        }
      }

      if (canAssign) {
        // Assign repair to this year
        assignments[year].push(repair);

        // Update cumulative trackers
        for (const [key, amount] of Object.entries(repairUsage.monetary)) {
          if (yearlyBudgets[year][key]) {
            yearlyBudgets[year][key].used += amount;
          }
        }
        for (const [key, hours] of Object.entries(repairUsage.temporal)) {
          if (yearlyTemporal[year][key]) {
            yearlyTemporal[year][key].used += hours;
          }
        }

        if (year === firstYear) {
          placedInYear1.add(getRepairKey(scoredRepair));
        }

        assigned = true;
        break;
      }
    }

    if (!assigned) {
      unassigned.push(repair);
    }
  }

  // Add unassigned repairs to a new year
  if (unassigned.length > 0) {
    const lastYear = parseInt(years[years.length - 1]);
    const nextYear = lastYear + 1;
    assignments[nextYear] = unassigned;
  }

  return {
    success: true,
    assignments,
    mode: 'repair-first',
    total_years: Object.keys(assignments).length
  };
}

/**
 * Group repairs into trips WITHIN each year (after individual assignment)
 */
async function groupTripsWithinYears({
  year_assignments = {},
  station_data = {},
  priority_mode = 'tripmean',
  group_by_fields = ['Access Type', 'City of Travel']
} = {}) {
  console.log('[groupTripsWithinYears] years=', Object.keys(year_assignments).length);

  const tripsByYear = {};
  for (const [year, repairs] of Object.entries(year_assignments)) {
    if (!Array.isArray(repairs) || !repairs.length) {
      tripsByYear[year] = [];
      continue;
    }

    // Convert repairs to scored format for grouping
    const scoredRepairs = repairs.map(r => ({
      original_repair: r,
      score: r.score || 0  // Preserve original score if available
    }));

    // Reuse existing grouping logic
    const result = await groupRepairsIntoTrips({
      scored_repairs: scoredRepairs,
      station_data,
      priority_mode,
      group_by_fields
    });

    tripsByYear[year] = result.trips || [];
  }

  return {
    success: true,
    trips_by_year: tripsByYear,
    mode: 'repair-first'
  };
}

/**
 * REPAIR-FIRST DYNAMIC MODE: Smart assignment with user-defined deadlines
 * Phase 1: Assign all "must finish by current year" repairs (error if can't fit)
 * Phase 2: Smart opportunistic assignment considering location consolidation and deadline urgency
 */
async function assignRepairsToYearsWithDeadlines({
  scored_repairs = [],
  station_data = {},
  fixed_parameters = [],
  look_ahead_limit = null
} = {}) {
  console.log('[assignRepairsToYearsWithDeadlines] repairs=', scored_repairs.length, 'fixed_parameters=', fixed_parameters.length);

  // Drop legacy/unsupported types and expand multi-split
  fixed_parameters = (fixed_parameters || []).filter(p =>
    p && (p.type === 'geographical' || p.type === 'temporal' || p.type === 'monetary' || p.type === 'design')
  );

  if (!scored_repairs.length) {
    return {
      success: false,
      message: 'No repairs provided for assignment',
      assignments: {}
    };
  }

  // Calculate look-ahead limit (default to all repairs if not specified)
  const maxLookAhead = look_ahead_limit != null && look_ahead_limit > 0
    ? Math.min(look_ahead_limit, scored_repairs.length)
    : scored_repairs.length;
  
  console.log('[assignRepairsToYearsWithDeadlines] look_ahead_limit=', maxLookAhead);

  // Get all years from fixed parameters
  const allYears = new Set();
  for (const param of fixed_parameters) {
    if (param.years) {
      Object.keys(param.years).forEach(year => allYears.add(year));
    }
  }
  
  const years = Array.from(allYears).sort();
  
  if (!years.length) {
    const currentYear = new Date().getFullYear();
    return {
      success: true,
      assignments: {
        [currentYear]: scored_repairs.map(sr => sr.original_repair)
      },
      mode: 'repair-first-dynamic'
    };
  }

  // Initialize constraint tracking
  const yearlyBudgets = {};
  const yearlyTemporal = {};
  
  for (const year of years) {
    yearlyBudgets[year] = {};
    yearlyTemporal[year] = {};
    
    for (const param of fixed_parameters) {
      if (param.type === 'monetary' && param.years && param.years[year]) {
        let splitSrc = null;
        if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
            splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
        } else if (param.split_condition && param.split_condition.enabled) {
            splitSrc = _canon(param.split_condition.source);
        }
        const key = _monKey(param.field_name, splitSrc);
        yearlyBudgets[year][key] = {
          total: _tryFloat(param.years[year].value) || 0,
          used: 0,
          cumulative: !!param.cumulative,
          label: splitSrc ? (param.split_conditions ? param.split_conditions.join('+') : String(param.split_condition.source)) : param.field_name,
          split_source: splitSrc,
          type: 'monetary'
        };
      } else if (param.type === 'temporal' && param.years && param.years[year]) {
        const key = _canon(param.name);
        const rawTotal = _tryFloat(param.years[year].value) || 0;
        const totalHours = _toHours(rawTotal, _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours');
        yearlyTemporal[year][key] = {
          total: totalHours,
          used: 0,
          cumulative: !!param.cumulative,
          display_unit: _normalizeUnit(param.unit) || _detectUnitFromFieldName(param.name) || 'hours',
          type: 'temporal',
          label: param.name
        };
      }
    }
  }

  const assignments = {};
  years.forEach(year => assignments[year] = []);
  
  // Helper: check if repair passes all constraints for a year
  function canFitInYear(repair, year) {
    const station = station_data[repair.station_id] || {};
    
    for (const param of fixed_parameters) {
      if (param.type === 'geographical') {
        if (!checkGeographicalConstraint(repair, param, station_data, year)) return false;
      } else if (param.type === 'temporal' && !param.cumulative) {
        if (!checkTemporalConstraint(repair, param, station_data, year)) return false;
      } else if (param.type === 'monetary' && !param.cumulative) {
        if (!checkMonetaryConstraint(repair, param, station_data, year)) return false;
      } else if (param.type === 'design') {
        if (!checkDesignConstraintStation(station, param, year)) return false;
      }
    }
    return true;
  }

  // Helper: calculate repair's cumulative usage
  function calculateRepairUsage(repair) {
    const usage = { monetary: {}, temporal: {} };
    const station = station_data[repair.station_id] || {};
    
    for (const param of fixed_parameters) {
      if (!param.cumulative) continue;
      if (!checkIfCondition(repair, param, station_data)) continue;
      
      if (param.type === 'monetary') {
        let splitSrc = null;
        if (Array.isArray(param.split_conditions) && param.split_conditions.length) {
            splitSrc = param.split_conditions.map(s => _canon(s)).sort().join('+');
        } else if (param.split_condition && param.split_condition.enabled) {
            splitSrc = _canon(param.split_condition.source);
        }
       const key = _monKey(param.field_name, splitSrc);
        const value = findFieldAnywhere(repair, station, param.field_name);
        let amount = _tryFloat(value) || 0;
        amount = _applyMonetarySplitIfAny(amount, param, repair, station_data);
        usage.monetary[key] = amount;
     } else if (param.type === 'temporal') {
        const value = findFieldAnywhere(repair, station, param.name);
        const amount = _tryFloat(value) || 0;
        const repairUnit = _detectUnitFromFieldName(param.name) || _normalizeUnit(param.unit) || 'hours';
        usage.temporal[param.name] = _toHours(amount, repairUnit);
      }
    }
    return usage;
  }

  // Helper: check if repair with usage can fit in year's remaining capacity
  function hasCapacity(year, usage) {
    for (const [key, amount] of Object.entries(usage.monetary)) {
      const budget = yearlyBudgets[year][key];
      if (budget && budget.cumulative && budget.used + amount > budget.total) {
        return false;
      }
    }
    for (const [key, hours] of Object.entries(usage.temporal)) {
      const temporal = yearlyTemporal[year][key];
      if (temporal && temporal.cumulative && temporal.used + hours > temporal.total) {
        return false;
      }
    }
    return true;
  }

  // Helper: apply usage to year's capacity
  function applyUsage(year, usage) {
    for (const [key, amount] of Object.entries(usage.monetary)) {
      if (yearlyBudgets[year][key]) {
        yearlyBudgets[year][key].used += amount;
      }
    }
    for (const [key, hours] of Object.entries(usage.temporal)) {
      if (yearlyTemporal[year][key]) {
        yearlyTemporal[year][key].used += hours;
      }
    }
  }

  // Helper: get location identifier for a repair
  function getLocation(repair) {
    const station = station_data[repair.station_id] || {};
    return findFieldAnywhere(repair, station, 'City of Travel') || '';
  }

  // PHASE 1: Assign all "must finish by current year" repairs
  for (const year of years) {
    const mustFinishThisYear = scored_repairs.filter(sr => {
      const deadline = sr.must_finish_by;
      return deadline && String(deadline).trim() === String(year);
    });
    
    // Sort by priority
    mustFinishThisYear.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    
    for (const sr of mustFinishThisYear) {
      const repair = sr.original_repair;
      
      if (!canFitInYear(repair, year)) {
        return {
          success: false,
          message: `ERROR: Year ${year} is overscheduled. Repair "${repair.name || repair.repair_name}" (Station: ${repair.station_id}, Score: ${Number(sr.score).toFixed(2)}) must finish by ${year} but cannot fit due to constraints.`
        };
      }
      
      const usage = calculateRepairUsage(repair);
      if (!hasCapacity(year, usage)) {
        return {
          success: false,
          message: `ERROR: Year ${year} is overscheduled. Repair "${repair.name || repair.repair_name}" (Station: ${repair.station_id}, Score: ${Number(sr.score).toFixed(2)}) must finish by ${year} but would exceed cumulative budget/temporal limits.`
        };
      }
      
      assignments[year].push(repair);
      applyUsage(year, usage);
      sr._assigned = true;
    }
  }

  // PHASE 2: Smart opportunistic assignment
  const unassigned = scored_repairs.filter(sr => !sr._assigned);
  
  // Loop through all remaining unassigned repairs, highest priority first
  const remaining = unassigned.filter(sr => !sr._assigned);

  for (const year of years) {
    // Build location set for current year
    const yearLocations = new Set(assignments[year].map(r => getLocation(r)));
    
    // Use an indexed loop so we can slice *relative* to the current repair
    for (let i = 0; i < remaining.length; i++) {
      const sr = remaining[i];
      if (sr._assigned) continue; // Already assigned by an opportunistic match
      const repair = sr.original_repair;
      const location = getLocation(repair);
      const deadline = sr.must_finish_by;
      const deadlineYear = deadline ? String(deadline).trim() : null;
      
      // A. Location match → assign immediately
      if (yearLocations.has(location) && canFitInYear(repair, year)) {
        const usage = calculateRepairUsage(repair);
        if (hasCapacity(year, usage)) {
          assignments[year].push(repair);
          applyUsage(year, usage);
          sr._assigned = true;
          yearLocations.add(location);
          continue;
        }
      }
      
      // B. No deadline → look for better location match
      if (!deadlineYear) {
        // Scan 'm' (maxLookAhead) items *down* from the current position 'i'
        const candidates = unassigned
          .slice(i + 1, i + 1 + maxLookAhead) // <-- This is the relative window
          .filter(candidate => {
            if (candidate._assigned) return false;
            const candRepair = candidate.original_repair;
            const candLocation = getLocation(candRepair);
            const candDeadline = candidate.must_finish_by;
            // Check if candidate matches an *existing* location in this year
            return candDeadline && yearLocations.has(candLocation) && canFitInYear(candRepair, year);
          })
          .sort((a, b) => {
            // Sort by deadline urgency (sooner first), then score
            const aYear = parseInt(a.must_finish_by) || 9999;
            const bYear = parseInt(b.must_finish_by) || 9999;
            if (aYear !== bYear) return aYear - bYear;
            return (Number(b.score) || 0) - (Number(a.score) || 0);
          });
        
        if (candidates.length > 0) {
          const best = candidates[0];
          const bestRepair = best.original_repair;
          const usage = calculateRepairUsage(bestRepair);
          if (hasCapacity(year, usage)) {
            assignments[year].push(bestRepair);
            applyUsage(year, usage);
            best._assigned = true;
            yearLocations.add(getLocation(bestRepair));
            // Current repair (sr) remains unassigned, will try next year
            continue;
          }
        }
      }
      
      // C. Has future deadline or no better match found → assign if possible
      if (canFitInYear(repair, year)) {
        const usage = calculateRepairUsage(repair);
        if (hasCapacity(year, usage)) {
          assignments[year].push(repair);
          applyUsage(year, usage);
          sr._assigned = true;
          yearLocations.add(location);
        }
      }
    }
  }

  // Any still unassigned go to a new year
  const stillUnassigned = unassigned.filter(sr => !sr._assigned);
  if (stillUnassigned.length > 0) {
    const lastYear = parseInt(years[years.length - 1]);
    const nextYear = lastYear + 1;
    assignments[nextYear] = stillUnassigned.map(sr => sr.original_repair);
  }

  return {
    success: true,
    assignments,
    mode: 'repair-first-dynamic',
    total_years: Object.keys(assignments).length
  };
}

module.exports = { 
  optimizeWorkplan,
  groupRepairsIntoTrips,
  assignTripsToYears,
  assignRepairsToYearsIndividually,
  groupTripsWithinYears,
  assignRepairsToYearsWithDeadlines
};
// frontend/js/dashboard.js
(function () {
  'use strict';

  // === DASHBOARD (Statistics/Repairs) ===
  // ---- Helpers -------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const hasStatsDOM = () => !!document.getElementById('statisticsPage');

  const getFieldValue = (row, fieldName) => {
    if (!row || !fieldName) return '';
    
    // 1. Try exact match first (fastest)
    if (row[fieldName] !== undefined) return row[fieldName];

    // 2. Normalization helper: remove everything except letters/numbers, lowercase it.
    // This makes "Asset Type" == "assettype" and "asset_type" == "assettype"
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(fieldName);

    // 3. Scan all keys in the row for a match
    for (const k of Object.keys(row)) {
      if (norm(k) === target) return row[k];
    }
    
    return '';
  };

  const normStr = (s) => String(s ?? '').trim();
  const stationLocation = (s) => normStr(s.province || s.location || s.location_file);
  const stationAssetType = (s) => normStr(s.asset_type);

  // Haversine distance in km
  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Basic, dependency-free bar chart
  function renderBarChart(container, dataPairs, opts = {}) {
    // dataPairs: [{ label, value }]
    container.innerHTML = '';
    const width = Math.max(320, container.clientWidth || 600);
    const height = opts.height || 280;
    const padL = 44, padR = 12, padT = 24, padB = 60; // extra padding so labels never clip

    const W = width, H = height;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(1, ...dataPairs.map(d => +d.value || 0));
    const barGap = 8;
    const n = dataPairs.length || 1;
    const barW = Math.max(6, (plotW - (n - 1) * barGap) / n);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', esc(opts.ariaLabel || 'Bar chart'));

    // Y axis line
    const yAxis = document.createElementNS(svg.namespaceURI, 'line');
    yAxis.setAttribute('x1', padL);
    yAxis.setAttribute('x2', padL);
    yAxis.setAttribute('y1', padT);
    yAxis.setAttribute('y2', padT + plotH);
    yAxis.setAttribute('stroke', 'currentColor');
    yAxis.setAttribute('stroke-opacity', '0.35');
    svg.appendChild(yAxis);

    // Bars + labels
    dataPairs.forEach((d, i) => {
      const v = (+d.value || 0);
      const h = Math.round((v / maxVal) * plotH);
      const x = padL + i * (barW + barGap);
      const y = padT + (plotH - h);

      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', h);
      rect.setAttribute('fill', 'currentColor');
      rect.setAttribute('fill-opacity', '0.8');
      svg.appendChild(rect);

      // Value label
      const tv = document.createElementNS(svg.namespaceURI, 'text');
      tv.setAttribute('x', x + barW / 2);
      tv.setAttribute('y', Math.max(14, y - 6)); // clamp so tallest bar labels stay visible
      tv.setAttribute('text-anchor', 'middle');
      tv.setAttribute('font-size', '10');
      tv.textContent = String(v);
      svg.appendChild(tv);

      // X labels (rotate if long)
      const tl = document.createElementNS(svg.namespaceURI, 'text');
      tl.setAttribute('x', x + barW / 2);
      tl.setAttribute('y', padT + plotH + 20);
      tl.setAttribute('text-anchor', 'middle');
      tl.setAttribute('transform', `rotate(-28, ${x + barW / 2}, ${padT + plotH + 20})`);
      tl.setAttribute('font-size', '10');
      tl.textContent = String(d.label);
      svg.appendChild(tl);
    });

    container.appendChild(svg);
  }

  // Simple pie chart using SVG arcs
  function renderPieChart(container, dataPairs, opts = {}) {
    container.innerHTML = '';
    const total = dataPairs.reduce((sum, d) => sum + Math.max(0, Number(d.value) || 0), 0);
    if (!total) {
      container.innerHTML = '<div class="empty">No data (adjust filters)</div>';
      return;
    }
    const size = opts.size || Math.max(260, Math.min(container.clientWidth || 360, 420));
    const radius = size / 2 - 12;
    const cx = size / 2;
    const cy = size / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', esc(opts.ariaLabel || 'Pie chart'));

    let angle = -Math.PI / 2;
    const paletteLocal = buildPiePalette(dataPairs.length, opts.palette);
    dataPairs.forEach((d, i) => {
      const value = Math.max(0, Number(d.value) || 0);
      const slice = (value / total) * Math.PI * 2;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      angle += slice;
      const x2 = cx + radius * Math.cos(angle);
      const y2 = cy + radius * Math.sin(angle);
      const largeArc = slice > Math.PI ? 1 : 0;
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`);
      path.setAttribute('fill', paletteLocal[i % paletteLocal.length]);
      path.setAttribute('fill-opacity', '0.92');
      svg.appendChild(path);
    });

    const legend = document.createElement('div');
    legend.className = 'pie-legend';
    dataPairs.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `<span class="dot" style="background:${paletteLocal[i % paletteLocal.length]}"></span><span>${esc(d.label)} — ${d.value}</span>`;
      legend.appendChild(row);
    });

    const wrap = document.createElement('div');
    wrap.className = 'pie-wrap';
    wrap.appendChild(svg);
    wrap.appendChild(legend);
    container.appendChild(wrap);
  }

  // ---- State ---------------------------------------------------------------

  const state = {
    allStations: [],
    filteredStations: [],
    lookupTree: null,
    cards: [],
    initialized: false,
    fieldNames: [],
    filterOptions: {
      companies: [],
      locationsByCompany: {},
      assetsByCompanyLocation: {},
      assetsByLocation: {},
      allLocations: [],
      allAssetTypes: []
    }
  };

  const analyticsUI = {
    fieldInput: null,
    vizSelect: null,
    companySelect: null,
    locationSelect: null,
    assetSelect: null,
    addBtn: null,
    ratioWrap: null,
    numeratorsHost: null,
    addNumeratorBtn: null,
    aggregateWrap: null,
    aggregateSelect: null,
    cardsHost: null
  };

  const historyState = {
    loaded: false,
    loading: false,
    entries: [], // {type, station, item, dateMs, year, city}
    filteredInspections: [],
    filteredProjects: [],
    years: [],
    cities: [],
    page: { inspections: 1, projects: 1 },
    filter: { year: '', city: '', field: '', value: '', sort: 'date_desc' }
  };

  const HISTORY_PAGE_SIZE = 10;
  const palette = [
    '#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#7c3aed', '#14b8a6', '#f97316',
    '#10b981', '#6366f1', '#06b6d4', '#8b5cf6', '#f43f5e', '#84cc16', '#4ade80', '#d946ef',
    '#0891b2', '#fb7185', '#475569', '#c084fc', '#22d3ee', '#eab308', '#14a9d5', '#f9739e'
  ];

  function buildPiePalette(count, customPalette) {
    const base = (Array.isArray(customPalette) && customPalette.length) ? customPalette : palette;
    if (count <= base.length) return base.slice(0, count);

    const colors = base.slice();
    const needed = count - colors.length;
    for (let i = 0; i < needed; i++) {
      const hue = Math.round(((i + colors.length) * 137.508) % 360);
      const lightness = 48 + ((i % 3) * 8);
      colors.push(`hsl(${hue}, 68%, ${lightness}%)`);
    }
    return colors;
  }

  const renderQueue = new Set();
  let rafHandle = 0;
  const cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const card = entry.target.__card;
      if (!card) return;
      card.isVisible = entry.isIntersecting;
      if (card.isVisible && card.needsRender) {
        renderQueue.add(card);
        if (!rafHandle) rafHandle = requestAnimationFrame(flushRenderQueue);
      }
    });
  }, { threshold: 0.05 });

  function flushRenderQueue() {
    rafHandle = 0;
    const batch = Array.from(renderQueue);
    renderQueue.clear();
    batch.forEach(card => {
      if (!card.isVisible || !card.needsRender) return;
      card.needsRender = false;
      try { card.render(); } catch (e) { console.error('[analytics] render failed', e); }
    });
  }

  function markDirty(card) {
    if (!card) return;
    card.needsRender = true;
    if (card.isVisible) {
      renderQueue.add(card);
      if (!rafHandle) rafHandle = requestAnimationFrame(flushRenderQueue);
    }
  }

  // ---- Filters integration (Analytics only) --------------------------------

  function readActiveFilters() {
    const tree = $('#filterTree');
    if (!tree) return { locations: null, assetsByLocation: new Map() };

    // Selected locations
    const locCbs = $$('input.location', tree);
    const checkedLocs = new Set(locCbs.filter(cb => cb.checked).map(cb => cb.value));

    // Selected asset types per location (only if not all are selected)
    const assetsByLoc = new Map();
    const locMap = new Map(); // quick map of location -> all asset type checkboxes under it
    $$('.ft-location', tree).forEach(locDetails => {
      const locCb = $('input.location', locDetails);
      if (!locCb) return;
      const atCbs = $$('input.asset-type', locDetails);
      locMap.set(locCb.value, atCbs);
    });

    for (const [loc, atCbs] of locMap.entries()) {
      if (!checkedLocs.has(loc)) continue;
      const checked = atCbs.filter(cb => cb.checked).map(cb => cb.value);
      if (checked.length && checked.length !== atCbs.length) {
        assetsByLoc.set(loc, new Set(checked));
      }
    }

    return { locations: checkedLocs, assetsByLocation: assetsByLoc };
  }

  function applyAnalyticsFilters() {
    const { locations, assetsByLocation } = readActiveFilters();

    if (!locations || locations.size === 0) {
      state.filteredStations = state.allStations.slice();
      return;
    }

    const matches = (s) => {
      const loc = stationLocation(s);
      if (!loc || !locations.has(loc)) return false;
      const set = assetsByLocation.get(loc);
      if (!set || set.size === 0) return true; // no AT filter for this location
      return set.has(stationAssetType(s));
    };

    state.filteredStations = state.allStations.filter(matches);
  }
  function onFiltersChanged() {
    applyAnalyticsFilters();
    state.cards.forEach(markDirty);
  }

  // ---- Analytics data & UI -------------------------------------------------

  const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));

  function buildFieldCatalogFromRows(rows) {
    const seen = new Map();
    (rows || []).forEach(r => {
      Object.keys(r || {}).forEach(k => {
        const key = normStr(k);
        if (!key) return;
        const lower = key.toLowerCase();
        if (!seen.has(lower)) seen.set(lower, key);
      });
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }

  async function loadAnalyticsFieldNames(rows) {
    try {
      let catalog = null;
      if (window.electronAPI?.getWorkbookFieldCatalog) {
        catalog = await window.electronAPI.getWorkbookFieldCatalog();
      }
      if (catalog && (Array.isArray(catalog.repairs) || catalog.sheets)) {
        const fieldMap = new Map();
        const addField = (field, source) => {
          const key = String(field || '').trim();
          if (!key) return;
          const lower = key.toLowerCase();
          if (!fieldMap.has(lower)) fieldMap.set(lower, { original: key, sources: new Set() });
          fieldMap.get(lower).sources.add(source);
        };
        (catalog.repairs || []).forEach(f => addField(f, 'Repairs'));
        Object.values(catalog.sheets || {}).forEach(fields => {
          (fields || []).forEach(f => addField(f, 'Station Data'));
        });
        const qualified = [];
        for (const { original, sources } of fieldMap.values()) {
          const inRepairs = sources.has('Repairs');
          const inStations = sources.has('Station Data');
          if (inRepairs && inStations) {
            qualified.push(`${original} (Repairs)`);
            qualified.push(`${original} (Station Data)`);
          } else if (inRepairs || inStations) {
            qualified.push(original);
          }
        }
        return qualified.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      }
    } catch (e) {
      console.warn('[analytics] field catalog failed, using fallback', e);
    }
    return buildFieldCatalogFromRows(rows);
  }

  function updateFilterOptions() {
    const tree = state.lookupTree || {};
    const companies = uniq((tree.companies || []).map(c => c.name || c)).sort((a, b) => a.localeCompare(b));
    const locationsByCompany = {};
    const assetsByCompanyLocation = {};

    companies.forEach(co => {
      locationsByCompany[co] = uniq((tree.locationsByCompany?.[co] || [])).sort((a, b) => a.localeCompare(b));
      assetsByCompanyLocation[co] = {};
      const assets = tree.assetsByCompanyLocation?.[co] || {};
      Object.keys(assets || {}).forEach(loc => {
        assetsByCompanyLocation[co][loc] = uniq(assets[loc]).sort((a, b) => a.localeCompare(b));
      });
    });

    const assetsByLocation = {};
    const allLocationsSet = new Set();
    const allAssetSet = new Set();
    state.allStations.forEach(s => {
      const loc = stationLocation(s);
      const at = stationAssetType(s);
      if (loc) allLocationsSet.add(loc);
      if (loc && at) {
        (assetsByLocation[loc] ||= new Set()).add(at);
        allAssetSet.add(at);
      }
    });

    Object.keys(assetsByLocation).forEach(loc => {
      assetsByLocation[loc] = Array.from(assetsByLocation[loc]).sort((a, b) => a.localeCompare(b));
    });

    state.filterOptions = {
      companies,
      locationsByCompany,
      assetsByCompanyLocation,
      assetsByLocation,
      allLocations: Array.from(allLocationsSet).sort((a, b) => a.localeCompare(b)),
      allAssetTypes: Array.from(allAssetSet).sort((a, b) => a.localeCompare(b))
    };
  }

  function getScopedStations(scope = {}) {
    const base = state.filteredStations && state.filteredStations.length ? state.filteredStations : state.allStations;
    return base.filter(s => {
      if (scope.company && normStr(s.company) !== normStr(scope.company)) return false;
      if (scope.location && stationLocation(s) !== scope.location) return false;
      if (scope.assetType && stationAssetType(s) !== scope.assetType) return false;
      return true;
    });
  }

  function buildScopeLabel(scope = {}) {
    const parts = [];
    if (scope.company) parts.push(scope.company);
    if (scope.location) parts.push(scope.location);
    if (scope.assetType) parts.push(scope.assetType);
    return parts.join(' -> ') || 'All stations (filtered)';
  }

  function getFieldCounts(fieldName, scope) {
    const rows = getScopedStations(scope);
    const counts = new Map();
    rows.forEach(r => {
      let v = normStr(getFieldValue(r, fieldName));
      if (!v) v = 'Unknown';
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    const items = Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    if (items.length > 24) {
      const head = items.slice(0, 23);
      const tail = items.slice(23);
      const other = tail.reduce((sum, item) => sum + (item.value || 0), 0);
      head.push({ label: 'Other', value: other });
      return head;
    }
    return items;
  }

  function collectValuesForField(fieldName, scope) {
    if (!fieldName) return [];
    const rows = getScopedStations(scope);
    const seen = new Set();
    for (const r of rows) {
      let v = normStr(getFieldValue(r, fieldName));
      if (!v) v = 'Unknown';
      seen.add(v);
      if (seen.size >= 80) break;
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }

  function collectHistoryFieldValues(fieldName) {
    if (!fieldName) return [];
    if (HISTORY_FIELD_EXCLUSIONS.includes(canonHistoryFieldName(fieldName))) return [];
    // 1) Prefer scanning all stations (richer dataset, matches Opt2 logic)
    const stationValues = collectStationFieldValues(fieldName);
    if (stationValues.length) return stationValues;
    // 2) Fallback to entries (in case field exists only on history items)
    const seen = new Map();
    const entries = historyState.entries || [];
    for (const entry of entries) {
      const raw = findHistoryFieldValue(entry.station, entry.item, fieldName);
      const v = normStr(raw);
      if (!v) continue;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
      if (seen.size >= 80) break;
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }

  function collectStationFieldValues(fieldName) {
    if (!fieldName) return [];
    const seen = new Map();
    (state.allStations || []).forEach(stn => {
      const raw = findHistoryFieldValue(stn, null, fieldName);
      const v = normStr(raw);
      if (!v) return;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
      if (seen.size >= 80) return;
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }

  // ---- Inspection/Project History (Dashboard) ------------------------------
  const HISTORY_TYPES = { INSPECTION: 'inspection', PROJECT: 'project' };
  const HISTORY_FIELD_EXCLUSIONS = ['city of travel'];

  function normalizeHistoryFieldName(fieldName) {
    return String(fieldName || '')
      .replace(/\s*\((?:Station Data|Repairs)\)\s*$/i, '')
      .trim();
  }

  const canonHistoryFieldName = (fieldName) => normalizeHistoryFieldName(fieldName).toLowerCase();

  function findHistoryFieldValue(stn, item, fieldName) {
    const targetCanon = canonHistoryFieldName(fieldName);
    if (!targetCanon) return '';

    const condensed = (s) => canonHistoryFieldName(s).replace(/[^a-z0-9]/g, '');
    const targetCondensed = condensed(fieldName);

    const probe = (obj) => {
      if (!obj) return undefined;

      const direct = getFieldValue(obj, fieldName);
      if (direct !== undefined && direct !== '') return direct;

      for (const [key, val] of Object.entries(obj)) {
        const normalized = normalizeHistoryFieldName(key);
        if (!normalized) continue;

        const variants = [normalized];
        const dashParts = normalized.split(/\s*[-\u2013]\s*/);
        if (dashParts.length > 1) variants.push(dashParts[dashParts.length - 1].trim());

        for (const variant of variants) {
          const canon = canonHistoryFieldName(variant);
          const cond = condensed(variant);
          if (canon === targetCanon || cond === targetCondensed) {
            return val;
          }
        }
      }
      return undefined;
    };

    const stnVal = probe(stn);
    if (stnVal !== undefined && stnVal !== null && normStr(stnVal)) return stnVal;

    const itemVal = probe(item);
    return itemVal !== undefined ? itemVal : '';
  }

  function getStationFieldForHistory(stn, fieldName) {
    return findHistoryFieldValue(stn, null, fieldName);
  }

  function buildHistoryEntry(type, stn, item) {
    const ms = Number(item?.dateMs);
    const parsedMs = Number.isFinite(ms) ? ms : Date.parse(item?.dateHuman || '') || 0;
    const humanYear = String(item?.dateHuman || '').slice(0, 4);
    const city = String(findHistoryFieldValue(stn, item, 'City of Travel') || '').trim();
    return {
      type,
      station: stn || {},
      item: item || {},
      dateMs: parsedMs,
      year: humanYear && /^\d{4}$/.test(humanYear) ? humanYear : (parsedMs ? String(new Date(parsedMs).getUTCFullYear()) : ''),
      city
    };
  }

  function setHistoryLoading(isLoading) {
    const loading = $('#historyLoading');
    historyState.loading = !!isLoading;
    if (loading) loading.style.display = isLoading ? '' : 'none';
  }

  function refreshHistoryFilterOptions() {
    const yearSel = $('#historyYear');
    const citySel = $('#historyCity');
    if (yearSel) {
      const cur = yearSel.value;
      yearSel.innerHTML = '<option value=\"\">All years</option>';
      historyState.years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSel.appendChild(opt);
      });
      yearSel.value = cur;
    }
    if (citySel) {
      const cur = citySel.value;
      citySel.innerHTML = '<option value=\"\">All cities</option>';
      historyState.cities.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        citySel.appendChild(opt);
      });
      citySel.value = cur;
    }
  }

  function historyFieldOptions() {
    const banned = new Set(HISTORY_FIELD_EXCLUSIONS);
    return (state.fieldNames || []).filter(name => !banned.has(canonHistoryFieldName(name)));
  }

  function refreshHistoryFieldValues() {
    const field = $('#historyField')?.value || '';
    const valueSel = $('#historyFieldValue');
    if (!valueSel) return;
    valueSel.innerHTML = '<option value=\"\">All values</option>';
    const cleanField = normalizeHistoryFieldName(field);
    if (!cleanField || HISTORY_FIELD_EXCLUSIONS.includes(canonHistoryFieldName(cleanField))) {
      valueSel.disabled = true;
      return;
    }
    const values = collectHistoryFieldValues(cleanField);
    values.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      valueSel.appendChild(opt);
    });
    valueSel.disabled = false;
    valueSel.value = '';
    historyState.filter.value = '';
  }

  function historySorter(sortKey) {
    const fieldNorm = normalizeHistoryFieldName(historyState.filter.field);
    const fieldExcluded = HISTORY_FIELD_EXCLUSIONS.includes(canonHistoryFieldName(fieldNorm));
    const fieldVal = (entry) => (fieldNorm && !fieldExcluded) ? String(findHistoryFieldValue(entry.station, entry.item, fieldNorm) || '') : '';
    const cityVal = (entry) => String(findHistoryFieldValue(entry.station, entry.item, 'City of Travel') || '');
    const yearVal = (entry) => String(entry.year || '');
    switch (sortKey) {
      case 'date_asc':
        return (a, b) => (a.dateMs || 0) - (b.dateMs || 0);
      case 'year_desc':
        return (a, b) => yearVal(b).localeCompare(yearVal(a)) || (b.dateMs || 0) - (a.dateMs || 0);
      case 'year_asc':
        return (a, b) => yearVal(a).localeCompare(yearVal(b)) || (a.dateMs || 0) - (b.dateMs || 0);
      case 'city_asc':
        return (a, b) => cityVal(a).localeCompare(cityVal(b));
      case 'city_desc':
        return (a, b) => cityVal(b).localeCompare(cityVal(a));
      case 'station_asc':
        return (a, b) => String(a.station?.name || '').localeCompare(String(b.station?.name || ''));
      case 'station_desc':
        return (a, b) => String(b.station?.name || '').localeCompare(String(a.station?.name || ''));
      case 'field_asc':
        return (a, b) => fieldVal(a).localeCompare(fieldVal(b));
      case 'field_desc':
        return (a, b) => fieldVal(b).localeCompare(fieldVal(a));
      case 'date_desc':
      default:
        return (a, b) => (b.dateMs || 0) - (a.dateMs || 0);
    }
  }

  function applyHistoryFilters() {
    const { year, city, field, value, sort } = historyState.filter;
    const fieldNorm = normalizeHistoryFieldName(field);
    const fieldExcluded = HISTORY_FIELD_EXCLUSIONS.includes(canonHistoryFieldName(fieldNorm));
    const valueNorm = String(value || '').toLowerCase();
    const matches = (entry) => {
      if (year && String(entry.year) !== String(year)) return false;
      if (city) {
        const entryCity = String(findHistoryFieldValue(entry.station, entry.item, 'City of Travel') || '').trim();
        if (entryCity !== city) return false;
      }
      if (fieldNorm && valueNorm && !fieldExcluded) {
        const v = String(findHistoryFieldValue(entry.station, entry.item, fieldNorm) || '').toLowerCase();
        if (v !== valueNorm) return false;
      }
      return true;
    };
    const inspections = historyState.entries.filter(e => e.type === HISTORY_TYPES.INSPECTION && matches(e));
    const projects = historyState.entries.filter(e => e.type === HISTORY_TYPES.PROJECT && matches(e));
    const sorter = historySorter(sort);
    inspections.sort(sorter);
    projects.sort(sorter);
    historyState.filteredInspections = inspections;
    historyState.filteredProjects = projects;
    historyState.page.inspections = 1;
    historyState.page.projects = 1;
    renderHistoryLists(inspections, projects);
  }

  function openHistoryPdfModal(url, title) {
    if (!url) return;
    const modal = $('#historyPdfModal');
    const frame = $('#historyPdfFrame');
    const head = $('#historyPdfTitle');
    const close = $('#historyPdfClose');
    if (!modal || !frame) return;
    frame.src = url;
    if (head) head.textContent = title || 'Report';
    modal.style.display = 'flex';
    const closer = () => {
      modal.style.display = 'none';
      frame.removeAttribute('src');
      close?.removeEventListener('click', closer);
      modal.removeEventListener('click', backdropCloser);
      document.removeEventListener('keydown', escCloser);
    };
    const backdropCloser = (e) => { if (e.target === modal) closer(); };
    const escCloser = (e) => { if (e.key === 'Escape') closer(); };
    close?.addEventListener('click', closer);
    modal.addEventListener('click', backdropCloser);
    document.addEventListener('keydown', escCloser);
  }

  function buildInspectionCard(entry) {
    const { item, station } = entry;
    const wrap = document.createElement('div');
    wrap.className = 'history-card inspection-item';
    wrap.setAttribute('data-date-ms', String(entry.dateMs || ''));

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '8px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    const byInspector = item.inspector ? ` by ${item.inspector}` : '';
    const datePart = item.dateHuman ? ` - ${item.dateHuman}` : '';
    title.textContent = `${item.displayName || item.folderName || 'Inspection'}${byInspector}${datePart}`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'btn';
    reportBtn.textContent = 'Inspection Report';
    reportBtn.disabled = !item.reportUrl;
    reportBtn.addEventListener('click', () => openHistoryPdfModal(item.reportUrl, `${item.displayName || 'Inspection'} Report`));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.title = 'Delete this inspection';
    delBtn.addEventListener('click', async () => {
      const ok = await appConfirm(`Delete the "${item.folderName || item.displayName || 'inspection'}" folder for ${station.name || station.station_id}?`);
      if (!ok) return;
      delBtn.disabled = true;
      delBtn.textContent = 'Deleting…';
      try {
        await window.electronAPI.deleteInspection(station.name, station.station_id, item.folderName);
        historyState.loaded = false;
        await ensureHistoryData(true);
      } catch (e) {
        console.error('[history] delete inspection failed', e);
        delBtn.disabled = false;
        delBtn.textContent = 'Delete';
      }
    });

    actions.appendChild(reportBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);
    wrap.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const badge = document.createElement('span');
    badge.className = 'history-badge';
    badge.textContent = `Station ${station.station_id || ''}`;
    meta.appendChild(badge);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = station.name || '';
    meta.appendChild(nameSpan);
    const locSpan = document.createElement('span');
    locSpan.textContent = stationLocation(station) || '';
    meta.appendChild(locSpan);
    const assetSpan = document.createElement('span');
    assetSpan.textContent = stationAssetType(station) || '';
    meta.appendChild(assetSpan);
    if (entry.city) {
      const citySpan = document.createElement('span');
      citySpan.textContent = `City of travel: ${entry.city}`;
      meta.appendChild(citySpan);
    }
    wrap.appendChild(meta);

    if (item.commentText && item.commentText.trim()) {
      const comment = document.createElement('div');
      comment.className = 'ih-comment';
      comment.style.marginTop = '8px';
      comment.style.whiteSpace = 'pre-wrap';
      comment.textContent = item.commentText.trim();
      wrap.appendChild(comment);
    }

    const photosRow = document.createElement('div');
    photosRow.className = 'history-photo-row';
    if (item.photos && item.photos.length) {
      item.photos.forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.title = p.name || 'Inspection photo';
        a.target = '_blank';
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = p.name || 'Inspection photo';
        a.appendChild(img);
        photosRow.appendChild(a);
      });
      const extra = Number(item.moreCount || 0);
      if (extra > 0) {
        const more = document.createElement('div');
        more.textContent = `+ ${extra} more`;
        more.style.fontWeight = '700';
        more.style.color = '#374151';
        photosRow.appendChild(more);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No photos found for this inspection';
      photosRow.appendChild(empty);
    }
    wrap.appendChild(photosRow);

    return wrap;
  }

  function buildProjectCard(entry) {
    const { item, station } = entry;
    const wrap = document.createElement('div');
    wrap.className = 'history-card project-item';
    wrap.setAttribute('data-date-ms', String(entry.dateMs || ''));

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '8px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    const byLead = item.projectLead ? ` by ${item.projectLead}` : '';
    const datePart = item.dateHuman ? ` - ${item.dateHuman}` : '';
    title.textContent = `${item.displayName || item.folderName || 'Project'}${byLead}${datePart}`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'btn';
    reportBtn.textContent = 'Project Report';
    reportBtn.disabled = !item.reportUrl;
    reportBtn.addEventListener('click', () => openHistoryPdfModal(item.reportUrl, `${item.displayName || 'Project'} Report`));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.title = 'Delete this project';
    delBtn.addEventListener('click', async () => {
      const ok = await appConfirm(`Delete the "${item.folderName || item.displayName || 'project'}" folder for ${station.name || station.station_id}?`);
      if (!ok) return;
      delBtn.disabled = true;
      delBtn.textContent = 'Deleting…';
      try {
        await window.electronAPI.deleteProject(station.name, station.station_id, item.folderName);
        historyState.loaded = false;
        await ensureHistoryData(true);
      } catch (e) {
        console.error('[history] delete project failed', e);
        delBtn.disabled = false;
        delBtn.textContent = 'Delete';
      }
    });

    actions.appendChild(reportBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);
    wrap.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const badge = document.createElement('span');
    badge.className = 'history-badge';
    badge.textContent = `Station ${station.station_id || ''}`;
    meta.appendChild(badge);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = station.name || '';
    meta.appendChild(nameSpan);
    const locSpan = document.createElement('span');
    locSpan.textContent = stationLocation(station) || '';
    meta.appendChild(locSpan);
    const assetSpan = document.createElement('span');
    assetSpan.textContent = stationAssetType(station) || '';
    meta.appendChild(assetSpan);
    if (entry.city) {
      const citySpan = document.createElement('span');
      citySpan.textContent = `City of travel: ${entry.city}`;
      meta.appendChild(citySpan);
    }
    wrap.appendChild(meta);

    if (item.commentText && item.commentText.trim()) {
      const comment = document.createElement('div');
      comment.className = 'ph-comment';
      comment.style.marginTop = '8px';
      comment.style.whiteSpace = 'pre-wrap';
      comment.textContent = item.commentText.trim();
      wrap.appendChild(comment);
    }

    const photosRow = document.createElement('div');
    photosRow.className = 'history-photo-row';
    if (item.photos && item.photos.length) {
      item.photos.forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.title = p.name || 'Project photo';
        a.target = '_blank';
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = p.name || 'Project photo';
        a.appendChild(img);
        photosRow.appendChild(a);
      });
      const extra = Number(item.moreCount || 0);
      if (extra > 0) {
        const more = document.createElement('div');
        more.textContent = `+ ${extra} more`;
        more.style.fontWeight = '700';
        more.style.color = '#374151';
        photosRow.appendChild(more);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No photos found for this project';
      photosRow.appendChild(empty);
    }
    wrap.appendChild(photosRow);

    return wrap;
  }

  function paginateHistoryList(list, page) {
    const totalPages = Math.max(1, Math.ceil((list?.length || 0) / HISTORY_PAGE_SIZE));
    const currentPage = Math.min(Math.max(page || 1, 1), totalPages);
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return {
      items: (list || []).slice(start, start + HISTORY_PAGE_SIZE),
      totalPages,
      currentPage
    };
  }

  function renderHistoryPager(host, totalPages, currentPage, onChange) {
    if (!host) return;
    host.innerHTML = '';
    if (totalPages <= 1) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';

    const clamp = (p) => Math.min(Math.max(p, 1), totalPages);
    const addBtn = (label, target, disabled = false, isActive = false) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `history-page-btn${isActive ? ' active' : ''}`;
      btn.textContent = label;
      btn.disabled = !!disabled;
      if (!disabled) btn.addEventListener('click', () => onChange(clamp(target)));
      host.appendChild(btn);
    };

    addBtn('< Prev', currentPage - 1, currentPage <= 1);

    const windowSize = 5;
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + windowSize - 1);
    if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);
    for (let p = start; p <= end; p++) {
      addBtn(String(p), p, false, p === currentPage);
    }

    addBtn('Next >', currentPage + 1, currentPage >= totalPages);

    const info = document.createElement('span');
    info.className = 'history-page-info';
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    host.appendChild(info);
  }

  function renderHistoryLists(inspections = historyState.filteredInspections, projects = historyState.filteredProjects) {
    const insHost = $('#historyInspections');
    const projHost = $('#historyProjects');
    const empty = $('#historyEmpty');
    const insPager = $('#historyInspectionsPager');
    const projPager = $('#historyProjectsPager');
    historyState.filteredInspections = inspections || [];
    historyState.filteredProjects = projects || [];
    const insPage = paginateHistoryList(inspections || [], historyState.page.inspections || 1);
    const projPage = paginateHistoryList(projects || [], historyState.page.projects || 1);
    historyState.page.inspections = insPage.currentPage;
    historyState.page.projects = projPage.currentPage;
    if (insHost) {
      insHost.innerHTML = '';
      if (!insPage.items.length) {
        const ghost = document.createElement('div');
        ghost.className = 'history-empty-card';
        ghost.textContent = 'No inspections match the filters';
        insHost.appendChild(ghost);
      } else {
        insPage.items.forEach(entry => insHost.appendChild(buildInspectionCard(entry)));
      }
    }
    if (insPager) {
      renderHistoryPager(insPager, insPage.totalPages, insPage.currentPage, (page) => {
        historyState.page.inspections = page;
        renderHistoryLists(historyState.filteredInspections, historyState.filteredProjects);
      });
    }
    if (projHost) {
      projHost.innerHTML = '';
      if (!projPage.items.length) {
        const ghost = document.createElement('div');
        ghost.className = 'history-empty-card';
        ghost.textContent = 'No projects match the filters';
        projHost.appendChild(ghost);
      } else {
        projPage.items.forEach(entry => projHost.appendChild(buildProjectCard(entry)));
      }
    }
    if (projPager) {
      renderHistoryPager(projPager, projPage.totalPages, projPage.currentPage, (page) => {
        historyState.page.projects = page;
        renderHistoryLists(historyState.filteredInspections, historyState.filteredProjects);
      });
    }
    if (empty) {
      const none = (inspections && inspections.length === 0) && (projects && projects.length === 0);
      empty.style.display = none ? '' : 'none';
    }
  }

  function wireHistoryFieldInput(inputEl) {
    if (!inputEl) return;
    // Guard against double-wiring after clone
    if (inputEl._historyWired) return;
    inputEl._historyWired = true;
    inputEl.addEventListener('change', () => {
      historyState.filter.field = inputEl.value;
      refreshHistoryFieldValues();
      applyHistoryFilters();
    });
    inputEl.addEventListener('input', () => {
      historyState.filter.field = inputEl.value;
      refreshHistoryFieldValues();
    });
  }

  function wireHistoryFilters() {
    const yearSel = $('#historyYear');
    const citySel = $('#historyCity');
    let fieldInput = $('#historyField');
    const valueSel = $('#historyFieldValue');
    const sortSel = $('#historySort');

    if (yearSel) {
      yearSel.addEventListener('change', () => {
        historyState.filter.year = yearSel.value;
        applyHistoryFilters();
      });
    }
    if (citySel) {
      citySel.addEventListener('change', () => {
        historyState.filter.city = citySel.value;
        applyHistoryFilters();
      });
    }
    if (fieldInput) {
      fieldInput = applyAutocomplete(fieldInput, historyFieldOptions());
      wireHistoryFieldInput(fieldInput);
    }
    if (valueSel) {
      valueSel.addEventListener('change', () => {
        historyState.filter.value = valueSel.value;
        applyHistoryFilters();
      });
    }
    if (sortSel) {
      sortSel.addEventListener('change', () => {
        historyState.filter.sort = sortSel.value || 'date_desc';
        applyHistoryFilters();
      });
    }

    const addBtn = $('#btnHistoryAdd');
    const addMenu = $('#historyAddMenu');
    const addInspection = $('#historyAddInspection');
    const addProject = $('#historyAddProject');
    if (addBtn && addMenu) {
      const toggleMenu = (show) => {
        addMenu.style.display = show ? 'flex' : 'none';
      };
      addBtn.addEventListener('click', () => {
        const isOpen = addMenu.style.display === 'flex';
        toggleMenu(!isOpen);
      });
      document.addEventListener('click', (e) => {
        if (!addMenu.contains(e.target) && !addBtn.contains(e.target)) {
          toggleMenu(false);
        }
      });
    }
    addInspection?.addEventListener('click', () => {
      $('#historyAddMenu')?.style && ($('#historyAddMenu').style.display = 'none');
      openHistoryAddInspection();
    });
    addProject?.addEventListener('click', () => {
      $('#historyAddMenu')?.style && ($('#historyAddMenu').style.display = 'none');
      openHistoryAddProject();
    });

    const btnInspectKeywords = $('#btnHistoryInspectionKeywords');
    const btnProjectKeywords = $('#btnHistoryProjectKeywords');
    btnInspectKeywords?.addEventListener('click', () => openHistoryKeywordModal('inspection'));
    btnProjectKeywords?.addEventListener('click', () => openHistoryKeywordModal('project'));
  }

  function refreshHistoryFieldAutocomplete() {
    let fieldInput = $('#historyField');
    if (fieldInput) {
      fieldInput = applyAutocomplete(fieldInput, historyFieldOptions());
      wireHistoryFieldInput(fieldInput);
    }
  }

  async function loadHistoryData(force = false) {
    if (historyState.loading) return;
    if (historyState.loaded && !force) {
      applyHistoryFilters();
      return;
    }
    setHistoryLoading(true);
    try {
      const entries = [];
      const stations = Array.isArray(state.allStations) ? state.allStations : [];
      for (const stn of stations) {
        if (!stn || !stn.station_id) continue;
        try {
          const [inspections, projects] = await Promise.all([
            window.electronAPI.listInspections(stn.name, stn.station_id),
            window.electronAPI.listProjects(stn.name, stn.station_id)
          ]);
          (inspections || []).forEach(item => entries.push(buildHistoryEntry(HISTORY_TYPES.INSPECTION, stn, item)));
          (projects || []).forEach(item => entries.push(buildHistoryEntry(HISTORY_TYPES.PROJECT, stn, item)));
        } catch (e) {
          console.warn('[history] load station entries failed', e);
        }
      }
      historyState.entries = entries;
      historyState.loaded = true;
      historyState.years = Array.from(new Set(entries.map(e => e.year).filter(Boolean))).sort((a, b) => Number(b) - Number(a));
      // Build city list from station data (matches Opt2 City of Travel lookup), not just entries
      historyState.cities = collectStationFieldValues('City of Travel');
      refreshHistoryFilterOptions();
      refreshHistoryFieldValues();
      applyHistoryFilters();
    } finally {
      setHistoryLoading(false);
    }
  }

  async function ensureHistoryData(force = false) {
    try {
      await loadHistoryData(force);
    } catch (e) {
      console.error('[history] failed to load', e);
      setHistoryLoading(false);
    }
  }

  function buildStationSelectorHTML(prefix) {
    return `
      <div class="form-row" style="grid-column:1 / -1;">
        <label>Company</label>
        <select id="${prefix}Company">
          <option value="">Select company...</option>
        </select>
      </div>
      <div class="form-row" style="grid-column:1 / -1;">
        <label>Location</label>
        <select id="${prefix}Location" disabled>
          <option value="">Select company first...</option>
        </select>
      </div>
      <div class="form-row" style="grid-column:1 / -1;">
        <label>Asset Type</label>
        <select id="${prefix}Asset" disabled>
          <option value="">Select location first...</option>
        </select>
      </div>
      <div class="form-row" style="grid-column:1 / -1;">
        <label>Station *</label>
        <div style="position:relative;">
          <input id="${prefix}StationInput" type="text" placeholder="Type to search..." disabled autocomplete="off" />
          <div id="${prefix}StationDropdown" class="station-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-top:none;z-index:1000;"></div>
        </div>
        <input type="hidden" id="${prefix}StationId" />
        <input type="hidden" id="${prefix}StationName" />
        <input type="hidden" id="${prefix}StationLocation" />
        <input type="hidden" id="${prefix}StationAsset" />
      </div>`;
  }

  function wireStationSelector(modal, prefix) {
    const opts = getFilteredAssetTypes();
    const stationsList = Array.isArray(state.allStations) ? state.allStations : [];
    const companySel = modal.querySelector(`#${prefix}Company`);
    const locationSel = modal.querySelector(`#${prefix}Location`);
    const assetSel = modal.querySelector(`#${prefix}Asset`);
    const stationInput = modal.querySelector(`#${prefix}StationInput`);
    const stationDropdown = modal.querySelector(`#${prefix}StationDropdown`);
    const hidId = modal.querySelector(`#${prefix}StationId`);
    const hidName = modal.querySelector(`#${prefix}StationName`);
    const hidLoc = modal.querySelector(`#${prefix}StationLocation`);
    const hidAsset = modal.querySelector(`#${prefix}StationAsset`);
    let availableStations = [];

    (opts.companies || []).forEach(co => {
      const opt = document.createElement('option');
      opt.value = co;
      opt.textContent = co;
      companySel?.appendChild(opt);
    });

    const resetStation = () => {
      if (stationInput) stationInput.value = '';
      if (hidId) hidId.value = '';
      if (hidName) hidName.value = '';
      if (hidLoc) hidLoc.value = '';
      if (hidAsset) hidAsset.value = '';
    };

    const chooseStation = (st) => {
      if (stationInput) stationInput.value = `${st.station_id || ''} - ${st.name || ''}`;
      if (hidId) hidId.value = st.station_id || '';
      if (hidName) hidName.value = st.name || '';
      if (hidLoc) hidLoc.value = stationLocation(st) || '';
      if (hidAsset) hidAsset.value = stationAssetType(st) || '';
      if (stationDropdown) stationDropdown.style.display = 'none';
    };

    companySel?.addEventListener('change', () => {
      const company = companySel.value;
      resetStation();
      locationSel.innerHTML = '<option value="">Select location...</option>';
      assetSel.innerHTML = '<option value="">Select location first...</option>';
      assetSel.disabled = true;
      if (company) {
        (opts.locationsByCompany?.[company] || []).forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          locationSel.appendChild(opt);
        });
        locationSel.disabled = false;
      } else {
        locationSel.disabled = true;
      }
    });

    locationSel?.addEventListener('change', () => {
      const location = locationSel.value;
      resetStation();
      assetSel.innerHTML = '<option value="">Select asset type...</option>';
      if (location) {
        (opts.assetTypesByLocation?.[location] || []).forEach(at => {
          const opt = document.createElement('option');
          opt.value = at;
          opt.textContent = at;
          assetSel.appendChild(opt);
        });
        assetSel.disabled = false;
      } else {
        assetSel.disabled = true;
      }
    });

    assetSel?.addEventListener('change', () => {
      const location = locationSel.value;
      const assetType = assetSel.value;
      resetStation();
      if (stationDropdown) {
        stationDropdown.innerHTML = '';
        stationDropdown.style.display = 'none';
      }
      if (location && assetType) {
        availableStations = stationsList.filter(s =>
          (stationLocation(s) === location) &&
          (stationAssetType(s) === assetType) &&
          (!companySel.value || normStr(s.company) === normStr(companySel.value))
        );
        if (stationInput) {
          stationInput.disabled = false;
          stationInput.placeholder = 'Type to search stations...';
        }
      } else {
        availableStations = [];
        if (stationInput) {
          stationInput.disabled = true;
          stationInput.placeholder = 'Select asset type first...';
        }
      }
    });

    if (stationInput && stationDropdown) {
      const renderDropdown = (term) => {
        stationDropdown.innerHTML = '';
        const needle = String(term || '').toLowerCase();
        const filtered = needle ? availableStations.filter(st => {
          const id = String(st.station_id || '').toLowerCase();
          const nm = String(st.name || '').toLowerCase();
          return id.includes(needle) || nm.includes(needle);
        }) : availableStations;
        if (!filtered.length) {
          stationDropdown.innerHTML = '<div style="padding:8px;color:#666;">No matching stations</div>';
          stationDropdown.style.display = 'block';
          return;
        }
        filtered.slice(0, 40).forEach(st => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:8px;cursor:pointer;border-bottom:1px solid #f0f0f0;';
          item.textContent = `${st.station_id} - ${st.name || ''}`;
          item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#f5f5f5'; });
          item.addEventListener('mouseleave', () => { item.style.backgroundColor = ''; });
          item.addEventListener('click', () => chooseStation(st));
          stationDropdown.appendChild(item);
        });
        stationDropdown.style.display = 'block';
      };

      stationInput.addEventListener('input', () => renderDropdown(stationInput.value));
      stationInput.addEventListener('focus', () => {
        if (availableStations.length) renderDropdown(stationInput.value);
      });
      document.addEventListener('click', (e) => {
        if (!stationDropdown.contains(e.target) && !stationInput.contains(e.target)) {
          stationDropdown.style.display = 'none';
        }
      });
    }

    return {
      getSelected() {
        const id = String(hidId?.value || '').trim();
        if (!id) return null;
        return stationsList.find(s => String(s.station_id) === id) || null;
      },
      reset() { resetStation(); }
    };
  }

  function buildRepairRow(it, idx, removeCb, fmtCostCell) {
    const tr = document.createElement('tr');
    const c1 = document.createElement('td'); c1.textContent = it.name || '';
    const c2 = document.createElement('td'); c2.textContent = it.severity || '';
    const c3 = document.createElement('td'); c3.textContent = it.priority || '';
    const c4 = document.createElement('td'); c4.textContent = fmtCostCell(it.cost);
    const c5 = document.createElement('td'); c5.textContent = it.type || '';
    const c6 = document.createElement('td'); c6.textContent = (it.days === 0 ? 0 : it.days || '');
    const c7 = document.createElement('td'); c7.textContent = it.category || '';
    const c8 = document.createElement('td');
    const del = document.createElement('button');
    del.className = 'btn btn-ghost btn-sm btn-danger';
    del.textContent = 'Remove';
    del.title = 'Remove';
    del.addEventListener('click', () => removeCb(idx));
    c8.appendChild(del);
    tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5); tr.appendChild(c6); tr.appendChild(c7); tr.appendChild(c8);
    return tr;
  }

  function openHistoryAddInspection() {
    const modal = $('#historyAddInspectionModal');
    if (!modal) return;
    if (!modal._ctx) {
      modal.innerHTML = `
        <div class="modal-content ih-modal__content" style="max-width:900px;width:92%;max-height:92vh;overflow:auto;">
          <div class="ih-modal__header">
            <h3>Add Inspection</h3>
            <p class="ih-subtitle">Create an inspection entry for any station.</p>
          </div>
          <div class="ih-modal__body">
            <section class="ih-section">
              <h4 class="ih-section__title">Station</h4>
              <div class="ih-grid">${buildStationSelectorHTML('ghi')}</div>
            </section>
            <section class="ih-section">
              <h4 class="ih-section__title">Details</h4>
              <div class="ih-grid">
                <div class="form-row required">
                  <label for="ghiYear">Year (YYYY)</label>
                  <input id="ghiYear" type="number" min="1000" max="9999" placeholder="2025" />
                </div>
                <div class="form-row required">
                  <label for="ghiName">Name (must include "inspection")</label>
                  <input id="ghiName" type="text" placeholder="Cableway Engineering Inspection" />
                </div>
                <div class="form-row">
                  <label for="ghiInspector">Inspector</label>
                  <input id="ghiInspector" type="text" placeholder="Inspector name" />
                </div>
                <div class="form-row" style="grid-column:1 / -1;">
                  <label for="ghiComment">Comment</label>
                  <textarea id="ghiComment" rows="3" placeholder="Any notes..."></textarea>
                </div>
              </div>
            </section>
            <section class="ih-section">
              <h4 class="ih-section__title">Files</h4>
              <div class="ih-file-row">
                <div class="ih-file-col">
                  <button id="ghiPickPhotos" class="btn">+ Add Photos</button>
                  <span id="ghiPhotosSummary" class="ih-badge">0 selected</span>
                </div>
                <div class="ih-file-col">
                  <button id="ghiPickReport" class="btn">+ Add Inspection Report (PDF)</button>
                  <span id="ghiReportSummary" class="ih-badge">None</span>
                </div>
              </div>
            </section>
            <section class="ih-section">
              <div class="ih-section__title-row">
                <h4 class="ih-section__title">Repairs (optional)</h4>
                <span class="ih-note">Add any repair items discovered during this inspection.</span>
              </div>
              <div class="ih-repairs-addGrid">
                <div class="form-row">
                  <label for="ghiRepName">Repair Name *</label>
                  <input id="ghiRepName" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghiRepSeverity">Severity</label>
                  <input id="ghiRepSeverity" type="text" placeholder="1-5" />
                </div>
                <div class="form-row">
                  <label for="ghiRepPriority">Priority</label>
                  <input id="ghiRepPriority" type="text" placeholder="1-5" />
                </div>
                <div class="form-row">
                  <label for="ghiRepCost">Cost</label>
                  <input id="ghiRepCost" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghiRepType">Type / Scope Type</label>
                  <input id="ghiRepType" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghiRepDays">Days</label>
                  <input id="ghiRepDays" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghiRepCategory">Category</label>
                  <select id="ghiRepCategory">
                    <option value="Capital">Capital</option>
                    <option value="O&M">O&M</option>
                    <option value="Decommission">Decommission</option>
                  </select>
                </div>
                <div class="form-row form-row--button">
                  <button id="ghiAddRepairBtn" class="btn">+ Add Repair</button>
                </div>
              </div>
              <div class="table-scroll ih-table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:40%;">Repair Name</th>
                      <th>Severity</th>
                      <th>Priority</th>
                      <th>Cost</th>
                      <th>Type / Scope Type</th>
                      <th>Days</th>
                      <th>Category</th>
                      <th style="width:54px;">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody id="ghiRepairsTbody">
                    <tr class="ih-repairs-empty">
                      <td colspan="8" style="text-align:center;color:#6b7280;">No repairs added</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
            <div id="ghiError" class="ih-error" style="display:none;"></div>
          </div>
          <div class="ih-modal__footer">
            <button id="ghiCreateBtn" class="btn btn-primary">Create</button>
            <button id="ghiCancelBtn" class="btn btn-ghost">Cancel</button>
          </div>
        </div>`;

      const stationCtrl = wireStationSelector(modal, 'ghi');
      const yearEl = modal.querySelector('#ghiYear');
      const nameEl = modal.querySelector('#ghiName');
      const inspEl = modal.querySelector('#ghiInspector');
      const commEl = modal.querySelector('#ghiComment');
      const errEl = modal.querySelector('#ghiError');
      const createEl = modal.querySelector('#ghiCreateBtn');
      const cancelEl = modal.querySelector('#ghiCancelBtn');
      const pickPhotos = modal.querySelector('#ghiPickPhotos');
      const photosSum = modal.querySelector('#ghiPhotosSummary');
      const pickReport = modal.querySelector('#ghiPickReport');
      const reportSum = modal.querySelector('#ghiReportSummary');
      const repName = modal.querySelector('#ghiRepName');
      const repSeverity = modal.querySelector('#ghiRepSeverity');
      const repPriority = modal.querySelector('#ghiRepPriority');
      const repCost = modal.querySelector('#ghiRepCost');
      const repType = modal.querySelector('#ghiRepType');
      const repDays = modal.querySelector('#ghiRepDays');
      const repCategory = modal.querySelector('#ghiRepCategory');
      const addRepairBtn = modal.querySelector('#ghiAddRepairBtn');
      const repairsTbody = modal.querySelector('#ghiRepairsTbody');

      const ctx = {
        stationCtrl,
        yearEl, nameEl, inspEl, commEl, errEl,
        createEl, cancelEl, pickPhotos, photosSum, pickReport, reportSum,
        repName, repSeverity, repPriority, repCost, repType, repDays, repCategory,
        addRepairBtn, repairsTbody,
        selectedPhotos: [],
        selectedReport: null,
        pendingRepairs: []
      };

      const fmtCostCell = (v) => {
        if (typeof v === 'number' && Number.isFinite(v)) {
          try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
          catch { return `$${Math.round(v).toLocaleString()}`; }
        }
        const s = String(v ?? '').trim();
        return s || '';
      };

      ctx.renderRepairs = () => {
        if (!ctx.repairsTbody) return;
        ctx.repairsTbody.innerHTML = '';
        if (!ctx.pendingRepairs.length) {
          const tr = document.createElement('tr');
          tr.className = 'ih-repairs-empty';
          const td = document.createElement('td');
          td.colSpan = 8;
          td.style.textAlign = 'center';
          td.style.color = '#6b7280';
          td.textContent = 'No repairs added';
          tr.appendChild(td);
          ctx.repairsTbody.appendChild(tr);
          return;
        }
        ctx.pendingRepairs.forEach((it, idx) => {
          ctx.repairsTbody.appendChild(buildRepairRow(it, idx, (i) => { ctx.pendingRepairs.splice(i, 1); ctx.renderRepairs(); }, fmtCostCell));
        });
      };

      ctx.setError = (msg) => {
        if (!ctx.errEl) return;
        if (msg) { ctx.errEl.textContent = msg; ctx.errEl.style.display = 'block'; }
        else { ctx.errEl.textContent = ''; ctx.errEl.style.display = 'none'; }
      };

      const validateRepair = (it) => {
        if (!it.name) return 'Repair Name is required.';
        if (!/^Capital$|^O&?M$|^Decomm/i.test(it.category || 'Capital')) return 'Select a valid Category.';
        return null;
      };

      const readRepairForm = () => {
        const name = String(ctx.repName?.value || '').trim();
        const severity = String(ctx.repSeverity?.value || '').trim();
        const priority = String(ctx.repPriority?.value || '').trim();
        const rawCost = String(ctx.repCost?.value || '').trim();
        const rawDays = String(ctx.repDays?.value || '').trim();
        const category = ctx.repCategory?.value || 'Capital';
        const type = String(ctx.repType?.value || '').trim() || 'Repair';
        let cost = rawCost ? Number(rawCost.replace(/[, ]/g, '')) : '';
        if (!Number.isFinite(cost)) cost = rawCost;
        let days = rawDays ? Number(rawDays.replace(/[, ]/g, '')) : '';
        if (!Number.isFinite(days)) days = rawDays;
        return { name, severity, priority, cost, category, type, days };
      };

      const clearRepairForm = () => {
        if (ctx.repName) ctx.repName.value = '';
        if (ctx.repSeverity) ctx.repSeverity.value = '';
        if (ctx.repPriority) ctx.repPriority.value = '';
        if (ctx.repCost) ctx.repCost.value = '';
        if (ctx.repType) ctx.repType.value = '';
        if (ctx.repDays) ctx.repDays.value = '';
        if (ctx.repCategory) ctx.repCategory.value = 'Capital';
      };

      ctx.addRepairBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const it = readRepairForm();
        const err = validateRepair(it);
        if (err) { ctx.setError(err); return; }
        ctx.pendingRepairs.push(it);
        clearRepairForm();
        ctx.renderRepairs();
        ctx.setError('');
      });

      ctx.pickPhotos?.addEventListener('click', async () => {
        try {
          const res = await window.electronAPI.pickInspectionPhotos();
          const filePaths = Array.isArray(res?.filePaths) ? res.filePaths : [];
          ctx.selectedPhotoFiles = Array.isArray(res?._files) ? res._files : [];
          if (!filePaths.length) {
            ctx.selectedPhotos = [];
            ctx.selectedPhotoFiles = [];
            if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
            return;
          }
          const stn = ctx.stationCtrl.getSelected();
          if (typeof window.openFileNamingPopup === 'function' && typeof window.applyNamingToList === 'function' && stn) {
            const cfg = await window.openFileNamingPopup({
              station: stn,
              files: filePaths,
              defaultExt: ''
            });
            if (!cfg) {
              ctx.selectedPhotos = [];
              ctx.selectedPhotoFiles = [];
              if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
              return;
            }
            const renamed = window.applyNamingToList({
              station: stn,
              files: filePaths,
              config: cfg
            });
            ctx.selectedPhotos = renamed.map((r, i) => ({ path: filePaths[i], name: r.newName }));
          } else {
            ctx.selectedPhotos = filePaths.slice();
          }
          if (ctx.photosSum) ctx.photosSum.textContent = `${filePaths.length} selected`;
        } catch (e) {
          console.error('[history] pickInspectionPhotos failed', e);
        }
      });

      ctx.pickReport?.addEventListener('click', async () => {
        try {
          const res = await window.electronAPI.pickInspectionReport();
          ctx.selectedReport = res?.filePath || null;
          ctx.selectedReportFile = res?._file || null;
          if (ctx.reportSum) ctx.reportSum.textContent = ctx.selectedReport ? '1 PDF selected' : 'None';
        } catch (e) {
          console.error('[history] pickInspectionReport failed', e);
        }
      });

      const validateForm = () => {
        const stn = ctx.stationCtrl.getSelected();
        if (!stn) return 'Select a station.';
        const year = Number(ctx.yearEl?.value || '');
        const name = String(ctx.nameEl?.value || '').trim();
        if (!Number.isInteger(year) || year < 1000 || year > 9999) return 'Enter a valid 4-digit year.';
        if (!name || !/inspection/i.test(name)) return 'Name is required and must include the word "inspection".';
        return null;
      };

      ctx.createEl?.addEventListener('click', async () => {
        const err = validateForm();
        if (err) { ctx.setError(err); return; }
        ctx.setError('');
        const stn = ctx.stationCtrl.getSelected();
        const payload = {
          year: Number(ctx.yearEl?.value || 0),
          name: String(ctx.nameEl?.value || '').trim(),
          inspector: String(ctx.inspEl?.value || '').trim(),
          comment: String(ctx.commEl?.value || '').trim(),
          photos: ctx.selectedPhotos,
          report: ctx.selectedReport,
          _photoFiles: ctx.selectedPhotoFiles || [],
          _reportFile: ctx.selectedReportFile || null,
        };
        ctx.createEl.disabled = true;
        ctx.createEl.textContent = 'Creating…';
        try {
          const res = await window.electronAPI.createInspection(stn.name, stn.station_id, payload);
          if (!res?.success) {
            ctx.setError(res?.message || 'Failed to create inspection.');
            return;
          }
          if (ctx.pendingRepairs.length) {
            try {
              const current = await window.electronAPI.listRepairs(stn.name, stn.station_id);
              const merged = Array.isArray(current) ? current.concat(ctx.pendingRepairs) : ctx.pendingRepairs.slice();
              await window.electronAPI.saveRepairs(stn.name, stn.station_id, merged);
            } catch (repErr) {
              console.warn('[history] failed to save repairs with inspection', repErr);
            }
          }
          historyState.loaded = false;
          modal.style.display = 'none';
          await ensureHistoryData(true);
        } catch (e) {
          console.error('[history] createInspection failed', e);
          ctx.setError('Failed to create inspection.');
        } finally {
          ctx.createEl.disabled = false;
          ctx.createEl.textContent = 'Create';
        }
      });

      ctx.cancelEl?.addEventListener('click', () => { modal.style.display = 'none'; });

      modal._ctx = ctx;
    }

    const ctx = modal._ctx;
    ctx.pendingRepairs = [];
    ctx.selectedPhotos = [];
    ctx.selectedPhotoFiles = [];
    ctx.selectedReport = null;
    ctx.selectedReportFile = null;
    ctx.stationCtrl.reset();
    if (ctx.yearEl && (!ctx.yearEl.value || Number(ctx.yearEl.value) < 1000)) ctx.yearEl.value = String(new Date().getFullYear());
    if (ctx.nameEl && !ctx.nameEl.value) ctx.nameEl.value = 'Cableway Engineering Inspection';
    if (ctx.inspEl) ctx.inspEl.value = '';
    if (ctx.commEl) ctx.commEl.value = '';
    if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
    if (ctx.reportSum) ctx.reportSum.textContent = 'None';
    ctx.renderRepairs();
    ctx.setError('');
    modal.style.display = 'flex';
  }

  function openHistoryAddProject() {
    const modal = $('#historyAddProjectModal');
    if (!modal) return;
    if (!modal._ctx) {
      modal.innerHTML = `
        <div class="modal-content ph-modal__content" style="max-width:900px;width:92%;max-height:92vh;overflow:auto;">
          <div class="ph-modal__header">
            <h3>Add Project Entry</h3>
            <p class="ph-subtitle">Create a project entry for any station.</p>
          </div>
          <div class="ph-modal__body">
            <section class="ph-section">
              <h4 class="ph-section__title">Station</h4>
              <div class="ph-grid">${buildStationSelectorHTML('ghp')}</div>
            </section>
            <section class="ph-section">
              <h4 class="ph-section__title">Details</h4>
              <div class="ph-grid">
                <div class="form-row required">
                  <label for="ghpYear">Year (YYYY)</label>
                  <input id="ghpYear" type="number" min="1000" max="9999" placeholder="2025" />
                </div>
                <div class="form-row required">
                  <label for="ghpName">Name</label>
                  <input id="ghpName" type="text" placeholder="Infrastructure Project" />
                </div>
                <div class="form-row">
                  <label for="ghpLead">Project Lead</label>
                  <input id="ghpLead" type="text" placeholder="Project lead" />
                </div>
                <div class="form-row" style="grid-column:1 / -1;">
                  <label for="ghpComment">Comment</label>
                  <textarea id="ghpComment" rows="3" placeholder="Any notes..."></textarea>
                </div>
              </div>
            </section>
            <section class="ph-section">
              <h4 class="ph-section__title">Files</h4>
              <div class="ph-file-row">
                <div class="ph-file-col">
                  <button id="ghpPickPhotos" class="btn">+ Add Photos</button>
                  <span id="ghpPhotosSummary" class="ph-badge">0 selected</span>
                </div>
                <div class="ph-file-col">
                  <button id="ghpPickReport" class="btn">+ Add Project Report (PDF)</button>
                  <span id="ghpReportSummary" class="ph-badge">None</span>
                </div>
              </div>
            </section>
            <section class="ph-section">
              <div class="ph-section__title-row">
                <h4 class="ph-section__title">Repairs (optional)</h4>
                <span class="ph-note">Add any repair items associated with this project.</span>
              </div>
              <div class="ph-repairs-addGrid">
                <div class="form-row">
                  <label for="ghpRepName">Repair Name *</label>
                  <input id="ghpRepName" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghpRepSeverity">Severity</label>
                  <input id="ghpRepSeverity" type="text" placeholder="1-5" />
                </div>
                <div class="form-row">
                  <label for="ghpRepPriority">Priority</label>
                  <input id="ghpRepPriority" type="text" placeholder="1-5" />
                </div>
                <div class="form-row">
                  <label for="ghpRepCost">Cost</label>
                  <input id="ghpRepCost" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghpRepType">Type / Scope Type</label>
                  <input id="ghpRepType" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghpRepDays">Days</label>
                  <input id="ghpRepDays" type="text" />
                </div>
                <div class="form-row">
                  <label for="ghpRepCategory">Category</label>
                  <select id="ghpRepCategory">
                    <option value="Capital">Capital</option>
                    <option value="O&M">O&M</option>
                    <option value="Decommission">Decommission</option>
                  </select>
                </div>
                <div class="form-row form-row--button">
                  <button id="ghpAddRepairBtn" class="btn">+ Add Repair</button>
                </div>
              </div>
              <div class="table-scroll ph-table-scroll">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:40%;">Repair Name</th>
                      <th>Severity</th>
                      <th>Priority</th>
                      <th>Cost</th>
                      <th>Type / Scope Type</th>
                      <th>Days</th>
                      <th>Category</th>
                      <th style="width:54px;">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody id="ghpRepairsTbody">
                    <tr class="ph-repairs-empty">
                      <td colspan="8" style="text-align:center;color:#6b7280;">No repairs added</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
            <div id="ghpError" class="ph-error" style="display:none;"></div>
          </div>
          <div class="ph-modal__footer">
            <button id="ghpCreateBtn" class="btn btn-primary">Create</button>
            <button id="ghpCancelBtn" class="btn btn-ghost">Cancel</button>
          </div>
        </div>`;

      const stationCtrl = wireStationSelector(modal, 'ghp');
      const yearEl = modal.querySelector('#ghpYear');
      const nameEl = modal.querySelector('#ghpName');
      const leadEl = modal.querySelector('#ghpLead');
      const commEl = modal.querySelector('#ghpComment');
      const errEl = modal.querySelector('#ghpError');
      const createEl = modal.querySelector('#ghpCreateBtn');
      const cancelEl = modal.querySelector('#ghpCancelBtn');
      const pickPhotos = modal.querySelector('#ghpPickPhotos');
      const photosSum = modal.querySelector('#ghpPhotosSummary');
      const pickReport = modal.querySelector('#ghpPickReport');
      const reportSum = modal.querySelector('#ghpReportSummary');
      const repName = modal.querySelector('#ghpRepName');
      const repSeverity = modal.querySelector('#ghpRepSeverity');
      const repPriority = modal.querySelector('#ghpRepPriority');
      const repCost = modal.querySelector('#ghpRepCost');
      const repType = modal.querySelector('#ghpRepType');
      const repDays = modal.querySelector('#ghpRepDays');
      const repCategory = modal.querySelector('#ghpRepCategory');
      const addRepairBtn = modal.querySelector('#ghpAddRepairBtn');
      const repairsTbody = modal.querySelector('#ghpRepairsTbody');

      const ctx = {
        stationCtrl,
        yearEl, nameEl, leadEl, commEl, errEl,
        createEl, cancelEl, pickPhotos, photosSum, pickReport, reportSum,
        repName, repSeverity, repPriority, repCost, repType, repDays, repCategory,
        addRepairBtn, repairsTbody,
        selectedPhotos: [],
        selectedReport: null,
        pendingRepairs: []
      };

      const fmtCostCell = (v) => {
        if (typeof v === 'number' && Number.isFinite(v)) {
          try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
          catch { return `$${Math.round(v).toLocaleString()}`; }
        }
        const s = String(v ?? '').trim();
        return s || '';
      };

      ctx.renderRepairs = () => {
        if (!ctx.repairsTbody) return;
        ctx.repairsTbody.innerHTML = '';
        if (!ctx.pendingRepairs.length) {
          const tr = document.createElement('tr');
          tr.className = 'ph-repairs-empty';
          const td = document.createElement('td');
          td.colSpan = 8;
          td.style.textAlign = 'center';
          td.style.color = '#6b7280';
          td.textContent = 'No repairs added';
          tr.appendChild(td);
          ctx.repairsTbody.appendChild(tr);
          return;
        }
        ctx.pendingRepairs.forEach((it, idx) => {
          ctx.repairsTbody.appendChild(buildRepairRow(it, idx, (i) => { ctx.pendingRepairs.splice(i, 1); ctx.renderRepairs(); }, fmtCostCell));
        });
      };

      ctx.setError = (msg) => {
        if (!ctx.errEl) return;
        if (msg) { ctx.errEl.textContent = msg; ctx.errEl.style.display = 'block'; }
        else { ctx.errEl.textContent = ''; ctx.errEl.style.display = 'none'; }
      };

      const validateRepair = (it) => {
        if (!it.name) return 'Repair Name is required.';
        if (!/^Capital$|^O&?M$|^Decomm/i.test(it.category || 'Capital')) return 'Select a valid Category.';
        return null;
      };

      const readRepairForm = () => {
        const name = String(ctx.repName?.value || '').trim();
        const severity = String(ctx.repSeverity?.value || '').trim();
        const priority = String(ctx.repPriority?.value || '').trim();
        const rawCost = String(ctx.repCost?.value || '').trim();
        const rawDays = String(ctx.repDays?.value || '').trim();
        const category = ctx.repCategory?.value || 'Capital';
        const type = String(ctx.repType?.value || '').trim() || 'Repair';
        let cost = rawCost ? Number(rawCost.replace(/[, ]/g, '')) : '';
        if (!Number.isFinite(cost)) cost = rawCost;
        let days = rawDays ? Number(rawDays.replace(/[, ]/g, '')) : '';
        if (!Number.isFinite(days)) days = rawDays;
        return { name, severity, priority, cost, category, type, days };
      };

      const clearRepairForm = () => {
        if (ctx.repName) ctx.repName.value = '';
        if (ctx.repSeverity) ctx.repSeverity.value = '';
        if (ctx.repPriority) ctx.repPriority.value = '';
        if (ctx.repCost) ctx.repCost.value = '';
        if (ctx.repType) ctx.repType.value = '';
        if (ctx.repDays) ctx.repDays.value = '';
        if (ctx.repCategory) ctx.repCategory.value = 'Capital';
      };

      ctx.addRepairBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        const it = readRepairForm();
        const err = validateRepair(it);
        if (err) { ctx.setError(err); return; }
        ctx.pendingRepairs.push(it);
        clearRepairForm();
        ctx.renderRepairs();
        ctx.setError('');
      });

      ctx.pickPhotos?.addEventListener('click', async () => {
        try {
          const res = await window.electronAPI.pickProjectPhotos();
          const filePaths = Array.isArray(res?.filePaths) ? res.filePaths : [];
          ctx.selectedPhotoFiles = Array.isArray(res?._files) ? res._files : [];
          if (!filePaths.length) {
            ctx.selectedPhotos = [];
            ctx.selectedPhotoFiles = [];
            if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
            return;
          }
          const stn = ctx.stationCtrl.getSelected();
          if (typeof window.openFileNamingPopup === 'function' && typeof window.applyNamingToList === 'function' && stn) {
            const cfg = await window.openFileNamingPopup({
              station: stn,
              files: filePaths,
              defaultExt: ''
            });
            if (!cfg) {
              ctx.selectedPhotos = [];
              ctx.selectedPhotoFiles = [];
              if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
              return;
            }
            const renamed = window.applyNamingToList({
              station: stn,
              files: filePaths,
              config: cfg
            });
            ctx.selectedPhotos = renamed.map((r, i) => ({ path: filePaths[i], name: r.newName }));
          } else {
            ctx.selectedPhotos = filePaths.slice();
          }
          if (ctx.photosSum) ctx.photosSum.textContent = `${filePaths.length} selected`;
        } catch (e) {
          console.error('[history] pickProjectPhotos failed', e);
        }
      });

      ctx.pickReport?.addEventListener('click', async () => {
        try {
          const res = await window.electronAPI.pickProjectReport();
          ctx.selectedReport = res?.filePath || null;
          ctx.selectedReportFile = res?._file || null;
          if (ctx.reportSum) ctx.reportSum.textContent = ctx.selectedReport ? '1 PDF selected' : 'None';
        } catch (e) {
          console.error('[history] pickProjectReport failed', e);
        }
      });

      const validateForm = () => {
        const stn = ctx.stationCtrl.getSelected();
        if (!stn) return 'Select a station.';
        const year = Number(ctx.yearEl?.value || '');
        const name = String(ctx.nameEl?.value || '').trim();
        if (!Number.isInteger(year) || year < 1000 || year > 9999) return 'Enter a valid 4-digit year.';
        if (!name) return 'Name is required.';
        return null;
      };

      ctx.createEl?.addEventListener('click', async () => {
        const err = validateForm();
        if (err) { ctx.setError(err); return; }
        ctx.setError('');
        const stn = ctx.stationCtrl.getSelected();
        const payload = {
          year: Number(ctx.yearEl?.value || 0),
          name: String(ctx.nameEl?.value || '').trim(),
          projectLead: String(ctx.leadEl?.value || '').trim(),
          comment: String(ctx.commEl?.value || '').trim(),
          photos: ctx.selectedPhotos,
          report: ctx.selectedReport,
          _photoFiles: ctx.selectedPhotoFiles || [],
          _reportFile: ctx.selectedReportFile || null,
        };
        ctx.createEl.disabled = true;
        ctx.createEl.textContent = 'Creating…';
        try {
          const res = await window.electronAPI.createProject(stn.name, stn.station_id, payload);
          if (!res?.success) {
            ctx.setError(res?.message || 'Failed to create project.');
            return;
          }
          if (ctx.pendingRepairs.length) {
            try {
              await window.electronAPI.saveRepairs(stn.name, stn.station_id, ctx.pendingRepairs);
            } catch (repErr) {
              console.warn('[history] failed to save project repairs', repErr);
            }
          }
          historyState.loaded = false;
          modal.style.display = 'none';
          await ensureHistoryData(true);
        } catch (e) {
          console.error('[history] createProject failed', e);
          ctx.setError('Failed to create project.');
        } finally {
          ctx.createEl.disabled = false;
          ctx.createEl.textContent = 'Create';
        }
      });

      ctx.cancelEl?.addEventListener('click', () => { modal.style.display = 'none'; });

      modal._ctx = ctx;
    }

    const ctx = modal._ctx;
    ctx.pendingRepairs = [];
    ctx.selectedPhotos = [];
    ctx.selectedPhotoFiles = [];
    ctx.selectedReport = null;
    ctx.selectedReportFile = null;
    ctx.stationCtrl.reset();
    if (ctx.yearEl && (!ctx.yearEl.value || Number(ctx.yearEl.value) < 1000)) ctx.yearEl.value = String(new Date().getFullYear());
    if (ctx.nameEl && !ctx.nameEl.value) ctx.nameEl.value = 'Infrastructure Project';
    if (ctx.leadEl) ctx.leadEl.value = '';
    if (ctx.commEl) ctx.commEl.value = '';
    if (ctx.photosSum) ctx.photosSum.textContent = '0 selected';
    if (ctx.reportSum) ctx.reportSum.textContent = 'None';
    ctx.renderRepairs();
    ctx.setError('');
    modal.style.display = 'flex';
  }

  function openHistoryKeywordModal(kind) {
    const isInspection = kind === 'inspection';
    const modalId = isInspection ? 'historyInspectionKeywordsModal' : 'historyProjectKeywordsModal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;width:92%;display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="margin:0;">${isInspection ? 'Inspection' : 'Project'} Folder Keywords</h3>
            <button class="btn btn-ghost" data-role="close">Close</button>
          </div>
          <p class="ih-note">Folders whose names contain any of these words are treated as ${isInspection ? 'inspections' : 'projects'}.</p>
          <div>
            <div data-role="chips" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <input data-role="input" type="text" placeholder="Add a word (e.g., assessment)" style="flex:1;"/>
              <button class="btn" data-role="add">Add</button>
            </div>
            <small class="ih-help">Words are matched case-insensitively and can be partial.</small>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="btn btn-ghost" data-role="reset">Reset</button>
            <button class="btn btn-primary" data-role="save">Save</button>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const chipsEl = modal.querySelector('[data-role="chips"]');
      const inputEl = modal.querySelector('[data-role="input"]');
      const addBtn = modal.querySelector('[data-role="add"]');
      const saveBtn = modal.querySelector('[data-role="save"]');
      const resetBtn = modal.querySelector('[data-role="reset"]');
      const closeBtn = modal.querySelector('[data-role="close"]');

      const ctx = { keywords: [], chipsEl, inputEl, addBtn, saveBtn, resetBtn, closeBtn };

      ctx.renderChips = () => {
        if (!ctx.chipsEl) return;
        ctx.chipsEl.innerHTML = '';
        if (!ctx.keywords.length) {
          const ghost = document.createElement('span');
          ghost.style.color = '#6b7280';
          ghost.textContent = '(no words — nothing will show)';
          ctx.chipsEl.appendChild(ghost);
          return;
        }
        ctx.keywords.forEach((w, idx) => {
          const chip = document.createElement('span');
          chip.className = 'badge';
          chip.style.display = 'inline-flex';
          chip.style.alignItems = 'center';
          chip.style.gap = '6px';
          chip.style.padding = '4px 8px';
          chip.style.border = '1px solid var(--border)';
          chip.style.borderRadius = '999px';
          chip.style.background = '#f3f4f6';
          chip.textContent = w;
          const x = document.createElement('button');
          x.className = 'btn btn-ghost btn-sm';
          x.textContent = '×';
          x.title = `Remove "${w}"`;
          x.addEventListener('click', () => {
            ctx.keywords.splice(idx, 1);
            ctx.renderChips();
          });
          chip.appendChild(x);
          ctx.chipsEl.appendChild(chip);
        });
      };

      const addWord = () => {
        const raw = String(ctx.inputEl?.value || '').trim();
        if (!raw) return;
        const norm = raw.toLowerCase();
        if (!ctx.keywords.includes(norm)) ctx.keywords.push(norm);
        ctx.inputEl.value = '';
        ctx.renderChips();
      };

      ctx.addBtn?.addEventListener('click', addWord);
      ctx.inputEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addWord(); } });
      ctx.resetBtn?.addEventListener('click', () => {
        ctx.keywords = isInspection ? ['inspection'] : ['project', 'construction', 'maintenance', 'repair', 'decommission'];
        ctx.renderChips();
      });
      ctx.saveBtn?.addEventListener('click', async () => {
        try {
          if (isInspection) await window.electronAPI.setInspectionKeywords(ctx.keywords.slice());
          else await window.electronAPI.setProjectKeywords(ctx.keywords.slice());
          historyState.loaded = false;
          modal.style.display = 'none';
          await ensureHistoryData(true);
        } catch (e) {
          console.error('[history] save keywords failed', e);
          appAlert('Failed to save keywords.');
        }
      });
      ctx.closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

      modal._ctx = ctx;
    }

    const ctx = modal._ctx;
    (async () => {
      try {
        if (isInspection) {
          ctx.keywords = await window.electronAPI.getInspectionKeywords() || ['inspection'];
        } else {
          ctx.keywords = await window.electronAPI.getProjectKeywords() || ['project', 'construction', 'maintenance', 'repair', 'decommission'];
        }
        if (!Array.isArray(ctx.keywords) || !ctx.keywords.length) {
          ctx.keywords = isInspection ? ['inspection'] : ['project', 'construction', 'maintenance', 'repair', 'decommission'];
        }
      } catch (e) {
        ctx.keywords = isInspection ? ['inspection'] : ['project', 'construction', 'maintenance', 'repair', 'decommission'];
      }
      ctx.renderChips();
      modal.style.display = 'flex';
      setTimeout(() => ctx.inputEl?.focus(), 20);
    })();
  }

  // ---- Autocomplete (matches Optimization tab) ----------------------------

  function _clearAutocompleteLists() {
    document.querySelectorAll('.autocomplete-items').forEach(n => n.remove());
  }

  function _cloneInput(input) {
    if (!input) return input;
    const val = input.value;
    const clone = input.cloneNode(true);
    input.parentNode.replaceChild(clone, input);
    clone.value = val;
    return clone;
  }

  function applyAutocomplete(input, suggestions) {
    if (!input) return input;
    _clearAutocompleteLists();
    const clone = _cloneInput(input);
    let currentFocus = -1;
    let listDiv = null;

    const closeAllLists = () => {
      document.querySelectorAll('.autocomplete-items').forEach(list => list.remove());
      currentFocus = -1;
    };

    function buildList(filterVal) {
      closeAllLists();
      listDiv = document.createElement('div');
      listDiv.setAttribute('class', 'autocomplete-items');
      listDiv.style.position = 'absolute';
      listDiv.style.top = '100%';
      listDiv.style.left = '0';
      listDiv.style.right = '0';
      listDiv.style.maxHeight = '220px';
      listDiv.style.overflowY = 'auto';
      listDiv.style.background = '#fff';
      listDiv.style.border = '1px solid #d4d4d4';
      listDiv.style.borderTop = 'none';
      listDiv.style.zIndex = '99';

      clone.parentNode.classList.add('autocomplete-wrapper');
      clone.parentNode.style.position = 'relative';
      clone.parentNode.appendChild(listDiv);

      const val = (filterVal || '').toLowerCase();
      suggestions.forEach(suggestion => {
        const s = String(suggestion ?? '');
        const sLower = s.toLowerCase();
        if (val && !sLower.includes(val)) return;
        const item = document.createElement('div');
        item.style.padding = '10px';
        item.style.cursor = 'pointer';
        item.style.backgroundColor = '#fafafa';
        if (val) {
          const idx = sLower.indexOf(val);
          const before = s.slice(0, idx);
          const match = s.slice(idx, idx + val.length);
          const after = s.slice(idx + val.length);
          item.innerHTML = `${before}<strong>${match}</strong>${after}`;
        } else {
          item.textContent = s;
        }
        item.addEventListener('mousedown', (e) => e.preventDefault());
        item.addEventListener('click', () => {
          clone.value = s;
          closeAllLists();
          clone.dispatchEvent(new Event('input', { bubbles: true }));
          clone.dispatchEvent(new Event('change', { bubbles: true }));
        });
        listDiv.appendChild(item);
      });
      currentFocus = -1;
    }

    clone.addEventListener('focus', () => buildList(clone.value));
    clone.addEventListener('click', () => {
      const open = clone.parentNode.querySelector('.autocomplete-items');
      if (!open) buildList(clone.value);
    });
    clone.addEventListener('input', () => buildList(clone.value));
    clone.addEventListener('blur', () => setTimeout(() => closeAllLists(), 120));
    clone.addEventListener('keydown', (e) => {
      let items = clone.parentNode.querySelector('.autocomplete-items');
      if (items) items = items.getElementsByTagName('div');
      if (e.keyCode === 40) { // down
        currentFocus++; addActive(items); e.preventDefault();
      } else if (e.keyCode === 38) { // up
        currentFocus--; addActive(items); e.preventDefault();
      } else if (e.keyCode === 13) { // enter
        e.preventDefault();
        if (currentFocus > -1 && items && items[currentFocus]) items[currentFocus].click();
      }
    });

    function addActive(items) {
      if (!items || !items.length) return;
      removeActive(items);
      if (currentFocus >= items.length) currentFocus = 0;
      if (currentFocus < 0) currentFocus = items.length - 1;
      items[currentFocus].classList.add('autocomplete-active');
    }
    function removeActive(items) {
      Array.from(items || []).forEach(it => it.classList.remove('autocomplete-active'));
    }

    return clone;
  }

  (function installAutocompleteCloserOnce() {
    if (window.__acCloserInstalled) return;
    window.__acCloserInstalled = true;
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.autocomplete-wrapper') || e.target.closest('.autocomplete-items')) return;
      _clearAutocompleteLists();
    }, true);
  })();

  // ---- Builder wiring ------------------------------------------------------

  function fillSelect(select, options, placeholder = 'All') {
    if (!select) return;
    const placeholderText = select.dataset.placeholder || placeholder;
    select.innerHTML = `<option value="">${placeholderText}</option>` + (options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  }

  function rebuildScopeDropdowns() {
    const opts = state.filterOptions;
    fillSelect(analyticsUI.companySelect, opts.companies, 'All companies');
    const locs = analyticsUI.companySelect?.value
      ? (opts.locationsByCompany[analyticsUI.companySelect.value] || opts.allLocations)
      : opts.allLocations;
    fillSelect(analyticsUI.locationSelect, locs, 'All locations');

    const assets = (() => {
      const co = analyticsUI.companySelect?.value;
      const loc = analyticsUI.locationSelect?.value;
      if (co && loc && opts.assetsByCompanyLocation[co]?.[loc]) return opts.assetsByCompanyLocation[co][loc];
      if (loc && opts.assetsByLocation[loc]) return opts.assetsByLocation[loc];
      return opts.allAssetTypes;
    })();
    fillSelect(analyticsUI.assetSelect, assets, 'All asset types');
  }

  function rebuildAggregateOptions() {
    if (!analyticsUI.aggregateSelect) return;
    const hasCompany = state.filterOptions.companies.length > 0;
    const hasLocation = state.filterOptions.allLocations.length > 0;
    const hasAsset = state.filterOptions.allAssetTypes.length > 0;
    const levels = [];
    if (hasCompany) levels.push('Company');
    if (hasLocation) levels.push('Location');
    if (hasAsset) levels.push('Asset Type');
    const combos = [];
    for (let i = 0; i < levels.length; i++) {
      for (let j = i; j < levels.length; j++) {
        const slice = levels.slice(i, j + 1);
        if (slice.join(' ') === 'Company Asset Type') continue;
        combos.push(slice);
      }
    }
    const valid = combos.filter(c => ['Company', 'Company,Location', 'Company,Location,Asset Type', 'Location', 'Location,Asset Type', 'Asset Type'].includes(c.join(',')));
    analyticsUI.aggregateSelect.innerHTML = '';
    valid.forEach(path => {
      const val = path.join('|');
      const label = path.join(' -> ');
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      analyticsUI.aggregateSelect.appendChild(opt);
    });
  }

  function attachFieldAutocomplete(input) {
    if (!input) return input;
    return applyAutocomplete(input, state.fieldNames);
  }

  function createNumeratorRow(initial = {}) {
    const row = document.createElement('div');
    row.className = 'numerator-row';
    row.innerHTML = `
      <div class="search-select">
        <input type="text" class="num-field" placeholder="Field" autocomplete="off" />
      </div>
      <select class="num-value">
        <option value="">Pick a value</option>
      </select>
      <button class="btn btn-ghost num-remove" title="Remove">\u00d7</button>
    `;
    
    // We grab these initially, but 'fieldInput' might get replaced by autocomplete later
    let fieldInput = row.querySelector('.num-field');
    const valueSelect = row.querySelector('.num-value');
    const removeBtn = row.querySelector('.num-remove');
    const scoped = () => getScopeFromUI();

    const refreshValues = () => {
      // FIX: Always query the DOM for the 'live' input, because autocomplete clones/replaces it
      const currentInput = row.querySelector('.num-field');
      const fieldName = currentInput ? currentInput.value.trim() : '';
      
      if (!fieldName) {
        valueSelect.innerHTML = '<option value="">Pick a value</option>';
        return;
      }

      // Use the smarter getFieldValue logic (fuzzy match) via collectValuesForField
      const vals = collectValuesForField(fieldName, scoped());
      const currentVal = valueSelect.value;
      
      if (vals.length === 0) {
         // If we found the key but all values are empty, this might show 'Unknown'
         // If we didn't find the key at all, it returns empty.
         valueSelect.innerHTML = '<option value="">No values found</option>';
      } else {
         valueSelect.innerHTML = `<option value="">Pick a value</option>` + 
           vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      }

      // Restore selection if it still exists in the new list
      if (currentVal && vals.includes(currentVal)) {
        valueSelect.value = currentVal;
      }
    };

    // 1. Attach Autocomplete (This replaces the input element in the DOM)
    // We store the new reference in row._fieldInput for safety
    row._fieldInput = attachFieldAutocomplete(fieldInput);
    
    // 2. Refresh when the text changes (using the NEW input)
    row._fieldInput.addEventListener('change', refreshValues);
    
    // 3. Refresh ON CLICK/FOCUS (Fixes the "blank on first click" issue)
    // We use a tiny timeout to let the autocomplete click finish writing the value
    valueSelect.addEventListener('focus', () => setTimeout(refreshValues, 50));
    valueSelect.addEventListener('mousedown', () => setTimeout(refreshValues, 50));

    // 4. Clear dropdown if input is emptied
    row._fieldInput.addEventListener('input', () => { 
        if (!row._fieldInput.value) valueSelect.innerHTML = '<option value="">Pick a value</option>'; 
    });

    removeBtn.addEventListener('click', () => row.remove());

    // Initial load (if editing or loading saved state)
    if (initial.field) {
        row._fieldInput.value = initial.field;
        refreshValues();
    }
    if (initial.value) valueSelect.value = initial.value;

    return row;
  }

  function ensureAtLeastOneNumerator() {
    if (!analyticsUI.numeratorsHost) return;
    if (!analyticsUI.numeratorsHost.children.length) {
      analyticsUI.numeratorsHost.appendChild(createNumeratorRow());
    }
  }

  function pruneEmptyNumerators() {
    if (!analyticsUI.numeratorsHost) return;
    analyticsUI.numeratorsHost.querySelectorAll('.numerator-row').forEach(row => {
      const field = row._fieldInput ? row._fieldInput.value.trim() : (row.querySelector('.num-field')?.value.trim() || '');
      const val = row.querySelector('.num-value')?.value.trim() || '';
      if (!field && !val && analyticsUI.numeratorsHost.children.length > 1) {
        row.remove();
      }
    });
  }

  function getScopeFromUI() {
    return {
      company: analyticsUI.companySelect?.value || '',
      location: analyticsUI.locationSelect?.value || '',
      assetType: analyticsUI.assetSelect?.value || ''
    };
  }

  function collectNumerators() {
    if (!analyticsUI.numeratorsHost) return [];
    const rows = Array.from(analyticsUI.numeratorsHost.querySelectorAll('.numerator-row'));
    return rows.map(r => ({
      field: r._fieldInput ? r._fieldInput.value.trim() : (r.querySelector('.num-field')?.value.trim() || ''),
      value: r.querySelector('.num-value')?.value.trim() || ''
    })).filter(r => r.field && r.value);
  }

// In frontend/js/dashboard.js

  function syncBuilderVisibility() {
    const mode = analyticsUI.vizSelect?.value;
    
    // 1. Toggle the advanced panels
    if (analyticsUI.ratioWrap) analyticsUI.ratioWrap.style.display = (mode === 'ratio') ? '' : 'none';
    if (analyticsUI.aggregateWrap) analyticsUI.aggregateWrap.style.display = (mode === 'aggregate') ? '' : 'none';

    // 2. Logic for the Main Field Input
    if (analyticsUI.fieldInput) {
      // It is NOT needed for Aggregate OR Ratio
      const isNotNeeded = (mode === 'aggregate' || mode === 'ratio');
      
      analyticsUI.fieldInput.disabled = isNotNeeded;
      
      if (mode === 'aggregate') {
        analyticsUI.fieldInput.placeholder = 'Field not needed for aggregate counts';
      } else if (mode === 'ratio') {
        analyticsUI.fieldInput.placeholder = 'Field not needed (use Numerator filters below)';
        analyticsUI.fieldInput.value = ''; // Clear it so it looks clean
      } else {
        analyticsUI.fieldInput.placeholder = 'Search any field';
      }
    }
  }

  function wireAnalyticsBuilder() {
    analyticsUI.fieldInput = $('#anaField');
    analyticsUI.vizSelect = $('#anaVizType');
    analyticsUI.companySelect = $('#anaCompany');
    analyticsUI.locationSelect = $('#anaLocation');
    analyticsUI.assetSelect = $('#anaAsset');
    analyticsUI.addBtn = $('#btnAddAnalytic');
    analyticsUI.ratioWrap = $('#ratioBuilder');
    analyticsUI.numeratorsHost = $('#ratioNumerators');
    analyticsUI.addNumeratorBtn = $('#btnAddNumerator');
    analyticsUI.aggregateWrap = $('#aggregateBuilder');
    analyticsUI.aggregateSelect = $('#aggGrouping');
    analyticsUI.cardsHost = $('#analyticsGrid');

    if (analyticsUI.addNumeratorBtn) {
      analyticsUI.addNumeratorBtn.addEventListener('click', () => {
        analyticsUI.numeratorsHost.appendChild(createNumeratorRow());
      });
    }

    if (analyticsUI.vizSelect) {
      analyticsUI.vizSelect.addEventListener('change', syncBuilderVisibility);
    }
    if (analyticsUI.companySelect) {
      analyticsUI.companySelect.addEventListener('change', () => {
        rebuildScopeDropdowns();
        analyticsUI.numeratorsHost?.querySelectorAll('.numerator-row').forEach(row => {
          const select = row.querySelector('.num-value');
          if (select) select.innerHTML = '<option value="">Pick a value</option>';
        });
      });
    }
    if (analyticsUI.locationSelect) {
      analyticsUI.locationSelect.addEventListener('change', () => {
        rebuildScopeDropdowns();
        const scope = getScopeFromUI();
        analyticsUI.numeratorsHost?.querySelectorAll('.numerator-row').forEach(row => {
          const field = row._fieldInput ? row._fieldInput.value : '';
          const valSel = row.querySelector('.num-value');
          if (!valSel) return;
          if (!field) {
            valSel.innerHTML = '<option value="">Pick a value</option>';
            return;
          }
          const vals = collectValuesForField(field, scope);
          valSel.innerHTML = `<option value="">Pick a value</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        });
      });
    }
    if (analyticsUI.assetSelect) {
      analyticsUI.assetSelect.addEventListener('change', () => {
        const scope = getScopeFromUI();
        analyticsUI.numeratorsHost?.querySelectorAll('.numerator-row').forEach(row => {
          const field = row._fieldInput ? row._fieldInput.value : '';
          const valSel = row.querySelector('.num-value');
          if (!valSel || !field) return;
          const vals = collectValuesForField(field, scope);
          valSel.innerHTML = `<option value="">Pick a value</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        });
      });
    }

    if (analyticsUI.addBtn) {
      analyticsUI.addBtn.addEventListener('click', addAnalyticsCardFromUI);
    }

    rebuildScopeDropdowns();
    rebuildAggregateOptions();
    ensureAtLeastOneNumerator();
    syncBuilderVisibility();
  }

  function refreshAnalyticsBuilderSources() {
    if (!analyticsUI.fieldInput) return;
    analyticsUI.fieldInput = attachFieldAutocomplete(analyticsUI.fieldInput);
    analyticsUI.numeratorsHost?.querySelectorAll('.numerator-row .num-field').forEach(inp => {
      const row = inp.closest('.numerator-row');
      const newInput = attachFieldAutocomplete(inp);
      if (row) row._fieldInput = newInput;
    });
    rebuildScopeDropdowns();
    rebuildAggregateOptions();
    const scope = getScopeFromUI();
    analyticsUI.numeratorsHost?.querySelectorAll('.numerator-row').forEach(row => {
      const field = row._fieldInput ? row._fieldInput.value : '';
      const valSel = row.querySelector('.num-value');
      if (!valSel) return;
      if (!field) {
        valSel.innerHTML = '<option value="">Pick a value</option>';
        return;
      }
      const vals = collectValuesForField(field, scope);
      valSel.innerHTML = `<option value="">Pick a value</option>` + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    });
  }

  // ---- Analytics cards -----------------------------------------------------

  function buildCardShell(config) {
    const wrap = document.createElement('div');
    wrap.className = 'stat-card analytics-card';
    const header = document.createElement('div');
    header.className = 'stat-card-header';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost stat-card-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.title = 'Remove';
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'stat-card-body';
    const title = document.createElement('div');
    title.className = 'stat-title';
    const meta = document.createElement('div');
    meta.className = 'stat-meta';
    const chart = document.createElement('div');
    chart.className = 'chart';

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(chart);
    wrap.appendChild(header);
    wrap.appendChild(body);

    const card = {
      config,
      wrap,
      titleEl: title,
      metaEl: meta,
      chartEl: chart,
      closeBtn,
      isVisible: false,
      needsRender: true,
      render() {}
    };
    wrap.__card = card;

    closeBtn.addEventListener('click', () => {
      wrap.remove();
      state.cards = state.cards.filter(c => c !== card);
      refreshFeaturedCard();
    });

    analyticsUI.cardsHost?.appendChild(wrap);
    cardObserver.observe(wrap);
    return card;
  }

  function renderChartCard(card) {
    const { field, chartType, scope } = card.config;
    card.titleEl.textContent = `${field} (${chartType === 'pie' ? 'Pie' : 'Bar'})`;
    card.metaEl.innerHTML = `<span class="pill">${esc(buildScopeLabel(scope))}</span>`;
    const data = getFieldCounts(field, scope);
    card.chartEl.innerHTML = '';
    if (!data.length) {
      card.chartEl.innerHTML = '<div class="empty">No data (adjust filters)</div>';
      return;
    }
    if (chartType === 'pie') {
      renderPieChart(card.chartEl, data, { palette });
    } else {
      renderBarChart(card.chartEl, data, { ariaLabel: `${field} bar chart` });
    }
  }

  function renderRatioCard(card) {
    const { numerators, scope } = card.config;
    card.titleEl.textContent = 'Ratio';
    const scopedRows = getScopedStations(scope);
    const denom = scopedRows.length;
    const hits = scopedRows.filter(r => numerators.every(n => normStr(getFieldValue(r, n.field)).toLowerCase() === normStr(n.value).toLowerCase())).length;
    const pct = denom ? Math.round((hits / denom) * 1000) / 10 : 0;
    const ratioText = denom ? `${hits} / ${denom} (${pct}%)` : '0 / 0';
    const filtersText = numerators.map(n => `${n.field}: ${n.value}`).join(' | ');
    card.metaEl.innerHTML = `
      <span class="pill">${esc(buildScopeLabel(scope))}</span>
      <span class="pill pill-ghost">${esc(filtersText)}</span>
    `;
    card.chartEl.innerHTML = `
      <div class="ratio-value">${esc(ratioText)}</div>
      <div class="ratio-bar"><div style="width:${Math.min(100, pct)}%;"></div></div>
    `;
    if (!denom) {
      card.chartEl.innerHTML += `<div class="empty">No denominator data found for this scope.</div>`;
    }
  }

  function renderAggregateCard(card) {
    const { groupPath, scope } = card.config;
    const labels = (groupPath || []).join(' -> ');
    card.titleEl.textContent = `Aggregate: ${labels}`;
    card.metaEl.innerHTML = `<span class="pill">${esc(buildScopeLabel(scope))}</span>`;
    const rows = getScopedStations(scope);
    const counts = new Map();
    rows.forEach(r => {
      const bits = [];
      groupPath.forEach(level => {
        if (level === 'Company') bits.push(normStr(r.company) || 'Unknown');
        else if (level === 'Location') bits.push(stationLocation(r) || 'Unknown');
        else if (level === 'Asset Type') bits.push(stationAssetType(r) || 'Unknown');
      });
      const key = bits.join(' -> ') || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const data = Array.from(counts.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    if (!data.length) {
      card.chartEl.innerHTML = '<div class="empty">No data (adjust filters)</div>';
      return;
    }
    renderBarChart(card.chartEl, data.slice(0, 30), { ariaLabel: `Aggregate ${labels}` });
  }

  function createAnalyticCard(config) {
    const card = buildCardShell(config);
    card.render = () => {
      if (config.type === 'ratio') return renderRatioCard(card);
      if (config.type === 'aggregate') return renderAggregateCard(card);
      return renderChartCard(card);
    };
    state.cards.push(card);
    markDirty(card);
    refreshFeaturedCard();
    return card;
  }

  function refreshFeaturedCard() {
    const cards = state.cards || [];
    cards.forEach((c, idx) => {
      if (!c.wrap) return;
      c.wrap.classList.toggle('featured', idx === 0);
    });
  }

  function addAnalyticsCardFromUI() {
    const mode = analyticsUI.vizSelect?.value || 'bar';
    const field = analyticsUI.fieldInput?.value.trim() || '';
    const scope = getScopeFromUI();

    // --- CHANGE THIS BLOCK ---
    // Allow both 'aggregate' AND 'ratio' to proceed without a main field
    if (mode !== 'aggregate' && mode !== 'ratio' && !field) {
      appAlert('Pick a field to analyze.');
      return;
    }
    // -------------------------

    if (mode === 'ratio') {
      pruneEmptyNumerators();
      const nums = collectNumerators();
      if (!nums.length) {
        appAlert('Numerator filters cannot be empty.');
        ensureAtLeastOneNumerator();
        return;
      }
      createAnalyticCard({ type: 'ratio', numerators: nums, scope });
      return;
    }

    if (mode === 'aggregate') {
      const val = analyticsUI.aggregateSelect?.value || '';
      if (!val) {
        appAlert('Choose how to group aggregate counts.');
        return;
      }
      const path = val.split('|');
      createAnalyticCard({ type: 'aggregate', groupPath: path, scope });
      return;
    }

    createAnalyticCard({ type: 'chart', chartType: mode, field, scope });
  }

  // ---- Repairs and Maintenance Tab ---------------------------------------
  
  // Now dynamic: one table per Type (e.g., "Repair", "Monitoring", etc.)
  let repairsState = {
    allRepairs: [],
    selectedByType: new Map(),   // type -> Set(rows)
  };
  let stationsList = [];

  async function loadRepairsData() {
    try {
      const repairs = await window.electronAPI.getAllRepairs();
      repairsState.allRepairs = Array.isArray(repairs) ? repairs : [];
      renderTypeTables();
    } catch (e) {
      console.error('[dashboard:repairs] Failed to load repairs:', e);
      repairsState.allRepairs = [];
    }
  }

  // Expose globally for other views to refresh
  window.loadRepairsData = loadRepairsData;

  // ===== Virtualized table helper (windowing) =====
  // Use global helper from add_infra.js if present; otherwise define a local copy.
  const mountVirtualizedTable = window.mountVirtualizedTable || (function () {
    return function mountVirtualizedTable({
      rows,
      tbody,
      renderRowHTML,
      rowHeight = 44,
      overscan = 10,
      adaptiveHeight = true,
      maxViewport = 520,
      minViewport = 0
    }) {
      const topSpacer = document.createElement('tr');
      const bottomSpacer = document.createElement('tr');
      topSpacer.innerHTML = `<td colspan="999" style="height:0;padding:0;border:0"></td>`;
      bottomSpacer.innerHTML = `<td colspan="999" style="height:0;padding:0;border:0"></td>`;

      tbody.innerHTML = '';
      tbody.appendChild(topSpacer);
      tbody.appendChild(bottomSpacer);

      const scroller = tbody.closest('.table-scroll') || tbody.parentElement;
      let start = 0, end = 0, rafId = 0;

      const recompute = () => {
        rafId = 0;
        if (topSpacer.parentNode !== tbody || bottomSpacer.parentNode !== tbody) {
          tbody.innerHTML = '';
          tbody.appendChild(topSpacer);
          tbody.appendChild(bottomSpacer);
        }
        if (adaptiveHeight) {
          const table = tbody.closest('table');
          const headH = (table && table.tHead) ? (table.tHead.offsetHeight || 0) : 0;
          const total = rows.length;
          const bodyH = Math.max(0, total) * rowHeight;
          const needed = headH + bodyH;
          const target = Math.max(minViewport, Math.min(maxViewport, needed));
          scroller.style.height = target + 'px';
          scroller.style.overflowY = 'auto';
          scroller.style.position = scroller.style.position || 'relative';
        }

        const viewH = scroller.clientHeight || 400;
        const scrollTop = scroller.scrollTop | 0;
        const total = rows.length;
        const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const last  = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan);
        if (first === start && last === end) return;
        start = first; end = last;

        topSpacer.firstElementChild.style.height = (start * rowHeight) + 'px';
        bottomSpacer.firstElementChild.style.height = ((rows.length - end) * rowHeight) + 'px';

        while (topSpacer.nextSibling && topSpacer.nextSibling !== bottomSpacer) {
          tbody.removeChild(topSpacer.nextSibling);
        }
        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
          const tr = document.createElement('tr');
          tr.dataset.index = i;
          tr.innerHTML = renderRowHTML(rows[i], i);
          frag.appendChild(tr);
        }
        tbody.insertBefore(frag, bottomSpacer);
      };
      const onScroll = () => { if (!rafId) rafId = requestAnimationFrame(recompute); };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      recompute();
      requestAnimationFrame(recompute);
      setTimeout(recompute, 0);

      return {
        update(newRows) { rows = newRows || []; start = -1; end = -1; recompute(); requestAnimationFrame(recompute); },
        refresh() { recompute(); },
        destroy() {
          scroller.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
          if (rafId) cancelAnimationFrame(rafId);
          if (adaptiveHeight) scroller.style.height = '';
        }
      };
    };
  })();

  function _setTriState(headerCheckbox, selectedSize, total) {
    if (!headerCheckbox) return;
    headerCheckbox.indeterminate = selectedSize > 0 && selectedSize < total;
    headerCheckbox.checked = total > 0 && selectedSize === total;
  }

  // ---- Dynamic tables by Type -----------------------------------------------
 function _typeLabel(r) {
   const t = String((r && (r.scopeType ?? r.type)) || '').trim();
   return t || 'Repair';
 }
  function _groupByType(rows) {
    const map = new Map();
    rows.forEach(r => {
      const k = _typeLabel(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    // Ensure "Repair" shows (even empty) when there is no data yet
    if (map.size === 0) map.set('Repair', []);
    return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function _slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$|/g,''); }

  function renderTypeTables() {
    const wrap = $('#globalTypeTables');
    if (!wrap) return;
    wrap.innerHTML = '';

    const groups = _groupByType(repairsState.allRepairs);
    groups.forEach(([type, rows], idx) => {
      const slug = _slug(type || 'repair') || 'repair';
      const isOpen = idx === 0; // First type open by default

      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.style.marginTop = '20px';

      // Collapsible header
      const header = document.createElement('div');
      header.className = 'panel-header-collapsible';
      header.dataset.type = slug;
      header.innerHTML = `
        <span class="toggle-icon">${isOpen ? '▼' : '▶'}</span>
        <strong class="panel-title-inline">${esc(type)}</strong>
        <span class="count-badge">${rows.length} item${rows.length !== 1 ? 's' : ''}</span>
      `;
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';

      // Collapsible body
      const body = document.createElement('div');
      body.className = 'panel-body-collapsible';
      body.style.display = isOpen ? 'block' : 'none';
      body.dataset.slug = slug;
      body.dataset.type = type;

      panel.appendChild(header);
      panel.appendChild(body);
      wrap.appendChild(panel);

      // Toggle accordion on header click
      header.addEventListener('click', () => {
        const isCurrentlyOpen = body.style.display !== 'none';
        const icon = header.querySelector('.toggle-icon');
        
        if (!isCurrentlyOpen && !body.dataset.rendered) {
          // Lazy render this table
          renderSingleTypeTable(body, type, rows, slug);
          body.dataset.rendered = 'true';
        }
        
        // Toggle visibility
        body.style.display = isCurrentlyOpen ? 'none' : 'block';
        icon.textContent = isCurrentlyOpen ? '▶' : '▼';
      });

      // Render the first table immediately
      if (isOpen) {
        renderSingleTypeTable(body, type, rows, slug);
        body.dataset.rendered = 'true';
      }
    });
  }

  function renderSingleTypeTable(bodyContainer, type, rows, slug) {
    // Selection bucket per type
    if (!repairsState.selectedByType.has(type)) {
      repairsState.selectedByType.set(type, new Set());
    }
    const selSet = repairsState.selectedByType.get(type);

    // Create table structure
    const scroller = document.createElement('div');
    scroller.className = 'table-scroll';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.id = `globalTable_${slug}`;

    const nameHdr = (type === 'Repair') ? 'Repair Name' : 'Item';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:40px;">
            <input type="checkbox" id="selectAll_${slug}" title="Select all ${type}" />
          </th>
          <th>Date</th>
          <th>Station ID</th>
          <th>Location</th>
          <th>Asset Type</th>
          <th>${nameHdr}</th>
          <th>Severity</th>
          <th>Priority</th>
          <th>Cost</th>
          <th>Category</th>
          <th>Days</th>
        </tr>
      </thead>
      <tbody id="globalBody_${slug}"></tbody>
    `;

    scroller.appendChild(table);
    bodyContainer.appendChild(scroller);

    const tbody = table.querySelector('tbody');

    // Simple direct rendering (no virtualization needed for small datasets)
    rows.forEach((r, i) => {
      const checked = selSet.has(r) ? 'checked' : '';
      const tr = document.createElement('tr');
      tr.dataset.index = i;
      tr.innerHTML = `
        <td><input type="checkbox" class="type-checkbox" ${checked} data-idx="${i}"></td>
        <td>${esc(r.date || '')}</td>
        <td>${esc(r.station_id || '')}</td>
        <td>${esc(r.location || '')}</td>
        <td>${esc(r.assetType || '')}</td>
        <td>${esc(r.name || '')}</td>
        <td>${esc(r.severity || '')}</td>
        <td>${esc(r.priority || '')}</td>
        <td>${formatCost(r.cost)}</td>
        <td>${esc(r.category || '')}</td>
        <td>${esc(r.days || '')}</td>
      `;
      tbody.appendChild(tr);
    });

    // Delegate per-row selection
    tbody.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.classList.contains('type-checkbox')) return;
      const idx = Number(t.dataset.idx);
      if (Number.isNaN(idx)) return;
      const item = rows[idx];
      if (!item) return;
      if (t.checked) selSet.add(item); else selSet.delete(item);
      _setTriState(document.getElementById(`selectAll_${slug}`), selSet.size, rows.length);
      updateAllCheckboxes(); // Update global count
    });

    // Header select-all
    const hdr = document.getElementById(`selectAll_${slug}`);
    hdr?.addEventListener('change', (e) => {
      if (e.target.checked) {
        selSet.clear();
        rows.forEach(r => selSet.add(r));
      } else {
        selSet.clear();
      }
      vt.refresh();
      // Re-render checkboxes
      tbody.querySelectorAll('.type-checkbox').forEach((cb, i) => {
        cb.checked = selSet.has(rows[i]);
      });
      _setTriState(hdr, selSet.size, rows.length);
      updateAllCheckboxes(); // Update global count
    });
    _setTriState(hdr, selSet.size, rows.length);
  }

  function formatCost(cost) {
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      return `$${cost.toLocaleString()}`;
    }
    return String(cost || '');
  }

  function openGlobalRepairModal() {
    const modal = $('#globalRepairModal');
    if (!modal) return;

    // Load stations list for validation
    window.electronAPI.getStationData({}).then(data => { stationsList = data || []; });
    
    // Get available filters from the tree
    const filterOptions = getFilteredAssetTypes();
    
    modal.innerHTML = `
      <div class="modal-content" style="max-width:680px;width:92%;">
        <h3 style="margin-top:0;">Add Repair/Maintenance</h3>
        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Company</label>
            <select id="grCompany">
              <option value="">Select Company...</option>
              ${filterOptions.companies.map(c => {
                const name = c.name || c;
                return `<option value="${name}">${name}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Location</label>
            <select id="grLocation" disabled>
              <option value="">Select Company first...</option>
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Asset Type</label>
            <select id="grAssetType" disabled>
              <option value="">Select Location first...</option>
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Station ID *</label>
            <div style="position:relative;">
              <input id="grStationId" type="text" placeholder="Type to search..." disabled autocomplete="off" />
              <div id="grStationDropdown" class="station-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-top:none;z-index:1000;"></div>
            </div>
          </div>
          <input type="hidden" id="grStationIdValue" />
          <input type="hidden" id="grStationName" />
          <input type="hidden" id="grStationLocation" />
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Name *</label>
            <input id="grName" type="text" placeholder="Repair/Maintenance name" />
          </div>
          <div class="form-row">
            <label>Severity</label>
            <input id="grSeverity" type="text" placeholder="1-5" />
          </div>
          <div class="form-row">
            <label>Priority</label>
            <input id="grPriority" type="text" placeholder="1-5" />
          </div>
          <div class="form-row">
            <label>Cost</label>
            <input id="grCost" type="text" placeholder="15000" />
          </div>
          <div class="form-row">
            <label>Days</label>
            <input id="grDays" type="text" placeholder="5" />
          </div>
          <div class="form-row">
            <label>Category</label>
            <select id="grCategory">
              <option value="Capital">Capital</option>
              <option value="O&M">O&M</option>
              <option value="Decommission">Decommission</option>
            </select>
          </div>
          <div class="form-row">
            <label>Type / Scope Type</label>
            <input id="grType" type="text" placeholder="e.g. Repair, Monitoring, Coating…" />
          </div>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button id="grCreate" class="btn btn-primary">Add</button>
          <button id="grCancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    `;
    
    modal.style.display = 'flex';
    
    // Wire up cascading dropdowns
    const companySelect = $('#grCompany');
    const locationSelect = $('#grLocation');
    const assetTypeSelect = $('#grAssetType');
    const stationInput = $('#grStationId');
    const stationDropdown = $('#grStationDropdown');
    const stationIdValue = $('#grStationIdValue');
    let availableStations = [];
    
    companySelect.addEventListener('change', () => {
      const company = companySelect.value;
      locationSelect.innerHTML = '<option value="">Select Location...</option>';
      assetTypeSelect.innerHTML = '<option value="">Select Asset Type...</option>';
      assetTypeSelect.disabled = true;
      
      if (company) {
        const locations = filterOptions.locationsByCompany[company] || [];
        locations.forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          locationSelect.appendChild(opt);
        });
        locationSelect.disabled = false;
      } else {
        locationSelect.disabled = true;
      }
    });
    
    locationSelect.addEventListener('change', () => {
      const location = locationSelect.value;
      assetTypeSelect.innerHTML = '<option value="">Select Asset Type...</option>';
      
      if (location) {
        const assetTypes = filterOptions.assetTypesByLocation[location] || [];
        assetTypes.forEach(at => {
          const opt = document.createElement('option');
          opt.value = at;
          opt.textContent = at;
          assetTypeSelect.appendChild(opt);
        });
        assetTypeSelect.disabled = false;
      } else {
        assetTypeSelect.disabled = true;
      }
    });

    assetTypeSelect.addEventListener('change', () => {
      const location = locationSelect.value;
      const assetType = assetTypeSelect.value;
      stationInput.value = '';
      stationIdValue.value = '';
      stationDropdown.innerHTML = '';
      stationDropdown.style.display = 'none';
      
      if (location && assetType) {
        // Filter stations by location and asset type
        availableStations = stationsList.filter(s =>
          (s.location_file === location || s.province === location) && 
          s.asset_type === assetType
        );
        stationInput.disabled = false;
        stationInput.placeholder = 'Type to search stations...';
      } else {
        availableStations = [];
        stationInput.disabled = true;
        stationInput.placeholder = 'Select Asset Type first...';
      }
    });

    // Filter stations as user types
    stationInput.addEventListener('input', () => {
      const searchTerm = stationInput.value.toLowerCase().trim();
      stationDropdown.innerHTML = '';
      
      if (availableStations.length === 0) {
        stationDropdown.style.display = 'none';
        return;
      }
      
      const filtered = searchTerm
        ? availableStations.filter(st => {
            const stationId = String(st.station_id).toLowerCase();
            const stationName = String(st.name || '').toLowerCase();
            return stationId.includes(searchTerm) || stationName.includes(searchTerm);
          })
        : availableStations;
      
      if (filtered.length === 0) {
        stationDropdown.innerHTML = '<div style="padding:8px;color:#666;">No matching stations</div>';
        stationDropdown.style.display = 'block';
        return;
      }
      
      filtered.forEach(st => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px;cursor:pointer;border-bottom:1px solid #f0f0f0;';
        item.textContent = `${st.station_id} - ${st.name || ''}`;
        item.addEventListener('mouseenter', () => {
          item.style.backgroundColor = '#f5f5f5';
        });
        item.addEventListener('mouseleave', () => {
          item.style.backgroundColor = '';
        });
        item.addEventListener('click', () => {
          stationInput.value = `${st.station_id} - ${st.name || ''}`;
          stationIdValue.value = String(st.station_id).trim();
          stationDropdown.style.display = 'none';
        });
        stationDropdown.appendChild(item);
      });
      
      stationDropdown.style.display = 'block';
    });
    
    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!stationInput.contains(e.target) && !stationDropdown.contains(e.target)) {
        stationDropdown.style.display = 'none';
      }
    };
    document.addEventListener('click', closeDropdown);
    
    // Show all stations when focusing empty input
    stationInput.addEventListener('focus', () => {
      if (!stationInput.value && availableStations.length > 0) {
        stationInput.dispatchEvent(new Event('input'));
      }
    });
    
    // Wire up buttons
    $('#grCancel').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    $('#grCreate').addEventListener('click', async () => {
      const location = $('#grLocation').value;
      const assetType = $('#grAssetType').value;
      // Ensure we get just the station ID value, not the display text
      const stationId = String($('#grStationIdValue').value).trim();
      const repair = {
        'Station ID': stationId,  // This must match what backend expects
        'Repair Name': $('#grName').value,  // Excel expects 'Repair Name'
        name: $('#grName').value,            // Keep for compatibility
        severity: $('#grSeverity').value,
        priority: $('#grPriority').value,
        cost: $('#grCost').value,
        category: $('#grCategory').value,
        type: ($('#grType').value || '').trim() || 'Repair',
        days: $('#grDays').value
      };
      
      if (!location || !assetType || !stationId || !repair.name) {
        appAlert('Please fill in all required fields');
        return;
      }
      
      // Validate station exists
      const stationExists = stationsList.some(s => 
        s.station_id === stationId && 
        (s.location_file === location || s.province === location) &&
        s.asset_type === assetType
      );
      
      if (!stationExists) {
        appAlert('Invalid Station ID. Please select a valid station.');
        return;
      }
      
      // Get company from the selected company dropdown
      const company = $('#grCompany').value;
      
      // Call the correct IPC function with proper structure
      const result = await window.electronAPI.appendRepair({ company, location, assetType, repair });

      if (!result.success) {
        appAlert('Failed to add repair: ' + (result.message || 'Unknown error'));
        return;
      }
      modal.style.display = 'none';
      await loadRepairsData();
      // Trigger workplan refresh if it exists
      if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
    });
  }

  function getFilteredAssetTypes() {
    const tree = state.lookupTree;
    if (!tree) return { companies: [], locationsByCompany: {}, assetTypesByLocation: {} };

    // Build assetTypesByLocation from the company-scoped structure
    const assetTypesByLocation = {};
    const assetsByCoLoc = tree.assetsByCompanyLocation || {};
    
    for (const [company, locMap] of Object.entries(assetsByCoLoc)) {
      for (const [location, assetTypes] of Object.entries(locMap)) {
        if (!assetTypesByLocation[location]) {
          assetTypesByLocation[location] = new Set();
        }
        assetTypes.forEach(at => assetTypesByLocation[location].add(at));
      }
    }
    
    // Convert sets to arrays
    Object.keys(assetTypesByLocation).forEach(loc => {
      assetTypesByLocation[loc] = Array.from(assetTypesByLocation[loc]);
    });

    return {
      companies: (tree.companies || []).map(c => c.name || c),
      locationsByCompany: tree.locationsByCompany || {},
      assetTypesByLocation
    };
  }

  async function resolveSelectedRepairs() {
    // Flatten all selections across types
    const allSelected = [...repairsState.selectedByType.values()].reduce((acc, set) => {
      set.forEach(x => acc.push(x));
      return acc;
    }, []);

    if (allSelected.length === 0) {
      appAlert('No items selected to resolve');
      return;
    }
    
    const confirmed = await appConfirm(`Are you sure you want to resolve ${allSelected.length} selected items? This will permanently delete them.`);
    if (!confirmed) return;
    
    // Group by station for efficient deletion
    const byStation = new Map();
    allSelected.forEach(repair => {
      const key = `${repair.location}||${repair.assetType}||${repair.station_id}`;
      if (!byStation.has(key)) byStation.set(key, []);
      byStation.get(key).push(repair);
    });
    
    // Delete from each station's repairs
    for (const [key, repairs] of byStation.entries()) {
      const [location, assetType, stationId] = key.split('||');
      // Get all repairs for this station
      const allStationRepairs = repairsState.allRepairs.filter(r => 
        r.location === location && 
        r.assetType === assetType && 
        r.station_id === stationId
      );
      // Filter out the selected ones
      const remaining = allStationRepairs.filter(r => !repairs.includes(r));
      // Save the remaining repairs
      await window.electronAPI.saveRepairs('', stationId, remaining);
    }
    
    await loadRepairsData();
    if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
  }

  function selectAllRepairs() {
    // Group repairs by type
    const groups = _groupByType(repairsState.allRepairs);
    
    // Select all repairs in each type
    groups.forEach(([type, rows]) => {
      if (!repairsState.selectedByType.has(type)) {
        repairsState.selectedByType.set(type, new Set());
      }
      const selSet = repairsState.selectedByType.get(type);
      selSet.clear();
      rows.forEach(r => selSet.add(r));
    });
    
    // Update all visible checkboxes
    updateAllCheckboxes();
  }

  function deselectAllRepairs() {
    // Clear all selections
    repairsState.selectedByType.forEach((selSet) => {
      selSet.clear();
    });
    
    // Update all visible checkboxes
    updateAllCheckboxes();
  }

  function updateAllCheckboxes() {
    const groups = _groupByType(repairsState.allRepairs);
    let totalSelected = 0;
    
    groups.forEach(([type, rows]) => {
      const slug = _slug(type || 'repair') || 'repair';
      const selSet = repairsState.selectedByType.get(type);
      totalSelected += selSet ? selSet.size : 0;
      const tbody = document.getElementById(`globalBody_${slug}`);
      
      // Only update if the section is rendered
      if (tbody) {
        // Update row checkboxes
        tbody.querySelectorAll('.type-checkbox').forEach((cb, i) => {
          cb.checked = selSet ? selSet.has(rows[i]) : false;
        });
        
        // Update header checkbox tri-state
        const hdr = document.getElementById(`selectAll_${slug}`);
        _setTriState(hdr, selSet ? selSet.size : 0, rows.length);
      }
    });

    // Update selection count display
    const countEl = document.getElementById('repairsSelectionCount');
    if (countEl) {
      countEl.textContent = `${totalSelected} selected`;
    }
  }

  // No-op now; select-all is wired per dynamic table in renderTypeTables()
  function wireSelectAllCheckboxes() {}

  // ---- Import Repairs from Excel -----------------------------------------------

  // === Import overlay (green progress bar) ======================================
  // Reuses the same CSS classes the Excel boot overlay uses: .boot-overlay,
  // .boot-card, .boot-title, .boot-status, .boot-bar, .boot-bar-fill, .boot-hidden
  function ensureRepairsProgressOverlay() {
    let overlay = document.getElementById('repairsBootOverlay');
    if (overlay) {
      const fill = overlay.querySelector('#repairsBootFill');
      const text = overlay.querySelector('#repairsBootText');
      return { overlay, fill, text };
    }
    overlay = document.createElement('div');
    overlay.id = 'repairsBootOverlay';
    overlay.className = 'boot-overlay boot-hidden';
    overlay.innerHTML = `
      <div class="boot-card">
        <div class="boot-title">Importing repairs…</div>
        <div id="repairsBootText" class="boot-status">Starting…</div>
        <div class="boot-bar"><div id="repairsBootFill" class="boot-bar-fill" style="width:0%"></div></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const fill = overlay.querySelector('#repairsBootFill');
    const text = overlay.querySelector('#repairsBootText');
    return { overlay, fill, text };
  }

  function showRepairsProgress(pct = 5, msg = 'Preparing import…') {
    const { overlay } = ensureRepairsProgressOverlay();
    overlay.classList.remove('boot-hidden');
    overlay.style.display = 'flex';
    updateRepairsProgress(pct, msg);
  }

  function updateRepairsProgress(pct, msg) {
    const { fill, text } = ensureRepairsProgressOverlay();
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    fill.style.width = clamped + '%';
    text.textContent = msg || 'Importing…';
  }

  function hideRepairsProgress(finalMsg) {
    if (finalMsg) updateRepairsProgress(100, finalMsg);
    const { overlay } = ensureRepairsProgressOverlay();
    // small delay for a smooth finish, matches your boot overlay behavior
    setTimeout(() => {
      overlay.classList.add('boot-hidden');
    }, 250);
  }
  // ==============================================================================

  // detect whether the uploaded sheet includes a given column header
  // Usage: rowsHaveColumn(result.rows, ['Type', 'Scope Type', 'Repair/Maintenance', 'Work Type'])
  function rowsHaveColumn(rows, candidates) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+|[_()-]/g, '');
    const targets = new Set((candidates || []).map(norm));
    for (const r of rows || []) {
      for (const k of Object.keys(r || {})) {
        if (targets.has(norm(k))) {
          return true;
        }
      }
    }
    return false;
  }

  async function openImportRepairsModal() {
    const modal = $('#importRepairsModal');
    if (!modal) return;

    // Load stations list first to ensure we have the data
    stationsList = await window.electronAPI.getStationData({}) || [];

    modal.innerHTML = `
      <div class="modal-content" style="max-width:680px;width:92%;">
        <h3 style="margin-top:0;">Import Repairs from Excel</h3>
        <div class="form-row">
          <label>Select Excel File</label>
          <input type="file" id="irFileInput" accept=".xlsx,.xls" />
        </div>
        <div id="irPreview" style="display:none;margin-top:16px;">
          <div style="margin-bottom:8px;"><strong>Preview:</strong> <span id="irCount"></span> repairs found</div>
          <div id="irMissingFields" style="display:none;margin-bottom:12px;padding:8px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;">
            <strong>Some repairs are missing required fields</strong>
            <div style="margin-top:4px;font-size:0.9em;">You'll be prompted to fill in missing information after import.</div>
          </div>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button id="irImport" class="btn btn-primary" disabled>Import</button>
          <button id="irCancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    const fileInput = $('#irFileInput');
    const preview = $('#irPreview');
    const countSpan = $('#irCount');
    const missingDiv = $('#irMissingFields');
    const importBtn = $('#irImport');
    const cancelBtn = $('#irCancel');

    let parsedRepairs = [];

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const b64 = await fileToBase64(file);

        // If workbook has multiple sheets, allow selecting which one to import
        const sheetsResp = await window.electronAPI.excelListSheets(b64).catch(() => ({ success:false, sheets:[] }));
        let sheetName = null;
        if (sheetsResp && Array.isArray(sheetsResp.sheets) && sheetsResp.sheets.length) {
          // Prefer a sheet that looks like repairs if present
          sheetName = sheetsResp.sheets.find(s => /repair/i.test(s)) || sheetsResp.sheets[0];

          // Inject/select sheet picker dynamically
          let sheetPicker = document.getElementById('irSheetSelect');
          if (!sheetPicker) {
            const pickerWrap = document.createElement('div');
            pickerWrap.className = 'form-row';
            pickerWrap.innerHTML = `
              <label>Sheet</label>
              <select id="irSheetSelect"></select>
            `;
            fileInput.closest('.form-row').after(pickerWrap);
            sheetPicker = pickerWrap.querySelector('#irSheetSelect');
          }
          sheetPicker.innerHTML = sheetsResp.sheets.map(s => `<option value="${esc(s)}" ${s===sheetName?'selected':''}>${esc(s)}</option>`).join('');
          sheetPicker.onchange = async () => {
            const sel = sheetPicker.value;
            await parseAndPreview(b64, sel);
          };
        }

        await parseAndPreview(b64, sheetName);

      } catch (err) {
        console.error('[importRepairs] parse failed:', err);
        appAlert('Failed to parse Excel file: ' + err.message);
      }
    });

    async function parseAndPreview(b64, sheetName) {
      const result = sheetName
        ? await window.electronAPI.excelParseRowsFromSheet(b64, sheetName)
        : await window.electronAPI.importRepairsExcel(b64);

      if (!result.success || !result.rows || result.rows.length === 0) {
        appAlert('No data found in the selected sheet');
        return;
      }

      // NEW: detect if the sheet actually contains a "Type" column (or aliases)
      const hasTypeColumn = rowsHaveColumn(result.rows, ['Type', 'Scope Type', 'Repair/Maintenance', 'Work Type']);

      // Map column headers to standardized field names.
      // If there is NO Type column at all, leave type blank so the missing-fields modal
      // prompts per row (with "Apply to all remaining" available).
      parsedRepairs = result.rows.map(row =>
        mapRepairFields(row, { noTypeColumn: !hasTypeColumn })
      );

      // Check for missing fields (required ones)
      const hasMissing = parsedRepairs.some(r => !r.stationId || !r.name);

      countSpan.textContent = parsedRepairs.length;
      preview.style.display = 'block';
      missingDiv.style.display = hasMissing ? 'block' : 'none';
      importBtn.disabled = false;
    }

    importBtn.addEventListener('click', async () => {
      if (parsedRepairs.length === 0) return;

      modal.style.display = 'none';

      const errors = [];
      const REQUIRED_KEYS = ['stationId', 'name'];
      const OPTIONAL_KEYS = ['category', 'type', 'severity', 'priority', 'cost', 'days'];
      const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
      // Type is per-item; can bulk-apply in prompt similarly to Category
      

      // Split into "needs prompting" vs "already complete"
      const toPrompt = [];
      const ready = [];
      for (const r of parsedRepairs) {
        const missingAny = ALL_KEYS.some(k => !String(r[k] ?? '').trim());
        if (missingAny) toPrompt.push(r); else ready.push(r);
      }

      // Ask user to fill anything missing (including Category/Type/etc.)
      if (toPrompt.length) {
        await promptForMissingFields(toPrompt); // <- updated function below
      }

      // Validate & build final lists (after prompting)
      const complete = [];
      const incomplete = [];

      for (const repair of [...ready, ...toPrompt]) {
        if (REQUIRED_KEYS.every(k => String(repair[k] ?? '').trim())) {
          const station = stationsList.find(s =>
            String(s.station_id).trim().toLowerCase() === String(repair.stationId).trim().toLowerCase()
          );

          if (!station) {
            errors.push(`Station ID "${repair.stationId}" not found in system`);
          } else if (!station.company) {
            errors.push(`Station "${repair.stationId}" is missing company information`);
          } else {
            complete.push(repair);
          }
        } else {
          // still missing required bits
          incomplete.push(repair);
        }
      }

      if (errors.length > 0) {
        await appAlert(`Could not import ${errors.length} repair(s):\n\n${
          errors.slice(0, 5).join('\n')
        }${errors.length > 5 ? '\n...' : ''}`);
      }

      // Import with progress overlay for large jobs
      let successCount = 0;
      let failCount = 0;
      const failReasons = [];

      showRepairsProgress(5, 'Importing repairs…');
      try {
        // Phase A: import "complete" set
        const totalA = complete.length;
        for (let i = 0; i < totalA; i++) {
          const repair = complete[i];
          const res = await importSingleRepair(repair);
          if (res && res.success) successCount++; else { failCount++; failReasons.push(`${repair.stationId}: ${res?.message || 'Unknown error'}`); }
          const pct = 5 + Math.round(((i + 1) / Math.max(1, totalA)) * 55); // 5% -> 60%
          updateRepairsProgress(pct, `Importing repairs… (${i + 1}/${totalA})`);
        }

        // Phase B: handle previously incomplete entries (prompt already done earlier)
        let secondPass = [];
        if (incomplete.length > 0) {
          await promptForMissingFields(incomplete);
          secondPass = incomplete.filter(r => REQUIRED_KEYS.every(k => String(r[k] ?? '').trim()));
          const totalB = secondPass.length;
          for (let i = 0; i < totalB; i++) {
            const repair = secondPass[i];
            const res = await importSingleRepair(repair);
            if (res && res.success) successCount++; else { failCount++; failReasons.push(`${repair.stationId}: ${res?.message || 'Unknown error'}`); }
            const pct = 60 + Math.round(((i + 1) / Math.max(1, totalB)) * 20); // 60% -> 80%
            updateRepairsProgress(pct, `Importing remaining… (${i + 1}/${totalB})`);
          }
        }

        // Phase C: refresh data & UI
        updateRepairsProgress(82, 'Refreshing tables…');
        await loadRepairsData();
        updateRepairsProgress(90, 'Updating workplan…');
        if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
        updateRepairsProgress(96, 'Finalizing…');
      } catch (e) {
        console.error('[importRepairs] progress import failed:', e);
        failCount += 1;
        failReasons.push(`Import aborted: ${String(e)}`);
      } finally {
        hideRepairsProgress('Done');
      }

      await loadRepairsData();
      if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();

      let message = `Import complete!\n\nSuccessfully imported: ${successCount}`;
      if (failCount > 0) {
        message += `\nFailed: ${failCount}`;
        if (failReasons.length > 0) {
          message += `\n\nFailure reasons:\n${failReasons.slice(0, 3).join('\n')}${failReasons.length > 3 ? '\n...' : ''}`;
        }
      }
      appAlert(message);
    });

    cancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // Map various column header names to standardized field names
  function mapRepairFields(row, opts = {}) {
    const noTypeColumn = !!opts.noTypeColumn;

    const mapped = {
      stationId: pickField(row, ['Station Number', 'Site Number', 'Station ID', 'Site ID', 'ID']),
      date:      pickField(row, ['Date']),
      name:      pickField(row, ['Repair Name', 'Tasks', 'Name']),
      severity:  pickField(row, ['Severity Ranking', 'Risk Ranking', 'Severity']),
      priority:  pickField(row, ['Priority Ranking', 'Priority']),
      cost:      pickField(row, ['Repair Cost (K)', 'Repair Cost', 'Cost']),
      days:      pickField(row, ['Days', 'Work Days']),
      category:  pickField(row, ['Category', 'Funding Type']),
      assetType: pickField(row, ['Asset Type', 'Infrastructure Type']),
      scopeType: pickField(row, ['Scope Type']),
      // If there is NO Type column at all, leave blank to force a per-row prompt.
      // If present, keep whatever is provided (no coercion).
      type: (function () {
        const raw = (pickField(row, ['Scope Type', 'Type', 'Repair/Maintenance', 'Work Type']) || '').trim();
        if (!raw) return noTypeColumn ? '' : 'Repair';
        return raw;
      })()
    };

    // Normalize common cost input formats without destroying ranges like "10-20" or "<2"
    if (mapped.cost) {
      const v = String(mapped.cost).trim();
      // e.g., 12K or 12k -> 12000
      const kMatch = v.match(/^\$?\s*([0-9]+(?:\.[ss0-9]+)?)\s*[kK]\s*$/);
      if (kMatch) {
        const n = parseFloat(kMatch[1]);
        if (Number.isFinite(n)) mapped.cost = Math.round(n * 1000);
      }
    }

    return mapped;
  }

  // Helper to pick first non-empty value from multiple possible field names
  function pickField(row, candidates) {
    // Robust lookup: case-insensitive and supports composite keys (Section Field)
    for (const name of candidates) {
      const v = getFieldValue(row, name);
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    // Fallback: try loose matching by normalized key
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+|[_()-]/g, '');
    const keys = Object.keys(row || {});
    for (const name of candidates) {
      const target = norm(name);
      for (const k of keys) {
        if (norm(k) === target && String(row[k] ?? '').trim() !== '') return String(row[k]).trim();
      }
    }
    // Additional exact match pass (case-sensitive) for specific headers
    for (const name of candidates) {
      if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
        return String(row[name]).trim();
      }
    }
    return '';
  }

  // Prompt user to fill in missing fields for repairs
  async function promptForMissingFields(repairs) {
    const FIELD_DEFS = [
      { key: 'stationId', label: 'Station ID *', type: 'text', required: true },
      { key: 'name',      label: 'Repair Name *', type: 'text', required: true },
      { key: 'category',  label: 'Category',      type: 'select', options: ['Capital', 'O&M', 'Decommission'], bulk: true },
      { key: 'type',      label: 'Type / Scope Type', type: 'text', bulk: true },
      { key: 'assetType', label: 'Asset Type',    type: 'select-dynamic', bulk: true },
      { key: 'severity',  label: 'Severity',      type: 'text' },
      { key: 'priority',  label: 'Priority',      type: 'text' },
      { key: 'cost',      label: 'Cost',          type: 'number' },
      { key: 'days',      label: 'Days',          type: 'number' }
    ];

    const getMissingKeys = (r) =>
      FIELD_DEFS.filter(f => !String(r[f.key] ?? '').trim()).map(f => f.key);

    let skipAll = false;

    for (let i = 0; i < repairs.length; i++) {
      if (skipAll) break;
      const repair = repairs[i];
      const missing = getMissingKeys(repair);
      if (missing.length === 0) continue;

      const modal = $('#missingFieldsModal');
      if (!modal) continue;

      const rowHTML = (f) => {
        if (f.type === 'select') {
          const id = `mf_${f.key}`;
          const applyAllId = `mf_${f.key}_all`;
          const applyAllHtml = (f.bulk)
            ? `<label style="margin-left:8px;font-size:0.9em;">
                <input id="${applyAllId}" type="checkbox"> Apply to all remaining missing
              </label>`
            : '';
          return `
            <div class="form-row">
              <label>${f.label}</label>
              <select id="${id}">
                <option value="">Select</option>
                ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
              </select>
              ${applyAllHtml}
            </div>
          `;
        }
        if (f.type === 'select-dynamic') {
          const id = `mf_${f.key}`;
          const sid = String(repair.stationId || '').trim();
          const ats = Array.from(new Set((stationsList || [])
            .filter(s => String(s.station_id).trim().toLowerCase() === sid.toLowerCase())
            .map(s => String(s.asset_type || '').trim())
            .filter(Boolean)));
          const optionsHtml = ats.map(o => `<option value="${o}">${o}</option>`).join('');
          const header = ats.length ? 'Select' : 'None available';
          const note = ats.length ? '' : '<div class="hint" style="font-size:0.85em;opacity:.75;">No known asset types for this Station ID in data.</div>';
          const applyAllIdDyn = `mf_${f.key}_all`;
          const applyAllHtmlDyn = `<label style="margin-left:8px;font-size:0.9em;"><input id="${applyAllIdDyn}" type="checkbox"> Apply to all remaining missing</label>`;
          return `
            <div class="form-row">
              <label>${f.label}</label>
              <select id="${id}">
                <option value="">${header}</option>
                ${optionsHtml}
              </select>
              ${applyAllHtmlDyn}
              ${note}
            </div>
          `;
        }
        const id = `mf_${f.key}`;
        const step = f.type === 'number' ? ` step="1"` : '';
        const ph  = f.type === 'number' ? '0' : '';
        const applyAllIdText = `mf_${f.key}_all`;
        const applyAllHtmlText = f.bulk
          ? `<label style="margin-left:8px;font-size:0.9em;">
               <input id="${applyAllIdText}" type="checkbox"> Apply to all remaining missing
             </label>`
          : '';
        return `
          <div class="form-row">
            <label>${f.label}</label>
            <input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${ph}" ${step} />
            ${applyAllHtmlText}
            </div>
        `;
      };

      const currentDataHtml = `
        ${repair.name ? `Name: ${esc(repair.name)}<br>` : ''}
        ${repair.stationId ? `Station ID: ${esc(repair.stationId)}<br>` : ''}
        ${repair.category ? `Category: ${esc(repair.category)}<br>` : ''}
        ${repair.type ? `Type: ${esc(repair.type)}<br>` : ''}
        ${repair.severity ? `Severity: ${esc(repair.severity)}<br>` : ''}
        ${repair.priority ? `Priority: ${esc(repair.priority)}<br>` : ''}
        ${repair.cost ? `Cost: ${esc(repair.cost)}<br>` : ''}
        ${repair.days ? `Days: ${esc(repair.days)}<br>` : ''}
      `;

      modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;width:92%;">
          <h3 style="margin-top:0;">Missing Information (${i + 1}/${repairs.length})</h3>
          <div style="margin-bottom:12px;padding:8px;background:#f8f9fa;border-radius:4px;">
            <div><strong>Current repair data:</strong></div>
            <div style="margin-top:4px;font-size:0.9em;">${currentDataHtml || '(empty)'}</div>
          </div>
          <div class="form-grid" style="display:grid;gap:10px;">
            ${FIELD_DEFS.filter(f => missing.includes(f.key)).map(rowHTML).join('')}
          </div>
          <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button id="mfSave" class="btn btn-primary">Save & Continue</button>
            <button id="mfSkipAll" class="btn btn-ghost">Skip Remaining</button>
            <button id="mfSkip" class="btn btn-ghost">Skip This Repair</button>
          </div>
        </div>
      `;

      modal.style.display = 'flex';

      await new Promise((resolve) => {
        $('#mfSave').onclick = async () => {
          // Persist inputs
          for (const f of FIELD_DEFS) {
            if (!missing.includes(f.key)) continue;
            const el = document.getElementById(`mf_${f.key}`);
            if (!el) continue;
            const v = String(el.value || '').trim();
            if (v) repair[f.key] = v;

            // Optional bulk apply for selected/bulk-enabled fields
            if (f.bulk && v) {
              const allCb = document.getElementById(`mf_${f.key}_all`);
              if (allCb && allCb.checked) {
                for (let j = i + 1; j < repairs.length; j++) {
                  if (!String(repairs[j][f.key] ?? '').trim()) {
                    repairs[j][f.key] = v;
                  }
                }
              }
            }
          }

          // Required checks
          if (!String(repair.stationId || '').trim() || !String(repair.name || '').trim()) {
            appAlert('Station ID and Repair Name are required');
            return;
          }

          modal.style.display = 'none';
          resolve();
        };

        $('#mfSkip').onclick = () => {
          modal.style.display = 'none';
          resolve();
        };

        $('#mfSkipAll').onclick = () => {
          skipAll = true;
          modal.style.display = 'none';
          resolve();
        };
      });
    }
  }

  // Import a single repair by looking up station info
  async function importSingleRepair(repair) {
    try {
      // Find the station to get location, assetType, and company
      const station = stationsList.find(s => 
        String(s.station_id).trim().toLowerCase() === String(repair.stationId).trim().toLowerCase()
      );
      
      if (!station) {
        console.error(`[importSingleRepair] Station not found: ${repair.stationId}`);
        return { success: false, message: 'Station not found' };
      }
      
      const location = station.location_file || station.province || station.location;
      // Prefer user-provided asset type if present (to disambiguate dup Station IDs)
      const assetType = String(repair.assetType || station.asset_type || '').trim();
      const company = station.company || '';

      if (!company) {
        return { success: false, message: 'Station is missing company information' };
      }
      
      if (!location || !assetType) {
        console.error(`[importSingleRepair] Missing location or asset type for station ${repair.stationId}`);
        return { success: false, message: 'Station missing location or asset type' };
      }

      // Normalize category format: "O & M" -> "O&M", "Decommission" stays as is
      let normalizedCategory = String(repair.category ?? '').trim();
      if (normalizedCategory) {
        // Remove spaces around ampersand: "O & M" -> "O&M"
        normalizedCategory = normalizedCategory.replace(/\s*&\s*/g, '&');
      }
      
      // Build repair payload with header-cased fields so backend writes proper columns
      const repairData = {
        'Station ID': repair.stationId,
        'Repair Name': repair.name,
        'Date': repair.date || new Date().toISOString().slice(0, 10), // Use imported date or current date
        'Severity': repair.severity || '',
        'Priority': repair.priority || '',
        'Cost': repair.cost || '',
        'Category': normalizedCategory || 'Capital',
        'Type': repair.type || 'Repair',
        'Type': repair.scopeType || repair.type || 'Repair',
        'Scope Type': repair.scopeType || repair.type || 'Repair',
        'Days': repair.days || '',
        // Aliases for compatibility with older paths
        name: repair.name,
        date: repair.date || new Date().toISOString().slice(0, 10),
        severity: repair.severity || '',
        priority: repair.priority || '',
        cost: repair.cost || '',
        category: normalizedCategory || 'Capital',
        type: repair.type || 'Repair',
        days: repair.days || ''
      };
      if (repair.assetType) repairData['Asset Type'] = String(repair.assetType).trim();
      
      const result = await window.electronAPI.appendRepair({ 
        company, 
        location, 
        assetType, 
        repair: repairData 
      });

      if (!company) {
        return { success: false, message: 'Station is missing company information' };
      }
      
      return result;
      
    } catch (err) {
      console.error('[importSingleRepair] failed:', err);
      return { success: false, message: String(err) };
    }
  }

  // Convert File to base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }


  // ---- Tabs ----------------------------------------------------------------

  function bindTabs() {
    const tabs = [
      { key: 'analytics', btn: $('#tabAnalytics'), pane: $('#analyticsTab'), onShow: async () => {} },
      { key: 'history', btn: $('#tabHistory'), pane: $('#historyTab'), onShow: ensureHistoryData },
      { key: 'repairs', btn: $('#tabRepairs'), pane: $('#repairsTab'), onShow: loadRepairsData }
    ];

    const showTab = async (key) => {
      tabs.forEach(t => {
        if (!t.btn || !t.pane) return;
        const isActive = t.key === key;
        t.btn.classList.toggle('active', isActive);
        t.pane.style.display = isActive ? '' : 'none';
      });
      const match = tabs.find(t => t.key === key);
      if (match && typeof match.onShow === 'function') {
        await match.onShow();
      }
    };

    tabs.forEach(t => {
      t.btn?.addEventListener('click', () => showTab(t.key));
    });

    // ensure default state
    showTab('analytics');
  }

  // ---- Initialization -------------------------------------------------------

  async function refreshStatisticsView() {
    // If the stats DOM isn't loaded yet, skip silently (caller-safe).
    if (!hasStatsDOM()) return;
    try {
      const [rows, tree] = await Promise.all([
        window.electronAPI.getStationData({}),
        window.electronAPI.getLookupTree()
      ]);
      state.allStations = Array.isArray(rows) ? rows : [];
      state.lookupTree = tree || { companies: [], locationsByCompany: {} };
    } catch (e) {
      console.error('[statistics] refresh failed', e);
      state.allStations = [];
      state.lookupTree = { companies: [], locationsByCompany: {} };
    }
    state.fieldNames = await loadAnalyticsFieldNames(state.allStations);
    updateFilterOptions();
    applyAnalyticsFilters();
    refreshAnalyticsBuilderSources();
    state.cards.forEach(markDirty);
    historyState.loaded = false; // force reload for history tab when source data changes
    refreshHistoryFieldAutocomplete();
  }
  // Expose globally so other flows can poke it after imports/adds
  window.refreshStatisticsView = refreshStatisticsView;

  async function initStatisticsView() {
    if (state.initialized) {
      // If already initialized and the DOM is present, just refresh data.
      await refreshStatisticsView();
      return;
    }
    state.initialized = true;

    bindTabs();
    wireAnalyticsBuilder();
    wireHistoryFilters();

    // Wire up repairs buttons
    const btnAddRepair = $('#btnAddGlobalRepair');
    if (btnAddRepair) {
      btnAddRepair.addEventListener('click', openGlobalRepairModal);
    }

    const btnImportRepairs = $('#btnImportRepairs');
    if (btnImportRepairs) {
      btnImportRepairs.addEventListener('click', openImportRepairsModal);
    }

    const btnResolve = $('#btnResolveRepairs');
    if (btnResolve) {
      btnResolve.addEventListener('click', resolveSelectedRepairs);
    }

    const btnSelectAll = $('#btnSelectAllRepairs');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', selectAllRepairs);
    }

    const btnDeselectAll = $('#btnDeselectAllRepairs');
    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', deselectAllRepairs);
    }

    // First data load + paint
    await refreshStatisticsView();

    // If user opens Repairs tab later, virtualization is created on-demand
    // (renderRepairsTables is called from tab switch).

    // Listen to filter changes
    const filterTree = $('#filterTree');
    if (filterTree) {
      filterTree.addEventListener('change', onFiltersChanged);
    }

    // Recompute on resize (charts)
    window.addEventListener('resize', () => {
      state.cards.forEach(markDirty);
    });
  }

  // Expose init for index loader
  window.initStatisticsView = initStatisticsView;
})();

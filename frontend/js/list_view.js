// frontend/js/list_view.js
// List View = Map View logic, but rendered as a table.
// - Uses the same filter semantics as map_view.js (copied helpers).
// - Renders rows into #stationTable.
// - Hovering a row updates the RHS details via window.showStationDetails.
// - Click a column header to sort (toggles asc/desc).
// - Respects the filter drawer readiness flag to avoid clearing on boot.
// - UPDATED: Search now requires button click or Enter key, always searches full database

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────────
  // Utils
  // ────────────────────────────────────────────────────────────────────────────
  const debounce = (fn, ms = 150) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const norm = (s) => String(s ?? '').trim().toLowerCase();

  // ────────────────────────────────────────────────────────────────────────────
  // Filter helpers (kept in-sync with map_view.js)
  // ────────────────────────────────────────────────────────────────────────────
  function getActiveFilters() {
    console.log('[filters] getActiveFilters called');
    const locCbs = Array.from(document.querySelectorAll('.filter-checkbox.location'));
    const atCbs  = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));

    const locations  = new Set();
    const assetTypes = new Set();
    const toNorm = (s) => String(s ?? '').trim().toLowerCase();

    locCbs.forEach(cb => { if (cb.checked) locations.add(toNorm(cb.value)); });
    atCbs.forEach(cb => {
      if (cb.checked) {
        assetTypes.add(toNorm(cb.value));
        const parentLoc = cb.dataset.location ? toNorm(cb.dataset.location) : '';
        if (parentLoc) locations.add(parentLoc);
      }
    });

    const allLocationsSelected  = locCbs.length > 0 && locations.size === locCbs.length;
    const allAssetTypesSelected = atCbs.length  > 0 && assetTypes.size === atCbs.length;

    console.log('[DEBUG] Filter state:', {
      locations: Array.from(locations),
      assetTypes: Array.from(assetTypes),
      totalLocs: locCbs.length,
      totalAts: atCbs.length
    });

    return {
      locations, assetTypes,
      allLocationsSelected, allAssetTypesSelected,
      totalLocs: locCbs.length, totalAts: atCbs.length,
      _norm: toNorm
    };
  }

  function getActiveLocationAssetCombos() {
    const atCbs = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));
    const combos = new Set();
    const _norm = (s) => String(s ?? '').trim().toLowerCase();
    
    atCbs.forEach(cb => {
      if (cb.checked) {
        const assetType = _norm(cb.value);
        const location = cb.dataset.location ? _norm(cb.dataset.location) : '';
        const company = cb.dataset.company ? _norm(cb.dataset.company) : '';
        if (assetType && location && company) {
          combos.add(`${company}|${location}|${assetType}`);
        }
      }
    });
    
    return { combos, _norm, totalCombos: atCbs.length };
  }

  function areFiltersActuallyRestricting() {
    const filterTreeEl = document.getElementById('filterTree');

    // If no filter tree or it's not "ready", treat as unrestricted.
    if (!filterTreeEl || filterTreeEl.dataset.ready !== '1') return false;

    const { locations, assetTypes, totalLocs, totalAts } = getActiveFilters();

    // No checkboxes exist at all -> no restriction
    if (totalLocs === 0 && totalAts === 0) return false;

    // Checkboxes exist but nothing selected -> restrict (show none)
    if ((totalLocs + totalAts) > 0 && locations.size === 0 && assetTypes.size === 0) return true;

    // Everything selected -> not restricting
    if ((totalLocs === 0 || locations.size === totalLocs) &&
        (totalAts  === 0 || assetTypes.size === totalAts)) return false;

    // Some are selected -> restricting
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────────────────
  let LIST_FAST_BOOT = true;           // trim rows for the first couple seconds
  const MAX_INITIAL_ROWS = 800;        // tune for your dataset
  let RENDERING = false;

  // Keeps current rows in view for hover → details
  let currentRows = [];
  let sortState = { key: 'station_id', dir: 'asc' }; // default sort

  // NEW: Search state - separated pending input from active search
  let activeSearchQuery = '';    // Currently applied search (used in filtering)
  let pendingSearchQuery = '';   // What's typed in the input box but not yet searched
  let tempColumnKey = '';

  // ────────────────────────────────────────────────────────────────────────────
  // Data → filtered rows (mirrors map_view filter semantics)
  // ────────────────────────────────────────────────────────────────────────────
  function applyFilters(all) {
    const valid = (all || []).filter(stn => {
      const lat = Number(stn.lat), lon = Number(stn.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) &&
             Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    });

    // Default: show ALL unless filters are actively restricting
    if (!areFiltersActuallyRestricting()) return valid;

    return valid.filter(stn => {
      const { combos, _norm, totalCombos } = getActiveLocationAssetCombos();
      
      // If no asset type filters exist, fall back to location-only filtering
      if (totalCombos === 0) {
        const { locations, totalLocs } = getActiveFilters();
        if (totalLocs === 0) return true; // No filters = show all
        if (locations.size === 0) return false; // No locations selected = show nothing
        
        const stnLocCandidates = [
          _norm(stn.province),
          _norm(stn.location), 
          _norm(stn.location_file)
        ].filter(Boolean);
        return stnLocCandidates.some(loc => locations.has(loc));
      }
      
      // Asset type filters exist - check for exact location+assetType match
      if (combos.size === 0) return false; // No combos selected = show nothing
      
      const stnAssetType = _norm(stn.asset_type);
      const stnCompany = _norm(stn.company);
      const stnLocCandidates = [
        _norm(stn.province),
        _norm(stn.location),
        _norm(stn.location_file)
      ].filter(Boolean);
      
      // Check if any station location + asset type combination is allowed
      return stnLocCandidates.some(loc => {
        const combo = `${stnCompany}|${loc}|${stnAssetType}`;
        return combos.has(combo);
      });
    });
  }

  // UPDATED: Now uses activeSearchQuery instead of live input
  function applySearch(rows) {
    const q = norm(activeSearchQuery);
    if (!q) return rows;
    return rows.filter(stn => {
      const primaryMatch = [
        stn.station_id, stn.asset_type, stn.name,
        stn.province, stn.location, stn.location_file,
        stn.status, stn.lat, stn.lon
      ].some(v => String(v ?? '').toLowerCase().includes(q));
    
      if (primaryMatch) {
        return true;
      }

      // NEW: Also search the temporary column if it exists
      if (tempColumnKey && stn[tempColumnKey]) {
        if (String(stn[tempColumnKey] ?? '').toLowerCase().includes(q)) {
          return true;
        }
      }
      
      // No match
      return false;
    });
  }

  function sortRows(rows) {
    const { key, dir } = sortState;
    const dirMul = dir === 'desc' ? -1 : 1;
    const numKeys = new Set(['lat', 'lon']);

    return rows.slice().sort((a, b) => {
      const va = a?.[key], vb = b?.[key];
      if (numKeys.has(key)) {
        const na = Number(va), nb = Number(vb);
        const aa = Number.isFinite(na) ? na : -Infinity;
        const bb = Number.isFinite(nb) ? nb : -Infinity;
        if (aa < bb) return -1 * dirMul;
        if (aa > bb) return  1 * dirMul;
        return 0;
      }
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      if (sa < sb) return -1 * dirMul;
      if (sa > sb) return  1 * dirMul;
      return 0;
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // NEW: Search Actions
  // ────────────────────────────────────────────────────────────────────────────
  function performSearch() {
    // Apply the pending search query
    activeSearchQuery = pendingSearchQuery;
    
    // Trigger full re-render (fetches fresh data from database)
    renderList(false);
    
    console.log('[list] Search performed:', activeSearchQuery);
  }

  function clearSearch() {
    const searchInput = document.querySelector('input[placeholder*="Search stations"]');
    if (searchInput) {
      searchInput.value = '';
    }
    
    // Clear both pending and active search
    pendingSearchQuery = '';
    activeSearchQuery = '';
    
    // Re-render to show all results
    renderList(false);
    
    console.log('[list] Search cleared');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Rendering
  // ────────────────────────────────────────────────────────────────────────────
  function formatNum(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toFixed(5) : '';
    // fixed precision keeps the table tidy; tweak as needed
  }

  function stationToRow(stn) {
    // Province column shows the best available location label, same priority as map filters
    const provinceLike = stn.province ?? stn.location ?? stn.location_file ?? '';
    return [
      stn.station_id ?? '',
      stn.asset_type ?? '',
      stn.name ?? '',
      provinceLike,
      formatNum(stn.lat),
      formatNum(stn.lon),
      stn.status ?? ''
    ];
  }

  function attachSorting(tableEl) {
    const head = tableEl.querySelector('thead');
    if (!head || head.dataset.bound === '1') return;

    const keyForIndex = (idx) => {
      switch (idx) {
        case 0: return 'station_id';
        case 1: return 'asset_type';
        case 2: return 'name';
        case 3: return 'province'; // we still sort by stn.province field
        case 4: return 'lat';
        case 5: return 'lon';
        case 6: return 'status';
        case 7: return tempColumnKey || 'station_id';
        default: return 'station_id';
      }
    };

    head.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const row = th.parentElement;
      if (!row) return;

      const idx = Array.from(th.parentElement.children).indexOf(th);
      const key = keyForIndex(idx);
      if (!key) return;

      // toggle direction
      if (sortState.key === key) {
        sortState.dir = (sortState.dir === 'asc') ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      // re-render rows (no refetch)
      renderRowsOnly();
    }, { passive: true });

    head.dataset.bound = '1';
  }

  function attachHover(tbodyEl) {
    if (!tbodyEl || tbodyEl.dataset.bound === '1') return;
    let lastIdx = -1;

    tbodyEl.addEventListener('mousemove', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx) || idx === lastIdx) return;
      lastIdx = idx;

      const stn = currentRows[idx];
      if (stn && typeof window.showStationDetails === 'function') {
        window.showStationDetails(stn);
      }
    }, { passive: true });

    tbodyEl.dataset.bound = '1';
  }

  // NEW: clicking a row opens the station detail page
  function attachRowClicks(tbodyEl) {
    if (!tbodyEl || tbodyEl.dataset.clickBound === '1') return;
    tbodyEl.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;
      const stn = currentRows[idx];
      if (!stn) return;
      if (typeof window.loadStationPage === 'function') {
        window.loadStationPage(stn.station_id, 'list'); // pass origin
      }
    });
    tbodyEl.dataset.clickBound = '1';
  }

  // UPDATED: Show search indicator in count badge
  function updateCountBadge(n) {
    const badge = document.getElementById('listCount');
    if (!badge) return;
    if (!n || n < 0) {
      badge.style.display = 'none';
      badge.textContent = '';
      return;
    }
    badge.style.display = 'inline-block';
    
    // Show search indicator if there's an active search
    const searchIndicator = activeSearchQuery ? ' (filtered)' : '';
    badge.textContent = `${n} row${n === 1 ? '' : 's'}${searchIndicator}`;
  }

  function renderIntoTable(rows, opts = {}) {
    const table = document.getElementById('stationTable');
    if (!table) return;

    // NEW: Update table header to include temporary column if set
    const theadTr = table.querySelector('thead tr');
    if (theadTr) {
      // Reset to default headers
      theadTr.innerHTML = `
        <th>Station ID</th>
        <th>Category</th>
        <th>Site Name</th>
        <th>Province</th>
        <th>Latitude</th>
        <th>Longitude</th>
        <th>Status</th>
      `;
      if (tempColumnKey) {
        const th = document.createElement('th');
        th.textContent = tempColumnKey;
        th.style.fontStyle = 'italic'; // Mark as temporary
        theadTr.appendChild(th);
      }
    }

    attachSorting(table);

    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();

    const limit = (LIST_FAST_BOOT && !opts.full) ? Math.min(rows.length, MAX_INITIAL_ROWS) : rows.length;

    for (let i = 0; i < limit; i++) {
      const stn = rows[i];
      const tr = document.createElement('tr');
      tr.dataset.idx = String(i);

      const cols = stationToRow(stn);
      for (const text of cols) {
        const td = document.createElement('td');
        td.textContent = String(text ?? '');
        tr.appendChild(td);
      }

      // NEW: Add temporary column's data if set
      if (tempColumnKey) {
        const tempValue = stn[tempColumnKey];
        const td = document.createElement('td');
        td.textContent = (tempValue !== null && tempValue !== undefined) ? String(tempValue) : '';
        tr.appendChild(td);
      }

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    attachHover(tbody);
    attachRowClicks(tbody);
    updateCountBadge(limit);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Fetch + compose + render
  // ────────────────────────────────────────────────────────────────────────────
  async function computeRows() {
    // Always fetch fresh to avoid cache mismatch with map_view invalidateStationData()
    let data = [];
    try {
      if (typeof window.electronAPI?.getStationData === 'function') {
        data = await window.electronAPI.getStationData({});
      }
    } catch (e) {
      console.error('[list] getStationData failed:', e);
    }

    let rows = applyFilters(data);
    rows = applySearch(rows);  // Now uses activeSearchQuery
    rows = sortRows(rows);
    return rows;
  }

  async function renderList(full = false) {
    if (RENDERING) return;
    RENDERING = true;
    try {
      currentRows = await computeRows();
      renderIntoTable(currentRows, { full });
    } catch (e) {
      console.error('[list] renderList error:', e);
    } finally {
      RENDERING = false;
    }
  }

  const renderListDebounced = debounce(() => renderList(false), 150);

  function renderRowsOnly() {
    // Re-render rows using existing currentRows + current sort (search unchanged)
    try {
      currentRows = sortRows(currentRows);
      renderIntoTable(currentRows);
    } catch (e) {
      console.error('[list] renderRowsOnly error:', e);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public bootstrapping API (called by add_infra.js after list.html loads)
  // ────────────────────────────────────────────────────────────────────────────
  function initListView() {
    const page = document.getElementById('listPage');
    const table = document.getElementById('stationTable');
    if (!page || !table) {
      // DOM not ready yet (e.g., just injected) — try again next frame
      requestAnimationFrame(initListView);
      return;
    }

    if (!page.dataset.bound) {
      // Hook filter changes → refresh
      const filterTree = document.getElementById('filterTree');
      if (filterTree) {
        // Avoid double-binding
        if (!filterTree.dataset.listBound) {
          filterTree.addEventListener('change', () => {
            renderListDebounced();
          });
          filterTree.dataset.listBound = '1';
        }
      }

      // UPDATED: Target the "Search stations" input specifically
      const searchInput = document.querySelector('input[placeholder*="Search stations"]');
      const searchButton = document.getElementById('searchStationsButton');
      const clearButton = document.getElementById('clearStationsButton');
      
      if (searchInput && !searchInput.dataset.bound) {
        // Track what user types (but don't search yet)
        searchInput.addEventListener('input', (e) => {
          pendingSearchQuery = e.target.value || '';
        });
        
        // Search on Enter key
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            performSearch();
          }
        });
        
        searchInput.dataset.bound = '1';
      }
      
      // Search button click
      if (searchButton && !searchButton.dataset.bound) {
        searchButton.addEventListener('click', (e) => {
          e.preventDefault();
          performSearch();
        });
        searchButton.dataset.bound = '1';
      }
      
      // Clear button click
      if (clearButton && !clearButton.dataset.bound) {
        clearButton.addEventListener('click', (e) => {
          e.preventDefault();
          clearSearch();
        });
        clearButton.dataset.bound = '1';
      }

      // NEW: Bind temporary column controls
      const tempColInput = document.getElementById('tempColumnInput');
      const addTempColBtn = document.getElementById('addTempColumnButton');
      const clearTempColBtn = document.getElementById('clearTempColumnButton');

      if (addTempColBtn && !addTempColBtn.dataset.bound) {
        addTempColBtn.addEventListener('click', () => {
          tempColumnKey = tempColInput.value.trim();
          if (tempColumnKey) {
            clearTempColBtn.style.display = 'inline-block';
          }
          renderList(false); // Full re-render
        });
        addTempColBtn.dataset.bound = '1';
      }

      if (clearTempColBtn && !clearTempColBtn.dataset.bound) {
        clearTempColBtn.addEventListener('click', () => {
          tempColumnKey = '';
          tempColInput.value = '';
          clearTempColBtn.style.display = 'none';
          renderList(false); // Full re-render
        });
        clearTempColBtn.dataset.bound = '1';
      }

      page.dataset.bound = '1';
    }

    // Initial render
    renderList(false);

    // Switch to full render after a short delay (mirrors map fast boot)
    setTimeout(() => {
      LIST_FAST_BOOT = false;
      renderList(true);
    }, 2000);
  }

  // Expose for add_infra.js
  window.initListView  = window.initListView  || initListView;
  window.renderList    = window.renderList    || (() => renderListDebounced());

  // If list markup was pre-injected somehow, allow auto-init
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('listPage')) initListView();
  });
})();
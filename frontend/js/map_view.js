// frontend/js/map_view.js

'use strict';

const debounce = (fn, ms = 150) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function isFiniteCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 180;
}

// ────────────────────────────────────────────────────────────────────────────
// Map bootstrap vars
// ────────────────────────────────────────────────────────────────────────────
let map;                 // Leaflet map
let markersLayer;        // Layer group for pins
let canvasRenderer;      // Canvas renderer instance
let mapStationData = []; // we'll reload this from disk every refresh
let fastBootTimer;       // Timer ID for the initial full render
let FAST_BOOT = true;           // first couple seconds: simple pins, limited count
const MAX_INITIAL_PINS = 800;   // tune for your dataset
let DID_FIT_BOUNDS = false;     // only fit once on first real data
let RENDER_IN_PROGRESS = false; // Prevent concurrent renders

// Title/link helper for RHS quick view
function setRhsTitle(stnOrText) {
  const h = document.querySelector('#rightPanel > h2');
  if (!h) return;

  // Always clear previous link state first
  h.classList.remove('clickable');
  h.removeAttribute('role');
  h.removeAttribute('tabindex');
  h.removeAttribute('data-station-id');
  h.removeAttribute('title');

  // Ensure title text span exists
  if (!h.dataset.titleInitialized) {
    h.innerHTML = ''; // <-- ADD THIS LINE to clear the original "Station Details"
    h.dataset.titleInitialized = '1';
  }
  let titleTextEl = h.querySelector('.rhs-title-text');
  if (!titleTextEl) {
    titleTextEl = document.createElement('span');
    titleTextEl.className = 'rhs-title-text';
    h.prepend(titleTextEl); // Prepend to keep text first
  }

  // Ensure warning icon element exists, but hide it by default on every title change
  let warningEl = h.querySelector('.rhs-repair-warning');
  if (!warningEl) {
    warningEl = document.createElement('span');
    warningEl.className = 'rhs-repair-warning';
    warningEl.textContent = '!'; // CSS can style this
    h.appendChild(warningEl); // Append, CSS will position it
  }
  warningEl.style.display = 'none';
  warningEl.removeAttribute('title');

  if (stnOrText && typeof stnOrText === 'object') {
    // Station selected → make clickable link-like header
    const name = `${stnOrText.name || 'Unknown Station'} (${stnOrText.station_id || 'N/A'})`.trim();
    titleTextEl.textContent = name;
    h.classList.add('clickable');
    h.setAttribute('role', 'link');
    h.setAttribute('tabindex', '0');
    h.dataset.stationId = String(stnOrText.station_id || '');
    h.title = 'Open station details';
  } else {
    // No station selected → plain header
    titleTextEl.textContent = typeof stnOrText === 'string' ? stnOrText : 'Station Details';
  }

  // Attach open handler once
  if (!h.dataset.clickHandlerAttached) {
    const openDetails = () => {
      const sid = h.dataset.stationId;
      if (!sid) return;
      const list = document.getElementById('listContainer');
      const origin = (list && list.style.display !== 'none') ? 'list' : 'map';
      if (typeof window.loadStationPage === 'function') {
        window.loadStationPage(sid, origin);
      }
    };
    h.addEventListener('click', openDetails);
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(); }
    });
    h.dataset.clickHandlerAttached = '1';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RHS panel helpers (programmatic open/close that mirror the toggle button)
// ────────────────────────────────────────────────────────────────────────────
function isRightCollapsed() {
  const root = document.getElementById('mainContent');
  if (root) return root.classList.contains('right-collapsed');
  return localStorage.getItem('ui.collapse.right') === '1';
}
function setRightCollapsed(flag) {
  const root = document.getElementById('mainContent');
  const btnR = document.getElementById('toggleRight');
  localStorage.setItem('ui.collapse.right', flag ? '1' : '0');
  if (root) root.classList.toggle('right-collapsed', !!flag);
  if (btnR) {
    btnR.setAttribute('aria-pressed', String(!!flag));
    btnR.textContent = !!flag ? '⟨' : '⟩';
  }
  // nudge layout so Leaflet/list recompute sizes
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
}
function ensureRightPanelOpen()  { if (isRightCollapsed()) setRightCollapsed(false); }
function ensureRightPanelClosed(){ if (!isRightCollapsed()) setRightCollapsed(true); }

// ────────────────────────────────────────────────────────────────────────────
// Init (same as before)
// ────────────────────────────────────────────────────────────────────────────
function initMap() {

  const mapEl = document.getElementById('map');
  const mapCol = document.getElementById('mapContainer');

  if (!mapEl || !mapCol) {
    console.error('[map] map elements missing');
    return;
  }

  const ensureColumnWidth = () => {
    const w = mapCol.offsetWidth;
    const h = mapCol.offsetHeight;
    if (w === 0) {
      console.warn('[map] map column width is 0 — forcing min widths');
      mapCol.style.minWidth = '400px';
      mapCol.style.width = '100%';
      mapEl.style.width = '100%';
    }
  };
  ensureColumnWidth();

  map = L.map('map', {
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    zoomControl: true,
    minZoom: 1,
    // Prevent Leaflet from taking keyboard focus (arrows, +/- etc.)
    keyboard: false
  }).setView([54.5, -119], 5);

  // Make sure the map container itself cannot be focused by tabbing/clicks
  try { 
    const mapContainerEl = map.getContainer();
    if (mapContainerEl) mapContainerEl.setAttribute('tabindex', '-1');
  } catch (_) {}

// 1. Define your different map layers
  const streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    noWrap: true
  });

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    noWrap: true
  });

  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
      noWrap: true
  });

  // 2. Create an object to hold them
  const baseMaps = {
    "Street": streetLayer,
    "Satellite": satelliteLayer,
    "Topographic": topoLayer
  };

  // 3. Add the layer control to the map (topright, as requested)
  L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

  // 4. Add your default layer to the map
  streetLayer.addTo(map);

  const maskPane = map.createPane('maskPane');
  maskPane.style.zIndex = 350;

  (function addGreyMask() {
    const bounds = map.options.maxBounds;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const outer = [[-90,-360],[90,-360],[90,360],[-90,360]];
    const inner = [[sw.lat, sw.lng],[sw.lat, ne.lng],[ne.lat, ne.lng],[ne.lat, sw.lng]];
    L.polygon([outer, inner], {
      pane: 'maskPane',
      fillRule: 'evenodd',
      fillColor: '#DDD',
      fillOpacity: 1,
      stroke: false,
      interactive: false
    }).addTo(map);
  })();

  canvasRenderer = L.canvas({ 
    pane: 'markerPane', 
    padding: 0.5,
    tolerance: 0
  });
  
  markersLayer = L.layerGroup();
  markersLayer.addTo(map);
  
  const ensureMapSize = () => {
    try {
      map.invalidateSize();
    } catch (_) {}
  };

  const resizeObs = new ResizeObserver(() => {
    if (mapCol.offsetWidth === 0) {
      mapCol.style.minWidth = '400px';
      mapCol.style.width = '100%';
      mapEl.style.width = '100%';
    }
    ensureMapSize();
  });
  resizeObs.observe(mapCol);

  setTimeout(ensureMapSize, 0);
  window.addEventListener('load', () => setTimeout(ensureMapSize, 0));
  window.addEventListener('resize', ensureMapSize);

  const drawer = document.getElementById('filterDrawer');
  if (drawer) {
    new MutationObserver(() => setTimeout(ensureMapSize, 120))
      .observe(drawer, { attributes:true, attributeFilter:['class'] });
  }

  // Also watch for LHS/RHS collapse state changes on the grid container
  const mainGrid = document.getElementById('mainContent');
  if (mainGrid) {
    new MutationObserver(() => {
      // Give the layout a beat to settle, then invalidate map size
      setTimeout(ensureMapSize, 120);
    }).observe(mainGrid, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  map.on('click', () => {
    const container = document.getElementById('station-details');
    if (container) container.innerHTML = `<p><em>Click a pin to see details</em></p>`;
    // Release keyboard focus from the map on empty clicks
    try { map.getContainer()?.blur?.(); } catch(_) {}
    // Reset RHS title when no pin is selected
    setRhsTitle('Station Details');
    // Treat clicking empty map as "toggle RHS closed" if it’s currently open
    ensureRightPanelClosed();
  });

  map.on('contextmenu', (e) => {
    const { lat, lng } = e.latlng;
    if (typeof window.openManualInstanceWizard === 'function') {
      window.openManualInstanceWizard(null, null, null, {
        lat: lat.toFixed(6),
        lon: lng.toFixed(6)
      });
    }
  });

  map.on('tileload', () => {});
  map.on('tileerror', (e) => {
    console.error('[map] tile error', e);
  });

  setTimeout(ensureMapSize, 300);
  setTimeout(ensureMapSize, 800);
}

function getActiveFilters() {
  console.log('[filters] getActiveFilters called');
  const norm = s => String(s ?? '').trim().toLowerCase();
  const locCbs = Array.from(document.querySelectorAll('.filter-checkbox.location'));
  const atCbs  = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));

  const locations  = new Set();
  const assetTypes = new Set();

  // Explicitly checked locations
  locCbs.forEach(cb => {
    if (cb.checked) locations.add(norm(cb.value));
  });

  // Checked asset types + ensure their parent locations are included
  atCbs.forEach(cb => {
    if (cb.checked) {
      assetTypes.add(norm(cb.value));
      const parentLoc = cb.dataset.location ? norm(cb.dataset.location) : '';
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
    _norm: norm
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

// Check if filters are actually restricting anything
function areFiltersActuallyRestricting() {
  const filterTreeEl = document.getElementById('filterTree');
  
  // If no filter tree, no restriction
  if (!filterTreeEl || filterTreeEl.dataset.ready !== '1') {
    return false;
  }
  
  const { locations, assetTypes, totalLocs, totalAts } = getActiveFilters();
  
  // If no checkboxes exist yet, no restriction
  if (totalLocs === 0 && totalAts === 0) {
    return false;
  }
  
  // If nothing is selected *but checkboxes exist*, that's an active restriction (show none)
  if ((totalLocs + totalAts) > 0 && locations.size === 0 && assetTypes.size === 0) {
    return true;
  }
  
  // If everything is selected, no restriction
  if ((totalLocs === 0 || locations.size === totalLocs) && 
      (totalAts === 0 || assetTypes.size === totalAts)) {
    return false;
  }
  
  // Otherwise, we are restricting
  return true;
}

function addTriRingMarker(lat, lon, color) {
  const rCore = FAST_BOOT ? 3 : 4;
  const ringBlack = 1;
  const ringWhite = 1;

  if (!FAST_BOOT) {
    const outer = L.circleMarker([lat, lon], {
      renderer: canvasRenderer,
      radius: rCore + ringWhite + (ringBlack * 0.5),
      color: '#000',
      weight: ringBlack,
      fill: false,
      interactive: false
    });

    const mid = L.circleMarker([lat, lon], {
      renderer: canvasRenderer,
      radius: rCore + (ringWhite * 0.5),
      color: '#fff',
      weight: ringWhite,
      fill: false,
      interactive: false
    });
    
    outer.addTo(markersLayer);
    mid.addTo(markersLayer);
  }

  const inner = L.circleMarker([lat, lon], {
    renderer: canvasRenderer,
    radius: rCore,
    fill: true,
    fillColor: color || '#4b5563',
    fillOpacity: 1,
    stroke: false,
    interactive: true
  });

  inner.addTo(markersLayer);
  return inner;
}

async function showStationDetails(stn) {

  // Update RHS header to the site name (clickable)
  setRhsTitle(stn);

  // Opening a pin/list row should surface the quick-view
  ensureRightPanelOpen();

  // Asynchronously check for repairs and show/hide the warning icon
  (async () => {
    try {
      // Assumes listRepairs is exposed on the electronAPI
      const repairs = await window.electronAPI.listRepairs(stn.name, stn.station_id);
      const h = document.querySelector('#rightPanel > h2');
      const warningEl = h ? h.querySelector('.rhs-repair-warning') : null;
      
      if (warningEl && repairs && repairs.length > 0) {
        // Show the warning. CSS should handle the red color and positioning.
        warningEl.style.display = 'inline-block'; 
        warningEl.setAttribute('title', `${repairs.length} repair(s) logged`);
      }
    } catch (e) {
      console.warn(`[map_view] Failed to check repairs for ${stn.station_id}:`, e);
    }
  })();

  const container = document.getElementById('station-details');
  if (!container) return;

  const placeholder = container.querySelector('p');
  if (placeholder) placeholder.remove();

  let body = container.querySelector('.station-details-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'station-details-body';
    container.appendChild(body);
  }

  // Add status and category pills at the top
  const statusPill = createStatusPill(stn.status);
  const categoryPill = createCategoryPill(stn.asset_type);

  const fixedOrder = [
    ['Station ID', stn.station_id],
    ['Category',   stn.asset_type],
    ['Site Name',  stn.name],
    ['Province',   stn.province],
    ['Latitude',   stn.lat],
    ['Longitude',  stn.lon],
    ['Status',     stn.status],
  ];

  const extras = {};
  const SEP = ' – ';
  Object.keys(stn || {}).forEach(k => {
    if (!k.includes(SEP)) return;
    const [section, field] = k.split(SEP);
    (extras[section] ||= {})[field] = stn[k];
  });

  // Extract ALL "General Information" fields to show in the main GI table
  const GI_NAME = 'general information';
  const GI_STD = new Set(['station id','category','site name','station name','province','latitude','longitude','status']);
  const giAll = {};
  if (extras[Object.keys(extras).find(s => String(s).trim().toLowerCase() === GI_NAME)]){
    const keyGI = Object.keys(extras).find(s => String(s).trim().toLowerCase() === GI_NAME);
    Object.assign(giAll, extras[keyGI] || {});
    // Remove GI section from extras entirely (no "extra general information")
    delete extras[keyGI];
  }

  let html = '';
  
  // Add pills at the top
  html += '<div class="meta-row" style="margin-bottom: 12px;">';
  html += statusPill + categoryPill;
  html += '</div>';

  // Most recent photo section
  html += '<div class="rhs-photo-section">';
  html += '<h3>Station Photo</h3>';
  html += '<div class="rhs-photo-container" id="rhsPhotoContainer">';
  html += '<div class="rhs-photo-placeholder">Loading photo...</div>';
  html += '</div>';
  html += '</div>';

  // General Information section
  html += '<div class="station-section">';
  html += '<h3>General Information</h3><table>';
  // 1) Render the standard/fixed GI rows once, in order
  fixedOrder.forEach(([label, value]) => {
    const display = (value === null || value === undefined || String(value).trim() === '')
      ? '<span class="kv-empty">—</span>'
      : escapeHtml(String(value));
    html += `<tr><th>${escapeHtml(label)}:</th><td>${display}</td></tr>`;
  });
  // 2) Append any additional GI fields (beyond the standard 7) once
  Object.entries(giAll).forEach(([fld, value]) => {
    const key = String(fld || '').trim().toLowerCase();
    if (GI_STD.has(key)) return; // already shown above
    const display = (value === null || value === undefined || String(value).trim() === '')
      ? '<span class="kv-empty">—</span>'
      : escapeHtml(String(value));
    html += `<tr><th>${escapeHtml(fld)}:</th><td>${display}</td></tr>`;
  });
  html += '</table></div>';

  // Extra sections as collapsible accordions
  if (Object.keys(extras).length > 0) {
    html += '<div class="rhs-accordion">';
   // SORTING: Alphabetical, with "Funding Type Override Settings" forced to the bottom
    const sectionKeys = Object.keys(extras).sort((a, b) => {
      const sA = String(a).trim();
      const sB = String(b).trim();
      if (sA === 'Funding Type Override Settings') return 1;
      if (sB === 'Funding Type Override Settings') return -1;
      return sA.localeCompare(sB);
    });

    sectionKeys.forEach(section => {
      const fields = extras[section];
      const title = section;
      html += `
        <div class="rhs-accordion-item">
          <button type="button" class="rhs-accordion-header">
            ${escapeHtml(title)}
            <span class="rhs-chev"></span>
          </button>
          <div class="rhs-accordion-content">
            ${createFieldRows(fields)}
          </div>
        </div>`;
    });
    html += '</div>';
  }

  body.innerHTML = html;
  
  // Bind accordion toggles
  body.querySelectorAll('.rhs-accordion-item .rhs-accordion-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.rhs-accordion-item');
      item.classList.toggle('open');
    });
  });

  // Load the most recent photo
  await loadRecentPhotoForRHS(stn);
}

// New function to load and display the most recent photo in RHS
async function loadRecentPhotoForRHS(stn) {
  const photoContainer = document.getElementById('rhsPhotoContainer');
  if (!photoContainer) return;

  try {
    // Use the same photo loading logic as station detail page
    const photos = await window.electronAPI.getRecentPhotos(stn.name, stn.station_id, 1);
    
    if (!photos || photos.length === 0) {
      photoContainer.innerHTML = '<div class="rhs-photo-empty">No photos available</div>';
      return;
    }

    const photo = photos[0]; // Get the most recent photo
    photoContainer.innerHTML = `
      <div class="rhs-photo-wrapper">
        <img class="rhs-photo-thumb"
             src="${photo.url}"
             alt="${escapeHtml(photo.name || `${stn.name} photo`)}" />
      </div>`;

    // Add click handler to open lightbox (reuse station detail lightbox if available)
    const img = photoContainer.querySelector('.rhs-photo-thumb');
    if (img) {
      img.addEventListener('click', () => {
        // Try to use the station detail lightbox if it exists
        const lightbox = document.getElementById('photoLightbox');
        const lightboxImg = document.getElementById('lightboxImg');
        
        if (lightbox && lightboxImg) {
          lightboxImg.src = photo.url;
          lightbox.classList.add('open');
          document.documentElement.classList.add('modal-open');
          document.body.classList.add('modal-open');
        } else {
          // Fallback: open in new window
          window.open(photo.url, '_blank');
        }
      });
    }

  } catch (e) {
    console.warn('[RHS Photo] Failed to load photo:', e);
    photoContainer.innerHTML = '<div class="rhs-photo-empty">Photo unavailable</div>';
  }
}

// Helper functions (add these if they don't exist)
function createStatusPill(status) {
  const sRaw = status || 'Unknown';
  const s = String(sRaw).trim().toLowerCase();
  let pillClass = 'pill--amber'; // default
  
  if (s === 'active') pillClass = 'pill--green';
  else if (s === 'inactive') pillClass = 'pill--red';
  
  return `<span class="pill ${pillClass}">${escapeHtml(sRaw)}</span>`;
}

function createCategoryPill(assetType) {
  return `<span class="pill pill--muted">${escapeHtml(assetType || '—')}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function createFieldRows(fields) {
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmt = (v) => (v === null || v === undefined || String(v).trim() === '') ? '<span class="kv-empty">—</span>' : escape(v);
  
  let rows = '';
  Object.entries(fields).forEach(([fld, val]) => {
    rows += `
      <div class="rhs-kv-row">
        <div class="rhs-kv-label">${escape(fld)}</div>
        <div class="rhs-kv-value">${fmt(val)}</div>
      </div>`;
  });
  return `<div class="rhs-kv-list">${rows}</div>`;
}


window.showStationDetails = window.showStationDetails || showStationDetails;

// ────────────────────────────────────────────────────────────────────────────
// FIXED: Completely rewritten filter logic
// ────────────────────────────────────────────────────────────────────────────
async function refreshMarkers() {
  if (RENDER_IN_PROGRESS) {
    return;
  }
  
  RENDER_IN_PROGRESS = true;
  
  // --- FIX for RACE CONDITION ---
  // If this refresh is being triggered (e.g., by a user filter)
  // and the initial fast-boot timer is still pending,
  // cancel the timer and force a full (non-fast-boot) render.
  clearTimeout(fastBootTimer);
  FAST_BOOT = false;
  // ------------------------------

  try {
    // Load station data
    if (typeof window.electronAPI?.getStationData === 'function') {
      mapStationData = await window.electronAPI.getStationData({});
    }

    // Validate coordinates
    const allValid = (mapStationData || []).filter(stn => {
      const lat = Number(stn.lat), lon = Number(stn.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) &&
             Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    });

    // CRITICAL FIX: Default to showing ALL stations, only filter if explicitly restricting
    let filtered = allValid;
    
    // Only apply filters if they are actually restricting something
    if (areFiltersActuallyRestricting()) {
      const { locations, assetTypes, totalLocs, totalAts, _norm } = getActiveFilters();

    filtered = allValid.filter(stn => {
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

    } else {
    }

    // Fast-boot trimming for initial render performance
    let rows = filtered;
    if (FAST_BOOT && map) {
      const inView = [];
      const b = map.getBounds();
      for (const stn of filtered) {
        if (b.contains([Number(stn.lat), Number(stn.lon)])) inView.push(stn);
        if (inView.length >= MAX_INITIAL_PINS) break;
      }
      rows = inView.length ? inView : filtered.slice(0, MAX_INITIAL_PINS);
    }

    // Clear existing markers
    markersLayer.clearLayers();
    
    // Small delay to ensure canvas is ready
    await new Promise(resolve => setTimeout(resolve, 10));

    // Draw markers
    const batchSize = 200;
    let markersAdded = 0;
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      for (const stn of batch) {
        const lat = Number(stn.lat);
        const lon = Number(stn.lon);
        
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

        try {
          const marker = addTriRingMarker(lat, lon, stn.color);
          if (marker) {
            marker.bindPopup(
              `<a href="#" class="popup-link" data-id="${stn.station_id}">${stn.name || stn.station_id}</a>`
            );

            marker.on('click', (e) => {
              if (e.originalEvent && e.originalEvent.target.tagName === 'A') return;
              marker.openPopup();
              showStationDetails(stn);
            });

            // Bind click to the *current* popup DOM (more reliable than document.querySelector)
            marker.on('popupopen', (evt) => {
              // Wait a tick to ensure Leaflet has inserted the popup content
              setTimeout(() => {
                const popupEl = evt && evt.popup ? evt.popup.getElement() : null;
                if (!popupEl) return;
                const link = popupEl.querySelector('a.popup-link');
                if (!link) return;

                const openDetails = (e) => {
                  // Completely stop the event so Leaflet doesn't re-handle it
                  if (window.L && window.L.DomEvent) window.L.DomEvent.stop(e);
                  e?.preventDefault?.();
                  if (typeof window.loadStationPage === 'function') {
                    window.loadStationPage(stn.station_id, 'map'); // remember origin
                  }
                };

                // Use Leaflet’s DOM event system to avoid propagation to the map
                if (window.L && window.L.DomEvent) {
                  L.DomEvent.on(link, 'click', openDetails);
                  // Be extra-safe on different inputs
                  L.DomEvent.on(link, 'mousedown', L.DomEvent.stopPropagation);
                  L.DomEvent.on(link, 'dblclick', L.DomEvent.stopPropagation);
                  L.DomEvent.on(link, 'keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') openDetails(e);
                  });
                } else {
                  // Fallback, just in case
                  link.addEventListener('click', openDetails, { once: true });
                }
              }, 0);
            });
            
            markersAdded++;
          }
        } catch (error) {
          console.error('[map] Error adding marker for station:', stn.station_id, error);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    
    // Fit bounds once
    if (!DID_FIT_BOUNDS && filtered.length && map) {
      const latlngs = filtered.map(s => [Number(s.lat), Number(s.lon)]);
      try {
        map.fitBounds(latlngs, { padding: [24, 24] });
        DID_FIT_BOUNDS = true;
      } catch (e) {
        console.error('[map] Error fitting bounds:', e);
      }
    }

  } catch (err) {
    console.error('[map_view] refreshMarkers failed:', err);
  } finally {
    RENDER_IN_PROGRESS = false;
    try { 
      map.invalidateSize(); 
    } catch(_) {}
  }
}

const debouncedRefreshMarkers = debounce(refreshMarkers, 200);
window.refreshMarkers = debouncedRefreshMarkers;

window.invalidateStationData = function invalidateStationData() {
  try { 
    mapStationData = []; 
  } catch (_) {}
};

// ────────────────────────────────────────────────────────────────────────────
// Startup
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const boot = () => {
    if (!window.L || typeof L.map !== 'function') {
      console.error('[map] Leaflet still undefined at boot');
      return;
    }

    initMap();

    refreshMarkers();

    const filterTree = document.getElementById('filterTree');
    if (filterTree) {
      filterTree.addEventListener('change', () => {
        debouncedRefreshMarkers();
      });
    }

    // Switch to full render mode
    fastBootTimer = setTimeout(async () => {
      FAST_BOOT = false;
      
      try {
        if (typeof window.electronAPI?.getStationData === 'function') {
          mapStationData = await window.electronAPI.getStationData({});
        }
      } catch (e) {
        console.error('[map] Error reloading station data:', e);
      }
      
      await refreshMarkers();
    }, 2000);

    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 500);
    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 1000);
  };

  (function waitForLeaflet(tries = 0){
    if (window.L && typeof window.L.map === 'function') {
      boot();
    } else if (tries < 60) {
      setTimeout(() => waitForLeaflet(tries + 1), 50);
    } else {
      console.error('[map] Leaflet failed to load');
    }
  })();

  // Global focus guard: any click on an editable control re-focuses it.
  // Helps recover from rare cases where focus is "lost" to the document/map.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!t) return;
    const isEditable =
      t.matches?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (isEditable) {
      // Ensure the element *actually* gains focus after the event bubble
      setTimeout(() => t.focus?.(), 0);
    }
  }, true); // capture phase so it runs even if something stops propagation
});
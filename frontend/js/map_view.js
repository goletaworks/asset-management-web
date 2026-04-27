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
let activeMapMode = 'world';
let activeMapProfileKey = '';
let baseMapControl = null;
let worldTileLayers = [];
let blueprintOverlayHost = null;
let blueprintPinsHost = null;
let blueprintAnnoHost = null;
let blueprintToolbarHost = null;
let blueprintPolygonData = [];
let blueprintLocalMarkers = [];
let blueprintDraftPolygon = null;
let blueprintAnnotMode = 'point';
let blueprintAnnotCompany = '';
let blueprintDocWidth = 0;
let blueprintDocHeight = 0;
let blueprintGeomLines = [];
let blueprintSnapPoints = [];
let blueprintSnapActive = null;
let blueprintSnapHost = null;
let blueprintAnnoFrameHost = null;

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

function getSelectedCompanyName() {
  const checked = document.querySelector('#filterTree input.filter-checkbox.company:checked');
  return checked ? (checked.dataset.company || checked.value || '') : '';
}

function getSingleBlueprintTarget() {
  const companyCb = document.querySelector('#filterTree input.filter-checkbox.company:checked');
  if (!companyCb) return null;
  const company = String(companyCb.dataset.company || companyCb.value || '').trim();
  const locationCbs = Array.from(document.querySelectorAll('#filterTree input.filter-checkbox.location:checked'))
    .filter(cb => String(cb.dataset.company || '').trim() === company);
  if (locationCbs.length !== 1) return null;
  const location = String(locationCbs[0].value || '').trim();
  const assetCbs = Array.from(document.querySelectorAll('#filterTree input.filter-checkbox.asset-type:checked'))
    .filter(cb =>
      String(cb.dataset.company || '').trim() === company &&
      String(cb.dataset.location || '').trim() === location
    );
  if (assetCbs.length !== 1) return null;
  const assetType = String(assetCbs[0].value || '').trim();
  if (!company || !location || !assetType) return null;
  return { company, location, assetType };
}

function getPolygonCentroid(points = []) {
  if (!Array.isArray(points) || points.length < 3) return { x: 50, y: 50 };
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const cross = (Number(p1.x) * Number(p2.y)) - (Number(p2.x) * Number(p1.y));
    area += cross;
    cx += (Number(p1.x) + Number(p2.x)) * cross;
    cy += (Number(p1.y) + Number(p2.y)) * cross;
  }
  area /= 2;
  if (!Number.isFinite(area) || Math.abs(area) < 1e-9) {
    const sum = points.reduce((acc, p) => ({ x: acc.x + Number(p.x || 0), y: acc.y + Number(p.y || 0) }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function nextPolygonId() {
  const maxN = blueprintPolygonData.reduce((acc, p) => {
    const m = String(p?.label || p?.id || '').match(/^P(\d+)$/i);
    if (!m) return acc;
    return Math.max(acc, Number(m[1]));
  }, 0);
  return `P${maxN + 1}`;
}

function promptBlueprintId(title, subtitle, suggested = '', { required = false } = {}) {
  return new Promise((resolve) => {
    while (true) {
      const input = window.prompt(`${title}\n${subtitle}`, suggested || '');
      if (input === null) {
        resolve(null);
        return;
      }
      const val = String(input || '').trim();
      if (!required || val) {
        resolve(val);
        return;
      }
      window.appAlert?.('Name is required.');
    }
  });
}

function normalizeMapProfile(profile) {
  const fallbackScope = (window.CompanyMapCatalog && window.CompanyMapCatalog.defaultWorldScope)
    ? { ...window.CompanyMapCatalog.defaultWorldScope }
    : { type: 'continent', key: 'north-america', label: 'North America', center: [46, -98], zoom: 3, bounds: [[7, -170], [84, -52]] };
  if (!profile || typeof profile !== 'object') {
    return { mode: 'world', worldScope: fallbackScope, blueprintAsset: null };
  }
  const mode = profile.mode === 'blueprint' ? 'blueprint' : 'world';
  let worldScope = profile.worldScope && typeof profile.worldScope === 'object'
    ? { ...profile.worldScope }
    : fallbackScope;
  if (!worldScope?.bounds && worldScope?.type && worldScope?.key && window.CompanyMapCatalog?.getScope) {
    const scopeFromCatalog = window.CompanyMapCatalog.getScope(worldScope.type, worldScope.key);
    if (scopeFromCatalog?.bounds) {
      worldScope = { ...worldScope, bounds: scopeFromCatalog.bounds };
    }
  }
  const blueprintAsset = profile.blueprintAsset && typeof profile.blueprintAsset === 'object'
    ? { ...profile.blueprintAsset }
    : null;
  return { mode, worldScope, blueprintAsset };
}

async function getSelectedCompanyMapProfile() {
  const selectedCompany = getSelectedCompanyName();
  if (!selectedCompany || typeof window.electronAPI?.getLookupTree !== 'function') {
    return normalizeMapProfile(null);
  }
  try {
    const tree = await window.electronAPI.getLookupTree();
    const companies = Array.isArray(tree?.companies) ? tree.companies : [];
    const selected = companies.find(c => (typeof c === 'string' ? c : c?.name) === selectedCompany);
    return normalizeMapProfile(typeof selected === 'object' ? selected.mapProfile : null);
  } catch (_) {
    return normalizeMapProfile(null);
  }
}

function ensureBlueprintOverlay() {
  const mapContainer = document.getElementById('mapContainer');
  if (!mapContainer) return null;
  if (!blueprintOverlayHost) {
    blueprintOverlayHost = document.createElement('div');
    blueprintOverlayHost.id = 'blueprintOverlay';
    blueprintOverlayHost.className = 'blueprint-overlay';
    mapContainer.appendChild(blueprintOverlayHost);
  }
  if (!blueprintPinsHost) {
    blueprintPinsHost = document.createElement('div');
    blueprintPinsHost.id = 'blueprintPins';
    blueprintPinsHost.className = 'blueprint-pins';
    mapContainer.appendChild(blueprintPinsHost);
  }
  if (!blueprintAnnoHost) {
    blueprintAnnoHost = document.createElement('div');
    blueprintAnnoHost.id = 'blueprintAnno';
    blueprintAnnoHost.className = 'blueprint-anno';
    mapContainer.appendChild(blueprintAnnoHost);
  }
  if (!blueprintToolbarHost) {
    blueprintToolbarHost = document.createElement('div');
    blueprintToolbarHost.id = 'blueprintToolbar';
    blueprintToolbarHost.className = 'blueprint-toolbar';
    mapContainer.appendChild(blueprintToolbarHost);
  }
  return blueprintOverlayHost;
}

function hideBlueprintOverlay() {
  if (blueprintOverlayHost) {
    blueprintOverlayHost.style.display = 'none';
    blueprintOverlayHost.innerHTML = '';
  }
  if (blueprintPinsHost) {
    blueprintPinsHost.style.display = 'none';
    blueprintPinsHost.innerHTML = '';
  }
  if (blueprintAnnoHost) {
    blueprintAnnoHost.style.display = 'none';
    blueprintAnnoHost.innerHTML = '';
  }
  if (blueprintToolbarHost) {
    blueprintToolbarHost.style.display = 'none';
    blueprintToolbarHost.innerHTML = '';
  }
}

function showBlueprintMessage(message) {
  ensureBlueprintOverlay();
  if (!blueprintOverlayHost) return;
  blueprintOverlayHost.style.display = 'flex';
  blueprintOverlayHost.innerHTML = `<div class="blueprint-empty">${message}</div>`;
  if (blueprintPinsHost) {
    blueprintPinsHost.style.display = 'none';
    blueprintPinsHost.innerHTML = '';
  }
  if (blueprintAnnoHost) {
    blueprintAnnoHost.style.display = 'none';
    blueprintAnnoHost.innerHTML = '';
  }
  if (blueprintToolbarHost) {
    blueprintToolbarHost.style.display = 'none';
    blueprintToolbarHost.innerHTML = '';
  }
}

async function ensurePdfJsLoaded() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (window.__pdfJsLoadPromise) return window.__pdfJsLoadPromise;
  window.__pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => resolve(window.pdfjsLib || null);
    script.onerror = () => reject(new Error('Failed to load PDF renderer.'));
    document.head.appendChild(script);
  });
  const lib = await window.__pdfJsLoadPromise;
  if (!lib) throw new Error('PDF renderer unavailable.');
  if (lib.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }
  return lib;
}

function segIntersect(a, b) {
  const denom = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x1 - b.x1) * (b.y1 - b.y2) - (a.y1 - b.y1) * (b.x1 - b.x2)) / denom;
  const u = -((a.x1 - a.x2) * (a.y1 - b.y1) - (a.y1 - a.y2) * (a.x1 - b.x1)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x1 + t * (a.x2 - a.x1), y: a.y1 + t * (a.y2 - a.y1) };
}

function buildSnapGraphFromLines(lines = []) {
  const points = [];
  const addPoint = (x, y, type) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    points.push({ x, y, type });
  };
  lines.forEach((ln) => {
    addPoint(ln.x1, ln.y1, 'endpoint');
    addPoint(ln.x2, ln.y2, 'endpoint');
    addPoint((ln.x1 + ln.x2) / 2, (ln.y1 + ln.y2) / 2, 'midpoint');
  });
  const cap = Math.min(lines.length, 1200);
  for (let i = 0; i < cap; i += 1) {
    for (let j = i + 1; j < cap; j += 1) {
      const pt = segIntersect(lines[i], lines[j]);
      if (pt) addPoint(pt.x, pt.y, 'intersection');
    }
  }
  const dedup = new Map();
  points.forEach((p) => {
    const k = `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    if (!dedup.has(k)) dedup.set(k, p);
  });
  blueprintSnapPoints = Array.from(dedup.values());
}

function pointLineProjection(pt, ln) {
  const dx = ln.x2 - ln.x1;
  const dy = ln.y2 - ln.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return null;
  const t = Math.max(0, Math.min(1, ((pt.x - ln.x1) * dx + (pt.y - ln.y1) * dy) / len2));
  const x = ln.x1 + t * dx;
  const y = ln.y1 + t * dy;
  return { x, y, t };
}

function getBlueprintMetrics() {
  if (!blueprintOverlayHost || !blueprintDocWidth || !blueprintDocHeight) return null;
  const rect = blueprintOverlayHost.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / blueprintDocWidth, rect.height / blueprintDocHeight);
  const drawWidth = blueprintDocWidth * scale;
  const drawHeight = blueprintDocHeight * scale;
  const drawLeft = rect.left + (rect.width - drawWidth) / 2;
  const drawTop = rect.top + (rect.height - drawHeight) / 2;
  return { rect, scale, drawWidth, drawHeight, drawLeft, drawTop };
}

function screenToBlueprintDoc(clientX, clientY) {
  const m = getBlueprintMetrics();
  if (!m) return null;
  const inBounds = clientX >= m.drawLeft && clientX <= (m.drawLeft + m.drawWidth)
    && clientY >= m.drawTop && clientY <= (m.drawTop + m.drawHeight);
  if (!inBounds) return null;
  const px = (clientX - m.drawLeft) / m.scale;
  const py = (clientY - m.drawTop) / m.scale;
  return {
    x: Math.max(0, Math.min(blueprintDocWidth, px)),
    y: Math.max(0, Math.min(blueprintDocHeight, py)),
  };
}

function docToBlueprintPercent(pt) {
  return {
    x: Math.max(0, Math.min(100, (Number(pt.x) / blueprintDocWidth) * 100)),
    y: Math.max(0, Math.min(100, (Number(pt.y) / blueprintDocHeight) * 100)),
  };
}

function percentToDocPoint(pt) {
  return {
    x: (Number(pt.x) / 100) * blueprintDocWidth,
    y: (Number(pt.y) / 100) * blueprintDocHeight,
  };
}

function docToScreenPoint(pt) {
  const m = getBlueprintMetrics();
  if (!m) return null;
  return {
    x: m.drawLeft + Number(pt.x) * m.scale,
    y: m.drawTop + Number(pt.y) * m.scale,
  };
}

function resolveSnapPoint(clientX, clientY) {
  const doc = screenToBlueprintDoc(clientX, clientY);
  const m = getBlueprintMetrics();
  if (!doc || !m) return null;
  const thresholdPx = 16;
  const thresholdDoc = thresholdPx / m.scale;
  const priority = { endpoint: 1000, intersection: 900, midpoint: 800, line: 700 };
  let best = null;
  let bestScore = -Infinity;

  blueprintSnapPoints.forEach((p) => {
    const d = Math.hypot(p.x - doc.x, p.y - doc.y);
    if (d > thresholdDoc) return;
    const score = (priority[p.type] || 0) - d;
    if (score > bestScore) {
      bestScore = score;
      best = { x: p.x, y: p.y, type: p.type };
    }
  });

  if (!best && blueprintGeomLines.length) {
    let lineBest = null;
    let lineD = Number.POSITIVE_INFINITY;
    const lim = Math.min(blueprintGeomLines.length, 2000);
    for (let i = 0; i < lim; i += 1) {
      const proj = pointLineProjection(doc, blueprintGeomLines[i]);
      if (!proj) continue;
      const d = Math.hypot(proj.x - doc.x, proj.y - doc.y);
      if (d < lineD) {
        lineD = d;
        lineBest = proj;
      }
    }
    if (lineBest && lineD <= thresholdDoc) {
      best = { x: lineBest.x, y: lineBest.y, type: 'line' };
    }
  }

  if (!best) {
    best = { x: doc.x, y: doc.y, type: 'free' };
  }
  blueprintSnapActive = best;
  return best;
}

function renderBlueprintSnapIndicator() {
  if (!blueprintAnnoHost) return;
  if (!blueprintSnapHost) {
    blueprintSnapHost = document.createElement('div');
    blueprintSnapHost.className = 'blueprint-snap-indicator';
    blueprintAnnoHost.appendChild(blueprintSnapHost);
  }
  if (!blueprintSnapActive) {
    blueprintSnapHost.style.display = 'none';
    return;
  }
  const s = docToScreenPoint(blueprintSnapActive);
  if (!s) {
    blueprintSnapHost.style.display = 'none';
    return;
  }
  const rect = blueprintAnnoHost.getBoundingClientRect();
  blueprintSnapHost.style.display = 'block';
  blueprintSnapHost.style.left = `${s.x - rect.left}px`;
  blueprintSnapHost.style.top = `${s.y - rect.top}px`;
}

async function extractPdfLines(page, viewport, pdfjsLib) {
  const lines = [];
  const opList = await page.getOperatorList();
  const OPS = pdfjsLib.OPS;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let cur = null;
  let start = null;
  const apply = (x, y) => {
    const [a, b, c, d, e, f] = ctm;
    return { x: (a * x) + (c * y) + e, y: (b * x) + (d * y) + f };
  };
  const mapPt = (pt) => {
    const [vx, vy] = viewport.convertToViewportPoint(pt.x, pt.y);
    return { x: vx, y: vy };
  };
  const pushLine = (p1, p2) => {
    const a = mapPt(p1);
    const b = mapPt(p2);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1) return;
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  };
  const moveTo = (x, y) => {
    const pt = apply(x, y);
    cur = pt;
    start = pt;
  };
  const lineTo = (x, y) => {
    if (!cur) return;
    const pt = apply(x, y);
    pushLine(cur, pt);
    cur = pt;
  };

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
    if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); continue; }
    if (fn === OPS.transform) {
      const [a, b, c, d, e, f] = args;
      const [A, B, C, D, E, F] = ctm;
      ctm = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
      continue;
    }
    if (fn === OPS.moveTo) { moveTo(args[0], args[1]); continue; }
    if (fn === OPS.lineTo) { lineTo(args[0], args[1]); continue; }
    if (fn === OPS.curveTo) { lineTo(args[4], args[5]); continue; }
    if (fn === OPS.curveTo2 || fn === OPS.curveTo3) { lineTo(args[2], args[3]); continue; }
    if (fn === OPS.closePath && cur && start) { pushLine(cur, start); cur = start; continue; }
    if (fn === OPS.rectangle) {
      const [x, y, w, h] = args;
      const p1 = apply(x, y);
      const p2 = apply(x + w, y);
      const p3 = apply(x + w, y + h);
      const p4 = apply(x, y + h);
      pushLine(p1, p2); pushLine(p2, p3); pushLine(p3, p4); pushLine(p4, p1);
      cur = p1;
      start = p1;
    }
  }
  return lines;
}

function vectorizeImageLines(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    gray[i] = (data[(i * 4)] * 0.299 + data[(i * 4) + 1] * 0.587 + data[(i * 4) + 2] * 0.114) | 0;
  }
  let mean = 0;
  for (let i = 0; i < gray.length; i += 1) mean += gray[i];
  mean /= gray.length || 1;
  const threshold = Math.min(200, mean - 18);
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < bin.length; i += 1) bin[i] = gray[i] < threshold ? 1 : 0;

  const lines = [];
  const minLen = Math.max(24, Math.min(width, height) / 45);
  const gapTol = 3;

  for (let y = 0; y < height; y += 1) {
    let s = -1;
    let gap = 0;
    for (let x = 0; x < width; x += 1) {
      if (bin[(y * width) + x]) { if (s < 0) s = x; gap = 0; }
      else if (s >= 0) {
        gap += 1;
        if (gap > gapTol) {
          const e = x - gap;
          if (e - s >= minLen) lines.push({ x1: s, y1: y, x2: e, y2: y });
          s = -1;
          gap = 0;
        }
      }
    }
    if (s >= 0 && (width - 1 - s) >= minLen) lines.push({ x1: s, y1: y, x2: width - 1, y2: y });
  }
  for (let x = 0; x < width; x += 1) {
    let s = -1;
    let gap = 0;
    for (let y = 0; y < height; y += 1) {
      if (bin[(y * width) + x]) { if (s < 0) s = y; gap = 0; }
      else if (s >= 0) {
        gap += 1;
        if (gap > gapTol) {
          const e = y - gap;
          if (e - s >= minLen) lines.push({ x1: x, y1: s, x2: x, y2: e });
          s = -1;
          gap = 0;
        }
      }
    }
    if (s >= 0 && (height - 1 - s) >= minLen) lines.push({ x1: x, y1: s, x2: x, y2: height - 1 });
  }
  return lines;
}

async function renderPdfFirstPageData(url) {
  const pdfjsLib = await ensurePdfJsLoaded();
  const task = pdfjsLib.getDocument({ url, withCredentials: true });
  const pdf = await task.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  const lines = await extractPdfLines(page, viewport, pdfjsLib);
  const imageUrl = canvas.toDataURL('image/png');
  try { pdf.cleanup(); } catch (_) {}
  try { pdf.destroy(); } catch (_) {}
  return { imageUrl, width: viewport.width, height: viewport.height, lines };
}

function setBlueprintWarning(message) {
  if (!blueprintOverlayHost) return;
  let warningEl = blueprintOverlayHost.querySelector('.blueprint-warning');
  if (!message) {
    if (warningEl) warningEl.remove();
    blueprintOverlayHost.removeAttribute('data-warning');
    return;
  }
  if (!warningEl) {
    warningEl = document.createElement('div');
    warningEl.className = 'blueprint-warning';
    blueprintOverlayHost.appendChild(warningEl);
  }
  warningEl.textContent = message;
  blueprintOverlayHost.setAttribute('data-warning', message);
}

async function renderBlueprintBase(profile) {
  ensureBlueprintOverlay();
  blueprintGeomLines = [];
  blueprintSnapPoints = [];
  blueprintSnapActive = null;
  blueprintDocWidth = 0;
  blueprintDocHeight = 0;
  const asset = profile?.blueprintAsset || null;
  if (!asset?.path || typeof window.electronAPI?.getCompanyMapAssetUrl !== 'function') {
    showBlueprintMessage('Blueprint file is missing or unavailable. Open Create Company and upload the blueprint/PDF again.');
    return false;
  }
  const url = window.electronAPI.getCompanyMapAssetUrl(asset.path);
  const mime = String(asset.mimeType || '').toLowerCase();
  blueprintOverlayHost.style.display = 'block';
  if (mime.includes('pdf')) {
    try {
      const pdfData = await renderPdfFirstPageData(url);
      blueprintOverlayHost.innerHTML = `<img class="blueprint-image" src="${pdfData.imageUrl}" alt="Blueprint PDF page 1" />`;
      blueprintDocWidth = Number(pdfData.width) || 0;
      blueprintDocHeight = Number(pdfData.height) || 0;
      blueprintGeomLines = Array.isArray(pdfData.lines) ? pdfData.lines : [];
    } catch (e) {
      console.error('[map] PDF first-page render failed:', e);
      showBlueprintMessage('Unable to render PDF first page. Please upload an image blueprint or try a different PDF.');
      return false;
    }
  } else {
    blueprintOverlayHost.innerHTML = `<img class="blueprint-image" src="${url}" alt="Blueprint map" />`;
    const img = blueprintOverlayHost.querySelector('.blueprint-image');
    if (img) {
      await new Promise((resolve) => {
        if (img.complete) { resolve(); return; }
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
      blueprintDocWidth = img.naturalWidth || img.width || 0;
      blueprintDocHeight = img.naturalHeight || img.height || 0;
      try {
        const cv = document.createElement('canvas');
        cv.width = blueprintDocWidth;
        cv.height = blueprintDocHeight;
        const cctx = cv.getContext('2d');
        cctx.drawImage(img, 0, 0, cv.width, cv.height);
        blueprintGeomLines = vectorizeImageLines(cctx, cv.width, cv.height);
      } catch (_) {
        blueprintGeomLines = [];
      }
    }
  }
  if (blueprintGeomLines.length) {
    buildSnapGraphFromLines(blueprintGeomLines);
  }
  if (blueprintPinsHost) {
    blueprintPinsHost.style.display = 'block';
    blueprintPinsHost.innerHTML = '';
  }
  setBlueprintWarning('');
  return true;
}

async function loadBlueprintPolygons(company) {
  if (!company || typeof window.electronAPI?.getCompanyBlueprintPolygons !== 'function') {
    blueprintLocalMarkers = [];
    blueprintPolygonData = [];
    return;
  }
  try {
    const res = await window.electronAPI.getCompanyBlueprintPolygons(company);
    blueprintLocalMarkers = Array.isArray(res?.points) ? res.points : [];
    blueprintPolygonData = Array.isArray(res?.polygons) ? res.polygons : [];
  } catch (_) {
    blueprintLocalMarkers = [];
    blueprintPolygonData = [];
  }
}

async function saveBlueprintPolygons(company) {
  if (!company || typeof window.electronAPI?.saveCompanyBlueprintPolygons !== 'function') {
    return { success: false, message: 'Polygon API unavailable.' };
  }
  return window.electronAPI.saveCompanyBlueprintPolygons(company, blueprintPolygonData, blueprintLocalMarkers);
}

function getBlueprintClickPercent(evt) {
  const snap = resolveSnapPoint(evt.clientX, evt.clientY);
  if (!snap) return null;
  return docToBlueprintPercent(snap);
}

function updateBlueprintToolbarState() {
  if (!blueprintToolbarHost) return;
  const pointBtn = blueprintToolbarHost.querySelector('[data-act="point"]');
  const polyBtn = blueprintToolbarHost.querySelector('[data-act="polygon"]');
  const undoBtn = blueprintToolbarHost.querySelector('[data-act="undo"]');
  const clearBtn = blueprintToolbarHost.querySelector('[data-act="clear"]');
  const saveBtn = blueprintToolbarHost.querySelector('[data-act="save"]');
  if (pointBtn) pointBtn.classList.toggle('is-active', blueprintAnnotMode === 'point');
  if (polyBtn) polyBtn.classList.toggle('is-active', blueprintAnnotMode === 'polygon');
  const hasDraft = !!(blueprintDraftPolygon && blueprintDraftPolygon.points?.length);
  const hasLocal = blueprintLocalMarkers.length > 0 || hasDraft;
  if (undoBtn) undoBtn.disabled = !hasLocal && blueprintPolygonData.length === 0;
  if (clearBtn) clearBtn.disabled = !hasLocal && blueprintPolygonData.length === 0;
  if (saveBtn) saveBtn.disabled = blueprintLocalMarkers.length === 0 && !hasDraft && blueprintPolygonData.length === 0;
}

function renderBlueprintAnnotationsLayer() {
  if (!blueprintAnnoHost) return;
  blueprintAnnoHost.style.display = 'block';
  blueprintSnapHost = null;
  blueprintAnnoFrameHost = null;
  const metrics = getBlueprintMetrics();
  if (!metrics) {
    blueprintAnnoHost.innerHTML = '';
    return;
  }

  const persistedPolygons = Array.isArray(blueprintPolygonData) ? blueprintPolygonData : [];
  const draftPts = Array.isArray(blueprintDraftPolygon?.points) ? blueprintDraftPolygon.points : [];
  const markerHtml = blueprintLocalMarkers.map((m, idx) => {
    const tag = `${m.label || `M${idx + 1}`}.${Math.round(m.x)},${Math.round(m.y)}`;
    return `<button type="button" class="blueprint-anno-marker" style="left:${m.x}%;top:${m.y}%;" title="${tag}">
      <span class="blueprint-anno-marker__dot"></span>
      <span class="blueprint-anno-tag">${tag}</span>
    </button>`;
  }).join('');

  const polygonsSvg = [
    '<svg class="blueprint-anno-svg" viewBox="0 0 100 100" preserveAspectRatio="none">',
    ...persistedPolygons.map(poly => {
      const pts = (Array.isArray(poly.points) ? poly.points : [])
        .map(pt => `${Number(pt.x)},${Number(pt.y)}`).join(' ');
      if (!pts) return '';
      const c = getPolygonCentroid(poly.points || []);
      const tag = `${poly.label || poly.id || ''}.${Math.round(c.x)},${Math.round(c.y)}`;
      return `<g>
        <polygon class="blueprint-anno-poly" points="${pts}"></polygon>
        <text class="blueprint-anno-poly-label" x="${c.x}" y="${c.y}">${tag}</text>
      </g>`;
    }).filter(Boolean),
    draftPts.length >= 2 ? `<polyline class="blueprint-anno-draft" points="${draftPts.map(p => `${p.x},${p.y}`).join(' ')}"></polyline>` : '',
    ...draftPts.map((pt, i) => `<circle class="blueprint-anno-vertex${i === 0 ? ' is-first' : ''}" cx="${pt.x}" cy="${pt.y}" r="0.45"></circle>`),
    '</svg>',
  ].join('');

  blueprintAnnoHost.innerHTML = `
    <div class="blueprint-anno-frame" style="left:${metrics.drawLeft - metrics.rect.left}px;top:${metrics.drawTop - metrics.rect.top}px;width:${metrics.drawWidth}px;height:${metrics.drawHeight}px;">
      ${polygonsSvg}${markerHtml}
    </div>
  `;
  blueprintAnnoFrameHost = blueprintAnnoHost.querySelector('.blueprint-anno-frame');
  renderBlueprintSnapIndicator();
}

function renderBlueprintToolbar() {
  if (!blueprintToolbarHost) return;
  blueprintToolbarHost.style.display = 'flex';
  blueprintToolbarHost.innerHTML = `
    <button type="button" class="btn btn-sm blueprint-tool-btn" data-act="point">Point</button>
    <button type="button" class="btn btn-sm blueprint-tool-btn" data-act="polygon">Polygon</button>
    <button type="button" class="btn btn-sm blueprint-tool-btn" data-act="undo">Undo</button>
    <button type="button" class="btn btn-sm blueprint-tool-btn" data-act="clear">Clear</button>
    <button type="button" class="btn btn-sm btn-primary blueprint-tool-btn" data-act="save">Save</button>
  `;
  blueprintToolbarHost.querySelector('[data-act="point"]')?.addEventListener('click', () => {
    blueprintAnnotMode = 'point';
    blueprintDraftPolygon = null;
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  });
  blueprintToolbarHost.querySelector('[data-act="polygon"]')?.addEventListener('click', () => {
    blueprintAnnotMode = 'polygon';
    if (!blueprintDraftPolygon) blueprintDraftPolygon = { points: [] };
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  });
  blueprintToolbarHost.querySelector('[data-act="undo"]')?.addEventListener('click', () => {
    if (blueprintDraftPolygon?.points?.length) {
      blueprintDraftPolygon.points.pop();
      if (!blueprintDraftPolygon.points.length) blueprintDraftPolygon = null;
    } else if (blueprintPolygonData.length) {
      blueprintPolygonData.pop();
    } else if (blueprintLocalMarkers.length) {
      blueprintLocalMarkers.pop();
    }
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  });
  blueprintToolbarHost.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    blueprintLocalMarkers = [];
    blueprintPolygonData = [];
    blueprintDraftPolygon = null;
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  });
  blueprintToolbarHost.querySelector('[data-act="save"]')?.addEventListener('click', async () => {
    const company = getSelectedCompanyName();
    if (!company) {
      window.appAlert?.('Select a company first.');
      return;
    }
    const res = await saveBlueprintPolygons(company);
    if (!res || res.success === false) {
      window.appAlert?.(res?.message || 'Failed to save blueprint annotations.');
      return;
    }
    blueprintDraftPolygon = null;
    blueprintLocalMarkers = Array.isArray(res?.points) ? res.points : blueprintLocalMarkers;
    blueprintPolygonData = Array.isArray(res?.polygons) ? res.polygons : blueprintPolygonData;
    renderBlueprintAnnotationsLayer();
    window.appAlert?.('Blueprint points and polygons saved.');
  });
  updateBlueprintToolbarState();
}

function bindBlueprintAnnotationEvents() {
  if (!blueprintAnnoHost) return;
  blueprintAnnoHost.onclick = null;
  blueprintAnnoHost.ondblclick = null;
  blueprintAnnoHost.onmousemove = null;
  blueprintAnnoHost.onmouseleave = null;

  blueprintAnnoHost.onmousemove = (evt) => {
    evt.preventDefault();
    const snap = resolveSnapPoint(evt.clientX, evt.clientY);
    if (!snap) return;
    renderBlueprintSnapIndicator();
  };
  blueprintAnnoHost.onmouseleave = () => {
    blueprintSnapActive = null;
    renderBlueprintSnapIndicator();
  };

  blueprintAnnoHost.onclick = async (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    const pt = getBlueprintClickPercent(evt);
    if (!pt) return;
    if (blueprintAnnotMode === 'polygon') {
      if (!blueprintDraftPolygon) blueprintDraftPolygon = { points: [] };
      blueprintDraftPolygon.points.push(pt);
      updateBlueprintToolbarState();
      renderBlueprintAnnotationsLayer();
      return;
    }
    const suggested = `M${blueprintLocalMarkers.length + 1}`;
    const label = await promptBlueprintId('Point Name', `x:${Math.round(pt.x)} y:${Math.round(pt.y)}`, suggested, { required: true });
    if (label === null) return;
    blueprintLocalMarkers.push({ label: label || suggested, x: pt.x, y: pt.y });
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  };

  blueprintAnnoHost.ondblclick = async (evt) => {
    if (blueprintAnnotMode !== 'polygon' || !blueprintDraftPolygon || blueprintDraftPolygon.points.length < 3) return;
    evt.preventDefault();
    evt.stopPropagation();
    const snapDoc = resolveSnapPoint(evt.clientX, evt.clientY);
    if (!snapDoc) return;
    const snapPct = docToBlueprintPercent(snapDoc);
    const pts = blueprintDraftPolygon.points.slice();
    const first = pts[0];
    if (!first) return;
    const firstDoc = percentToDocPoint(first);
    const curDoc = percentToDocPoint(snapPct);
    const m = getBlueprintMetrics();
    const closePx = m ? Math.hypot(firstDoc.x - curDoc.x, firstDoc.y - curDoc.y) * m.scale : Number.POSITIVE_INFINITY;
    if (closePx > 14) return;
    pts.push(first);
    const c = getPolygonCentroid(pts);
    const suggested = nextPolygonId();
    const label = await promptBlueprintId('Polygon Name', `centroid x:${Math.round(c.x)} y:${Math.round(c.y)}`, suggested, { required: true });
    if (label !== null) {
      blueprintPolygonData.push({
        id: label || suggested,
        label: label || suggested,
        points: pts,
        updatedAt: new Date().toISOString(),
      });
    }
    blueprintDraftPolygon = null;
    updateBlueprintToolbarState();
    renderBlueprintAnnotationsLayer();
  };
}

async function ensureBlueprintAnnotator(company) {
  const normalized = String(company || '').trim();
  if (!normalized) return;
  if (normalized !== blueprintAnnotCompany) {
    blueprintAnnotCompany = normalized;
    blueprintLocalMarkers = [];
    blueprintDraftPolygon = null;
    await loadBlueprintPolygons(normalized);
  }
  renderBlueprintToolbar();
  renderBlueprintAnnotationsLayer();
  bindBlueprintAnnotationEvents();
}

function setWorldControlsVisible(visible) {
  const controls = document.querySelectorAll('.leaflet-control-layers');
  controls.forEach(el => { el.style.display = visible ? '' : 'none'; });
}

async function switchMapMode(profile) {
  activeMapMode = profile.mode === 'blueprint' ? 'blueprint' : 'world';
  if (activeMapMode === 'blueprint') {
    setWorldControlsVisible(false);
    worldTileLayers.forEach(layer => { try { map.removeLayer(layer); } catch (_) {} });
    hideBlueprintOverlay();
    const ok = await renderBlueprintBase(profile);
    markersLayer.clearLayers();
    if (!ok) return;
    map.getContainer().style.opacity = '0.2';
    if (blueprintAnnoHost) blueprintAnnoHost.style.display = 'block';
    if (blueprintToolbarHost) blueprintToolbarHost.style.display = 'flex';
  } else {
    hideBlueprintOverlay();
    map.getContainer().style.opacity = '1';
    setWorldControlsVisible(true);
    blueprintLocalMarkers = [];
    blueprintDraftPolygon = null;
    blueprintAnnotCompany = '';
    if (!worldTileLayers.some(layer => map.hasLayer(layer)) && worldTileLayers[0]) {
      worldTileLayers[0].addTo(map);
    }
  }
}

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
  worldTileLayers = [streetLayer, satelliteLayer, topoLayer];

  // 3. Add the layer control to the map (topright, as requested)
  baseMapControl = L.control.layers(baseMaps, null, { position: 'topright' });
  baseMapControl.addTo(map);

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
      if (activeMapMode === 'blueprint') {
        const size = map.getSize();
        const xPct = size.x > 0 ? ((e.containerPoint.x / size.x) * 100) : 0;
        const yPct = size.y > 0 ? ((e.containerPoint.y / size.y) * 100) : 0;
        window.openManualInstanceWizard(null, null, null, {
          blueprintX: xPct.toFixed(2),
          blueprintY: yPct.toFixed(2),
          coordinateMode: 'blueprint',
        });
      } else {
        window.openManualInstanceWizard(null, null, null, {
          lat: lat.toFixed(6),
          lon: lng.toFixed(6),
          coordinateMode: 'world',
        });
      }
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

function renderBlueprintPins(rows, selectedCompany) {
  if (!blueprintPinsHost) return;
  blueprintPinsHost.innerHTML = '';
  const companyNorm = String(selectedCompany || '').trim().toLowerCase();
  let missingXY = 0;
  rows.forEach(stn => {
    const stnCompany = String(stn.company || '').trim().toLowerCase();
    if (companyNorm && stnCompany && stnCompany !== companyNorm) return;
    const x = Number(stn.blueprint_x);
    const y = Number(stn.blueprint_y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      missingXY += 1;
      return;
    }
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'blueprint-pin';
    pin.style.left = `${Math.max(0, Math.min(100, x))}%`;
    pin.style.top = `${Math.max(0, Math.min(100, y))}%`;
    pin.title = stn.name || stn.station_id || 'Station';
    pin.addEventListener('click', () => showStationDetails(stn));
    blueprintPinsHost.appendChild(pin);
  });
  if (missingXY > 0) {
    setBlueprintWarning(`${missingXY} station(s) missing blueprint XY coordinates.`);
  } else {
    setBlueprintWarning('');
  }
}

function applyWorldScope(worldScope) {
  const center = Array.isArray(worldScope?.center) ? worldScope.center : [46, -98];
  const zoom = Number.isFinite(Number(worldScope?.zoom)) ? Number(worldScope.zoom) : 3;
  const bounds = Array.isArray(worldScope?.bounds) && worldScope.bounds.length === 2 ? worldScope.bounds : null;
  try {
    if (bounds) {
      map.fitBounds(bounds, { padding: [0, 0] });
      return;
    }
    map.setView(center, zoom);
  } catch (_) {}
}

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
    const scopedRows = (typeof window.stationMatchesHierarchyScope === 'function')
      ? (mapStationData || []).filter(stn => window.stationMatchesHierarchyScope(stn))
      : (mapStationData || []);

    const selectedCompany = getSelectedCompanyName();
    const mapProfile = await getSelectedCompanyMapProfile();
    const nextMapProfileKey = JSON.stringify({ company: selectedCompany, profile: mapProfile });
    const profileChanged = nextMapProfileKey !== activeMapProfileKey;
    if (profileChanged) {
      await switchMapMode(mapProfile);
      if (mapProfile.mode === 'world') {
        applyWorldScope(mapProfile.worldScope);
        DID_FIT_BOUNDS = true;
      }
      activeMapProfileKey = nextMapProfileKey;
    }

    if (mapProfile.mode === 'blueprint') {
      const allRows = Array.isArray(scopedRows) ? scopedRows : [];
      let filtered = allRows;
      if (typeof window.stationMatchesHierarchyScope !== 'function' && areFiltersActuallyRestricting()) {
        filtered = allRows.filter(stn => {
          const { combos, _norm, totalCombos } = getActiveLocationAssetCombos();
          if (totalCombos === 0) return true;
          if (combos.size === 0) return false;
          const stnAssetType = _norm(stn.asset_type);
          const stnCompany = _norm(stn.company);
          const stnLocCandidates = [
            _norm(stn.province),
            _norm(stn.location),
            _norm(stn.location_file)
          ].filter(Boolean);
          return stnLocCandidates.some(loc => combos.has(`${stnCompany}|${loc}|${stnAssetType}`));
        });
      }
      markersLayer.clearLayers();
      renderBlueprintPins(filtered, selectedCompany);
      await ensureBlueprintAnnotator(selectedCompany);
      return;
    }

    // Validate coordinates
    const allValid = (scopedRows || []).filter(stn => {
      const lat = Number(stn.lat), lon = Number(stn.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) &&
             Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    });

    // CRITICAL FIX: Default to showing ALL stations, only filter if explicitly restricting
    let filtered = allValid;
    
    // Only apply filters if they are actually restricting something
    if (typeof window.stationMatchesHierarchyScope !== 'function' && areFiltersActuallyRestricting()) {
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
    const hasExplicitScopeBounds = Array.isArray(mapProfile?.worldScope?.bounds) && mapProfile.worldScope.bounds.length === 2;
    if (!DID_FIT_BOUNDS && !hasExplicitScopeBounds && filtered.length && map && mapProfile.mode !== 'blueprint') {
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
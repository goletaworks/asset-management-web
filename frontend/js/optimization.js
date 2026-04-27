// frontend/js/optimization.js
document.addEventListener('DOMContentLoaded', () => {

  // ───────────────────────────────── Workflow mode state ─────────────────────────────────
  // 'trip-first' (default) = Opt1 → Opt2 → Opt3
  // 'repair-first' = Opt1 → Opt3 → Opt2, 'repair-first-dynamic' = Opt1 (with deadlines) → Opt3 (smart) → Opt2
  let workflowMode = 'trip-first';

  // ───────────────────────────────── helpers for autocomplete wiring ─────────────────────────────────
  const dashPlaceholder    = document.getElementById('dashboardContentContainer');
  const mapContainer       = document.getElementById('mapContainer');
  const rightPanel         = document.getElementById('rightPanel');
  const stationPlaceholder = document.getElementById('stationContentContainer');

  const navOpt = document.getElementById('navOpt');
  if (navOpt && !navOpt._wired) {
    navOpt.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.canAccessCompanyViews === 'function' && !window.canAccessCompanyViews('Optimization')) return;
      showOptimization();
    });
    navOpt._wired = true;
  }

  // in-modal edit state (soft/fixed)
  let _editingSoftRow = null;
  let _editingFixedRow = null;

  // Store available field names for autocomplete
  let availableFieldNames = [];
  let availableParameterNames = [];
  let availableAllNames = [];
  let availableSplitSources = [];

  function uniqCaseInsensitive(arr) {
    const seen = new Set();
    const out = [];
    for (const s of arr || []) {
      const key = String(s || '').toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
    return out;
  }

  function getOptimizationScope() {
    return (typeof window.getHierarchySelectionContext === 'function')
      ? window.getHierarchySelectionContext()
      : null;
  }

  function stationMatchesScope(station) {
    if (typeof window.stationMatchesHierarchyScope === 'function') {
      return window.stationMatchesHierarchyScope(station, getOptimizationScope());
    }
    return true;
  }

  function filterStationsByScope(stations) {
    return (stations || []).filter(st => stationMatchesScope(st));
  }

  function filterRepairsByScope(repairs, scopedStations) {
    const stationIds = new Set((scopedStations || [])
      .map(s => String(s.station_id || s['Station ID'] || '').trim())
      .filter(Boolean));
    if (!stationIds.size) return [];
    return (repairs || []).filter(r => stationIds.has(String(r.station_id || r['Station ID'] || '').trim()));
  }

  async function getScopedStationData() {
    const stations = await window.electronAPI.getStationData();
    return filterStationsByScope(stations);
  }

  async function getScopedRepairs(scopedStations = null) {
    const repairs = await window.electronAPI.getAllRepairs();
    if (window._testMode && window._testRepairs) return repairs;
    const stations = scopedStations || await getScopedStationData();
    return filterRepairsByScope(repairs, stations);
  }

  // Parse split strings like "50%F-50%P", "100%P(OTH)", "84%H-192%W(D"
  // Returns an array of source tokens, e.g., ["F","P"], ["P(OTH)"], ["H","W(D"]
  function parseSplitSources(str) {
    if (!str) return [];
    const segments = String(str).split(/\s*-\s*/);
    const out = [];
    for (const seg of segments) {
      // capture "<number>%<source...>"
      const m = String(seg).match(/(-?\d+(?:\.\d+)?)%\s*([A-Za-z0-9()[\]\/\-\s]+)$/);
      if (m && m[2]) {
        out.push(m[2].trim());
      }
    }
    return out;
  }

  // Collect split sources by scanning O&M / Capital / Decommission columns in repairs
  async function loadAvailableSplitSources() {
    try {
      const stations = await getScopedStationData();
      const repairs = await getScopedRepairs(stations);
      const set = new Set();
      const get = (obj, key) => {
        if (!obj) return undefined;
        // exact then loose match
        if (key in obj) return obj[key];
        const found = Object.keys(obj).find(k => String(k).trim().toLowerCase() === String(key).trim().toLowerCase());
        return found ? obj[found] : undefined;
      };
      (repairs || []).forEach(r => {
        ['O&M', 'Capital', 'Decommission'].forEach(col => {
          const v = get(r, col);
          parseSplitSources(v).forEach(s => set.add(s));
        });
      });
      availableSplitSources = uniqCaseInsensitive(Array.from(set)).sort();
    } catch (e) {
      console.error('Failed to load split sources:', e);
    }
  }

  async function loadAvailableFields() {
    try {
      // If TEST mode is active and has data, use TEST field names only
      if (window._testMode && window._testRepairs && window._testRepairs.length > 0) {
        const testFields = Object.keys(window._testRepairs[0]);
        availableFieldNames = uniqCaseInsensitive(testFields).sort((a,b)=>a.localeCompare(b));
        availableParameterNames = [];
        availableAllNames = availableFieldNames.slice();
        console.log('[loadAvailableFields] Using TEST mode fields:', availableFieldNames.length);
        return;
      }

      // Call without parameters to scan ALL workbooks
      let catalog = null;
      if (window.electronAPI.getWorkbookFieldCatalog) {
        catalog = await window.electronAPI.getWorkbookFieldCatalog();
      }

if (catalog && (Array.isArray(catalog.repairs) || catalog.sheets)) {
        // Consolidate fields into two main buckets: "Repairs" and "Station Data"
        const fieldMap = new Map(); // Key: Lowercase -> { original: String, sources: Set }

        const addField = (field, sourceCategory) => {
          const key = field.trim().toLowerCase();
          if (!fieldMap.has(key)) {
            fieldMap.set(key, { original: field.trim(), sources: new Set() });
          }
          fieldMap.get(key).sources.add(sourceCategory);
        };

        // 1. Process Repairs
        (catalog.repairs || []).forEach(field => addField(field, 'Repairs'));

        // 2. Process all Asset Sheets (consolidate into 'Station Data')
        Object.values(catalog.sheets || {}).forEach(fields => {
          (fields || []).forEach(field => addField(field, 'Station Data'));
        });

        const qualifiedFields = [];

        for (const { original, sources } of fieldMap.values()) {
          if (sources.has('Repairs') && sources.has('Station Data')) {
            // Collision: Exists in both contexts -> Explicitly qualify both
            qualifiedFields.push(`${original} (Repairs)`);
            qualifiedFields.push(`${original} (Station Data)`);
          } else if (sources.has('Repairs')) {
            // Only in Repairs -> No qualifier needed
            qualifiedFields.push(original);
          } else if (sources.has('Station Data')) {
            // Only in Station Data -> No qualifier needed
            qualifiedFields.push(original);
          }
        }

        availableFieldNames = qualifiedFields.sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));        availableParameterNames = [];
        availableAllNames = availableFieldNames.slice();

        console.log('[loadAvailableFields] Loaded', availableFieldNames.length, 'fields');

      } else {
        console.warn('[loadAvailableFields] No catalog, using fallback');
        // Fallback...
        const stations = await getScopedStationData();
        const repairs  = await getScopedRepairs(stations);
        const fieldSet = new Set();
        (stations || []).forEach(st => Object.keys(st).forEach(k => fieldSet.add(k + ' (Station)')));
        (repairs  || []).forEach(rp => Object.keys(rp).forEach(k => fieldSet.add(k + ' (Repairs)')));
        availableFieldNames = uniqCaseInsensitive(Array.from(fieldSet)).sort();
      }

    } catch (e) {
      console.error('Failed to load available fields:', e);
    }
  }

  // Remove any open suggestion lists
  function _clearAutocompleteLists() {
    document.querySelectorAll('.autocomplete-items').forEach(n => n.remove());
  }

  // Replace an input with a clean clone (preserving value/id/attrs), returning the clone
  function _cloneInput(input) {
    if (!input) return input;
    const val = input.value;
    const clone = input.cloneNode(true);
    input.parentNode.replaceChild(clone, input);
    clone.value = val;
    return clone;
  }

  // Apply autocomplete to an input, first clearing old listeners by cloning
  function applyAutocomplete(input, suggestions) {
    if (!input) return input;
    _clearAutocompleteLists();
    const clone = _cloneInput(input);
    setupAutocomplete(clone, suggestions);
    return clone;
  }

  // Apply autocomplete to all current split-source inputs
  function _rewireAllSplitInputs() {
    const splitInputs = document.querySelectorAll('#splitFields .split-source-input');
    splitInputs.forEach(inp => applyAutocomplete(inp, availableSplitSources));
  }

  // Build a split-source row (for multi-split UI)
  function _makeSplitSourceRow(value = '') {
    const row = document.createElement('div');
    row.className = 'split-source-row';
    row.style = 'display:flex; gap:.5em; align-items:center; margin:.25em 0;';
    row.innerHTML = `
      <input type="text" class="split-source-input" style="flex:1; padding:.4em;" placeholder="Enter source token (e.g., F, P(OTH))">
      <button class="deleteSplitSourceBtn" title="Remove" style="color:red;">×</button>
    `;
    row.querySelector('.split-source-input').value = value;
    row.querySelector('.deleteSplitSourceBtn').addEventListener('click', () => row.remove());
    return row;
  }

  // Explicitly remove autocomplete (clone without re-wiring)
  function unwireAutocomplete(input) {
    if (!input) return input;
    _clearAutocompleteLists();
    return _cloneInput(input);
  }

  // Install ONE global "click-away" handler for all autocompletes.
  // This prevents multiple per-input document listeners from racing each other
  // and closing the list before an item click can set the input value.
  (function installGlobalAutocompleteCloserOnce () {
    if (window.__acCloserInstalled) return;
    window.__acCloserInstalled = true;
    document.addEventListener(
      'mousedown',
      (e) => {
        // If click is inside ANY autocomplete wrapper or list, keep it open.
        if (e.target.closest('.autocomplete-wrapper') || e.target.closest('.autocomplete-items')) return;
        _clearAutocompleteLists();
      },
      true
    );
  })();

  // ───────────────────────────────── end helpers ─────────────────────────────────

  // Autocomplete functionality
  function setupAutocomplete(input, suggestions) {
    let currentFocus = -1;
    let listDiv = null;

    function buildList(filterVal) {
      closeAllLists();

      listDiv = document.createElement('div');
      listDiv.setAttribute('class', 'autocomplete-items');
      listDiv.style.position = 'absolute';
      listDiv.style.top = '100%';
      listDiv.style.left = '0';
      listDiv.style.right = '0';
      listDiv.style.maxHeight = '200px';
      listDiv.style.overflowY = 'auto';
      listDiv.style.background = 'white';
      listDiv.style.border = '1px solid #d4d4d4';
      listDiv.style.borderTop = 'none';
      listDiv.style.zIndex = '99';

      input.parentNode.classList.add('autocomplete-wrapper');
      input.parentNode.style.position = 'relative';
      input.parentNode.appendChild(listDiv);

      const val = (filterVal || '').toLowerCase();
      
      // No MAX cap — show all (container is scrollable)

      for (let suggestion of suggestions) {
        const s = String(suggestion ?? '');
        const sLower = s.toLowerCase();
        if (!val || sLower.includes(val)) {
          const itemDiv = document.createElement('div');
          itemDiv.style.padding = '10px';
          itemDiv.style.cursor = 'pointer';
          itemDiv.style.backgroundColor = '#fafafa';

          if (val) {
            const idx = sLower.indexOf(val);
            const before = s.slice(0, idx);
            const match = s.slice(idx, idx + val.length);
            const after = s.slice(idx + val.length);
            itemDiv.innerHTML = `${before}<strong>${match}</strong>${after}`;
          } else {
            itemDiv.textContent = s;
          }

          // Prevent the input from blurring before we handle the click
          itemDiv.addEventListener('mousedown', function (e) {
            e.preventDefault();
          });
          itemDiv.addEventListener('click', function () {
            input.value = s;
            input.focus();
            closeAllLists();
            // Ensure any listeners react to this programmatic change
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });

          itemDiv.addEventListener('mouseenter', function () {
            removeActive(listDiv.getElementsByTagName('div'));
            this.classList.add('autocomplete-active');
          });

          listDiv.appendChild(itemDiv);
        }
      }

      currentFocus = -1;
    }

    function addActive(items) {
      if (!items) return;
      removeActive(items);
      if (currentFocus >= items.length) currentFocus = 0;
      if (currentFocus < 0) currentFocus = items.length - 1;
      items[currentFocus].classList.add('autocomplete-active');
    }

    function removeActive(items) {
      for (let item of items) item.classList.remove('autocomplete-active');
    }

    function closeAllLists() {
      const items = document.getElementsByClassName('autocomplete-items');
      for (let item of items) {
        if (item && item.parentNode) item.parentNode.removeChild(item);
      }
      currentFocus = -1;
    }

    // OPEN on focus/click (even if empty)
    input.addEventListener('focus', () => buildList(input.value));
    input.addEventListener('click', () => {
      const open = input.parentNode.querySelector('.autocomplete-items');
      if (!open) buildList(input.value);
    });

    // Do NOT instantly close when the input momentarily loses focus to the list
    input.addEventListener('blur', (e) => {
      // If the newly focused element is inside our wrapper, keep the list
      const wrapper = input.parentNode;
      const next = e.relatedTarget;
      if (!next || !wrapper.contains(next)) {
        // Delay a tick so item click can run first if needed
        setTimeout(() => {
          // If focus didn't move back into wrapper, close
          if (!document.activeElement || !wrapper.contains(document.activeElement)) {
            closeAllLists();
          }
        }, 0);
      }
    });

    // FILTER while typing
    input.addEventListener('input', function () {
      buildList(this.value);
    });

    // Keyboard controls
    input.addEventListener('keydown', function (e) {
      let items = this.parentNode.querySelector('.autocomplete-items');
      if (items) items = items.getElementsByTagName('div');

      if (e.keyCode === 40) { // Down
        currentFocus++;
        addActive(items);
      } else if (e.keyCode === 38) { // Up
        currentFocus--;
        addActive(items);
      } else if (e.keyCode === 13) { // Enter
        e.preventDefault();
        if (currentFocus > -1 && items && items[currentFocus]) {
          items[currentFocus].click();
        }
      } else if (e.keyCode === 27) { // Esc
        closeAllLists();
      }
    });

  }

  function resetOptimizationViews() {
    if (!dashPlaceholder || !dashPlaceholder.innerHTML.trim()) return;
    const opt1Results = document.getElementById('opt1Results');
    const opt2Results = document.getElementById('opt2Results');
    const opt3Results = document.getElementById('opt3Results');
    if (opt1Results) opt1Results.innerHTML = '';
    if (opt2Results) opt2Results.innerHTML = '';
    if (opt3Results) opt3Results.innerHTML = '';
    window._scoredRepairs = null;
    window._tripsData = null;
  }

  async function showOptimization() {
    if (mapContainer)       mapContainer.style.display = 'none';
    if (rightPanel)         rightPanel.style.display   = 'none';
    if (stationPlaceholder) stationPlaceholder.style.display = 'none';
    if (document && document.body) document.body.dataset.suppressRhs = '1';
    const filtersPanel = document.querySelector('.left-panel');
    if (filtersPanel) filtersPanel.style.display = '';
    const rightToggleBtn = document.getElementById('toggleRight');
    if (rightToggleBtn) rightToggleBtn.style.display = 'none';

    // Ensure dashboard styles scope applies
    if (dashPlaceholder) dashPlaceholder.classList.add('asmgt-dashboard');
    if (!dashPlaceholder.innerHTML.trim()) {
      const html = await fetch('optimization.html').then(r => r.text());
      dashPlaceholder.innerHTML = html;
      
      // Load fields BEFORE UI init
      await loadAvailableFields();
      await loadAvailableSplitSources();
      
      await initDashboardUI();
    } else {
      // Refresh if already initialized
      await loadAvailableFields();
      await loadAvailableSplitSources();
    }
    dashPlaceholder.style.display = 'block';
    resetOptimizationViews();

  }

  // ══════════════════════════════════════════════════════════════════════════
  // Global TEST mode state
  window._testMode = false;
  window._testRepairs = null;
  window._testFieldNames = [];

  async function initDashboardUI() {
    const tabs     = document.querySelectorAll('.dashboard-tab');
    const contents = document.querySelectorAll('.dashboard-content');

    // ───────────────────────────────── Helper functions for rendering ─────────────────────────────────
    // These mirror backend logic but are needed for frontend rendering
    
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

function _mergeSplitMaps(...maps) {
      const out = Object.create(null);
      for (const m of maps || []) {
        if (!m) continue;
        for (const [k, v] of Object.entries(m)) out[k] = v;
      }
      return out;
    }

    function getSplitMapFromRepair(repair) {
      const station = window._stationDataMap?.[repair.station_id] || {};
      const get = (obj, key) => {
        if (!obj) return undefined;
        if (key in obj) return obj[key];
        const found = Object.keys(obj).find(k => _canon(k) === _canon(key));
        return found ? obj[found] : undefined;
      };
      
      const om  = get(repair, 'O&M') ?? get(station, 'O&M');
      const cap = get(repair, 'Capital') ?? get(station, 'Capital');
      const dec = get(repair, 'Decommission') ?? get(station, 'Decommission');
      
      const mapOm  = _parseSplitSpec(om)  || {};
      const mapCap = _parseSplitSpec(cap) || {};
      const mapDec = _parseSplitSpec(dec) || {};
      
      return _mergeSplitMaps(mapOm, mapCap, mapDec);
    }
    // ───────────────────────────────── End helper functions ─────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // WORKFLOW MODE TOGGLE
    // ═══════════════════════════════════════════════════════════════════════
    const workflowModeSelect = document.getElementById('workflowModeSelect');
    const workflowModeInfoBtn = document.getElementById('workflowModeInfoBtn');
    const workflowModeInfoModal = document.getElementById('workflowModeInfoModal');
    const closeWorkflowModeInfoModal = document.getElementById('closeWorkflowModeInfoModal');
    const okWorkflowModeInfoBtn = document.getElementById('okWorkflowModeInfoBtn');

    const opt2Tab = Array.from(tabs).find(t => t.dataset.target === 'optimization2');
    const opt3Tab = Array.from(tabs).find(t => t.dataset.target === 'optimization3');
    const opt2Description = document.getElementById('opt2Description');
    const opt3Description = document.getElementById('opt3Description');

    function updateWorkflowMode(mode) {
      workflowMode = mode;
      
      // Update tab order and descriptions by swapping DOM positions
      const tabsContainer = document.querySelector('.dashboard-tabs');
      if (mode === 'repair-first') {
        // Move Opt3 before Opt2
        if (opt3Tab && opt2Tab && opt3Tab.nextSibling === opt2Tab) {
          // Already in correct order
        } else if (opt3Tab && opt2Tab) {
          tabsContainer.insertBefore(opt3Tab, opt2Tab);
        }
        
        // Update descriptions
        if (opt2Description) {
          opt2Description.innerHTML = `
            Group repairs into trips <strong>within each assigned year</strong> by <strong>City of Travel</strong> and <strong>Access Type</strong>.
            <br/>
            <strong>⚠️ Note:</strong> You must run Optimizations 1 and 3 first.
          `;
        }
        if (opt3Description) {
          opt3Description.innerHTML = `
            Assign individual repairs to years based on fixed parameter constraints, starting with the highest-scored repairs.
            <br/>
            <strong>⚠️ Note:</strong> You must run Optimization 1 first.
          `;
        }

      } else if (mode === 'repair-first-dynamic') {
        // Same tab order as repair-first
        if (opt3Tab && opt2Tab && opt3Tab.nextSibling === opt2Tab) {
          // Already in correct order
        } else if (opt3Tab && opt2Tab) {
          tabsContainer.insertBefore(opt3Tab, opt2Tab);
        }
        
        // Dynamic mode descriptions
        if (opt2Description) {
          opt2Description.innerHTML = `
            Group repairs into trips <strong>within each assigned year</strong> by <strong>City of Travel</strong> and <strong>Access Type</strong>.
            <br/>
            <strong>⚠️ Note:</strong> You must run Optimizations 1 and 3 first.
          `;
        }
        if (opt3Description) {
          opt3Description.innerHTML = `
            Intelligently assign repairs to years based on deadlines, location consolidation, and priority scores.
            Set deadlines in Optimization 1 table before running.
            <br/>
            <strong>⚠️ Note:</strong> You must run Optimization 1 first.
          `;
        }

      } else {
        // Trip-First: Move Opt2 before Opt3
        if (opt2Tab && opt3Tab && opt2Tab.nextSibling === opt3Tab) {
          // Already in correct order
        } else if (opt2Tab && opt3Tab) {
          tabsContainer.insertBefore(opt2Tab, opt3Tab);
        }
        
        // Restore original descriptions
        if (opt2Description) {
          opt2Description.innerHTML = `
            Group scored repairs by <strong>City of Travel</strong> and <strong>Access Type</strong>.
            <br/>
            <strong>⚠️ Note:</strong> You must run <em>Optimization 1</em> first
          `;
        }
        if (opt3Description) {
          opt3Description.innerHTML = `
            Assign trips to years based on fixed parameter constraints.
            <br/>
            <strong>⚠️ Note:</strong> You must run Optimizations 1 and 2 first.
          `;
        }
      }

      // Clear results when switching modes
      resetOptimizationViews();

      // --- [BUG FIX #2] ---
      // Update Opt-3 controls immediately when workflow changes
      const opt3Controls = document.querySelector('.opt3-controls');
      const topPercentLabel = document.querySelector('.opt3-label');
      const topPercentInfoBtn = document.getElementById('opt3TopInfoBtn');

      if (mode === 'repair-first-dynamic') {
        if (topPercentLabel) topPercentLabel.textContent = 'Look-Ahead Window (%):';
        if (topPercentInfoBtn) topPercentInfoBtn.style.display = '';
        if (opt3Controls) opt3Controls.style.display = 'flex';

      } else if (mode === 'repair-first') {
        // Hide all controls for repair-first
        if (opt3Controls) opt3Controls.style.display = 'none';

      } else {
        // Trip-first
        if (topPercentLabel) topPercentLabel.textContent = 'Top-X% warning threshold:';
        if (topPercentInfoBtn) topPercentInfoBtn.style.display = '';
        if (opt3Controls) opt3Controls.style.display = 'flex';
      }
      // --- [END BUG FIX #2] ---
    }

    if (workflowModeSelect) {
      workflowModeSelect.addEventListener('change', () => {
        updateWorkflowMode(workflowModeSelect.value);
      });
    }

    // Info modal handlers
    if (workflowModeInfoBtn && workflowModeInfoModal) {
      const openInfo = () => (workflowModeInfoModal.style.display = 'flex');
      const closeInfo = () => (workflowModeInfoModal.style.display = 'none');
      workflowModeInfoBtn.addEventListener('click', openInfo);
      if (closeWorkflowModeInfoModal) closeWorkflowModeInfoModal.addEventListener('click', closeInfo);
      if (okWorkflowModeInfoBtn) okWorkflowModeInfoBtn.addEventListener('click', closeInfo);
      workflowModeInfoModal.addEventListener('click', (e) => { if (e.target === workflowModeInfoModal) closeInfo(); });
    }

    // Initialize in trip-first mode
    updateWorkflowMode('trip-first');

    // Check if TEST tab should be visible
    try {
      const testTabEnabled = await window.electronAPI.getTestTabEnabled();
      const testTab = document.getElementById('testTab');
      if (testTab && testTabEnabled) {
        testTab.style.display = '';
      }
    } catch (e) {
      console.error('Failed to check TEST tab visibility:', e);
    }

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', async () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST MODE - Upload and override repair data
    // ═══════════════════════════════════════════════════════════════════════
    const testModeToggle = document.getElementById('testModeToggle');
    const testModeStatus = document.getElementById('testModeStatus');
    const uploadTestDataBtn = document.getElementById('uploadTestDataBtn');
    const clearTestDataBtn = document.getElementById('clearTestDataBtn');
    const testFileInput = document.getElementById('testFileInput');
    const testDataPreview = document.getElementById('testDataPreview');
    const testRowCount = document.getElementById('testRowCount');
    const testColumnList = document.getElementById('testColumnList');
    const testDataTableHead = document.getElementById('testDataTableHead');
    const testDataTableBody = document.getElementById('testDataTableBody');

    function updateTestModeStatus() {
      if (window._testMode && window._testRepairs) {
        testModeStatus.textContent = `Active (${window._testRepairs.length} repairs loaded)`;
        testModeStatus.style.color = '#5cb85c';
      } else if (window._testMode) {
        testModeStatus.textContent = 'Active (no data uploaded)';
        testModeStatus.style.color = '#f0ad4e';
      } else {
        testModeStatus.textContent = 'Inactive';
        testModeStatus.style.color = '#999';
      }
    }

    function parseCodingToSplit(coding, fundingType) {
      // Parse Coding format: F, P, P(OTH), F-P, F-P-P(OTH)
      // Generate equal split strings based on Funding Type
      if (!coding) return {};

      const tokens = String(coding).split('-').map(t => t.trim()).filter(Boolean);
      if (tokens.length === 0) return {};

      // Calculate equal split percentages
      const equalSplit = 100 / tokens.length;
      const splitStrings = tokens.map((token, idx) => {
        // Adjust last token to account for rounding (100% total)
        const pct = idx === tokens.length - 1
          ? (100 - equalSplit * (tokens.length - 1)).toFixed(1)
          : equalSplit.toFixed(1);
        return `${pct}%${token}`;
      }).join('-');

      // Normalize funding type for comparison
      const fundingTypeNorm = String(fundingType || '').trim().toLowerCase();

      // Return split string only for the appropriate column based on Funding Type
      const result = {
        'O&M': '',
        'Capital': '',
        'Decommission': ''
      };

      if (fundingTypeNorm === 'capital') {
        result['Capital'] = splitStrings;
      } else if (fundingTypeNorm === 'o&m' || fundingTypeNorm === 'o & m' || fundingTypeNorm === 'om') {
        result['O&M'] = splitStrings;
      } else if (fundingTypeNorm === 'decommission' || fundingTypeNorm === 'decom') {
        result['Decommission'] = splitStrings;
      } else {
        // If funding type is not recognized, default to Capital
        result['Capital'] = splitStrings;
      }

      return result;
    }

    function renderTestDataPreview(repairs) {
      if (!repairs || repairs.length === 0) {
        testDataPreview.style.display = 'none';
        return;
      }

      const columns = Object.keys(repairs[0]);
      testRowCount.textContent = repairs.length;
      testColumnList.textContent = columns.join(', ');

      // Build table header
      testDataTableHead.innerHTML = '<tr>' + columns.map(col =>
        `<th style="padding:0.5em; background:#f5f5f5; border:1px solid #ddd; text-align:left;">${col}</th>`
      ).join('') + '</tr>';

      // Build table body (limit to first 1000 rows for performance)
      const rowsToShow = repairs.slice(0, 1000);
      testDataTableBody.innerHTML = rowsToShow.map(repair =>
        '<tr>' + columns.map(col =>
          `<td style="padding:0.5em; border:1px solid #ddd;">${repair[col] || ''}</td>`
        ).join('') + '</tr>'
      ).join('');

      testDataPreview.style.display = 'block';
    }

    if (testModeToggle) {
      testModeToggle.addEventListener('change', () => {
        window._testMode = testModeToggle.checked;
        uploadTestDataBtn.disabled = !window._testMode;
        clearTestDataBtn.disabled = !window._testMode || !window._testRepairs;
        updateTestModeStatus();
      });
    }

    if (uploadTestDataBtn) {
      uploadTestDataBtn.addEventListener('click', () => {
        testFileInput.click();
      });
    }

    if (testFileInput) {
      testFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const reader = new FileReader();
          reader.onload = async (evt) => {
            try {
              const b64 = evt.target.result.split(',')[1];

              // List sheets - returns { success, sheets }
              const sheetResult = await window.electronAPI.excelListSheets(b64);
              console.log('[TEST Mode] Sheet result:', sheetResult);

              if (!sheetResult || !sheetResult.success || !sheetResult.sheets) {
                alert('Failed to list sheets in Excel file');
                return;
              }

              const sheets = sheetResult.sheets;

              if (!Array.isArray(sheets) || sheets.length === 0) {
                alert('No sheets found in Excel file');
                return;
              }

              // Use first sheet
              const sheetName = sheets[0];
              console.log('[TEST Mode] Using sheet:', sheetName);

              if (!sheetName) {
                alert('Sheet name is undefined. Please check your Excel file format.');
                return;
              }

              const result = await window.electronAPI.excelParseRowsFromSheet(b64, sheetName);

              console.log('[TEST Mode] Parse result:', result);

              // parseRowsFromSheet returns { success, rows, sections, headers }
              if (!result || !result.success || !result.rows) {
                alert('Failed to parse Excel file: ' + (result?.message || 'Unknown error'));
                return;
              }

              const rows = result.rows;

              if (!Array.isArray(rows) || rows.length === 0) {
                alert('No data found in Excel file');
                return;
              }

              // Check if first row exists and is an object
              if (!rows[0] || typeof rows[0] !== 'object') {
                alert('Invalid data format in Excel file. First row should contain headers.');
                return;
              }

              // Validate required columns
              const requiredColumns = ['Repair Name', 'City of travel', 'Access Type', 'Coding', 'Funding Type', 'Priority', 'Cost'];
              const columns = Object.keys(rows[0]);

              console.log('[TEST Mode] Detected columns:', columns);
              console.log('[TEST Mode] Required columns:', requiredColumns);

              const missingColumns = requiredColumns.filter(col => !columns.includes(col));

              if (missingColumns.length > 0) {
                alert(`Missing required columns: ${missingColumns.join(', ')}`);
                return;
              }

              // Process repairs: add split columns based on Coding and Funding Type
              const processedRepairs = rows.map(repair => {
                const splits = parseCodingToSplit(repair['Coding'], repair['Funding Type']);
                return {
                  ...repair,
                  ...splits
                };
              });

              // Store TEST repairs and field names
              window._testRepairs = processedRepairs;
              window._testFieldNames = columns;

              // Render preview
              renderTestDataPreview(processedRepairs);

              // Update status
              clearTestDataBtn.disabled = false;
              updateTestModeStatus();

              console.log('[TEST Mode] Loaded', processedRepairs.length, 'repairs');
            } catch (err) {
              console.error('Error parsing Excel file:', err);
              alert('Error parsing Excel file: ' + err.message);
            }
          };
          reader.readAsDataURL(file);
        } catch (err) {
          console.error('Error reading file:', err);
          alert('Error reading file: ' + err.message);
        }

        // Reset file input
        testFileInput.value = '';
      });
    }

    if (clearTestDataBtn) {
      clearTestDataBtn.addEventListener('click', () => {
        window._testRepairs = null;
        window._testFieldNames = [];
        testDataPreview.style.display = 'none';
        clearTestDataBtn.disabled = true;
        updateTestModeStatus();
      });
    }

    // Initialize status
    updateTestModeStatus();

    // ═══════════════════════════════════════════════════════════════════════
    // SOFT PARAMETERS (Optimization 1 - Scoring)
    // ═══════════════════════════════════════════════════════════════════════
    const paramContainer     = document.querySelector('#paramContainer');
    const addBtn             = document.querySelector('#addParamBtn');
    const saveParamsBtn      = document.querySelector('#saveParamsBtn');
    const addParamModal      = document.querySelector('#addParamModal');
    const closeModalBtn      = document.querySelector('#closeAddParamModal');
    const cancelParamBtn     = document.querySelector('#cancelParamBtn');
    const saveParamBtn       = document.querySelector('#saveParamBtn');
    const paramNameInput     = document.querySelector('#paramNameInput');
    const paramConditionSel  = document.querySelector('#paramConditionSelect');
    const paramMaxWeightInp  = document.querySelector('#paramMaxWeight');
    const addOptionBtn       = document.querySelector('#addOptionBtn');
    const optionsList        = document.querySelector('#optionsList');

    function recalcPercentageTotal() {
      const all = document.querySelectorAll('.param-percentage');
      let sum = 0; 
      all.forEach(inp => sum += parseInt(inp.value,10) || 0);
      const el = document.getElementById('percentageTotal');
      if (!el) return;
      el.textContent = sum;
      el.style.color = sum === 100 ? '' : 'red';
    }

    function makeDisplayRow({ parameter, condition, max_weight, options }) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.dataset.maxWeight = max_weight;
      row.innerHTML = `
        <input type="text" class="param-name" value="${parameter}" disabled />
        <select class="param-options"></select>
        <span class="param-weight-display"></span>
        <button class="editParamBtn" title="Edit parameter" style="margin-left:.5em;">✎</button>
        <input type="number" class="param-percentage" min="0" max="100" value="0"
               style="width:60px; margin-left:0.5em;" title="Enter % (total should sum to 100)" />%
        <button class="deleteParamBtn">×</button>
      `;
      const optSel = row.querySelector('.param-options');
      const weightDisplay = row.querySelector('.param-weight-display');
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.weight; 
        opt.textContent = o.label;
        if (o.selected) { 
          opt.selected = true; 
          weightDisplay.textContent = o.weight; 
        }
        optSel.appendChild(opt);
      });
      if (!options.some(o=>o.selected) && options.length) {
        optSel.selectedIndex = 0; 
        weightDisplay.textContent = options[0].weight;
      }
      optSel.addEventListener('change', () => { 
        weightDisplay.textContent = optSel.value; 
      });
      row.querySelector('.param-percentage').addEventListener('input', recalcPercentageTotal);
      row.querySelector('.deleteParamBtn').addEventListener('click', () => row.remove());
      row.querySelector('.editParamBtn').addEventListener('click', () => {
        // open the Add Param modal pre-filled from this row
        _editingSoftRow = row;
        const name = row.querySelector('.param-name')?.value?.trim() || '';
        const maxW = parseInt(row.dataset.maxWeight, 10) || 1;
        const opts = Array.from(row.querySelectorAll('.param-options option')).map(o => ({
          label: o.textContent, weight: parseInt(o.value, 10) || 0
        }));
        // populate modal
        addParamModal.style.display='flex';
        paramNameInput.value = name;
        paramMaxWeightInp.value = String(maxW);
        optionsList.innerHTML = '';
        opts.forEach(o => {
          const r = makeOptionRow(o.label, o.weight);
          optionsList.appendChild(r);
        });
        // suggestions for name (sheet-qualified)
        setupAutocomplete(paramNameInput, availableFieldNames);
      });
      return row;
    }

    async function _replaceSoftParamInStorage(oldKeyParam, oldKeyCond, newRows) {
      const all = await window.electronAPI.getAlgorithmParameters();
      const filtered = (all || []).filter(p => !(String(p.parameter) === String(oldKeyParam)));
      const merged = [...filtered, ...newRows];
      await window.electronAPI.saveAlgorithmParameters(merged, { replace: true });
    }

    function makeOptionRow(label = '', weight = 0) {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.style = 'display:flex; align-items:center; margin-top:0.5em;';
      row.innerHTML = `
        <input type="text" class="option-name" placeholder="Option label"
               style="flex:1; margin-right:0.5em;" />
        <select class="option-weight" style="width:5em; margin-right:0.5em;"></select>
        <button class="deleteOptionBtn" style="color:red;">×</button>
      `;
      const weightSelect = row.querySelector('.option-weight');
      function populateWeights(max = Math.max(1, parseInt(paramMaxWeightInp.value) ||0)) {
        const prev = parseInt(weightSelect.value,10) || weight;
        weightSelect.innerHTML = '';
        for (let i=0; i<=max; i++) {
          const opt = document.createElement('option');
          opt.value = opt.textContent = i; 
          weightSelect.appendChild(opt);
        }
        weightSelect.value = Math.min(prev, max);
      }
      paramMaxWeightInp.addEventListener('change', () => populateWeights());
      populateWeights();
      row.querySelector('.option-name').value = label;
      row.querySelector('.deleteOptionBtn').addEventListener('click', () => row.remove());
      return row;
    }

    // Load existing soft parameters
    const existing = await window.electronAPI.getAlgorithmParameters();
    paramContainer.innerHTML = '';
    const grouped = {};
    (existing || []).forEach(e => {
      const key = e.parameter;
      if (!grouped[key]) {
        grouped[key] = {
          parameter: e.parameter,
          condition: 'IF',
          max_weight: e.max_weight, 
          options: []
        };
      }
      grouped[key].options.push({ 
        label: e.option, 
        weight: e.weight, 
        selected: !!e.selected 
      });
    });
    Object.values(grouped).forEach(grp => paramContainer.appendChild(makeDisplayRow(grp)));

    addOptionBtn.addEventListener('click', () => optionsList.appendChild(makeOptionRow()));
    
    function closeAddParamModal(){ addParamModal.style.display='none'; }
    
    addBtn.addEventListener('click', () => {
      paramNameInput.value=''; 
      paramMaxWeightInp.value='3';
      optionsList.innerHTML=''; 
      optionsList.appendChild(makeOptionRow());
      addParamModal.style.display='flex';
      
      // Setup autocomplete for parameter name (sheet-qualified)
      setupAutocomplete(paramNameInput, availableFieldNames);
    });
    
    // Disable closing via the "X" button; enforce Save/Cancel only
    // closeModalBtn.addEventListener('click', closeAddParamModal);
    cancelParamBtn.addEventListener('click', closeAddParamModal);
    // Prevent closing by clicking outside the modal
    // addParamModal.addEventListener('click', e => { 
    //   if (e.target === addParamModal) closeAddParamModal(); 
    // });

    // Save new parameter
    saveParamBtn.addEventListener('click', async () => {
      const parameter = paramNameInput.value.trim();
      const maxWeight = parseInt(paramMaxWeightInp.value, 10) || 1;
      const options = Array.from(optionsList.querySelectorAll('.option-row')).map(r => ({
        label:  r.querySelector('.option-name').value.trim(),
        weight: parseInt(r.querySelector('.option-weight').value, 10)
      }));

      const rows = [];
      options.forEach(o => {
        rows.push({
          parameter, 
          data_source: 'all', // Set to 'all' since we search everything now
          condition: 'IF',
          max_weight: maxWeight, 
          option: o.label, 
          weight: o.weight
        });
      });
      
      // detect edit mode
      if (_editingSoftRow) {
        const oldParam = _editingSoftRow.querySelector('.param-name')?.value?.trim() || parameter;
        await _replaceSoftParamInStorage(oldParam, 'IF', rows);
        // preserve % value
        const oldPct = _editingSoftRow.querySelector('.param-percentage')?.value || '0';
        const newRow = makeDisplayRow({
          parameter,
          condition: 'IF',
          max_weight: maxWeight,
          options
        });
        // carry over percentage
        newRow.querySelector('.param-percentage').value = oldPct;
        _editingSoftRow.replaceWith(newRow);
        _editingSoftRow = null;
        recalcPercentageTotal();
      } else {
        await window.electronAPI.saveAlgorithmParameters(rows, { append: true });
        paramContainer.appendChild(makeDisplayRow({
          parameter, condition: 'IF', max_weight: maxWeight, options
        }));
      }
      closeAddParamModal();
    });

    // Save edited parameter selections
    saveParamsBtn.addEventListener('click', async () => {
      const toSave = Array.from(paramContainer.querySelectorAll('.param-row')).flatMap(r => {
        const maxW    = parseInt(r.dataset.maxWeight, 10);
        const param   = r.querySelector('.param-name').value.trim();
        return Array.from(r.querySelectorAll('.param-options option')).map(opt => ({
          parameter: param,
          data_source: 'all', // Always 'all' now
          condition: 'IF',
          max_weight: maxW, 
          option: opt.textContent, 
          weight: parseInt(opt.value,10), 
          selected: opt.selected
        }));
      });
      await window.electronAPI.saveAlgorithmParameters(toSave, { replace: true });
      appAlert('Soft parameters saved successfully');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // FIXED PARAMETERS (Optimization 3 - Yearly Constraints)
    // ═══════════════════════════════════════════════════════════════════════
    const fixedParamContainer = document.getElementById('fixedParamContainer');
    const addFixedParamBtn = document.getElementById('addFixedParamBtn');
    const saveFixedParamsBtn = document.getElementById('saveFixedParamsBtn');
    const addFixedParamModal = document.getElementById('addFixedParamModal');
    const cancelFixedParamBtn = document.getElementById('cancelFixedParamBtn');
    const saveFixedParamBtn = document.getElementById('saveFixedParamBtn');
    
    // Step containers
    const step1Container = document.getElementById('step1Container');
    const step2Container = document.getElementById('step2Container');
    const step3Container = document.getElementById('step3Container');
    
    // Navigation buttons
    const step1NextBtn = document.getElementById('step1NextBtn');
    const step2BackBtn = document.getElementById('step2BackBtn');
    const step2NextBtn = document.getElementById('step2NextBtn');
    const step3BackBtn = document.getElementById('step3BackBtn');
    
    // Type selector
    const fixedParamTypeSelect = document.getElementById('fixedParamTypeSelect');
    
    // Input elements
    const fixedParamNameInput = document.getElementById('fixedParamNameInput');
    const fixedParamMatchUsing = document.getElementById('fixedParamMatchUsing');

    // Field groups
    const parameterNameContainer = document.getElementById('parameterNameContainer');
    const monetaryMatchUsing = document.getElementById('monetaryMatchUsing');
    const geographicalFields = document.getElementById('geographicalFields');
    const temporalFields = document.getElementById('temporalFields');
    const monetaryFields = document.getElementById('monetaryFields');
    const designFields = document.getElementById('designFields');
    
    // Step 3 elements
    const cumulativeContainer = document.getElementById('cumulativeContainer');
    const cumulativeCheckbox = document.getElementById('cumulativeCheckbox');
    const cumulativeLabel = document.getElementById('cumulativeLabel');
    const cumulativeExplanation = document.getElementById('cumulativeExplanation');
    const splitSection = document.getElementById('splitSection');
    const ifSection = document.getElementById('ifSection');
    const enableSplitCondition = document.getElementById('enableSplitCondition');
    const splitFields = document.getElementById('splitFields');
    const enableIfCondition = document.getElementById('enableIfCondition');
    const ifConditionFields = document.getElementById('ifConditionFields');
    
    // Other elements
    const geoValuesList = document.getElementById('geoValuesList');
    const addGeoValueBtn = document.getElementById('addGeoValueBtn');

    let currentStep = 1;
    let monetarySubStep = 1; // For monetary: 1=match_using, 2=fields

    function updateStepIndicators() {
      document.querySelectorAll('.step-dot').forEach((dot, idx) => {
        const step = idx + 1;
        dot.classList.remove('active', 'completed');
        if (step < currentStep) {
          dot.classList.add('completed');
        } else if (step === currentStep) {
          dot.classList.add('active');
        }
      });
    }
 
    function showStep(step) {
      currentStep = step;
      step1Container.style.display = step === 1 ? 'block' : 'none';
      step2Container.style.display = step === 2 ? 'block' : 'none';
      step3Container.style.display = step === 3 ? 'block' : 'none';
      updateStepIndicators();
    }
 
    function configureStep2ForType(type) {
      // Hide all constraint fields
      geographicalFields.style.display = 'none';
      temporalFields.style.display = 'none';
      monetaryFields.style.display = 'none';
      designFields.style.display = 'none';
      monetaryMatchUsing.style.display = 'none';
      parameterNameContainer.style.display = 'none';
 
      const step2Title = document.getElementById('step2Title');
 
      if (type === 'geographical') {
        step2Title.textContent = 'Step 2: Configure Geographical Constraint';
        parameterNameContainer.style.display = 'block';
        geographicalFields.style.display = 'block';
      } else if (type === 'temporal') {
        step2Title.textContent = 'Step 2: Configure Temporal Constraint';
        parameterNameContainer.style.display = 'block';
        temporalFields.style.display = 'block';
      } else if (type === 'monetary') {
        if (monetarySubStep === 1) {
          step2Title.textContent = 'Step 2a: Choose Matching Method';
          monetaryMatchUsing.style.display = 'block';
        } else {
          step2Title.textContent = 'Step 2b: Configure Monetary Constraint';
          parameterNameContainer.style.display = 'block';
          monetaryFields.style.display = 'block';
        }
      } else if (type === 'design') {
        step2Title.textContent = 'Step 2: Configure Design Constraint';
        parameterNameContainer.style.display = 'block';
        designFields.style.display = 'block';
      }
    }

    function configureStep3ForType(type) {
      // Show/hide cumulative for temporal and monetary
      if (type === 'temporal') {
        cumulativeContainer.style.display = 'block';
        cumulativeLabel.textContent = 'Cumulative (sum all repairs)';
        cumulativeExplanation.textContent = 'When checked, the system adds up the temporal values from all repairs in the year and compares the total against the limit. When unchecked, each repair is checked individually against the limit.';
      } else if (type === 'monetary') {
        cumulativeContainer.style.display = 'block';
        cumulativeLabel.textContent = 'Cumulative Budget';
        cumulativeExplanation.textContent = 'When checked, the system treats this as a total yearly budget and tracks spending across all repairs. When unchecked, each repair is checked individually against the limit.';
      } else {
        cumulativeContainer.style.display = 'none';
      }

      // Show split section only for monetary
      splitSection.style.display = (type === 'monetary') ? 'block' : 'none';

      // IF section always visible in step 3
      ifSection.style.display = 'block';
    }

    // Step navigation
    step1NextBtn.addEventListener('click', () => {
      const type = fixedParamTypeSelect.value;
      monetarySubStep = (type === 'monetary') ? 1 : 2;
      configureStep2ForType(type);
      showStep(2);
      setupFixedParamAutocomplete();
    });

    step2BackBtn.addEventListener('click', () => {
      const type = fixedParamTypeSelect.value;
      if (type === 'monetary' && monetarySubStep === 2) {
        monetarySubStep = 1;
        configureStep2ForType(type);
      } else {
        showStep(1);
      }
    });

    step2NextBtn.addEventListener('click', () => {
      const type = fixedParamTypeSelect.value;
      
      // Validation
      if (type === 'monetary' && monetarySubStep === 1) {
        monetarySubStep = 2;
        configureStep2ForType(type);
        setupFixedParamAutocomplete();
        return;
      }

      // Validate required fields
      if (type === 'geographical') {
        const name = (document.getElementById('fixedParamNameInput')?.value || '').trim();
        const values = Array.from(geoValuesList.querySelectorAll('.geo-value'))
          .map(input => input.value.trim())
          .filter(v => v);
        if (!name || !values.length) {
          appAlert('Please enter a parameter name and at least one allowed value');
          return;
        }
      } else if (type === 'temporal') {
        const name = (document.getElementById('fixedParamNameInput')?.value || '').trim();
        const value = document.getElementById('temporalValue').value;
        if (!name || !value) {
          appAlert('Please enter a parameter name and value');
          return;
        }
      } else if (type === 'monetary') {
        const name = (document.getElementById('fixedParamNameInput')?.value || '').trim();
        const fieldName = document.getElementById('monetaryFieldName').value.trim();
        const value = document.getElementById('monetaryValue').value;
        if (!name || !fieldName || !value) {
          appAlert('Please fill in all monetary constraint fields');
          return;
        }
      } else if (type === 'design') {
        const name = (document.getElementById('fixedParamNameInput')?.value || '').trim();
        const designValue = document.getElementById('designValue');
        const value = designValue ? designValue.value.trim() : '';
        if (!name || !value) {
          appAlert('Please enter a parameter name and value');
          return;
        }
      }

      configureStep3ForType(type);
      showStep(3);
      setupFixedParamAutocomplete();
    });

    step3BackBtn.addEventListener('click', () => {
      showStep(2);
    });

    // Toggle handlers for step 3
    enableSplitCondition.addEventListener('change', () => {
      splitFields.style.display = enableSplitCondition.checked ? 'block' : 'none';
      if (enableSplitCondition.checked && splitFields.children.length === 0) {
        setupSplitSourceList(['']);
      }
    });

    enableIfCondition.addEventListener('change', () => {
      ifConditionFields.style.display = enableIfCondition.checked ? 'block' : 'none';
    });

    // helper to (re)build split list UI with optional values
    function setupSplitSourceList(values = ['']) {
      if (!splitFields) return;
      // Clear existing dynamic rows (keep any static label if present)
      splitFields.querySelectorAll('.split-source-row, #addSplitSourceBtn').forEach(n => n.remove());
      (values.length ? values : ['']).forEach(v => splitFields.appendChild(_makeSplitSourceRow(v)));
      // Add "+ Source" button
      const addBtn = document.createElement('button');
      addBtn.id = 'addSplitSourceBtn';
      addBtn.textContent = '+ Source';
      addBtn.type = 'button';
      addBtn.style = 'margin-top:.25em;';
      addBtn.addEventListener('click', () => {
        splitFields.appendChild(_makeSplitSourceRow(''));
        _rewireAllSplitInputs();
      });
      splitFields.appendChild(addBtn);
      _rewireAllSplitInputs();
    }

    function makeGeoValueRow(value = '') {
      const row = document.createElement('div');
      row.className = 'geo-value-row';
      row.style = 'display:flex; align-items:center; gap:0.5em; margin-bottom:0.5em;';
      row.innerHTML = `
        <input type="text" class="geo-value" placeholder="Enter value" 
               style="flex:1; padding:0.5em;" value="${value}" />
        <button class="deleteGeoValueBtn" style="color:red;">×</button>
      `;

      row.querySelector('.deleteGeoValueBtn').addEventListener('click', () => row.remove());
      return row;
    }

    addGeoValueBtn.addEventListener('click', () => {
      geoValuesList.appendChild(makeGeoValueRow());
    });

    function makeFixedParamDisplayRow(param) {
      const row = document.createElement('div');
      row.className = 'fixed-param-row';
      row.style = 'border:1px solid #ddd; padding:1em; margin-bottom:1.5em; border-radius:4px; background:#f9f9f9;';
      
      // Store cumulative flag in dataset for extraction
      if (param.type === 'monetary' || param.type === 'temporal') {
        row.dataset.cumulative = param.cumulative ? 'true' : 'false';
      }

      // Persist structured metadata for robust edit/rebuild
      row.dataset.type = param.type || '';
      row.dataset.name = param.name || '';
      if (param.type === 'monetary') {
        row.dataset.matchUsing  = param.match_using || 'parameter_name';
        row.dataset.fieldName   = param.field_name || '';
        row.dataset.conditional = param.conditional || '<=';
        row.dataset.unit        = param.unit || '';
      } else if (param.type === 'temporal') {
        row.dataset.unit  = param.unit || 'hours';
        row.dataset.scope = param.scope || '';
      } else if (param.type === 'design') {
        row.dataset.operator = param.operator || '=';
      }

      // Store IF and SPLIT condition in dataset for extraction
      if (param.if_condition) {
        row.dataset.ifCondition = JSON.stringify(param.if_condition);
      }
      // support multi-split; normalize to array for dataset
      const splitArr = Array.isArray(param.split_conditions)
        ? param.split_conditions
        : (param.split_condition && param.split_condition.enabled ? [param.split_condition.source] : []);
      if (splitArr && splitArr.length) {
        row.dataset.splitConditions = JSON.stringify(splitArr);
        // keep legacy dataset for backward compatibility (first item)
        row.dataset.splitCondition = JSON.stringify({ enabled: true, source: splitArr[0] });
      }

      const years = param.years ? Object.keys(param.years).sort() : [];
      
      // Left side: Parameter info
      let infoHTML = `
        <div class="param-info" style="margin-bottom:1em;">
          <h4 style="margin:0 0 0.5em 0;">${param.name}</h4>
          <div><strong>Type:</strong> ${param.type}</div>
      `;
      
      if (param.type === 'geographical') {
        infoHTML += `<div><strong>Base Values:</strong> ${(param.values || []).join(', ')}</div>`;
      } else if (param.type === 'temporal') {
        infoHTML += `<div><strong>Scope:</strong> ${param.scope}</div>
                     <div><strong>Unit:</strong> ${param.unit}</div>
                     <div><strong>Mode:</strong> ${param.cumulative ? 'Cumulative (Total)' : 'Per Repair'}</div>`;
      } else if (param.type === 'design') {
        infoHTML += `<div><strong>Operator:</strong> ${param.operator || '='}</div>`;
      } else if (param.type === 'monetary') {
        const matchLabel = param.match_using === 'field_name' ? 'Field Name' : 'Fixed Parameter Name';
        infoHTML += `<div><strong>Match Using:</strong> ${matchLabel}</div>
                     <div><strong>Field:</strong> ${param.field_name}</div>
                     <div><strong>Conditional:</strong> ${param.conditional}</div>
                     <div><strong>Unit:</strong> ${param.unit || '$'}</div>
                     <div><strong>Mode:</strong> ${param.cumulative ? 'Cumulative Budget' : 'Per Repair'}</div>`;
        const splits = splitArr || [];
        infoHTML += (splits.length
          ? `<div><strong>Split:</strong> On &nbsp; <span style="opacity:0.8;">Sources:</span> ${splits.join(', ')}</div>`
          : `<div><strong>Split:</strong> Off</div>`);
      }

      // Show IF condition if it exists
      if (param.if_condition) {
        infoHTML += `<div style="margin-top:0.5em; padding:0.5em; background:#fff3cd; border-left:3px solid #ffc107;">
                      <strong>IF Condition:</strong><br/>
                      ${param.if_condition.field} ${param.if_condition.operator} "${param.if_condition.value}"
                    </div>`;
      }

      // Show IF Split(s)
      if ((splitArr || []).length) {
        infoHTML += `<div style="margin-top:0.5em; padding:0.5em; background:#fff3cd; border-left:3px solid #ffc107;">
                      <strong>IF Split(s):</strong><br/>
                      ${splitArr.join(', ')}
                    </div>`;
      }

      infoHTML += `</div>`;
      
      // Right side: Yearly values (horizontal layout)
      let yearsHTML = '<div style="display:flex; gap:1em; align-items:start; flex-wrap:wrap;">';
      
      years.forEach(year => {
        const yearData = param.years[year];
        yearsHTML += `<div class="year-column" data-year="${year}" style="border:1px solid #ccc; padding:0.5em; border-radius:4px; min-width:150px;">`;
        yearsHTML += `<div style="font-weight:bold; margin-bottom:0.5em; display:flex; justify-content:space-between; align-items:center;">
                        <span>Year ${year}</span>
                        <button class="deleteYearBtn" data-year="${year}" style="color:red; border:none; background:none; cursor:pointer; font-size:1.2em;">×</button>
                      </div>`;
        
        if (param.type === 'geographical') {
          const vals = yearData.values || param.values || [];
          yearsHTML += `<label style="font-size:0.9em;">Allowed Values:</label><br/>
                        <textarea class="year-geo-values" rows="3" style="width:100%; font-size:0.85em; padding:0.3em;">${vals.join('\n')}</textarea>`;
        } else if (param.type === 'temporal') {
          yearsHTML += `<label style="font-size:0.9em;">Max Value:</label><br/>
                        <input type="number" class="year-value" value="${yearData.value || ''}" style="width:100%; padding:0.3em;"/>`;
        } else if (param.type === 'design') {
          yearsHTML += `<label style="font-size:0.9em;">Value:</label><br/>
                        <input type="text" class="year-design-value" value="${(yearData && yearData.value) || ''}" style="width:100%; padding:0.3em;"/>`;
        } else if (param.type === 'monetary') {
          yearsHTML += `<label style="font-size:0.9em;">Budget:</label><br/>
                        <input type="number" class="year-value" value="${yearData.value || ''}" style="width:100%; padding:0.3em;"/>`;
        }
        
        yearsHTML += `</div>`;
      });
      
      // Add Year button
      yearsHTML += `<div style="display:flex; align-items:center;">
                      <button class="addYearColumnBtn" style="padding:0.5em 1em; border:1px dashed #999; background:#fff; cursor:pointer; border-radius:4px;">
                        + Year
                      </button>
                    </div>`;
      yearsHTML += '</div>';
      
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:1em;">
          ${infoHTML}
          <div>
            <button class="editFixedParamBtn" title="Edit" style="margin-right:.5em;">✎</button>
            <button class="deleteFixedParamBtn" style="color:red; font-size:1.5em; border:none; background:none; cursor:pointer;">×</button>
          </div>
        </div>
        ${yearsHTML}
      `;

      // Store IF condition in dataset for extraction
      if (param.if_condition) {
        row.dataset.ifCondition = JSON.stringify(param.if_condition);
      }
      
      // Event handlers
      row.querySelector('.deleteFixedParamBtn').addEventListener('click', () => row.remove());

      row.querySelector('.editFixedParamBtn').addEventListener('click', () => {
        editFixedParameter(row);
      });
      
      row.querySelector('.addYearColumnBtn').addEventListener('click', () => {
        // Show add year modal
        const addYearModal = document.getElementById('addYearModal');
        const yearInput = document.getElementById('yearInput');
        const confirmBtn = document.getElementById('confirmAddYearBtn');
        const cancelBtn = document.getElementById('cancelAddYearBtn');
        const closeBtn = document.getElementById('closeAddYearModal');
        
        yearInput.value = new Date().getFullYear() + 1;
        addYearModal.style.display = 'flex';
        setTimeout(() => yearInput.focus(), 100);
        
        const cleanup = () => {
          addYearModal.style.display = 'none';
          confirmBtn.replaceWith(confirmBtn.cloneNode(true));
          cancelBtn.replaceWith(cancelBtn.cloneNode(true));
          closeBtn.replaceWith(closeBtn.cloneNode(true));
        };
        
        document.getElementById('confirmAddYearBtn').addEventListener('click', () => {
          const newYear = yearInput.value.trim();
          
          if (!newYear || !/^\d{4}$/.test(newYear)) {
            appAlert('Please enter a valid 4-digit year');
            return;
          }
          
          const paramData = extractParamData(row);
          if (paramData.years[newYear]) {
            appAlert('Year already exists');
            return;
          }
          
          // Add new year with default values
          if (paramData.type === 'geographical') {
            paramData.years[newYear] = { values: paramData.values || [] };
          } else if (paramData.type === 'temporal' || paramData.type === 'monetary') {
            paramData.years[newYear] = { value: 0 };
          } else if (paramData.type === 'designation') {
            paramData.years[newYear] = {};
          }
          
          // Rebuild the row
          const newRow = makeFixedParamDisplayRow(paramData);
          row.replaceWith(newRow);
          
          cleanup();
        });
        
        document.getElementById('cancelAddYearBtn').addEventListener('click', cleanup);
        document.getElementById('closeAddYearModal').addEventListener('click', cleanup);
        
        addYearModal.addEventListener('click', (e) => {
          if (e.target === addYearModal) cleanup();
        });
        
        yearInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            document.getElementById('confirmAddYearBtn').click();
          }
        });
      });
      
      row.querySelectorAll('.deleteYearBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const year = btn.dataset.year;
          if (!confirm(`Delete year ${year}?`)) return;
          
          const paramData = extractParamData(row);
          delete paramData.years[year];
          
          const newRow = makeFixedParamDisplayRow(paramData);
          row.replaceWith(newRow);
        });
      });
      
      return row;
    }

    // Edit handler - populate stepped UI
    function editFixedParameter(row) {
      const data = extractParamData(row);
      _editingFixedRow = row;
      
      // Start at step 1
      showStep(1);
      monetarySubStep = 1;
      
      // Set type
      fixedParamTypeSelect.value = data.type || 'geographical';
      
      // Populate step 2 fields
      const nameEl = document.getElementById('fixedParamNameInput');
      if (nameEl) nameEl.value = data.name || '';
      
      if (data.type === 'geographical') {
        geoValuesList.innerHTML = '';
        (data.values || ['']).forEach(v => geoValuesList.appendChild(makeGeoValueRow(v)));
      } else if (data.type === 'temporal') {
        document.getElementById('temporalScope').value = data.scope || 'per_day';
        document.getElementById('temporalUnit').value = data.unit || 'hours';
        try {
          const years = Object.keys(data.years || {}).sort();
          const fy = years[0];
          const v = (fy && data.years[fy] && data.years[fy].value != null) ? data.years[fy].value : '';
          const inp = document.getElementById('temporalValue');
          if (inp) inp.value = (v === '' ? '' : String(v));
        } catch {}
      } else if (data.type === 'monetary') {
        fixedParamMatchUsing.value = data.match_using || 'parameter_name';
        document.getElementById('monetaryFieldName').value = data.field_name || '';
        document.getElementById('monetaryConditional').value = data.conditional || '<=';
        try {
          const years = Object.keys(data.years || {}).sort();
          const fy = years[0];
          const v = (fy && data.years[fy] && data.years[fy].value != null) ? data.years[fy].value : '';
          const inp = document.getElementById('monetaryValue');
          if (inp) inp.value = (v === '' ? '' : String(v));
        } catch {}
        
        // SPLIT
        const splits = Array.isArray(data.split_conditions)
          ? data.split_conditions
          : (data.split_condition && data.split_condition.enabled ? [data.split_condition.source] : []);
        const enable = splits.length > 0;
        enableSplitCondition.checked = enable;
        splitFields.style.display = enable ? 'block' : 'none';
        setupSplitSourceList(enable ? splits : ['']);
      } else if (data.type === 'design') {
        const designOperator = document.getElementById('designOperator');
        const designValue = document.getElementById('designValue');
        if (designOperator) designOperator.value = data.operator || '=';
        try {
          const years = Object.keys(data.years || {}).sort();
          const fy = years[0];
          const v = (fy && data.years[fy]) ? data.years[fy].value : '';
          if (designValue) designValue.value = (v == null ? '' : String(v));
        } catch {}
      }
      
      // Populate step 3 fields (cumulative)
      if (data.type === 'monetary' || data.type === 'temporal') {
        cumulativeCheckbox.checked = !!data.cumulative;
      }
      
      // IF condition
      const hasIf = !!data.if_condition;
      enableIfCondition.checked = hasIf;
      ifConditionFields.style.display = hasIf ? 'block' : 'none';
      document.getElementById('ifFieldName').value = hasIf ? (data.if_condition.field || '') : '';
      document.getElementById('ifOperator').value = hasIf ? (data.if_condition.operator || '=') : '=';
      document.getElementById('ifValue').value = hasIf ? (data.if_condition.value || '') : '';
      
      addFixedParamModal.style.display = 'flex';
    }
    
    function extractParamData(row) {
      // Robust helpers
      const _num = (s) => {
        const v = Number(String(s ?? '').replace(/,/g, '').trim());
        return Number.isFinite(v) ? v : 0;
      };
      const name = row.querySelector('h4')?.textContent?.trim() || (row.dataset.name || '');
      const type = (row.dataset.type || '').toLowerCase();
      const param = { name, type };

      // Cumulative (only for monetary/temporal)
      if (type === 'monetary' || type === 'temporal') {
        param.cumulative = row.dataset.cumulative === 'true';
      }

      // Prefer structured data-*; fall back to the info block only if missing
      const infoDiv = row.querySelector('.param-info');
      const getTextAfter = (label) => {
        const el = Array.from(infoDiv?.querySelectorAll('div') || [])
          .find(d => d.textContent.includes(label));
        return el ? el.textContent.replace(label, '').trim() : '';
      };

      if (type === 'temporal') {
        param.scope = row.dataset.scope || getTextAfter('Scope:');
        param.unit  = row.dataset.unit  || getTextAfter('Unit:') || 'hours';
      } else if (type === 'monetary') {
        param.match_using = row.dataset.matchUsing || (getTextAfter('Match Using:').includes('Field Name') ? 'field_name' : 'parameter_name');
        param.field_name  = row.dataset.fieldName  || getTextAfter('Field:');
        param.conditional = row.dataset.conditional || getTextAfter('Conditional:') || '<=';
        param.unit        = '$'; // Always $ for monetary
      } else if (type === 'design') {
        param.operator = row.dataset.operator || getTextAfter('Operator:') || '=';
      } else if (type === 'geographical') {
        const base = getTextAfter('Base Values:');
        param.values = base ? base.split(',').map(v => v.trim()).filter(Boolean) : [];
      }

      // Yearly data
      param.years = {};
      row.querySelectorAll('.year-column').forEach(col => {
        const year = col.dataset.year;
        param.years[year] = {};
        if (type === 'geographical') {
          const textarea = col.querySelector('.year-geo-values');
          if (textarea) {
            param.years[year].values = textarea.value.split('\n').map(v => v.trim()).filter(Boolean);
          }
        } else if (type === 'temporal' || type === 'monetary') {
          const input = col.querySelector('.year-value');
          if (input) param.years[year].value = _num(input.value);
        } else if (type === 'design') {
          const input = col.querySelector('.year-design-value');
          if (input) param.years[year].value = input.value;
        }
      });

      // IF condition (dataset if present)
      const ifData = row.dataset.ifCondition;
      if (ifData) param.if_condition = JSON.parse(ifData);
      // Extract SPLIT condition(s) if stored
      const splitArrData = row.dataset.splitConditions;
      const splitObjData = row.dataset.splitCondition;
      if (splitArrData) {
        try {
          const arr = JSON.parse(splitArrData);
          if (Array.isArray(arr)) param.split_conditions = arr;
        } catch {}
      } else if (splitObjData) {
        try { param.split_condition = JSON.parse(splitObjData); } catch {}
      }
      
      return param;
    }

    // Load existing fixed parameters
    async function loadFixedParameters() {
      const existing = await window.electronAPI.getFixedParameters();
      fixedParamContainer.innerHTML = '';
      (existing || []).forEach(param => {
        fixedParamContainer.appendChild(makeFixedParamDisplayRow(param));
      });
    }

    // Open add fixed parameter modal
    addFixedParamBtn.addEventListener('click', () => {
      // Reset to step 1
      showStep(1);
      monetarySubStep = 1;
      
      // Reset all inputs
      const nameEl = document.getElementById('fixedParamNameInput');
      if (nameEl) nameEl.value = '';
      fixedParamMatchUsing.value = 'parameter_name';
      fixedParamTypeSelect.value = 'geographical';

      // Clear geographical values
      geoValuesList.innerHTML = '';
      geoValuesList.appendChild(makeGeoValueRow());

      // Reset temporal
      document.getElementById('temporalScope').value = 'per_day';
      document.getElementById('temporalValue').value = '';
      document.getElementById('temporalUnit').value = 'hours';

      // Reset monetary
      document.getElementById('monetaryFieldName').value = '';
      document.getElementById('monetaryConditional').value = '<=';
      document.getElementById('monetaryValue').value = '';
      
      // Reset Design
      const designOperator = document.getElementById('designOperator');
      const designValue = document.getElementById('designValue');
      if (designOperator) designOperator.value = '=';
      if (designValue) designValue.value = '';

      // Reset step 3 options
      cumulativeCheckbox.checked = false;
      enableIfCondition.checked = false;
      ifConditionFields.style.display = 'none';
      document.getElementById('ifFieldName').value = '';
      document.getElementById('ifOperator').value = '=';
      document.getElementById('ifValue').value = '';
      
      enableSplitCondition.checked = false;
      splitFields.style.display = 'none';
      setupSplitSourceList(['']);
      
      addFixedParamModal.style.display = 'flex';
    });

    cancelFixedParamBtn.addEventListener('click', () => {
      addFixedParamModal.style.display = 'none';
    });

    function setupFixedParamAutocomplete() {
      const type = fixedParamTypeSelect.value;
      const matchUsing = fixedParamMatchUsing.value;
      
      // Always wire IF-condition field to FIELD names
      const ifFieldInput = document.getElementById('ifFieldName');
      if (ifFieldInput) applyAutocomplete(ifFieldInput, availableFieldNames);
      // SPLIT source suggestions (multi)
      _rewireAllSplitInputs();
      // Inputs we may (un)wire
      let fpName = document.getElementById('fixedParamNameInput');
      let monField = document.getElementById('monetaryFieldName');

      // 1) Geographical, Temporal, Design → suggest on Fixed Parameter Name using FIELD catalog
      if (type === 'geographical' || type === 'temporal' || type === 'design') {
        if (fpName)  fpName  = applyAutocomplete(fpName, availableFieldNames);
        if (monField) monField = unwireAutocomplete(monField);
        return;
      }

      // 2) Monetary → suggest ONLY on selection from "Match Using"
      if (type === 'monetary') {
        const fieldInput = monField;

        if (matchUsing === 'field_name') {
          // Wire Field Name to FIELD suggestions, unwire Fixed Parameter Name
          if (fieldInput) applyAutocomplete(fieldInput, availableFieldNames);
          if (fpName)     fpName = unwireAutocomplete(fpName);
        } else {
          // matchUsing === 'parameter_name' → still restrict to FIELD catalog
          if (fpName)     fpName = applyAutocomplete(fpName, availableFieldNames);
          if (fieldInput) unwireAutocomplete(fieldInput);
        }
      }

    }

    // Update autocomplete when match using changes
    fixedParamMatchUsing.addEventListener('change', setupFixedParamAutocomplete);

    // Save new fixed parameter
    saveFixedParamBtn.addEventListener('click', () => {
      const _num = (s) => {
        const v = Number(String(s ?? '').replace(/,/g, '').trim());
        return Number.isFinite(v) ? v : 0;
      };
      // Query within modal to get current (possibly cloned) elements
      const modal = document.getElementById('addFixedParamModal');
      const nameEl = modal.querySelector('#fixedParamNameInput');
      const name = nameEl ? nameEl.value.trim() : '';
      const type = fixedParamTypeSelect.value;
      const matchUsing = fixedParamMatchUsing.value;
      
      if (!name) {
        appAlert('Please enter a parameter name');
        return;
      }

      const param = { name, type };
      const currentYear = new Date().getFullYear();
      param.years = {};

      // Capture IF condition if enabled
      if (enableIfCondition.checked) {
        const ifField = modal.querySelector('#ifFieldName').value.trim();
        const ifValue = modal.querySelector('#ifValue').value.trim();
        
        if (!ifField || !ifValue) {
          appAlert('Please fill in IF condition field and value, or uncheck the IF condition option');
          return;
        }
        
        param.if_condition = {
          field: ifField,
          operator: modal.querySelector('#ifOperator').value,
          value: ifValue
        };
      }

      if (type === 'geographical') {
        const values = Array.from(geoValuesList.querySelectorAll('.geo-value'))
          .map(input => input.value.trim())
          .filter(v => v);
        if (!values.length) {
          appAlert('Please add at least one geographical value');
          return;
        }
        param.values = values;
        param.years[currentYear] = { values };
      } else if (type === 'temporal') {
        param.scope = modal.querySelector('#temporalScope').value;
        const value = modal.querySelector('#temporalValue').value;
        param.unit = modal.querySelector('#temporalUnit').value;
        param.cumulative = cumulativeCheckbox.checked;
        if (!value) {
          appAlert('Please enter a temporal value');
          return;
        }
        param.years[currentYear] = { value: _num(value) };
      } else if (type === 'design') {
        const designOperator = modal.querySelector('#designOperator');
        const designValue = modal.querySelector('#designValue');
        param.operator = (designOperator && designOperator.value) || '=';
        const dval = (designValue && designValue.value.trim()) || '';
        if (!dval) {
          appAlert('Please enter a value for the Design constraint');
          return;
        }
        param.years[currentYear] = { value: dval };
      } else if (type === 'monetary') {
        param.match_using = matchUsing;
        param.field_name = modal.querySelector('#monetaryFieldName').value.trim();
        param.conditional = modal.querySelector('#monetaryConditional').value;
        param.unit = '$';
        const value = modal.querySelector('#monetaryValue').value;
        param.cumulative = cumulativeCheckbox.checked;
        if (!param.field_name || !value) {
          appAlert('Please fill in all monetary constraint fields');
          return;
        }
        // SPLIT condition (optional)
        if (enableSplitCondition.checked) {
          const srcs = Array.from(splitFields.querySelectorAll('.split-source-input'))
            .map(i => (i.value || '').trim())
            .filter(Boolean);
          if (!srcs.length) {
            appAlert('Please add at least one split source, or disable the SPLIT condition.');
            return;
          }
          // Multi-split: store as array; display/serialization will fan-out later
          param.split_conditions = srcs;
        }
        param.years[currentYear] = { value: _num(value) };
      }

      // If editing, preserve current years and replace row; else append
      if (_editingFixedRow) {
        const existing = extractParamData(_editingFixedRow);
        // keep existing years but update FIRST year value from the modal for types that use it
        if (existing && existing.years) {
          param.years = existing.years;
        }
        // Determine first year key (create one if missing)
        let years = Object.keys(param.years || {}).sort();
        if (!years.length) {
          const cy = String(new Date().getFullYear());
          param.years[cy] = (type === 'geographical') ? { values: (param.values || []) } : { value: 0 };
          years = [cy];
        }
        const firstYear = years[0];
        // Apply modal "value" to FIRST year for relevant types
        if (type === 'temporal') {
          const modal = document.getElementById('addFixedParamModal');
          const tv = modal.querySelector('#temporalValue')?.value ?? '';
          param.years[firstYear] = { value: _num(tv) };
          // carry over scope/unit/cumulative already set above
        } else if (type === 'monetary') {
          const modal = document.getElementById('addFixedParamModal');
          const mv = modal.querySelector('#monetaryValue')?.value ?? '';
          param.years[firstYear] = { value: _num(mv) };
        } else if (type === 'design') {
          const modal = document.getElementById('addFixedParamModal');
          const designValue = modal.querySelector('#designValue');
          const dv = (designValue && designValue.value) ?? '';
          param.years[firstYear] = { value: dv };
        } else if (type === 'geographical') {
          // If user changed base values in modal, mirror them into FIRST year column
          const vals = Array.from(document.querySelectorAll('#geoValuesList .geo-value'))
            .map(i => i.value.trim()).filter(Boolean);
          if (vals.length) {
            param.values = vals;
            param.years[firstYear] = { values: vals };
          }
        }
        const newRow = makeFixedParamDisplayRow(param);
        _editingFixedRow.replaceWith(newRow);
        _editingFixedRow = null;
      } else {
        fixedParamContainer.appendChild(makeFixedParamDisplayRow(param));
      }
      addFixedParamModal.style.display = 'none';
    });

    // Save all fixed parameters
    saveFixedParamsBtn.addEventListener('click', async () => {
      const params = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
        .map(row => extractParamData(row));
      await window.electronAPI.saveFixedParameters(params);
      appAlert('Fixed parameters saved successfully');
    });

    // Continue with the rest of the optimization functions...
    // [REST OF THE CODE REMAINS THE SAME FROM HERE]
    
    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 1 - Scoring
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt1Btn = document.getElementById('runOpt1Btn');
    const opt1Results = document.getElementById('opt1Results');

    // Store deadline inputs per repair
    if (runOpt1Btn) {
      runOpt1Btn.addEventListener('click', async () => {
        // Use TEST repairs if TEST mode is active, otherwise use normal repairs
        let allRepairs;
        if (window._testMode && window._testRepairs) {
          allRepairs = window._testRepairs;
          console.log('[Opt-1] Using TEST repairs:', allRepairs.length);
        } else {
          const scopedStations = await getScopedStationData();
          allRepairs = await getScopedRepairs(scopedStations);
        }

        if (!allRepairs || !allRepairs.length) {
          opt1Results.innerHTML = '<div class="opt-note">No repairs found.</div>';
          return;
        }

        // Get station data for matching (skip if TEST mode - no station data needed)
        let stationDataMap = {};
        if (!window._testMode || !window._testRepairs) {
          const stationList = await getScopedStationData();
          (stationList || []).forEach(station => {
            const stationId = station.station_id || station['Station ID'] || station.id;
            if (stationId) stationDataMap[stationId] = station;
          });
        }

        // FIX: ensure station splits are visible in Opt2/Opt3 (O&M was missing when this wasn't set)
        window._stationDataMap = stationDataMap;

        // Build overall weights
        const overall = {};
        document.querySelectorAll('.param-row').forEach(row => {
          const pname = row.querySelector('.param-name')?.value?.trim();
          const pct   = parseFloat(row.querySelector('.param-percentage')?.value || '0');
          if (pname) overall[pname] = isFinite(pct) ? pct : 0;
        });

        const params = await window.electronAPI.getAlgorithmParameters();
        
        opt1Results.innerHTML = '<div class="opt-note">Scoring repairs...</div>';

        const result = await window.electronAPI.optimizeWorkplan({
          repairs: allRepairs,
          station_data: stationDataMap,
          param_overall: overall,
          parameters: params
        });

        if (!result.success) {
          opt1Results.innerHTML = `<div class="opt-error">${result.notes || 'Scoring failed'}</div>`;
          return;
        }

        window._scoredRepairs = result.ranking;
        renderOpt1Results(result);
      });
    }

    // Helper to collect deadline data from Opt 1 table
    function collectDeadlinesFromOpt1Table() {
      const deadlines = {};
      const inputs = opt1Results.querySelectorAll('.deadline-input');
      inputs.forEach(input => {
        const key = input.dataset.repairKey;
        const value = input.value.trim();
        if (key && value) {
          deadlines[key] = value;
        }
      });
      return deadlines;
    }

    // Helper to get repair key
    function getRepairKey(repair) {
      return repair.row_index != null ? `idx:${repair.row_index}` : `sid:${repair.station_id}::name:${repair.repair_name}`;
    }

    function renderOpt1Results(result) {
      // ────────────────────────────────────────────────────────────────────
      // Virtual table rendering for Optimization 1
      // ────────────────────────────────────────────────────────────────────
      opt1Results.innerHTML = '';

      // TEST mode banner (unchanged)
      if (window._testMode && window._testRepairs) {
        const testBanner = document.createElement('div');
        testBanner.style.cssText =
          'padding:1em; margin-bottom:1em; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; color:#856404;';
        testBanner.innerHTML =
          `<strong>⚠️ TEST MODE ACTIVE</strong> - Using ${window._testRepairs.length} test repairs (station data ignored)`;
        opt1Results.appendChild(testBanner);
      }

      const formatCurrency = (n) => {
        const num = Number(n || 0);
        if (!isFinite(num)) return '';
        return '$' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
      };

      // Gather split columns present in the data
      const splitKeysSet = new Set();
      (result.ranking || []).forEach(item => {
        const sa = item.split_amounts || {};
        for (const [k, v] of Object.entries(sa)) {
          if (Number(v) > 0) splitKeysSet.add(k);
        }
      });
      const splitKeys = Array.from(splitKeysSet).sort((a,b)=>a.localeCompare(b));
      // Only show "Must Finish By" in Repair-First (Dynamic) workflow
      const showDeadlineCol = (workflowMode === 'repair-first-dynamic');

      // Header summary
      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 1: Scored Repairs</div>
        <div class="opt-summary">
          <span class="chip">Total Repairs: ${result.optimized_count}</span>
        </div>
      `;
      opt1Results.appendChild(summary);

      // Virtual container

      const scrollWrapper = document.createElement('div');
      scrollWrapper.className = 'table-scroll';
      opt1Results.appendChild(scrollWrapper);

      const container = document.createElement('div');
      container.className = 'virtual-scroll-container';
      scrollWrapper.appendChild(container);

      // Sticky header table (separate table to keep header visible)
      const headerTable = document.createElement('table');
      headerTable.className = 'opt-table';
      headerTable.innerHTML = `
        <thead>
          <tr>
            <th>Rank</th>
            <th>Station ID</th>
            <th>Site</th>
            <th>Location</th>
            <th>Asset Type</th>
            <th>Repair</th>
            <th>Cost</th>
            <th>Funding Type</th>
            ${splitKeys.map(k => `<th>Split: ${k}</th>`).join('')}
            <th>Score</th>
            ${showDeadlineCol ? '<th>Must Finish By</th>' : ''}
          </tr>
        </thead>
      `;
      container.appendChild(headerTable);

      // Spacer to emulate full height; viewport where visible rows are rendered
      const viewport = document.createElement('div');
      viewport.className = 'virtual-scroll-viewport';
      const spacer = document.createElement('div');
      spacer.className = 'virtual-scroll-spacer';
      container.appendChild(viewport);
      container.appendChild(spacer);

      // Render a small table inside the viewport, absolutely positioned
      const bodyTable = document.createElement('table');
      bodyTable.className = 'opt-table';
      // only a tbody (no thead) so columns align under header
      bodyTable.innerHTML = `<tbody></tbody>`;
      viewport.appendChild(bodyTable);

      const items = result.ranking || [];
      // Row height: keep in sync with your CSS cell padding (~36–44 px typical)
      const ROW_HEIGHT = 40;          // px per row (tweak if your rows are taller)
      const OVERSCAN   = 5;           // render a few extra rows above/below

      // Precompute total height
      const totalRows = items.length;
      const totalHeight = totalRows * ROW_HEIGHT;
      spacer.style.height = totalHeight + 'px';

      const tbody = bodyTable.querySelector('tbody');

      // escape + wrap helper so we can detect overflow and set titles
      function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, m => (
          ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])
        ));
      }
      function cell(v) {
        const t = esc(v);
        return `<span class="cell-clip" data-full="${t}">${t}</span>`;
      }
      function maybeApplyOverflowTitles(root) {
        root.querySelectorAll('.cell-clip').forEach(el => {
          // If content overflows (clipped), add a title; else remove it.
          if (el.scrollWidth > el.clientWidth) {
            el.title = el.dataset.full || el.textContent;
            el.classList.add('truncated');
          } else {
            el.removeAttribute('title');
            el.classList.remove('truncated');
          }
        });
      }

      function rowHtml(item) {
        const cost = Number(item.cost || 0);
        const repair = item.original_repair || {};

        const station = window._stationDataMap?.[item.station_id] || {};
        const site = getSiteNameForStationOrRepair(station);

        // For Opt1 we normally don't have station map; fall back to repair only
        const fundingType =
          findFieldAnywhere(repair, /*station*/ {}, 'Funding Type') ||
          findFieldAnywhere(repair, /*station*/ {}, 'Category') ||
         '';
        // Determine Repair column text.
        // When TEST mode is active, prefer the exact "Repair Name" from TEST data.
        const repairName =
          (window._testMode && window._testRepairs)
            ? (findFieldAnywhere(repair, /*station*/ {}, 'Repair Name') || repair.name || repair.repair_name || item.repair_name || '')
            : (item.repair_name || repair.name || repair.repair_name || '');

        let cells = `
          <td class="txt">${cell(item.rank)}</td>
          <td class="txt">${cell(item.station_id || '')}</td>
          <td class="txt">${cell(site || '')}</td>
          <td class="txt">${cell(item.location || '')}</td>
          <td class="txt">${cell(item.asset_type || '')}</td>
          <td class="txt">${cell(repairName)}</td>
          <td class="txt">${cell(formatCurrency(cost))}</td>
          <td class="txt">${cell(fundingType)}</td>
        `;
        const sa = item.split_amounts || {};
        for (const k of splitKeys) {
          const v = Number(sa[k] || 0);
          cells += `<td class="txt">${v > 0 ? cell(formatCurrency(v)) : ''}</td>`;
        }
        cells += `<td class="txt">${cell(Number(item.score).toFixed(2) + '%')}</td>`;
        // Add deadline input ONLY when Repair-First (Dynamic) is active
        if (showDeadlineCol) {
          const key = item.row_index != null ? `idx:${item.row_index}` : `sid:${item.station_id}::name:${item.repair_name}`;
          cells += `<td><input type="text" class="deadline-input" data-repair-key="${key}" placeholder="Year" style="width:60px; padding:0.3em;"></td>`;
        }
        return `<tr>${cells}</tr>`;
      }

      // Align body table under header table by giving it a top offset
      function setViewportOffset(px) {
        viewport.style.transform = `translateY(${px}px)`;
      }

      // Compute & render visible window
      let lastKnownScrollTop = 0;
      let ticking = false;

      function renderWindow() {
        const rect = container.getBoundingClientRect();
        const containerHeight = container.clientHeight || (rect.height || 600);
        const scrollTop = container.scrollTop || 0;

        // determine visible indices
        const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
        const end   = Math.min(
          totalRows,
          Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN
        );

        // position viewport to the first rendered row
        const offsetY = start * ROW_HEIGHT + (headerTable.offsetHeight || 0);
        setViewportOffset(offsetY);

        // build visible rows html
        let html = '';
        for (let i = start; i < end; i++) {
          html += rowHtml(items[i]);
        }
        tbody.innerHTML = html;
        // Wait for layout so measurements are accurate
        requestAnimationFrame(() => maybeApplyOverflowTitles(tbody));
      }

      function onScroll() {
        lastKnownScrollTop = container.scrollTop;
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(() => {
            renderWindow();
            ticking = false;
          });
        }
      }

      // Keep column widths aligned: enforce table-layout fixed on both tables
      headerTable.style.tableLayout = 'fixed';
      bodyTable.style.tableLayout   = 'fixed';

      // Initial sizing/alignment pass
      renderWindow();

      // Events
      container.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', () => {
        renderWindow();
        // re-check overflow after resize (columns may change width)
        requestAnimationFrame(() => maybeApplyOverflowTitles(tbody));
      });
    }


    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 2 - Trip Grouping
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt2Btn = document.getElementById('runOpt2Btn');
    const opt2Results = document.getElementById('opt2Results');
    const tripPrioritySelect = document.getElementById('tripPriorityMode');
    const tripModeInfoBtn = document.getElementById('tripModeInfoBtn');
    const tripModeInfoModal = document.getElementById('tripModeInfoModal');
    const closeTripModeInfoModal = document.getElementById('closeTripModeInfoModal');
    const okTripModeInfoBtn = document.getElementById('okTripModeInfoBtn');

    // default mode = tripmean
    window._tripPriorityMode = 'tripmean';
    if (tripPrioritySelect) {
      try { tripPrioritySelect.value = 'tripmean'; } catch (e) {}
      tripPrioritySelect.addEventListener('change', () => {
        window._tripPriorityMode = tripPrioritySelect.value || 'tripmean';
      });
    }
    // info modal wiring
    if (tripModeInfoBtn && tripModeInfoModal) {
      const openInfo = () => (tripModeInfoModal.style.display = 'flex');
      const closeInfo = () => (tripModeInfoModal.style.display = 'none');
      tripModeInfoBtn.addEventListener('click', openInfo);
      if (closeTripModeInfoModal) closeTripModeInfoModal.addEventListener('click', closeInfo);
      if (okTripModeInfoBtn) okTripModeInfoBtn.addEventListener('click', closeInfo);
      tripModeInfoModal.addEventListener('click', (e) => { if (e.target === tripModeInfoModal) closeInfo(); });
    }

    if (runOpt2Btn) {
      runOpt2Btn.addEventListener('click', async () => {
        // Different logic based on workflow mode
        if (workflowMode === 'repair-first' || workflowMode === 'repair-first-dynamic') {
          await runOpt2RepairFirst();
          return;
        }

        // Trip-First mode (original logic)
        if (!Array.isArray(window._scoredRepairs) || window._scoredRepairs.length === 0) {
          opt2Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 1 first.</div>';
          return;
        }

        // Trip-First mode (original logic)
        if (!Array.isArray(window._scoredRepairs) || window._scoredRepairs.length === 0) {
          opt2Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 1 first.</div>';
          return;
        }

        const stationList = await getScopedStationData();
        const stationDataMap = {};
        (stationList || []).forEach(station => {
          const stationId = station.station_id || station['Station ID'] || station.id;
          if (stationId) stationDataMap[stationId] = station;
        });

        // FIX: required for station-level split lookups in Opt2 nested tables
        window._stationDataMap = stationDataMap;

        opt2Results.innerHTML = '<div class="opt-note">Grouping scored repairs into trips…</div>';

        // Use scored repairs from Optimization 1 only
        const scored = window._scoredRepairs;

        const result = await window.electronAPI.groupRepairsIntoTrips({
          scored_repairs: scored || [],
          repairs: [], // no raw fallback; Opt-1 is required
          station_data: stationDataMap,
          priority_mode: (window._tripPriorityMode || 'tripmean'),
          group_by_fields: ['Access Type', 'City of Travel']
        });

        if (!result.success) {
          opt2Results.innerHTML = `<div class="opt-error">${result.message || 'Trip grouping failed'}</div>`;
          return;
        }

        window._tripsData = result.trips;
        renderOpt2Results(result);
      });
    }

    // NEW: Repair-First Opt2 - Group repairs into trips within each year
    async function runOpt2RepairFirst() {
      // Guard: require Opt3 (repair assignment) to be completed first
      if (!window._opt3Result || !window._opt3Result.assignments) {
        opt2Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 3 first.</div>';
        return;
      }

      const stationList = await getScopedStationData();
      const stationDataMap = {};
      (stationList || []).forEach(station => {
        const stationId = station.station_id || station['Station ID'] || station.id;
        if (stationId) stationDataMap[stationId] = station;
      });

      opt2Results.innerHTML = '<div class="opt-note">Grouping repairs into trips within each year...</div>';

      // Call backend with per-year repair lists
      const result = await window.electronAPI.groupTripsWithinYears({
        year_assignments: window._opt3Result.assignments,
        station_data: stationDataMap,
        priority_mode: (window._tripPriorityMode || 'tripmean'),
        group_by_fields: ['Access Type', 'City of Travel']
      });

      if (!result.success) {
        opt2Results.innerHTML = `<div class="opt-error">${result.message || 'Trip grouping failed'}</div>`;
        return;
      }

      // Store result for Opt3 display if needed
      window._tripsDataByYear = result.trips_by_year;
      
      // Render results (group by year)
      renderOpt2RepairFirstResults(result);
    }

    function renderOpt2RepairFirstResults(result) {
      opt2Results.innerHTML = '';
      
      // Add TEST mode banner if active
      if (window._testMode && window._testRepairs) {
        const testBanner = document.createElement('div');
        testBanner.style.cssText = 'padding:1em; margin-bottom:1em; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; color:#856404;';
        testBanner.innerHTML = `<strong>⚠️ TEST MODE ACTIVE</strong> - Using TEST repairs' City of travel & Access Type fields`;
        opt2Results.appendChild(testBanner);
      }

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 2: Trip Grouping Within Years</div>
        <div class="opt-summary">
          <span class="chip">Mode: ${(window._tripPriorityMode || 'tripmean')}</span>
        </div>
        <div class="opt-note" style="margin-top:.5rem;">
          <strong>Note:</strong> Repairs have been grouped into trips <em>within each assigned year</em>.
          Trips are ordered by repair scores using the selected mode.
        </div>
      `;
      opt2Results.appendChild(summary);

      const yearKeys = Object.keys(result.trips_by_year || {}).sort();

      yearKeys.forEach(year => {
        const trips = result.trips_by_year[year] || [];
        
        const yearSection = document.createElement('section');
        yearSection.className = 'opt-trip';
        yearSection.innerHTML = `
          <div class="trip-title">
            <button class="toggle-year" data-year="${year}" aria-label="Expand year">▸</button>
            Year ${year} — ${trips.length} Trip(s)
          </div>
          <div class="year-details" style="display:none;"></div>
        `;

        const toggleBtn = yearSection.querySelector('.toggle-year');
        const detailsDiv = yearSection.querySelector('.year-details');
        let rendered = false;

        toggleBtn.addEventListener('click', () => {
          const isOpen = detailsDiv.style.display !== 'none';
          if (isOpen) {
            detailsDiv.style.display = 'none';
            toggleBtn.textContent = '▸';
          } else {
            if (!rendered) {
              // Render trips for this year
              trips.forEach((trip, idx) => {
                const tripDiv = document.createElement('div');
                tripDiv.className = 'nested-wrap';
                tripDiv.style = 'margin-bottom:1em;';
                
                const labels = (trip.group_labels && trip.group_labels.length)
                  ? trip.group_labels.map(gl => `${gl.name}: ${gl.value}`).join(' • ')
                  : `Access Type: ${trip.access_type || ''} • City of Travel: ${trip.city_of_travel || ''}`;
                
                // Category-aware split chips (dynamic categories)
                const allRepairs = (trip.stations || []).flatMap(st => (st.repairs || []));
                const activeCats = detectActiveCategoriesFromRepairs(allRepairs);
                const splitSources = collectSplitSourcesFromRepairs(allRepairs, activeCats);
                const splitCols = buildSplitColumns(splitSources, activeCats);
                const totals = computeSplitTotalsForRepairs(allRepairs, splitCols);
                const splitChips = renderSplitChipsFromTotals(totals, splitCols);
                
                tripDiv.innerHTML = `
                  <div style="font-weight:600; margin-bottom:0.5em;">Trip ${idx + 1}: ${labels}</div>
                  <div style="display:flex; gap:0.5em; flex-wrap:wrap; margin-bottom:0.5em;">
                    <span class="chip">Total Days: ${trip.total_days}</span>
                    <span class="chip">Stations: ${trip.stations.length}</span>
                    <span class="chip">Repairs: ${trip.repairs.length}</span>
                    <span class="chip">Total Cost: ${formatCurrency(trip.total_cost || 0)}</span>
                    <span class="chip">Score: ${Number(trip.priority_score || 0).toFixed(2)} (${trip.priority_mode || 'tripmean'})</span>
                    ${splitChips}
                  </div>
                `;
                
                // Add stations table
                const stationScroll = document.createElement('div');
                stationScroll.className = 'table-scroll';
                tripDiv.appendChild(stationScroll);
                renderStationsTable(stationScroll, trip, splitCols);
                
                detailsDiv.appendChild(tripDiv);
              });
              rendered = true;
            }
            detailsDiv.style.display = '';
            toggleBtn.textContent = '▾';
          }
        });

        opt2Results.appendChild(yearSection);
      });

    }

    function renderOpt2Results(result) {
      // ────────────────────────────────────────────────────────────────────
      // Helper: compute split keys for a single trip (used by non-virtual
      // nested station/repair tables so columns are consistent)
      // ────────────────────────────────────────────────────────────────────
      function _collectSplitKeysForTrip(trip) {
        const found = new Set();
        (trip.stations || []).forEach(st => {
          (st.repairs || []).forEach(rp => {
            const smap = getSplitMapFromRepair(rp);
            Object.entries(smap || {}).forEach(([k, mul]) => {
              if (Number(mul) > 0) found.add(k);
            });
          });
        });
        return Array.from(found).sort();
      }
      // NOTE: We no longer virtualize stations inside a trip so row expansion
      // (repairs) works normally. Virtualization is reserved for "tables of
      // trips" (see Opt-3), not the nested tables within them.
      function createVirtualStationsTable(trip) {
        const wrap = document.createElement('div');
        wrap.className = 'virtual-scroll-container stations';

        // header
        const headerTable = document.createElement('table');
        headerTable.className = 'opt-table';
        headerTable.style.tableLayout = 'fixed';
        headerTable.innerHTML = `
          <thead>
            <tr>
              <th>Station ID</th>
              <th>Site Name</th>
              <th>City of Travel</th>
              <th>Time to Site (hr)</th>
              <th>Repairs</th>
              <th>Days</th>
              <th>TripMean</th>
              <th>TripMax</th>
            </tr>
          </thead>
        `;
        wrap.appendChild(headerTable);

        // viewport & spacer
        const viewport = document.createElement('div');
        viewport.className = 'virtual-scroll-viewport';
        const spacer = document.createElement('div');
        spacer.className = 'virtual-scroll-spacer';
        wrap.appendChild(viewport);
        wrap.appendChild(spacer);

        // body table inside viewport
        const bodyTable = document.createElement('table');
        bodyTable.className = 'opt-table';
        bodyTable.style.tableLayout = 'fixed';
        bodyTable.innerHTML = `<tbody></tbody>`;
        viewport.appendChild(bodyTable);
        const tbody = bodyTable.querySelector('tbody');

        const items = trip.stations || [];
        const ROW_HEIGHT = 40;   // keep in sync with CSS
        const MAX_HEIGHT = 360;  // matches CSS default
        const OVERSCAN   = 6;
        const totalRows = items.length;
        spacer.style.height = (totalRows * ROW_HEIGHT) + 'px';

        // tooltips only when clipped
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
        const cell = (v) => {
          const t = esc(v);
          return `<span class="cell-clip" data-full="${t}">${t}</span>`;
        };
        const maybeApplyOverflowTitles = (root) => {
          root.querySelectorAll('.cell-clip').forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
              el.title = el.dataset.full || el.textContent;
              el.classList.add('truncated');
            } else {
              el.removeAttribute('title');
              el.classList.remove('truncated');
            }
          });
        };

        const mean = Number(trip.priority_metrics?.mean || 0).toFixed(2);
        const max  = Number(trip.priority_metrics?.max  || 0).toFixed(2);
        function rowHtml(st) {
          return `
            <tr>
              <td class="txt">${cell(st.station_id)}</td>
              <td class="txt">${cell(st.site_name || '')}</td>
              <td class="txt">${cell(st.city_of_travel || '')}</td>
              <td class="txt">${cell(st.time_to_site || '')}</td>
              <td class="txt">${cell(String(st.repair_count))}</td>
              <td class="txt">${cell(String(st.total_days))}</td>
              <td class="txt">${cell(mean)}</td>
              <td class="txt">${cell(max)}</td>
            </tr>
          `;
        }

        function renderWindow() {
          const container = wrap;
          const containerH = container.clientHeight || 400;
          const scrollTop = container.scrollTop || 0;
          const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
          const end   = Math.min(totalRows, Math.ceil((scrollTop + containerH) / ROW_HEIGHT) + OVERSCAN);
          viewport.style.transform = `translateY(${start * ROW_HEIGHT + (headerTable.offsetHeight || 0)}px)`;
          let html = '';
          for (let i = start; i < end; i++) html += rowHtml(items[i]);
          tbody.innerHTML = html;
          requestAnimationFrame(() => maybeApplyOverflowTitles(tbody));
        }

        // NEW: shrink container for small tables (< 8 rows)
        function sizeContainer() {
          const headerH = headerTable.offsetHeight || 40;
          if (totalRows < 8) {
            // fit header + rows, no scroll
            const h = headerH + (totalRows * ROW_HEIGHT) + 2; // small fudge for borders
            wrap.style.height = `${h}px`;
            wrap.style.overflowY = 'hidden';
          } else {
            // default virtual viewport
            wrap.style.height = `${MAX_HEIGHT}px`;
            wrap.style.overflowY = 'auto';
          }
        }

        wrap.addEventListener('scroll', () => requestAnimationFrame(renderWindow), { passive: true });
        window.addEventListener('resize', () => {
          // Re-measure container and re-check clipping after column width changes
          sizeContainer();
          requestAnimationFrame(() => {
            renderWindow();
            maybeApplyOverflowTitles(tbody);
          });
        });
        // Make sure header is measured after it hits the DOM
        requestAnimationFrame(() => { sizeContainer(); renderWindow(); });
        return wrap;
      }
      // ────────────────────────────────────────────────────────────────────
      opt2Results.innerHTML = '';

      // Add TEST mode banner if active
      if (window._testMode && window._testRepairs) {
        const testBanner = document.createElement('div');
        testBanner.style.cssText = 'padding:1em; margin-bottom:1em; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; color:#856404;';
        testBanner.innerHTML = `<strong>⚠️ TEST MODE ACTIVE</strong> - Using TEST repairs' City of travel & Access Type fields`;
        opt2Results.appendChild(testBanner);
      }

      const formatCurrency = (n) => {
        const num = Number(n || 0);
        if (!isFinite(num)) return '$0';
        return '$' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
      };

      const gf = ['Access Type','City of Travel'];

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 2: Trip Grouping</div>
        <div class="opt-summary">
          <span class="chip">Total Trips: ${result.trips.length}</span>
          <span class="chip">Mode: ${(window._tripPriorityMode || 'tripmean')}</span>
        </div>
        <div class="opt-note" style="margin-top:.5rem;">
          <strong>Note:</strong> This step <em>groups</em> by fixed fields
          <code>${gf[0]} × ${gf[1]}</code>. Trips are ordered by <em>Optimization 1</em> scores using the selected mode
          (<code>tripmean</code> or <code>tripmax</code>).
        </div>
      `;
      opt2Results.appendChild(summary);

      // Render trips with lazy-loading tables
      result.trips.forEach((trip, idx) => {
        const tripSection = document.createElement('section');
        tripSection.className = 'opt-trip';
        const labels = (trip.group_labels && trip.group_labels.length)
            ? trip.group_labels.map(gl => `${gl.name}: ${gl.value}`).join(' • ')
            : `Access Type: ${trip.access_type || ''} • City of Travel: ${trip.city_of_travel || ''}`;
        
        // Category-aware split chips (dynamic categories)
        const allRepairs = (trip.stations || []).flatMap(st => (st.repairs || []));
        const activeCats = detectActiveCategoriesFromRepairs(allRepairs);
        const splitSources = collectSplitSourcesFromRepairs(allRepairs, activeCats);
        const splitCols = buildSplitColumns(splitSources, activeCats);
        const totals = computeSplitTotalsForRepairs(allRepairs, splitCols);
        const splitChips = renderSplitChipsFromTotals(totals, splitCols);
        
        tripSection.innerHTML = `
          <div class="trip-title">
            <button class="toggle-trip" data-trip-idx="${idx}" aria-label="Expand trip">▸</button>
            Trip ${idx + 1}: ${labels}
          </div>
          <div class="trip-summary">
            <span class="chip">Total Days: ${trip.total_days}</span>
            <span class="chip">Stations: ${trip.stations.length}</span>
            <span class="chip">Repairs: ${trip.repairs.length}</span>
            <span class="chip">Total Cost: ${formatCurrency(trip.total_cost || 0)}</span>
            <span class="chip">Score: ${Number(trip.priority_score || 0).toFixed(2)} (${trip.priority_mode || 'tripmean'})</span>            
            ${splitChips}
          </div>
          <div class="trip-details" style="display:none;"></div>
        `;

        // Lazy render table on expand
        const toggleBtn = tripSection.querySelector('.toggle-trip');
        const detailsDiv = tripSection.querySelector('.trip-details');
        let rendered = false;
        
        toggleBtn.addEventListener('click', () => {
          const isOpen = detailsDiv.style.display !== 'none';
          
          if (isOpen) {
            detailsDiv.style.display = 'none';
            toggleBtn.textContent = '▸';
          } else {
            if (!rendered) {
              // Render a NORMAL (non-virtual) stations table so its rows can expand.
              const wrap = document.createElement('div');
              wrap.className = 'nested-wrap';
              const stationScroll = document.createElement('div');
              stationScroll.className = 'table-scroll';
              wrap.appendChild(stationScroll);

              renderStationsTable(stationScroll, trip, splitCols);
              detailsDiv.appendChild(wrap);
              rendered = true;
            }
            detailsDiv.style.display = '';
            toggleBtn.textContent = '▾';
          }
        });

        opt2Results.appendChild(tripSection);
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 3 - Yearly Assignment
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt3Btn = document.getElementById('runOpt3Btn');
    const opt3Results = document.getElementById('opt3Results');
    const opt3TopPercentInput = document.getElementById('opt3TopPercent');
    const opt3TopInfoBtn = document.getElementById('opt3TopInfoBtn');
    const opt3TopInfoModal = document.getElementById('opt3TopInfoModal');
    const closeOpt3TopInfoModal = document.getElementById('closeOpt3TopInfoModal');
    const okOpt3TopInfoBtn = document.getElementById('okOpt3TopInfoBtn');

    // Wire info modal
    if (opt3TopInfoBtn && opt3TopInfoModal) {
      const opt3TopInfoTitle = document.getElementById('opt3TopInfoTitle');
      const opt3TopInfoContent = document.getElementById('opt3TopInfoContent');

      const openInfo = () => {
        // Populate content based on current workflow mode
        const mode = workflowModeSelect?.value || 'trip-first';

        if (mode === 'repair-first-dynamic') {
          if (opt3TopInfoTitle) opt3TopInfoTitle.textContent = 'Look-Ahead Window';
          if (opt3TopInfoContent) {
            opt3TopInfoContent.innerHTML = `
              <p>When deciding whether to swap a high-priority repair (with no deadline) for a lower-priority repair (with a deadline and matching location), the algorithm looks ahead through a portion of the remaining unassigned repairs.</p>
              <p><strong>Look-Ahead Window = X% × Total Repairs</strong></p>
              <p>For example, if you have 100 repairs and set this to 50%, the algorithm will scan the next 50 repairs when looking for better consolidation opportunities.</p>
              <ul style="margin:0.5em 0 0 1.5em;">
                <li><strong>100%:</strong> Maximum consolidation (scans all remaining repairs)</li>
                <li><strong>50%:</strong> Balanced approach</li>
                <li><strong>10-25%:</strong> More conservative (faster but may miss opportunities)</li>
              </ul>
              <p style="margin-top:0.5em; font-size:0.9em; color:#666;"><strong>Tip:</strong> Start with 100% for best results, then reduce if performance becomes an issue with very large datasets.</p>
            `;
          }
        } else {
          if (opt3TopInfoTitle) opt3TopInfoTitle.textContent = 'Top-X% Warning';
          if (opt3TopInfoContent) {
            opt3TopInfoContent.innerHTML = `
              <p>After assigning trips to years, the system identifies the <strong>Top X%</strong> of highest-priority repairs (based on scores from Optimization 1) and checks which ones were scheduled in Year 1.</p>
              <p><strong>Warning Threshold = X% × Total Repairs</strong></p>
              <p>For example, if you have 100 repairs and set this to 10%, the system will monitor the top 10 highest-scored repairs.</p>
              <p>If any of those top repairs are <em>not</em> included in Year 1's assigned trips, we display a warning list so you can review potential deferrals of high-priority work.</p>
              <ul style="margin:0.5em 0 0 1.5em;">
                <li><strong>10%:</strong> Monitor only the highest-priority repairs</li>
                <li><strong>25%:</strong> Balanced approach for moderate oversight</li>
                <li><strong>50%+:</strong> Broader monitoring (may generate many warnings)</li>
              </ul>
              <p style="margin-top:0.5em; font-size:0.9em; color:#666;"><strong>Tip:</strong> Start with 10-20% to focus on truly critical repairs, then adjust based on your planning needs.</p>
            `;
          }
        }

        // Then show modal
        opt3TopInfoModal.style.display = 'flex';
      };

      const closeInfo = () => (opt3TopInfoModal.style.display = 'none');
      opt3TopInfoBtn.addEventListener('click', openInfo);
      if (closeOpt3TopInfoModal) closeOpt3TopInfoModal.addEventListener('click', closeInfo);
      if (okOpt3TopInfoBtn) okOpt3TopInfoBtn.addEventListener('click', closeInfo);
      opt3TopInfoModal.addEventListener('click', (e) => { if (e.target === opt3TopInfoModal) closeInfo(); });
    }

    if (runOpt3Btn) {
      runOpt3Btn.addEventListener('click', async () => {

        // Route to appropriate handler based on workflow mode
        if (workflowMode === 'repair-first-dynamic') {
          await runOpt3RepairFirstDynamic();
          return;
        } else if (workflowMode === 'repair-first') {
          await runOpt3RepairFirst();
          return;
        }

        // Trip-First mode (original logic)
        if (!window._tripsData) {
          opt3Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 2 first.</div>';
          return;
        }

        const fixedParams = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
          .map(row => extractParamData(row));

        opt3Results.innerHTML = '<div class="opt-note">Assigning trips to years...</div>';

        const topPercent = Math.min(100, Math.max(0, parseFloat(opt3TopPercentInput?.value ?? '0') || 0));

        const result = await window.electronAPI.assignTripsToYears({
          trips: window._tripsData,
          fixed_parameters: fixedParams,
          top_percent: topPercent
        });

        if (!result.success) {
          opt3Results.innerHTML = `<div class="opt-error">${result.message || 'Year assignment failed'}</div>`;
          return;
        }

        // cache for later interactive updates
        window._opt3Result = result;
        // station data map for nested rendering + add-to-year
        const stationList = await getScopedStationData();
        window._stationDataMap = {};
        (stationList || []).forEach(station => {
          const stationId = station.station_id || station['Station ID'] || station.id;
          if (stationId) window._stationDataMap[stationId] = station;
        });
        renderOpt3Results(window._opt3Result);
      });
    }

    // NEW: Repair-First Opt3 - Assign individual repairs to years
    async function runOpt3RepairFirst() {
      if (!Array.isArray(window._scoredRepairs) || window._scoredRepairs.length === 0) {
        opt3Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 1 first.</div>';
        return;
      }

      const fixedParams = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
        .map(row => extractParamData(row));

      opt3Results.innerHTML = '<div class="opt-note">Assigning repairs to years by priority...</div>';

      // top_percent is not used in repair-first mode (no warnings)
      // We can pass 0 or just omit it since the backend doesn't use it for this mode
      const topPercent = 0;

      // Get station data for constraint checks
      const stationList = await getScopedStationData();
      const stationDataMap = {};
      (stationList || []).forEach(station => {
        const stationId = station.station_id || station['Station ID'] || station.id;
        if (stationId) stationDataMap[stationId] = station;
      });

      const result = await window.electronAPI.assignRepairsToYearsIndividually({
        scored_repairs: window._scoredRepairs,
        station_data: stationDataMap,
        fixed_parameters: fixedParams,
        top_percent: topPercent
      });

      if (!result.success) {
        opt3Results.innerHTML = `<div class="opt-error">${result.message || 'Year assignment failed'}</div>`;
        return;
      }

      // Cache for Opt2
      window._opt3Result = result;
      window._stationDataMap = stationDataMap;
     
      renderOpt3RepairFirstResults(result);
    }

    // NEW: Repair-First Dynamic Opt3 - Smart assignment with deadlines
    async function runOpt3RepairFirstDynamic() {
      if (!Array.isArray(window._scoredRepairs) || window._scoredRepairs.length === 0) {
        opt3Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 1 first.</div>';
        return;
      }

      // Collect deadline inputs from Opt 1 table
      const deadlines = collectDeadlinesFromOpt1Table();
      
      // Attach deadlines to scored repairs
      window._scoredRepairs.forEach(sr => {
        const key = getRepairKey(sr);
        sr.must_finish_by = deadlines[key] || null;
      });

      const fixedParams = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
        .map(row => extractParamData(row));

      opt3Results.innerHTML = '<div class="opt-note">Intelligently assigning repairs to years...</div>';

      // Calculate look-ahead limit from percentage
      const lookAheadPercent = Math.min(100, Math.max(0, parseFloat(opt3TopPercentInput?.value ?? '100') || 100));
      const totalRepairs = window._scoredRepairs.length;
      const lookAheadLimit = Math.ceil((lookAheadPercent / 100) * totalRepairs);
      
      console.log(`[Opt3 Dynamic] Look-ahead: ${lookAheadPercent}% of ${totalRepairs} = ${lookAheadLimit} repairs`);

      // Get station data for constraint checks
      const stationList = await getScopedStationData();
      const stationDataMap = {};
      (stationList || []).forEach(station => {
        const stationId = station.station_id || station['Station ID'] || station.id;
        if (stationId) stationDataMap[stationId] = station;
      });

      const result = await window.electronAPI.assignRepairsToYearsWithDeadlines({
        scored_repairs: window._scoredRepairs,
        station_data: stationDataMap,
        fixed_parameters: fixedParams,
        look_ahead_limit: lookAheadLimit
      });

      if (!result.success) {
        opt3Results.innerHTML = `<div class="opt-error">${result.message || 'Year assignment failed'}</div>`;
        return;
      }

      // Cache for Opt2
      window._opt3Result = result;
      window._stationDataMap = stationDataMap;
     
      renderOpt3RepairFirstResults(result);
    }

    function renderOpt3RepairFirstResults(result) {
      opt3Results.innerHTML = '';
      
      // Add TEST mode banner if active
      if (window._testMode && window._testRepairs) {
        const testBanner = document.createElement('div');
        testBanner.style.cssText = 'padding:1em; margin-bottom:1em; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; color:#856404;';
        testBanner.innerHTML = `<strong>⚠️ TEST MODE ACTIVE</strong> - Using TEST repairs for individual assignment`;
        opt3Results.appendChild(testBanner);
      }

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 3: Repair Assignment by Priority</div>
        <div class="opt-summary">
          <span class="chip">Total Years: ${result.total_years}</span>
        </div>
        <div class="opt-note" style="margin-top:.5rem;">
          <strong>Note:</strong> Repairs have been assigned individually to years by priority score,
          starting with the highest-scored repairs.
        </div>
      `;
      opt3Results.appendChild(summary);

      const yearKeys = Object.keys(result.assignments).sort();

      yearKeys.forEach(year => {
        const repairs = result.assignments[year] || [];
        
        let totalCost = 0;
        let totalDays = 0;
        repairs.forEach(repair => {
          const cost = _extractRepairCost(repair);
          const days = _tryFloat(repair.days || repair.Days) || 0;
          totalCost += cost;
          totalDays += days;
        });

        // Category-aware year split chips + columns
        const activeCats = detectActiveCategoriesFromRepairs(repairs);
        const splitSources = collectSplitSourcesFromRepairs(repairs, activeCats);
        const splitCols = buildSplitColumns(splitSources, activeCats);
        const totals = computeSplitTotalsForRepairs(repairs, splitCols);
        const splitChips = renderSplitChipsFromTotals(totals, splitCols);

        const yearSection = document.createElement('section');
        yearSection.className = 'opt-trip';
        yearSection.innerHTML = `
          <div class="trip-title">
            <button class="toggle-year" data-year="${year}" aria-label="Expand year">▸</button>
            Year ${year}
          </div>
          <div class="trip-summary">
           <span class="chip">Repairs: ${repairs.length}</span>
            <span class="chip">Total Days: ${totalDays}</span>
            <span class="chip">Total Cost: ${formatCurrency(totalCost)}</span>
            ${splitChips}
          </div>
          <div class="year-details" style="display:none;"></div>
        `;

        const toggleBtn = yearSection.querySelector('.toggle-year');
        const detailsDiv = yearSection.querySelector('.year-details');
        let rendered = false;

        toggleBtn.addEventListener('click', () => {
          const isOpen = detailsDiv.style.display !== 'none';
          if (isOpen) {
            detailsDiv.style.display = 'none';
            toggleBtn.textContent = '▸';
          } else {
            if (!rendered) {
              // Render repair list
              const tableScroll = document.createElement('div');
              tableScroll.className = 'table-scroll';
              const table = document.createElement('table');
              table.className = 'opt-table';
              table.innerHTML = `
                <thead>
                  <tr>
                    <th>Station ID</th>
                    <th>Site</th>
                    <th>Repair Name</th>
                    <th>Cost</th>
                    <th>Days</th>
                    <th>Category</th>
                    ${(splitCols || []).map(c => `<th>${c.label}</th>`).join('')}
                  </tr>
                </thead>
                <tbody></tbody>
              `;
              
              const tbody = table.querySelector('tbody');
              repairs.forEach(repair => {
                const cost = _extractRepairCost(repair);
                const days = _tryFloat(repair.days || repair.Days) || 0;
                const station = window._stationDataMap?.[repair.station_id] || {};
                const site = getSiteNameForStationOrRepair(station);
                const { category, map } = getSplitMapForRepairCategory(repair);
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                  <td class="txt">${repair.station_id || ''}</td>
                  <td class="txt">${site || ''}</td>
                  <td class="txt">${repair.name || repair.repair_name || ''}</td>
                  <td class="txt">${formatCurrency(cost)}</td>
                  <td class="txt">${String(days)}</td>
                  <td class="txt">${category || ''}</td>
                  ${(splitCols || []).map(col => {
                    if (col.cat !== category) return `<td class="txt"></td>`;
                    const frac = Number(map[col.srcCanon] || 0);
                    const val = frac > 0 ? cost * frac : 0;
                    return `<td class="txt">${val ? formatCurrency(val) : ''}</td>`;
                  }).join('')}
                `;
                tbody.appendChild(tr);
              });
              
              tableScroll.appendChild(table);
              detailsDiv.appendChild(tableScroll);
              rendered = true;
            }
            detailsDiv.style.display = '';
            toggleBtn.textContent = '▾';
          }
        });

        opt3Results.appendChild(yearSection);
      });
    }

    // ───────────────────────── helpers (Opt-3 UI) ─────────────────────────
    const _canon = (s) => String(s ?? '').trim().toLowerCase();
    const _tryFloat = (s) => {
      const v = Number(String(s ?? '').replace(/,/g, '').trim());
      return Number.isFinite(v) ? v : 0;
    };
    const _normalizeUnit = (u) => {
      const s = _canon(u);
      if (!s) return 'hours';
      if (/^(h|hr|hrs|hour|hours)$/.test(s)) return 'hours';
      if (/^(d|day|days)$/.test(s)) return 'days';
      if (/^(w|wk|wks|week|weeks)$/.test(s)) return 'weeks';
      if (/^(mo|mon|mons|month|months)$/.test(s)) return 'months';
      if (/^(y|yr|yrs|year|years)$/.test(s)) return 'years';
      return 'hours';
    };
    const _toHours = (num, unit) => {
      switch (_normalizeUnit(unit)) {
        case 'hours': return num;
        case 'days': return num * 24;
        case 'weeks': return num * 24 * 7;
        case 'months': return num * 24 * 30;
        case 'years': return num * 24 * 365;
        default: return num;
      }
    };
    const _fromHours = (hrs, unit) => {
      switch (_normalizeUnit(unit)) {
        case 'hours': return hrs;
        case 'days': return hrs / 24;
        case 'weeks': return hrs / (24 * 7);
        case 'months': return hrs / (24 * 30);
        case 'years': return hrs / (24 * 365);
        default: return hrs;
      }
    };
    function formatCurrency(n) {
      const num = Number(n || 0);
      if (!isFinite(num)) return '$0';
      return '$' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    // ─────────────────────────────────────────────────────────────
    // CATEGORY + SPLIT (category-aware) helpers
    // Dynamic categories + {Split} - {Category} formatting
    // ─────────────────────────────────────────────────────────────
    const CATEGORY_FIELDS = ['O&M', 'Capital', 'Decommission'];

    function normalizeCategory(raw) {
      const s = String(raw ?? '').trim().toLowerCase();
      if (!s) return '';
      if (s === 'o&m' || s === 'o & m' || s === 'om' || s.includes('o&m')) return 'O&M';
      if (s.includes('capital')) return 'Capital';
      if (s.includes('decommission') || s.includes('decom')) return 'Decommission';
      const hit = CATEGORY_FIELDS.find(c => _canon(c) === _canon(raw));
      return hit || String(raw).trim();
    }

    function parseSplitSpecToMap(spec) {
      if (!spec) return {};
      const out = Object.create(null);
      String(spec).split(/\s*-\s*/).forEach(seg => {
        const m = String(seg).match(/(-?\d+(?:\.\d+)?)%\s*([A-Za-z0-9()[\]\/\-\s]+)$/);
        if (!m) return;
        const pct = Number(m[1]);
        const src = _canon(m[2] || '');
        if (Number.isFinite(pct) && src) out[src] = pct / 100;
      });
      return out;
    }

    function getRepairCategory(repair) {
      const station = window._stationDataMap?.[repair?.station_id] || {};
      const raw =
        findFieldAnywhere(repair, station, 'Category') ??
        findFieldAnywhere(repair, station, 'Funding Type') ??
        '';
      const cat = normalizeCategory(raw);
      if (cat) return cat;
      // Fallback inference by presence of category columns
      for (const c of CATEGORY_FIELDS) {
        const spec = (repair && (repair[c] ?? repair[c.toLowerCase()])) || station?.[c];
        if (spec) return c;
      }
      return '';
    }

    function getSplitMapForRepairCategory(repair) {
      const station = window._stationDataMap?.[repair?.station_id] || {};
      const category = getRepairCategory(repair);
      if (!category) return { category: '', map: {} };
      const spec =
        (repair && (repair[category] ?? repair[category.toLowerCase()])) ??
        station?.[category] ??
        null;
      return { category, map: parseSplitSpecToMap(spec) };
    }

    function detectActiveCategoriesFromRepairs(repairs) {
      const set = new Set();
      (repairs || []).forEach(r => {
        const c = getRepairCategory(r);
        if (c) set.add(c);
      });
      return CATEGORY_FIELDS.filter(c => set.has(c));
    }

    function collectSplitSourcesFromRepairs(repairs, activeCategories) {
      const set = new Set();
      (repairs || []).forEach(r => {
        const station = window._stationDataMap?.[r?.station_id] || {};
        const cat = getRepairCategory(r);
        if (!cat) return;
        if (activeCategories && !activeCategories.includes(cat)) return;
        const spec =
          (r && (r[cat] ?? r[cat.toLowerCase()])) ??
          station?.[cat] ??
          null;
        Object.keys(parseSplitSpecToMap(spec)).forEach(srcCanon => set.add(srcCanon));
      });
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    }

    function buildSplitColumns(splitSourcesCanon, activeCategories) {
      const cols = [];
      (splitSourcesCanon || []).forEach(srcCanon => {
        (activeCategories || []).forEach(cat => {
          cols.push({
            key: `${srcCanon}__${_canon(cat)}`,
            srcCanon,
            cat,
            label: `${srcCanon.toUpperCase()} - ${cat}`
          });
        });
      });
      return cols;
    }

    function computeSplitTotalsForRepairs(repairs, splitCols) {
      const totals = Object.create(null);
      (splitCols || []).forEach(c => totals[c.key] = 0);

      (repairs || []).forEach(r => {
        const station = window._stationDataMap?.[r?.station_id] || {};
        const cost = _tryFloat(r.cost ?? r.Cost ?? findFieldAnywhere(r, station, 'Cost')) || 0;
        if (!cost) return;
        const { category, map } = getSplitMapForRepairCategory(r);
        if (!category) return;
        (splitCols || []).forEach(col => {
          if (col.cat !== category) return;
          const frac = Number(map[col.srcCanon] || 0);
          if (frac > 0) totals[col.key] += cost * frac;
        });
      });
      return totals;
    }

    function renderSplitChipsFromTotals(totals, splitCols) {
      const parts = [];
      (splitCols || []).forEach(col => {
        const v = Number(totals?.[col.key] || 0);
        if (v > 0) parts.push(`<span class="chip">${col.label}: ${formatCurrency(v)}</span>`);
      });
      return parts.join('');
    }

    function getSiteNameForStationOrRepair(obj) {
      const st = obj || {};
      return (
        st.site_name ||
        st['Site'] ||
        st['Site Name'] ||
        st['Station Name'] ||
        st['Station'] ||
        ''
      );
    }

    function findFieldAnywhere(repair, station, fieldName) {
      const canon = _canon(fieldName);
      for (const [k, v] of Object.entries(repair || {})) {
        if (_canon(k) === canon) return v;
      }
      for (const [k, v] of Object.entries(station || {})) {
        if (_canon(k) === canon) return v;
      }
      return null;
    }
    function getSplitMapFromRepair(repair) {
      const station = window._stationDataMap?.[repair.station_id] || {};
      const get = (obj, key) => {
        if (!obj) return undefined;
        if (key in obj) return obj[key];
        const found = Object.keys(obj).find(k => _canon(k) === _canon(key));
        return found ? obj[found] : undefined;
      };
      // Merge O&M, Capital, Decommission splits (repair-level + station-level)
      const specs = [
        get(repair, 'O&M') ?? get(station, 'O&M'),
        get(repair, 'Capital') ?? get(station, 'Capital'),
        get(repair, 'Decommission') ?? get(station, 'Decommission'),
      ].filter(Boolean);
      if (!specs.length) return {};
      const out = {};
      for (const spec of specs) {
        String(spec).split(/\s*-\s*/).forEach(seg => {
          const m = String(seg).match(/(-?\d+(?:\.\d+)?)%\s*([A-Za-z0-9()[\]\/\-\s]+)$/);
          if (!m) return;
          const pct = Number(m[1]);
          const src = _canon(m[2] || '');
          if (Number.isFinite(pct) && src) out[src] = pct / 100;
        });
      }
      return out;
    }

    // apply in-memory mutation: add a standalone repair to a year, regrouping
    function addStandaloneRepairToYear(targetYear, sr, result) {
      const year = String(targetYear);
      const key = sr && (Number.isInteger(sr.row_index) ? `idx:${sr.row_index}` :
                   `sid:${sr?.original_repair?.station_id ?? ''}::name:${sr?.original_repair?.name ?? sr?.original_repair?.repair_name ?? ''}`);
      if (!key) return;
      const feasible = (result.feasible_years?.[key] || []).includes(year);
      if (!feasible) return; // guard

      // find/create trip by city_of_travel × access_type
      const tl = sr._city_of_travel || '';
      const at = sr._access_type || '';
      // avoid inline assignment to keep const bindings immutable
      if (!result.assignments[year]) {
        result.assignments[year] = [];
      }
      let trips = result.assignments[year];
      let trip = trips.find(t => t.city_of_travel === tl && t.access_type === at);
      if (!trip) {
        trip = {
          city_of_travel: tl,
          access_type: at,
          total_days: 0,
          total_cost: 0,
          total_split_costs: {},
          repairs: [],
          stations: [],
          priority_mode: result.assignments[Object.keys(result.assignments)[0]]?.[0]?.priority_mode || 'tripmean',
          priority_metrics: { mean: 0, max: 0, median: 0, scores: [] },
          priority_score: 0
        };
        trips.push(trip);
      }

      // station container
      const r = sr.original_repair;
      const sid = r.station_id;
      const stationRow = window._stationDataMap?.[sid] || {};
      let st = trip.stations.find(s => s.station_id === sid);
      if (!st) {
        st = {
          ...stationRow,
          station_id: sid,
          site_name: findFieldAnywhere(r, stationRow, 'Station Name') || stationRow['Station Name'] || '',
          city_of_travel: findFieldAnywhere(r, stationRow, 'City of Travel') || '',
          time_to_site: findFieldAnywhere(r, stationRow, 'Time to Site (hr)') || '',
          repairs: [],
          total_days: 0,
          total_cost: 0,
          repair_count: 0
        };
        trip.stations.push(st);
      }
      // push repair
      st.repairs.push(r);
      st.repair_count += 1;
      const days = _tryFloat(r.days || r.Days) || 0;
      const cost = _tryFloat(r.cost || findFieldAnywhere(r, stationRow, 'Cost')) || 0;
      st.total_days += days;
      st.total_cost += cost;
      trip.total_days += days;
      trip.total_cost += cost;
      // split totals
      const smap = getSplitMapFromRepair(r);
      for (const [src, mul] of Object.entries(smap)) {
        if (!Number.isFinite(mul)) continue;
        const add = cost * mul;
        if (add > 0) trip.total_split_costs[src] = (trip.total_split_costs[src] || 0) + add;
      }
     // add to trip repair list
      trip.repairs.push(sr);
      // recompute trip metrics
      const scores = (trip.repairs || []).map(x => Number(x.score) || 0).sort((a,b)=>b-a);
      const mean = scores.length ? (scores.reduce((a,b)=>a+b,0) / scores.length) : 0;
      const max  = scores[0] || 0;
      const median = scores.length ? (scores.length % 2 ? scores[(scores.length-1)/2]
                                       : (scores[scores.length/2 - 1] + scores[scores.length/2]) / 2) : 0;
      trip.priority_metrics = { mean, max, median, scores };
      trip.priority_score = (trip.priority_mode === 'tripmax') ? max : mean;

      // update year summary
      // ensure a mutable year summary object (no inline assignment in const init)
      if (!result.year_summaries[year]) {
        result.year_summaries[year] = { total_cost: 0, total_days: 0, total_split_costs: {} };
      }
      let ysum = result.year_summaries[year];
      ysum.total_cost += cost;
      ysum.total_days += days;
      for (const [src, v] of Object.entries(smap)) {
        const add = cost * (Number(v) || 0);
        if (add > 0) ysum.total_split_costs[src] = (ysum.total_split_costs[src] || 0) + add;
      }

      // update constraints_state (cumulative only)
      const usage = result.per_repair_usage?.[key] || { monetary:{}, temporal:{} };
      // make sure constraints_state for this year exists before mutation
      if (!result.constraints_state[year]) {
        result.constraints_state[year] = { budgets: {}, temporal: {} };
      }
      const cs = result.constraints_state[year];
      if (cs) {
        for (const [k, v] of Object.entries(cs.budgets || {})) {
          if (!v.cumulative) continue;
          const need = Number(usage.monetary?.[k] || 0);
          v.used += need; v.remaining = Math.max(0, (v.total || 0) - (v.used || 0));
        }
        for (const [k, v] of Object.entries(cs.temporal || {})) {
          if (!v.cumulative) continue;
          const need = Number(usage.temporal?.[k] || 0);
          v.used += need; v.remaining = Math.max(0, (v.total || 0) - (v.used || 0));
        }
      }
      // mark as assigned to this year
      const alias = `sid:${r.station_id ?? ''}::name:${r.name ?? r.repair_name ?? ''}`;
      result.assigned_keys_by_year[year] = Array.from(
        new Set([...(result.assigned_keys_by_year[year] || []), key, alias])
      );
      // remove this year from feasible for both primary and alias keys
      result.feasible_years[key] = (result.feasible_years[key] || []).filter(y => y !== year);
      result.feasible_years[alias] = (result.feasible_years[alias] || []).filter(y => y !== year);
      // tighten feasibility for other repairs due to cumulative capacity
      for (const [rk, yrs] of Object.entries(result.feasible_years || {})) {
        if (!Array.isArray(yrs) || !yrs.includes(year)) continue;
        const u = result.per_repair_usage?.[rk] || { monetary:{}, temporal:{} };
        const cs2 = result.constraints_state?.[year];
        let stillOk = true;
        if (cs2) {
          for (const [k, v] of Object.entries(cs2.budgets || {})) {
            if (!v.cumulative) continue;
            if ((Number(u.monetary?.[k] || 0)) > v.remaining) { stillOk = false; break; }
          }
          if (stillOk) {
            for (const [k, v] of Object.entries(cs2.temporal || {})) {
              if (!v.cumulative) continue;
              if ((Number(u.temporal?.[k] || 0)) > v.remaining) { stillOk = false; break; }
            }
          }
        }
        if (!stillOk) result.feasible_years[rk] = yrs.filter(y => y !== year);
      }

      // ── remove from Warning table immediately ───────────────────────────
      // When a repair is manually added to any year, prune it from the
      // "Top-X% not in Year 1" warnings list so the UI updates instantly.
      if (result.warnings && Array.isArray(result.warnings.missing_in_year1)) {
        const sidNow = r.station_id ?? '';
        const nameNow = r.name ?? r.repair_name ?? '';
        result.warnings.missing_in_year1 = result.warnings.missing_in_year1.filter(
          w => (w.station_id ?? '') !== sidNow || (w.repair_name ?? '') !== nameNow
        );
      }

    }

    // Optimized station table rendering with lazy repair expansion
    function renderStationsTable(container, trip, splitCols/*, useVirtual = false*/) {
      {
        // Regular table for smaller datasets, but still with lazy repair expansion
        const tableScroll = document.createElement('div');
        tableScroll.className = 'table-scroll';

        const stTable = document.createElement('table');
        stTable.className = 'opt-table nested-table';
        stTable.innerHTML = `
          <thead>
            <tr>
              <th></th>
              <th>Station ID</th><th>Site</th><th>City</th><th>Time to Site (hr)</th>
              <th>Repairs</th><th>Station Days</th>
              ${(splitCols || []).map(c => `<th>${c.label}</th>`).join('')}
          </thead>
          <tbody></tbody>
        `;
        const stBody = stTable.querySelector('tbody');
      
        // Limit initial station rendering for performance
        const stationsToRender = trip.stations.slice(0, 50);
        let moreStations = trip.stations.length > 50;
        
        stationsToRender.forEach(st => {
          const sTr = document.createElement('tr');
          sTr.className = 'tr-station';
          
          const stRepairs = (st.repairs || []);
          const stTotals = computeSplitTotalsForRepairs(stRepairs, splitCols);

          sTr.innerHTML = `
            <td><button class="toggle" aria-label="Expand station">▸</button></td>
            <td class="txt">${st.station_id}</td>
            <td class="txt">${st.site_name || ''}</td>
            <td class="txt">${st.city_of_travel || ''}</td>
            <td class="txt">${st.time_to_site || ''}</td>
            <td class="txt">${String(st.repair_count)}</td>
            <td class="txt">${String(st.total_days)}</td>
            ${(splitCols || []).map(c => {
              const val = Number(stTotals[c.key] || 0);
              return `<td class="txt">${val ? formatCurrency(val) : ''}</td>`;
            }).join('')}
          `;
          stBody.appendChild(sTr);

          // Nested repairs - defer rendering
          const rNestRow = document.createElement('tr');
          const rCell = document.createElement('td');
          const stationColCount = 7 + (splitCols || []).length;
          rCell.colSpan = stationColCount;
          const repairsWrap = document.createElement('div');
          repairsWrap.style.display = 'none';
          rCell.appendChild(repairsWrap);
          rNestRow.appendChild(rCell);
          stBody.appendChild(rNestRow);
        
          // Station toggle - only render repairs when needed
          sTr.querySelector('.toggle')?.addEventListener('click', () => {
            const open = repairsWrap.style.display !== 'none';
          
            if (open) {
              repairsWrap.style.display = 'none';
              sTr.querySelector('.toggle').textContent = '▸';
            } else {
              // Only render repairs table on first open
              if (repairsWrap.children.length === 0 && st.repairs.length <= 50) {
                const repairScroll = document.createElement('div');
                repairScroll.className = 'table-scroll';
                const rTable = document.createElement('table');
                rTable.className = 'opt-table nested-table deepest';
                rTable.innerHTML = `
                  <thead>
                    <tr>
                      <th>Repair</th><th>Repair Days</th><th>Cost</th><th>Category</th>
                      ${(splitCols || []).map(c => `<th>${c.label}</th>`).join('')}
                    </tr>
                  </thead>
                  <tbody></tbody>
                `;
                const rBody = rTable.querySelector('tbody');
             
                (st.repairs || []).forEach(rp => {
                  const d = _tryFloat(rp.days || rp.Days) || 0;
                  const cst = _tryFloat(rp.cost || findFieldAnywhere(rp, window._stationDataMap?.[rp.station_id], 'Cost')) || 0;
                  const { category, map } = getSplitMapForRepairCategory(rp);                  
                  const rr = document.createElement('tr');
                  rr.innerHTML = `
                    <td class="txt">${rp.name || rp.repair_name || ''}</td>
                    <td class="txt">${String(d)}</td>
                    <td class="txt">${formatCurrency(cst)}</td>
                    <td class="txt">${category || ''}</td>
                    ${(splitCols || []).map(col => {
                      if (col.cat !== category) return `<td class="txt"></td>`;
                      const frac = Number(map[col.srcCanon] || 0);
                      const val = frac > 0 ? (cst * frac) : 0;
                      return `<td class="txt">${val ? formatCurrency(val) : ''}</td>`;
                    }).join('')}
                  `;
                  rBody.appendChild(rr);
                });
              
                repairScroll.appendChild(rTable);
                repairsWrap.appendChild(repairScroll);
              } else if (st.repairs.length > 50) {
                repairsWrap.innerHTML = `<div style="padding: 1em; color: #666;">Too many repairs (${st.repairs.length}) to display. Consider filtering.</div>`;
              }
              repairsWrap.style.display = '';
              sTr.querySelector('.toggle').textContent = '▾';

            }
          });
        });

        if (moreStations) {
          const loadMore = document.createElement('tr');
          loadMore.innerHTML = `<td colspan="${7 + (splitCols || []).length}" style="text-align:center; padding:1em;">
            <button class="btn" onclick="this.closest('tbody').innerHTML=''; renderStationsTable(this.closest('.nested-wrap'), trip, splitCols, true)">
              Load all ${trip.stations.length} stations (may be slow)
            </button>
          </td>`;
          stBody.appendChild(loadMore);
        }

        tableScroll.appendChild(stTable);
        container.appendChild(tableScroll);
      }
    }

    function renderOpt3Results(result) {
      opt3Results.innerHTML = '';

      // Add TEST mode banner if active
      if (window._testMode && window._testRepairs) {
        const testBanner = document.createElement('div');
        testBanner.style.cssText = 'padding:1em; margin-bottom:1em; background:#fff3cd; border:1px solid #ffc107; border-radius:6px; color:#856404;';
        testBanner.innerHTML = `<strong>⚠️ TEST MODE ACTIVE</strong> - Constraints pull values from TEST repairs only (no station data)`;
        opt3Results.appendChild(testBanner);
      }

      // Columns available for the WARNING table (monetary & temporal only).
      // Hoist this so it's always in scope.
      const constraintCols = Array.isArray(result.constraint_columns)
        ? result.constraint_columns.filter(c => c && (c.type === 'monetary' || c.type === 'temporal'))
        : [];

      // Helper: find which year a repair (by key) is already scheduled in
      function findScheduledYearForKey(key) {
        const yearsSorted = Object.keys(result.assigned_keys_by_year || {})
          .map(y => parseInt(y, 10))
          .filter(Number.isFinite)
          .sort((a, b) => a - b);
        for (const y of yearsSorted) {
          const list = result.assigned_keys_by_year[String(y)] || [];
          if (list.includes(key)) return String(y);
        }
        return '';
      }
    
      // Collect ALL split keys present across the year's assigned trips,
      // scanning stations -> repairs (not tied to fixed parameters).

      // Warnings block: high-priority repairs missing from Year 1
      if (result.warnings && result.warnings.missing_in_year1 && result.warnings.missing_in_year1.length) {
        const w = result.warnings;
        const warnBox = document.createElement('div');
        warnBox.className = 'callout-warn';

        // derive the earliest assigned calendar year for display (e.g., 2025)
        const assignedYearsSorted = Object.keys(result.assignments || {})
          .map(y => parseInt(y, 10))
          .filter(n => Number.isFinite(n))
          .sort((a, b) => a - b);
        const firstYearLabel = assignedYearsSorted.length ? assignedYearsSorted[0] : 'the first year';
        warnBox.innerHTML = `
          <div style="font-weight:700; margin-bottom:.35rem;">Warning: Top ${w.top_percent}% repairs not in ${firstYearLabel}</div>
          <div style="opacity:.8; margin-bottom:.8rem;">${w.missing_in_year1.length} / ${w.total_top_repairs} high-priority repairs were not included in ${firstYearLabel} assigned trips.</div>
        `;
        // Heads-up table with constraint columns + Add buttons
        const tbl = document.createElement('table');
        // add a specific class so we can scope scroll styles cleanly
        tbl.className = 'opt-table opt3-warn-table';
        const yearHeaders = Object.keys(result.assignments || {}).sort();
        tbl.innerHTML = `
          <thead>
            <tr>
              <th>Station</th><th>Repair</th><th>Score</th><th>Scheduled</th>
              ${constraintCols.map(c => `<th>${c.label}</th>`).join('')}
              <th>Add to Year</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        // wrap in a scroll container so wide content doesn't overflow the screen
        const scrollWrap = document.createElement('div');
        scrollWrap.className = 'table-scroll opt3-warn-scroll';
        scrollWrap.setAttribute('aria-label', 'Top repairs not in first year — scrollable');
        scrollWrap.appendChild(tbl);
        const tb = tbl.querySelector('tbody');
        w.missing_in_year1.slice(0, 200).forEach(m => {
          const sr = (window._opt3Result?.assignments && (() => {
            // we don't keep a direct pointer; rebuild a pseudo scored repair object for usage & feasibility lookups
            return null;
          })()) || null;
          // Use the preserved canonical key for consistent lookups (critical for TEST mode)
          const key = m._key || `sid:${m.station_id ?? ''}::name:${m.repair_name ?? ''}`;
          const usage = result.per_repair_usage?.[key] || { monetary:{}, temporal:{} };
          const scheduled = findScheduledYearForKey(key);
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="txt">${m.station_id || ''}</td>
            <td class="txt">${m.repair_name || ''}</td>
            <td class="txt">${String(Number(m.score || 0).toFixed(2))}</td>
            <td class="txt">${scheduled || '—'}</td>
            ${constraintCols.map(c => {
              if (c.type === 'monetary') {
                // usage is stored by unique key from backend (includes split source when present)
                return `<td class="txt">$${Number(usage.monetary?.[c.key] || 0).toLocaleString()}</td>`;
              }
              // temporal usage is stored in HOURS by c.key
              const hrs = Number(usage.temporal?.[c.key] || 0);
              const disp = _fromHours(hrs, c.unit);
              return `<td class="txt">${String(disp.toFixed(2))} ${c.unit}</td>`;
            }).join('')}
            <td class="add-buttons" data-key="${key}"></td>
          `;
          tb.appendChild(tr);
          // add buttons only for feasible years
          const cell = tr.querySelector('.add-buttons');
          const feas = result.feasible_years?.[key] || [];
          feas.sort().forEach(y => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-add';
            btn.textContent = `Add to Year ${y}`;
            btn.addEventListener('click', () => {
              // locate the original scored repair object in any trip
              let found = null;
              for (const t of (window._tripsData || [])) {
                const f = (t.repairs || []).find(r => (r.original_repair?.station_id ?? '') === (m.station_id ?? '') &&
                                                     ((r.original_repair?.name ?? r.original_repair?.repair_name ?? '') === (m.repair_name ?? '')));
                if (f) { found = f; break; }
              }
              if (!found) return;
              addStandaloneRepairToYear(y, found, window._opt3Result);
              renderOpt3Results(window._opt3Result);
            });
            cell.appendChild(btn);
          });
        });
        // append the scrollable wrapper (not the raw table)
        warnBox.appendChild(scrollWrap);
        opt3Results.appendChild(warnBox);
      }

      // ────────────────────────────────────────────────────────────────────
      // Helper: virtualized trips table (per year) — NO nested content
      // ───────────────────────────────────────────────────────────────────
      function createVirtualTripsTable(trips, splitCols, detailsHost) {
        const wrap = document.createElement('div');
        wrap.className = 'virtual-scroll-container trips';

        // ─────────────────────────────────────────────────────────────
        // FIX: Prevent horizontal "condensing" in Opt-3 Trip-First trips table
        // by giving header/body tables explicit matching column widths.
        // This makes the table naturally wider so .table-scroll can scroll
        // horizontally (same behavior as station tables).
        // ─────────────────────────────────────────────────────────────
        const baseWidths = [
          '80px',   // Priority
          '200px',  // City of Travel
          '170px',  // Access Type
          '120px',  // Cost
          '110px',  // Trip Days
          '100px',  // Stations
          '110px'   // Score
        ];
        const splitWidth = '170px';
        const colgroupHtml = `
          <colgroup>
            ${baseWidths.map(w => `<col style="width:${w};">`).join('')}
            ${(splitCols || []).map(() => `<col style="width:${splitWidth};">`).join('')}
          </colgroup>
        `;

        // Sticky header in its own table
        const headerTable = document.createElement('table');
        headerTable.className = 'opt-table';
        headerTable.style.tableLayout = 'fixed';
        headerTable.innerHTML = `
        ${colgroupHtml}
          <thead>
            <tr>
              <th>Priority</th>
              <th>City of Travel</th>
              <th>Access Type</th>
              <th>Cost</th>
              <th>Trip Days</th>
              <th>Stations</th>
              <th>Score</th>
              ${(splitCols || []).map(c => `<th>${c.label}</th>`).join('')}
            </tr>
          </thead>
        `;
        wrap.appendChild(headerTable);

        // Viewport + spacer + body table
        const viewport = document.createElement('div');
        viewport.className = 'virtual-scroll-viewport';
        const spacer = document.createElement('div');
        spacer.className = 'virtual-scroll-spacer';
        wrap.appendChild(viewport);
        wrap.appendChild(spacer);

        const bodyTable = document.createElement('table');
        bodyTable.className = 'opt-table';
        bodyTable.style.tableLayout = 'fixed';
        bodyTable.innerHTML = `
          ${colgroupHtml}
          <tbody></tbody>
        `;
        viewport.appendChild(bodyTable);
        const tbody = bodyTable.querySelector('tbody');

        const items = trips || [];
        const ROW_HEIGHT = 40;  // keep in sync with table cell padding
        const OVERSCAN   = 6;
        const totalRows = items.length;
        spacer.style.height = (totalRows * ROW_HEIGHT) + 'px';

        // clip + tooltip on overflow
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
        const cell = (v) => {
          const t = esc(v);
          return `<span class="cell-clip" data-full="${t}">${t}</span>`;
        };
        const maybeApplyOverflowTitles = (root) => {
          root.querySelectorAll('.cell-clip').forEach(el => {
            if (el.scrollWidth > el.clientWidth) {
              el.title = el.dataset.full || el.textContent;
              el.classList.add('truncated');
            } else {
              el.removeAttribute('title');
              el.classList.remove('truncated');
            }
          });
        };

        function rowHtml(trip, idx) {
          let cells = `
            <td class="txt">${cell(String(idx + 1))}</td>
            <td class="txt">${cell(trip.city_of_travel || '')}</td>
            <td class="txt">${cell(trip.access_type || '')}</td>
            <td class="txt">${cell(formatCurrency(trip.total_cost || 0))}</td>
            <td class="txt">${cell(String(trip.total_days || 0))}</td>
            <td class="txt">${cell(String((trip.stations || []).length))}</td>
            <td class="txt">${cell(Number(trip.priority_score || 0).toFixed(2))}</td>
          `;
          const tripRepairs = (trip.stations || []).flatMap(st => (st.repairs || []));
          const totals = computeSplitTotalsForRepairs(tripRepairs, splitCols);
          for (const col of (splitCols || [])) {
            const v = Number(totals[col.key] || 0);
            cells += `<td class="txt">${v ? formatCurrency(v) : ''}</td>`;
          }
          return `<tr>${cells}</tr>`;
        }

        function sizeContainer() {
          const headerH = headerTable.offsetHeight || 40;
          // If fewer than 11 trips, shrink the container to fit rows exactly.
          if (totalRows < 11) {
            // header + rows (≈ ROW_HEIGHT per row) + small border fudge
            const h = headerH + (totalRows * ROW_HEIGHT) + 2;
            wrap.style.height = `${h}px`;
            wrap.style.overflowY = 'hidden';
          } else {
            // Reset to default CSS-managed height for larger lists
            wrap.style.height = '';
            wrap.style.overflowY = 'auto';
          }
        }

        function renderWindow() {
          const containerH = wrap.clientHeight || 600;
          const scrollTop = wrap.scrollTop || 0;
          const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
          const end   = Math.min(totalRows, Math.ceil((scrollTop + containerH) / ROW_HEIGHT) + OVERSCAN);
          const offsetY = start * ROW_HEIGHT + (headerTable.offsetHeight || 0);
          viewport.style.transform = `translateY(${offsetY}px)`;
          let html = '';
          for (let i = start; i < end; i++) html += rowHtml(items[i], i);
          tbody.innerHTML = html;
          requestAnimationFrame(() => maybeApplyOverflowTitles(tbody));

          // Attach click handlers so a selected trip shows its stations/repairs
          // with NORMAL rendering in the provided detailsHost.
          if (detailsHost) {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.forEach((tr, i) => {
              const idx = start + i;
              tr.style.cursor = 'pointer';
              tr.title = 'Click to view trip details';
              tr.onclick = () => {
                // Clear previous details and render the selected trip's stations normally.
                detailsHost.innerHTML = '';
                const trip = items[idx];

                const panel = document.createElement('div');
                panel.className = 'nested-wrap';

                const header = document.createElement('div');
                header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;';
                header.innerHTML = `
                  <strong>Trip ${idx + 1} — ${trip.city_of_travel || ''} • ${trip.access_type || ''}</strong>
                  <button class="btn btn-ghost" aria-label="Close">Close</button>
                `;
                header.querySelector('button').addEventListener('click', () => { detailsHost.innerHTML = ''; });
                panel.appendChild(header);

                const tripRepairs = (trip.stations || []).flatMap(st => (st.repairs || []));
                const cats = detectActiveCategoriesFromRepairs(tripRepairs);
                const srcs = collectSplitSourcesFromRepairs(tripRepairs, cats);
                const tripSplitCols = buildSplitColumns(srcs, cats);
                renderStationsTable(panel, trip, tripSplitCols);
                detailsHost.appendChild(panel);
                try { detailsHost.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
              };
            });
          }
        }

        wrap.addEventListener('scroll', () => requestAnimationFrame(renderWindow), { passive: true });
        window.addEventListener('resize', () => {
          sizeContainer();
          requestAnimationFrame(() => {
            renderWindow();
            maybeApplyOverflowTitles(tbody);
          });
        });
        requestAnimationFrame(() => { sizeContainer(); renderWindow(); });
        return wrap;
      }

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 3: Yearly Assignment</div>
      `;
      opt3Results.appendChild(summary);

      const yearKeys = Object.keys(result.assignments).sort();

      yearKeys.forEach((year) => {
        const trips = result.assignments[year];
        const ysum = (result.year_summaries && result.year_summaries[year]) ? result.year_summaries[year] : { total_cost: 0, total_days: 0, total_split_costs: {} };
        // Category-aware year split chips (dynamic categories)
        const allYearRepairs = (trips || []).flatMap(t => (t.stations || []).flatMap(st => (st.repairs || [])));
        const activeCats = detectActiveCategoriesFromRepairs(allYearRepairs);
        const splitSources = collectSplitSourcesFromRepairs(allYearRepairs, activeCats);
        const yearSplitCols = buildSplitColumns(splitSources, activeCats);
        const totals = computeSplitTotalsForRepairs(allYearRepairs, yearSplitCols);
        const splitChips = renderSplitChipsFromTotals(totals, yearSplitCols);
        
        const cs = result.constraints_state?.[year] || { budgets:{}, temporal:{} };
        const remainChips = [];

        const yearSection = document.createElement('section');
        yearSection.className = 'opt-trip';
        yearSection.innerHTML = `
          <div class="trip-title">
            <button class="toggle-year" data-year="${year}" aria-label="Expand year">▸</button>
            Year ${year}
          </div>
          <div class="trip-summary">
            <span class="chip">Trips: ${trips.length}</span>
            <span class="chip">Total Days: ${ysum.total_days}</span>
            <span class="chip">Total Cost: ${formatCurrency(ysum.total_cost)}</span>
            ${splitChips}
            ${remainChips.join('')}
          </div>
          <div class="year-details" style="display:none;"></div>
        `;

        const toggleBtn = yearSection.querySelector('.toggle-year');
        const detailsDiv = yearSection.querySelector('.year-details');
        let rendered = false;

        toggleBtn.addEventListener('click', () => {
          const isOpen = detailsDiv.style.display !== 'none';
          if (isOpen) {
            detailsDiv.style.display = 'none';
            toggleBtn.textContent = '▸';
          } else {
            if (!rendered) {
              const tripsScroll = document.createElement('div');
              tripsScroll.className = 'table-scroll';
              const tripDetailsPanel = document.createElement('div');
              tripDetailsPanel.className = 'trip-details-panel';
              const vt = createVirtualTripsTable(trips, yearSplitCols, tripDetailsPanel);
              tripsScroll.appendChild(vt);
              detailsDiv.appendChild(tripsScroll);
              detailsDiv.appendChild(tripDetailsPanel);
              rendered = true;
            }
            detailsDiv.style.display = '';
            toggleBtn.textContent = '▾';
          }
        });

        opt3Results.appendChild(yearSection);
      });

    }

    // Initialize
    await loadFixedParameters();
    recalcPercentageTotal();
  }

  // Add CSS for autocomplete
  const style = document.createElement('style');
  style.textContent = `
    .autocomplete-active {
      background-color: DodgerBlue !important;
      color: #ffffff;
    }
    .autocomplete-items div:hover {
      background-color: #e9e9e9;
    }
    /* Emphasis chips for remaining capacity */
    .chip-remaining {
      background: #fff3cd !important;
     border: 1px solid #f0ad4e !important;
      font-weight: 700 !important;
    }
    /* Expand/collapse toggles + nested tables */
    .toggle {
      border: 1px solid #ccc;
      background: #fff;
      border-radius: 4px;
      width: 1.8em; height: 1.8em;
      line-height: 1.6em;
      text-align: center;
      cursor: pointer;
    }
    .nested-wrap { padding: .6rem .4rem; background: #fafafa; border: 1px solid #eee; border-radius: 6px; }
    .nested-table { margin: .4rem 0 .2rem 1.6rem; }
    .nested-table.deepest { margin-left: 3.2rem; }
    .btn.btn-add { padding: .25rem .5rem; border: 1px solid #3c78d8; color:#3c78d8; background:#fff; border-radius:6px; cursor:pointer; }
    .btn.btn-add:hover { background:#f0f6ff; }
    /* Treat numeric-looking data as plain text for alignment */
    td.txt { text-align: left; white-space: nowrap; }
    th { white-space: nowrap; }
    /* ensure any accidentally numeric cells align like text */
    td.num { text-align: left; white-space: nowrap; }
    .split-source-row input { min-width: 10rem; }

    /* Horizontal scrolling for all tables */
    .table-scroll {
      overflow-x: auto;
      overflow-y: visible;
      width: 100%;
      -webkit-overflow-scrolling: touch;
    }
    .table-scroll table {
      min-width: 100%;
      width: max-content;
    }
    .virtual-scroll-container {
      overflow-x: auto !important;
      -webkit-overflow-scrolling: touch;
    }

    /* Optional: ensure virtual trips tables can expand beyond container width */
    .virtual-scroll-container.trips table.opt-table {
      min-width: 100%;
      width: max-content;
    }

  `;
  document.head.appendChild(style);

  window.__openOptimization = showOptimization;
});
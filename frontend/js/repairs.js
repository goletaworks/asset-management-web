// frontend/js/repairs.js
(() => {
  const CATS = ['Capital', 'O&M', 'Decommission'];
  const AT_REQUIRED_MSG = 'Asset Type is required.';

  function fmtCost(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
      catch { return `$${Math.round(v).toLocaleString()}`; }
    }
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  function fmtDate(d) {
    const s = String(d ?? '').trim();
    if (!s) return '—';
    // Expecting ISO YYYY-MM-DD; if not, just show raw
    return s.length === 10 ? s : s;
  }

  async function fetchInto(container, url, targetSelector) {
    const panel = container.querySelector(targetSelector);
    if (!panel) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    panel.innerHTML = await resp.text();
    return panel;
  }

  // entries: array of [item, globalIndex]
  function renderTable(tbody, entries, state) {
    tbody.innerHTML = '';
    entries.forEach(([it, idx]) => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(idx);

      const c0 = document.createElement('td'); c0.textContent = fmtDate(it.date);
      const c1 = document.createElement('td'); c1.textContent = it.name || '—';
      const c2 = document.createElement('td'); c2.textContent = it.severity || '—';
      const c3 = document.createElement('td'); c3.textContent = it.priority || '—';
      const c4 = document.createElement('td'); c4.textContent = fmtCost(it.cost);
      const c5 = document.createElement('td'); c5.textContent = it.category || '—';
      const c6 = document.createElement('td'); c6.textContent = it.days || '—';

      tr.appendChild(c0); tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5);
      tr.appendChild(c6);

      if (state.resolveMode) {
        tr.classList.add('resolve-selectable');
        if (state.selected.has(idx)) tr.classList.add('resolve-selected');
        tr.addEventListener('click', () => {
          if (!state.resolveMode) return;
          if (state.selected.has(idx)) state.selected.delete(idx);
          else state.selected.add(idx);
          tr.classList.toggle('resolve-selected');
          updateDirtyBadge(state);
        });
      }
      tbody.appendChild(tr);
    });
  }

  function updateDirtyBadge(state) {
    const saveBtn = document.querySelector('#repSaveBtn');
    if (!saveBtn) return;
    if (!state.editMode) { saveBtn.classList.remove('btn-warning'); return; }
    if (state.resolveMode && state.selected.size > 0) {
      saveBtn.classList.add('btn-warning');
    } else if (state.dirty) {
      saveBtn.classList.add('btn-warning');
    } else {
      saveBtn.classList.remove('btn-warning');
    }
  }

  function openModal() {
    const m = document.querySelector('#repAddModal');
    if (!stateRef?.editMode) return; // gate on edit mode
    if (!m) return;
    // Ensure an Asset Type field exists in the modal (inject once if missing)
    if (!m.querySelector('#repAssetType')) {
      // Try to place inside a form grid if present
      const grid = m.querySelector('.form-grid') || m.querySelector('.form-row') || m;
      const row = document.createElement('div');
      row.className = 'form-row';
      row.innerHTML = `
        <label>Asset Type *</label>
        <input id="repAssetType" type="text" placeholder="e.g. Cableway">
      `;
      // Insert near top
      if (grid.firstChild) grid.insertBefore(row, grid.firstChild);
      else grid.appendChild(row);
    }
    m.style.display = 'flex';
    // Pre-fill asset type from current station if known
    const atEl = document.querySelector('#repAssetType');
    if (atEl && stateRef?.__currentStationAssetType) {
      atEl.value = stateRef.__currentStationAssetType;
    }
    setTimeout(() => document.querySelector('#repName')?.focus(), 40);
  }
  function closeModal() {
    const m = document.querySelector('#repAddModal');
    if (!m) return;
    m.style.display = 'none';
  }

  function readForm() {
    const assetType = String(document.querySelector('#repAssetType')?.value || '').trim();
    const name = String(document.querySelector('#repName')?.value || '').trim();
    const severity = String(document.querySelector('#repSeverity')?.value || '').trim();
    const priority = String(document.querySelector('#repPriority')?.value || '').trim();
    const costRaw = String(document.querySelector('#repCost')?.value || '').trim();
    const category = String(document.querySelector('#repCategory')?.value || 'Capital');
    const type = String(document.querySelector('#repType')?.value || '').trim() || 'Repair';
    const daysRaw = String(document.querySelector('#repDays')?.value || '').trim();
    let cost = costRaw ? Number(costRaw.replace(/[, ]/g, '')) : '';
    if (!Number.isFinite(cost)) cost = costRaw; // keep as string if not numeric

    let days = daysRaw ? Number(daysRaw.replace(/[, ]/g, '')) : '';
    if (!Number.isFinite(days)) days = daysRaw;

    // date is auto-added on create
    const date = new Date().toISOString().slice(0, 10);
    return { date, assetType, name, severity, priority, cost, category, type, days };
  }

  function validateForm(data) {
    if (!data.assetType) return AT_REQUIRED_MSG;
    if (!data.name) return 'Repair Name is required.';
    if (!CATS.includes(data.category)) return 'Select a valid Category.';
    return null;
  }

  let stateRef = null; // small hack so openModal can gate on edit

  async function initRepairsTab(container, stn) {
    // Inject template into #repairs panel
    const host = await fetchInto(container, 'repairs.html', '#repairs');
    if (!host) return;

    const state = {
      items: [],
      resolveMode: false,
      selected: new Set(), // indices to delete
      dirty: false,
      editMode: false,
    };
    stateRef = state;

    // Remember the station's current asset type for defaulting the modal input
    stateRef.__currentStationAssetType = (stn && stn.asset_type) ? String(stn.asset_type) : '';

    const tablesWrap = host.querySelector('#repTablesWrap');

    const editBtn = host.querySelector('#repEditBtn');
    const actionsBlock = host.querySelector('#repActionsBlock');

    const addBtn = host.querySelector('#repAddBtn');
    const saveBtn = host.querySelector('#repSaveBtn');
    const resolveBtn = host.querySelector('#repResolveBtn');

    const modal = document.querySelector('#repAddModal');
    const cancelBtn = document.querySelector('#repCancel');
    const createBtn = document.querySelector('#repCreate');
    const errorEl = document.querySelector('#repFormError');

    function normTypeLabel(t) {
      const s = String(t || '').trim();
      return s || 'Repair';
    }
    function groupedEntries() {
      const map = new Map(); // typeLabel -> [ [item, idx], ... ]
      state.items.forEach((it, idx) => {
        const key = normTypeLabel(it.type);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push([it, idx]);
      });
      // Ensure we always show an empty "Repair" table if nothing yet
      if (state.items.length === 0 && !map.has('Repair')) map.set('Repair', []);
      return map;
    }
    function renderAll() {
      tablesWrap.innerHTML = '';
      const groups = groupedEntries();
      [...groups.keys()].sort((a,b) => a.localeCompare(b)).forEach(label => {
        const section = document.createElement('div');
        const title = document.createElement('h3');
       title.style.cssText = 'margin:14px 0 6px;';
        title.textContent = `${label} Items`;
        const scroller = document.createElement('div');
        scroller.className = 'table-scroll';
        const table = document.createElement('table');
        table.className = 'data-table';
        table.style.width = '100%';
        table.innerHTML = `
          <thead>
            <tr>
              <th>Date</th>
              <th>${label === 'Repair' ? 'Repair Name' : 'Item'}</th>
              <th>Severity</th>
              <th>Priority</th>
              <th>Cost</th>
              <th>Category</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        scroller.appendChild(table);
        section.appendChild(title);
        section.appendChild(scroller);
        tablesWrap.appendChild(section);
        const tbody = table.querySelector('tbody');
        renderTable(tbody, groups.get(label) || [], state);
      });
    }

    async function load() {
      try {
        const arr = await window.electronAPI.listRepairs(stn.name, stn.station_id);
        state.items = Array.isArray(arr) ? arr.map(x => ({
          date: x.date || '',
          assetType: x.assetType || stateRef.__currentStationAssetType || '',
          name: x.name || '',
          severity: x.severity || '',
          priority: x.priority || '',
          cost: x.cost,
          category: x.category || 'Capital',
          type: normTypeLabel(x.type),
          days: x.days || ''
        })) : [];
      } catch (e) {
        console.warn('[repairs:list] failed', e);
        state.items = [];
      }
      state.selected.clear();
      state.resolveMode = false;
      state.dirty = false;
      state.editMode = false;
      actionsBlock.style.display = 'none';
      resolveBtn.textContent = 'Resolve Items';
      resolveBtn.classList.remove('btn-danger');
      renderAll();
      updateDirtyBadge(state);
    }

    // initial load
    await load();

    // --- Edit toggle
    editBtn?.addEventListener('click', () => {
      state.editMode = !state.editMode;
      if (!state.editMode) {
        // leaving edit resets resolve mode UI (no deletions applied)
        state.resolveMode = false;
        state.selected.clear();
        resolveBtn.textContent = 'Resolve Items';
        resolveBtn.classList.remove('btn-danger');
      }
      actionsBlock.style.display = state.editMode ? 'flex' : 'none';
      renderAll();
      updateDirtyBadge(state);
      editBtn.textContent = state.editMode ? 'Done' : 'Edit';
    });

    // --- Add Repair/Monitoring modal
    addBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      errorEl.style.display = 'none';
      document.querySelector('#repName').value = '';
      document.querySelector('#repSeverity').value = '';
      document.querySelector('#repPriority').value = '';
      document.querySelector('#repCost').value = '';
      document.querySelector('#repCategory').value = 'Capital';
      document.querySelector('#repType').value = 'Repair';
      document.querySelector('#repDays').value = '';
      openModal();
    });

    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    createBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      const data = readForm();
      const err = validateForm(data);
      if (err) {
        errorEl.textContent = err;
        errorEl.style.display = 'block';
        return;
      }
      state.items.push(data);
      state.dirty = true;
      renderAll();
      updateDirtyBadge(state);
      closeModal();
    });

    // --- Resolve mode (applies to both tables)
    resolveBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      if (!state.resolveMode) {
        state.resolveMode = true;
        state.selected.clear();
        resolveBtn.textContent = 'Exit Resolve Mode';
        resolveBtn.classList.add('btn-danger');
        renderAll();
      } else {
        // Exit without saving deletions
        state.resolveMode = false;
        state.selected.clear();
        resolveBtn.textContent = 'Resolve Items';
        resolveBtn.classList.remove('btn-danger');
        renderAll();
        updateDirtyBadge(state);
      }
    });

    // --- Save Changes (apply additions and deletions)
    saveBtn?.addEventListener('click', async () => {
      if (!state.editMode) return;
      try {
        const toKeep = state.resolveMode
          ? state.items.filter((_it, idx) => !state.selected.has(idx))
          : state.items.slice();

        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        const res = await window.electronAPI.saveRepairs(stn.name, stn.station_id, toKeep);
        if (!res?.success) {
          appAlert(res?.message || 'Failed to save items.');
          return;
        }

        // Refresh dashboard repairs if it exists
        if (window.loadRepairsData) await window.loadRepairsData();
        // Refresh workplan if it exists
        if (window.populateWorkplanFromRepairs) await window.populateWorkplanFromRepairs();

        await load(); // reload from disk to be sure
        // stay in view mode after save
        saveBtn.classList.add('btn-success');
        setTimeout(() => saveBtn.classList.remove('btn-success'), 900);
      } catch (e) {
        console.error('[repairs:save] failed', e);
        appAlert('Failed to save items.');
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      }
    });
  }

  // expose to station.js
  window.initRepairsTab = initRepairsTab;
})();

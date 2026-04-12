(function () {
  'use strict';

  const state = {
    companies: [],
    activeCompany: null,
    data: {}, // { [company]: { locations:[], materials:[], filters:[] } }
  };

  const qs = (root, sel) => root.querySelector(sel);

  function makeId(prefix = 'ui') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  const norm = (v) => String(v || '').trim().toLowerCase();

  function findLocationName(company, locationId) {
    const locs = state.data[company]?.locations || [];
    const lid = norm(locationId);
    const match = locs.find(l => norm(l.id) === lid || norm(l.name) === lid);
    return match ? match.name : '';
  }

  function applyFilters(company, materials, selectedLocationIds) {
    if (!selectedLocationIds || !selectedLocationIds.size) return [];
    const selected = new Set(Array.from(selectedLocationIds).map(norm));
    return (materials || []).filter(m => selected.has(norm(m.location_id)));
  }

  function showModal(title, bodyBuilder) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-head">
          <div class="modal-title">${title}</div>
          <button class="btn btn-ghost btn-sm close-modal">×</button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      </div>
    `;
    const body = overlay.querySelector('.modal-body');
    const footer = overlay.querySelector('.modal-footer');
    const close = () => overlay.remove();
    overlay.querySelector('.close-modal').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    bodyBuilder({ body, footer, close });
    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('open'), 10);
  }

  async function loadCompanies() {
    try {
      const companies = await window.electronAPI.getActiveCompanies();
      state.companies = companies || [];
      if (!state.companies.length) {
        state.activeCompany = null;
      } else if (!state.activeCompany || !state.companies.some(c => (c.name || c) === state.activeCompany)) {
        state.activeCompany = state.companies[0].name || state.companies[0];
      }
      renderShell();
      if (state.activeCompany) await loadCompanyData(state.activeCompany);
    } catch (e) {
      console.error('[materials] failed to load companies', e);
    }
  }

  async function loadCompanyData(company) {
    const host = document.getElementById('materialsManagerPage');
    const spinner = host?.querySelector('.materials-loading');
    if (spinner) spinner.style.display = '';
    try {
      const res = await window.electronAPI.getMaterialsForCompany(company);
      state.data[company] = {
        locations: res?.locations || [],
        materials: res?.materials || [],
        filters: [], // not used in new filter UX
        selectedLocations: new Set((res?.locations || []).map(l => String(l.id))),
      };
    } catch (e) {
      console.error('[materials] load company failed', e);
      state.data[company] = { locations: [], materials: [], filters: [] };
    } finally {
      renderMain();
      if (spinner) spinner.style.display = 'none';
    }
  }

  function renderShell() {
    const host = document.getElementById('materialsManagerPage');
    if (!host) return;
    host.innerHTML = `
      <div class="materials-shell">
        <div class="materials-header card">
          <div>
            <div class="eyebrow">Materials Manager</div>
            <h2 style="margin:0;">Track materials per company</h2>
            <p class="muted" style="margin:4px 0 0 0;">Add storage locations, materials, and create filters on the fly.</p>
          </div>
          <div class="actions">
            <button class="btn btn-ghost" id="mmRefresh">Refresh</button>
            <button class="btn" id="mmAddLocation">New Storage Location</button>
            <button class="btn btn-primary" id="mmAddMaterial">Add Material</button>
          </div>
        </div>
        <div class="materials-tabs" id="mmCompanyTabs"></div>
        <div class="materials-loading" style="display:none;">Loading…</div>
        <div class="materials-body"></div>
      </div>
    `;

    const tabs = host.querySelector('#mmCompanyTabs');
    tabs.innerHTML = '';
    if (!state.companies.length) {
      tabs.innerHTML = `<div class="empty-note">No companies found. Create a company to start tracking materials.</div>`;
    } else {
      state.companies.forEach((c) => {
        const name = c.name || c;
        const btn = document.createElement('button');
        btn.className = 'chip ' + (state.activeCompany === name ? 'active' : '');
        btn.textContent = name;
        btn.addEventListener('click', async () => {
          if (state.activeCompany === name) return;
          state.activeCompany = name;
          renderShell();
          await loadCompanyData(name);
        });
        tabs.appendChild(btn);
      });
    }

    host.querySelector('#mmRefresh')?.addEventListener('click', async () => {
      await loadCompanies();
    });
    host.querySelector('#mmAddLocation')?.addEventListener('click', () => openLocationModal());
    host.querySelector('#mmAddMaterial')?.addEventListener('click', () => openMaterialModal());

    renderMain();
  }

  function renderFiltersSection(body, company) {
    const wrap = document.createElement('div');
    wrap.className = 'card filters-card';
    const locs = state.data[company]?.locations || [];
    wrap.innerHTML = `
      <div class="card-title">Filter by Storage Location</div>
      <div class="filter-chips"></div>
    `;
    const chips = qs(wrap, '.filter-chips');
    chips.style.flexWrap = 'wrap';

    const selected = state.data[company].selectedLocations || new Set(locs.map(l => String(l.id)));
    state.data[company].selectedLocations = selected;

    chips.innerHTML = '';
    locs.forEach((loc) => {
      const id = String(loc.id);
      const label = document.createElement('label');
      label.className = 'chip filter-chip';
      label.style.cursor = 'pointer';
      label.innerHTML = `
        <input type="checkbox" ${selected.has(id) ? 'checked' : ''} data-id="${id}" style="margin-right:6px;">
        ${loc.name}
      `;
      chips.appendChild(label);
    });

    chips.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (cb.checked) selected.add(id); else selected.delete(id);
        renderMain(); // Re-render materials to show/hide by location
      });
    });

    body.appendChild(wrap);
  }

  function renderLocationsSummary(body, company) {
    const locs = state.data[company]?.locations || [];
    const wrap = document.createElement('div');
    wrap.className = 'card locations-card';
    if (!locs.length) {
      wrap.innerHTML = `
        <div class="card-title">Storage Locations</div>
        <div class="empty-note">No storage locations yet. Add one to start tracking materials.</div>`;
      body.appendChild(wrap);
      return;
    }
    wrap.innerHTML = `<div class="card-title">Storage Locations</div>`;
    const list = document.createElement('div');
    list.className = 'locations-grid';
    locs.forEach((loc) => {
      const chip = document.createElement('div');
      chip.className = 'location-pill';
      const matCount = (state.data[company]?.materials || []).filter(m => String(m.location_id) === String(loc.id)).length;
      chip.innerHTML = `
        <div class="loc-name">${loc.name}</div>
        <div class="muted small">${matCount} material${matCount === 1 ? '' : 's'}</div>
      `;
      list.appendChild(chip);
    });
    wrap.appendChild(list);
    body.appendChild(wrap);
  }

  function renderMaterialsTable(body, company) {
    const dataset = state.data[company] || { materials: [], locations: [] };
    const filtered = applyFilters(company, dataset.materials || [], dataset.selectedLocations);

    const wrap = document.createElement('div');
    wrap.className = 'card table-card';
    wrap.innerHTML = `
      <div class="card-title">Materials</div>
      <div class="muted" style="margin-bottom:8px;">${filtered.length} item${filtered.length === 1 ? '' : 's'} shown</div>
      <div class="table-scroll">
        <table class="data-table" id="materialsTable">
          <thead>
            <tr>
              <th>Material</th>
              <th>Storage Location</th>
              <th>Quantity</th>
              <th>Cost per Item ($)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    `;

    const tbody = wrap.querySelector('tbody');
    if (!filtered.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" class="muted">No materials yet. Add a material to get started.</td>`;
      tbody.appendChild(tr);
    } else {
      filtered.forEach((m) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${m.name || ''}</td>
          <td>${findLocationName(company, m.location_id) || m.location_id || ''}</td>
          <td>${m.quantity || ''} ${m.unit || ''}</td>
          <td>${m.value || ''}</td>
          <td><button class="btn btn-ghost btn-sm mat-edit" data-id="${m.id || ''}">Edit</button></td>
        `;
        tbody.appendChild(tr);
      });
    }

    wrap.querySelectorAll('.mat-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const all = state.data[company]?.materials || [];
        const mat = all.find(x => String(x.id) === String(id));
        if (mat) openMaterialModal(mat);
      });
    });

    body.appendChild(wrap);
  }

  function renderMain() {
    const host = document.getElementById('materialsManagerPage');
    if (!host) return;
    const body = host.querySelector('.materials-body');
    if (!body) return;

    if (!state.activeCompany) {
      body.innerHTML = `<div class="empty-note">Select or create a company to begin.</div>`;
      return;
    }
    if (!state.data[state.activeCompany]) {
      body.innerHTML = `<div class="empty-note">Loading materials…</div>`;
      return;
    }

    body.innerHTML = '';
    renderFiltersSection(body, state.activeCompany);
    renderLocationsSummary(body, state.activeCompany);
    renderMaterialsTable(body, state.activeCompany);
  }

  function openLocationModal() {
    if (!state.activeCompany) return;
    showModal('New Storage Location', ({ body, footer, close }) => {
      body.innerHTML = `
        <div class="form-row">
          <label>Name*</label>
          <input type="text" id="locName" placeholder="Storage name">
        </div>
        <div class="form-row">
          <label>Description</label>
          <textarea id="locDesc" rows="3" placeholder="Short description"></textarea>
        </div>
        <div class="form-row">
          <label>Notes</label>
          <textarea id="locNotes" rows="2" placeholder=""></textarea>
        </div>
      `;
      footer.innerHTML = `
        <button class="btn btn-ghost" id="locCancel">Cancel</button>
        <button class="btn btn-primary" id="locSave">Save Location</button>
      `;
      qs(footer, '#locCancel')?.addEventListener('click', close);
      qs(footer, '#locSave')?.addEventListener('click', async () => {
        const name = qs(body, '#locName')?.value.trim();
        if (!name) return appAlert('Please enter a storage location name.');
        const payload = {
          name,
          description: qs(body, '#locDesc')?.value || '',
          notes: qs(body, '#locNotes')?.value || '',
        };
        const res = await window.electronAPI.saveMaterialLocation(state.activeCompany, payload);
        if (res?.success) {
          await loadCompanyData(state.activeCompany);
          close();
        } else {
          appAlert(res?.message || 'Unable to save location');
        }
      });
    });
  }

  function openMaterialModal(existingMaterial = null) {
    if (!state.activeCompany) return;
    const locs = state.data[state.activeCompany]?.locations || [];
    const isEdit = !!existingMaterial;
    const initialLocId = existingMaterial?.location_id || (locs[0]?.id ?? '');
    const locOptions = Array.isArray(locs) ? locs.slice() : [];
    if (isEdit && initialLocId && !locOptions.some(l => String(l.id) === String(initialLocId))) {
      locOptions.push({ id: initialLocId, name: initialLocId });
    }
    const esc = (v) => String(v ?? '').replace(/"/g, '&quot;');

    showModal(isEdit ? 'Edit Material' : 'Add Material', ({ body, footer, close }) => {
      body.innerHTML = `
        <div class="form-grid">
          <div class="form-row">
            <label>Material Name*</label>
            <input type="text" id="matName" placeholder="Material name" value="${esc(existingMaterial?.name || '')}">
          </div>
          <div class="form-row">
            <label>Storage Location*</label>
            <select id="matLocation">
              ${locOptions.map(l => {
                const selected = String(initialLocId) === String(l.id) ? 'selected' : '';
                return `<option value="${esc(l.id)}" ${selected}>${esc(l.name)}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="form-row split">
            <div>
              <label>Quantity</label>
              <input type="number" id="matQty" placeholder="0" value="${esc(existingMaterial?.quantity ?? '')}">
            </div>
            <div>
              <label>Unit</label>
              <input type="text" id="matUnit" placeholder="pcs, ft, kg" value="${esc(existingMaterial?.unit || '')}">
            </div>
            <div>
              <label>Cost per Item ($)</label>
              <input type="number" id="matValue" placeholder="" value="${esc(existingMaterial?.value ?? '')}">
            </div>
          </div>
        </div>
      `;

      footer.innerHTML = `
        <button class="btn btn-ghost" id="matCancel">Cancel</button>
        ${isEdit ? '<button class="btn btn-danger" id="matDelete">Delete</button>' : ''}
        <button class="btn btn-primary" id="matSave">${isEdit ? 'Save Changes' : 'Save Material'}</button>
      `;
      qs(footer, '#matCancel')?.addEventListener('click', close);
      if (isEdit) {
        const delBtn = qs(footer, '#matDelete');
        delBtn?.addEventListener('click', async () => {
          if (!existingMaterial?.id) return appAlert('Material ID missing; cannot delete.');
          const confirmed = window.confirm('Delete this material? This cannot be undone.');
          if (!confirmed) return;
          delBtn.disabled = true;
          delBtn.textContent = 'Deleting...';
          try {
            const res = await window.electronAPI.deleteMaterial(state.activeCompany, existingMaterial.id);
            if (res?.success) {
              await loadCompanyData(state.activeCompany);
              close();
            } else {
              appAlert(res?.message || 'Unable to delete material');
              delBtn.disabled = false;
              delBtn.textContent = 'Delete';
            }
          } catch (e) {
            console.error('[materials] delete failed', e);
            appAlert('Unexpected error deleting material.');
            delBtn.disabled = false;
            delBtn.textContent = 'Delete';
          }
        });
      }
      qs(footer, '#matSave')?.addEventListener('click', async () => {
        const name = qs(body, '#matName')?.value.trim();
        if (!name) return appAlert('Please enter a material name.');
        const locId = qs(body, '#matLocation')?.value;
        if (!locId) return appAlert('Please choose a storage location.');
        const payload = {
          id: existingMaterial?.id,
          name,
          location_id: locId,
          quantity: qs(body, '#matQty')?.value || '',
          unit: qs(body, '#matUnit')?.value || '',
          value: qs(body, '#matValue')?.value || '',
        };
        const res = await window.electronAPI.saveMaterial(state.activeCompany, payload);
        if (res?.success) {
          await loadCompanyData(state.activeCompany);
          close();
        } else {
          appAlert(res?.message || 'Unable to save material');
        }
      });
    });
  }

  async function initMaterialsManagerView() {
    await loadCompanies();
  }

  window.initMaterialsManagerView = window.initMaterialsManagerView || initMaterialsManagerView;
})();

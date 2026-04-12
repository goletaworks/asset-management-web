// frontend/js/filters.js
// LHS Projects tree (Companies ▸ Locations ▸ Asset Types) with:
// - [+] actions: company [+] → Create Project/Location; location [+] → Create Assets
// - Keeps EXACT same checkbox classes/ids and dispatches 'change' events,
//   so map_view.js and list_view.js continue to work unchanged.

(function () {
  'use strict';

  const filterTree = document.getElementById('filterTree');
  if (!filterTree) return;

  const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    children.flat().forEach(c => c == null ? null : (c.nodeType ? n.appendChild(c) : n.appendChild(document.createTextNode(String(c)))));
    return n;
  };

  const uniq = arr => Array.from(new Set((arr || []).filter(Boolean)));

  // Remember explicit user choice for company/location checkboxes
  function setUserChecked(cb, val) { if (cb) cb.dataset.userchecked = val ? '1' : '0'; }

  async function fetchTree() {
    let treeFromLookups = null;

    // Try to load the authoritative lookup tree
    try {
      if (window.electronAPI?.getLookupTree) {
        const t = await window.electronAPI.getLookupTree();
        if (t && Array.isArray(t.companies)) treeFromLookups = t;
      }
    } catch (e) {
      console.error('[filters] getLookupTree failed', e);
    }

    // Introspect raw data to collect assets by location (no synthetic companies)
    let dataLocs = [], assetsByLocData = {};
    try {
      const data = await window.electronAPI.getStationData({});
      const norm = s => String(s ?? '').trim();

      dataLocs = uniq((data || [])
        .map(s => norm(s.province || s.location || s.location_file))
        .filter(Boolean))
        .sort((a, b) => a.localeCompare(b));

      (data || []).forEach(s => {
        const loc = norm(s.province || s.location || s.location_file || '');
        const at  = norm(s.asset_type || '');
        if (!loc || !at) return;
        (assetsByLocData[loc] ||= new Set()).add(at);
      });

      Object.keys(assetsByLocData).forEach(k => {
        assetsByLocData[k] = Array.from(assetsByLocData[k]).sort((a, b) => a.localeCompare(b));
      });
    } catch (e) {
      console.error('[filters] data introspection failed', e);
    }

    // If we have lookups, return them as-is, only enriching assets for known locations.
    if (treeFromLookups && treeFromLookups.companies.length) {
      const tree = {
        companies: [...treeFromLookups.companies],
        locationsByCompany: { ...(treeFromLookups.locationsByCompany || {}) },
        assetsByCompanyLocation: { ...(treeFromLookups.assetsByCompanyLocation || {}) },
      };

      return tree;
    }

    // No lookups available → return an empty structure (no synthetic companies).
    return {
      companies: [],
      locationsByCompany: {},
      assetsByCompanyLocation: {},
    };
  }

  // Preserve your initial-render gating so map pins aren’t cleared at boot
  let INITIAL_RENDER = true;

  function rowActions({ kind, company, location, assetType }) {
    // Show [+] on company, location, and asset rows.
    if (!(kind === 'company' || kind === 'location' || kind === 'asset')) return null;

    const wrap = el('div', { class: 'ft-actions', style: 'display:inline-flex;gap:.4rem;margin-left:auto;' });
    const plus = el('button', {
      type: 'button',
      class: 'ft-plus',
      title: (kind === 'company') ? 'Add location' : (kind === 'location' ? 'Add assets' : 'Add instance')
    }, '+');

    wrap.appendChild(plus);
    if (company)  wrap.dataset.company  = company;
    if (location) wrap.dataset.location = location;
    if (assetType) wrap.dataset.assetType = assetType;
    wrap.dataset.kind = kind;
    return wrap;
  }

  function render(tree) {
    filterTree.innerHTML = '';
    filterTree.dataset.ready = '0';

    const frag = document.createDocumentFragment();
    const companies     = tree.companies || [];
    const locsByCompany = tree.locationsByCompany || {};
    const assetsByCoLoc = tree.assetsByCompanyLocation || {};

    companies.forEach(companyObj => {
      const company = companyObj.name; // Get the name string
      const co = el('details', { class: 'ft-company', open: '' });

      const coCb = el('input', {
        type: 'checkbox',
        class: 'filter-checkbox company',
        'data-company': company,
        checked: ''
      });

      // Build the tooltip title
      const tooltipLines = [];
      if (companyObj.description) tooltipLines.push(`${companyObj.description}`);
      if (companyObj.description) tooltipLines.push(` `)
      if (companyObj.email) tooltipLines.push(`${companyObj.email}`);
      const titleAttr = tooltipLines.length ? tooltipLines.join('\n') : null;

      const head = el('div', { class: 'ft-row', style: 'display:flex;align-items:center;gap:.5rem;' },
        el('label', {
          class: 'ft-label',
          style: 'display:inline-flex;gap:.5rem;align-items:center;',
          title: titleAttr // <-- ADD THE TOOLTIP HERE
        },
          coCb,
          el('span', { class: 'ft-text' }, company)
        ),
        rowActions({ kind: 'company', company })
      );

      const coSummary = el('summary', { class: 'ft-row-wrap', style: 'list-style:none;' });
      coSummary.appendChild(head);
      co.appendChild(coSummary);

      const locWrap = el('div', { class: 'ft-children' });
      (locsByCompany[company] || []).forEach(loc => {
        const locCb = el('input', {
          type: 'checkbox',
          class: 'filter-checkbox location',
          value: loc,
          'data-company': company,
          checked: ''
        });

        const locHead = el('div', { class: 'ft-row', style: 'display:flex;align-items:center;gap:.5rem;' },
          el('label', { class: 'ft-label', style: 'display:inline-flex;gap:.5rem;align-items:center;' },
            locCb,
            el('span', { class: 'ft-text' }, loc)
          ),
          rowActions({ kind: 'location', company, location: loc })
        );

        const locDet = el('details', { class: 'ft-location', open: '' });
        const locSum = el('summary', { class: 'ft-row-wrap', style: 'list-style:none;' });
        locSum.appendChild(locHead);
        locDet.appendChild(locSum);

        const atWrap = el('div', { class: 'ft-children' });
        const companyAssets = assetsByCoLoc[company] || {};
        (companyAssets[loc] || []).forEach(at => {
          const atCb = el('input', {
            type: 'checkbox',
            class: 'filter-checkbox asset-type',
            value: at,
            'data-company': company,
            'data-location': loc,
            checked: ''
          });
          const row = el('div', { class: 'ft-row ft-asset', style:'display:flex;align-items:center;gap:.5rem;' },
            el('label', { class: 'ft-label', style: 'display:inline-flex;gap:.5rem;align-items:center;flex:1;' },
              atCb,
              el('span', { class: 'ft-text' }, at)
            ),
            // [+] on asset row
            rowActions({ kind: 'asset', company, location: loc, assetType: at })
          );
          atWrap.appendChild(row);
        });

        locDet.appendChild(atWrap);
        locWrap.appendChild(locDet);
      });

      co.appendChild(locWrap);
      frag.appendChild(co);
    });

    if (!companies.length) {
      frag.appendChild(el('div', { class: 'ft-empty' }, 'No projects yet — add a company to get started.'));
    }

    filterTree.appendChild(frag);

    // Initialize all checked; remember user intent on parents
    filterTree.querySelectorAll('input.filter-checkbox').forEach(cb => { cb.checked = true; cb.indeterminate = false; });
    filterTree.querySelectorAll('input.company, input.location').forEach(cb => setUserChecked(cb, true));
    updateTriState(filterTree);

    // Wire [+] actions
    wireActions(filterTree);

    // Signal ready (boot gating)
    requestAnimationFrame(() => {
      filterTree.dataset.ready = '1';
      if (!INITIAL_RENDER) {
        filterTree.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        INITIAL_RENDER = false;
        setTimeout(() => filterTree.dispatchEvent(new Event('change', { bubbles: true })), 3000);
      }
    });
  }

  function updateTriState(scope) {
    scope.querySelectorAll('input.location').forEach(cb => {
      const mark = cb.dataset.userchecked;
      if (mark != null) cb.checked = (mark === '1');
      cb.indeterminate = false;
    });
    scope.querySelectorAll('input.company').forEach(cb => {
      const mark = cb.dataset.userchecked;
      if (mark != null) cb.checked = (mark === '1');
      cb.indeterminate = false;
    });
  }

  const dispatchChange = debounce(() => {
    filterTree.dispatchEvent(new Event('change', { bubbles: true }));
  }, 50);

  function onTreeChange(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;
    console.log('[filters] checkbox changed:', {
      classList: Array.from(t.classList),
      checked: t.checked,
      value: t.value,
      dataset: t.dataset
    });

    if (t.classList.contains('company')) {
      const details = t.closest('details.ft-company');
      setUserChecked(t, t.checked);
      if (details) {
        details.querySelectorAll('input.location, input.asset-type').forEach(cb => { cb.checked = t.checked; cb.indeterminate = false; });
        details.querySelectorAll('input.location').forEach(locCb => setUserChecked(locCb, t.checked));
      }
    } else if (t.classList.contains('location')) {
      const locDet = t.closest('details.ft-location');
      setUserChecked(t, t.checked);
      if (locDet) locDet.querySelectorAll('input.asset-type').forEach(cb => { cb.checked = t.checked; });
    }
    updateTriState(filterTree);
    dispatchChange();
  }

  // small inline menu for [+] actions on asset row
  function showPlusMenu(anchorBtn, items = []) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', { class: 'ft-plus-menu',
      style: `
        position: fixed; z-index: 9999; top:${rect.bottom + 4}px; left:${rect.left}px;
        background:#fff;border:1px solid rgba(0,0,0,.1);box-shadow:0 6px 24px rgba(0,0,0,.12);
        border-radius:8px; overflow:hidden; min-width:220px;`
    });
    items.forEach(({ label, onClick }) => {
      const it = el('button', { class: 'btn btn-ghost', style: 'display:block;width:100%;text-align:left;padding:.5rem .75rem;border:0;' }, label);
      it.addEventListener('click', () => { try { onClick(); } finally { cleanup(); } });
      menu.appendChild(it);
    });
    document.body.appendChild(menu);
    function cleanup() { menu.remove(); document.removeEventListener('click', onDoc); }
    function onDoc(e) { if (!menu.contains(e.target) && e.target !== anchorBtn) cleanup(); }
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  }  

  function wireActions(root) {
    // [+] opens the appropriate creation UI (company/location/asset)
    root.querySelectorAll('.ft-actions .ft-plus').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.addEventListener('click', (e) => {
        const wrap = e.currentTarget.closest('.ft-actions');
        const kind = wrap?.dataset.kind;
        const company = wrap?.dataset.company || '';
        const location = wrap?.dataset.location || '';
        const assetType = wrap?.dataset.assetType || '';
        if (kind === 'company' && window.openCreateLocationForm) {
          window.openCreateLocationForm(company);
        } else if (kind === 'location' && window.openCreateAssetsWizard) {
          window.openCreateAssetsWizard(company, location);
        } else if (kind === 'asset') {
          // Two choices: Import from Excel, or Manually add instance
          showPlusMenu(e.currentTarget, [
            {
              label: 'Import from Excel…',
              onClick: () => window.openImportMoreForAsset && window.openImportMoreForAsset(company, location, assetType)
            },
            {
              label: 'Manually add an instance…',
              onClick: () => window.openManualInstanceWizard && window.openManualInstanceWizard(company, location, assetType)
            }
          ]);
        }
      });
      btn.dataset.bound = '1';
    });
  }

  async function build(retryCount = 0) {
    const tree = await fetchTree();

    // Check if we actually got companies. 
    // If not, and we haven't retried too many times (limit 10 tries / 5 seconds), try again.
    const hasData = tree && tree.companies && tree.companies.length > 0;

    if (!hasData && retryCount < 10) {
      console.log(`[filters] Data not ready yet. Retrying (${retryCount + 1}/10)...`);
      setTimeout(() => build(retryCount + 1), 500); // Wait 500ms and try again
      return;
    }

    render(tree);
  }

  document.addEventListener('DOMContentLoaded', () => {
    filterTree.addEventListener('change', onTreeChange);
    build();
  });

  // Public hook for other modules
  window.refreshFilters = build;
})();

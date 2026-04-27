(function () {
  'use strict';

  const norm = (v) => String(v ?? '').trim().toLowerCase();

  function getHierarchySelectionContext() {
    const companyCb = document.querySelector('#filterTree input.filter-checkbox.company:checked');
    const company = companyCb ? (companyCb.dataset.company || companyCb.value || '') : '';
    const companyNorm = norm(company);

    const locationCbs = Array.from(document.querySelectorAll('#filterTree input.filter-checkbox.location'))
      .filter(cb => cb.checked && norm(cb.dataset.company || '') === companyNorm);
    const locations = Array.from(new Set(locationCbs.map(cb => String(cb.value || '').trim()).filter(Boolean)));
    const locationsNorm = new Set(locations.map(norm));

    const assetTypeCbs = Array.from(document.querySelectorAll('#filterTree input.filter-checkbox.asset-type'))
      .filter(cb => cb.checked && norm(cb.dataset.company || '') === companyNorm);
    const combos = new Set();
    const assetsByLocation = new Map();
    assetTypeCbs.forEach(cb => {
      const loc = String(cb.dataset.location || '').trim();
      const at = String(cb.value || '').trim();
      if (!loc || !at) return;
      const locNorm = norm(loc);
      combos.add(`${companyNorm}|${locNorm}|${norm(at)}`);
      if (!assetsByLocation.has(locNorm)) assetsByLocation.set(locNorm, new Set());
      assetsByLocation.get(locNorm).add(norm(at));
    });

    const labelParts = [];
    if (company) labelParts.push(company);
    if (locations.length === 1) labelParts.push(locations[0]);
    if (assetsByLocation.size === 1) {
      const only = Array.from(assetsByLocation.values())[0];
      if (only && only.size === 1) labelParts.push(Array.from(only)[0]);
    }
    const label = labelParts.length ? labelParts.join(' - ') : 'No company selected';

    return {
      company,
      companyNorm,
      locations,
      locationsNorm,
      combos,
      assetsByLocation,
      label,
      hasCompany: !!company,
    };
  }

  function stationMatchesHierarchyScope(stn, scope = getHierarchySelectionContext()) {
    if (!scope || !scope.hasCompany) return false;
    const stnCompany = norm(stn?.company);
    if (!stnCompany || stnCompany !== scope.companyNorm) return false;

    if (!scope.locationsNorm || scope.locationsNorm.size === 0) return true;

    const stnLocs = [
      norm(stn?.province),
      norm(stn?.location),
      norm(stn?.location_file),
    ].filter(Boolean);
    if (!stnLocs.length) return false;

    if (scope.combos && scope.combos.size > 0) {
      const at = norm(stn?.asset_type);
      if (!at) return false;
      return stnLocs.some(loc => scope.combos.has(`${scope.companyNorm}|${loc}|${at}`));
    }
    return stnLocs.some(loc => scope.locationsNorm.has(loc));
  }

  window.getHierarchySelectionContext = window.getHierarchySelectionContext || getHierarchySelectionContext;
  window.stationMatchesHierarchyScope = window.stationMatchesHierarchyScope || stationMatchesHierarchyScope;
})();

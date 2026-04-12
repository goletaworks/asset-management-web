// frontend/js/link_settings.js (fixed version)
(function () {
  'use strict';

  // State
  const state = {
    lookupTree: null,
    originalLinks: new Map(),
    currentLinks: new Map(),
    hasChanges: false,
    initialized: false
  };

  // Helper functions
  function normStr(s) {
    return String(s || '').trim();
  }

  function makeLocationKey(company, location) {
    return `loc||${normStr(company)}||${normStr(location)}`;
  }

  function makeAssetTypeKey(company, location, assetType) {
    return `at||${normStr(company)}||${normStr(location)}||${normStr(assetType)}`;
  }

  // IPC wrappers
  async function getLookupTree() {
    const api = window.electronAPI || {};
    if (typeof api.getLookupTree !== 'function') {
      return { companies: [], locationsByCompany: {}, assetsByCompanyLocation: {} };
    }
    try {
      return await api.getLookupTree();
    } catch (e) {
      console.error('[link_settings] getLookupTree failed:', e);
      return { companies: [], locationsByCompany: {}, assetsByCompanyLocation: {} };
    }
  }

  async function getPhotosBase(company, location, assetType) {
    const api = window.electronAPI || {};
    if (typeof api.getPhotosBase !== 'function') return null;
    try {
      return await api.getPhotosBase({ company, location, assetType });
    } catch (e) {
      console.error('[link_settings] getPhotosBase failed:', e);
      return null;
    }
  }

  async function setLocationLink(company, location, link) {
    const api = window.electronAPI || {};
    if (typeof api.setLocationLink !== 'function') return { success: false };
    try {
      return await api.setLocationLink(company, location, link);
    } catch (e) {
      console.error('[link_settings] setLocationLink failed:', e);
      return { success: false };
    }
  }

  async function setAssetTypeLink(assetType, company, location, link) {
    const api = window.electronAPI || {};
    if (typeof api.setAssetTypeLink !== 'function') return { success: false };
    try {
      return await api.setAssetTypeLink(assetType, company, location, link);
    } catch (e) {
      console.error('[link_settings] setAssetTypeLink failed:', e);
      return { success: false };
    }
  }

  // Load all current links
  async function loadAllLinks() {
    state.originalLinks.clear();
    state.currentLinks.clear();

    if (!state.lookupTree) return;

    const { locationsByCompany, assetsByCompanyLocation } = state.lookupTree;

    // Load all links by querying each combination
    for (const [company, locations] of Object.entries(locationsByCompany)) {
      for (const location of locations || []) {
        // Get location-level link
        const locKey = makeLocationKey(company, location);
        const locLink = await getPhotosBase(company, location, '');
        state.originalLinks.set(locKey, locLink || '');
        state.currentLinks.set(locKey, locLink || '');

        // Get asset-type-level links
        const companyAssets = assetsByCompanyLocation?.[company] || {};
        const assetTypes = companyAssets[location] || [];
        
        for (const assetType of assetTypes) {
          const atKey = makeAssetTypeKey(company, location, assetType);
          const atLink = await getPhotosBase(company, location, assetType);
          
          // Only store if different from location link
          if (atLink && atLink !== locLink) {
            state.originalLinks.set(atKey, atLink);
            state.currentLinks.set(atKey, atLink);
          } else {
            state.originalLinks.set(atKey, '');
            state.currentLinks.set(atKey, '');
          }
        }
      }
    }
  }

  // Render the tree view
  function renderTree() {
    const container = document.getElementById('linkTree');
    if (!container || !state.lookupTree) return;

    const { companies, locationsByCompany, assetsByCompanyLocation } = state.lookupTree;

    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    companies.forEach(companyObj => {
      const company = companyObj.name || companyObj;
      const locations = locationsByCompany[company] || [];

      if (locations.length === 0) return;

      // Company container
      const companyDiv = document.createElement('div');
      companyDiv.className = 'link-company';
      companyDiv.style.cssText = 'margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;';

      // Company header
      const companyHeader = document.createElement('div');
      companyHeader.className = 'link-company-header';
      companyHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #f9fafb; cursor: pointer; user-select: none; font-weight: 600;';
      companyHeader.innerHTML = `
        <span>${company}</span>
        <span class="chevron" style="transition: transform 0.2s;">▼</span>
      `;
      
      // Company content (locations)
      const companyContent = document.createElement('div');
      companyContent.className = 'link-company-content';
      companyContent.style.cssText = 'padding: 12px; display: block;';

      // Toggle expansion
      companyHeader.onclick = () => {
        const isExpanded = companyContent.style.display !== 'none';
        companyContent.style.display = isExpanded ? 'none' : 'block';
        const chevron = companyHeader.querySelector('.chevron');
        if (chevron) chevron.style.transform = isExpanded ? 'rotate(-90deg)' : 'rotate(0deg)';
      };

      locations.forEach(location => {
        const locDiv = document.createElement('div');
        locDiv.className = 'link-location';
        locDiv.style.cssText = 'margin-bottom: 16px; padding: 12px; background: white; border: 1px solid #e5e7eb; border-radius: 6px;';
        
        // Location header with input
        const locHeader = document.createElement('div');
        locHeader.className = 'link-location-header';
        locHeader.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;';
        
        const locName = document.createElement('div');
        locName.className = 'link-location-name';
        locName.style.cssText = 'font-weight: 600; color: #374151;';
        locName.textContent = location;
        
        const locKey = makeLocationKey(company, location);
        const locInput = document.createElement('input');
        locInput.type = 'text';
        locInput.className = 'link-path-input';
        locInput.placeholder = 'No path set (uses default)';
        locInput.value = state.currentLinks.get(locKey) || '';
        locInput.dataset.linkKey = locKey;
        locInput.dataset.linkType = 'location';
        locInput.dataset.company = company;
        locInput.dataset.location = location;
        locInput.style.cssText = 'width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 4px; font-family: monospace; font-size: 13px;';
        
        locInput.addEventListener('input', handleInputChange);
        
        locHeader.appendChild(locName);
        locHeader.appendChild(locInput);
        locDiv.appendChild(locHeader);
        
        // Asset types
        const companyAssets = assetsByCompanyLocation?.[company] || {};
        const assetTypes = companyAssets[location] || [];
        
        if (assetTypes.length > 0) {
          const atContainer = document.createElement('div');
          atContainer.className = 'link-asset-types';
          atContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding-left: 16px; border-left: 2px solid #e5e7eb;';
          
          assetTypes.forEach(assetType => {
            const atDiv = document.createElement('div');
            atDiv.className = 'link-asset-type';
            atDiv.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
            
            const atName = document.createElement('div');
            atName.className = 'link-asset-type-name';
            atName.style.cssText = 'font-size: 14px; color: #6b7280; font-weight: 500;';
            atName.textContent = assetType;
            
            const atKey = makeAssetTypeKey(company, location, assetType);
            const atInput = document.createElement('input');
            atInput.type = 'text';
            atInput.className = 'link-path-input';
            atInput.placeholder = 'Uses location path';
            atInput.value = state.currentLinks.get(atKey) || '';
            atInput.dataset.linkKey = atKey;
            atInput.dataset.linkType = 'assetType';
            atInput.dataset.company = company;
            atInput.dataset.location = location;
            atInput.dataset.assetType = assetType;
            atInput.style.cssText = 'width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; font-family: monospace; font-size: 12px;';
            
            atInput.addEventListener('input', handleInputChange);
            
            atDiv.appendChild(atName);
            atDiv.appendChild(atInput);
            atContainer.appendChild(atDiv);
          });
          
          locDiv.appendChild(atContainer);
        }
        
        companyContent.appendChild(locDiv);
      });

      companyDiv.appendChild(companyHeader);
      companyDiv.appendChild(companyContent);
      frag.appendChild(companyDiv);
    });

    container.appendChild(frag);
  }

  // Handle input changes
  function handleInputChange(e) {
    const input = e.target;
    const key = input.dataset.linkKey;
    const value = normStr(input.value);
    
    // Normalize UNC paths
    let normalizedValue = value;
    if (normalizedValue.startsWith('\\\\')) {
      const parts = normalizedValue.substring(2).split(/\\+/);
      normalizedValue = '\\\\' + parts.join('\\');
    }
    
    state.currentLinks.set(key, normalizedValue);
    state.hasChanges = true;
  }

  // Save all changes
  async function saveChanges() {
    const changes = [];
    
    // Find all changes
    for (const [key, currentValue] of state.currentLinks) {
      const originalValue = state.originalLinks.get(key);
      if (currentValue !== originalValue) {
        changes.push({ key, value: currentValue });
      }
    }
    
    if (changes.length === 0) return { success: true, message: 'No changes to save' };
    
    let successCount = 0;
    let failCount = 0;
    
    // Apply changes
    for (const { key, value } of changes) {
      const parts = key.split('||');
      const type = parts[0];
      
      let result;
      if (type === 'loc') {
        const [, company, location] = parts;
        result = await setLocationLink(company, location, value);
      } else if (type === 'at') {
        const [, company, location, assetType] = parts;
        result = await setAssetTypeLink(assetType, company, location, value);
      }
      
      if (result && result.success) {
        successCount++;
        state.originalLinks.set(key, value);
      } else {
        failCount++;
      }
    }
    
    if (failCount === 0) {
      state.hasChanges = false;
    }
    
    // Refresh cache
    if (typeof window.electronAPI?.invalidateStationCache === 'function') {
      await window.electronAPI.invalidateStationCache();
    }
    
    return { 
      success: failCount === 0, 
      message: failCount > 0 
        ? `Saved ${successCount} changes, ${failCount} failed` 
        : `Saved ${successCount} changes`
    };
  }

  // Cancel changes
  function cancelChanges() {
    state.currentLinks.clear();
    for (const [key, value] of state.originalLinks) {
      state.currentLinks.set(key, value);
    }
    state.hasChanges = false;
    renderTree();
  }

  // Initialize
  async function initLinkSettings() {
    if (state.initialized) return;
    
    const container = document.getElementById('linkTree');
    if (!container) {
      console.error('[link_settings] linkTree container not found');
      return;
    }

    // Show loading message
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #6b7280;">Loading photo links...</div>';
    
    try {
      state.lookupTree = await getLookupTree();
      await loadAllLinks();
      renderTree();
      state.initialized = true;
    } catch (e) {
      console.error('[link_settings] Initialization failed:', e);
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444;">Failed to load photo links</div>';
    }
  }

  // Export for external access
  window.linkSettings = {
    init: initLinkSettings,
    save: saveChanges,
    cancel: cancelChanges,
    hasChanges: () => state.hasChanges,
    initialized: false
  };

})();
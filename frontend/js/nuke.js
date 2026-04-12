(function () {
  'use strict';

  let mounted = false;
  let currentSelection = {
    company: null,
    location: null,
    assetType: null
  };

  function setFooterHidden(hidden){
    const root = document.getElementById('settingsPage');
    if (!root) return;
    root.classList.toggle('nuke-active', !!hidden);
  }

  async function loadCompanies() {
    try {
      const tree = await window.electronAPI.getLookupTree();
      const companySelect = document.getElementById('deleteCompanySelect');
      if (!companySelect) return;
      
      // Clear existing options
      companySelect.innerHTML = '<option value="">-- Select Company --</option>';
      
      // Add companies
      if (tree.companies && tree.companies.length > 0) {
        tree.companies.forEach(company => {
          const option = document.createElement('option');
          option.value = company.name;
          option.textContent = company.name;
          companySelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error('Failed to load companies:', error);
    }
  }

  async function loadLocations(companyName) {
    try {
      const tree = await window.electronAPI.getLookupTree();
      const locationSelect = document.getElementById('deleteLocationSelect');
      if (!locationSelect) return;
      
      // Clear existing options
      locationSelect.innerHTML = '<option value="">-- Select Location --</option>';
      
      // Add locations for selected company
      const locations = tree.locationsByCompany[companyName] || [];
      locations.forEach(location => {
        const option = document.createElement('option');
        option.value = location;
        option.textContent = location;
        locationSelect.appendChild(option);
      });
      
      locationSelect.disabled = locations.length === 0;
    } catch (error) {
      console.error('Failed to load locations:', error);
    }
  }

  async function loadAssetTypes(companyName, locationName) {
    try {
      const tree = await window.electronAPI.getLookupTree();
      const assetTypeSelect = document.getElementById('deleteAssetTypeSelect');
      if (!assetTypeSelect) return;
      
      // Clear existing options
      assetTypeSelect.innerHTML = '<option value="">-- Select Asset Type --</option>';
      
      // Add asset types for selected company and location
      const companyAssets = tree.assetsByCompanyLocation[companyName] || {};
      const assetTypes = companyAssets[locationName] || [];
      
      assetTypes.forEach(assetType => {
        const option = document.createElement('option');
        option.value = assetType;
        option.textContent = assetType;
        assetTypeSelect.appendChild(option);
      });
      
      assetTypeSelect.disabled = assetTypes.length === 0;
    } catch (error) {
      console.error('Failed to load asset types:', error);
    }
  }

  function updatePreview() {
    const preview = document.getElementById('deletePreview');
    const previewText = document.getElementById('deletePreviewText');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    
    if (!preview || !previewText || !deleteBtn) return;
    
    if (currentSelection.assetType) {
      previewText.textContent = `Asset Type: ${currentSelection.company} → ${currentSelection.location} → ${currentSelection.assetType}`;
      preview.style.display = 'block';
      deleteBtn.disabled = false;
    } else if (currentSelection.location) {
      previewText.textContent = `Location: ${currentSelection.company} → ${currentSelection.location} (and all its asset types)`;
      preview.style.display = 'block';
      deleteBtn.disabled = false;
    } else if (currentSelection.company) {
      previewText.textContent = `Company: ${currentSelection.company} (and all its locations and asset types)`;
      preview.style.display = 'block';
      deleteBtn.disabled = false;
    } else {
      preview.style.display = 'none';
      deleteBtn.disabled = true;
    }
  }

  async function performDeletion() {
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    const status = document.getElementById('deleteStatus');
    
    if (!deleteBtn || !status) return;
    
    deleteBtn.disabled = true;
    status.textContent = 'Deleting...';
    
    try {
      let result;
      
      if (currentSelection.assetType) {
        // Delete specific asset type
        const ok = await appConfirm(
          `Are you sure you want to delete the asset type:\n${currentSelection.company} → ${currentSelection.location} → ${currentSelection.assetType}?\n\nThis cannot be undone.`
        );
        if (!ok) {
          deleteBtn.disabled = false;
          status.textContent = '';
          return;
        }
        
        result = await window.electronAPI.deleteAssetType(
          currentSelection.company,
          currentSelection.location,
          currentSelection.assetType
        );
      } else if (currentSelection.location) {
        // Delete location and all its asset types
        const ok = await appConfirm(
          `Are you sure you want to delete the location:\n${currentSelection.company} → ${currentSelection.location}?\n\nThis will also delete ALL asset types in this location.\n\nThis cannot be undone.`
        );
        if (!ok) {
          deleteBtn.disabled = false;
          status.textContent = '';
          return;
        }
        
        result = await window.electronAPI.deleteLocation(
          currentSelection.company,
          currentSelection.location
        );
      } else if (currentSelection.company) {
        // Delete company and all its locations/assets
        const ok = await appConfirm(
          `WARNING: Are you sure you want to delete the entire company:\n${currentSelection.company}?\n\nThis will delete ALL locations and asset types for this company.\n\nThis cannot be undone.`
        );
        if (!ok) {
          deleteBtn.disabled = false;
          status.textContent = '';
          return;
        }
        
        result = await window.electronAPI.deleteCompany(currentSelection.company);
      }
      
      if (result && result.success) {
        status.textContent = 'Deleted successfully. Refreshing...';
        
        // Reset form
        document.getElementById('deleteCompanySelect').value = '';
        document.getElementById('deleteLocationSelect').value = '';
        document.getElementById('deleteLocationSelect').disabled = true;
        document.getElementById('deleteAssetTypeSelect').value = '';
        document.getElementById('deleteAssetTypeSelect').disabled = true;
        currentSelection = { company: null, location: null, assetType: null };
        updatePreview();
        
        // Reload companies
        await loadCompanies();
        
        // Refresh the main app views
        await window.electronAPI.invalidateStationCache();
        
        // Trigger a refresh of the filters if they're visible
        const event = new CustomEvent('lookups-changed');
        window.dispatchEvent(event);

        // Refresh map, list, and filters as requested
        if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
        if (typeof window.refreshMarkers === 'function') setTimeout(window.refreshMarkers, 0);
        if (typeof window.renderList === 'function') setTimeout(window.renderList, 0);
        
        status.textContent = 'Deleted successfully and refreshed.';
        
        setTimeout(() => {
          status.textContent = '';
          deleteBtn.disabled = false;
        }, 3000);
      } else {
        status.textContent = 'Deletion failed: ' + (result?.message || 'Unknown error');
        deleteBtn.disabled = false;
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      deleteBtn.disabled = false;
    }
  }

  async function mountNukePanel() {
    if (mounted) return;
    const panel = document.getElementById('tab-nuke');
    const mount = document.getElementById('nukeMount');
    if (!panel || !mount) return;

    // Load the enhanced HTML
    try {
      const resp = await fetch('nuke.html', { cache: 'no-store' });
      const html = await resp.text();
      mount.innerHTML = html;
    } catch (e) {
      console.error('Failed to load nuke.html:', e);
    }

    // Set up original nuke button
    const nukeBtn = document.getElementById('nukeBtn');
    const nukeStatus = document.getElementById('nukeStatus');
    if (nukeBtn) {
      nukeBtn.addEventListener('click', async () => {
        const ok = await appConfirm(
          'WARNING: This will permanently delete ALL .xlsx files under the data folder (including subfolders) and the .lookups_cache.json file, then restart the app.\n\nDo you want to continue?'
        );
        if (!ok) return;

        nukeBtn.disabled = true;
        if (nukeStatus) nukeStatus.textContent = 'Deleting files and restarting…';

        try {
          const res = await (window.electronAPI?.nukeProgram?.() || Promise.reject(new Error('IPC not available')));
        } catch (e) {
          if (nukeStatus) nukeStatus.textContent = 'Failed: ' + (e && e.message ? e.message : 'Unknown error');
          nukeBtn.disabled = false;
        }
      });
    }

    // Set up selective deletion controls
    const companySelect = document.getElementById('deleteCompanySelect');
    const locationSelect = document.getElementById('deleteLocationSelect');
    const assetTypeSelect = document.getElementById('deleteAssetTypeSelect');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    
    if (companySelect) {
      // Defer loading companies to avoid conflicts with initial boot
      setTimeout(async () => {
        try {
          await loadCompanies();
        } catch (e) {
          console.error('Failed to load companies for deletion:', e);
        }
      }, 1000);

      // Company selection handler
      companySelect.addEventListener('change', async (e) => {
        const companyName = e.target.value;
        currentSelection.company = companyName || null;
        currentSelection.location = null;
        currentSelection.assetType = null;
        
        // Reset downstream selects
        if (locationSelect) {
          locationSelect.value = '';
          locationSelect.disabled = true;
        }
        if (assetTypeSelect) {
          assetTypeSelect.value = '';
          assetTypeSelect.disabled = true;
        }
        
        if (companyName) {
          await loadLocations(companyName);
          if (locationSelect) locationSelect.disabled = false;
        }
        
        updatePreview();
      });
    }
    
    if (locationSelect) {
      // Location selection handler
      locationSelect.addEventListener('change', async (e) => {
        const locationName = e.target.value;
        currentSelection.location = locationName || null;
        currentSelection.assetType = null;
        
        // Reset asset type select
        if (assetTypeSelect) {
          assetTypeSelect.value = '';
          assetTypeSelect.disabled = true;
        }
        
        if (locationName && currentSelection.company) {
          await loadAssetTypes(currentSelection.company, locationName);
          if (assetTypeSelect) assetTypeSelect.disabled = false;
        }
        
        updatePreview();
      });
    }
    
    if (assetTypeSelect) {
      // Asset type selection handler
      assetTypeSelect.addEventListener('change', (e) => {
        const assetTypeName = e.target.value;
        currentSelection.assetType = assetTypeName || null;
        updatePreview();
      });
    }
    
    if (deleteBtn) {
      deleteBtn.addEventListener('click', performDeletion);
    }

    mounted = true;
    setFooterHidden(true);
  }

  // Try once at startup
  document.addEventListener('DOMContentLoaded', () => {
    const active = document.querySelector('.tab-btn.active');
    setFooterHidden(active?.dataset?.tab === 'nuke');
    mountNukePanel();
  });

  // Mount when user clicks the Nuke tab
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    setFooterHidden(btn.dataset.tab === 'nuke');
    if (btn.dataset.tab === 'nuke') setTimeout(mountNukePanel, 0);
  });

  // Watch for DOM changes
  const mo = new MutationObserver(() => mountNukePanel());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // NEW: Listen for global lookup changes (e.g., from add_infra)
  // This ensures the dropdowns are repopulated when a new company/location
  // is added from another part of the application.
  window.addEventListener('lookups-changed', () => {
    // Only reload if the panel is visible/mounted
    if (!mounted) return;
    
    // Reset selection
    currentSelection = { company: null, location: null, assetType: null };
    updatePreview();
    
    // Reset dropdowns
    const companySelect = document.getElementById('deleteCompanySelect');
    const locationSelect = document.getElementById('deleteLocationSelect');
    const assetTypeSelect = document.getElementById('deleteAssetTypeSelect');
    
    if (companySelect) companySelect.value = '';
    if (locationSelect) {
      locationSelect.value = '';
      locationSelect.disabled = true;
      locationSelect.innerHTML = '<option value="">-- Select Location --</option>';
    }
    if (assetTypeSelect) {
      assetTypeSelect.value = '';
      assetTypeSelect.disabled = true;
      assetTypeSelect.innerHTML = '<option value="">-- Select Asset Type --</option>';
    }
    
    // Reload the company list
    loadCompanies();
  });

})();
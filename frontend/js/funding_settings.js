// funding_settings.js - Hierarchical funding override settings
(function() {
  'use strict';

  const fundingSettings = {
    tree: null,
    changes: new Map(), // key format: "company" or "company|location" or "company|location|assetType"
    initialized: false,

    async init() {
      if (this.initialized) return;
      await this.loadTree();
      this.renderTree();
      this.bindEvents();
      this.initialized = true;
    },

    async loadTree() {
      // Get the lookup tree structure
      const api = window.electronAPI || {};
      if (typeof api.getLookupTree !== 'function') {
        this.tree = { companies: [], locationsByCompany: {}, assetsByCompanyLocation: {} };
        return;
      }
      
      try {
        const tree = await api.getLookupTree();
        this.tree = tree || { companies: [], locationsByCompany: {}, assetsByCompanyLocation: {} };
        
        // Load existing funding settings for all locations
        await this.loadExistingSettings();
      } catch (e) {
        console.error('[fundingSettings] Failed to load tree:', e);
        this.tree = { companies: [], locationsByCompany: {}, assetsByCompanyLocation: {} };
      }
    },

    async loadExistingSettings() {
      // Load existing settings from all company files
      this.existingSettings = new Map();

      for (const companyObj of this.tree.companies) {
        const company = companyObj.name || companyObj;
        try {
          const settings = await window.electronAPI.getAllFundingSettings(company);
          // settings is a Map with keys like "company|location|assetType"
          if (settings && typeof settings === 'object') {
            Object.entries(settings).forEach(([key, value]) => {
              this.existingSettings.set(key, value);
            });
          }
        } catch (e) {
          console.error(`[fundingSettings] Failed to load settings for ${company}:`, e);
        }
      }
      
      // Apply loaded settings to the UI
      this.applyLoadedSettings();
    },
    
    applyLoadedSettings() {
      // Apply existing settings to inputs, checking for consistency
      const container = document.getElementById('fundingTree');
      if (!container) return;
      
      // Process each level to check for consistency
      container.querySelectorAll('.funding-inputs').forEach(inputGroup => {
        const level = inputGroup.dataset.level;
        const company = inputGroup.dataset.company;
        const location = inputGroup.dataset.location;
        const assetType = inputGroup.dataset.asset;
        
        // Determine which settings to check for consistency
        let keysToCheck = [];
        
        if (level === 'company') {
          // Check all locations under this company
          const locations = this.tree.locationsByCompany[company] || [];
          locations.forEach(loc => {
            keysToCheck.push(`${company}|${loc}`);
            // Also check asset types under each location
            const assets = this.tree.assetsByCompanyLocation[company]?.[loc] || [];
            assets.forEach(asset => {
              keysToCheck.push(`${company}|${loc}|${asset}`);
            });
          });
        } else if (level === 'location') {
          // Check this specific location
          keysToCheck.push(`${company}|${location}`);
          // And all assets under it
          const assets = this.tree.assetsByCompanyLocation[company]?.[location] || [];
          assets.forEach(asset => {
            keysToCheck.push(`${company}|${location}|${asset}`);
          });
        } else if (level === 'asset') {
          // Check only this specific asset type
          keysToCheck.push(`${company}|${location}|${assetType}`);
        }
        
        // Check consistency for each field
        ['om', 'capital', 'decommission'].forEach(field => {
          const input = inputGroup.querySelector(`input[data-field="${field}"]`);
          if (!input) return;
          
          const values = new Set();
          keysToCheck.forEach(key => {
            const settings = this.existingSettings.get(key);
            if (settings && settings[field] !== undefined) {
              values.add(settings[field]);
            }
          });
          
          // If all values are the same, show that value; otherwise leave blank
          if (values.size === 1) {
            input.value = values.values().next().value;
          } else if (values.size > 1) {
            // Multiple different values - leave blank to indicate inconsistency
            input.value = '';
            input.placeholder = `Mixed (${field})`;
          }
        });
      });
    },

    renderTree() {
      const container = document.getElementById('fundingTree');
      if (!container) return;
      
      container.innerHTML = '';
      const tree = this.tree;

      // Create hierarchical structure similar to Photo Links
      tree.companies.forEach(companyObj => {
        const company = companyObj.name || companyObj;
        const companyDiv = document.createElement('div');
        companyDiv.className = 'tree-company';
        companyDiv.innerHTML = `
          <div class="tree-header">
            <span class="tree-toggle">▶</span>
            <span class="tree-label">${company}</span>
            <div class="funding-inputs" data-level="company" data-company="${company}">
              <input type="text" placeholder="O&M" data-field="om" />
              <input type="text" placeholder="Capital" data-field="capital" />
              <input type="text" placeholder="Decommission" data-field="decommission" />
            </div>
          </div>
          <div class="tree-children" style="display:none;">
        `;
        
        const locations = tree.locationsByCompany[company] || [];
        locations.forEach(location => {
          const locationDiv = document.createElement('div');
          locationDiv.className = 'tree-location';
          locationDiv.innerHTML = `
            <div class="tree-header">
              <span class="tree-toggle">▶</span>
              <span class="tree-label">${location}</span>
              <div class="funding-inputs" data-level="location" data-company="${company}" data-location="${location}">
                <input type="text" placeholder="O&M" data-field="om" />
                <input type="text" placeholder="Capital" data-field="capital" />
                <input type="text" placeholder="Decommission" data-field="decommission" />
              </div>
            </div>
            <div class="tree-children" style="display:none;">
          `;
          
          const assetTypes = tree.assetsByCompanyLocation[company]?.[location] || [];
          assetTypes.forEach(assetType => {
            const assetDiv = document.createElement('div');
            assetDiv.className = 'tree-asset';
            assetDiv.innerHTML = `
              <div class="tree-header">
                <span class="tree-label">${assetType}</span>
                <div class="funding-inputs" data-level="asset" data-company="${company}" data-location="${location}" data-asset="${assetType}">
                  <input type="text" placeholder="O&M" data-field="om" />
                  <input type="text" placeholder="Capital" data-field="capital" />
                  <input type="text" placeholder="Decommission" data-field="decommission" />
                </div>
              </div>
            `;
            locationDiv.querySelector('.tree-children').appendChild(assetDiv);
          });
          
          companyDiv.querySelector('.tree-children').appendChild(locationDiv);
        });
        
        container.appendChild(companyDiv);
      });
    },

    bindEvents() {
      const container = document.getElementById('fundingTree');
      if (!container) return;
      
      // Bind tree toggle events
      container.querySelectorAll('.tree-toggle').forEach(toggle => {
        toggle.addEventListener('click', (e) => {
          const children = e.target.closest('.tree-header').nextElementSibling;
          if (children) {
            const isOpen = children.style.display !== 'none';
            children.style.display = isOpen ? 'none' : 'block';
            e.target.textContent = isOpen ? '▶' : '▼';
          }
        });
      });
      
      // Bind input change events
      container.querySelectorAll('.funding-inputs input').forEach(input => {
        input.addEventListener('input', (e) => {
          const parent = e.target.closest('.funding-inputs');
          const level = parent.dataset.level;
          const company = parent.dataset.company;
          const location = parent.dataset.location;
          const assetType = parent.dataset.asset;
          const field = e.target.dataset.field;
          const value = e.target.value.trim();
          
          // Create a unique key for this setting
          let key = company;
          if (location) key += `|${location}`;
          if (assetType) key += `|${assetType}`;
          
          // Store the change
          if (!this.changes.has(key)) {
            this.changes.set(key, {});
          }
          const settings = this.changes.get(key);
          settings[field] = value;
          
          // Update visual feedback
          parent.classList.add('has-changes');
        });
      });
    },

    hasChanges() {
      return this.changes.size > 0;
    },

    async save() {
      // Generic format validation helper: "number%Token-number%Token-..." and sum in [99,100]
      function isValidFundingFormat(s) {
        const str = String(s || '').trim();
        if (!str) return true; // blank allowed (will auto-populate per station)
        const parts = str.split('-').map(x => x.trim()).filter(Boolean);
        if (!parts.length) return false;
        let total = 0;
        const seen = new Set();
        for (const term of parts) {
          const m = term.match(/^([0-9]+(?:\.[0-9]+)?)%(.+)$/);
          if (!m) return false;
          const pct = parseFloat(m[1]);
          const tok = m[2].trim();
          if (!tok || seen.has(tok)) return false;
          seen.add(tok);
          total += isFinite(pct) ? pct : 0;
        }
        return total >= 99 && total <= 100;
      }

      const results = { success: true, updated: 0, failed: 0 };

      // Process each change
      for (const [key, settings] of this.changes) {
        const parts = key.split('|');
        const company = parts[0];
        const location = parts[1];
        const assetType = parts[2];

        // Validate format for each provided field (allow blanks)
        const vals = [settings.om, settings.capital, settings.decommission];
        for (const v of vals) {
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            if (!isValidFundingFormat(v)) {
              appAlert('Invalid Funding Type Override format. Use percentages like 75%P-25%F that sum to 99–100%.');
              return { success: false, updated: 0, failed: 1 };
            }
          }
        }

        try {
          if (assetType) {
            // Asset-level setting - update only matching assets in this location
            await this.applyToAssetType(company, location, assetType, settings);
          } else if (location) {
            // Location-level setting - update all stations in this location
            await this.applyToLocation(company, location, settings);
          } else {
            // Company-level setting - update all locations under this company
            await this.applyToCompany(company, settings);
          }
          results.updated++;
        } catch (e) {
          console.error('[fundingSettings] Failed to save:', e);
          results.failed++;
        }
      }
      
      if (results.failed === 0) {
        this.changes.clear();
        document.querySelectorAll('.funding-inputs.has-changes').forEach(el => {
          el.classList.remove('has-changes');
        });
      }
      
      return results;
    },

    async applyToCompany(company, settings) {
      // Apply settings to all locations under this company
      const locations = this.tree.locationsByCompany[company] || [];
      for (const location of locations) {
        await window.electronAPI.saveFundingSettings(company, location, settings);
      }
    },

    async applyToLocation(company, location, settings) {
      // Apply settings to specific location
      await window.electronAPI.saveFundingSettings(company, location, settings);
    },

    async applyToAssetType(company, location, assetType, settings) {
      // This would need a new backend method to apply settings only to specific asset types
      // For now, we'll save at the location level with a filter
      await window.electronAPI.saveFundingSettingsForAssetType(company, location, assetType, settings);
    },

    cancel() {
      this.changes.clear();
      document.querySelectorAll('.funding-inputs.has-changes').forEach(el => {
        el.classList.remove('has-changes');
      });
      // Reset input values to original
      this.renderTree();
    }
  };

  // Expose globally
  window.fundingSettings = fundingSettings;
})();

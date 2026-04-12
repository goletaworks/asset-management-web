// webApi.js -- Browser-side shim that provides window.electronAPI backed by fetch().
// This mirrors the exact shape of preload.js so existing frontend JS needs zero changes.
'use strict';

(function () {
  const enc = (v) => encodeURIComponent(v);

  async function api(method, url, body) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body !== undefined && method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok && res.status === 401) {
      window.location.href = '/login.html';
      return { success: false, code: 'unauthorized' };
    }
    return res.json();
  }

  function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) sp.set(k, v);
    }
    const s = sp.toString();
    return s ? '?' + s : '';
  }

  // Browser file picker helper (returns { filePaths: string[] } with File objects stored on ._files)
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.multiple = !!multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        document.body.removeChild(input);
        if (!files.length) {
          resolve({ filePaths: [], _files: [] });
        } else {
          resolve({
            filePaths: files.map(f => f.name),
            _files: files,
          });
        }
      });
      input.addEventListener('cancel', () => {
        document.body.removeChild(input);
        resolve({ filePaths: [], _files: [] });
      });
      input.click();
    });
  }

  window.electronAPI = {
    // ─── Stations ──────────────────────────────────────────────────────────
    getStationData: (opts) => api('GET', '/api/stations' + qs(opts || {})),
    invalidateStationCache: () => api('POST', '/api/stations/invalidate'),
    manualCreateInstance: (payload) => api('POST', '/api/stations/manual', payload),
    updateStationData: (stationData, schema) => api('PUT', '/api/stations', { stationData, schema }),
    deleteStation: (company, location, stationId) =>
      api('DELETE', `/api/stations/${enc(company)}/${enc(location)}/${enc(stationId)}`),
    importSelection: (payload) => api('POST', '/api/stations/import', payload),

    // ─── Lookups ───────────────────────────────────────────────────────────
    getLookupTree: () => api('GET', '/api/lookups/tree'),
    getActiveCompanies: () => api('GET', '/api/lookups/companies'),
    getLocationsForCompany: (company) => api('GET', '/api/lookups/locations' + qs({ company })),
    getAssetTypesForLocation: (company, location) =>
      api('GET', '/api/lookups/asset-types' + qs({ company, location })),
    upsertCompany: (name, active, description, email) =>
      api('POST', '/api/lookups/company', { name, active: !!active, description, email }),
    upsertLocation: (location, company) =>
      api('POST', '/api/lookups/location', { location, company }),
    upsertAssetType: (assetType, company, location) =>
      api('POST', '/api/lookups/asset-type', { assetType, company, location }),
    setLocationLink: (company, location, link) =>
      api('PUT', '/api/lookups/location-link', { company, location, link }),
    setAssetTypeLink: (assetType, company, location, link) =>
      api('PUT', '/api/lookups/asset-type-link', { assetType, company, location, link }),

    // ─── Colors ────────────────────────────────────────────────────────────
    getColorMaps: () => api('GET', '/api/colors/maps'),
    setAssetTypeColor: (assetType, color) =>
      api('PUT', '/api/colors/asset-type', { assetType, color }),
    setAssetTypeColorForLocation: (assetType, location, color) =>
      api('PUT', '/api/colors/asset-type-location', { assetType, location, color }),
    setAssetTypeColorForCompanyLocation: (assetType, company, location, color) =>
      api('PUT', '/api/colors/asset-type-company-location', { assetType, company, location, color }),
    getRepairColorMaps: () => api('GET', '/api/colors/repair-maps'),
    setRepairColorForCompanyLocation: (assetType, company, location, color) =>
      api('PUT', '/api/colors/repair-company-location', { assetType, company, location, color }),

    // ─── Materials ─────────────────────────────────────────────────────────
    getMaterialsForCompany: (company) => api('GET', '/api/materials' + qs({ company })),
    saveMaterialLocation: (company, payload) =>
      api('POST', '/api/materials/location', { company, payload }),
    saveMaterial: (company, payload) =>
      api('POST', '/api/materials/material', { company, payload }),
    deleteMaterial: (company, materialId) =>
      api('DELETE', '/api/materials/material', { company, materialId }),
    saveMaterialFilters: (company, filters) =>
      api('POST', '/api/materials/filters', { company, filters }),

    // ─── Excel helpers ─────────────────────────────────────────────────────
    excelListSheets: (b64) => api('POST', '/api/excel/list-sheets', { b64 }),
    excelParseRowsFromSheet: (b64, sheetName) =>
      api('POST', '/api/excel/parse-rows-from-sheet', { b64, sheetName }),
    importRepairsExcel: (b64) => api('POST', '/api/excel/import-repairs', { b64 }),

    readLocationWorkbook: (company, locationName) =>
      api('GET', '/api/excel/location-workbook' + qs({ company, locationName })),
    readSheetData: (company, locationName, sheetName) =>
      api('GET', '/api/excel/sheet-data' + qs({ company, locationName, sheetName })),
    updateAssetTypeSchema: (assetType, schema, excludeStationId) =>
      api('POST', '/api/excel/update-schema', { assetType, schema, excludeStationId }),

    syncAssetTypeSchema: (assetType, schema, excludeStationId) =>
      api('POST', '/api/excel/sync-schema', { assetType, schema, excludeStationId }),
    getExistingSchema: (assetType) =>
      api('GET', '/api/excel/existing-schema' + qs({ assetType })),

    getWorkbookFieldCatalog: (company, location) =>
      api('GET', '/api/excel/field-catalog' + qs({ company, locationName: location })),

    // Funding
    getFundingSettings: (company, location) =>
      api('GET', '/api/excel/funding-settings' + qs({ company, location })),
    saveFundingSettings: (company, location, settings) =>
      api('POST', '/api/excel/funding-settings', { company, location, settings }),
    saveFundingSettingsForAssetType: (company, location, assetType, settings) =>
      api('POST', '/api/excel/funding-settings-asset-type', { company, location, assetType, settings }),
    getAllFundingSettings: (company) =>
      api('GET', '/api/excel/all-funding-settings' + qs({ company })),
    normalizeFundingOverrides: () =>
      api('POST', '/api/excel/normalize-funding-overrides'),

    // Algorithm parameters
    getAlgorithmParameters: () => api('GET', '/api/excel/algorithm-parameters'),
    saveAlgorithmParameters: (rows) => api('POST', '/api/excel/algorithm-parameters', { rows }),
    getWorkplanConstants: () => api('GET', '/api/excel/workplan-constants'),
    saveWorkplanConstants: (rows) => api('POST', '/api/excel/workplan-constants', { rows }),
    getCustomWeights: () => api('GET', '/api/excel/custom-weights'),
    addCustomWeight: (weight, active) => api('POST', '/api/excel/custom-weight', { weight, active: !!active }),
    getFixedParameters: () => api('GET', '/api/excel/fixed-parameters'),
    saveFixedParameters: (params) => api('POST', '/api/excel/fixed-parameters', { params }),

    // ─── Algorithms ────────────────────────────────────────────────────────
    optimizeWorkplan: (payload) => api('POST', '/api/algo/optimize-workplan', payload),
    groupRepairsIntoTrips: (payload) => api('POST', '/api/algo/group-repairs-into-trips', payload),
    assignTripsToYears: (payload) => api('POST', '/api/algo/assign-trips-to-years', payload),
    assignRepairsToYearsIndividually: (params) => api('POST', '/api/algo/assign-repairs-individually', params),
    groupTripsWithinYears: (params) => api('POST', '/api/algo/group-trips-within-years', params),
    assignRepairsToYearsWithDeadlines: (params) => api('POST', '/api/algo/assign-repairs-with-deadlines', params),

    // ─── Inspections ───────────────────────────────────────────────────────
    listInspections: (siteName, stationId, opts) => {
      const q = { siteName, stationId };
      if (opts && opts.keywords) q.keywords = opts.keywords.join(',');
      return api('GET', '/api/inspections' + qs(q));
    },
    getInspectionKeywords: () => api('GET', '/api/inspections/keywords'),
    setInspectionKeywords: (keywords) =>
      api('PUT', '/api/inspections/keywords', { keywords: Array.isArray(keywords) ? keywords : [] }),
    deleteInspection: (siteName, stationId, folderName) =>
      api('DELETE', `/api/inspections/${enc(siteName)}/${enc(stationId)}/${enc(folderName)}`),

    pickInspectionPhotos: () => pickFiles('image/*', true),
    pickInspectionReport: () => pickFiles('.pdf', false).then(r => ({ filePath: r._files?.[0] || null, _file: r._files?.[0] || null })),

    createInspection: async (siteName, stationId, payload) => {
      const fd = new FormData();
      fd.append('siteName', siteName);
      fd.append('stationId', stationId);
      const { filePaths, reportPath, _photoFiles, _reportFile, ...rest } = payload;
      fd.append('payload', JSON.stringify(rest));
      if (_photoFiles) {
        for (const f of _photoFiles) fd.append('photos', f, f.name);
      }
      if (_reportFile) {
        fd.append('report', _reportFile, _reportFile.name);
      }
      const res = await fetch('/api/inspections', { method: 'POST', credentials: 'include', body: fd });
      return res.json();
    },

    // ─── Projects ──────────────────────────────────────────────────────────
    listProjects: (siteName, stationId, opts) => {
      const q = { siteName, stationId };
      if (opts && opts.keywords) q.keywords = opts.keywords.join(',');
      return api('GET', '/api/projects' + qs(q));
    },
    getProjectKeywords: () => api('GET', '/api/projects/keywords'),
    setProjectKeywords: (keywords) =>
      api('PUT', '/api/projects/keywords', { keywords: Array.isArray(keywords) ? keywords : [] }),
    deleteProject: (siteName, stationId, folderName) =>
      api('DELETE', `/api/projects/${enc(siteName)}/${enc(stationId)}/${enc(folderName)}`),

    pickProjectPhotos: () => pickFiles('image/*', true),
    pickProjectReport: () => pickFiles('.pdf', false).then(r => ({ filePath: r._files?.[0] || null, _file: r._files?.[0] || null })),

    createProject: async (siteName, stationId, payload) => {
      const fd = new FormData();
      fd.append('siteName', siteName);
      fd.append('stationId', stationId);
      const { filePaths, reportPath, _photoFiles, _reportFile, ...rest } = payload;
      fd.append('payload', JSON.stringify(rest));
      if (_photoFiles) {
        for (const f of _photoFiles) fd.append('photos', f, f.name);
      }
      if (_reportFile) {
        fd.append('report', _reportFile, _reportFile.name);
      }
      const res = await fetch('/api/projects', { method: 'POST', credentials: 'include', body: fd });
      return res.json();
    },

    // ─── Repairs ───────────────────────────────────────────────────────────
    listRepairs: (siteName, stationId) =>
      api('GET', '/api/repairs' + qs({ siteName, stationId })),
    saveRepairs: (siteName, stationId, items) =>
      api('POST', '/api/repairs/save', { siteName, stationId, items }),
    appendRepair: (payload) => api('POST', '/api/repairs/append', payload),
    getAllRepairs: () => api('GET', '/api/repairs/all'),
    addRepairToLocation: (location, assetType, repair) =>
      api('POST', '/api/repairs/add', { location, assetType, repair }),

    // ─── Photos ────────────────────────────────────────────────────────────
    getStationPhotoStructure: (siteName, stationId, subPath) =>
      api('GET', '/api/photos/structure' + qs({ siteName, stationId, subPath })),
    getRecentPhotos: (siteName, stationId, limit) =>
      api('GET', '/api/photos/recent' + qs({ siteName, stationId, limit: limit || 5 })),
    getPhotoUrl: async (siteName, stationId, photoPath) => {
      const url = '/api/photos/file' + qs({ siteName, stationId, photoPath });
      return { success: true, url };
    },
    createPhotoFolder: (siteName, stationId, folderPath) =>
      api('POST', '/api/photos/folder', { siteName, stationId, folderPath }),
    deletePhoto: (siteName, stationId, photoPath) =>
      api('DELETE', '/api/photos/file', { siteName, stationId, photoPath }),
    deleteFolder: (siteName, stationId, folderPath) =>
      api('DELETE', '/api/photos/folder', { siteName, stationId, folderPath }),
    savePhotos: async (siteName, stationId, folderPath, files) => {
      const fd = new FormData();
      fd.append('siteName', siteName);
      fd.append('stationId', stationId);
      fd.append('folderPath', folderPath || '');
      if (files) {
        for (const f of files) {
          if (f instanceof File) {
            fd.append('files', f, f.name);
          } else if (f.data) {
            fd.append('files', new Blob([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))]), f.name);
          }
        }
      }
      const res = await fetch('/api/photos/upload', { method: 'POST', credentials: 'include', body: fd });
      return res.json();
    },

    // ─── Documents ─────────────────────────────────────────────────────────
    getStationDocumentStructure: (siteName, stationId, subPath) =>
      api('GET', '/api/documents/structure' + qs({ siteName, stationId, subPath })),
    createDocumentFolder: (siteName, stationId, folderPath) =>
      api('POST', '/api/documents/folder', { siteName, stationId, folderPath }),
    openDocument: (siteName, stationId, docPath) => {
      const url = '/api/documents/file' + qs({ siteName, stationId, docPath });
      window.open(url, '_blank');
      return Promise.resolve({ success: true });
    },
    revealDocument: (siteName, stationId, docPath) => {
      const url = '/api/documents/file' + qs({ siteName, stationId, docPath });
      window.open(url, '_blank');
      return Promise.resolve({ success: true });
    },
    deleteDocument: (siteName, stationId, docPath) =>
      api('DELETE', '/api/documents/file', { siteName, stationId, docPath }),
    deleteDocumentFolder: (siteName, stationId, folderPath) =>
      api('DELETE', '/api/documents/folder', { siteName, stationId, folderPath }),
    saveDocuments: async (siteName, stationId, folderPath, files) => {
      const fd = new FormData();
      fd.append('siteName', siteName);
      fd.append('stationId', stationId);
      fd.append('folderPath', folderPath || '');
      if (files) {
        for (const f of files) {
          if (f instanceof File) {
            fd.append('files', f, f.name);
          } else if (f.data) {
            fd.append('files', new Blob([Uint8Array.from(atob(f.data), c => c.charCodeAt(0))]), f.name);
          }
        }
      }
      const res = await fetch('/api/documents/upload', { method: 'POST', credentials: 'include', body: fd });
      return res.json();
    },

    // ─── Settings ──────────────────────────────────────────────────────────
    getStatusRepairSettings: () => api('GET', '/api/settings/status'),
    setStatusColor: (statusKey, color) => api('PUT', '/api/settings/status-color', { key: statusKey, color }),
    deleteStatus: (statusKey) => api('DELETE', '/api/settings/status', { key: statusKey }),
    setApplyStatusColors: (flag) => api('PUT', '/api/settings/apply-status-colors', { flag: !!flag }),
    setApplyRepairColors: (flag) => api('PUT', '/api/settings/apply-repair-colors', { flag: !!flag }),
    setStatusOverridesRepair: (flag) => api('PUT', '/api/settings/status-priority', { flag: !!flag }),
    getPhotosBase: (ctx) => api('GET', '/api/settings/photos-base' + qs(ctx || {})),

    // ─── Nuke ──────────────────────────────────────────────────────────────
    nukeProgram: () => api('POST', '/api/nuke/run'),
    deleteCompany: (companyName) => api('POST', '/api/nuke/delete-company', { companyName }),
    deleteLocation: (companyName, locationName) =>
      api('POST', '/api/nuke/delete-location', { companyName, locationName }),
    deleteAssetType: (companyName, locationName, assetTypeName) =>
      api('POST', '/api/nuke/delete-asset-type', { companyName, locationName, assetTypeName }),

    // ─── Config ────────────────────────────────────────────────────────────
    getDbConfig: () => api('GET', '/api/config/db'),
    getTestTabEnabled: () => api('GET', '/api/config/test-tab-enabled'),

    // ─── Auth ──────────────────────────────────────────────────────────────
    hasUsers: () => api('GET', '/api/auth/has-users'),
    createUser: (userData) => api('POST', '/api/auth/register', userData),
    adminCreateUser: (userData) => api('POST', '/api/auth/admin/create', userData),
    loginUser: (name, password) => api('POST', '/api/auth/login', { name, password }),
    logoutUser: () => api('POST', '/api/auth/logout'),
    logoutAndShowLogin: () => api('POST', '/api/auth/logout').then(() => { window.location.href = '/login.html'; }),
    getCurrentUser: () => api('GET', '/api/auth/me'),
    getAllUsers: () => api('GET', '/api/auth/users'),
    updateUser: (target, updates) => api('PUT', `/api/auth/users/${enc(target)}`, updates),
    deleteUser: (target) => api('DELETE', `/api/auth/users/${enc(target)}`),
    sendAccessRequest: (data) => api('POST', '/api/auth/access-request', data),
    createUserWithCode: (payload) => api('POST', '/api/auth/create-with-code', payload),
    navigateToMain: () => { window.location.href = '/'; },

    // ─── Browse for folder (not applicable in web) ─────────────────────────
    browseForFolder: () => Promise.resolve(prompt('Enter server folder path:')).then(p => p ? { path: p } : null),

    // ─── Excel progress (SSE) ──────────────────────────────────────────────
    onExcelProgress: (handler) => {
      const es = new EventSource('/api/progress');
      es.onmessage = (e) => { try { handler(JSON.parse(e.data)); } catch (_) {} };
      return () => es.close();
    },
  };
})();

// frontend/js/documents_tab.js
(function() {
  'use strict';

  let currentStation = null;
  let currentPath = '';
  let allDocuments = [];
  let allFolders = [];
  let allFolderPaths = [];
  let searchTerm = '';
  let filterType = '';
  let pendingDocumentUploads = []; // [{ file: File, newName: string }]

  /**
   * Initialize the documents tab
   */
  async function initDocumentsTab(container, station) {
    currentStation = station;
    currentPath = '';
    
    if (!container || !station) {
      console.error('[documents_tab] Invalid initialization parameters');
      return;
    }

    setupEventHandlers(container);
    await loadDocumentStructure(container);
  }

  /**
   * Setup event handlers
   */
  function setupEventHandlers(container) {
    // Add Documents button
    const addBtn = container.querySelector('#addDocumentBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => showAddDocumentModal(container));
    }

    // Create Folder button
    const createFolderBtn = container.querySelector('#createDocFolderBtn');
    if (createFolderBtn) {
      createFolderBtn.addEventListener('click', () => showCreateFolderModal(container));
    }

    // Breadcrumb navigation
    const breadcrumb = container.querySelector('#documentsBreadcrumb');
    if (breadcrumb) {
      breadcrumb.addEventListener('click', (e) => {
        const item = e.target.closest('.breadcrumb-item');
        if (item && item.dataset.path !== undefined) {
          navigateToPath(container, item.dataset.path);
        }
      });
    }

    // Search input
    const searchInput = container.querySelector('#documentSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.toLowerCase();
        renderDocumentsList(container);
      });
    }

    // Type filter
    const typeFilter = container.querySelector('#documentTypeFilter');
    if (typeFilter) {
      typeFilter.addEventListener('change', (e) => {
        filterType = e.target.value;
        renderDocumentsList(container);
      });
    }

    // Modal close handlers
    container.querySelectorAll('[data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        closeModal(container, modalId);
      });
    });

    // File input change
    const fileInput = container.querySelector('#documentFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        await handleFileSelection(container, e.target.files);
      });
    }

    // Upload button
    const uploadBtn = container.querySelector('#uploadDocumentsBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => uploadDocuments(container));
    }

    // Create folder button
    const createFolderConfirmBtn = container.querySelector('#createDocFolderConfirmBtn');
    if (createFolderConfirmBtn) {
      createFolderConfirmBtn.addEventListener('click', () => createFolder(container));
    }

    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      const contextMenu = container.querySelector('#documentContextMenu');
      if (contextMenu && !contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
      }
    });
  }

  /**
   * Load document structure from backend
   */
  async function loadDocumentStructure(container, path = '') {
    currentPath = path;
    
    const loading = container.querySelector('#documentsLoading');
    const empty = container.querySelector('#documentsEmpty');
    const list = container.querySelector('#documentsList');

    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (list) list.style.display = 'none';

    try {
      const result = await window.electronAPI.getStationDocumentStructure(
        currentStation.name,
        currentStation.station_id,
        path
      );

      if (!result.success) {
        throw new Error(result.message || 'Failed to load documents');
      }

      // Store data
      allFolders = result.folders;
      allDocuments = result.documents;

      // Update breadcrumb
      updateBreadcrumb(container, path);

      // Render list
      renderDocumentsList(container);

      // Update folder lists for modals
      await updateFolderLists(container);

    } catch (e) {
      console.error('[documents_tab] Failed to load documents:', e);
      if (empty) {
        empty.querySelector('h3').textContent = 'Error Loading Documents';
        empty.querySelector('p').textContent = e.message;
        empty.style.display = 'flex';
      }
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }

  /**
   * Update breadcrumb navigation
   */
  function updateBreadcrumb(container, path) {
    const breadcrumb = container.querySelector('#documentsBreadcrumb');
    if (!breadcrumb) return;

    breadcrumb.innerHTML = '';

    // Root
    const root = document.createElement('span');
    root.className = 'breadcrumb-item';
    root.dataset.path = '';
    root.textContent = 'Documents';
    if (!path) root.classList.add('active');
    breadcrumb.appendChild(root);

    // Path segments
    if (path) {
      const segments = path.split('/').filter(Boolean);
      let currentSegmentPath = '';
      
      segments.forEach((segment, index) => {
        currentSegmentPath += (currentSegmentPath ? '/' : '') + segment;
        
        const separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = '/';
        breadcrumb.appendChild(separator);

        const item = document.createElement('span');
        item.className = 'breadcrumb-item';
        item.dataset.path = currentSegmentPath;
        item.textContent = segment;
        if (index === segments.length - 1) item.classList.add('active');
        breadcrumb.appendChild(item);
      });
    }
  }

  /**
   * Render documents list with filtering
   */
  function renderDocumentsList(container) {
    const listEl = container.querySelector('#documentsList');
    const empty = container.querySelector('#documentsEmpty');
    const list = container.querySelector('#documentsList');

    if (!listEl) return;

    listEl.innerHTML = '';

    // Apply filters
    let filteredFolders = [...allFolders];
    let filteredDocuments = [...allDocuments];

    // Search filter
    if (searchTerm) {
      filteredFolders = filteredFolders.filter(f => 
        f.name.toLowerCase().includes(searchTerm)
      );
      filteredDocuments = filteredDocuments.filter(d => 
        d.name.toLowerCase().includes(searchTerm)
      );
    }

    // Type filter
    if (filterType) {
      const allowedExts = filterType.split(',');
      filteredDocuments = filteredDocuments.filter(d => 
        allowedExts.includes(d.extension)
      );
    }

    // Show empty state if no content
    if (filteredFolders.length === 0 && filteredDocuments.length === 0) {
      if (empty) empty.style.display = 'flex';
      if (list) list.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (list) list.style.display = 'block';

    // Render folders
    filteredFolders.forEach(folder => {
      const folderItem = createFolderItem(folder);
      listEl.appendChild(folderItem);
    });

    // Render documents
    filteredDocuments.forEach(doc => {
      const docItem = createDocumentItem(container, doc);
      listEl.appendChild(docItem);
    });
  }

  /**
   * Create folder list item
   */
  function createFolderItem(folder) {
    const item = document.createElement('div');
    item.className = 'document-item document-item--folder';
    
    const modifiedDate = new Date(folder.modifiedDate);
    const dateStr = modifiedDate.toLocaleDateString() + ' ' + modifiedDate.toLocaleTimeString();

    item.innerHTML = `
      <div class="document-item-icon">📁</div>
      <div class="document-item-info">
        <div class="document-item-name">${escapeHtml(folder.name)}</div>
        <div class="document-item-meta">
          <span class="document-item-type">Folder</span>
          <span class="document-item-date">${dateStr}</span>
        </div>
      </div>
      <div class="document-item-actions">
        <button class="btn-icon" title="Open folder">
          <span>→</span>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (!e.target.closest('.document-item-actions')) {
        const container = document.querySelector('.documents-tab-container');
        navigateToPath(container, folder.path);
      }
    });

    return item;
  }

  /**
   * Create document list item
   */
  function createDocumentItem(container, doc) {
    const item = document.createElement('div');
    item.className = 'document-item';
    item.dataset.docPath = doc.path;
    
    const modifiedDate = new Date(doc.modifiedDate);
    const dateStr = modifiedDate.toLocaleDateString() + ' ' + modifiedDate.toLocaleTimeString();

    item.innerHTML = `
      <div class="document-item-icon">${doc.icon}</div>
      <div class="document-item-info">
        <div class="document-item-name">${escapeHtml(doc.name)}</div>
        <div class="document-item-meta">
          <span class="document-item-size">${doc.sizeFormatted}</span>
          <span class="document-item-date">${dateStr}</span>
          <span class="document-item-type">${doc.extension.toUpperCase().slice(1)}</span>
        </div>
      </div>
      <div class="document-item-actions">
        <button class="btn-icon btn-icon--primary" title="Open document" data-action="open">
          <span>📂</span>
        </button>
        <button class="btn-icon" title="More actions" data-action="more">
          <span>⋮</span>
        </button>
      </div>
    `;

    // Open button
    const openBtn = item.querySelector('[data-action="open"]');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDocument(doc);
      });
    }

    // More button (context menu)
    const moreBtn = item.querySelector('[data-action="more"]');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showContextMenu(container, e, doc);
      });
    }

    // Double-click to open
    item.addEventListener('dblclick', () => {
      openDocument(doc);
    });

    return item;
  }

  /**
   * Show context menu for document
   */
  function showContextMenu(container, event, doc) {
    const contextMenu = container.querySelector('#documentContextMenu');
    if (!contextMenu) return;

    // Position menu
    contextMenu.style.display = 'block';
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';

    // Remove old listeners
    const newMenu = contextMenu.cloneNode(true);
    contextMenu.parentNode.replaceChild(newMenu, contextMenu);

    // Add new listeners
    newMenu.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        newMenu.style.display = 'none';

        if (action === 'open') {
          await openDocument(doc);
        } else if (action === 'reveal') {
          await revealDocument(doc);
        } else if (action === 'delete') {
          await deleteDocument(container, doc);
        }
      });
    });
  }

  /**
   * Open document in default application
   */
  async function openDocument(doc) {
    try {
      const result = await window.electronAPI.openDocument(
        currentStation.name,
        currentStation.station_id,
        doc.path
      );

      if (!result.success) {
        throw new Error(result.message || 'Failed to open document');
      }
    } catch (e) {
      console.error('[documents_tab] Failed to open document:', e);
      appAlert('Failed to open document: ' + e.message);
    }
  }

  /**
   * Reveal document in file explorer
   */
  async function revealDocument(doc) {
    try {
      const result = await window.electronAPI.revealDocument(
        currentStation.name,
        currentStation.station_id,
        doc.path
      );

      if (!result.success) {
        throw new Error(result.message || 'Failed to reveal document');
      }
    } catch (e) {
      console.error('[documents_tab] Failed to reveal document:', e);
      appAlert('Failed to reveal document: ' + e.message);
    }
  }

  /**
   * Delete document
   */
  async function deleteDocument(container, doc) {
    const confirmed = await appConfirm(`Are you sure you want to delete "${doc.name}"?`);
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.deleteDocument(
        currentStation.name,
        currentStation.station_id,
        doc.path
      );

      if (result.success) {
        appAlert('Document deleted successfully');
        await loadDocumentStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Failed to delete document');
      }
    } catch (e) {
      console.error('[documents_tab] Delete failed:', e);
      appAlert('Failed to delete document: ' + e.message);
    }
  }

  /**
   * Navigate to a specific path
   */
  async function navigateToPath(container, path) {
    await loadDocumentStructure(container, path);
  }

  /**
   * Show add document modal
   */
  function showAddDocumentModal(container) {
    const modal = container.querySelector('#addDocumentModal');
    if (modal) {
      const fileInput = container.querySelector('#documentFileInput');
      const preview = container.querySelector('#documentPreview');
      const uploadBtn = container.querySelector('#uploadDocumentsBtn');
      const folderSelect = container.querySelector('#documentFolderSelect');

      if (fileInput) fileInput.value = '';
      if (preview) preview.innerHTML = '';
      if (uploadBtn) uploadBtn.disabled = true;
      if (folderSelect) folderSelect.value = currentPath;

      modal.style.display = 'flex';
    }
  }

  /**
   * Show create folder modal
   */
  function showCreateFolderModal(container) {
    const modal = container.querySelector('#createDocFolderModal');
    if (modal) {
      const nameInput = container.querySelector('#docFolderNameInput');
      const parentSelect = container.querySelector('#parentDocFolderSelect');

      if (nameInput) nameInput.value = '';
      if (parentSelect) parentSelect.value = currentPath;

      modal.style.display = 'flex';
      setTimeout(() => nameInput?.focus(), 100);
    }
  }

  /**
   * Close modal
   */
  function closeModal(container, modalId) {
    const modal = container.querySelector(`#${modalId}`);
    if (modal) modal.style.display = 'none';
  }

  /**
   * Handle file selection
   */
  function handleFileSelection(container, files) {
    const preview = container.querySelector('#documentPreview');
    const uploadBtn = container.querySelector('#uploadDocumentsBtn');

    if (!preview || !uploadBtn) return;

    preview.innerHTML = '';
    pendingDocumentUploads = [];

    if (files.length === 0) {
      uploadBtn.disabled = true;
      return;
    }

    (async () => {
      try {
        if (typeof window.openFileNamingPopup !== 'function' || typeof window.applyNamingToList !== 'function') {
          pendingDocumentUploads = Array.from(files).map(f => ({ file: f, newName: f.name }));
          renderPreviewWithNames();
          uploadBtn.disabled = false;
          return;
        }

        const cfg = await window.openFileNamingPopup({
          station: currentStation,
          files: Array.from(files),
          defaultExt: ''
        });

        if (!cfg) {
          const fileInput = container.querySelector('#documentFileInput');
          if (fileInput) fileInput.value = '';
          preview.innerHTML = '';
          uploadBtn.disabled = true;
          pendingDocumentUploads = [];
          return;
        }

        const renamed = window.applyNamingToList({
          station: currentStation,
          files: Array.from(files).map(f => ({ originalName: f.name, ext: (f.name.match(/\.[^.]+$/) || [''])[0] })),
          config: cfg
        });

        pendingDocumentUploads = Array.from(files).map((f, i) => ({
          file: f,
          newName: renamed[i]?.newName || f.name
        }));

        renderPreviewWithNames();
        uploadBtn.disabled = false;
      } catch (e) {
        console.error('[documents_tab] naming popup failed:', e);
        pendingDocumentUploads = Array.from(files).map(f => ({ file: f, newName: f.name }));
        renderPreviewWithNames();
        uploadBtn.disabled = false;
      }
    })();

    function renderPreviewWithNames() {
      preview.innerHTML = '';
      pendingDocumentUploads.forEach(({ file, newName }) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'document-preview-item';

        const ext = String(newName).split('.').pop().toLowerCase();
        const iconMap = {
          'pdf': '📄', 'doc': '📝', 'docx': '📝',
          'xls': '📊', 'xlsx': '📊',
          'ppt': '📽️', 'pptx': '📽️',
          'txt': '📃', 'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️'
        };
        const icon = iconMap[ext] || '📄';
        const sizeKB = (file.size / 1024).toFixed(1);

        previewItem.innerHTML = `
          <div class="document-preview-icon">${icon}</div>
          <div class="document-preview-info">
            <div class="document-preview-name">${escapeHtml(newName)}</div>
            <div class="document-preview-size">${sizeKB} KB</div>
          </div>
        `;
        preview.appendChild(previewItem);
      });
    }
  }

  /**
   * Upload documents
   */
  async function uploadDocuments(container) {
    const fileInput = container.querySelector('#documentFileInput');
    const folderSelect = container.querySelector('#documentFolderSelect');
    const uploadBtn = container.querySelector('#uploadDocumentsBtn');

    const batch = (Array.isArray(pendingDocumentUploads) && pendingDocumentUploads.length)
      ? pendingDocumentUploads
      : (fileInput?.files?.length ? Array.from(fileInput.files).map(f => ({ file: f, newName: f.name })) : []);

    if (!batch.length) {
      return;
    }

    const targetFolder = folderSelect?.value || '';

    try {
      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';
      }

      // Convert files to base64
      const filePromises = batch.map(({ file, newName }) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve({ name: newName, data: base64 });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      const filesData = await Promise.all(filePromises);

      // Upload to backend
      const result = await window.electronAPI.saveDocuments(
        currentStation.name,
        currentStation.station_id,
        targetFolder,
        filesData
      );

      if (result.success) {
        appAlert(`Successfully uploaded ${result.saved.length} document(s)`);
        closeModal(container, 'addDocumentModal');
        pendingDocumentUploads = [];
        await loadDocumentStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Upload failed');
      }

    } catch (e) {
      console.error('[documents_tab] Upload failed:', e);
      appAlert('Failed to upload documents: ' + e.message);
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload Documents';
      }
    }
  }

  /**
   * Create new folder
   */
  async function createFolder(container) {
    const nameInput = container.querySelector('#docFolderNameInput');
    const parentSelect = container.querySelector('#parentDocFolderSelect');
    const createBtn = container.querySelector('#createDocFolderConfirmBtn');

    if (!nameInput) return;

    const folderName = nameInput.value.trim();
    if (!folderName) {
      appAlert('Please enter a folder name');
      return;
    }

    const safeName = folderName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
    const parentPath = parentSelect?.value || '';
    const fullPath = parentPath ? `${parentPath}/${safeName}` : safeName;

    try {
      if (createBtn) {
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
      }

      const result = await window.electronAPI.createDocumentFolder(
        currentStation.name,
        currentStation.station_id,
        fullPath
      );

      if (result.success) {
        appAlert('Folder created successfully');
        closeModal(container, 'createDocFolderModal');
        await loadDocumentStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Failed to create folder');
      }

    } catch (e) {
      console.error('[documents_tab] Create folder failed:', e);
      appAlert('Failed to create folder: ' + e.message);
    } finally {
      if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Folder';
      }
    }
  }

  /**
   * Update folder lists in modals
   */
  async function updateFolderLists(container) {
    const folders = await getAllFolders();
    allFolderPaths = folders;

    // Update add document modal folder select
    const docFolderSelect = container.querySelector('#documentFolderSelect');
    if (docFolderSelect) {
      docFolderSelect.innerHTML = '<option value="">Root folder</option>';
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.path;
        option.textContent = folder.path;
        docFolderSelect.appendChild(option);
      });
    }

    // Update create folder modal parent select
    const parentFolderSelect = container.querySelector('#parentDocFolderSelect');
    if (parentFolderSelect) {
      parentFolderSelect.innerHTML = '<option value="">Root folder</option>';
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.path;
        option.textContent = folder.path;
        parentFolderSelect.appendChild(option);
      });
    }
  }

  /**
   * Get all folders recursively
   */
  async function getAllFolders(path = '', result = []) {
    try {
      const structure = await window.electronAPI.getStationDocumentStructure(
        currentStation.name,
        currentStation.station_id,
        path
      );

      if (!structure.success) return result;

      for (const folder of structure.folders) {
        result.push({ path: folder.path, name: folder.name });
        await getAllFolders(folder.path, result);
      }

      return result;
    } catch (e) {
      return result;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  // Export initialization function
  window.initDocumentsTab = initDocumentsTab;

})();
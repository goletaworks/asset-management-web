// frontend/js/photo_tab.js
(function() {
  'use strict';

  let currentStation = null;
  let currentPath = '';
  let currentPhotos = [];
  let currentPhotoIndex = -1;
  let allFolderPaths = []; // For folder selection dropdowns
  let pendingPhotoUploads = []; // [{ file: File, newName: string }]
    // ===== Photo viewer zoom/pan state =====
  let viewerScale = 1;
  let viewerPanX = 0;
  let viewerPanY = 0;
  let viewerIsPanning = false;
  let viewerPanStartX = 0;
  let viewerPanStartY = 0;
  let viewerPanOriginX = 0;
  let viewerPanOriginY = 0;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function getViewerWrap(container) {
    // Prefer a dedicated wrapper if you have it; otherwise use the img parent.
    const img = container.querySelector('#photoViewerImage');
    if (!img) return null;

    let wrap = container.querySelector('#photoViewerImageWrap');
    if (!wrap) {
      wrap = img.parentElement;
      if (wrap) wrap.id = 'photoViewerImageWrap';
    }
    return wrap;
  }

  function applyViewerTransform(container) {
    const img = container.querySelector('#photoViewerImage');
    if (!img) return;

    img.style.transformOrigin = '0 0';
    img.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerScale})`;

    // Nice cursor behavior
    img.style.cursor = viewerScale > 1 ? (viewerIsPanning ? 'grabbing' : 'grab') : 'default';
  }

  function resetViewerTransform(container) {
    viewerScale = 1;
    viewerPanX = 0;
    viewerPanY = 0;
    viewerIsPanning = false;
    applyViewerTransform(container);
  }

  // Zoom around a screen point (cursor-centered zoom)
  function zoomViewer(container, factor, clientX, clientY) {
    const modal = container.querySelector('#photoViewerModal');
    if (!modal || modal.style.display === 'none') return;

    const img = container.querySelector('#photoViewerImage');
    const wrap = getViewerWrap(container);
    if (!img || !wrap) return;

    const rect = wrap.getBoundingClientRect();

    // Clamp scale
    const oldScale = viewerScale;
    const newScale = clamp(oldScale * factor, 1, 6);
    if (newScale === oldScale) return;

    // Point inside wrapper in wrapper coords
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    // Convert that point to "image local" coords before zoom
    const imgX = (px - viewerPanX) / oldScale;
    const imgY = (py - viewerPanY) / oldScale;

    // Update scale
    viewerScale = newScale;

    // Adjust pan so the same image-local point stays under the cursor
    viewerPanX = px - imgX * viewerScale;
    viewerPanY = py - imgY * viewerScale;

    applyViewerTransform(container);
  }

  function setupViewerZoomHandlers(container) {
    const modal = container.querySelector('#photoViewerModal');
    const img = container.querySelector('#photoViewerImage');
    const wrap = getViewerWrap(container);
    if (!modal || !img || !wrap) return;

    // Make wrapper behave well for pan/zoom
    wrap.style.overflow = 'hidden';
    wrap.style.touchAction = 'none'; // prevents browser gestures from stealing wheel/pan

    // Prevent re-binding if init is called multiple times
    if (wrap.dataset.zoomBound === '1') return;
    wrap.dataset.zoomBound = '1';

    // Wheel zoom
    wrap.addEventListener('wheel', (e) => {
      if (modal.style.display === 'none') return;
      e.preventDefault();

      const factor = e.deltaY < 0 ? 1.12 : 0.89; // zoom in/out
      zoomViewer(container, factor, e.clientX, e.clientY);
    }, { passive: false });

    // Double-click reset
    wrap.addEventListener('dblclick', () => resetViewerTransform(container));

    // Mouse drag pan (only when zoomed)
    wrap.addEventListener('mousedown', (e) => {
      if (modal.style.display === 'none') return;
      if (viewerScale <= 1) return;

      viewerIsPanning = true;
      viewerPanStartX = e.clientX;
      viewerPanStartY = e.clientY;
      viewerPanOriginX = viewerPanX;
      viewerPanOriginY = viewerPanY;

      applyViewerTransform(container);
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!viewerIsPanning) return;
      viewerPanX = viewerPanOriginX + (e.clientX - viewerPanStartX);
      viewerPanY = viewerPanOriginY + (e.clientY - viewerPanStartY);
      applyViewerTransform(container);
    });

    document.addEventListener('mouseup', () => {
      if (!viewerIsPanning) return;
      viewerIsPanning = false;
      applyViewerTransform(container);
    });

    // Optional: inject zoom buttons into the modal if you don't already have them
    let controls = container.querySelector('#photoZoomControls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'photoZoomControls';
      controls.innerHTML = `
        <button type="button" id="photoZoomOut" title="Zoom out">−</button>
        <button type="button" id="photoZoomReset" title="Reset zoom">Reset</button>
        <button type="button" id="photoZoomIn" title="Zoom in">+</button>
      `;
      modal.appendChild(controls);
    }

    const zoomInBtn = container.querySelector('#photoZoomIn');
    const zoomOutBtn = container.querySelector('#photoZoomOut');
    const zoomResetBtn = container.querySelector('#photoZoomReset');

    zoomInBtn?.addEventListener('click', () => {
      const rect = wrap.getBoundingClientRect();
      zoomViewer(container, 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    zoomOutBtn?.addEventListener('click', () => {
      const rect = wrap.getBoundingClientRect();
      zoomViewer(container, 0.83, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    zoomResetBtn?.addEventListener('click', () => resetViewerTransform(container));
  }


  /**
   * Initialize the photo tab
   */
  async function initPhotoTab(container, station) {
    currentStation = station;
    currentPath = '';
    
    if (!container || !station) {
      console.error('[photo_tab] Invalid initialization parameters');
      return;
    }

    setupEventHandlers(container);
    await loadPhotoStructure(container);
  }

  /**
   * Setup event handlers
   */
  function setupEventHandlers(container) {
    // Add Photos button
    const addBtn = container.querySelector('#addPhotoBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => showAddPhotoModal(container));
    }

    // Create Folder button
    const createFolderBtn = container.querySelector('#createFolderBtn');
    if (createFolderBtn) {
      createFolderBtn.addEventListener('click', () => showCreateFolderModal(container));
    }

    // Breadcrumb navigation
    const breadcrumb = container.querySelector('#photoBreadcrumb');
    if (breadcrumb) {
      breadcrumb.addEventListener('click', (e) => {
        const item = e.target.closest('.breadcrumb-item');
        if (item && item.dataset.path !== undefined) {
          navigateToPath(container, item.dataset.path);
        }
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
    const fileInput = container.querySelector('#photoFileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        await handleFileSelection(container, e.target.files);
      });
    }

    // Upload button
    const uploadBtn = container.querySelector('#uploadPhotosBtn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => uploadPhotos(container));
    }

    // Create folder button
    const createFolderConfirmBtn = container.querySelector('#createFolderConfirmBtn');
    if (createFolderConfirmBtn) {
      createFolderConfirmBtn.addEventListener('click', () => createFolder(container));
    }

    // Photo viewer navigation
    const prevBtn = container.querySelector('#photoViewerPrev');
    const nextBtn = container.querySelector('#photoViewerNext');
    if (prevBtn) prevBtn.addEventListener('click', () => navigatePhoto(-1, container));
    if (nextBtn) nextBtn.addEventListener('click', () => navigatePhoto(1, container));

    // Delete photo button
    const deleteBtn = container.querySelector('#deletePhotoBtn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteCurrentPhoto(container));
    }

    // Keyboard navigation in photo viewer
        document.addEventListener('keydown', (e) => {
      const viewer = container.querySelector('#photoViewerModal');
      if (!viewer || viewer.style.display === 'none') return;

      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      if (e.key === 'ArrowLeft') navigatePhoto(-1, container);
      if (e.key === 'ArrowRight') navigatePhoto(1, container);
      if (e.key === 'Escape') closeModal(container, 'photoViewerModal');

      // Zoom keys
      if (e.key === '+' || e.key === '=') {
        const wrap = getViewerWrap(container);
        const rect = wrap?.getBoundingClientRect();
        if (rect) zoomViewer(container, 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      if (e.key === '-' || e.key === '_') {
        const wrap = getViewerWrap(container);
        const rect = wrap?.getBoundingClientRect();
        if (rect) zoomViewer(container, 0.83, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      if (e.key === '0') resetViewerTransform(container);
    });

       // Photo viewer zoom/pan handlers
    setupViewerZoomHandlers(container);
 
  }

  /**
   * Load photo structure from backend
   */
  async function loadPhotoStructure(container, path = '') {
    currentPath = path;
    
    const loading = container.querySelector('#photoLoading');
    const empty = container.querySelector('#photoEmpty');
    const grid = container.querySelector('#photoGrid');

    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (grid) grid.style.display = 'none';

    try {
      const result = await window.electronAPI.getStationPhotoStructure(
        currentStation.name,
        currentStation.station_id,
        path
      );

      if (!result.success) {
        throw new Error(result.message || 'Failed to load photos');
      }

      // Update breadcrumb
      updateBreadcrumb(container, path);

      // Render folders and images
      renderPhotoGrid(container, result.folders, result.images);

      // Store current photos for viewer
      currentPhotos = result.images;

      // Update folder lists for modals
      await updateFolderLists(container);

    } catch (e) {
      console.error('[photo_tab] Failed to load photos:', e);
      if (empty) {
        empty.querySelector('h3').textContent = 'Error Loading Photos';
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
    const breadcrumb = container.querySelector('#photoBreadcrumb');
    if (!breadcrumb) return;

    breadcrumb.innerHTML = '';

    // Root
    const root = document.createElement('span');
    root.className = 'breadcrumb-item';
    root.dataset.path = '';
    root.textContent = 'Root';
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
   * Render photo grid
   */
  function renderPhotoGrid(container, folders, images) {
    const foldersEl = container.querySelector('#photoFolders');
    const imagesEl = container.querySelector('#photoImages');
    const empty = container.querySelector('#photoEmpty');
    const grid = container.querySelector('#photoGrid');

    if (!foldersEl || !imagesEl) return;

    foldersEl.innerHTML = '';
    imagesEl.innerHTML = '';

    // Show empty state if no content
    if (folders.length === 0 && images.length === 0) {
      if (empty) empty.style.display = 'flex';
      if (grid) grid.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (grid) grid.style.display = 'block';

    // Render folders
    folders.forEach(folder => {
      const folderCard = document.createElement('div');
      folderCard.className = 'photo-folder-card';
      folderCard.innerHTML = `
        <div class="photo-folder-icon">📁</div>
        <div class="photo-folder-name">${escapeHtml(folder.name)}</div>
      `;
      folderCard.addEventListener('click', () => {
        navigateToPath(container, folder.path);
      });
      foldersEl.appendChild(folderCard);
    });

    // Render images
    images.forEach((image, index) => {
      const imageCard = document.createElement('div');
      imageCard.className = 'photo-image-card';
      imageCard.innerHTML = `
        <div class="photo-image-thumbnail">
          <img data-src="${image.path}" alt="${escapeHtml(image.name)}" />
        </div>
        <div class="photo-image-name">${escapeHtml(image.name)}</div>
      `;
      imageCard.addEventListener('click', () => {
        openPhotoViewer(container, index);
      });
      imagesEl.appendChild(imageCard);
    });

    // Lazy load images
    lazyLoadImages(container);
  }

  /**
   * Lazy load images as they become visible
   */
  function lazyLoadImages(container) {
    const images = container.querySelectorAll('.photo-image-thumbnail img[data-src]');
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          const photoPath = img.dataset.src;
          
          try {
            const result = await window.electronAPI.getPhotoUrl(
              currentStation.name,
              currentStation.station_id,
              photoPath
            );
            
            if (result.success && result.url) {
              img.src = result.url;
              img.removeAttribute('data-src');
            }
          } catch (e) {
            console.error('[photo_tab] Failed to load image:', e);
          }
          
          observer.unobserve(img);
        }
      });
    }, { rootMargin: '50px' });

    images.forEach(img => observer.observe(img));
  }

  /**
   * Navigate to a specific path
   */
  async function navigateToPath(container, path) {
    await loadPhotoStructure(container, path);
  }

  /**
   * Show add photo modal
   */
  function showAddPhotoModal(container) {
    const modal = container.querySelector('#addPhotoModal');
    if (modal) {
      // Reset form
      const fileInput = container.querySelector('#photoFileInput');
      const preview = container.querySelector('#photoPreview');
      const uploadBtn = container.querySelector('#uploadPhotosBtn');
      const folderSelect = container.querySelector('#photoFolderSelect');

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
    const modal = container.querySelector('#createFolderModal');
    if (modal) {
      const nameInput = container.querySelector('#folderNameInput');
      const parentSelect = container.querySelector('#parentFolderSelect');

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

    if (modalId === 'photoViewerModal') {
      resetViewerTransform(container);
    }

  }

  /**
   * Handle file selection
   */
  function handleFileSelection(container, files) {
    const preview = container.querySelector('#photoPreview');
    const uploadBtn = container.querySelector('#uploadPhotosBtn');

    if (!preview || !uploadBtn) return;

    preview.innerHTML = '';
    pendingPhotoUploads = [];

    if (files.length === 0) {
      uploadBtn.disabled = true;
      return;
    }

    // Ask for naming rules once, apply to whole batch
    (async () => {
      try {
        if (typeof window.openFileNamingPopup !== 'function' || typeof window.applyNamingToList !== 'function') {
          // Fallback: no popup available
          pendingPhotoUploads = Array.from(files).map(f => ({ file: f, newName: f.name }));
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
          // User cancelled: clear selection and keep modal open state unchanged
          const fileInput = container.querySelector('#photoFileInput');
          if (fileInput) fileInput.value = '';
          preview.innerHTML = '';
          uploadBtn.disabled = true;
          pendingPhotoUploads = [];
          return;
        }

        const renamed = window.applyNamingToList({
          station: currentStation,
          files: Array.from(files).map(f => ({ originalName: f.name, ext: (f.name.match(/\.[^.]+$/) || [''])[0] })),
          config: cfg
        });

        // Apply same newName to all files in this batch (uniqueness handled on disk)
        pendingPhotoUploads = Array.from(files).map((f, i) => ({
          file: f,
          newName: renamed[i]?.newName || f.name
        }));

        renderPreviewWithNames();
        uploadBtn.disabled = false;
      } catch (e) {
        console.error('[photo_tab] naming popup failed:', e);
        pendingPhotoUploads = Array.from(files).map(f => ({ file: f, newName: f.name }));
        renderPreviewWithNames();
        uploadBtn.disabled = false;
      }
    })();

    function renderPreviewWithNames() {
      preview.innerHTML = '';
      pendingPhotoUploads.forEach(({ file, newName }) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'photo-preview-item';

        const reader = new FileReader();
        reader.onload = (ev) => {
          previewItem.innerHTML = `
            <img src="${ev.target.result}" alt="${escapeHtml(newName)}" />
            <div class="photo-preview-name">${escapeHtml(newName)}</div>
          `;
        };
        reader.readAsDataURL(file);

        preview.appendChild(previewItem);
      });
    }
  }

  /**
   * Upload photos
   */
  async function uploadPhotos(container) {
    const fileInput = container.querySelector('#photoFileInput');
    const folderSelect = container.querySelector('#photoFolderSelect');
    const uploadBtn = container.querySelector('#uploadPhotosBtn');

    // Prefer the renamed batch; fallback to raw input if needed
    const batch = (Array.isArray(pendingPhotoUploads) && pendingPhotoUploads.length)
      ? pendingPhotoUploads
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
            const base64 = reader.result.split(',')[1]; // Remove data:image/...;base64, prefix
            resolve({ name: newName, data: base64 });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      const filesData = await Promise.all(filePromises);

      // Upload to backend
      const result = await window.electronAPI.savePhotos(
        currentStation.name,
        currentStation.station_id,
        targetFolder,
        filesData
      );

      if (result.success) {
        appAlert(`Successfully uploaded ${result.saved.length} photo(s)`);
        closeModal(container, 'addPhotoModal');
        pendingPhotoUploads = [];
        
        // Reload current view
        await loadPhotoStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Upload failed');
      }

    } catch (e) {
      console.error('[photo_tab] Upload failed:', e);
      appAlert('Failed to upload photos: ' + e.message);
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload Photos';
      }
    }
  }

  /**
   * Create new folder
   */
  async function createFolder(container) {
    const nameInput = container.querySelector('#folderNameInput');
    const parentSelect = container.querySelector('#parentFolderSelect');
    const createBtn = container.querySelector('#createFolderConfirmBtn');

    if (!nameInput) return;

    const folderName = nameInput.value.trim();
    if (!folderName) {
      appAlert('Please enter a folder name');
      return;
    }

    // Sanitize folder name
    const safeName = folderName.replace(/[^a-zA-Z0-9_\- ]/g, '_');
    const parentPath = parentSelect?.value || '';
    const fullPath = parentPath ? `${parentPath}/${safeName}` : safeName;

    try {
      if (createBtn) {
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
      }

      const result = await window.electronAPI.createPhotoFolder(
        currentStation.name,
        currentStation.station_id,
        fullPath
      );

      if (result.success) {
        appAlert('Folder created successfully');
        closeModal(container, 'createFolderModal');
        
        // Reload current view
        await loadPhotoStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Failed to create folder');
      }

    } catch (e) {
      console.error('[photo_tab] Create folder failed:', e);
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
    // Get all folders recursively
    const folders = await getAllFolders();
    allFolderPaths = folders;

    // Update add photo modal folder select
    const photoFolderSelect = container.querySelector('#photoFolderSelect');
    if (photoFolderSelect) {
      photoFolderSelect.innerHTML = '<option value="">Root folder</option>';
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.path;
        option.textContent = folder.path;
        photoFolderSelect.appendChild(option);
      });
    }

    // Update create folder modal parent select
    const parentFolderSelect = container.querySelector('#parentFolderSelect');
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
      const structure = await window.electronAPI.getStationPhotoStructure(
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
   * Open photo viewer
   */
  async function openPhotoViewer(container, index) {
    if (index < 0 || index >= currentPhotos.length) return;

    currentPhotoIndex = index;
    const photo = currentPhotos[index];

    const modal = container.querySelector('#photoViewerModal');
    const img = container.querySelector('#photoViewerImage');
    const name = container.querySelector('#photoViewerName');
    const prevBtn = container.querySelector('#photoViewerPrev');
    const nextBtn = container.querySelector('#photoViewerNext');

    if (!modal || !img || !name) return;

    try {
      const result = await window.electronAPI.getPhotoUrl(
        currentStation.name,
        currentStation.station_id,
        photo.path
      );

      if (!result.success || !result.url) {
        throw new Error('Failed to load photo');
      }

      img.src = result.url;
      resetViewerTransform(container);
      name.textContent = photo.name;

      // Update navigation buttons
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === currentPhotos.length - 1;

      modal.style.display = 'flex';
    } catch (e) {
      console.error('[photo_tab] Failed to open photo:', e);
      appAlert('Failed to load photo: ' + e.message);
    }
  }

  /**
   * Navigate between photos in viewer
   */
  function navigatePhoto(direction, container) {
    const newIndex = currentPhotoIndex + direction;
    if (newIndex >= 0 && newIndex < currentPhotos.length) {
      openPhotoViewer(container, newIndex);
    }
  }

  /**
   * Delete current photo
   */
  async function deleteCurrentPhoto(container) {
    if (currentPhotoIndex < 0 || currentPhotoIndex >= currentPhotos.length) return;

    const photo = currentPhotos[currentPhotoIndex];

    const confirmed = await appConfirm(`Are you sure you want to delete "${photo.name}"?`);
    if (!confirmed) return;

    try {
      const result = await window.electronAPI.deletePhoto(
        currentStation.name,
        currentStation.station_id,
        photo.path
      );

      if (result.success) {
        appAlert('Photo deleted successfully');
        closeModal(container, 'photoViewerModal');
        
        // Reload current view
        await loadPhotoStructure(container, currentPath);
      } else {
        throw new Error(result.message || 'Failed to delete photo');
      }

    } catch (e) {
      console.error('[photo_tab] Delete failed:', e);
      appAlert('Failed to delete photo: ' + e.message);
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
  window.initPhotoTab = initPhotoTab;

})();
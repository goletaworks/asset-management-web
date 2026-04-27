// frontend/js/station.js - Updated with schema synchronization and edit button fixes
let currentStationData = null;
let hasUnsavedChanges = false;
let generalInfoUnlocked = false;
let currentUserLevel = 'Read Only';
// FUNDING LOCK: can not change this section name
const FUNDING_SECTION_NAME = 'Funding Type Override Settings';

const PERMISSION_LEVELS = {
  READ_ONLY: 'Read Only',
  READ_EDIT: 'Read and Edit',
  READ_EDIT_GI: 'Read and Edit, including General Info, and Add Infrastructure',
  FULL_ADMIN: 'Full Admin'
};

const LEGACY_PERMISSION_LEVEL = 'Read and Edit General Info and Delete Functionalities';

const PERMISSION_ORDER = [
  PERMISSION_LEVELS.READ_ONLY,
  PERMISSION_LEVELS.READ_EDIT,
  PERMISSION_LEVELS.READ_EDIT_GI,
  PERMISSION_LEVELS.FULL_ADMIN
];

function normalizePermissionLevel(level, isAdminFlag) {
  const raw = String(level || '').trim();
  if (isAdminFlag === true || raw === 'All') return PERMISSION_LEVELS.FULL_ADMIN;
  if (raw === LEGACY_PERMISSION_LEVEL) return PERMISSION_LEVELS.READ_EDIT_GI;
  if (PERMISSION_ORDER.includes(raw)) return raw;
  return PERMISSION_LEVELS.READ_ONLY;
}

async function ensureCurrentUserLevel() {
  try {
    const user = await window.electronAPI.getCurrentUser();
    if (user) {
      currentUserLevel = normalizePermissionLevel(
        user.permissions,
        user.admin === 'Yes' || user.admin === true
      );
    }
  } catch (e) {
    console.warn('[station] Failed to load current user', e);
    currentUserLevel = PERMISSION_LEVELS.READ_ONLY;
  }
}

function canEditGeneralInfo() {
  return (
    PERMISSION_ORDER.indexOf(currentUserLevel) >=
    PERMISSION_ORDER.indexOf(PERMISSION_LEVELS.READ_EDIT_GI)
  );
}

// Helper
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

async function loadStationPage(stationId, origin = 'map') {
  // Fetch station data
  const all = await window.electronAPI.getStationData();
  const stn = (all || []).find(s => String(s.station_id) === String(stationId));
  if (!stn) return appAlert('Station not found: ' + stationId);

  currentStationData = { ...stn }; // Store copy for editing

  // Load HTML
  const container = document.getElementById('stationContentContainer');
  const mainMap  = document.getElementById('mapContainer');
  const listCont = document.getElementById('listContainer');
  const dashboardCont = document.getElementById('dashboardContentContainer');
  const rightPanel = document.getElementById('rightPanel');

  const resp = await fetch('station_specific.html');
  if (!resp.ok) {
    appAlert('Failed to load station detail view.');
   return;
  }
  const html = await resp.text();
  container.innerHTML = html;

  await ensureCurrentUserLevel();

  // Show station view, hide others
  container.dataset.origin = origin === 'list' ? 'list' : 'map';
  if (mainMap) mainMap.style.display = 'none';
  if (listCont) listCont.style.display = 'none';
  if (dashboardCont) dashboardCont.style.display = 'none';
  container.style.display = 'block';
  if (rightPanel) rightPanel.style.display = 'none';
  enableFullWidthMode();

  // Setup UI
  setupStationDetailUI(container, stn);

  // Load Inspection History tab template + script, then init
  try {
    // 1) Inject the tab template
    const ihHost = container.querySelector('#inspection-history');
    if (ihHost) {
      const tmpl = await fetch('inspection_history.html');
      if (tmpl.ok) ihHost.innerHTML = await tmpl.text();
    }
    // 2) Ensure the script is loaded once
    if (!window.__ihLoaded) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/inspection_history.js';
        s.onload = () => { window.__ihLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // 3) Initialize the tab
    window.initInspectionHistoryTab?.(container, stn);
  } catch (e) {
    console.warn('[inspection-history bootstrap] failed:', e);
  }

  // Load Project History tab template + script, then init
  try {
    // 1) Inject the tab template
    const phHost = container.querySelector('#project-history');
    if (phHost) {
      const tmpl = await fetch('project_history.html');
      if (tmpl.ok) phHost.innerHTML = await tmpl.text();
    }
    // 2) Ensure the script is loaded once
    if (!window.__phLoaded) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/project_history.js';
        s.onload = () => { window.__phLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // 3) Initialize the tab
    window.initProjectHistoryTab?.(container, stn);
  } catch (e) {
    console.warn('[project-history bootstrap] failed:', e);
  }

  // Load Photo tab template + script, then init
  try {
    // 1) Inject the tab template
    const photoHost = container.querySelector('#photos');
    if (photoHost) {
      const tmpl = await fetch('photo_tab.html');
      if (tmpl.ok) photoHost.innerHTML = await tmpl.text();
    }
    // 2) Ensure the script is loaded once
    if (!window.__photoTabLoaded) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/photo_tab.js';
        s.onload = () => { window.__photoTabLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    // 3) Initialize the tab
    window.initPhotoTab?.(container, stn);
  } catch (e) {
    console.warn('[photo-tab bootstrap] failed:', e);
  }

  // Load Documents tab template + script, then init
  try {
    const docHost = container.querySelector('#documents');
    if (docHost) {
      const tmpl = await fetch('documents_tab.html');
      if (tmpl.ok) docHost.innerHTML = await tmpl.text();
    }
    if (!window.__documentsTabLoaded) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/documents_tab.js';
        s.onload = () => { window.__documentsTabLoaded = true; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    window.initDocumentsTab?.(container, stn);
  } catch (e) {
    console.warn('[documents-tab bootstrap] failed:', e);
  }
}

// -- Per-section edit mode helpers --
function setSectionEditing(sectionEl, on) {
  sectionEl.classList.toggle('editing', !!on);
  const btn = sectionEl.querySelector('.js-section-edit');
  if (btn) {
    btn.textContent = on ? 'Exit edit mode' : 'Edit section';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
function isSectionEditing(sectionEl) {
  return sectionEl.classList.contains('editing');
}


function setupStationDetailUI(container, stn) {
  // Populate basic info
  const setVal = (id, v) => { 
    const el = container.querySelector('#'+id); 
    if (el) el.value = v ?? ''; 
  };
  
  const setTitle = (name, id) => {
    const el = container.querySelector('#stationTitle');
    if (el) el.textContent = `${name || 'Station'} (${id})`;
  };

  setTitle(stn.name, stn.station_id);
  setVal('giStationId', stn.station_id);
  setVal('giCategory',  stn.asset_type);
  setVal('giSiteName',  stn.name);
  setVal('giProvince',  stn.province);
  setVal('giLatitude',  stn.lat);
  setVal('giLongitude', stn.lon);
  
  const statusSel = container.querySelector('#giStatus');
  if (statusSel) {
    const rawStatus = String(stn.status ?? '').trim();
    const match = Array.from(statusSel.options).find(opt =>
      opt.value.trim().toLowerCase() === rawStatus.toLowerCase() ||
      opt.textContent.trim().toLowerCase() === rawStatus.toLowerCase()
    );
    statusSel.value = match ? match.value : 'Unknown';
  }

  // Status + Type pills
  setHeaderPills(container, stn);

  setupTabs(container);

  // Photos
  renderPhotoPlaceholders(container);
  setupPhotoLightbox(container);
  renderRecentPhotos(container, stn);

  // Tab-specific initializers (if present)
  if (window.initInspectionHistoryTab) {
    window.initInspectionHistoryTab(container, stn);
  }
  if (window.initRepairsTab) {
    window.initRepairsTab(container, stn);
  }

  // Dynamic sections
  renderDynamicSections(container, stn);
  // Also render any additional GI fields *inside* the main GI block (read-only)
  try { renderExtraGIFields(container, stn); } catch (_) {}

  applyGeneralInfoPermissions(container);

  // Setup event handlers
  setupEventHandlers(container, stn);

  // Back button
  setupBackButton(container);

  // Setup Delete Button (Inject below Save Changes)
  setupDeleteButton(container, stn);
}

function setupDeleteButton(container, stn) {
  const saveBtn = container.querySelector('#saveChangesBtn');
  if (!saveBtn) return;

  // Create wrapper for spacing if needed, or just insert after
  const btnContainer = document.createElement('div');
  btnContainer.style.marginTop = '15px';
  btnContainer.style.textAlign = 'center'; // Align with the save button usually

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-outline btn-danger';
  delBtn.textContent = 'Delete Station';
  delBtn.type = 'button';
  delBtn.style.width = '100%'; 
   
  delBtn.addEventListener('click', async () => {
    const confirmed = await window.appConfirm(
      `Are you sure you want to permanently delete station ${stn.station_id}?\n\nThis action cannot be undone.`,
      { title: 'Delete Station', okText: 'Delete', okClass: 'btn-danger' }
    );

    if (confirmed) {
      try {
        delBtn.disabled = true;
        delBtn.textContent = 'Deleting...';
        
        const company = stn.company;
        const location = stn.location_file || stn.province;
        
        const result = await window.electronAPI.deleteStation(company, location, stn.station_id);
        
        if (result.success) {
          // Reset unsaved changes flag so back button works immediately
          hasUnsavedChanges = false;
          // Return to map
          if (typeof window.showMapView === 'function') {
            window.showMapView();
          } else {
            window.location.reload(); // Fallback
          }
          window.appAlert('Station deleted successfully.');
        } else {
          window.appAlert('Failed to delete station: ' + (result.message || 'Unknown error'));
          delBtn.disabled = false;
          delBtn.textContent = 'Delete Station';
        }
      } catch (err) {
        console.error(err);
        window.appAlert('An error occurred while deleting.');
        delBtn.disabled = false;
        delBtn.textContent = 'Delete Station';
      }
    }
  });

  // Insert after the parent container of the save button, or inside the same sidebar
  // Assuming saveBtn is inside a sidebar-section
  const sidebarSection = saveBtn.closest('.sidebar-section') || saveBtn.parentElement;
  sidebarSection.appendChild(btnContainer);
  btnContainer.appendChild(delBtn);
}

function renderExtraGIFields(container, stn) {
  // Render GI extras as one-normal-row-per-field to match built-in rows exactly.
  const giTable = container.querySelector('#giTable');
  if (!giTable) return;

  // Prefer inserting after Status (or after the last standard GI row we can find)
  const giAnchor = container.querySelector('#giStatus') ||
                   container.querySelector('#giLongitude') ||
                   container.querySelector('#giProvince') ||
                   container.querySelector('#giSiteName') ||
                   container.querySelector('#giCategory') ||
                   container.querySelector('#giStationId');
  const anchorRow = giAnchor ? giAnchor.closest('tr') : null;
  const tbody = giTable.tBodies[0] || giTable.appendChild(document.createElement('tbody'));

  // Collect extra GI fields from the station object
  const GI_STD = new Set(['station id','category','site name','station name','province','latitude','longitude','status']);
  const extra = {};
  Object.keys(stn || {}).forEach(k => {
    const m = k.split(' – ');
    if (m.length !== 2) return;
    if (String(m[0]).trim().toLowerCase() !== 'general information') return;
    const fld = String(m[1]).trim();
    if (GI_STD.has(fld.toLowerCase())) return;
    extra[fld] = stn[k];
  });

  // If nothing to render, clear any previous injected rows and exit
  if (!Object.keys(extra).length) {
    tbody.querySelectorAll('tr[data-gi-extra]').forEach(tr => tr.remove());
    return;
  }

  // Remove any previously injected extra rows to avoid duplicates
  tbody.querySelectorAll('tr[data-gi-extra]').forEach(tr => tr.remove());

  // Insert one <tr><th>Label</th><td><input disabled ...></td></tr> per extra field
  let insertAfter = anchorRow;
  Object.entries(extra).forEach(([label, value]) => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-gi-extra', '1');

    const th = document.createElement('th');
    th.textContent = label;

    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.disabled = true;               // matches .station-section input[disabled] styles
    input.value = value == null ? '' : String(value);
    input.dataset.fieldKey = label;      // optional hook for future editing
    input.className = 'gi-extra-input';  // <-- used by unlock/save/event hooks

    td.appendChild(input);
    tr.append(th, td);

    if (insertAfter && insertAfter.parentNode) {
      insertAfter.parentNode.insertBefore(tr, insertAfter.nextSibling);
      insertAfter = tr; // next extras follow after the one we just inserted
    } else {
      tbody.appendChild(tr);
    }
  });
}

function setHeaderPills(container, stn) {
  const pill = container.querySelector('#statusPill');
  const type = container.querySelector('#typePill');
  const sRaw = stn.status || 'Unknown';
  const s = String(sRaw).trim().toLowerCase();
  
  if (pill) {
    pill.textContent = sRaw;
    pill.classList.remove('pill--green','pill--red','pill--amber');
    pill.classList.add(s === 'active' ? 'pill--green' : s === 'inactive' ? 'pill--red' : 'pill--amber');
  }
  if (type) type.textContent = stn.asset_type || '—';
}

function applyGeneralInfoPermissions(container) {
  const unlockBtn = container.querySelector('#unlockEditing');
  if (!unlockBtn) return;

  if (canEditGeneralInfo()) {
    unlockBtn.disabled = false;
    unlockBtn.title = 'Enable editing for General Information';
  } else {
    unlockBtn.disabled = true;
    unlockBtn.title = 'Requires permission: Read and Edit, including General Info, and Add Infrastructure';
  }
}

function renderPhotoPlaceholders(container) {
  const row = container.querySelector('#photosRow');
  if (!row) return;
  row.innerHTML = '';
  const N = 5;
  for (let i = 0; i < N; i++) {
    const d = document.createElement('div');
    d.className = 'photo-thumb skeleton';
    row.appendChild(d);
  }
}

function setupPhotoLightbox(container) {
  const lb = container.querySelector('#photoLightbox');
  const lbImg = container.querySelector('#lightboxImg');
  const lbClose = container.querySelector('#lightboxClose');
  const lbBackdrop = container.querySelector('.photo-lightbox__backdrop');
  if (!lb || !lbImg) return;

  function openLightbox(url) {
    lbImg.src = url;
    lb.classList.add('open');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
  
  function closeLightbox() {
    lb.classList.remove('open');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    lbImg.removeAttribute('src');
  }
  
  lbClose?.addEventListener('click', closeLightbox);
  lbBackdrop?.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
  });

  return openLightbox;
}

async function renderRecentPhotos(container, stn) {
  const row = container.querySelector('#photosRow');
  const openLightbox = setupPhotoLightbox(container);
  
  try {
    const photos = await window.electronAPI.getRecentPhotos(stn.name, stn.station_id, 5);
    if (!row) return;
    row.innerHTML = '';

    if (!photos || photos.length === 0) {
      row.innerHTML = '<div class="photo-empty">No photos found</div>';
    } else {
      for (const p of photos) {
        const result = await window.electronAPI.getPhotoUrl(
          stn.name, stn.station_id, p.photoPath || p.name
        );
        const imgUrl = (result && result.url) || p.url;

        const a = document.createElement('a');
        a.href = imgUrl;
        a.className = 'photo-link';
        a.dataset.url = imgUrl;
        a.title = p.name || `${stn.name} photo`;
        const img = document.createElement('img');
        img.className = 'photo-thumb';
        img.alt = `${stn.name} photo`;
        img.src = imgUrl;
        a.appendChild(img);
        row.appendChild(a);
      }

      row.addEventListener('click', (ev) => {
        const link = ev.target.closest('.photo-link');
        if (!link) return;
        ev.preventDefault();
        if (typeof openLightbox === 'function') openLightbox(link.dataset.url);
      });
    }
  } catch (e) {
    console.warn('[renderRecentPhotos] failed:', e);
    if (row) row.innerHTML = '<div class="photo-empty">Photos unavailable</div>';
  }
}

function renderDynamicSections(container, stn) {
  const sectionsContainer = container.querySelector('#dynamicSections');
  if (!sectionsContainer) return;

  const SEP = ' – ';
  const sections = {};

  // Group fields by section
  Object.keys(stn || {}).forEach(k => {
    if (!k.includes(SEP)) return;
    const [section, field] = k.split(SEP, 2);
    const sectionName = String(section).trim();
    const fieldName = String(field).trim();
    if (!sections[sectionName]) sections[sectionName] = {};
    sections[sectionName][fieldName] = stn[k];
  });

  // Filter out General Information fields already shown
  const GI_NAME = 'general information';
  const GI_SHOWN_FIELDS = new Set(['station id','category','site name','station name','province','latitude','longitude','status']);
  
  Object.keys(sections).forEach(sectionName => {
    if (String(sectionName).trim().toLowerCase() !== GI_NAME) return;
    // Remove GI section entirely; GI extras are rendered inside the main GI block
    delete sections[sectionName];
  });

  // Render sections
  sectionsContainer.innerHTML = '';
  // SORTING: Alphabetical, with "Funding Type Override Settings" forced to the bottom
  const sortedNames = Object.keys(sections).sort((a, b) => {
    const sA = String(a).trim();
    const sB = String(b).trim();
    // Use the constant defined at top of file if available, or string literal
    const funding = typeof FUNDING_SECTION_NAME !== 'undefined' ? FUNDING_SECTION_NAME : 'Funding Type Override Settings';
    
    if (sA === funding) return 1;
    if (sB === funding) return -1;
    return sA.localeCompare(sB);
  });

  sortedNames.forEach(sectionName => {
    const fields = sections[sectionName];
    const sectionDiv = createEditableSection(sectionName, fields);
    sectionsContainer.appendChild(sectionDiv);
  });

}

function createEditableSection(sectionName, fields) {
  const sectionDiv = document.createElement('div');
  sectionDiv.className = 'station-section editable-section';
  sectionDiv.dataset.sectionName = sectionName;

  const isFundingSection = String(sectionName).trim() === FUNDING_SECTION_NAME; // FUNDING LOCK

  const headerDiv = document.createElement('div');
  headerDiv.className = 'section-header';
  headerDiv.style.display = 'flex';
  headerDiv.style.justifyContent = 'space-between';
  headerDiv.style.alignItems = 'center';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'section-title-input';
  titleInput.value = sectionName;
  titleInput.dataset.originalTitle = sectionName; // FUNDING LOCK: keep original for save-time
  titleInput.addEventListener('input', markUnsavedChanges);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'section-actions';

  const editToggleBtn = document.createElement('button');
  editToggleBtn.className = 'btn btn-outline btn-sm js-section-edit';
  editToggleBtn.textContent = 'Edit section';
  editToggleBtn.type = 'button';
  editToggleBtn.setAttribute('aria-pressed', 'false');
  editToggleBtn.style.pointerEvents = 'auto';
  editToggleBtn.style.zIndex = '10';
  editToggleBtn.addEventListener('click', function(e) {
    if (!e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      const section = this.closest('.station-section');
      if (section) setSectionEditing(section, !isSectionEditing(section));
    }
  });

  const addFieldBtn = document.createElement('button');
  addFieldBtn.className = 'btn btn-ghost btn-sm edit-only';
  addFieldBtn.textContent = '+ Add Field';
  addFieldBtn.type = 'button';
  addFieldBtn.addEventListener('click', (e) => {
    e.preventDefault();
    addFieldToSection(sectionDiv);
  });

  const deleteSectionBtn = document.createElement('button');
  deleteSectionBtn.className = 'btn btn-danger btn-sm edit-only';
  deleteSectionBtn.textContent = 'Delete Section';
  deleteSectionBtn.title = 'Delete Section';
  deleteSectionBtn.type = 'button';
  deleteSectionBtn.addEventListener('click', (e) => {
    e.preventDefault();
    deleteSection(sectionDiv);
  });

  actionsDiv.appendChild(editToggleBtn);
  actionsDiv.appendChild(addFieldBtn);
  actionsDiv.appendChild(deleteSectionBtn);

  headerDiv.appendChild(titleInput);
  headerDiv.appendChild(actionsDiv);

  const fieldsDiv = document.createElement('div');
  fieldsDiv.className = 'section-fields';

  // Create field rows
  Object.entries(fields).forEach(([fieldName, value]) => {
    const fieldRow = createEditableField(fieldName, value, { isFundingSection }); // FUNDING LOCK: pass context
    fieldsDiv.appendChild(fieldRow);
  });

  sectionDiv.appendChild(headerDiv);
  sectionDiv.appendChild(fieldsDiv);

  // ensure starts in non-editing state
  setSectionEditing(sectionDiv, false);

  // FUNDING LOCK: make schema immutable (no rename/add/delete), values still editable
  if (isFundingSection) {
    sectionDiv.dataset.locked = 'funding';
    sectionDiv.dataset.allowedFields = Object.keys(fields).join('|'); // for save-time enforcement
    // Lock section title
    titleInput.readOnly = true;
    titleInput.disabled = true;
    // Hide add/delete controls
    addFieldBtn.style.display = 'none';
    deleteSectionBtn.style.display = 'none';
    // Lock all field labels + remove per-field delete buttons
    sectionDiv.querySelectorAll('.field-label-input').forEach(inp => { inp.readOnly = true; inp.disabled = true; });
    sectionDiv.querySelectorAll('.field-row .btn-danger').forEach(btn => { btn.style.display = 'none'; });
  }

  return sectionDiv;
}

function createEditableField(fieldName, value, opts = {}) {
  const isFundingSection = !!opts.isFundingSection; // FUNDING LOCK

  const fieldDiv = document.createElement('div');
  fieldDiv.className = 'field-row';
  fieldDiv.dataset.fieldName = fieldName;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'field-label-input';
  labelInput.value = fieldName;
  labelInput.dataset.originalLabel = fieldName; // FUNDING LOCK: keep original for save-time
  labelInput.addEventListener('input', markUnsavedChanges);

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'field-value-input';
  valueInput.value = value || '';
  valueInput.placeholder = 'Enter value...';
  valueInput.addEventListener('input', markUnsavedChanges);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-ghost btn-sm btn-danger edit-only';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Delete Field';
  deleteBtn.addEventListener('click', () => deleteField(fieldDiv));

  // FUNDING LOCK: labels not editable, cannot delete
  if (isFundingSection) {
    labelInput.readOnly = true;
    labelInput.disabled = true;
    deleteBtn.style.display = 'none';
  }

  fieldDiv.appendChild(labelInput);
  fieldDiv.appendChild(valueInput);
  fieldDiv.appendChild(deleteBtn);

  return fieldDiv;
}

function addFieldToSection(sectionDiv) {
  // FUNDING LOCK: block new fields in the funding section
  const isFunding = sectionDiv?.dataset.locked === 'funding' ||
                    String(sectionDiv?.dataset.sectionName || '').trim() === FUNDING_SECTION_NAME;
  if (isFunding) {
    appAlert('You cannot add new fields to "Funding Type Override Settings".');
    return;
  }

  const fieldsContainer = sectionDiv.querySelector('.section-fields');
  const newField = createEditableField('New Field', '');
  fieldsContainer.appendChild(newField);

  const labelInput = newField.querySelector('.field-label-input');
  labelInput.focus();
  labelInput.select();

  markUnsavedChanges();
}

async function deleteField(fieldDiv) {
  // FUNDING LOCK: block field deletion in funding section
  const sectionDiv = fieldDiv.closest('.station-section');
  const isFunding = sectionDiv?.dataset.locked === 'funding' ||
                    String(sectionDiv?.dataset.sectionName || '').trim() === FUNDING_SECTION_NAME;
  if (isFunding) {
    appAlert('Fields in "Funding Type Override Settings" cannot be removed.');
    return;
  }

  const ok = await appConfirm('Are you sure you want to delete this field?');
  if (!ok) return;
  fieldDiv.remove();
  markUnsavedChanges();
}

async function deleteSection(sectionDiv) {
  // FUNDING LOCK: block section deletion
  const isFunding = sectionDiv?.dataset.locked === 'funding' ||
                    String(sectionDiv?.dataset.sectionName || '').trim() === FUNDING_SECTION_NAME;
  if (isFunding) {
    appAlert('"Funding Type Override Settings" cannot be deleted.');
    return;
  }

  const sectionName = sectionDiv.dataset.sectionName;
  const ok = await appConfirm(`Are you sure you want to delete the "${sectionName}" section?`);
  if (!ok) return;
  sectionDiv.remove();
  markUnsavedChanges();
}

function addNewSection() {
  const container = document.getElementById('stationContentContainer');
  const sectionsContainer = container.querySelector('#dynamicSections');
  
  const newSection = createEditableSection('New Section', {});
  sectionsContainer.appendChild(newSection);
  
  const titleInput = newSection.querySelector('.section-title-input');
  titleInput.focus();
  titleInput.select();
  
  markUnsavedChanges();
}

function markUnsavedChanges() {
  hasUnsavedChanges = true;
  const saveBtn = document.querySelector('#saveChangesBtn');
  if (saveBtn) {
    saveBtn.style.display = 'inline-block';
    saveBtn.classList.add('btn-warning');
  }
}

function setupTabs(container) {
  const tabButtons = container.querySelectorAll('.tabs .tab');
  const panels = container.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // switch active tab button
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // switch visible panel
      panels.forEach(p => p.classList.remove('active'));
      const targetId = btn.dataset.target;
      const target = container.querySelector('#' + targetId);
      if (target) target.classList.add('active');
    });
  });
}

function setupEventHandlers(container, stn) {
  // Re-wire handlers every time the station view is rendered.
  // Remove any previous delegated listeners to avoid double-toggles when revisiting.
  if (container._stationClickHandler) {
    container.removeEventListener('click', container._stationClickHandler, true);
  }
  if (container._stationInputHandler) {
    container.removeEventListener('input', container._stationInputHandler, true);
  }

  const clickHandler = (e) => {
    const toggle = e.target.closest('.js-section-edit');
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const section = toggle.closest('.station-section');
      if (!section) {
        console.warn('[Edit Section] Could not find parent section for button:', toggle);
        return;
      }
      const isEditing = isSectionEditing(section);
      console.log('[Edit Section] Toggling section:', section.dataset.sectionName, 'from', isEditing, 'to', !isEditing);
      setSectionEditing(section, !isEditing);
      return;
    }

    const addBtn = e.target.closest('#addSectionBtn');
    if (addBtn) {
      e.preventDefault();
      addNewSection();
      return;
    }

    const saveBtn = e.target.closest('#saveChangesBtn');
    if (saveBtn) {
      e.preventDefault();
      saveStationChanges(stn.asset_type);
      return;
    }

    const unlockBtn = e.target.closest('#unlockEditing');
    if (unlockBtn) {
      e.preventDefault();
      if (canEditGeneralInfo()) {
        unlockGeneralInformation(container);
      } else {
        appAlert('Editing General Information requires permission level: Read and Edit, including General Info, and Add Infrastructure.');
      }
    }
  };
  container._stationClickHandler = clickHandler;
  container.addEventListener('click', clickHandler, true);

  // Built-in GI inputs + any extra GI inputs we render into the table
  const generalSelector = '#giStationId, #giCategory, #giSiteName, #giProvince, #giLatitude, #giLongitude, #giStatus, .gi-extra-input';
  const inputHandler = (e) => {
    if (!e.target.matches(generalSelector)) return;
    if (!e.target.disabled) markUnsavedChanges();
  };
  container._stationInputHandler = inputHandler;
  container.addEventListener('input', inputHandler, true);
}

function unlockGeneralInformation(container) {
  generalInfoUnlocked = true;
  // Unlock both the standard GI fields and the extra GI inputs
  const inputs = container.querySelectorAll(
    '#giStationId, #giCategory, #giSiteName, #giProvince, #giLatitude, #giLongitude, #giStatus, .gi-extra-input'
  );
  inputs.forEach(input => {
    input.disabled = false;
    input.style.backgroundColor = '#fff3cd';
  });

  const unlockBtn = container.querySelector('#unlockEditing');
  if (unlockBtn) {
    unlockBtn.textContent = '🔓 Editing Unlocked';
    unlockBtn.disabled = true;
    unlockBtn.style.opacity = '0.6';
  }
}

async function saveStationChanges(assetType) {
  const container = document.getElementById('stationContentContainer');
  if (!hasUnsavedChanges) return;

  try {
    const saveBtn = container.querySelector('#saveChangesBtn');
    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FIX: Enhanced validation - blank fields and empty sections
    // ═══════════════════════════════════════════════════════════════════
    
    const sectionsWithBlankFields = new Set();
    const emptySections = new Set();
    const sections = container.querySelectorAll('.editable-section');
    
    sections.forEach(sectionDiv => {
      const isFunding = sectionDiv?.dataset.locked === 'funding' || 
                        String(sectionDiv?.dataset.sectionName || '').trim() === FUNDING_SECTION_NAME;
      if (isFunding) return; // Funding fields are locked
      
      const titleEl = sectionDiv.querySelector('.section-title-input');
      const sectionTitle = (titleEl?.value || '').trim();
      const fieldRows = sectionDiv.querySelectorAll('.field-row');
      
      // Check for empty sections
      if (fieldRows.length === 0) {
        emptySections.add(sectionTitle || 'Unnamed Section');
        return;
      }
      
      // Check for blank field names
      fieldRows.forEach(fieldRow => {
        const labelEl = fieldRow.querySelector('.field-label-input');
        const fieldName = (labelEl?.value || '').trim();
        
        if (!fieldName) {
          sectionsWithBlankFields.add(sectionTitle || 'Unnamed Section');
        }
      });
    });
    
    // Validate: no empty sections
    if (emptySections.size > 0) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
      appAlert('Cannot save sections with no fields. Please add at least one field or delete these sections:\n\n• ' + 
               Array.from(emptySections).join('\n• '));
      return;
    }
    
    // Validate: no blank field names
    if (sectionsWithBlankFields.size > 0) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
      appAlert('Please provide names for all fields or delete them.\n\nSections with blank field names:\n• ' + 
               Array.from(sectionsWithBlankFields).join('\n• '));
      return;
    }

    // Collect all changes
    const updatedData = { ...currentStationData };

    // General Information changes (if unlocked)
    if (generalInfoUnlocked) {
      const getValue = (id) => {
        const el = container.querySelector('#' + id);
        return el ? el.value.trim() : '';
      };

      // Helper to update both the simple DB key and the composite Excel key
      // to ensure one doesn't shadow the other during the save process.
      const setGiPair = (simpleKey, compositeSuffix, val) => {
        updatedData[simpleKey] = val;
        // Update the composite key specifically
        updatedData[`General Information – ${compositeSuffix}`] = val;
      };

      setGiPair('station_id', 'Station ID', getValue('giStationId'));
      setGiPair('asset_type', 'Category', getValue('giCategory'));
      
      // Handle Name synonyms (Site Name vs Station Name)
      const nameVal = getValue('giSiteName');
      updatedData.name = nameVal;
      // Check which key exists in the data and update it, default to Station Name if neither
      if (updatedData['General Information – Site Name'] !== undefined) {
        updatedData['General Information – Site Name'] = nameVal;
      } else {
        updatedData['General Information – Station Name'] = nameVal;
      }

      setGiPair('province', 'Province', getValue('giProvince'));
      setGiPair('lat', 'Latitude', getValue('giLatitude'));
      setGiPair('lon', 'Longitude', getValue('giLongitude'));
      setGiPair('status', 'Status', getValue('giStatus'));
    }

    // Read existing Excel structure for column order
    let existingSchema = null;
    try {
      const company = updatedData.company || currentStationData.company;
      const location = updatedData.location_file || currentStationData.location_file || updatedData.province || currentStationData.province;
      const sheetName = `${assetType} ${location}`;
     
      const sheetData = await window.electronAPI.readSheetData(company, location, sheetName);
      if (sheetData.success && sheetData.sections && sheetData.fields) {
        existingSchema = {
          sections: sheetData.sections,
          fields: sheetData.fields
        };
      }
    } catch (e) {
      console.warn('[saveStationChanges] Could not read existing schema:', e);
    }

    // ═══════════════════════════════════════════════════════════════════
    // FIX: Clear old section data properly to prevent value copying
    // ═══════════════════════════════════════════════════════════════════
    
    // Clear ALL non-GI composite keys from updatedData
    Object.keys(updatedData).forEach(key => {
      if (key.includes(' – ')) {
        const [sec] = key.split(' – ');
        // Keep GI fields, remove everything else
        if (String(sec).trim().toLowerCase() !== 'general information') {
          delete updatedData[key];
        }
      }
    });

    // Validate and auto-populate Funding Overrides
    try {
      const foSec = Array.from(container.querySelectorAll('.station-section'))
        .find(sec => String(sec.dataset.sectionName || '').trim() === 'Funding Type Override Settings');
      if (foSec) {
        const splitKey = Object.keys(currentStationData || {}).find(k => /funding split/i.test(k));
        const splitVal = splitKey ? String(currentStationData[splitKey] || '').trim() : '';
        const tokens = splitVal ? splitVal.split('-').map(s => s.trim()).filter(Boolean) : [];
        const makeDefault = () => {
          const n = tokens.length;
          if (!n) return '';
          const base = Math.round((1000 / n)) / 10;
          const parts = new Array(n).fill(base);
          const sum = parts.reduce((a,b)=>a+b,0);
          parts[n-1] = Math.round((100 - (sum - parts[n-1])) * 10) / 10;
          return tokens.map((t,i)=>`${parts[i]}%${t}`).join('-');
        };
        const isValid = (val) => {
          const s = String(val || '').trim();
          if (!s) return false;
          let total = 0;
          const seen = new Set();
          const terms = s.split('-').map(x=>x.trim()).filter(Boolean);
          for (const term of terms) {
            const m = term.match(/^([0-9]+(?:\.[0-9]+)?)%(.+)$/);
            if (!m) return false;
            const pct = parseFloat(m[1]);
            const tok = m[2].trim();
            if (!tok || seen.has(tok)) return false;
            seen.add(tok);
            total += isFinite(pct) ? pct : 0;
          }
          return total >= 99 && total <= 100;
        };
        let invalid = false;
        foSec.querySelectorAll('.field-row .field-value-input').forEach(inp => {
          const cur = String(inp.value || '').trim();
          if (!cur) {
            const def = makeDefault();
            if (def) { inp.value = def; markUnsavedChanges(); }
          } else if (!isValid(cur)) {
            invalid = true;
          }
        });
        if (invalid) {
          throw new Error('Funding Type Override values must be percentages (e.g., 75%P-25%F) summing to 99–100%.');
        }
      }
    } catch (e) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
      throw e;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FIX: Strict key matching to prevent accidental value copying
    // ═══════════════════════════════════════════════════════════════════
    
    const uiSections = new Map();

    sections.forEach(sectionDiv => {
      const titleEl = sectionDiv.querySelector('.section-title-input');
      const rawTitle = (titleEl?.value || '').trim();
      const isFunding = sectionDiv?.dataset.locked === 'funding' || rawTitle === FUNDING_SECTION_NAME;

      const sectionTitle = isFunding
        ? (titleEl?.dataset.originalTitle || FUNDING_SECTION_NAME)
        : rawTitle;

      const allowed = isFunding
        ? new Set((sectionDiv.dataset.allowedFields || '').split('|').filter(Boolean))
        : null;

      const fieldRows = sectionDiv.querySelectorAll('.field-row');

      if (!uiSections.has(sectionTitle)) {
        uiSections.set(sectionTitle, []);
      }

      fieldRows.forEach(fieldRow => {
        const labelEl = fieldRow.querySelector('.field-label-input');
        const rawFieldName = (labelEl?.value || '').trim();
        const originalFieldName = labelEl?.dataset.originalLabel || rawFieldName;

        if (isFunding && allowed && !allowed.has(originalFieldName)) {
          return;
        }

        const fieldName = isFunding ? originalFieldName : rawFieldName;
        const valueEl = fieldRow.querySelector('.field-value-input');
        const fieldValue = (valueEl?.value || '').trim();

        if (sectionTitle && fieldName) {
          // Use EXACT composite key only - no fallbacks to prevent copying
          const compositeKey = `${sectionTitle} – ${fieldName}`;
          updatedData[compositeKey] = fieldValue;
          uiSections.get(sectionTitle).push(fieldName);
        }
      });
    });

    // Build schema from UI
    let schemaData;
    (function buildSchemaFromUI() {
      const uiPairs = [];
      uiSections.forEach((fieldsList, sectionName) => {
        fieldsList.forEach(fieldName => {
          if (sectionName && fieldName) uiPairs.push([sectionName, fieldName]);
        });
      });

      if (existingSchema && Array.isArray(existingSchema.fields) && Array.isArray(existingSchema.sections)) {
        const keyOf = (s, f) => `${String(s).toLowerCase()}|||${String(f).toLowerCase()}`;
        const isGI  = (s) => String(s).trim().toLowerCase() === 'general information';
        const present = new Set(uiPairs.map(([s, f]) => keyOf(s, f)));
        const ordered = [];
        
        for (let i = 0; i < existingSchema.fields.length; i++) {
          const s = existingSchema.sections[i];
          const f = existingSchema.fields[i];
          if (!s || !f || isGI(s)) continue;
          const k = keyOf(s, f);
          if (present.has(k)) ordered.push([s, f]);
        }

        const orderedKeys = new Set(ordered.map(([s, f]) => keyOf(s, f)));
        const insertAfterLastOfSection = (arr, section, pair) => {
          const want = String(section).toLowerCase();
          let lastIdx = -1;
          for (let i = arr.length - 1; i >= 0; i--) {
            if (String(arr[i][0]).toLowerCase() === want) { lastIdx = i; break; }
          }
          if (lastIdx === -1) arr.push(pair);
          else arr.splice(lastIdx + 1, 0, pair);
        };

        for (const [s, f] of uiPairs) {
          const k = keyOf(s, f);
          if (orderedKeys.has(k)) continue;
          insertAfterLastOfSection(ordered, s, [s, f]);
          orderedKeys.add(k);
        }

        schemaData = {
          sections: ordered.map(p => p[0]),
          fields:   ordered.map(p => p[1])
        };
      } else {
        const grouped = [];
        uiSections.forEach((fieldsList, sectionName) => {
          fieldsList.forEach(fieldName => grouped.push([sectionName, fieldName]));
        });
        schemaData = {
          sections: grouped.map(p => p[0]),
          fields:   grouped.map(p => p[1])
        };
      }
    })();

    // If GI is unlocked, persist extra GI fields
    if (generalInfoUnlocked) {
      container.querySelectorAll('.gi-extra-input').forEach(inp => {
        const label = (inp.dataset.fieldKey || '').trim();
        if (label) {
          updatedData[`General Information – ${label}`] = inp.value.trim();
        }
      });
    }

    // Save to Excel with schema
    const result = await window.electronAPI.updateStationData(updatedData, {
      sections: schemaData.sections,
      fields: schemaData.fields
    });
    
    if (result.success) {
      // Sync schema to all other stations
      if (assetType && schemaData.sections.length > 0) {
        saveBtn.textContent = 'Syncing schema...';
        
        const syncResult = await window.electronAPI.syncAssetTypeSchema(
          assetType,
          schemaData,
          updatedData.station_id
        );
        
        if (syncResult.success) {
          console.log(`Schema synchronized: ${syncResult.message}`);
        } else {
          console.warn('Schema sync failed:', syncResult.message);
        }
      }
      
      hasUnsavedChanges = false;
      currentStationData = { ...updatedData };
      
      if (saveBtn) {
        saveBtn.classList.add('btn-success-flash');
        saveBtn.classList.remove('btn-warning');
        saveBtn.textContent = 'Saved';
        
        setTimeout(() => {
          saveBtn.classList.remove('btn-success-flash');
          saveBtn.textContent = 'Save Changes';
        }, 2000);
      }

      await window.electronAPI.invalidateStationCache();
 
      // Refresh UI components to reflect changes immediately
      if (window.refreshFilters) await window.refreshFilters();
      if (window.refreshMarkers) await window.refreshMarkers();
      if (window.renderList) await window.renderList();
      
    } else {
      throw new Error(result.message || 'Save failed');
    }

  } catch (error) {
    console.error('Save failed:', error);
    appAlert('Failed to save changes: ' + error.message);
  } finally {
    const saveBtn = container.querySelector('#saveChangesBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      if (saveBtn.textContent === 'Saving...' || saveBtn.textContent === 'Syncing schema...') {
        saveBtn.textContent = 'Save Changes';
      }
    }
  }
}

// Clean up function to reset state when navigating away
function cleanupStationPage() {
  const container = document.getElementById('stationContentContainer');
  if (container) {
    // Detach delegated handlers when leaving the page
    if (container._stationClickHandler) {
      container.removeEventListener('click', container._stationClickHandler, true);
      delete container._stationClickHandler;
    }
    if (container._stationInputHandler) {
      container.removeEventListener('input', container._stationInputHandler, true);
      delete container._stationInputHandler;
    }
  }
  
  // Reset state variables
  currentStationData = null;
  hasUnsavedChanges = false;
  generalInfoUnlocked = false;
}

function setupBackButton(container) {
  const backBtn = container.querySelector('#backButton');
  if (backBtn) {
    backBtn.addEventListener('click', async () => {
      if (hasUnsavedChanges) {
        const ok = await appConfirm('You have unsaved changes. Are you sure you want to leave?');
        if (!ok) return;
      }

      // Clean up before leaving
      cleanupStationPage();

      const from = container.dataset.origin || 'map';

      if (from === 'list') {
        // Use the global function which already handles restoring the RHS
        if (typeof window.showListView === 'function') {
          window.showListView();
        }
      } else {
        // Use the global function which already handles restoring the RHS
        if (typeof window.showMapView === 'function') {
          window.showMapView();
        }
      }
      
    });
  }
}

// Add debugging helper to check button state
function debugEditButtons() {
  const buttons = document.querySelectorAll('.js-section-edit');
  console.log('[Debug] Found', buttons.length, 'edit section buttons');
  buttons.forEach((btn, i) => {
    const section = btn.closest('.station-section');
    const sectionName = section?.dataset.sectionName || 'unknown';
    const isEditing = section ? isSectionEditing(section) : false;
    console.log(`[Debug] Button ${i}: Section "${sectionName}", Editing: ${isEditing}, Enabled: ${!btn.disabled}`);
  });
}

// Expose for debugging
window.debugEditButtons = debugEditButtons;

// expose
window.loadStationPage = loadStationPage;

// Add visibility change listener to detect when returning to the page
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const stationContainer = document.getElementById('stationContentContainer');
    const rightPanel = document.getElementById('rightPanel');
    
    // If we're not in station view, ensure RHS is visible
    if (stationContainer && (stationContainer.style.display === 'none' || !stationContainer.style.display)) {
      if (rightPanel) rightPanel.style.display = '';
    }
  }
});

// Also check on window focus
window.addEventListener('focus', () => {
  setTimeout(() => {
    const stationContainer = document.getElementById('stationContentContainer');
    const rightPanel = document.getElementById('rightPanel');
    
    if (stationContainer && (stationContainer.style.display === 'none' || !stationContainer.style.display)) {
      if (rightPanel) rightPanel.style.display = '';
    }
  }, 100);
});

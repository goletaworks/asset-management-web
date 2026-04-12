// frontend/js/project_history.js
(() => {
  function titleCase(s) {
    return String(s || '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }

  function parseDateFromFolder(name, fallbackMs) {
    // Accept: 2020, 2020-05, 2020_05, 2020-05-17, 2020_Project_...
    const canon = String(name || '').trim();
    const m = canon.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?/);
    let d;
    if (m) {
      const y = Number(m[1]);
      const mo = m[2] ? Number(m[2]) : 1;
      const da = m[3] ? Number(m[3]) : 1;
      if (y >= 1900 && y <= 3000) {
        d = new Date(y, (mo || 1) - 1, (da || 1));
      }
    }
    if (!d) d = new Date(fallbackMs || Date.now());
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { date: d, human: m && m[3] ? `${yyyy}-${mm}-${dd}` : (m && m[2] ? `${yyyy}-${mm}` : `${yyyy}`) };
  }

  function openPhotoLightbox(url) {
    const lb = document.querySelector('#photoLightbox');
    const img = document.querySelector('#lightboxImg');
    if (!lb || !img) return;
    img.src = url;
    lb.classList.add('open');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
  function closePhotoLightbox() {
    const lb = document.querySelector('#photoLightbox');
    const img = document.querySelector('#lightboxImg');
    if (!lb) return;
    lb.classList.remove('open');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    if (img) img.removeAttribute('src');
  }

  function openPdfModal(url, title = 'Project Report') {
    const modal = document.querySelector('#pdfModalProject');
    const frame = document.querySelector('#pdfFrameProject');
    const head = document.querySelector('#pdfTitleProject');
    const close = document.querySelector('#pdfCloseProject');
    if (!modal || !frame) return;
    frame.src = url;
    if (head) head.textContent = title;
    modal.style.display = 'flex';
    // one-time close wiring per open
    const closer = () => {
      modal.style.display = 'none';
      frame.removeAttribute('src');
      close?.removeEventListener('click', closer);
      modal.removeEventListener('click', backdropCloser);
      document.removeEventListener('keydown', escCloser);
    };
    const backdropCloser = (e) => { if (e.target === modal) closer(); };
    const escCloser = (e) => { if (e.key === 'Escape') closer(); };
    close?.addEventListener('click', closer);
    modal.addEventListener('click', backdropCloser);
    document.addEventListener('keydown', escCloser);
  }

  async function fetchTemplateInto(container) {
    const host = container.querySelector('#project-history');
    if (!host) return null;
    const resp = await fetch('project_history.html');
    if (!resp.ok) throw new Error('Failed to load project_history.html');
    host.innerHTML = await resp.text();
    return host;
  }

  function renderItem(host, stn, item) {
    const wrap = document.createElement('div');
    wrap.className = 'project-item';
    wrap.style.border = '1px solid var(--border)';
    wrap.style.borderRadius = '10px';
    wrap.style.padding = '10px 12px';
    wrap.style.background = '#fff';
    wrap.setAttribute('data-date-ms', String(item.dateMs ?? ''));

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '8px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    const byProjectLead = item.projectLead ? ` by ${item.projectLead}` : '';
    const datePart    = item.dateHuman ? ` - ${item.dateHuman}` : '';
    title.textContent = `${item.displayName}${byProjectLead}${datePart}`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'btn';
    reportBtn.textContent = 'Project Report';
    reportBtn.disabled = !item.reportUrl;
    reportBtn.title = item.reportUrl ? 'Open report PDF' : 'No report found';
    reportBtn.addEventListener('click', () => {
      if (item.reportUrl) openPdfModal(item.reportUrl, `${item.displayName} — Report`);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete Project';
    delBtn.title = 'Delete this project folder';
    delBtn.addEventListener('click', async () => {
      const ok = await appConfirm(`Delete the "${item.folderName}" project (this deletes the folder and its files)?`);
      if (!ok) return;

      delBtn.disabled = true; delBtn.textContent = 'Deleting…';
      try {
        const res = await window.electronAPI.deleteProject(stn.name, stn.station_id, item.folderName);
        if (res && res.success) {
          // Remove the card immediately
          wrap.remove();
        } else {
          appAlert('Failed to delete project folder.' + (res?.message ? `\n\n${res.message}` : ''));
          delBtn.disabled = false; delBtn.textContent = 'Delete Project';
        }
      } catch (e) {
        console.error('[deleteProject] failed', e);
        appAlert('Failed to delete project folder.');
        delBtn.disabled = false; delBtn.textContent = 'Delete Project';
      }
    });

    actions.appendChild(reportBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);

    wrap.appendChild(header);

    if (item.commentText && item.commentText.trim()) {
      const commentBox = document.createElement('div');
      commentBox.className = 'ph-comment';
      commentBox.style.marginTop = '8px';
      commentBox.style.padding = '8px 10px';
      commentBox.style.borderLeft = '3px solid #d1d5db';
      commentBox.style.background = '#f9fafb';
      commentBox.style.whiteSpace = 'pre-wrap';
      commentBox.textContent = item.commentText.trim();
      wrap.appendChild(commentBox);
    }

    const photosRow = document.createElement('div');
    photosRow.className = 'photo-row';
    photosRow.style.marginTop = '10px';
    photosRow.style.alignItems = 'center';

    if (item.photos && item.photos.length) {
      item.photos.forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.className = 'photo-link';
        a.title = p.name || 'Project photo';
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = p.name || 'Project photo';
        img.className = 'photo-thumb';
        a.appendChild(img);
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openPhotoLightbox(p.url);
        });
        photosRow.appendChild(a);
      });
      const extra = Number(item.moreCount || 0);
      if (extra > 0) {
        const more = document.createElement('div');
        more.textContent = `+ ${extra} more`;
        more.style.marginLeft = '8px';
        more.style.fontWeight = '700';
        more.style.color = '#374151';
        photosRow.appendChild(more);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No photos found in this project';
      photosRow.appendChild(empty);
    }

    wrap.appendChild(photosRow);
    host.appendChild(wrap);
  }

  async function renderList(host, stn) {
    const list = host.querySelector('#phList');
    if (!list) return;
    list.innerHTML = '';

    // skeletons...
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('div');
      s.className = 'project-skel';
      s.style.height = '86px';
      s.style.border = '1px solid var(--border)';
      s.style.borderRadius = '10px';
      s.style.background = 'linear-gradient(90deg,#f3f4f6,#eceff3,#f3f4f6)';
      s.style.backgroundSize = '200% 100%';
      s.style.animation = 'photo-skeleton 1.4s ease infinite';
      list.appendChild(s);
    }

    let items = [];
    try {
      items = await window.electronAPI.listProjects(stn.name, stn.station_id);
    } catch (e) {
      console.warn('[listProjects] failed', e);
    }
    list.innerHTML = '';

    if (!items || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No projects found for this station';
      list.appendChild(empty);
      return;
    }

    // sort newest first by folder-name date (backend provides dateMs)
    items.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
    for (const it of items) renderItem(list, stn, it);
  }

  async function openPhSettingsModal(host, stn) {
    // Remove any existing modal to ensure fresh state
    const existingModal = document.querySelector('#phSettingsModal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create the settings modal
    const div = document.createElement('div');
    div.id = 'phSettingsModal';
    div.className = 'modal';
    div.style.display = 'flex';
    div.innerHTML = `
      <div class="modal-content" style="max-width:600px;width:92%;padding:24px;">
        <h3 style="margin:0 0 8px;">Project Folder Keywords</h3>
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px;">
          Folders matching these keywords will appear in the Project History tab.
        </p>
        <div id="phKeywordsChips" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;"></div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
          <input
            id="phKeywordInput"
            type="text"
            placeholder="Type keyword and press Enter"
            style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:8px;"
          />
          <button id="phKeywordAddBtn" class="btn">Add</button>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="phKeywordResetBtn" class="btn btn-ghost">Reset to Default</button>
          <button id="phKeywordSaveBtn" class="btn btn-primary">Save</button>
          <button id="phKeywordCancelBtn" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(div);

    let keywords = [];
    try {
      keywords = await window.electronAPI.getProjectKeywords();
    } catch (_) {
      keywords = ['project', 'construction', 'maintenance', 'repair', 'decommission'];
    }

    const chipsEl = div.querySelector('#phKeywordsChips');
    const inputEl = div.querySelector('#phKeywordInput');
    const addBtn = div.querySelector('#phKeywordAddBtn');
    const resetBtn = div.querySelector('#phKeywordResetBtn');
    const saveBtn = div.querySelector('#phKeywordSaveBtn');
    const cancelBtn = div.querySelector('#phKeywordCancelBtn');

    function renderChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = '';
      if (!keywords.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No keywords. Add at least one.';
        empty.style.color = '#6b7280';
        empty.style.fontSize = '13px';
        chipsEl.appendChild(empty);
        return;
      }
      keywords.forEach((k, idx) => {
        const chip = document.createElement('div');
        chip.style.display = 'inline-flex';
        chip.style.alignItems = 'center';
        chip.style.gap = '6px';
        chip.style.background = '#eef2ff';
        chip.style.color = '#3730a3';
        chip.style.padding = '4px 10px';
        chip.style.borderRadius = '999px';
        chip.style.fontSize = '13px';
        chip.style.fontWeight = '500';
        const span = document.createElement('span');
        span.textContent = k;
        const x = document.createElement('button');
        x.textContent = '✕';
        x.style.background = 'none';
        x.style.border = 'none';
        x.style.color = '#3730a3';
        x.style.cursor = 'pointer';
        x.style.fontWeight = '700';
        x.style.fontSize = '14px';
        x.title = 'Remove';
        x.addEventListener('click', () => {
          keywords.splice(idx, 1);
          renderChips();
        });
        chip.appendChild(span);
        chip.appendChild(x);
        chipsEl.appendChild(chip);
      });
    }
    renderChips();

    const addKeyword = () => {
      const val = (inputEl?.value || '').trim();
      if (!val) return;
      if (keywords.includes(val)) {
        inputEl.value = '';
        return;
      }
      keywords.push(val);
      inputEl.value = '';
      renderChips();
    };

    addBtn?.addEventListener('click', addKeyword);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addKeyword();
      }
    });

    resetBtn?.addEventListener('click', () => {
      keywords = ['project', 'construction', 'maintenance', 'repair', 'decommission'];
      renderChips();
    });

    const closeModal = () => {
      div.style.display = 'none';
      div.remove();
    };

    cancelBtn?.addEventListener('click', closeModal);
    saveBtn?.addEventListener('click', async () => {
      const originalText = saveBtn.textContent;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        await window.electronAPI.setProjectKeywords(keywords);

        // Refresh the list immediately with new keywords
        if (host && stn) {
          saveBtn.textContent = 'Refreshing...';
          await renderList(host, stn);
        }

        closeModal();
      } catch (e) {
        console.error('[setProjectKeywords] failed', e);
        appAlert('Failed to save keywords.');
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    });

    div.addEventListener('click', (e) => {
      if (e.target === div) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && div.style.display === 'flex') closeModal();
    });
  }

  async function initProjectHistoryTab(container, stn) {
    const tabBtn = container.querySelector('.tab[data-target="project-history"]');
    const host = await fetchTemplateInto(container);
    if (!host) return;

    // ---- Load global keywords from lookups.xlsx (shared by all stations) ----
    let phKeywords = ['project'];
    try {
      const ks = await window.electronAPI.getProjectKeywords();
      if (Array.isArray(ks)) phKeywords = ks;
    } catch (_) {}

    // Insert a small "Settings" button in the header
    const header = host.querySelector('.ph-header');
    if (header && !header.querySelector('#phSettingsBtn')) {
      const settingsBtn = document.createElement('button');
      settingsBtn.id = 'phSettingsBtn';
      settingsBtn.className = 'btn btn-ghost';
      // Use a gear emoji and push it to the far right
      settingsBtn.textContent = '⚙️';
      settingsBtn.setAttribute('aria-label', 'Project folder keywords');
      settingsBtn.title = 'Project folder keywords';
      // Visually pin to the right edge of the header row
      settingsBtn.style.marginLeft = 'auto';
      // Make it a compact icon button
      settingsBtn.style.width = '36px';
      settingsBtn.style.height = '36px';
      settingsBtn.style.display = 'inline-flex';
      settingsBtn.style.alignItems = 'center';
      settingsBtn.style.justifyContent = 'center';
      settingsBtn.style.fontSize = '18px';
      settingsBtn.style.padding = '0';
      header.appendChild(settingsBtn);

      settingsBtn.addEventListener('click', () => openPhSettingsModal(host, stn));
    }

    // Lightbox close wiring
    const lbClose = document.querySelector('#lightboxClose');
    const lbBackdrop = document.querySelector('.photo-lightbox__backdrop');
    lbClose?.addEventListener('click', closePhotoLightbox);
    lbBackdrop?.addEventListener('click', closePhotoLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhotoLightbox(); });

    // Load immediately to ensure instant display
    await renderList(host, stn);
    
    // Reload on tab click (optional, keeps data fresh if user switches tabs)
    tabBtn?.addEventListener('click', () => renderList(host, stn));

    // ---- Add Project modal logic ----
    const addBtn = host.querySelector('#phAddBtn');
    const modal  = document.querySelector('#phModal');
    const closeModal = () => { if (modal) modal.style.display = 'none'; };
    const openModal  = () => {
      if (modal) {
        modal.style.display = 'flex';
        // Autofill year with the current year if empty or invalid, but keep it editable
        primeYearField();
        primeNameField();
        setTimeout(()=>yearEl?.focus(),50);
      }
    };

    const yearEl      = document.querySelector('#phYear');
    const nameEl      = document.querySelector('#phName');
    const projectLeadEl = document.querySelector('#phProjectLead');
    const commEl      = document.querySelector('#phComment');
    const errEl       = document.querySelector('#phError');
    const createEl    = document.querySelector('#phCreateBtn');
    const cancelEl    = document.querySelector('#phCancelBtn');
    const pickPhotos  = document.querySelector('#phPickPhotos');
    const photosSum   = document.querySelector('#phPhotosSummary');
    const pickReport  = document.querySelector('#phPickReport');
    const reportSum   = document.querySelector('#phReportSummary');
    const phRepName     = document.querySelector('#phRepName');
    const phRepSeverity = document.querySelector('#phRepSeverity');
    const phRepPriority = document.querySelector('#phRepPriority');
    const phRepCost     = document.querySelector('#phRepCost');
    const phRepType     = document.querySelector('#phRepType');
    const phRepDays     = document.querySelector('#phRepDays');
    const phRepCategory = document.querySelector('#phRepCategory');
    const phAddRepairBtn= document.querySelector('#phAddRepairBtn');
    const phRepairsTbody= document.querySelector('#phRepairsTbody');

    let selectedPhotos = [];
    let selectedPhotoFiles = [];
    let selectedReport = null;
    let selectedReportFile = null;
    let pendingRepairs = []; // {name,severity,priority,cost,category,type,days}

    // ---- helpers ----
    function primeYearField() {
      if (!yearEl) return;
      const raw = String(yearEl.value || '').trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 1000 || n > 9999) {
        yearEl.value = String(new Date().getFullYear());
      }
    }

    function primeNameField() {
      if (!nameEl) return;
      const raw = String(nameEl.value || '').trim();
      if (raw === '') {
        nameEl.value = 'Infrastructure Project';
      }
    }

    function setError(msg) {
      if (!errEl) return;
      if (msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
      else { errEl.textContent = ''; errEl.style.display = 'none'; }
    }

    function validate() {
      const year = Number(yearEl?.value || '');
      const name = String(nameEl?.value || '').trim();
      if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        return 'Enter a valid 4-digit year (1000–9999).';
      }
      if (!name) {
        return 'Name is required.';
      }
      return null;
    }

    function fmtCostCell(v) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
        catch { return `$${Math.round(v).toLocaleString()}`; }
      }
      const s = String(v ?? '').trim();
      return s || '—';
    }

    function readRepairForm() {
      const name = String(phRepName?.value || '').trim();
      const severity = String(phRepSeverity?.value || '').trim();
      const priority = String(phRepPriority?.value || '').trim();
      const rawCost = String(phRepCost?.value || '').trim();
      const rawDays = String(phRepDays?.value || '').trim();
      const category = (phRepCategory?.value || 'Capital');
      const type = String(phRepType?.value || '').trim() || 'Repair';
      let cost = rawCost ? Number(rawCost.replace(/[, ]/g, '')) : '';
      if (!Number.isFinite(cost)) cost = rawCost;
      let days = rawDays ? Number(rawDays.replace(/[, ]/g, '')) : '';
      if (!Number.isFinite(days)) days = rawDays;
      return { name, severity, priority, cost, category, type, days };
    }
    function validateRepair(it) {
      if (!it.name) return 'Repair Name is required.';
      if (!/^Capital$|^O&?M$|^Decomm/i.test(it.category)) return 'Select a valid Category.';
      return null;
    }
    function clearRepairForm() {
      if (phRepName) phRepName.value = '';
      if (phRepSeverity) phRepSeverity.value = '';
      if (phRepPriority) phRepPriority.value = '';
      if (phRepCost) phRepCost.value = '';
      if (phRepType) phRepType.value = '';
      if (phRepDays) phRepDays.value = '';
      if (phRepCategory) phRepCategory.value = 'Capital';
    }
    function renderPendingRepairs() {
      if (!phRepairsTbody) return;
      phRepairsTbody.innerHTML = '';
      if (!pendingRepairs.length) {
        const tr = document.createElement('tr');
        tr.className = 'ph-repairs-empty';
        const td = document.createElement('td');
        td.colSpan = 8; td.style.textAlign = 'center'; td.style.color = '#6b7280';
        td.textContent = 'No repairs added';
        tr.appendChild(td);
        phRepairsTbody.appendChild(tr);
        return;
      }
      pendingRepairs.forEach((it, idx) => {
        const tr = document.createElement('tr');
        const c1 = document.createElement('td'); c1.textContent = it.name || '??"';
        const c2 = document.createElement('td'); c2.textContent = it.severity || '??"';
        const c3 = document.createElement('td'); c3.textContent = it.priority || '??"';
        const c4 = document.createElement('td'); c4.textContent = fmtCostCell(it.cost);
        const c5 = document.createElement('td'); c5.textContent = it.type || '??"';
        const c6 = document.createElement('td'); c6.textContent = (it.days === 0 ? 0 : it.days || '??"');
        const c7 = document.createElement('td'); c7.textContent = it.category || '??"';
        const c8 = document.createElement('td');
        const del = document.createElement('button');
        del.className = 'btn btn-ghost btn-sm btn-danger';
        del.textContent = '?o';
        del.title = 'Remove';
        del.addEventListener('click', () => {
          pendingRepairs.splice(idx, 1);
          renderPendingRepairs();
        });
        c8.appendChild(del);
        tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5); tr.appendChild(c6); tr.appendChild(c7); tr.appendChild(c8);
        phRepairsTbody.appendChild(tr);
      });
    }

    addBtn?.removeAttribute('disabled');
    addBtn?.removeAttribute('title');
    addBtn?.addEventListener('click', () => {
      setError('');
      selectedPhotos = [];
      selectedPhotoFiles = [];
      selectedReport = null;
      selectedReportFile = null;
      pendingRepairs = [];
      if (photosSum) photosSum.textContent = '0 selected';
      if (reportSum) reportSum.textContent = 'None';
      clearRepairForm();
      renderPendingRepairs();
      if (yearEl) yearEl.value = '';
      if (nameEl) nameEl.value = '';
      if (projectLeadEl) projectLeadEl.value = '';
      if (commEl) commEl.value = '';
      openModal();
    });

    cancelEl?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Add repair button
    phAddRepairBtn?.addEventListener('click', () => {
      const it = readRepairForm();
      const err = validateRepair(it);
      if (err) {
        setError(err);
        return;
      }
      pendingRepairs.push(it);
      clearRepairForm();
      renderPendingRepairs();
      setError('');
    });

    // Photos picker
    pickPhotos?.addEventListener('click', async () => {
      try {
        const res = await window.electronAPI.pickProjectPhotos();
        const filePaths = res?.filePaths || [];
        selectedPhotoFiles = Array.isArray(res?._files) ? res._files : [];
        if (!filePaths.length) {
          selectedPhotos = [];
          selectedPhotoFiles = [];
          if (photosSum) photosSum.textContent = `0 selected`;
          return;
        }

        if (typeof window.openFileNamingPopup === 'function' && typeof window.applyNamingToList === 'function') {
          const cfg = await window.openFileNamingPopup({
            station: stn,
            files: filePaths,
            defaultExt: ''
          });
          if (!cfg) {
            selectedPhotos = [];
            selectedPhotoFiles = [];
            if (photosSum) photosSum.textContent = `0 selected`;
            return;
          }
          const renamed = window.applyNamingToList({
            station: stn,
            files: filePaths,
            config: cfg
          });
          selectedPhotos = renamed.map((r, i) => ({ path: filePaths[i], name: r.newName }));
        } else {
          selectedPhotos = filePaths.slice();
        }

        if (photosSum) photosSum.textContent = `${filePaths.length} selected`;
      } catch (e) {
        console.error('[pickProjectPhotos] failed', e);
      }
    });

    // Report picker
    pickReport?.addEventListener('click', async () => {
      try {
        const res = await window.electronAPI.pickProjectReport();
        selectedReport = res?.filePath || null;
        selectedReportFile = res?._file || null;
        if (reportSum) reportSum.textContent = selectedReport ? '1 PDF' : 'None';
      } catch (e) {
        console.error('[pickProjectReport] failed', e);
      }
    });

    // Create button
    createEl?.addEventListener('click', async () => {
      const err = validate();
      if (err) {
        setError(err);
        return;
      }
      setError('');

      const payload = {
        year: Number(yearEl?.value || 0),
        name: String(nameEl?.value || '').trim(),
        projectLead: String(projectLeadEl?.value || '').trim(),
        comment: String(commEl?.value || '').trim(),
        photos: selectedPhotos,
        report: selectedReport,
        _photoFiles: selectedPhotoFiles,
        _reportFile: selectedReportFile,
      };

      createEl.disabled = true;
      createEl.textContent = 'Creating…';
      try {
        const res = await window.electronAPI.createProject(stn.name, stn.station_id, payload);
        if (res && res.success) {
          // If repairs added, save them
          if (pendingRepairs.length) {
            try {
              await window.electronAPI.saveRepairs(stn.name, stn.station_id, pendingRepairs);
            } catch (e) {
              console.warn('[saveRepairs] failed', e);
            }
          }
          closeModal();
          await renderList(host, stn);
        } else {
          setError('Failed to create project.' + (res?.message ? `\n\n${res.message}` : ''));
        }
      } catch (e) {
        console.error('[createProject] failed', e);
        setError('Failed to create project.');
      } finally {
        createEl.disabled = false;
        createEl.textContent = 'Create';
      }
    });
  }

  // Expose globally so station.js can call it
  window.initProjectHistoryTab = initProjectHistoryTab;
})();

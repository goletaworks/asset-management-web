// frontend/js/file_naming_popup.js
// Global helper to prompt for a batch filename convention and produce renamed filenames.
(function () {
   'use strict';

   function pad2(n) { return String(n).padStart(2, '0'); }

   function yyyymmddFromDateInput(v) {
     // v is "YYYY-MM-DD"
     if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
     return v.replace(/-/g, '');
   }

   function todayInputValue() {
     const d = new Date();
     const yyyy = d.getFullYear();
     const mm = pad2(d.getMonth() + 1);
     const dd = pad2(d.getDate());
     return `${yyyy}-${mm}-${dd}`;
   }

   function sanitizeToken(s) {
     // Token used in filename segments (no extension). Keep letters/numbers/_/-
     return String(s ?? '')
       .trim()
       .replace(/\s+/g, '_')
       .replace(/[^a-zA-Z0-9_-]/g, '_')
       .replace(/_+/g, '_')
       .replace(/^_+|_+$/g, '');
   }

   function getStationId(station) {
     return String(station?.station_id ?? station?.stationId ?? station?.StationID ?? station?.StationId ?? '').trim();
   }

   function inferModeFromStation(station) {
     // Best-effort inference; user can override in the popup.
     const raw =
       station?.asset_type ??
       station?.assetType ??
       station?.AssetType ??
       station?.['Asset Type'] ??
       station?.['General Information – Asset Type'] ??
       station?.['General Information - Asset Type'] ??
       '';
     const t = String(raw).toLowerCase();
     if (t.includes('cableway')) return 'CBL';
     if (t.includes('weir') || t.includes('shelter')) return 'STR';
     return 'OTHER';
   }

   function buildBaseNameParts({ stationId, yyyymmdd, mode, blank, extra }) {
     const parts = [stationId, yyyymmdd];
     if (mode === 'CBL') {
       parts.push('CBL');
       const ex = sanitizeToken(extra);
       if (ex) parts.push(ex);
       return parts;
     }
     if (mode === 'STR') {
       parts.push('STR');
       const ex = sanitizeToken(extra);
       if (ex) parts.push(ex);
       return parts;
     }
     // OTHER:
     const b = sanitizeToken(blank);
     if (b) parts.push(b);
     const ex = sanitizeToken(extra);
     if (ex) parts.push(ex);
     return parts;
   }

   function extFromName(name) {
     const s = String(name || '');
     const i = s.lastIndexOf('.');
     if (i <= 0 || i === s.length - 1) return '';
     return s.slice(i).toLowerCase();
   }

   function applyNamingToList({ station, files, config }) {
     // files: array of { originalName, ext } OR string paths
     const stationId = getStationId(station);
     const yyyymmdd = config?.yyyymmdd;
     if (!stationId || !yyyymmdd) throw new Error('Missing station id or date for naming.');

     const mode = config?.mode || 'OTHER';
     const blank = config?.blank || '';
     const extra = config?.extra || '';

     const baseParts = buildBaseNameParts({ stationId, yyyymmdd, mode, blank, extra });
     const baseStem = baseParts.join('_');

     // If user selects multiple files, baseStem will be identical. Backend uniqueness will prevent overwrite.
     // We still return identical stems per spec; uniqueness handled on disk.
     return files.map((f) => {
       const original = typeof f === 'string' ? f : (f?.originalName || '');
       const ext = typeof f === 'string' ? extFromName(f) : (f?.ext || '');
       return {
         original,
         newName: `${baseStem}${ext || ''}`
       };
     });
   }

   function ensureModal() {
     let modal = document.querySelector('#fileNamingModal');
     if (modal) return modal;

     modal = document.createElement('div');
     modal.id = 'fileNamingModal';
     modal.className = 'modal';
     modal.style.display = 'none';
     modal.innerHTML = `
       <div class="modal-content" style="max-width:520px;width:92%;padding:18px 18px 14px;">
         <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
           <h3 style="margin:0;font-size:16px;">File Naming</h3>
           <button id="fnClose" class="btn btn-ghost" type="button">Close</button>
         </div>
         <p style="margin:8px 0 14px;color:#6b7280;font-size:13px;line-height:1.35;">
           This will rename <b>all selected files</b> using the station naming convention.
         </p>

         <div style="display:flex;flex-direction:column;gap:10px;">
           <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
             <span style="color:#374151;font-weight:600;">Date</span>
             <input id="fnDate" type="date" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;" />
           </label>

           <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
             <span style="color:#374151;font-weight:600;">Asset Type Code</span>
             <select id="fnMode" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;">
               <option value="CBL">Cableway (CBL)</option>
               <option value="STR">Weir / Shelter (STR)</option>
               <option value="OTHER">Other (custom segment optional)</option>
             </select>
           </label>

           <label id="fnBlankWrap" style="display:none;flex-direction:column;gap:6px;font-size:13px;">
             <span style="color:#374151;font-weight:600;">Custom segment (optional)</span>
             <input id="fnBlank" type="text" placeholder="Leave blank to omit" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;" />
           </label>

           <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
             <span style="color:#374151;font-weight:600;">Extra naming (optional)</span>
             <input id="fnExtra" type="text" placeholder="Leave blank to omit" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;" />
           </label>

           <div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:#f9fafb;">
             <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Preview (first file)</div>
             <div id="fnPreview" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;font-size:12px;color:#111827;word-break:break-all;"></div>
           </div>
         </div>

         <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
           <button id="fnCancel" class="btn btn-ghost" type="button">Cancel</button>
           <button id="fnApply" class="btn btn-primary" type="button">Apply</button>
         </div>
       </div>
     `;
     document.body.appendChild(modal);
     return modal;
   }

   function openFileNamingPopup({ station, files, defaultExt = '' }) {
     const modal = ensureModal();
     const btnClose = modal.querySelector('#fnClose');
     const btnCancel = modal.querySelector('#fnCancel');
     const btnApply = modal.querySelector('#fnApply');
     const dateEl = modal.querySelector('#fnDate');
     const modeEl = modal.querySelector('#fnMode');
     const blankWrap = modal.querySelector('#fnBlankWrap');
     const blankEl = modal.querySelector('#fnBlank');
     const extraEl = modal.querySelector('#fnExtra');
     const previewEl = modal.querySelector('#fnPreview');

     const stationId = getStationId(station);
     if (!stationId) {
       // No station id: do not block uploads, just bypass popup.
       return Promise.resolve(null);
     }

     const inferred = inferModeFromStation(station);
     dateEl.value = todayInputValue();
     modeEl.value = inferred;
     blankEl.value = '';
     extraEl.value = '';
     blankWrap.style.display = (modeEl.value === 'OTHER') ? 'flex' : 'none';

     const firstName = (files && files[0] && (files[0].name || files[0].originalName || files[0])) || '';
     const firstExt = extFromName(firstName) || defaultExt || '';

     function updatePreview() {
       const yyyymmdd = yyyymmddFromDateInput(dateEl.value) || 'YYYYMMDD';
       const mode = modeEl.value || 'OTHER';
       const blank = blankEl.value || '';
       const extra = extraEl.value || '';
       const parts = buildBaseNameParts({ stationId, yyyymmdd, mode, blank, extra });
       previewEl.textContent = `${parts.join('_')}${firstExt}`;
       blankWrap.style.display = (mode === 'OTHER') ? 'flex' : 'none';
     }
     updatePreview();

     const onBackdrop = (e) => { if (e.target === modal) close(null); };
     const onEsc = (e) => { if (e.key === 'Escape') close(null); };

     function close(val) {
       modal.style.display = 'none';
       modal.removeEventListener('click', onBackdrop);
       document.removeEventListener('keydown', onEsc);
       // remove listeners (avoid duplicates)
       btnClose.onclick = null;
       btnCancel.onclick = null;
       btnApply.onclick = null;
       dateEl.oninput = null;
       modeEl.onchange = null;
       blankEl.oninput = null;
       extraEl.oninput = null;
       resolve(val);
     }

     let resolve;
     const p = new Promise((res) => { resolve = res; });

     btnClose.onclick = () => close(null);
     btnCancel.onclick = () => close(null);
     btnApply.onclick = () => {
       const yyyymmdd = yyyymmddFromDateInput(dateEl.value);
       if (!yyyymmdd) {
         appAlert('Please select a valid date.');
         return;
       }
       close({
         yyyymmdd,
         mode: modeEl.value || 'OTHER',
         blank: blankEl.value || '',
         extra: extraEl.value || '',
       });
     };

     dateEl.oninput = updatePreview;
     modeEl.onchange = updatePreview;
     blankEl.oninput = updatePreview;
     extraEl.oninput = updatePreview;

     modal.addEventListener('click', onBackdrop);
     document.addEventListener('keydown', onEsc);
     modal.style.display = 'flex';

    return p;
  }

  // Expose helpers globally
  window.openFileNamingPopup = openFileNamingPopup;
  window.applyNamingToList = applyNamingToList;
})();
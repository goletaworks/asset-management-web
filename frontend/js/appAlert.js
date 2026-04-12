// appAlert.js -- Standalone alert/confirm modals for the web app.
// Extracted from preload.js contextBridge code.
'use strict';

(function () {

  // ─── CSS ─────────────────────────────────────────────────────────────────
  const ALERT_CSS = `
.app-alert-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:2147483646}
.app-alert-overlay.show{display:flex}
.app-alert-modal{max-width:520px;width:calc(100% - 32px);background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4}
.app-alert-title{margin:0 0 8px;font-size:18px;font-weight:600}
.app-alert-message{margin:0 0 16px;white-space:pre-wrap;word-wrap:break-word}
.app-alert-actions{display:flex;justify-content:flex-end;gap:8px}
.app-alert-btn{appearance:none;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
.app-alert-btn:focus{outline:2px solid #4c9ffe;outline-offset:2px}
.app-alert-ok{background:#111;color:#fff}
@media (prefers-color-scheme: dark){
  .app-alert-modal{background:#1d1f23;color:#e6e6e6}
  .app-alert-ok{background:#e6e6e6;color:#111}
}

.app-confirm-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:2147483646}
.app-confirm-overlay.show{display:flex}
.app-confirm-modal{max-width:520px;width:calc(100% - 32px);background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4}
.app-confirm-title{margin:0 0 8px;font-size:18px;font-weight:600}
.app-confirm-message{margin:0 0 16px;white-space:pre-wrap;word-wrap:break-word}
.app-confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.app-confirm-btn{appearance:none;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
.app-confirm-btn:focus{outline:2px solid #4c9ffe;outline-offset:2px}
.app-confirm-ok{background:#111;color:#fff}
.app-confirm-cancel{background:#e5e5e5;color:#111}
.app-confirm--danger .app-confirm-ok{background:#dc2626;color:#fff}
@media (prefers-color-scheme: dark){
  .app-confirm-modal{background:#1d1f23;color:#e6e6e6}
  .app-confirm-ok{background:#e6e6e6;color:#111}
  .app-confirm-cancel{background:#333;color:#e6e6e6}
  .app-confirm--danger .app-confirm-ok{background:#dc2626;color:#fff}
}
`;

  function injectStyles() {
    if (document.getElementById('app-alert-styles')) return;
    const s = document.createElement('style');
    s.id = 'app-alert-styles';
    s.textContent = ALERT_CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ─── appAlert ────────────────────────────────────────────────────────────
  let alertNodes = null;
  function ensureAlertDOM() {
    if (alertNodes) return alertNodes;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'app-alert-overlay';
    overlay.setAttribute('role', 'presentation');
    const modal = document.createElement('div');
    modal.className = 'app-alert-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const title = document.createElement('h2');
    title.className = 'app-alert-title';
    title.id = 'app-alert-title';
    modal.setAttribute('aria-labelledby', title.id);
    const msg = document.createElement('div');
    msg.className = 'app-alert-message';
    const actions = document.createElement('div');
    actions.className = 'app-alert-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'app-alert-btn app-alert-ok';
    ok.textContent = 'OK';
    actions.appendChild(ok);
    modal.appendChild(title);
    modal.appendChild(msg);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    const appendNow = () => document.body.appendChild(overlay);
    if (document.body) appendNow();
    else window.addEventListener('DOMContentLoaded', appendNow, { once: true });
    alertNodes = { overlay, title, msg, ok };
    return alertNodes;
  }

  function appAlert(message, opts) {
    opts = opts || {};
    const { title = 'Notice', okText = 'OK', closeOnBackdrop = true, timeout = null } = opts;
    const { overlay, title: titleEl, msg, ok } = ensureAlertDOM();
    titleEl.textContent = String(title);
    msg.textContent = message == null ? '' : String(message);
    ok.textContent = okText;
    return new Promise((resolve) => {
      let onKeyDown;
      const cleanup = () => {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.classList.remove('show');
        if (document.body) document.body.style.overflow = '';
        resolve();
      };
      onKeyDown = (e) => {
        if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); cleanup(); }
      };
      ok.onclick = cleanup;
      overlay.onclick = (e) => { if (closeOnBackdrop && e.target === overlay) cleanup(); };
      overlay.classList.add('show');
      if (document.body) document.body.style.overflow = 'hidden';
      setTimeout(() => { try { ok.focus(); } catch (_) {} }, 0);
      if (timeout && Number.isFinite(timeout)) setTimeout(cleanup, timeout);
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

  // ─── appConfirm ──────────────────────────────────────────────────────────
  let _confirmNodes = null;
  function ensureConfirmDOM() {
    if (_confirmNodes) return _confirmNodes;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay';
    overlay.setAttribute('role', 'presentation');
    const modal = document.createElement('div');
    modal.className = 'app-confirm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const titleEl = document.createElement('h2');
    titleEl.className = 'app-confirm-title';
    titleEl.id = 'app-confirm-title';
    titleEl.textContent = 'Confirm';
    modal.setAttribute('aria-labelledby', titleEl.id);
    const msgEl = document.createElement('div');
    msgEl.className = 'app-confirm-message';
    const actions = document.createElement('div');
    actions.className = 'app-confirm-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-confirm-btn app-confirm-cancel';
    cancelBtn.textContent = 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'app-confirm-btn app-confirm-ok';
    okBtn.textContent = 'OK';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    modal.appendChild(titleEl);
    modal.appendChild(msgEl);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    const append = () => document.body.appendChild(overlay);
    if (document.body) append();
    else window.addEventListener('DOMContentLoaded', append, { once: true });
    _confirmNodes = { overlay, modal, titleEl, msgEl, okBtn, cancelBtn };
    return _confirmNodes;
  }

  function appConfirm(message) {
    const text = String(message ?? '');
    const { overlay, modal, titleEl, msgEl, okBtn, cancelBtn } = ensureConfirmDOM();
    const isDanger = /(delete|warning|permanent|nuke)/i.test(text);
    modal.classList.toggle('app-confirm--danger', isDanger);
    titleEl.textContent = 'Confirm';
    msgEl.textContent = text;
    return new Promise((resolve) => {
      const prevOverflow = document.body ? document.body.style.overflow : '';
      const active = document.activeElement;
      const cleanup = (result) => {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.removeEventListener('click', onBackdrop, true);
        okBtn.removeEventListener('click', onOK, true);
        cancelBtn.removeEventListener('click', onCancel, true);
        overlay.classList.remove('show');
        if (document.body) document.body.style.overflow = prevOverflow;
        try { active && active.focus && active.focus(); } catch (_) {}
        resolve(result);
      };
      const onOK = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
      const onKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
        else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
      };
      okBtn.addEventListener('click', onOK, true);
      cancelBtn.addEventListener('click', onCancel, true);
      overlay.addEventListener('click', onBackdrop, true);
      document.addEventListener('keydown', onKeyDown, true);
      overlay.classList.add('show');
      if (document.body) document.body.style.overflow = 'hidden';
      setTimeout(() => { try { okBtn.focus(); } catch (_) {} }, 0);
    });
  }

  // Expose globally
  window.appAlert = appAlert;
  window.appConfirm = appConfirm;
  window.showConfirm = appConfirm;

})();

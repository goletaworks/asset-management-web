// frontend/js/boot_status.js
(function () {
  'use strict';
  const overlay = document.getElementById('excelBootOverlay');
  const fill = document.getElementById('excelBootFill');
  const text = document.getElementById('excelBootText');
  if (!overlay || !fill || !text || !window.electronAPI?.onExcelProgress) return;

  const update = (pct, msg) => {
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    text.textContent = msg || 'Loading Excel…';
    if (pct >= 100) {
      // small delay for a smooth finish
      setTimeout(() => overlay.classList.add('boot-hidden'), 250);
    }
  };

  // Check if we need to show the overlay based on database config
  if (window.electronAPI?.getDbConfig) {
    window.electronAPI.getDbConfig()
      .then((config) => {
        const readFromExcel = config?.readSource === 'excel';

        if (!readFromExcel) {
          // Hide overlay immediately if not reading from Excel
          console.log('[boot_status] Read source is', config?.readSource, '- hiding Excel overlay');
          overlay.classList.add('boot-hidden');
          return;
        }

        // Reading from Excel - show overlay and track progress
        console.log('[boot_status] Read source is Excel - showing overlay');
        update(5, 'Starting Excel worker…');

        // subscribe to progress
        window.electronAPI.onExcelProgress((p) => {
          const pct = typeof p?.pct === 'number' ? p.pct : 0;
          const msg = p?.msg || 'Loading…';
          update(pct, msg);
        });
      })
      .catch((err) => {
        console.error('[boot_status] Failed to get DB config:', err);
        // Fallback to showing the overlay
        update(5, 'Starting Excel worker…');
        window.electronAPI.onExcelProgress((p) => {
          const pct = typeof p?.pct === 'number' ? p.pct : 0;
          const msg = p?.msg || 'Loading…';
          update(pct, msg);
        });
      });
  } else {
    // Fallback if API not available
    update(5, 'Starting Excel worker…');
    window.electronAPI.onExcelProgress((p) => {
      const pct = typeof p?.pct === 'number' ? p.pct : 0;
      const msg = p?.msg || 'Loading…';
      update(pct, msg);
    });
  }
})();

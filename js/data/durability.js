(function() {
  'use strict';

  let BACKUP_KEY = 'budget_dashboard_pre_import_backup';

  // ── Show/hide the restore backup button based on backup existence ──────
  function refreshBackupButtonVisibility() {
    let btn = document.getElementById('restoreBackupBtn');
    if (!btn) return;
    try {
      let raw = localStorage.getItem(BACKUP_KEY);
      btn.style.display = raw ? '' : 'none';
    } catch(e) {
      btn.style.display = 'none';
    }
  }

  // ── Restore backup handler ─────────────────────────────────────────────
  function wireRestoreBackup() {
    let btn = document.getElementById('restoreBackupBtn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      try {
        let raw = localStorage.getItem(BACKUP_KEY);
        if (!raw) { alert('No backup found.'); return; }
        let wrapper = JSON.parse(raw);
        let backupState = wrapper.state;
        if (!backupState || !Array.isArray(backupState.months) || !backupState.months.length) {
          alert('The backup appears to be empty or corrupted.');
          return;
        }
        let backedUpAt = wrapper._backedUpAt
          ? new Date(wrapper._backedUpAt).toLocaleString()
          : 'unknown time';
        let monthCount = backupState.months.length;
        let confirmed = confirm(
          'Restore pre-import backup?\n\n' +
          '  • ' + monthCount + ' month' + (monthCount === 1 ? '' : 's') + '\n' +
          '  • Backed up: ' + backedUpAt + '\n\n' +
          'This will replace your current data with the backup.'
        );
        if (!confirmed) return;

        // Apply backup as live state
        if (typeof prepareMonth === 'function') {
          backupState.months.forEach(function(month, index, months) {
            prepareMonth(month, index, months);
          });
        }
        if (typeof ensureSubscriptionsState === 'function') ensureSubscriptionsState(backupState);
        if (typeof ensureSubscriptionUiState === 'function') ensureSubscriptionUiState(backupState);

        window.state = backupState;
        if (typeof saveState === 'function') saveState(backupState);

        // Remove the backup so the button hides after restore
        localStorage.removeItem(BACKUP_KEY);
        refreshBackupButtonVisibility();

        // Force immediate re-render
        window.__renderImmediate = true;
        if (typeof render === 'function') render();
        if (typeof clearDirty === 'function') clearDirty();

      } catch(err) {
        alert('The backup could not be restored. It may be corrupted.');
        console.error('Restore backup error:', err);
      }
    });
  }

  // ── localStorage health check on startup ──────────────────────────────
  // Estimates current usage and warns if > 4MB (leaving 1MB headroom)
  function checkStorageHealth() {
    try {
      let totalBytes = 0;
      for (let key in localStorage) {
        if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
        totalBytes += (localStorage[key].length + key.length) * 2; // UTF-16
      }
      let totalKB = Math.round(totalBytes / 1024);
      if (totalKB > 4096) {
        // Only warn once per session
        if (!window.__storageHealthWarned) {
          window.__storageHealthWarned = true;
          setTimeout(function() {
            alert(
              'Your browser storage is getting full (' + totalKB + ' KB used).\n\n' +
              'Please export your data regularly using "Export data" to keep a safe backup.\n\n' +
              'If storage fills up completely, new changes may not be saved.'
            );
          }, 1500);
        }
      }
    } catch(e) { /* non-critical */ }
  }

  // ── Init ──────────────────────────────────────────────────────────────
  function initBackupRestore() {
    refreshBackupButtonVisibility();
    wireRestoreBackup();
    checkStorageHealth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackupRestore, { once: true });
  } else {
    initBackupRestore();
  }
})();

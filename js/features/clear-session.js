/* ============================================================================
   Veyra — Clear All Data ("start new")
   ----------------------------------------------------------------------------
   Adds a single Tools & Actions option that wipes the entire Veyra session from
   localStorage so the user can start completely fresh, without having to delete
   each month one by one and without clearing unrelated browser data.

   Design notes
   ------------
   • Irreversible, so it is guarded by (a) an optional one-click full backup that
     round-trips through the existing "Import data" flow, and (b) a typed
     confirmation ("DELETE") before the destructive button is enabled.
   • The wipe combines an explicit allow-list of every known Veyra key with a
     prefix scan over Veyra's storage-key conventions. The prefix scan future-
     proofs against keys added later; the explicit list guarantees nothing known
     is missed. Keys that do not match a Veyra convention are never touched.
   • After clearing we simply reload. app.js's loadState() already treats a
     missing main key as a brand-new install: it re-seeds the starter template
     and clears the onboarding flags so the first-run guide reappears. Reusing
     that path is the least-surprising "fresh start" and avoids re-initialising
     in place across ~18 modules.
   ============================================================================ */
(function () {
  if (window.__veyraClearSessionV1) return;
  window.__veyraClearSessionV1 = true;

  var MAIN_KEY = 'budget_dashboard_v12';
  var CONFIRM_WORD = 'DELETE';

  // Every Veyra storage key known at time of writing. Kept explicit so a known
  // key is never missed even if a naming convention changes later.
  var EXPLICIT_KEYS = [
    // Core state + safety copies
    'budget_dashboard_v12',
    'budget_dashboard_v12_recovery',
    'budget_dashboard_pre_import_backup',
    // Theme
    'veyra-theme',
    // Achievements / badges (incl. legacy schemas) + weekly check-ins
    'badge_system_v4', 'badge_system_v3', 'badge_system_v2', 'badge_system_v1',
    'budget_checkin_v5', 'budget_checkin_v4',
    // Onboarding / guides / wizard
    'veyra_welcome_onboarding_v1',
    'veyra_guide_v2', 'veyra_guide_v1',
    'veyra_setup_wizard_v1',
    // CSV import learning + credit cards / accounts
    'veyra_csvMerchantMap_v1',
    'veyra_csvColumnMap_v1',
    'veyra_creditCards_v2',
    'veyra_accounts_v1',
    'veyra_ccRepayPatterns_v1',
    // Card layout / ordering / visibility
    'budgetDashboard_cardVisibilityV2',
    'budgetDashboard_cardOrderV1',
    'budgetDashboard_kpiOrder',
    'budgetDashboard_insightOrder',
    'budgetDashboard_allocCardOrderV1'
  ];

  // Prefixes that unambiguously belong to Veyra. Anything matching one of these
  // is safe to remove; anything that does not is left alone.
  var VEYRA_PREFIXES = [
    'veyra',            // veyra-theme, veyra_*
    'budget_dashboard', // budget_dashboard_v12, _recovery, _pre_import_backup
    'budgetDashboard',  // budgetDashboard_*
    'badge_system',     // badge_system_v1..v4
    'budget_checkin'    // budget_checkin_v4/v5
  ];

  function isVeyraKey(key) {
    if (EXPLICIT_KEYS.indexOf(key) !== -1) return true;
    for (var i = 0; i < VEYRA_PREFIXES.length; i++) {
      if (key.indexOf(VEYRA_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  // ── Backup ────────────────────────────────────────────────────────────────
  // Mirror the "Export data" payload exactly so the backup can be restored via
  // the existing "Import data" button.
  function decodeStoredState(raw) {
    if (raw == null) return null;
    try {
      if (typeof raw === 'string' && raw.indexOf('LZ1:') === 0) {
        if (window.LZString && typeof LZString.decompressFromUTF16 === 'function') {
          var dec = LZString.decompressFromUTF16(raw.slice(4));
          return dec ? JSON.parse(dec) : null;
        }
        return null;
      }
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function getLiveState() {
    // Prefer the in-memory state app.js exposes; fall back to decoding storage.
    if (window.state && typeof window.state === 'object' && Array.isArray(window.state.months)) {
      return window.state;
    }
    try { return decodeStoredState(localStorage.getItem(MAIN_KEY)); }
    catch (e) { return null; }
  }

  function downloadBackup() {
    var live = getLiveState();
    if (!live || !Array.isArray(live.months)) return false; // nothing to back up

    var payload = Object.assign({}, live, {
      _version: 2,
      _appKey: 'budget_dashboard',
      _exportedAt: new Date().toISOString(),
      _monthCount: live.months.length
    });

    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'veyra-backup-before-clear-' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
      return true;
    } catch (e) {
      console.error('Clear-session backup failed:', e);
      return false;
    }
  }

  // ── The wipe ────────────────────────────────────────────────────────────────
  function clearAllVeyraData() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch (e) {
      // Storage unavailable — fall back to the explicit list only.
      keys = EXPLICIT_KEYS.slice();
    }
    var removed = 0;
    keys.forEach(function (k) {
      if (k && isVeyraKey(k)) {
        try { localStorage.removeItem(k); removed++; } catch (e) {}
      }
    });
    // Belt and braces: ensure every explicit key is gone even if enumeration
    // missed it (e.g. some browsers mutate the index during iteration).
    EXPLICIT_KEYS.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    return removed;
  }

  // ── Confirmation modal ───────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('veyraClearSessionStyles')) return;
    var css = ''
      + '.veyra-clear-overlay{position:fixed;inset:0;z-index:2147483600;display:flex;'
      + 'align-items:center;justify-content:center;padding:20px;box-sizing:border-box;'
      + 'background:rgba(15,23,42,0.50);backdrop-filter:blur(2px);}'
      + '.veyra-clear-modal{width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 40px);'
      + 'overflow:auto;background:var(--bg,#f5f4f0);color:var(--text,#0f172a);'
      + 'border:1px solid var(--card-border,rgba(15,23,42,0.12));border-radius:16px;'
      + 'box-shadow:0 18px 48px rgba(0,0,0,0.30);padding:22px 22px 18px;box-sizing:border-box;}'
      + '.veyra-clear-modal h3{margin:0 0 4px;font-size:1.12rem;font-weight:700;display:flex;'
      + 'align-items:center;gap:9px;}'
      + '.veyra-clear-badge{display:inline-flex;align-items:center;justify-content:center;'
      + 'width:30px;height:30px;border-radius:9px;background:var(--surface-error-soft,#fef2f2);'
      + 'color:var(--red-error,#ef4444);font-size:1rem;flex:0 0 auto;}'
      + '.veyra-clear-modal p{margin:10px 0 0;font-size:0.86rem;line-height:1.5;'
      + 'color:var(--muted,#64748b);}'
      + '.veyra-clear-modal .veyra-clear-list{margin:10px 0 0;padding-left:18px;font-size:0.82rem;'
      + 'line-height:1.55;color:var(--muted,#64748b);}'
      + '.veyra-clear-modal .veyra-clear-warn{margin-top:12px;font-weight:600;'
      + 'color:var(--text,#0f172a);}'
      + '.veyra-clear-opt{display:flex;align-items:flex-start;gap:9px;margin-top:16px;'
      + 'font-size:0.85rem;line-height:1.45;cursor:pointer;}'
      + '.veyra-clear-opt input{margin-top:2px;flex:0 0 auto;width:16px;height:16px;'
      + 'accent-color:var(--purple,#5e17eb);cursor:pointer;}'
      + '.veyra-clear-confirm-label{display:block;margin-top:16px;font-size:0.8rem;'
      + 'font-weight:600;color:var(--text,#0f172a);}'
      + '.veyra-clear-confirm-label code{font-weight:700;color:var(--red-error,#ef4444);'
      + 'background:var(--surface-error-soft,#fef2f2);padding:1px 6px;border-radius:5px;}'
      + '.veyra-clear-input{width:100%;margin-top:7px;box-sizing:border-box;padding:9px 11px;'
      + 'border:1px solid var(--card-border,rgba(15,23,42,0.16));border-radius:9px;'
      + 'background:var(--surface-light,#f8fafc);color:var(--text,#0f172a);font-size:0.9rem;'
      + 'letter-spacing:0.04em;}'
      + '.veyra-clear-input:focus{outline:none;border-color:var(--purple,#5e17eb);'
      + 'box-shadow:0 0 0 3px rgba(94,23,235,0.16);}'
      + '.veyra-clear-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:20px;}'
      + '.veyra-clear-actions button{font:inherit;font-size:0.86rem;font-weight:600;'
      + 'padding:9px 15px;border-radius:9px;cursor:pointer;border:1px solid transparent;'
      + 'transition:background 130ms ease,border-color 130ms ease,color 130ms ease,opacity 130ms ease;}'
      + '.veyra-clear-cancel{background:transparent;color:var(--text,#0f172a);'
      + 'border-color:var(--card-border,rgba(15,23,42,0.16));}'
      + '.veyra-clear-cancel:hover{background:var(--slate-10,rgba(71,85,105,0.10));}'
      + '.veyra-clear-go{background:var(--red-error,#ef4444);color:#fff;}'
      + '.veyra-clear-go:hover{background:#dc2626;}'
      + '.veyra-clear-go:disabled{opacity:0.45;cursor:not-allowed;}'
      + '.veyra-clear-go:disabled:hover{background:var(--red-error,#ef4444);}';
    var style = document.createElement('style');
    style.id = 'veyraClearSessionStyles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  var lastTrigger = null;

  function closeModal() {
    var overlay = document.getElementById('veyraClearOverlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onKeydown, true);
    if (lastTrigger && document.contains(lastTrigger)) {
      try { lastTrigger.focus({ preventScroll: true }); } catch (e) { try { lastTrigger.focus(); } catch (e2) {} }
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') {
      // Minimal focus trap within the dialog.
      var modal = document.getElementById('veyraClearModal');
      if (!modal) return;
      var f = modal.querySelectorAll('button:not([disabled]), input:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function performClear(downloadFirst) {
    if (downloadFirst) downloadBackup();
    // Give the browser a beat to kick off the download before navigating away.
    setTimeout(function () {
      clearAllVeyraData();
      // Reload → loadState() re-seeds a fresh starter budget and re-shows the
      // first-run guide, exactly like a brand-new install.
      window.location.reload();
    }, downloadFirst ? 220 : 0);
  }

  function openModal(trigger) {
    lastTrigger = trigger || document.activeElement || null;
    injectStyles();

    // Close the Tools drawer so the dialog isn't competing with it visually.
    try {
      if (typeof window.veyraCloseToolsDrawer === 'function') window.veyraCloseToolsDrawer();
      document.body.classList.remove('tools-drawer-open');
    } catch (e) {}

    var overlay = document.createElement('div');
    overlay.className = 'veyra-clear-overlay';
    overlay.id = 'veyraClearOverlay';
    overlay.innerHTML =
      '<div class="veyra-clear-modal" id="veyraClearModal" role="dialog" aria-modal="true" aria-labelledby="veyraClearTitle">' +
        '<h3 id="veyraClearTitle"><span class="veyra-clear-badge" aria-hidden="true">⚠</span>Clear all data &amp; start new</h3>' +
        '<p>This permanently removes <strong>everything Veyra has stored on this device</strong> and returns the app to a fresh, first-time setup.</p>' +
        '<ul class="veyra-clear-list">' +
          '<li>All months, income, expenses, savings, debts, goals &amp; subscriptions</li>' +
          '<li>Credit cards, accounts &amp; imported bank data</li>' +
          '<li>Achievements, check-ins, and saved preferences (theme, card layout)</li>' +
        '</ul>' +
        '<p class="veyra-clear-warn">This cannot be undone.</p>' +
        '<label class="veyra-clear-opt">' +
          '<input type="checkbox" id="veyraClearBackup" checked>' +
          '<span>Download a full backup first <em>(recommended)</em> — you can restore it later with <strong>Import data</strong>.</span>' +
        '</label>' +
        '<label class="veyra-clear-confirm-label" for="veyraClearInput">Type <code>' + CONFIRM_WORD + '</code> to confirm</label>' +
        '<input class="veyra-clear-input" id="veyraClearInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Type ' + CONFIRM_WORD + ' to confirm">' +
        '<div class="veyra-clear-actions">' +
          '<button type="button" class="veyra-clear-cancel" id="veyraClearCancel">Cancel</button>' +
          '<button type="button" class="veyra-clear-go" id="veyraClearGo" disabled>Clear everything</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var input  = document.getElementById('veyraClearInput');
    var goBtn  = document.getElementById('veyraClearGo');
    var cancel = document.getElementById('veyraClearCancel');
    var backup = document.getElementById('veyraClearBackup');

    function sync() {
      goBtn.disabled = input.value.trim().toUpperCase() !== CONFIRM_WORD;
    }
    input.addEventListener('input', sync);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !goBtn.disabled) { e.preventDefault(); goBtn.click(); }
    });

    cancel.addEventListener('click', closeModal);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) closeModal(); // click outside dismisses
    });
    goBtn.addEventListener('click', function () {
      if (goBtn.disabled) return;
      goBtn.disabled = true;
      goBtn.textContent = 'Clearing…';
      performClear(!!(backup && backup.checked));
    });

    document.addEventListener('keydown', onKeydown, true);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────
  function ensureButton() {
    var btn = document.getElementById('clearAllDataBtn');
    if (!btn) {
      // Defensive injection in case the static markup is absent on some deploy.
      var reset = document.getElementById('resetBtn');
      if (reset && reset.parentNode) {
        btn = document.createElement('button');
        btn.className = 'danger';
        btn.id = 'clearAllDataBtn';
        btn.title = 'Erase all Veyra data and start completely fresh';
        btn.innerHTML = '<span class="btn-icon">🗑</span> Clear all data';
        reset.parentNode.insertBefore(btn, reset.nextSibling);
      }
    }
    if (btn && !btn.dataset.clearWired) {
      btn.dataset.clearWired = 'true';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openModal(btn);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureButton);
  } else {
    ensureButton();
  }
})();

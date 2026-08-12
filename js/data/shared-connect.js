(function () {
  'use strict';

  // ============================================================================
  // Veyra Shared-Budget Connect — Stage 4c of the sync/sharing build.
  //
  // Lets someone connect to an account another person has shared with them
  // via normal Google Drive folder sharing (right-click a Veyra account
  // folder -> Share -> enter an email). Uses Google's Picker widget — a
  // SEPARATE library from Google Identity Services (google-sync.js) — which
  // is the only way drive.file scope can grant access to something this app
  // didn't create itself: the consent handshake happens inside the Picker's
  // own flow when the user explicitly selects an item.
  //
  // Deliberately restricted to FOLDER selection, not files — Veyra's Drive
  // layout is one folder per account (see drive-sync.js), so the thing
  // being shared and picked is always the account's folder, never the
  // data.json file directly.
  //
  // Only ever visible when signed in with Google (the button is hidden
  // entirely for the default/local identity) — connecting someone else's
  // shared budget makes no sense without an identity of your own to attach
  // it to.
  //
  // IMPORTANT — same caveat as the rest of the Google integration: this
  // cannot be exercised against real Google Picker infrastructure from the
  // environment that built it. The request-building logic is reviewed
  // carefully against Google's current documentation, but the first real
  // end-to-end picker interaction needs to happen in your browser.
  // ============================================================================

  var CONFIG = window.VeyraGoogleSyncConfig || {};
  var API_KEY = CONFIG.apiKey || '';
  var APP_ID = CONFIG.appId || '';
  var PICKER_SRC = 'https://apis.google.com/js/api.js';

  var pickerApiRequested = false;
  var pickerInited = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- button visibility: only ever shown when signed in with Google ----

  function updateButtonVisibility() {
    var btn = document.getElementById('accountConnectSharedBtn');
    if (!btn) return;
    var visible = !!(window.VeyraIdentity && !window.VeyraIdentity.isDefault());
    btn.hidden = !visible;
  }

  // ---- loading the Picker library on demand (lazy — this is a rare action,
  // unlike the sign-in popup, the Picker renders as an inline modal within
  // the page rather than a separate browser popup window, so there's no
  // popup-blocker timing concern here the way there was for sign-in) ----

  function loadPickerApi(callback) {
    if (pickerInited) { callback(); return; }
    if (!API_KEY || !APP_ID) {
      showToast('Connecting shared budgets isn\u2019t set up on this deployment yet.', 'warn');
      return;
    }
    function initializePicker() {
      window.gapi.load('picker', function () {
        pickerInited = true;
        callback();
      });
    }
    if (window.gapi && window.gapi.load) { initializePicker(); return; }
    if (pickerApiRequested) {
      var poll = setInterval(function () {
        if (window.gapi && window.gapi.load) { clearInterval(poll); initializePicker(); }
      }, 50);
      return;
    }
    pickerApiRequested = true;
    var script = document.createElement('script');
    script.src = PICKER_SRC;
    script.async = true;
    script.defer = true;
    script.onload = initializePicker;
    script.onerror = function () {
      console.error('Veyra: could not load Google Picker library.');
      showToast('Could not reach Google — check your connection and try again.', 'error');
    };
    document.head.appendChild(script);
  }

  // ---- the connect flow ----

  function startConnectFlow() {
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return; // button should be hidden anyway
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) {
      showToast('Reconnecting to Google — try \u201cConnect a shared budget\u201d again once signed in.', 'info');
      if (window.VeyraGoogleSync && window.VeyraGoogleSync.signIn) window.VeyraGoogleSync.signIn();
      return;
    }
    closeAccountManagerModal();
    loadPickerApi(function () { showPicker(token); });
  }

  // Account Manager's modal renders at a very high z-index (it's meant to
  // sit above everything else in the app) — high enough that it was also
  // sitting on TOP of the Picker's own error dialogs, hiding them
  // completely. Rather than trying to tune z-index values against a
  // library we don't control, just close our modal before the Picker
  // (or anything it shows, including its own errors) needs the screen.
  function closeAccountManagerModal() {
    var modal = document.getElementById('accountManagerModal');
    if (modal) modal.hidden = true;
    try { document.body.style.overflow = ''; } catch (e) {}
  }

  function showPicker(token) {
    try {
      // Restricted to JSON files, with folder navigation enabled so the
      // user can browse INTO the shared folder to reach the file — but
      // folders themselves are not selectable. This is deliberate: picking
      // a FOLDER through drive.file scope does not reliably grant access
      // to what's inside it (confirmed against Google's own docs and real
      // developer reports of the same gap) — only an explicitly selected
      // FILE is guaranteed accessible. Filtering to JSON keeps the picker
      // focused on the one file type that's actually relevant here.
      var view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMimeTypes('application/json');
      var picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .setAppId(APP_ID)
        // Explicitly declare the embedding page's own origin. Without this,
        // the Picker falls back to auto-detecting it — which, diagnosed
        // from a real failing request, resolved to the page's *favicon*
        // URL instead of the actual page, causing Google's backend to
        // reject the request outright (401) since the origin didn't
        // validate. Setting it explicitly removes the guesswork entirely.
        .setOrigin(window.location.protocol + '//' + window.location.host)
        .setTitle('Browse into the shared folder and select its data.json file')
        .setCallback(pickerCallback)
        .build();
      picker.setVisible(true);
    } catch (err) {
      console.error('Veyra: failed to open the Google Picker', err);
      showToast('Could not open the file picker — check your connection and try again.', 'error');
    }
  }

  function pickerCallback(data) {
    if (!data || data.action !== google.picker.Action.PICKED) return; // CANCEL or anything else — silently do nothing
    var doc = data.docs && data.docs[0];
    if (!doc || !doc.id) return;
    connectSharedFile(doc.id, doc.name || 'data.json');
  }

  function connectSharedFile(fileId, fileName) {
    showToast('Reading \u201c' + fileName + '\u201d\u2026', 'info');
    // Fetch the picked file's own metadata (rather than trusting whatever
    // the Picker's return object happens to include) to reliably learn its
    // parent folder — needed so drive-sync.js can look in the right place
    // again later if this cached file ID ever goes stale.
    driveGetFileParent(fileId).then(function (parentFolderId) {
      return window.VeyraGoogleSync.driveReadFile(fileId).then(function (content) {
        if (!content || !content.account || !content.account.id || !content.budget) {
          showToast('\u201c' + fileName + '\u201d doesn\u2019t look like a valid shared Veyra budget.', 'warn');
          return;
        }
        var result = window.VeyraDriveSync.addJoinedAccount(content.account, content.budget, parentFolderId, fileId);
        if (!result.ok) {
          if (result.reason === 'already-connected') {
            showToast('You\u2019re already connected to \u201c' + (content.account.name || 'that account') + '\u201d.', 'info');
          } else {
            showToast('Could not connect that shared budget.', 'error');
          }
          return;
        }
        showToast('\u2713 Connected \u201c' + (content.account.name || 'shared budget') + '\u201d', 'success');
        setTimeout(function () { window.location.reload(); }, 900);
      });
    }).catch(function (err) {
      console.error('[Veyra] Connect shared budget failed:', err);
      showToast('Could not read that file \u2014 check your connection and try again.', 'error');
    });
  }

  function driveGetFileParent(fileId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,parents', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (!res.ok) throw new Error('Could not read file metadata: HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var parents = (json && json.parents) || [];
      return parents.length ? parents[0] : null;
    });
  }

  // ---- toast (mirrors drive-sync.js's, same element — one shared visual
  // pattern for any Google-related confirmation in the app) ----

  var toastHideTimer = null;

  function showToast(message, kind) {
    var el = document.getElementById('driveSyncToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'driveSyncToast';
      el.className = 'drive-sync-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.setAttribute('data-kind', kind || 'info');
    el.classList.remove('is-visible');
    el.offsetHeight; // force reflow so re-adding the class re-triggers the CSS transition
    el.classList.add('is-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#accountConnectSharedBtn')) startConnectFlow();
  });

  function init() {
    if (!window.VeyraIdentity) return setTimeout(init, 30);
    updateButtonVisibility();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Re-check visibility whenever a token becomes available — covers the
  // case where the manager modal was already open before sign-in completed.
  window.addEventListener('veyra:google-token-ready', updateButtonVisibility);
}());

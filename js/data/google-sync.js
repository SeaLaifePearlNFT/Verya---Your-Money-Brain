(function () {
  'use strict';

  // ============================================================================
  // Veyra Google Sync — Stage 3 of the sync/sharing build.
  //
  // Scope of THIS file, deliberately kept narrow:
  //   1. "Sign in with Google" using Google Identity Services' token model
  //      (https://developers.google.com/identity/oauth2/web/guides/use-token-model),
  //      requesting only the drive.file scope (files this app creates, or
  //      files the user explicitly picks — never blanket Drive access) plus
  //      userinfo.email/profile so we know WHO signed in.
  //   2. Wiring a successful sign-in into Stage 2's identity layer
  //      (window.VeyraIdentity.switchTo), so the rest of the app already
  //      isolates this person's data correctly with zero further changes.
  //   3. A minimal set of raw Drive REST helpers (create/read/update one
  //      file). These are groundwork only — nothing calls them yet. The
  //      actual sync engine (personal file + shared file, merge logic, the
  //      "connect a shared budget" file-picker flow) is Stage 4.
  //
  // What this file deliberately does NOT do yet: no automatic backup, no
  // reading/writing your budget data to Drive. Signing in today only
  // establishes identity; Stage 4 is what makes it actually back anything up.
  //
  // IMPORTANT — this file cannot be exercised against real Google
  // infrastructure inside the environment that built it. Every code path
  // has been reviewed and the request-building logic has been tested against
  // a mocked Google/fetch, but the very first real end-to-end sign-in check
  // has to happen in your browser, with your own Client ID. See the testing
  // checklist you were given alongside this file.
  // ============================================================================

  var CONFIG = window.VeyraGoogleSyncConfig || {};
  var CLIENT_ID = CONFIG.clientId || '';
  var SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ].join(' ');
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
  var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

  var tokenClient = null;
  var gisScriptRequested = false;
  var accessToken = null;      // kept in memory only — never written to storage
  var accessTokenExpiresAt = 0;
  var signInInFlight = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- loading the Google Identity Services script on demand ----
  function loadGisScript(callback) {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) { callback(); return; }
    if (gisScriptRequested) {
      var poll = setInterval(function () {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          clearInterval(poll);
          callback();
        }
      }, 50);
      return;
    }
    gisScriptRequested = true;
    var script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = function () { callback(); };
    script.onerror = function () {
      console.error('Veyra: could not load Google Identity Services.');
      setStatus('error', 'Could not reach Google — check your connection and try again.');
    };
    document.head.appendChild(script);
  }

  function ensureTokenClient(callback) {
    if (!CLIENT_ID) {
      setStatus('unconfigured', '');
      return;
    }
    loadGisScript(function () {
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: handleTokenResponse
        });
      }
      callback();
    });
  }

  function isAppPage() {
    return /(^|\/)app\.html(\?|#|$)/.test(window.location.pathname + window.location.search);
  }

  var tokenReadyListeners = [];

  // ---- handling a token response (whether from an interactive sign-in or a silent refresh) ----
  function handleTokenResponse(response) {
    signInInFlight = false;
    if (!response || response.error) {
      var err = response && response.error;
      // A closed popup / declined consent / failed-silent-refresh is a
      // normal, expected outcome — not something to alarm the user about.
      if (err && err !== 'popup_closed' && err !== 'access_denied' && err !== 'immediate_failed') {
        console.error('Veyra Google sign-in error:', err);
        setStatus('error', 'Sign-in failed — please try again.');
      } else {
        renderStatus();
      }
      return;
    }
    accessToken = response.access_token;
    accessTokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
    // Lets drive-sync.js (loaded separately, Stage 4) react the moment a
    // usable token exists — from an interactive sign-in OR a silent refresh
    // on page load. No listeners today means this is a harmless no-op.
    try { window.dispatchEvent(new CustomEvent('veyra:google-token-ready')); } catch (e) {}

    // If this token response is just a background refresh for the identity
    // we're already signed in as (the common case: trySilentReauth() running
    // quietly every so often to keep the session alive while someone's
    // actively using the app), there's nothing to switch or navigate — just
    // keep the fresh token and let Stage 4's sync code know it can proceed.
    // Only a genuinely NEW identity (interactive sign-in, or switching to a
    // different Google account) needs the userinfo lookup + redirect dance.
    if (!window.VeyraIdentity.isDefault()) {
      fetchUserInfo(function (info) {
        if (info && info.email && info.email === window.VeyraIdentity.getActiveId()) {
          renderStatus();
          notifyTokenReady();
          return;
        }
        completeSignIn(info);
      });
      return;
    }

    fetchUserInfo(completeSignIn);
  }

  function completeSignIn(info) {
    if (!info || !info.email) {
      setStatus('error', 'Signed in, but could not read your Google profile.');
      return;
    }
    window.VeyraIdentity.switchTo(info.email, {
      label: info.name || info.email,
      email: info.email,
      avatar: info.picture || ''
    });
    // A reload/navigation is about to happen either way below, and that's a
    // fresh JS context — the in-memory accessToken we just got would
    // otherwise be thrown away immediately, forcing a second sign-in right
    // after the first. sessionStorage survives same-tab navigation (unlike
    // our in-memory state), so hand the token across deliberately instead of
    // relying on silent reauth to get a new one moments later.
    stashTokenHandoff();
    // Sign-in can be initiated from either the landing page or from inside
    // the app (e.g. a future settings screen). If we're already on
    // app.html, reload in place so it boots against the newly-active
    // identity. If we're on the landing page, the whole point of signing
    // in there is to go straight into the dashboard — no separate
    // "welcome back, now click Continue" hop.
    if (isAppPage()) {
      window.location.reload();
    } else {
      window.location.href = 'app.html';
    }
  }

  var TOKEN_HANDOFF_KEY = 'veyra_token_handoff_v1';

  function stashTokenHandoff() {
    try {
      sessionStorage.setItem(TOKEN_HANDOFF_KEY, JSON.stringify({ access_token: accessToken, expires_at: accessTokenExpiresAt }));
    } catch (e) {}
  }

  // Single-use: consumes and clears the handoff written by stashTokenHandoff()
  // just before the reload/navigation that's about to lose in-memory state.
  // Returns true if a still-valid token was adopted, so init() knows it can
  // skip the (comparatively unreliable) silent-reauth attempt entirely.
  function consumeTokenHandoff() {
    try {
      var raw = sessionStorage.getItem(TOKEN_HANDOFF_KEY);
      if (!raw) return false;
      sessionStorage.removeItem(TOKEN_HANDOFF_KEY);
      var handoff = JSON.parse(raw);
      if (!handoff || !handoff.access_token || !handoff.expires_at || handoff.expires_at <= Date.now()) return false;
      accessToken = handoff.access_token;
      accessTokenExpiresAt = handoff.expires_at;
      renderStatus();
      notifyTokenReady();
      try { window.dispatchEvent(new CustomEvent('veyra:google-token-ready')); } catch (e) {}
      return true;
    } catch (e) {
      return false;
    }
  }

  function notifyTokenReady() {
    tokenReadyListeners.forEach(function (fn) {
      try { fn(getAccessToken()); } catch (e) {}
    });
  }

  function fetchUserInfo(callback) {
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (!res.ok) throw new Error('userinfo request failed: ' + res.status);
      return res.json();
    }).then(function (json) { callback(json); }).catch(function (err) {
      console.error('Veyra: userinfo fetch failed', err);
      callback(null);
    });
  }

  // ---- public sign-in / sign-out ----
  function signIn() {
    if (signInInFlight) return;
    if (!CLIENT_ID) { setStatus('unconfigured', ''); return; }
    signInInFlight = true;
    ensureTokenClient(function () {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  function signOut() {
    if (accessToken && window.google && window.google.accounts && window.google.accounts.oauth2) {
      try { window.google.accounts.oauth2.revoke(accessToken, function () {}); } catch (e) {}
    }
    accessToken = null;
    accessTokenExpiresAt = 0;
    window.VeyraIdentity.switchTo(window.VeyraIdentity.DEFAULT_ID);
    window.location.reload();
  }

  // Attempts a token refresh with no popup, so a returning signed-in user
  // doesn't have to click "sign in" again every visit. If Google can't grant
  // a token silently (session expired, consent revoked elsewhere, etc.) this
  // just quietly does nothing — the UI falls back to showing "sign in".
  function trySilentReauth() {
    if (!CLIENT_ID) return;
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return;
    ensureTokenClient(function () {
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function getAccessToken() {
    if (accessToken && Date.now() < accessTokenExpiresAt - 30000) return accessToken;
    return null;
  }

  // ---- minimal Drive REST helpers ----
  // appProperties/parentFolderId let callers (see drive-sync.js, Stage 4)
  // tag a file for later lookup and/or place it inside a specific folder.
  // Both optional; omit either for a plain untagged, root-level file.
  function driveCreateFile(name, contentObject, appProperties, parentFolderId) {
    var token = getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var metadata = { name: name, mimeType: 'application/json' };
    if (appProperties) metadata.appProperties = appProperties;
    if (parentFolderId) metadata.parents = [parentFolderId];
    var boundary = 'veyra-' + Date.now().toString(36);
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(contentObject) + '\r\n' +
      '--' + boundary + '--';
    return fetch(DRIVE_UPLOAD_URL + '?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body,
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive create failed: HTTP ' + res.status);
      return res.json();
    });
  }

  // Finds a file this app previously created for the signed-in user, tagged
  // with the given appProperties key/value (e.g. {veyraFileType: 'personal',
  // veyraIdentity: 'alice@example.com'}). Works across devices/browsers for
  // the same Google account, because drive.file access is recorded against
  // the (Google user, file) pair by Google, not against this specific
  // browser session. Returns the first match's {id, name} or null if none.
  function cacheBuster() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

  function driveFindFile(appProperties) {
    var token = getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var clauses = ["trashed = false"];
    Object.keys(appProperties || {}).forEach(function (key) {
      var value = String(appProperties[key]).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      clauses.push("appProperties has { key='" + key + "' and value='" + value + "' }");
    });
    var q = encodeURIComponent(clauses.join(' and '));
    return fetch(DRIVE_FILES_URL + '?q=' + q + '&fields=files(id,name,modifiedTime)&spaces=drive&pageSize=1&_cb=' + cacheBuster(), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive search failed: HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var files = (json && json.files) || [];
      return files.length ? files[0] : null;
    });
  }

  // cache: 'no-store' is not optional here — without it, fetch() follows
  // normal browser HTTP caching, and a repeat read of the exact same file
  // URL can silently return a stale cached response instead of actually
  // hitting Google's servers again. Diagnosed from a real, confirmed case:
  // the owner's push was correct and visible in Drive itself, but a
  // recipient's repeated reads of that same file kept returning old
  // content regardless of how many times sync was retried — exactly what
  // browser-level response caching looks like from the outside.
  // A cache-busting query parameter forces a genuinely different URL on
  // every call — cache: 'no-store' alone only controls the BROWSER's own
  // cache and does nothing about caching on Google's own servers/CDN for
  // repeated requests to the identical URL. Confirmed necessary from a real
  // case: hashes agreed on both sides, yet the actual pulled content was
  // still stale — exactly what server-side caching looks like from here,
  // since client-side cache settings can't reach that layer at all.
  function driveReadFile(fileId) {
    var token = getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch(DRIVE_FILES_URL + '/' + encodeURIComponent(fileId) + '?alt=media&_cb=' + cacheBuster(), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive read failed: HTTP ' + res.status);
      return res.json();
    });
  }

  function driveUpdateFile(fileId, contentObject) {
    var token = getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch(DRIVE_UPLOAD_URL + '/' + encodeURIComponent(fileId) + '?uploadType=media', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(contentObject),
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive update failed: HTTP ' + res.status);
      return res.json();
    });
  }

  // ---- compact status UI, mirrors the existing account-switcher pattern ----
  function setStatus(kind, detail) {
    var icon = document.getElementById('syncStatusIcon');
    var kicker = document.getElementById('syncStatusKicker');
    var label = document.getElementById('syncStatusLabel');
    var body = document.getElementById('syncPopoverBody');
    if (!icon || !kicker || !label || !body) return;

    if (kind === 'connected') {
      icon.textContent = '✅';
      kicker.textContent = 'Signed in';
      label.textContent = detail;
      body.innerHTML =
        '<p class="sync-popover-copy">Signed in as <strong>' + esc(detail) + '</strong>.</p>' +
        '<p class="sync-popover-copy sync-popover-muted">Automatic backup to Drive arrives in the next update — for now, signing in just keeps this identity separate from anyone else using this browser.</p>' +
        '<button class="sync-secondary-btn" id="syncSignOutBtn" type="button">Sign out</button>';
    } else if (kind === 'unconfigured') {
      icon.textContent = '💾';
      kicker.textContent = 'Backup';
      label.textContent = 'Local only — no backup';
      body.innerHTML =
        '<p class="sync-popover-copy">Google sync isn\'t set up on this deployment yet.</p>';
    } else if (kind === 'error') {
      icon.textContent = '⚠️';
      kicker.textContent = 'Backup';
      label.textContent = 'Sign-in failed';
      body.innerHTML =
        '<p class="sync-popover-copy">' + esc(detail) + '</p>' +
        '<button class="sync-google-btn" id="syncGoogleSignInBtn" type="button">Try again</button>';
    } else {
      icon.textContent = '💾';
      kicker.textContent = 'Backup';
      label.textContent = 'Local only — no backup';
      body.innerHTML =
        '<p class="sync-popover-copy">Your data currently lives only in this browser. If you clear your browser data, it\'s gone.</p>' +
        '<button class="sync-google-btn" id="syncGoogleSignInBtn" type="button">Sign in with Google to back up</button>' +
        '<p class="sync-popover-footnote">Veyra only asks for access to files it creates itself in your Drive — never your whole Drive.</p>';
    }
  }

  function renderStatus() {
    if (!window.VeyraIdentity) { setStatus('signedout'); renderSessionIndicator(null); return; }
    if (window.VeyraIdentity.isDefault()) {
      setStatus(CLIENT_ID ? 'signedout' : 'unconfigured');
      renderSessionIndicator(null);
      return;
    }
    var known = window.VeyraIdentity.listKnownIdentities();
    var current = null;
    known.forEach(function (item) { if (item && item.id === window.VeyraIdentity.getActiveId()) current = item; });
    var displayName = (current && (current.label || current.email)) || window.VeyraIdentity.getActiveId();
    setStatus('connected', displayName);
    renderSessionIndicator(displayName);
  }

  // Small passive "Active session: Name" pill in the app's top bar (app.html
  // only — the element simply doesn't exist on the landing page, so this is
  // a harmless no-op there). Informational only, no click handler: sign-in
  // and sign-out live exclusively on the landing page now.
  function renderSessionIndicator(displayName) {
    var el = document.getElementById('activeSessionIndicator');
    var label = document.getElementById('activeSessionLabel');
    if (!el || !label) return;
    if (!displayName) { el.hidden = true; return; }
    label.textContent = 'Active session: ' + firstNameOf(displayName);
    el.hidden = false;
  }

  function firstNameOf(value) {
    var trimmed = String(value || '').trim();
    if (!trimmed) return trimmed;
    return trimmed.split(/\s+/)[0];
  }

  // ---- popover open/close, same interaction pattern as the account switcher ----
  function closePopover() {
    var p = document.getElementById('syncStatusPopover');
    var b = document.getElementById('syncStatusBtn');
    if (p) p.classList.remove('is-open');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function togglePopover() {
    var p = document.getElementById('syncStatusPopover');
    var b = document.getElementById('syncStatusBtn');
    if (!p) return;
    var willOpen = !p.classList.contains('is-open');
    closePopover();
    if (willOpen) { p.classList.add('is-open'); if (b) b.setAttribute('aria-expanded', 'true'); }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#syncStatusBtn')) { togglePopover(); return; }
    if (e.target.closest('#syncGoogleSignInBtn')) { signIn(); return; }
    if (e.target.closest('#syncSignOutBtn')) { signOut(); return; }
    if (!e.target.closest('.sync-switcher-block')) closePopover();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePopover();
  });

  function init() {
    if (!window.VeyraIdentity) return setTimeout(init, 30);
    renderStatus();
    // Preload Google's sign-in script immediately on every page load,
    // regardless of sign-in state — not lazily on first use. The script
    // load itself is a network fetch (asynchronous); if it's still pending
    // when someone clicks a sign-in/sync button, the eventual popup request
    // happens *after* an async gap from their click, and browsers block
    // popups that aren't tied to an immediate, synchronous user gesture.
    // Preloading here means by the time anyone actually clicks something,
    // the script is already loaded and the popup call stays synchronous
    // with their click. (Diagnosed from a real "Failed to open popup
    // window... Maybe blocked by the browser" console error.)
    if (CLIENT_ID) loadGisScript(function () {});
    // A handed-off token from the page we just navigated from (see
    // stashTokenHandoff) means we already have a valid token right now —
    // skip the silent-reauth attempt entirely rather than doing unnecessary
    // (and less reliable) work to get something we already have.
    if (!consumeTokenHandoff()) {
      trySilentReauth();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VeyraGoogleSync = {
    signIn: signIn,
    signOut: signOut,
    getAccessToken: getAccessToken,
    // Any code that's about to trigger window.location.reload() (drive-sync.js
    // does this after applying a pulled snapshot or resolving a conflict in
    // favor of Drive) should call this immediately beforehand — otherwise the
    // reload throws away the in-memory access token exactly like a full page
    // navigation does, forcing a reconnect that depends on the same
    // unreliable silent-reauth path we already worked around for sign-in.
    prepareForReload: stashTokenHandoff,
    // Fires with the fresh access token whenever one becomes available for
    // the currently-active identity — after a successful interactive
    // sign-in that didn't need to navigate away, and (the common case) after
    // every successful silent background token refresh. Stage 4's drive-sync
    // uses this to know exactly when it's safe to start talking to Drive,
    // instead of polling getAccessToken() in a loop.
    onTokenReady: function (fn) { if (typeof fn === 'function') tokenReadyListeners.push(fn); },
    driveCreateFile: driveCreateFile,
    driveFindFile: driveFindFile,
    driveReadFile: driveReadFile,
    driveUpdateFile: driveUpdateFile
  };
}());

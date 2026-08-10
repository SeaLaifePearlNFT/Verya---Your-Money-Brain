(function () {
  'use strict';

  // ============================================================================
  // Veyra Drive Sync — Stage 4a of the sync/sharing build (personal backup only;
  // shared-file sync and the "connect a shared budget" picker flow are Stage 4b/4c).
  //
  // Safety model, the important part:
  //   Veyra remembers a hash of what it last successfully synced. On every
  //   check (page load, periodic tick, manual "Sync now"), it compares the
  //   CURRENT local data and the CURRENT Drive file against that last-synced
  //   marker — not against each other directly. That gives three outcomes:
  //     - only local changed  -> push, no prompt
  //     - only Drive changed  -> pull, no prompt
  //     - both changed        -> real conflict -> ask the user, never guess
  //   Local storage is only ever overwritten in the "only Drive changed" case
  //   or after the user explicitly picks "keep Drive's version" in a conflict.
  //   Whichever version isn't kept in a conflict is saved as a timestamped
  //   backup key locally, never silently discarded.
  //
  // Runs only when signed in (a non-default identity is active). No-ops
  // completely for the default/local identity and on any page that doesn't
  // have the small UI hooks this file looks for.
  // ============================================================================

  var FILE_NAME = 'veyra-personal-backup.json';
  var FOLDER_NAME = 'Veyra';
  var FOLDER_ID_KEY = 'veyra_drive_folder_id_v1';
  var FILE_ID_KEY = 'veyra_drive_personal_file_id_v1';
  var SYNC_META_KEY = 'veyra_drive_sync_meta_v1';
  var CONFLICT_BACKUP_PREFIX = 'veyra_conflict_backup_';
  var AUTO_SYNC_INTERVAL_MS = 4000; // periodic check; actual push only happens if something actually changed
  var DEBOUNCE_MS = 3000; // wait for a quiet moment after a change before pushing

  var syncInFlight = false;
  var pendingDebounce = null;
  var lastKnownLocalHash = null;

  // ---- tiny helpers ----

  function hashString(str) {
    // Non-cryptographic (djb2). We only need "did this change", not security.
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // keep it a 32-bit int
    }
    return String(hash);
  }

  function hashSnapshot(snapshot) {
    var keys = Object.keys(snapshot || {}).sort();
    var parts = keys.map(function (k) { return k + '=' + snapshot[k]; });
    return hashString(parts.join('\u0001'));
  }

  function getSyncMeta() {
    try {
      var raw = localStorage.getItem(SYNC_META_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : { lastSyncedHash: null, lastSyncedAt: null };
    } catch (e) {
      return { lastSyncedHash: null, lastSyncedAt: null };
    }
  }

  function setSyncMeta(hash, whenIso) {
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify({ lastSyncedHash: hash, lastSyncedAt: whenIso || new Date().toISOString() }));
    } catch (e) {}
  }

  // Enumerates every key belonging to the ACTIVE identity via the ordinary
  // Storage API (length/key), which identity.js already scopes correctly per
  // identity — deliberately not relying on any lower-level enumeration trick.
  function collectLocalSnapshot() {
    var snapshot = {};
    var len = localStorage.length;
    for (var i = 0; i < len; i++) {
      var key = localStorage.key(i);
      if (!key) continue;
      if (key === FILE_ID_KEY || key === FOLDER_ID_KEY || key === SYNC_META_KEY) continue; // don't sync our own bookkeeping
      if (key.indexOf(CONFLICT_BACKUP_PREFIX) === 0) continue; // don't sync local conflict backups either
      snapshot[key] = localStorage.getItem(key);
    }
    return snapshot;
  }

  function applySnapshot(snapshot) {
    try { localStorage.clear(); } catch (e) {}
    var keys = Object.keys(snapshot || {});
    for (var i = 0; i < keys.length; i++) {
      try { localStorage.setItem(keys[i], snapshot[keys[i]]); } catch (e) {}
    }
  }

  function saveRejectedSnapshotAsBackup(snapshot, label) {
    try {
      var key = CONFLICT_BACKUP_PREFIX + Date.now();
      localStorage.setItem(key, JSON.stringify({ label: label, savedAt: new Date().toISOString(), snapshot: snapshot }));
    } catch (e) {}
  }

  // ---- Drive REST calls this file needs beyond what google-sync.js exposes ----

  function driveFindFileByName(name) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var q = encodeURIComponent("name='" + name.replace(/'/g, "\\'") + "' and trashed=false");
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)&spaces=drive', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive search failed: HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var files = (json && json.files) || [];
      return files.length ? files[0] : null;
    });
  }

  function driveGetFileMetadata(fileId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,modifiedTime', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive metadata fetch failed: HTTP ' + res.status);
      return res.json();
    });
  }

  function driveFindFolderByName(name) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var q = encodeURIComponent(
      "name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)&spaces=drive', {
      headers: { Authorization: 'Bearer ' + token }
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive folder search failed: HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      var files = (json && json.files) || [];
      return files.length ? files[0] : null;
    });
  }

  function driveCreateFolder(name) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder' })
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive folder create failed: HTTP ' + res.status);
      return res.json();
    });
  }

  // Finds (or creates, once per identity) a visible "Veyra" folder in the
  // user's Drive to keep the backup file out of the My Drive root — so it's
  // easy to find, and doesn't get lost among everything else in there.
  // The user can rename/move it freely afterward through normal Drive UI;
  // this only runs once (the folder ID gets cached locally after that).
  function ensureFolderId() {
    var stored = null;
    try { stored = localStorage.getItem(FOLDER_ID_KEY); } catch (e) {}
    if (stored) return Promise.resolve(stored);
    return driveFindFolderByName(FOLDER_NAME).then(function (found) {
      if (found) {
        try { localStorage.setItem(FOLDER_ID_KEY, found.id); } catch (e) {}
        return found.id;
      }
      return driveCreateFolder(FOLDER_NAME).then(function (created) {
        try { localStorage.setItem(FOLDER_ID_KEY, created.id); } catch (e) {}
        return created.id;
      });
    });
  }

  // ---- ensure a personal backup file exists, reusing one from another device if found ----

  function ensureFileId() {
    var stored = null;
    try { stored = localStorage.getItem(FILE_ID_KEY); } catch (e) {}
    if (stored) return Promise.resolve(stored);
    // Search Drive-wide by name first — if the file already exists (created
    // from another device, or manually moved by the user since), reuse it
    // wherever it currently lives rather than creating a duplicate.
    return driveFindFileByName(FILE_NAME).then(function (found) {
      if (found) {
        try { localStorage.setItem(FILE_ID_KEY, found.id); } catch (e) {}
        return found.id;
      }
      return ensureFolderId().then(function (folderId) {
        return window.VeyraGoogleSync.driveCreateFile(FILE_NAME, {}, null, folderId).then(function (created) {
          try { localStorage.setItem(FILE_ID_KEY, created.id); } catch (e) {}
          return created.id;
        });
      });
    });
  }

  // ---- the core check: figure out which of the three outcomes we're in ----

  function performSyncCheck(options) {
    options = options || {};
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return Promise.resolve();
    if (!window.VeyraGoogleSync || !window.VeyraGoogleSync.getAccessToken()) return Promise.resolve();
    if (syncInFlight) return Promise.resolve();
    syncInFlight = true;
    setSyncStatus('syncing');

    var fileId;
    return ensureFileId().then(function (id) {
      fileId = id;
      return Promise.all([driveGetFileMetadata(fileId), window.VeyraGoogleSync.driveReadFile(fileId).catch(function () { return {}; })]);
    }).then(function (results) {
      var meta = results[0];
      var remoteSnapshot = results[1] || {};
      var remoteHasContent = Object.keys(remoteSnapshot).length > 0;
      var remoteHash = remoteHasContent ? hashSnapshot(remoteSnapshot) : null;

      var localSnapshot = collectLocalSnapshot();
      var localHash = hashSnapshot(localSnapshot);
      lastKnownLocalHash = localHash;

      var syncMeta = getSyncMeta();
      var localChanged = localHash !== syncMeta.lastSyncedHash;
      var remoteChanged = remoteHasContent && (remoteHash !== syncMeta.lastSyncedHash);

      if (!localChanged && !remoteChanged) {
        setSyncStatus('synced');
        syncInFlight = false;
        return;
      }
      if (localChanged && !remoteChanged) {
        return pushToDrive(fileId, localSnapshot, localHash);
      }
      if (!localChanged && remoteChanged) {
        // Always reload after applying a pulled-down snapshot — the app's
        // already-loaded in-memory state won't reflect the new localStorage
        // contents until it re-boots. Skipping this for "silent"
        // (background/automatic) pulls would leave the on-screen data
        // silently out of sync with what's actually stored, which is worse
        // than the occasional reload. Caught by testing, not a design
        // decision to keep quiet about.
        applySnapshot(remoteSnapshot);
        setSyncMeta(remoteHash, meta.modifiedTime);
        setSyncStatus('synced');
        syncInFlight = false;
        window.location.reload();
        return;
      }
      // both changed — real conflict, ask the user
      syncInFlight = false;
      setSyncStatus('conflict');
      showConflictDialog(localSnapshot, localHash, remoteSnapshot, remoteHash, meta.modifiedTime, fileId);
    }).catch(function (err) {
      console.error('Veyra Drive sync error:', err && err.stack || err);
      setSyncStatus('error');
      syncInFlight = false;
    });
  }

  function pushToDrive(fileId, snapshot, hash) {
    return window.VeyraGoogleSync.driveUpdateFile(fileId, snapshot).then(function () {
      setSyncMeta(hash, new Date().toISOString());
      setSyncStatus('synced');
      syncInFlight = false;
    }).catch(function (err) {
      console.error('Veyra Drive push failed:', err);
      setSyncStatus('error');
      syncInFlight = false;
    });
  }

  // ---- conflict dialog ----

  function formatWhen(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso || 'unknown time'; }
  }

  function showConflictDialog(localSnapshot, localHash, remoteSnapshot, remoteHash, remoteModifiedTime, fileId) {
    closeConflictDialog();
    var overlay = document.createElement('div');
    overlay.id = 'driveConflictOverlay';
    overlay.className = 'drive-conflict-overlay';
    overlay.innerHTML =
      '<div class="drive-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="driveConflictTitle">' +
      '<h3 id="driveConflictTitle">Which version do you want to keep?</h3>' +
      '<p>Your budget was changed on two devices since the last sync. Pick which one to keep — the other is saved as a backup, not deleted.</p>' +
      '<div class="drive-conflict-options">' +
      '<button type="button" class="drive-conflict-choice" data-choice="local"><strong>This device</strong><span>Changed just now</span></button>' +
      '<button type="button" class="drive-conflict-choice" data-choice="remote"><strong>Google Drive</strong><span>Changed ' + formatWhen(remoteModifiedTime) + '</span></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('.drive-conflict-choice');
      if (!btn) return;
      var choice = btn.getAttribute('data-choice');
      syncInFlight = true;
      if (choice === 'local') {
        saveRejectedSnapshotAsBackup(remoteSnapshot, 'Google Drive version (replaced ' + new Date().toLocaleString() + ')');
        pushToDrive(fileId, localSnapshot, localHash).then(function () { closeConflictDialog(); });
      } else {
        // IMPORTANT: save the backup AFTER applying the remote snapshot, not
        // before — applySnapshot() clears localStorage first, which would
        // otherwise wipe out the backup we just wrote. (Caught by testing
        // this exact path — an earlier version had this backwards.)
        applySnapshot(remoteSnapshot);
        saveRejectedSnapshotAsBackup(localSnapshot, 'This device\u2019s version (replaced ' + new Date().toLocaleString() + ')');
        setSyncMeta(remoteHash, remoteModifiedTime);
        closeConflictDialog();
        window.location.reload();
      }
    });
  }

  function closeConflictDialog() {
    var el = document.getElementById('driveConflictOverlay');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- status pill + manual "Sync now" button (app.html only; no-op elsewhere) ----

  function setSyncStatus(state) {
    var el = document.getElementById('driveSyncStatus');
    if (!el) return;
    var label = { syncing: 'Syncing…', synced: 'Backed up', error: 'Sync error — will retry', conflict: 'Action needed' }[state] || '';
    el.textContent = label;
    el.setAttribute('data-state', state);
  }

  function scheduleDebouncedSync() {
    if (pendingDebounce) clearTimeout(pendingDebounce);
    pendingDebounce = setTimeout(function () {
      pendingDebounce = null;
      performSyncCheck({ silent: true });
    }, DEBOUNCE_MS);
  }

  function autoSyncTick() {
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return;
    var snapshot = collectLocalSnapshot();
    var hash = hashSnapshot(snapshot);
    if (hash !== lastKnownLocalHash) {
      lastKnownLocalHash = hash;
      scheduleDebouncedSync();
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#driveSyncNowBtn')) {
      performSyncCheck({ silent: true });
    }
  });

  window.addEventListener('veyra:google-token-ready', function () {
    performSyncCheck();
  });

  function init() {
    if (!window.VeyraIdentity) return setTimeout(init, 30);
    if (window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken()) performSyncCheck();
    setInterval(autoSyncTick, AUTO_SYNC_INTERVAL_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.VeyraDriveSync = {
    syncNow: function () { return performSyncCheck({ silent: true }); }
  };
}());

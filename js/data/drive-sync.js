(function () {
  'use strict';

  // ============================================================================
  // Veyra Drive Sync — Stage 4b of the sync/sharing build.
  //
  // Replaces Stage 4a's single "personal-backup.json" file with a per-account
  // layout, so each account can eventually be shared with a different person
  // (or nobody) independently:
  //
  //   Veyra/
  //     Main Account/data.json        <- self-describing: this account's own
  //     Household (shared)/data.json     metadata (name, currency, icon) +
  //     Roommate Expenses/data.json       its budget content (months, subs,
  //                                        debt, etc.)
  //     _settings.json                 <- cross-account: account list/order,
  //                                        transfer rules, achievements
  //                                        (global for now — see note below),
  //                                        anything not owned by one account
  //
  // Achievements/badges are currently tracked globally by the app itself (not
  // per account yet — confirmed by checking achievements.js), so they live in
  // _settings.json for now, matching actual current behavior. Making them
  // genuinely per-account is a separate, later feature change to the
  // achievements system, not a sync-layer decision.
  //
  // Safety model (same guarantee as Stage 4a, now applied per unit): for each
  // account file AND the settings file independently, Veyra compares current
  // local data and current Drive content against what it last synced —
  //   - only local changed  -> push that unit, no prompt
  //   - only Drive changed  -> pull that unit, no prompt
  //   - both changed         -> real conflict for THAT unit -> ask the user
  // Local storage is only overwritten for a unit in the "only Drive changed"
  // case, or after the user explicitly picks "keep Drive's version" for that
  // unit's conflict. The version not kept is saved as a timestamped backup,
  // never silently discarded. Units are processed one at a time; if one hits
  // a conflict, remaining units wait for the next sync pass rather than
  // piling up multiple dialogs at once.
  // ============================================================================

  var MAIN_BLOB_KEY = 'budget_dashboard_v12';
  var ROOT_FOLDER_NAME = 'Veyra';
  var SETTINGS_FILE_NAME = '_settings.json';
  var DATA_FILE_NAME = 'data.json';
  // These fields inside budget_dashboard_v12 mirror whichever account is
  // currently active (a working-copy cache the main app reads/writes
  // directly) — they're regenerated from accountBudgets on apply, not synced
  // as independent content of their own.
  var MIRROR_KEYS = ['months', 'activeMonth', 'subscriptions', 'usageItems', 'debt', 'financialGoalHistory', 'csvImportBatches'];

  var ROOT_FOLDER_ID_KEY = 'veyra_drive_root_folder_id_v1';
  var CONFLICT_BACKUP_PREFIX = 'veyra_conflict_backup_';
  var BOOKKEEPING_PREFIX = 'veyra_drive_';
  var AUTO_SYNC_INTERVAL_MS = 4000;
  var DEBOUNCE_MS = 3000;

  var syncInFlight = false;
  var pendingDebounce = null;
  var lastKnownLocalHash = null;

  // ---- tiny helpers ----

  function hashString(str) {
    var hash = 5381; // djb2, non-cryptographic — only need "did this change"
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return String(hash);
  }

  function hashSnapshot(snapshot) {
    // JSON.stringify (not naive string concatenation) so this correctly
    // distinguishes real content differences even when values are nested
    // objects (account units) rather than plain strings (Stage 4a's flat
    // localStorage-key shape). Caught by testing: string-concatenating a
    // nested object collapses to the useless literal "[object Object]"
    // regardless of what's actually inside it.
    var keys = Object.keys(snapshot || {}).sort();
    var parts = keys.map(function (k) { return k + '=' + JSON.stringify(snapshot[k]); });
    return hashString(parts.join('\u0001'));
  }

  function fileIdKey(unitId) { return BOOKKEEPING_PREFIX + 'file_id_v1__' + unitId; }
  function folderIdKey(accountId) { return BOOKKEEPING_PREFIX + 'account_folder_id_v1__' + accountId; }
  function syncMetaKey(unitId) { return BOOKKEEPING_PREFIX + 'sync_meta_v1__' + unitId; }

  function getSyncMeta(unitId) {
    try {
      var raw = localStorage.getItem(syncMetaKey(unitId));
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : { lastSyncedHash: null, lastSyncedAt: null };
    } catch (e) {
      return { lastSyncedHash: null, lastSyncedAt: null };
    }
  }

  function setSyncMeta(unitId, hash, whenIso) {
    try {
      localStorage.setItem(syncMetaKey(unitId), JSON.stringify({ lastSyncedHash: hash, lastSyncedAt: whenIso || new Date().toISOString() }));
    } catch (e) {}
  }

  function isOwnBookkeepingKey(key) {
    return key.indexOf(BOOKKEEPING_PREFIX) === 0 || key === ROOT_FOLDER_ID_KEY || key.indexOf(CONFLICT_BACKUP_PREFIX) === 0;
  }

  function saveRejectedSnapshotAsBackup(snapshot, label) {
    try {
      var key = CONFLICT_BACKUP_PREFIX + Date.now();
      localStorage.setItem(key, JSON.stringify({ label: label, savedAt: new Date().toISOString(), snapshot: snapshot }));
    } catch (e) {}
  }

  // ---- understanding & rebuilding budget_dashboard_v12's structure ----

  function parseMainBlob() {
    try {
      var raw = localStorage.getItem(MAIN_BLOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeMainBlob(blob) {
    try { localStorage.setItem(MAIN_BLOB_KEY, JSON.stringify(blob)); } catch (e) {}
  }

  function sanitizeFolderName(name) {
    var trimmed = String(name || '').trim();
    return trimmed.length ? trimmed : 'Account';
  }

  // One sync unit per account, plus one for everything else ("settings").
  function listSyncUnits() {
    var blob = parseMainBlob();
    var units = [];
    if (blob && Array.isArray(blob.accounts)) {
      blob.accounts.forEach(function (acc) {
        if (!acc || !acc.id) return;
        units.push({ kind: 'account', id: 'account:' + acc.id, accountId: acc.id, label: acc.name || acc.id, folderName: sanitizeFolderName(acc.name) });
      });
    }
    units.push({ kind: 'settings', id: 'settings', label: 'Account settings' });
    return units;
  }

  function getUnitSnapshot(unit) {
    if (unit.kind === 'account') {
      var blob = parseMainBlob() || {};
      var account = (blob.accounts || []).find(function (a) { return a && a.id === unit.accountId; });
      var budget = (blob.accountBudgets || {})[unit.accountId] || {};
      return { account: account || { id: unit.accountId }, budget: budget };
    }
    // settings: every other localStorage key, plus budget_dashboard_v12
    // trimmed down to exclude accountBudgets and the per-account mirror
    // fields (those are owned by the account units, not settings).
    var mainBlob = parseMainBlob() || {};
    var trimmedBlob = Object.assign({}, mainBlob);
    delete trimmedBlob.accountBudgets;
    MIRROR_KEYS.forEach(function (k) { delete trimmedBlob[k]; });
    var snapshot = {};
    var len = localStorage.length;
    for (var i = 0; i < len; i++) {
      var key = localStorage.key(i);
      if (!key || isOwnBookkeepingKey(key)) continue;
      snapshot[key] = key === MAIN_BLOB_KEY ? JSON.stringify(trimmedBlob) : localStorage.getItem(key);
    }
    return snapshot;
  }

  function mirrorActiveAccount(blob) {
    var active = blob.accountBudgets && blob.accountBudgets[blob.activeAccountId];
    if (!active) return;
    MIRROR_KEYS.forEach(function (k) { blob[k] = active[k]; });
  }

  function applyUnitSnapshot(unit, data) {
    if (unit.kind === 'account') {
      var blob = parseMainBlob() || { accounts: [], accountBudgets: {} };
      blob.accounts = Array.isArray(blob.accounts) ? blob.accounts : [];
      blob.accountBudgets = blob.accountBudgets || {};
      var idx = -1;
      for (var i = 0; i < blob.accounts.length; i++) { if (blob.accounts[i] && blob.accounts[i].id === unit.accountId) { idx = i; break; } }
      if (idx === -1) blob.accounts.push(data.account); else blob.accounts[idx] = data.account;
      blob.accountBudgets[unit.accountId] = data.budget;
      mirrorActiveAccount(blob);
      writeMainBlob(blob);
      return;
    }
    // settings: restore every key except budget_dashboard_v12 directly, and
    // merge budget_dashboard_v12 with whatever account data already exists
    // locally so applying settings never wipes out account content.
    var incomingBlob = data[MAIN_BLOB_KEY] ? JSON.parse(data[MAIN_BLOB_KEY]) : {};
    var currentBlob = parseMainBlob() || {};
    var merged = Object.assign({}, incomingBlob, { accountBudgets: currentBlob.accountBudgets || {} });
    mirrorActiveAccount(merged);
    writeMainBlob(merged);
    Object.keys(data).forEach(function (key) {
      if (key === MAIN_BLOB_KEY) return;
      try { localStorage.setItem(key, data[key]); } catch (e) {}
    });
  }

  // ---- Drive REST calls this file needs beyond what google-sync.js exposes ----

  function driveFindFileByName(name, parentId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var clauses = ["name='" + name.replace(/'/g, "\\'") + "'", 'trashed=false'];
    if (parentId) clauses.push("'" + parentId + "' in parents");
    var q = encodeURIComponent(clauses.join(' and '));
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

  function driveFindFolderByName(name, parentId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var clauses = ["name='" + name.replace(/'/g, "\\'") + "'", "mimeType='application/vnd.google-apps.folder'", 'trashed=false'];
    if (parentId) clauses.push("'" + parentId + "' in parents");
    var q = encodeURIComponent(clauses.join(' and '));
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

  function driveCreateFolder(name, parentId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var metadata = { name: name, mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) metadata.parents = [parentId];
    return fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive folder create failed: HTTP ' + res.status);
      return res.json();
    });
  }

  function ensureRootFolderId() {
    var stored = null;
    try { stored = localStorage.getItem(ROOT_FOLDER_ID_KEY); } catch (e) {}
    if (stored) return Promise.resolve(stored);
    return driveFindFolderByName(ROOT_FOLDER_NAME).then(function (found) {
      if (found) { try { localStorage.setItem(ROOT_FOLDER_ID_KEY, found.id); } catch (e) {} return found.id; }
      return driveCreateFolder(ROOT_FOLDER_NAME).then(function (created) {
        try { localStorage.setItem(ROOT_FOLDER_ID_KEY, created.id); } catch (e) {}
        return created.id;
      });
    });
  }

  function ensureAccountFolderId(unit, rootFolderId) {
    var key = folderIdKey(unit.accountId);
    var stored = null;
    try { stored = localStorage.getItem(key); } catch (e) {}
    if (stored) return Promise.resolve(stored);
    return driveFindFolderByName(unit.folderName, rootFolderId).then(function (found) {
      if (found) { try { localStorage.setItem(key, found.id); } catch (e) {} return found.id; }
      return driveCreateFolder(unit.folderName, rootFolderId).then(function (created) {
        try { localStorage.setItem(key, created.id); } catch (e) {}
        return created.id;
      });
    });
  }

  // Resolves (creating if needed) the Drive file ID for one sync unit, and
  // the folder it should be searched/created within.
  function ensureUnitFileId(unit) {
    var stored = null;
    try { stored = localStorage.getItem(fileIdKey(unit.id)); } catch (e) {}
    if (stored) return Promise.resolve(stored);

    var fileName = unit.kind === 'account' ? DATA_FILE_NAME : SETTINGS_FILE_NAME;
    return ensureRootFolderId().then(function (rootFolderId) {
      if (unit.kind === 'settings') {
        return driveFindFileByName(fileName, rootFolderId).then(function (found) {
          if (found) { try { localStorage.setItem(fileIdKey(unit.id), found.id); } catch (e) {} return found.id; }
          return window.VeyraGoogleSync.driveCreateFile(fileName, {}, null, rootFolderId).then(function (created) {
            try { localStorage.setItem(fileIdKey(unit.id), created.id); } catch (e) {}
            return created.id;
          });
        });
      }
      return ensureAccountFolderId(unit, rootFolderId).then(function (accountFolderId) {
        return driveFindFileByName(fileName, accountFolderId).then(function (found) {
          if (found) { try { localStorage.setItem(fileIdKey(unit.id), found.id); } catch (e) {} return found.id; }
          return window.VeyraGoogleSync.driveCreateFile(fileName, {}, null, accountFolderId).then(function (created) {
            try { localStorage.setItem(fileIdKey(unit.id), created.id); } catch (e) {}
            return created.id;
          });
        });
      });
    });
  }

  // ---- syncing one unit ----
  // Returns a promise resolving to one of: 'noop' | 'pushed' | 'pulled' | 'conflict' | 'error'

  function syncOneUnit(unit) {
    var fileId;
    return ensureUnitFileId(unit).then(function (id) {
      fileId = id;
      return Promise.all([driveGetFileMetadata(fileId), window.VeyraGoogleSync.driveReadFile(fileId).catch(function () { return {}; })]);
    }).then(function (results) {
      var meta = results[0];
      var remoteSnapshot = results[1] || {};
      var remoteHasContent = Object.keys(remoteSnapshot).length > 0;
      var remoteHash = remoteHasContent ? hashSnapshot(remoteSnapshot) : null;

      var localSnapshot = getUnitSnapshot(unit);
      var localHash = hashSnapshot(localSnapshot);

      var meta_ = getSyncMeta(unit.id);
      var localChanged = localHash !== meta_.lastSyncedHash;
      var remoteChanged = remoteHasContent && (remoteHash !== meta_.lastSyncedHash);

      if (!localChanged && !remoteChanged) return { outcome: 'noop' };

      if (localChanged && !remoteChanged) {
        return window.VeyraGoogleSync.driveUpdateFile(fileId, localSnapshot).then(function () {
          setSyncMeta(unit.id, localHash, new Date().toISOString());
          return { outcome: 'pushed' };
        });
      }

      if (!localChanged && remoteChanged) {
        applyUnitSnapshot(unit, remoteSnapshot);
        setSyncMeta(unit.id, remoteHash, meta.modifiedTime);
        return { outcome: 'pulled' };
      }

      // both changed — real conflict for this unit specifically
      return {
        outcome: 'conflict',
        unit: unit, fileId: fileId,
        localSnapshot: localSnapshot, localHash: localHash,
        remoteSnapshot: remoteSnapshot, remoteHash: remoteHash, remoteModifiedTime: meta.modifiedTime
      };
    });
  }

  // ---- orchestrator: process every unit, one at a time ----

  function performSyncCheck() {
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return Promise.resolve();
    if (!window.VeyraGoogleSync || !window.VeyraGoogleSync.getAccessToken()) return Promise.resolve();
    if (syncInFlight) return Promise.resolve();
    syncInFlight = true;
    setSyncStatus('syncing');

    var units = listSyncUnits();
    var needsReload = false;

    function processNext(index) {
      if (index >= units.length) {
        syncInFlight = false;
        setSyncStatus('synced');
        if (needsReload) window.location.reload();
        return Promise.resolve();
      }
      return syncOneUnit(units[index]).then(function (result) {
        if (result.outcome === 'pulled') needsReload = true;
        if (result.outcome === 'conflict') {
          syncInFlight = false;
          setSyncStatus('conflict');
          showConflictDialog(result);
          return; // stop this pass — remaining units get picked up on the next sync
        }
        return processNext(index + 1);
      });
    }

    return processNext(0).catch(function (err) {
      console.error('Veyra Drive sync error:', err && err.stack || err);
      setSyncStatus('error');
      syncInFlight = false;
    });
  }

  // ---- conflict dialog (per unit) ----

  function formatWhen(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso || 'unknown time'; }
  }

  function showConflictDialog(conflict) {
    closeConflictDialog();
    var unitLabel = conflict.unit.kind === 'account' ? '"' + conflict.unit.label + '"' : 'your account settings';
    var overlay = document.createElement('div');
    overlay.id = 'driveConflictOverlay';
    overlay.className = 'drive-conflict-overlay';
    overlay.innerHTML =
      '<div class="drive-conflict-modal" role="dialog" aria-modal="true" aria-labelledby="driveConflictTitle">' +
      '<h3 id="driveConflictTitle">Which version of ' + unitLabel + ' do you want to keep?</h3>' +
      '<p>This was changed on two devices since the last sync. Pick which one to keep — the other is saved as a backup, not deleted.</p>' +
      '<div class="drive-conflict-options">' +
      '<button type="button" class="drive-conflict-choice" data-choice="local"><strong>This device</strong><span>Changed just now</span></button>' +
      '<button type="button" class="drive-conflict-choice" data-choice="remote"><strong>Google Drive</strong><span>Changed ' + formatWhen(conflict.remoteModifiedTime) + '</span></button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('.drive-conflict-choice');
      if (!btn) return;
      var choice = btn.getAttribute('data-choice');
      resolveConflict(conflict, choice);
    });
  }

  function resolveConflict(conflict, choice) {
    var unit = conflict.unit;
    if (choice === 'local') {
      saveRejectedSnapshotAsBackup(conflict.remoteSnapshot, unitLabelFor(unit) + ' \u2014 Google Drive version (replaced ' + new Date().toLocaleString() + ')');
      window.VeyraGoogleSync.driveUpdateFile(conflict.fileId, conflict.localSnapshot).then(function () {
        setSyncMeta(unit.id, conflict.localHash, new Date().toISOString());
        closeConflictDialog();
        performSyncCheck(); // resume with any remaining units
      });
    } else {
      // Apply BEFORE saving the backup — applyUnitSnapshot merges surgically
      // (unlike Stage 4a's old clear-everything approach) so this ordering
      // isn't the same trap as before, but keeping the safer order regardless.
      applyUnitSnapshot(unit, conflict.remoteSnapshot);
      saveRejectedSnapshotAsBackup(conflict.localSnapshot, unitLabelFor(unit) + ' \u2014 this device\u2019s version (replaced ' + new Date().toLocaleString() + ')');
      setSyncMeta(unit.id, conflict.remoteHash, conflict.remoteModifiedTime);
      closeConflictDialog();
      window.location.reload();
    }
  }

  function unitLabelFor(unit) { return unit.kind === 'account' ? unit.label : 'Account settings'; }

  function closeConflictDialog() {
    var el = document.getElementById('driveConflictOverlay');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---- status pill + manual "Sync now" button ----

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
      performSyncCheck();
    }, DEBOUNCE_MS);
  }

  // Hashes ALL units combined just to detect "did anything at all change"
  // cheaply every tick, without doing a full per-unit Drive round-trip every
  // 4 seconds. The real per-unit comparison happens inside performSyncCheck.
  function localOverallHash() {
    var units = listSyncUnits();
    var combined = {};
    units.forEach(function (u) { combined[u.id] = hashSnapshot(getUnitSnapshot(u)); });
    return hashSnapshot(combined);
  }

  function autoSyncTick() {
    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) return;
    var hash = localOverallHash();
    if (hash !== lastKnownLocalHash) {
      lastKnownLocalHash = hash;
      scheduleDebouncedSync();
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#driveSyncNowBtn')) performSyncCheck();
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
    syncNow: function () { return performSyncCheck(); }
  };
}());

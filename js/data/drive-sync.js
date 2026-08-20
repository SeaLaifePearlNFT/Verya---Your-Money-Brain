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
    //
    // driveOrigin is deliberately excluded from the hashed representation
    // of an account snapshot — it's a LOCAL-ONLY marker (owned vs joined)
    // that never exists in what's actually written to Drive (an owner's
    // own copy of their account never has it). Hashing it in means a
    // joined account's local copy (which correctly carries the marker) can
    // never hash-match a remote snapshot (which never has it) even when
    // every real field is identical — producing a permanent, spurious
    // "changed" reading that manifests as an endless, unresolvable
    // conflict loop. Confirmed as a real mechanism, not a theoretical one.
    var hashable = snapshot;
    if (snapshot && snapshot.account && Object.prototype.hasOwnProperty.call(snapshot.account, 'driveOrigin')) {
      var accountWithoutOrigin = Object.assign({}, snapshot.account);
      delete accountWithoutOrigin.driveOrigin;
      hashable = Object.assign({}, snapshot, { account: accountWithoutOrigin });
    }
    var keys = Object.keys(hashable || {}).sort();
    var parts = keys.map(function (k) { return k + '=' + JSON.stringify(hashable[k]); });
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
  //
  // budget_dashboard_v12 is stored LZ-string COMPRESSED by app.js (prefixed
  // "LZ1:") whenever the LZString library is available — plain JSON.parse on
  // it throws immediately. This exact mirroring of app.js's own
  // encodeStateForStorage/decodeStoredState is required, not optional: it's
  // the difference between this file actually reading real accounts and
  // silently finding nothing (which is exactly what happened before this was
  // fixed — every prior test used the uncompressed export file as a fixture,
  // never the real on-disk compressed format, so this went uncaught).

  function decodeMainBlobValue(raw) {
    if (raw == null) return null;
    if (typeof raw === 'string' && raw.indexOf('LZ1:') === 0) {
      var dec = (window.LZString && typeof LZString.decompressFromUTF16 === 'function')
        ? LZString.decompressFromUTF16(raw.slice(4)) : null;
      if (!dec) throw new Error('drive-sync: could not decompress budget_dashboard_v12');
      return JSON.parse(dec);
    }
    return JSON.parse(raw); // legacy uncompressed snapshot
  }

  function encodeMainBlobValue(blob) {
    var json = JSON.stringify(blob);
    try {
      if (window.LZString && typeof LZString.compressToUTF16 === 'function') {
        return 'LZ1:' + LZString.compressToUTF16(json);
      }
    } catch (e) {}
    return json; // fallback: plain JSON (library missing) — matches app.js's own fallback
  }

  function parseMainBlob() {
    try {
      var raw = localStorage.getItem(MAIN_BLOB_KEY);
      return raw ? decodeMainBlobValue(raw) : null;
    } catch (e) {
      console.error('Veyra Drive sync: failed to parse local budget data', e);
      return null;
    }
  }

  function writeMainBlob(blob) {
    try { localStorage.setItem(MAIN_BLOB_KEY, encodeMainBlobValue(blob)); } catch (e) {}
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
        // driveOrigin === 'joined' means this identity connected to someone
        // ELSE's shared folder via the Picker (Stage 4c) rather than owning
        // it — it can never be recreated by searching/creating under this
        // identity's own "Veyra" root folder, only reconnected via its
        // originally-picked folder ID. See ensureUnitFileId's owned/joined
        // branch below.
        var owned = acc.driveOrigin !== 'joined';
        units.push({ kind: 'account', id: 'account:' + acc.id, accountId: acc.id, label: acc.name || acc.id, folderName: sanitizeFolderName(acc.name), owned: owned });
      });
    } else {
      console.warn('[Veyra Sync] listSyncUnits: could not read any accounts from local data (blob=' + (blob ? 'parsed but blob.accounts is not an array' : 'null/failed to parse') + ') — only settings will sync.');
    }
    units.push({ kind: 'settings', id: 'settings', label: 'Account settings' });
    console.log('[Veyra Sync] units this pass:', units.map(function (u) { return u.id + (u.owned === false ? ' (joined)' : ''); }).join(', '));
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
      if (idx === -1) {
        blob.accounts.push(data.account);
      } else {
        // driveOrigin is a LOCAL-ONLY marker of how THIS device came to
        // have this account (owned vs joined via Stage 4c) — it is never
        // part of what gets written to the account's own Drive file (an
        // owner's copy of their own account metadata never has it, since
        // from their side they genuinely own it). Blindly replacing the
        // whole local entry with the incoming one — as this used to do —
        // silently erased that marker on every single pull, which then
        // made a joined account start being treated as owned, causing it
        // to sync to a brand new, disconnected file in the joiner's own
        // Drive instead of the real shared one. Confirmed as the actual
        // root cause of a real, sustained data-divergence bug — preserve
        // it explicitly instead of letting incoming metadata clobber it.
        var existingDriveOrigin = blob.accounts[idx] && blob.accounts[idx].driveOrigin;
        blob.accounts[idx] = existingDriveOrigin
          ? Object.assign({}, data.account, { driveOrigin: existingDriveOrigin })
          : data.account;
      }
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
    // Same reasoning as above: the incoming settings blob is a snapshot of
    // THIS identity's own previously-pushed settings, so its own accounts
    // list should be internally consistent already — but merge driveOrigin
    // flags defensively anyway rather than assume, since this is exactly
    // the kind of silent field loss that's expensive to notice later.
    if (Array.isArray(merged.accounts) && Array.isArray(currentBlob.accounts)) {
      var currentById = {};
      currentBlob.accounts.forEach(function (a) { if (a && a.id) currentById[a.id] = a; });
      merged.accounts = merged.accounts.map(function (a) {
        var existing = a && a.id ? currentById[a.id] : null;
        return existing && existing.driveOrigin ? Object.assign({}, a, { driveOrigin: existing.driveOrigin }) : a;
      });
    }
    mirrorActiveAccount(merged);
    writeMainBlob(merged);
    Object.keys(data).forEach(function (key) {
      if (key === MAIN_BLOB_KEY) return;
      try { localStorage.setItem(key, data[key]); } catch (e) {}
    });
  }

  // ---- Drive REST calls this file needs beyond what google-sync.js exposes ----

  function cacheBuster() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

  function driveFindFileByName(name, parentId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var clauses = ["name='" + name.replace(/'/g, "\\'") + "'", 'trashed=false'];
    if (parentId) clauses.push("'" + parentId + "' in parents");
    var q = encodeURIComponent(clauses.join(' and '));
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)&spaces=drive&_cb=' + cacheBuster(), {
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

  // A cache-busting query parameter (forcing a genuinely different URL on
  // every call) is load-bearing here, not defensive boilerplate — confirmed
  // from a real case where hashes on both sides agreed, yet the actual
  // pulled content was still stale. cache: 'no-store' alone only controls
  // the BROWSER's own cache; it does nothing about caching on Google's own
  // servers/CDN for repeated requests to the identical URL, which is what
  // this was actually up against.
  function driveGetFileMetadata(fileId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,modifiedTime&_cb=' + cacheBuster(), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive metadata fetch failed: HTTP ' + res.status);
      return res.json();
    });
  }

  // Checking a file/folder still exists AND isn't trashed is the crucial
  // second half — deleting something through Drive's normal UI moves it to
  // Trash rather than destroying it. It keeps its ID and stays directly
  // fetchable by that ID (200 OK), just excluded from search/listing — so a
  // stale cached ID pointing at a trashed item looks perfectly healthy
  // unless this is checked explicitly, and the app would silently keep
  // reading/writing to something the user can no longer see.
  function driveCheckIdStillValid(id) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.resolve(false);
    return fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=id,trashed&_cb=' + cacheBuster(), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) return false; // 404 (permanently deleted) or any other error -> treat as gone
      return res.json();
    }).then(function (json) {
      return !!(json && json.id && !json.trashed);
    }).catch(function () { return false; });
  }

  function driveFindFolderByName(name, parentId) {
    var token = window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken();
    if (!token) return Promise.reject(new Error('Not signed in to Google.'));
    var clauses = ["name='" + name.replace(/'/g, "\\'") + "'", "mimeType='application/vnd.google-apps.folder'", 'trashed=false'];
    if (parentId) clauses.push("'" + parentId + "' in parents");
    var q = encodeURIComponent(clauses.join(' and '));
    return fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)&spaces=drive&_cb=' + cacheBuster(), {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store'
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
      body: JSON.stringify(metadata),
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Drive folder create failed: HTTP ' + res.status);
      return res.json();
    });
  }

  function clearSyncMeta(unitId) {
    try { localStorage.removeItem(syncMetaKey(unitId)); } catch (e) {}
  }

  // If the root "Veyra" folder itself was deleted, everything inside it went
  // with it (Drive cascades trashing to descendants) — so every unit's
  // cached IDs and "last synced" markers are now equally stale. Simplest
  // reliable fix: reset ALL of this identity's sync bookkeeping at once
  // rather than trying to individually detect every orphaned descendant.
  function resetAllSyncBookkeeping() {
    console.warn('[Veyra Sync] resetting all Drive sync bookkeeping for this identity — will rebuild folders/files from scratch on the next pass');
    var keysToRemove = [];
    var len = localStorage.length;
    for (var i = 0; i < len; i++) {
      var key = localStorage.key(i);
      if (key && key.indexOf(BOOKKEEPING_PREFIX) === 0) keysToRemove.push(key);
    }
    keysToRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
  }

  function ensureRootFolderId() {
    var stored = null;
    try { stored = localStorage.getItem(ROOT_FOLDER_ID_KEY); } catch (e) {}
    if (stored) {
      return driveCheckIdStillValid(stored).then(function (valid) {
        if (valid) return stored;
        console.warn('[Veyra Sync] cached "Veyra" root folder no longer exists (deleted/trashed) — recreating everything');
        resetAllSyncBookkeeping();
        return ensureRootFolderId();
      });
    }
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
    if (stored) {
      return driveCheckIdStillValid(stored).then(function (valid) {
        if (valid) return stored;
        console.warn('[Veyra Sync] cached folder for "' + unit.label + '" no longer exists (deleted/trashed) — recreating it');
        try { localStorage.removeItem(key); } catch (e) {}
        try { localStorage.removeItem(fileIdKey(unit.id)); } catch (e) {} // its data.json's cached ID is now orphaned too
        clearSyncMeta(unit.id); // last-synced marker refers to the now-gone file — must not suppress the fresh push
        return ensureAccountFolderId(unit, rootFolderId);
      });
    }
    return driveFindFolderByName(unit.folderName, rootFolderId).then(function (found) {
      if (found) { try { localStorage.setItem(key, found.id); } catch (e) {} return found.id; }
      return driveCreateFolder(unit.folderName, rootFolderId).then(function (created) {
        try { localStorage.setItem(key, created.id); } catch (e) {}
        return created.id;
      });
    });
  }

  function joinedFolderIdKey(accountId) { return BOOKKEEPING_PREFIX + 'joined_folder_id_v1__' + accountId; }

  // Resolves (creating if needed) the Drive file ID for one sync unit, and
  // the folder it should be searched/created within.
  function ensureUnitFileId(unit) {
    var stored = null;
    try { stored = localStorage.getItem(fileIdKey(unit.id)); } catch (e) {}
    if (stored) {
      return driveCheckIdStillValid(stored).then(function (valid) {
        if (valid) { console.log('[Veyra Sync] unit=' + unit.id + ' reusing cached fileId=' + stored); return stored; }
        console.warn('[Veyra Sync] unit=' + unit.id + ' cached file no longer exists (deleted/trashed) — ' + (unit.owned === false ? 'looking for it again in the folder it was originally connected from' : 'recreating it'));
        try { localStorage.removeItem(fileIdKey(unit.id)); } catch (e) {}
        clearSyncMeta(unit.id); // last-synced marker refers to the now-gone file — must not suppress the fresh push
        return resolveUnitFileIdFresh(unit);
      });
    }
    return resolveUnitFileIdFresh(unit);
  }

  function resolveUnitFileIdFresh(unit) {
    var fileName = unit.kind === 'account' ? DATA_FILE_NAME : SETTINGS_FILE_NAME;

    // A JOINED account (connected via the Picker to someone else's shared
    // folder — Stage 4c) can never be resolved by searching or creating
    // under THIS identity's own "Veyra" root folder, because it doesn't
    // live there — it lives whichever folder the owner shared. Its only
    // known anchor is the folder ID captured at connect-time. If data.json
    // isn't found there, that's a genuine "lost access" situation this
    // identity cannot self-heal (only the owner can fix it), not something
    // to paper over by creating a disconnected duplicate file.
    if (unit.kind === 'account' && unit.owned === false) {
      var joinedFolderId = null;
      try { joinedFolderId = localStorage.getItem(joinedFolderIdKey(unit.accountId)); } catch (e) {}
      if (!joinedFolderId) {
        var err = new Error('No record of where "' + unit.label + '" was connected from — it may need to be reconnected via "Connect a shared budget".');
        console.error('[Veyra Sync] unit=' + unit.id + ' ' + err.message);
        return Promise.reject(err);
      }
      console.log('[Veyra Sync] unit=' + unit.id + ' (joined) looking for ' + fileName + ' in its originally-connected folder');
      return driveFindFileByName(fileName, joinedFolderId).then(function (found) {
        if (found) { try { localStorage.setItem(fileIdKey(unit.id), found.id); } catch (e) {} return found.id; }
        var missingErr = new Error('Can\u2019t find the shared budget file for "' + unit.label + '" — it may have been deleted, or you may have lost access. Ask the person who shared it with you to check the folder.');
        console.error('[Veyra Sync] unit=' + unit.id + ' ' + missingErr.message);
        throw missingErr;
      });
    }

    console.log('[Veyra Sync] unit=' + unit.id + ' resolving folder + file in Drive now');
    return ensureRootFolderId().then(function (rootFolderId) {
      if (unit.kind === 'settings') {
        return driveFindFileByName(fileName, rootFolderId).then(function (found) {
          if (found) { try { localStorage.setItem(fileIdKey(unit.id), found.id); } catch (e) {} return found.id; }
          return window.VeyraGoogleSync.driveCreateFile(fileName, {}, null, rootFolderId).then(function (created) {
            try { localStorage.setItem(fileIdKey(unit.id), created.id); } catch (e) {}
            console.log('[Veyra Sync] unit=' + unit.id + ' created ' + fileName + ' in Drive root, fileId=' + created.id);
            return created.id;
          });
        });
      }
      return ensureAccountFolderId(unit, rootFolderId).then(function (accountFolderId) {
        return driveFindFileByName(fileName, accountFolderId).then(function (found) {
          if (found) { try { localStorage.setItem(fileIdKey(unit.id), found.id); } catch (e) {} return found.id; }
          return window.VeyraGoogleSync.driveCreateFile(fileName, {}, null, accountFolderId).then(function (created) {
            try { localStorage.setItem(fileIdKey(unit.id), created.id); } catch (e) {}
            console.log('[Veyra Sync] unit=' + unit.id + ' created folder "' + unit.folderName + '" + ' + fileName + ' in Drive, fileId=' + created.id);
            return created.id;
          });
        });
      });
    }).catch(function (err) {
      console.error('[Veyra Sync] unit=' + unit.id + ' FAILED to resolve/create its Drive file:', err && err.stack || err);
      throw err;
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

      console.log('[Veyra Sync] unit=' + unit.id + ' fileId=' + fileId +
        ' localHash=' + localHash + ' remoteHash=' + remoteHash + ' lastSyncedHash=' + meta_.lastSyncedHash +
        ' remoteHasContent=' + remoteHasContent + ' localChanged=' + localChanged + ' remoteChanged=' + remoteChanged);

      if (!localChanged && !remoteChanged) { console.log('[Veyra Sync] unit=' + unit.id + ' -> noop (nothing changed on either side since last sync)'); return { outcome: 'noop' }; }

      if (localChanged && !remoteChanged) {
        return window.VeyraGoogleSync.driveUpdateFile(fileId, localSnapshot).then(function () {
          setSyncMeta(unit.id, localHash, new Date().toISOString());
          console.log('[Veyra Sync] unit=' + unit.id + ' -> pushed to Drive');
          return { outcome: 'pushed' };
        });
      }

      if (!localChanged && remoteChanged) {
        applyUnitSnapshot(unit, remoteSnapshot);
        setSyncMeta(unit.id, remoteHash, meta.modifiedTime);
        console.log('[Veyra Sync] unit=' + unit.id + ' -> pulled from Drive');
        return { outcome: 'pulled' };
      }

      // both changed — real conflict for this unit specifically
      console.log('[Veyra Sync] unit=' + unit.id + ' -> CONFLICT (both sides changed since last sync)');
      return {
        outcome: 'conflict',
        unit: unit, fileId: fileId,
        localSnapshot: localSnapshot, localHash: localHash,
        remoteSnapshot: remoteSnapshot, remoteHash: remoteHash, remoteModifiedTime: meta.modifiedTime
      };
    });
  }

  // ---- orchestrator: process every unit, one at a time ----

  function performSyncCheck(options) {
    options = options || {};
    var manual = !!options.manual;

    // If a conflict dialog is already open and waiting on a decision, don't
    // let a background tick (or another manual click) re-run the whole
    // check underneath it — that was re-detecting the SAME unresolved
    // conflict every few seconds and tearing down + recreating the dialog,
    // which showed up as it visibly "popping up twice". A conflict already
    // being shown is itself a complete, valid outcome for this pass; the
    // next real check happens once the user actually resolves it.
    if (document.getElementById('driveConflictOverlay')) {
      if (manual) showSyncToast('Please resolve the pending conflict first.', 'info');
      return Promise.resolve();
    }

    if (!window.VeyraIdentity || window.VeyraIdentity.isDefault()) {
      if (manual) showSyncToast('Sign in with Google first to enable backup.', 'warn');
      return Promise.resolve();
    }
    if (!window.VeyraGoogleSync || !window.VeyraGoogleSync.getAccessToken()) {
      // Update the PERSISTENT status pill regardless of manual/automatic —
      // silently doing nothing forever on a background check leaves no
      // visible sign that anything needs attention, which is exactly what
      // made this hard to notice before: reconnecting was only ever
      // discoverable if you happened to click "Sync now" and catch a toast.
      setSyncStatus('reconnect');
      if (manual) {
        // A manual click is clear intent — rather than just reporting the
        // failure, open the Google sign-in popup right now so one click
        // actually fixes it. This is the self-healing path for the very
        // common case where the browser's silent, invisible token refresh
        // fails (Safari/Firefox/Brave block it by default; some Chrome
        // users disable third-party cookies themselves) — Veyra has no
        // backend, so there's no long-lived refresh token to fall back on;
        // a quick, easy reconnect is the realistic alternative.
        showSyncToast('Reconnecting to Google…', 'info');
        try { sessionStorage.setItem('veyra_pending_manual_sync_toast', '1'); } catch (e) {}
        if (window.VeyraGoogleSync.signIn) window.VeyraGoogleSync.signIn();
      }
      return Promise.resolve();
    }
    if (syncInFlight) {
      if (manual) showSyncToast('Already syncing…', 'info');
      return Promise.resolve();
    }
    syncInFlight = true;
    setSyncStatus('syncing');

    var units = listSyncUnits();
    var needsReload = false;
    var pushedOrPulledCount = 0;
    var unitErrors = []; // one broken unit (e.g. a joined account that lost access) must not block the rest

    function processNext(index) {
      if (index >= units.length) {
        syncInFlight = false;
        if (unitErrors.length > 0) {
          setSyncStatus('error');
          if (manual) showSyncToast(unitErrors[0].message || 'Sync failed for one item — check the console for details.', 'error');
        } else {
          setSyncStatus('synced');
          if (manual) showSyncToast(pushedOrPulledCount > 0 ? '✓ Synced to Google Drive' : '✓ Already up to date', 'success');
        }
        if (needsReload) {
          // Carry the current token across this reload the same way
          // google-sync.js already does for its own sign-in redirects —
          // otherwise the reload silently drops it and the next thing
          // touching Drive has to fall back to the less reliable silent
          // reauth (or worse, sit there needing a manual reconnect the
          // user never asked for).
          if (window.VeyraGoogleSync.prepareForReload) window.VeyraGoogleSync.prepareForReload();
          window.location.reload();
        }
        return Promise.resolve();
      }
      return syncOneUnit(units[index]).then(function (result) {
        if (result.outcome === 'pushed' || result.outcome === 'pulled') pushedOrPulledCount++;
        if (result.outcome === 'pulled') needsReload = true;
        if (result.outcome === 'conflict') {
          syncInFlight = false;
          setSyncStatus('conflict');
          if (manual) showSyncToast('Action needed — see the dialog to resolve a conflict.', 'warn');
          showConflictDialog(result);
          return; // stop this pass — remaining units get picked up on the next sync
        }
        return processNext(index + 1);
      }).catch(function (err) {
        // A problem with THIS unit (most commonly: a joined account whose
        // shared folder is no longer reachable) shouldn't stop every other
        // unit from syncing — log it, remember it happened, keep going.
        console.error('[Veyra Sync] unit=' + units[index].id + ' failed, continuing with remaining units:', err && err.message || err);
        unitErrors.push(err);
        return processNext(index + 1);
      });
    }

    return processNext(0).catch(function (err) {
      console.error('Veyra Drive sync error:', err && err.stack || err);
      setSyncStatus('error');
      syncInFlight = false;
      if (manual) showSyncToast('Sync failed — check your connection and try again.', 'error');
    });
  }

  // ---- conflict dialog (per unit) ----

  function formatWhen(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso || 'unknown time'; }
  }

  var CONFLICT_LOG_KEY = 'veyra_conflict_log_v1';
  var CONFLICT_LOG_MAX = 30;

  // Persistent (survives reload, no perfect timing needed) — every time a
  // conflict is shown or resolved, a small record gets appended here.
  // Whenever this loop happens again, the actual evidence is one command
  // away instead of needing to be captured at exactly the right moment:
  // VeyraDriveSync.getConflictLog()
  function logConflictEvent(entry) {
    try {
      var raw = localStorage.getItem(CONFLICT_LOG_KEY);
      var log = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(log)) log = [];
      log.push(Object.assign({ at: new Date().toISOString() }, entry));
      if (log.length > CONFLICT_LOG_MAX) log = log.slice(log.length - CONFLICT_LOG_MAX);
      localStorage.setItem(CONFLICT_LOG_KEY, JSON.stringify(log));
    } catch (e) {}
  }

  function showConflictDialog(conflict) {
    closeConflictDialog();
    logConflictEvent({
      event: 'shown', unitId: conflict.unit.id,
      localHash: conflict.localHash, remoteHash: conflict.remoteHash,
      remoteModifiedTime: conflict.remoteModifiedTime
    });
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
    logConflictEvent({ event: 'choice-clicked', unitId: unit.id, choice: choice });
    if (choice === 'local') {
      saveRejectedSnapshotAsBackup(conflict.remoteSnapshot, unitLabelFor(unit) + ' \u2014 Google Drive version (replaced ' + new Date().toLocaleString() + ')');
      window.VeyraGoogleSync.driveUpdateFile(conflict.fileId, conflict.localSnapshot).then(function () {
        setSyncMeta(unit.id, conflict.localHash, new Date().toISOString());
        logConflictEvent({ event: 'resolved', unitId: unit.id, choice: choice, newLastSyncedHash: conflict.localHash });
        closeConflictDialog();
        performSyncCheck(); // resume with any remaining units
      }).catch(function (err) {
        // This previously failed completely silently — the dialog would
        // just get torn down and immediately recreated by the next sync
        // pass re-detecting the SAME unresolved conflict, forever, with no
        // indication anything was wrong. The most likely real-world cause:
        // this unit is a JOINED account (Stage 4c) living in someone else's
        // Drive, and this identity only has Viewer access there, not
        // Editor — a write like this one is expected to fail in that case.
        console.error('[Veyra Sync] failed to push "keep this device" choice for unit=' + unit.id + ':', err && err.message || err);
        logConflictEvent({ event: 'resolve-failed', unitId: unit.id, choice: choice, error: String(err && err.message || err) });
        closeConflictDialog();
        setSyncStatus('error');
        showSyncToast('Couldn\u2019t save your changes to \u201c' + unitLabelFor(unit) + '\u201d \u2014 you may only have view access to this shared budget. Ask the person who shared it to give you edit access, or pick \u201cGoogle Drive\u201d instead next time.', 'error');
      });
    } else {
      // Apply BEFORE saving the backup — applyUnitSnapshot merges surgically
      // (unlike Stage 4a's old clear-everything approach) so this ordering
      // isn't the same trap as before, but keeping the safer order regardless.
      applyUnitSnapshot(unit, conflict.remoteSnapshot);
      saveRejectedSnapshotAsBackup(conflict.localSnapshot, unitLabelFor(unit) + ' \u2014 this device\u2019s version (replaced ' + new Date().toLocaleString() + ')');
      setSyncMeta(unit.id, conflict.remoteHash, conflict.remoteModifiedTime);
      logConflictEvent({ event: 'resolved', unitId: unit.id, choice: choice, newLastSyncedHash: conflict.remoteHash });
      closeConflictDialog();
      if (window.VeyraGoogleSync.prepareForReload) window.VeyraGoogleSync.prepareForReload();
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
    var label = { syncing: 'Syncing…', synced: 'Backed up', error: 'Sync error — will retry', conflict: 'Action needed', reconnect: 'Reconnect needed — click ⟳' }[state] || '';
    el.textContent = label;
    el.setAttribute('data-state', state);
  }

  var toastHideTimer = null;

  // Small slide-in confirmation, shown only for MANUALLY triggered syncs
  // (the "Sync now" button, or syncNow() called directly) — background/
  // automatic syncs stay quiet on purpose, so this never becomes naggy.
  function showSyncToast(message, kind) {
    var el = document.getElementById('driveSyncToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'driveSyncToast';
      el.className = 'drive-sync-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.setAttribute('data-kind', kind || 'info');
    // restart the animation even if a toast is already showing
    el.classList.remove('is-visible');
    // eslint-disable-next-line no-unused-expressions
    el.offsetHeight; // force reflow so removing+re-adding the class re-triggers the CSS transition
    el.classList.add('is-visible');
    if (toastHideTimer) clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
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
    if (e.target.closest('#driveSyncNowBtn')) performSyncCheck({ manual: true });
  });

  window.addEventListener('veyra:google-token-ready', function () {
    performSyncCheck();
  });

  function init() {
    if (!window.VeyraIdentity) return setTimeout(init, 30);
    if (window.VeyraGoogleSync && window.VeyraGoogleSync.getAccessToken()) {
      var wasReconnecting = false;
      try {
        wasReconnecting = sessionStorage.getItem('veyra_pending_manual_sync_toast') === '1';
        sessionStorage.removeItem('veyra_pending_manual_sync_toast');
      } catch (e) {}
      performSyncCheck(wasReconnecting ? { manual: true } : undefined);
    }
    setInterval(autoSyncTick, AUTO_SYNC_INTERVAL_MS);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Called by shared-connect.js (Stage 4c) once the user has picked a
  // folder via the Google Picker and its data.json has been read and
  // validated. Adds the account locally, marks it as joined (not owned —
  // see listSyncUnits), and pre-seeds its sync bookkeeping so the very next
  // sync sees it as already up to date rather than immediately pushing
  // straight back what was just pulled.
  function addJoinedAccount(accountMeta, budgetData, folderId, fileId) {
    if (!accountMeta || !accountMeta.id) return { ok: false, reason: 'invalid-account' };
    var blob = parseMainBlob() || { accounts: [], accountBudgets: {} };
    blob.accounts = Array.isArray(blob.accounts) ? blob.accounts : [];
    blob.accountBudgets = blob.accountBudgets || {};

    var alreadyConnected = blob.accounts.some(function (a) { return a && a.id === accountMeta.id; });
    if (alreadyConnected) return { ok: false, reason: 'already-connected' };

    var joinedMeta = Object.assign({}, accountMeta, { driveOrigin: 'joined', visibility: 'shared' });
    blob.accounts.push(joinedMeta);
    blob.accountBudgets[accountMeta.id] = budgetData;
    writeMainBlob(blob);

    var unitId = 'account:' + accountMeta.id;
    try { localStorage.setItem(joinedFolderIdKey(accountMeta.id), folderId); } catch (e) {}
    try { localStorage.setItem(fileIdKey(unitId), fileId); } catch (e) {}
    setSyncMeta(unitId, hashSnapshot({ account: joinedMeta, budget: budgetData }), new Date().toISOString());

    return { ok: true, account: joinedMeta };
  }

  // Shared by both removal functions below. Reassigning activeAccountId
  // alone is NOT enough when the removed account was the active one — the
  // top-level "mirror" fields (months, subscriptions, etc.) that the app
  // actually reads/writes as its live working copy still hold the REMOVED
  // account's data at that point. Left uncorrected, the app's own
  // capture-on-save logic would later persist those stale top-level fields
  // into the NEWLY active account's bucket, silently overwriting its real
  // data with the just-removed account's. Confirmed as a genuine, serious
  // corruption path from a real case, not a theoretical one — the fix is
  // to always re-mirror immediately after any activeAccountId reassignment.
  function removeAccountAndBookkeeping(blob, accountId) {
    blob.accounts = blob.accounts.filter(function (a) { return a.id !== accountId; });
    if (blob.accountBudgets) delete blob.accountBudgets[accountId];
    if (blob.activeAccountId === accountId) {
      blob.activeAccountId = blob.accounts.length ? blob.accounts[0].id : null;
      mirrorActiveAccount(blob);
    }
    writeMainBlob(blob);

    var unitId = 'account:' + accountId;
    try { localStorage.removeItem(fileIdKey(unitId)); } catch (e) {}
    try { localStorage.removeItem(joinedFolderIdKey(accountId)); } catch (e) {}
    try { localStorage.removeItem(folderIdKey(accountId)); } catch (e) {}
    clearSyncMeta(unitId);
  }

  // Fully removes a joined account and every trace of its sync bookkeeping
  // — the account entry itself, its budget data, its cached Drive file/
  // folder IDs, and its last-synced marker. Deliberately refuses to touch
  // an OWNED account (those go through the existing "delete account" flow
  // in accounts-manager.js, which is a different, more involved operation).
  // Exists both as a real feature (undoing a mistaken connect) and as a
  // clean way to clear any stale bookkeeping accumulated from earlier,
  // since-fixed sync bugs — reconnecting fresh after this pulls a genuinely
  // new baseline rather than carrying old state forward indefinitely.
  function disconnectJoinedAccount(accountId) {
    var blob = parseMainBlob();
    if (!blob || !Array.isArray(blob.accounts)) return { ok: false, reason: 'no-data' };
    var account = null;
    for (var i = 0; i < blob.accounts.length; i++) { if (blob.accounts[i] && blob.accounts[i].id === accountId) { account = blob.accounts[i]; break; } }
    if (!account) return { ok: false, reason: 'not-found' };
    if (account.driveOrigin !== 'joined') return { ok: false, reason: 'not-a-joined-account' };

    removeAccountAndBookkeeping(blob, accountId);
    return { ok: true, removedAccountName: account.name };
  }

  // Recovery tool for exactly the corruption the driveOrigin bug above
  // could cause on an already-affected device: forcibly wipes an account
  // entry and ALL of its sync bookkeeping regardless of its current
  // driveOrigin value (unlike disconnectJoinedAccount, which correctly
  // refuses when that marker is already missing — which is precisely the
  // broken state this exists to clean up). Only ever meant to be run
  // manually, once, to clear a specific known-corrupted account before
  // reconnecting fresh through the normal "Connect a shared budget" flow.
  function forceRemoveAccountForRepair(accountId) {
    var blob = parseMainBlob();
    if (!blob || !Array.isArray(blob.accounts)) return { ok: false, reason: 'no-data' };
    var account = null;
    for (var i = 0; i < blob.accounts.length; i++) { if (blob.accounts[i] && blob.accounts[i].id === accountId) { account = blob.accounts[i]; break; } }
    if (!account) return { ok: false, reason: 'not-found' };

    removeAccountAndBookkeeping(blob, accountId);
    return { ok: true, removedAccountName: account.name };
  }

  window.VeyraDriveSync = {
    syncNow: function (options) { return performSyncCheck(Object.assign({ manual: true }, options || {})); },
    addJoinedAccount: addJoinedAccount,
    disconnectJoinedAccount: disconnectJoinedAccount,
    forceRemoveAccountForRepair: forceRemoveAccountForRepair,
    // Diagnostic — reads back every conflict shown/resolved/failed, with
    // timestamps, no matter how long ago it happened. Run this any time
    // AFTER something looked wrong, not only in the moment.
    getConflictLog: function () {
      try {
        var raw = localStorage.getItem(CONFLICT_LOG_KEY);
        var log = raw ? JSON.parse(raw) : [];
        console.table && Array.isArray(log) && log.length ? console.table(log) : console.log(log);
        return log;
      } catch (e) { console.log([]); return []; }
    },
    // Diagnostic — the CURRENT hash state for every unit, computed fresh
    // right now, without needing a live sync pass to have just happened.
    getCurrentUnitState: function () {
      var units = listSyncUnits();
      var out = units.map(function (u) {
        var snapshot = getUnitSnapshot(u);
        var meta = getSyncMeta(u.id);
        return { unit: u.id, localHash: hashSnapshot(snapshot), lastSyncedHash: meta.lastSyncedHash, lastSyncedAt: meta.lastSyncedAt };
      });
      console.table && out.length ? console.table(out) : console.log(out);
      return out;
    }
  };
}());

(function () {
  'use strict';

  // ============================================================================
  // Veyra Identity — Stage 2 of the sync/sharing build.
  //
  // What this file does: gives each "identity" using this browser (today: just
  // the built-in 'local' identity; from Stage 3 onward: one per signed-in Google
  // account) its own private slice of localStorage, so switching identities on
  // the same device can never show one person's data to another.
  //
  // How: every localStorage key Veyra (or any of its features) reads or writes
  // gets transparently suffixed with the active identity's id, EXCEPT for the
  // default 'local' identity, whose keys are left completely unprefixed. That
  // second part is the important guarantee for today's users: if nobody signs
  // in, storage behaves EXACTLY as it did before this file existed — same key
  // names, same values, nothing to migrate, nothing that can appear "lost".
  //
  // This intentionally does NOT touch app.js or any other file. It intercepts
  // storage at the lowest level (window.localStorage itself) so nothing else
  // in the codebase needs to know identities exist yet.
  //
  // Deliberately NOT implemented: full for-in / Object.keys(localStorage)
  // enumeration support (the Proxy "ownKeys" trap). Only two places in the
  // codebase enumerate localStorage that way and both are non-critical,
  // try/caught diagnostics (durability.js's storage-quota check) — adding
  // ownKeys/getOwnPropertyDescriptor traps would cover them too, but real
  // Storage host objects have unusual low-level semantics that make those
  // traps a real source of cross-browser Proxy-invariant bugs for very little
  // benefit here. Skipping them is a deliberate, documented risk trade-off,
  // not an oversight.
  // ============================================================================

  if (window.VeyraIdentity) return; // idempotent if this file is ever loaded twice

  var nativeStorage = window.localStorage;
  var POINTER_KEY = 'veyra_active_identity_v1';   // never namespaced — the pointer itself must always be findable
  var REGISTRY_KEY = 'veyra_known_identities_v1'; // never namespaced — small list of identities seen on this device
  var DEFAULT_ID = 'local';
  var SUFFIX = '__vid_';

  function nativeGet(key) {
    try { return nativeStorage.getItem(key); } catch (e) { return null; }
  }
  function nativeSet(key, value) {
    try { nativeStorage.setItem(key, value); } catch (e) {}
  }
  function nativeRemove(key) {
    try { nativeStorage.removeItem(key); } catch (e) {}
  }

  function activeId() {
    var stored = nativeGet(POINTER_KEY);
    return stored ? stored : DEFAULT_ID;
  }

  function namespacedKey(rawKey, id) {
    id = id || activeId();
    if (id === DEFAULT_ID) return rawKey;
    return rawKey + SUFFIX + id;
  }

  // Only used by clear()/key()/length — a full native-storage scan is fine
  // here since none of these are hot paths (called rarely: "clear all data",
  // rendering the storage list, or the occasional length check).
  function ownKeysForActive() {
    var id = activeId();
    var out = [];
    var i, key;
    for (i = 0; i < nativeStorage.length; i++) {
      key = nativeStorage.key(i);
      if (key === POINTER_KEY || key === REGISTRY_KEY) continue;
      if (id === DEFAULT_ID) {
        if (key.indexOf(SUFFIX) === -1) out.push(key);
      } else {
        var suffix = SUFFIX + id;
        if (key.length > suffix.length && key.slice(-suffix.length) === suffix) {
          out.push(key.slice(0, key.length - suffix.length));
        }
      }
    }
    return out;
  }

  var METHOD_NAMES = { getItem: 1, setItem: 1, removeItem: 1, clear: 1, key: 1 };

  var storageProxy = new Proxy(nativeStorage, {
    get: function (target, prop) {
      if (prop === 'getItem') {
        return function (key) { return nativeGet(namespacedKey(String(key))); };
      }
      if (prop === 'setItem') {
        return function (key, value) { nativeSet(namespacedKey(String(key)), String(value)); };
      }
      if (prop === 'removeItem') {
        return function (key) { nativeRemove(namespacedKey(String(key))); };
      }
      if (prop === 'clear') {
        return function () {
          ownKeysForActive().forEach(function (key) { nativeRemove(namespacedKey(key)); });
        };
      }
      if (prop === 'key') {
        return function (index) { return ownKeysForActive()[index] || null; };
      }
      if (prop === 'length') {
        return ownKeysForActive().length;
      }
      // Bracket/dot-style reads (e.g. localStorage[key]) for any key that
      // isn't one of the Storage API's own method/property names.
      if (typeof prop === 'string' && !(prop in METHOD_NAMES)) {
        return nativeGet(namespacedKey(prop));
      }
      return undefined;
    },
    set: function (target, prop, value) {
      if (typeof prop === 'string') {
        nativeSet(namespacedKey(prop), String(value));
        return true;
      }
      return false;
    },
    has: function (target, prop) {
      if (prop in METHOD_NAMES || prop === 'length') return true;
      return ownKeysForActive().indexOf(prop) !== -1;
    }
  });

  try {
    Object.defineProperty(window, 'localStorage', { value: storageProxy, configurable: true });
  } catch (e) {
    // If some environment refuses to let us override localStorage, fail open:
    // the app keeps working exactly as before, just without identity
    // separation. Never let this file be the reason Veyra doesn't load.
  }

  function listKnownIdentities() {
    try {
      var raw = nativeGet(REGISTRY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function saveKnownIdentities(list) {
    try { nativeSet(REGISTRY_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // switchTo('local') returns to the always-unprefixed default identity.
  // switchTo(someId, {label, email}) is what Stage 3 (Google sign-in) will
  // call once someone authenticates — meta is merged into the registry entry
  // so a future "switch identity" UI has something to show.
  function switchTo(id, meta) {
    id = String(id || DEFAULT_ID).trim() || DEFAULT_ID;
    nativeSet(POINTER_KEY, id);
    if (id !== DEFAULT_ID) {
      var list = listKnownIdentities();
      var existing = null;
      list.forEach(function (item) { if (item && item.id === id) existing = item; });
      var entry = Object.assign({ id: id, addedAt: new Date().toISOString() }, existing || {}, meta || {});
      var next = list.filter(function (item) { return item && item.id !== id; });
      next.push(entry);
      saveKnownIdentities(next);
    }
  }

  window.VeyraIdentity = {
    version: '1.0.0',
    DEFAULT_ID: DEFAULT_ID,
    getActiveId: activeId,
    isDefault: function () { return activeId() === DEFAULT_ID; },
    listKnownIdentities: listKnownIdentities,
    switchTo: switchTo,
    // Escape hatch for any code that deliberately needs the real, unnamespaced
    // storage (e.g. a future "merge identities" or "export everything" tool).
    nativeStorage: nativeStorage
  };
}());

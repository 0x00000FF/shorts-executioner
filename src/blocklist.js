// blocklist.js — persistent per-channel blocklist (chrome.storage.local), with an
// in-memory cache + fast lookup sets, kept in sync across tabs/popup via storage events.
//
// An entry is { id, handle, name, ts }. We match a channel if ANY known identifier
// matches a blocked entry. Channel ID (UC...) is the most stable key, handle (@...) next,
// display name is a last resort (not unique).
(function () {
  'use strict';
  const EXEC = window.__EXEC;
  const bl = {};
  const KEY = 'blockedChannels';

  let entries = [];
  const ids = new Set();
  const handles = new Set();
  const names = new Set();

  const normHandle = (h) => (h || '').replace(/^@/, '').trim().toLowerCase();
  const normName = (n) => (n || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normId = (i) => (i || '').trim().toLowerCase();

  function rebuild() {
    ids.clear(); handles.clear(); names.clear();
    for (const e of entries) {
      if (e.id) ids.add(normId(e.id));
      if (e.handle) handles.add(normHandle(e.handle));
      if (e.name) names.add(normName(e.name));
    }
  }

  bl.load = () => new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [KEY]: [] }, (got) => {
        entries = Array.isArray(got && got[KEY]) ? got[KEY] : [];
        rebuild();
        resolve(entries);
      });
    } catch (_) { entries = []; rebuild(); resolve(entries); }
  });

  bl.all = () => entries.slice();
  bl.count = () => entries.length;
  bl.isEmpty = () => entries.length === 0;

  // Compact form handed to the MAIN-world interceptor (sets of identifiers).
  bl.compile = () => {
    const out = { ids: [], handles: [], names: [] };
    for (const e of entries) {
      if (e.id) out.ids.push(normId(e.id));
      if (e.handle) out.handles.push(normHandle(e.handle));
      if (e.name) out.names.push(normName(e.name));
    }
    return out;
  };

  // ch = { id?, handle?, name? }
  bl.has = (ch) => {
    if (!ch) return false;
    if (ch.id && ids.has(normId(ch.id))) return true;
    if (ch.handle && handles.has(normHandle(ch.handle))) return true;
    if (ch.name && names.has(normName(ch.name))) return true;
    return false;
  };

  function persist() {
    return new Promise((res) => {
      try { chrome.storage.local.set({ [KEY]: entries }, () => res()); }
      catch (_) { res(); }
    });
  }

  bl.add = async (ch) => {
    if (!ch || (!ch.id && !ch.handle && !ch.name)) return false;
    if (bl.has(ch)) return false;
    entries.push({
      id: ch.id || null,
      handle: ch.handle ? normHandle(ch.handle) : null,
      name: ch.name || null,
      ts: Date.now(),
    });
    rebuild();
    await persist();
    return true;
  };

  // Remove all entries matching any identifier of `ch`.
  bl.remove = async (ch) => {
    if (!ch) return false;
    const before = entries.length;
    entries = entries.filter((e) => {
      if (ch.id && normId(e.id) === normId(ch.id)) return false;
      if (ch.handle && normHandle(e.handle) === normHandle(ch.handle)) return false;
      if (ch.name && normName(e.name) === normName(ch.name)) return false;
      return true;
    });
    if (entries.length === before) return false;
    rebuild();
    await persist();
    return true;
  };

  // Notify the content script when the list changes elsewhere (popup, other tab).
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      entries = Array.isArray(changes[KEY].newValue) ? changes[KEY].newValue : [];
      rebuild();
      if (typeof EXEC.onBlocklistChanged === 'function') {
        try { EXEC.onBlocklistChanged(); } catch (_) {}
      }
    });
  } catch (_) { /* events unavailable — non-fatal */ }

  EXEC.blocklist = bl;
})();

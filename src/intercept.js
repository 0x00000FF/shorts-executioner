// intercept.js — runs in the MAIN (page) world at document_start.
//
// Prunes blocked channels' items out of YouTube's Innertube JSON *before* the Polymer
// app renders them, so blocked channels never appear in home / search / related /
// infinite-scroll at all (not merely hidden after the fact).
//
// How it gets the blocklist without chrome.storage (unavailable in the MAIN world):
//   - reads a localStorage mirror synchronously at startup (the persisted list is
//     available immediately, before YouTube assigns ytInitialData), and
//   - accepts live updates posted by the isolated content script (window.postMessage),
//     re-filtering the already-trapped bootstrap payload when it first becomes active.
//
// Injected via declarative content_scripts world:"MAIN" (NOT an inline <script>), which
// is exempt from YouTube's Trusted-Types CSP.
(function () {
  'use strict';
  if (window.__execIntercepted) return;
  window.__execIntercepted = true;

  const LS_KEY = '__exec_blocklist_v1';
  const MSG_TAG = 'EXEC_BLOCKLIST';
  const READY_TAG = 'EXEC_READY';
  const HELLO_TAG = 'EXEC_HELLO';
  const MAX_DEPTH = 200;

  // ---------------------------------------------------------------- blocklist state
  let ids = new Set();
  let handles = new Set();
  let names = new Set();
  let active = false;
  const refilters = []; // re-run filtering on already-trapped bootstrap globals

  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const normHandle = (h) => lc(h).replace(/^@/, '').replace(/\/.*$/, '').trim();
  const normName = (n) => lc(n).replace(/\s+/g, ' ').trim();

  function setBlocklist(data) {
    try {
      ids = new Set((data.ids || []).map(lc));
      handles = new Set((data.handles || []).map(normHandle));
      names = new Set((data.names || []).map(normName));
      active = ids.size + handles.size + names.size > 0;
    } catch (_) { /* keep previous */ }
  }

  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) setBlocklist(JSON.parse(raw));
  } catch (_) { /* localStorage may be unavailable */ }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__exec === MSG_TAG) {
      const was = active;
      setBlocklist(e.data.data || {});
      // First time the list becomes active (e.g. cold start, empty mirror), re-filter the
      // already-assigned bootstrap payload in place so Polymer re-reads pruned data.
      if (active && !was) { for (const r of refilters) { try { r(); } catch (_) {} } }
    } else if (e.data.__exec === HELLO_TAG) {
      try { window.postMessage({ __exec: READY_TAG }, '*'); } catch (_) {}
    }
  });

  // Announce ourselves (in case the content script is already listening).
  try { window.postMessage({ __exec: READY_TAG }, '*'); } catch (_) {}

  // ---------------------------------------------------------------- channel extraction
  // Index-tolerant path resolver: when a segment lands on an array, scan its elements
  // for the first one carrying the next key (handles runs[]/metadataParts[] etc).
  function resolve(obj, path) {
    let cur = obj;
    const tokens = path.split('.');
    for (let t of tokens) {
      if (cur == null) return undefined;
      const m = /^([^[]+)\[(\d+)\]$/.exec(t);
      if (m) {
        cur = cur[m[1]];
        cur = Array.isArray(cur) ? cur[+m[2]] : undefined;
        continue;
      }
      if (Array.isArray(cur)) {
        cur = cur.find((x) => x && typeof x === 'object' && t in x);
        cur = cur ? cur[t] : undefined;
      } else {
        cur = cur[t];
      }
    }
    return cur;
  }

  const ID_PATHS = [
    'shortBylineText.runs.navigationEndpoint.browseEndpoint.browseId',
    'longBylineText.runs.navigationEndpoint.browseEndpoint.browseId',
    'ownerText.runs.navigationEndpoint.browseEndpoint.browseId',
    'authorEndpoint.browseEndpoint.browseId',
    'channelId',
    'externalId',
    'navigationEndpoint.browseEndpoint.browseId',
    'channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.navigationEndpoint.browseEndpoint.browseId',
    'navigationEndpoint.reelWatchEndpoint.overlay.reelPlayerOverlayRenderer.reelPlayerHeaderSupportedRenderers.reelPlayerHeaderRenderer.channelNavigationEndpoint.browseEndpoint.browseId',
    'metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint.browseId',
    'metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows.metadataParts.text.commandRuns.onTap.innertubeCommand.browseEndpoint.browseId',
  ];
  const URL_PATHS = [
    'shortBylineText.runs.navigationEndpoint.browseEndpoint.canonicalBaseUrl',
    'longBylineText.runs.navigationEndpoint.browseEndpoint.canonicalBaseUrl',
    'ownerText.runs.navigationEndpoint.browseEndpoint.canonicalBaseUrl',
    'navigationEndpoint.browseEndpoint.canonicalBaseUrl',
    'shortBylineText.runs.navigationEndpoint.commandMetadata.webCommandMetadata.url',
    'authorEndpoint.commandMetadata.webCommandMetadata.url',
    'canonicalBaseUrl',
  ];
  const NAME_PATHS = [
    'shortBylineText.runs.text',
    'longBylineText.runs.text',
    'ownerText.runs.text',
    'channelName',
    'displayName',
  ];

  function handleFromUrl(url) {
    if (!url) return null;
    const at = /\/@([^/?#]+)/.exec(url);
    if (!at) return null;
    try { return decodeURIComponent(at[1]); } catch (_) { return at[1]; }
  }
  function idFromUrl(url) {
    if (!url) return null;
    const uc = /\/channel\/(UC[\w-]+)/.exec(url);
    return uc ? uc[1] : null;
  }

  function isBlockedItem(value) {
    if (!value || typeof value !== 'object') return false;

    for (const p of ID_PATHS) {
      const v = resolve(value, p);
      if (typeof v === 'string' && ids.has(lc(v))) return true;
    }
    if (handles.size || ids.size) {
      for (const p of URL_PATHS) {
        const url = resolve(value, p);
        if (typeof url !== 'string') continue;
        const h = handleFromUrl(url);
        if (h && handles.has(normHandle(h))) return true;
        const id = idFromUrl(url);
        if (id && ids.has(lc(id))) return true;
      }
    }
    if (names.size) {
      for (const p of NAME_PATHS) {
        const v = resolve(value, p);
        if (typeof v === 'string' && names.has(normName(v))) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- the filter
  const ITEM_RENDERERS = new Set([
    'videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer', 'playlistVideoRenderer',
    'playlistPanelVideoRenderer', 'endScreenVideoRenderer', 'movieRenderer', 'compactMovieRenderer',
    'videoWithContextRenderer', 'videoCardRenderer', 'watchCardCompactVideoRenderer',
    'channelFeaturedVideoRenderer', 'promotedVideoRenderer',
    'playlistRenderer', 'gridPlaylistRenderer', 'radioRenderer', 'compactRadioRenderer', 'gridRadioRenderer',
    'channelRenderer', 'gridChannelRenderer', 'compactChannelRenderer',
    'reelItemRenderer', 'lockupViewModel',
  ]);
  // Array keys we drop entirely once they become empty.
  const EMPTYABLE = new Set(['contents', 'items', 'results']);
  // Keys that hold a section's item list (incl. the singular 'content' object wrapper).
  const SECTION_CONTENT_KEYS = new Set(['contents', 'items', 'results', 'content']);
  // Non-renderable metadata. A wrapper holding only these (after losing its items) is a ghost.
  const METADATA_KEYS = new Set([
    'title', 'header', 'headerRenderer', 'subtitle', 'menu', 'icon', 'thumbnail',
    'trackingParams', 'sectionIdentifier', 'targetId', 'style', 'continuations',
    'shortBylineText', 'longBylineText', 'ownerText', 'badges',
  ]);

  // Walks the tree once. Returns true if the page should remove this node. The outer
  // filterTree reports whether anything was actually mutated (to skip useless re-serialize).
  function filterTree(data) {
    if (!active || !data || typeof data !== 'object') return false;
    let mutated = false;

    function filter(node, depth) {
      if (depth > MAX_DEPTH || node == null || typeof node !== 'object') return false;

      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (filter(node[i], depth + 1)) { node.splice(i, 1); mutated = true; }
        }
        return false;
      }

      // Direct hit: this object wraps a blocked leaf item.
      for (const k in node) {
        if (ITEM_RENDERERS.has(k)) {
          const v = node[k];
          if (v && typeof v === 'object' && isBlockedItem(v)) return true;
        }
      }

      // Recurse; prune children that ask to be removed, then collapse emptied containers.
      let removed = false;
      let lostContent = false;
      for (const k of Object.keys(node)) {
        const child = node[k];
        if (!child || typeof child !== 'object') continue;
        if (filter(child, depth + 1)) {
          delete node[k]; removed = true; mutated = true;
          if (SECTION_CONTENT_KEYS.has(k)) lostContent = true;
          continue;
        }
        if (Array.isArray(child) && child.length === 0 && EMPTYABLE.has(k)) {
          delete node[k]; removed = true; mutated = true;
          if (SECTION_CONTENT_KEYS.has(k)) lostContent = true;
        }
      }

      if (removed) {
        const keys = Object.keys(node);
        if (keys.length === 0) return true; // fully empty wrapper → parent removes it
        // Ghost section/shelf: lost its item list, only metadata left → collapse it too.
        if (lostContent && keys.every((k) => METADATA_KEYS.has(k))) return true;
      }
      return false;
    }

    try { filter(data, 0); } catch (_) { /* never break the page over a filter error */ }
    return mutated;
  }

  // ---------------------------------------------------------------- hooks
  const FETCH_URIS = [
    '/youtubei/v1/browse',
    '/youtubei/v1/search',
    '/youtubei/v1/next',
    '/youtubei/v1/guide',
  ];

  const origFetch = window.fetch;
  window.fetch = function (resource, init) {
    let url = '';
    try { url = resource instanceof Request ? resource.url : String(resource || ''); } catch (_) {}
    if (!active || !url || !FETCH_URIS.some((u) => url.includes(u))) {
      return origFetch.apply(this, arguments);
    }
    return origFetch.apply(this, arguments).then((resp) => {
      return resp.clone().json().then((data) => {
        const changed = filterTree(data);
        if (!changed) return resp; // nothing pruned → hand back the untouched original
        return new Response(JSON.stringify(data), {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
      }).catch(() => resp); // not JSON / parse failed → pass original through
    });
  };

  // Filter the bootstrap payloads assigned during initial page load, and register a
  // re-filter so a late-arriving blocklist can prune the same in-place object.
  function trapGlobal(name) {
    let stored;
    refilters.push(() => { if (stored != null) filterTree(stored); });
    try {
      const existing = Object.getOwnPropertyDescriptor(window, name);
      if (existing) {
        if ('value' in existing) stored = existing.value;
        else if (typeof existing.get === 'function') { try { stored = existing.get(); } catch (_) {} }
        if (stored != null) filterTree(stored);
        if (existing.configurable === false) return; // can't redefine; already filtered in place
      }
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return stored; },
        set(v) { filterTree(v); stored = v; },
      });
    } catch (_) {
      try { filterTree(window[name]); } catch (__) {}
    }
  }
  trapGlobal('ytInitialData');
})();

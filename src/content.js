// content.js — orchestration (isolated world):
//   - inject the one-click "처리" button and the "채널 차단" button
//   - enforce the blocklist in the DOM (hide feed cards, auto-skip blocked shorts)
//   - bridge the blocklist to the MAIN-world interceptor (localStorage mirror + postMessage)
//   - keep everything alive across YouTube's SPA navigations / Polymer re-renders
(function () {
  'use strict';
  const EXEC = window.__EXEC;
  const { util, yt, blocklist, DEFAULTS, SEL } = EXEC;

  let settings = { ...DEFAULTS };
  const BTN_CLASS = 'exec-nuke-btn';
  const GROUP_CLASS = 'exec-btns';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LS_KEY = '__exec_blocklist_v1';

  // ----------------------------------------------------------------- settings
  function loadSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (got) => { settings = { ...DEFAULTS, ...(got || {}) }; resolve(); });
      } catch (_) { settings = { ...DEFAULTS }; resolve(); }
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      let touched = false;
      for (const k of Object.keys(changes)) { settings[k] = changes[k].newValue; touched = true; }
      if (!touched) return;
      if (!settings.enabled) removeAllButtons();
      scan();
    });
  } catch (_) {}

  // ----------------------------------------------------------------- blocklist bridge
  function mirrorBlocklist() {
    const data = blocklist.compile();
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
    try { window.postMessage({ __exec: 'EXEC_BLOCKLIST', data }, '*'); } catch (_) {}
  }

  // The interceptor announces itself (it loads before us); resend the list on request.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__exec === 'EXEC_READY') mirrorBlocklist();
  });

  // ----------------------------------------------------------------- button UI
  function iconSvg(action) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'exec-icon');
    svg.setAttribute('aria-hidden', 'true');
    const mk = (tag, attrs) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      svg.appendChild(el);
    };
    if (action === 'block') {
      // a person silhouette with a slash = "block this channel"
      mk('circle', { cx: '12', cy: '8.4', r: '3.1', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' });
      mk('path', { d: 'M5.8 19.2a6.4 6.4 0 0 1 12.4 0', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' });
      mk('line', { x1: '4.4', y1: '4', x2: '19.8', y2: '20.2', stroke: 'currentColor', 'stroke-width': '2.3', 'stroke-linecap': 'round' });
    } else {
      // circle + diagonal slash (ban) = "dislike + not interested + don't recommend"
      mk('circle', { cx: '12', cy: '12', r: '9', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2' });
      mk('line', { x1: '5.6', y1: '5.6', x2: '18.4', y2: '18.4', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round' });
    }
    return svg;
  }

  function makeButton(action, place) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${BTN_CLASS} exec-${place} exec-act-${action}`;
    if (action === 'block') {
      btn.title = '이 채널 영구 차단 (추천·검색에서 숨김, 쇼츠 자동 스킵)';
      btn.setAttribute('aria-label', '이 채널 영구 차단');
    } else {
      btn.title = '한 번에 처리: 싫어요 + 관심 없음 + 채널 추천 안함';
      btn.setAttribute('aria-label', '양산형 콘텐츠 한 번에 처리');
    }
    btn.appendChild(iconSvg(action));
    return btn;
  }

  function buildGroup(place, scope) {
    const wrap = document.createElement('div');
    wrap.className = `${GROUP_CLASS} ${GROUP_CLASS}-${place}`;
    const nuke = makeButton('nuke', place);
    nuke.addEventListener('click', (e) => onNuke(e, scope, nuke));
    wrap.appendChild(nuke);
    if (settings.blockChannel) {
      const block = makeButton('block', place);
      block.addEventListener('click', (e) => onBlock(e, scope, block));
      wrap.appendChild(block);
    }
    return wrap;
  }

  function stop(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }

  async function onNuke(e, scope, btn) {
    stop(e);
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.classList.add('exec-busy');
    try {
      const did = await yt.nuke(scope, settings);
      if (did.length) { btn.classList.add('exec-done'); util.toast('처리됨 — ' + did.join(' · '), 'ok'); }
      else util.toast('처리할 메뉴 항목을 찾지 못했어요', 'warn');
    } catch (_) { util.toast('오류가 발생했어요', 'err'); }
    finally { btn.classList.remove('exec-busy'); btn.dataset.busy = '0'; }
  }

  async function onBlock(e, scope, btn) {
    stop(e);
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    try {
      const ch = yt.extractChannel(scope.root);
      if (!ch) { util.toast('채널 정보를 찾지 못했어요', 'warn'); return; }
      const label = ch.handle ? '@' + ch.handle : (ch.name || ch.id || '채널');
      const added = await blocklist.add(ch);
      mirrorBlocklist();
      util.toast(added ? ('채널 차단됨 — ' + label) : ('이미 차단된 채널 — ' + label), 'ok');
      if (scope.isShorts) { yt.pauseActiveVideo(scope.root); yt.goNextShort(); }
      else enforce();
    } catch (_) { util.toast('오류가 발생했어요', 'err'); }
    finally { btn.dataset.busy = '0'; }
  }

  // ----------------------------------------------------------------- injection
  function injectShorts() {
    if (!settings.onShorts) return;
    document.querySelectorAll(SEL.shortsReel).forEach((reel) => {
      const rail = reel.querySelector('reel-action-bar-view-model') || reel.querySelector('#actions');
      if (!rail || rail.querySelector(':scope > .' + GROUP_CLASS)) return;
      rail.insertBefore(buildGroup('shorts', { root: reel, isShorts: true }), rail.firstChild);
    });
  }

  function injectFeed() {
    if (!settings.onFeed) return;
    document.querySelectorAll(SEL.feedCards).forEach((card) => {
      const thumb = card.querySelector(SEL.feedThumb);
      if (!thumb || thumb.querySelector(':scope > .' + GROUP_CLASS)) return;
      thumb.appendChild(buildGroup('feed', { root: card, isShorts: false }));
    });
  }

  function removeAllButtons() {
    document.querySelectorAll('.' + GROUP_CLASS).forEach((g) => g.remove());
  }

  // ----------------------------------------------------------------- enforcement (DOM safety net)
  function enforceFeed() {
    if (!settings.hideBlockedFeed || blocklist.isEmpty()) {
      // feed-hiding is off (or the list emptied): make sure nothing stays hidden
      document.querySelectorAll('.exec-hidden').forEach((el) => el.classList.remove('exec-hidden'));
      return;
    }
    document.querySelectorAll(SEL.feedCards).forEach((card) => {
      const ch = yt.extractChannel(card);
      const blocked = ch && blocklist.has(ch);
      if (blocked) card.classList.add('exec-hidden');
      else if (card.classList.contains('exec-hidden')) card.classList.remove('exec-hidden');
    });
  }

  let shortsObserver = null;
  function ensureShortsObserver() {
    if (shortsObserver || !yt.isShortsPage()) return;
    const host = document.querySelector('ytd-shorts');
    if (!host) return;
    shortsObserver = new MutationObserver(() => enforceShorts());
    shortsObserver.observe(host, { attributes: true, attributeFilter: ['is-active'], subtree: true, childList: true });
  }

  function enforceShorts() {
    if (!settings.autoSkipShorts || blocklist.isEmpty() || !yt.isShortsPage()) return;
    const reel = yt.getActiveReel();
    if (!reel || reel.dataset.execGaveUp === '1') return;
    const ch = yt.extractChannel(reel);
    if (!ch || !blocklist.has(ch)) return;
    const now = performance.now();
    if (now - (+(reel.dataset.execSkipTs || 0)) < 800) return; // don't hammer if advance is slow
    reel.dataset.execSkipTs = String(now);
    const tries = (+(reel.dataset.execSkipTries || 0)) + 1;
    reel.dataset.execSkipTries = String(tries);
    yt.pauseActiveVideo(reel);
    yt.goNextShort();
    // If we can't advance (e.g. last loaded short / no-op nav button), stop after a few
    // tries so we don't busy-loop pause+skip forever. The short stays paused + muted.
    if (tries >= 4) reel.dataset.execGaveUp = '1';
  }

  function enforce() {
    try { enforceFeed(); } catch (_) {}
    try { enforceShorts(); } catch (_) {}
  }

  // ----------------------------------------------------------------- scan loop
  function scan() {
    if (!settings.enabled) return;
    try { injectShorts(); } catch (_) {}
    try { injectFeed(); } catch (_) {}
    ensureShortsObserver();
    enforce();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 200);
  }

  // Ignore mutations caused by our own injected UI so we don't re-trigger scans on
  // every button/toast write.
  function isOwnNode(n) {
    return n && n.nodeType === 1 && (
      (n.classList && (n.classList.contains(GROUP_CLASS) || n.classList.contains('exec-toast'))) ||
      (n.closest && n.closest('.' + GROUP_CLASS + ', .exec-toast'))
    );
  }

  function start() {
    EXEC.onBlocklistChanged = () => { mirrorBlocklist(); enforce(); scheduleScan(); };
    mirrorBlocklist();
    // Ask the interceptor (already loaded at document_start) to announce itself; its
    // own load-time EXEC_READY fired before our listener existed.
    try { window.postMessage({ __exec: 'EXEC_HELLO' }, '*'); } catch (_) {}
    scan();
    ['yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-start'].forEach((ev) =>
      document.addEventListener(ev, scheduleScan, true));
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (isOwnNode(r.target)) continue;
        let own = false;
        for (const n of r.addedNodes) { if (isOwnNode(n)) { own = true; break; } }
        if (own) continue;
        scheduleScan();
        return;
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 3000);
  }

  Promise.all([loadSettings(), blocklist.load()]).then(start);
})();

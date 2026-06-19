// util.js — DOM utilities: timing, text matching, element waiting, clicking, toasts.
// All DOM construction is Trusted-Types-safe (createElement / textContent / createElementNS),
// so it survives YouTube's `require-trusted-types-for 'script'` CSP.
(function () {
  'use strict';
  const EXEC = (window.__EXEC = window.__EXEC || {});
  const util = {};

  util.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  util.raf = () => new Promise((r) => requestAnimationFrame(() => r()));

  // Whitespace-normalize + lowercase for locale-tolerant matching.
  util.norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Does `text` contain any of the (normalized) labels?
  util.matchesAny = (text, labels) => {
    const t = util.norm(text);
    if (!t) return false;
    return labels.some((l) => t.includes(util.norm(l)));
  };

  // First element within `root` matching an ordered list of selectors.
  util.queryFirst = (root, selectors) => {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) { /* selector unsupported in this browser — skip */ }
    }
    return null;
  };

  // Poll a predicate (on a short interval) until it returns truthy or times out.
  // Resolves with the truthy value, or null on timeout.
  util.waitFor = (fn, { timeout = 2000, interval = 60 } = {}) =>
    new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        let v = null;
        try { v = fn(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (performance.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });

  // Wait for an element matching `selectors` (string or array) to exist under `root`.
  // Uses an immediate check, then a MutationObserver, always bounded by a timeout.
  util.waitForElement = (selectors, { root = document, timeout = 10000 } = {}) =>
    new Promise((resolve) => {
      const sels = Array.isArray(selectors) ? selectors : [selectors];
      const find = () => util.queryFirst(root === document ? document : root, sels);
      const existing = find();
      if (existing) return resolve(existing);
      let settled = false;
      const obs = new MutationObserver(() => {
        const el = find();
        if (el) { settled = true; obs.disconnect(); resolve(el); }
      });
      const target = root === document ? document.documentElement : root;
      obs.observe(target, { childList: true, subtree: true });
      setTimeout(() => { if (!settled) { obs.disconnect(); resolve(null); } }, timeout);
    });

  // Dispatch a realistic pointer/mouse sequence that results in exactly ONE click
  // activation (important — a double activation would toggle a like/dislike back off).
  util.clickSeq = (el) => {
    if (!el) return false;
    const o = { bubbles: true, cancelable: true, view: window };
    const po = Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, o);
    const fire = (Ctor, type, init) => { try { el.dispatchEvent(new Ctor(type, init)); } catch (_) {} };
    if (typeof PointerEvent === 'function') {
      fire(PointerEvent, 'pointerover', po);
      fire(PointerEvent, 'pointerdown', po);
    }
    fire(MouseEvent, 'mousedown', o);
    if (typeof PointerEvent === 'function') fire(PointerEvent, 'pointerup', po);
    fire(MouseEvent, 'mouseup', o);
    fire(MouseEvent, 'click', o);
    return true;
  };

  // Simulate hover so YouTube renders hover-gated controls (e.g. the feed three-dot button).
  util.hover = (el) => {
    if (!el) return;
    const o = { bubbles: true, cancelable: true, view: window };
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach((t) => {
      try {
        const E = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
        el.dispatchEvent(new E(t, o));
      } catch (_) {}
    });
  };

  // Small transient on-page toast for user feedback.
  let toastTimer = null;
  util.toast = (msg, kind = 'ok') => {
    try {
      let el = document.querySelector('.exec-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'exec-toast';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.setAttribute('data-kind', kind);
      el.classList.add('exec-toast-show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.classList.remove('exec-toast-show'); }, 2200);
    } catch (_) {}
  };

  // Is the element's vertical extent within the viewport? (used to pick the active short)
  util.isInViewport = (el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
    } catch (_) { return false; }
  };

  EXEC.util = util;
})();

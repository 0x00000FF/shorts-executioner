// youtube.js — YouTube-specific logic: find controls, open the overflow menu,
// pick the right item by text, and run the combined "nuke" sequence on one video.
(function () {
  'use strict';
  const EXEC = window.__EXEC;
  const { util, SEL, LABELS } = EXEC;
  const yt = {};

  // --- Dislike (Shorts rail) ---
  yt.findDislike = (scope) => util.queryFirst(scope, SEL.dislike);

  // Is a toggle already activated? Check the element and a few ancestors for aria-pressed.
  yt.isPressed = (el) => {
    if (!el) return false;
    // legacy toggle hosts carry aria-pressed on self or an ancestor
    let n = el;
    for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
      if (n.getAttribute && (n.getAttribute('aria-pressed') === 'true' || n.getAttribute('aria-selected') === 'true')) return true;
    }
    // modern dislike-button-view-model nests the pressed state on a DESCENDANT button
    try {
      if (el.querySelector('[aria-pressed="true"], [aria-selected="true"]')) return true;
    } catch (_) {}
    return false;
  };

  // --- Overflow menu ---
  yt.findMenuTrigger = (scope) => util.queryFirst(scope, SEL.menuTrigger);

  // Return the currently-open, positioned popup dropdown (the shared element is reused,
  // so we pick the one that is visible and laid out, not aria-hidden).
  yt.getOpenDropdown = () => {
    const dds = document.querySelectorAll(SEL.dropdown);
    for (const d of dds) {
      if (d.getAttribute('aria-hidden') === 'true') continue;
      const style = d.getAttribute('style') || '';
      const visible = d.offsetWidth > 0 && d.offsetHeight > 0;
      if (visible && /px/.test(style)) return d;
    }
    return null;
  };

  // Find a menu item whose text matches one of the label groups; return its clickable node.
  yt.findMenuItem = (dropdown, labels) => {
    const items = dropdown.querySelectorAll(SEL.menuItems);
    for (const it of items) {
      if (util.matchesAny(it.textContent, labels)) {
        return it.querySelector('tp-yt-paper-item, [role="menuitem"], yt-list-item-view-model, button, a') || it;
      }
    }
    return null;
  };

  // Open the overflow menu for a scope; resolve with the open dropdown (or null).
  yt.openMenu = async (scope, settings) => {
    // The dropdown is a single shared element reused across menus. If one is already open
    // (e.g. from a previous action), close it first so we don't read stale items.
    if (yt.getOpenDropdown()) {
      yt.closeMenu();
      await util.waitFor(() => !yt.getOpenDropdown(), { timeout: 400, interval: 50 });
    }
    if (!scope.isShorts) { util.hover(scope.root); await util.raf(); }
    const trigger = yt.findMenuTrigger(scope.root);
    if (!trigger) return null;
    util.clickSeq(trigger);
    // Let the shared dropdown reposition/repopulate before reading it.
    await util.raf();
    return util.waitFor(() => {
      const d = yt.getOpenDropdown();
      return d && d.querySelectorAll(SEL.menuItems).length > 0 ? d : null;
    }, { timeout: settings.menuTimeoutMs, interval: 60 });
  };

  yt.closeMenu = () => { try { document.body.click(); } catch (_) {} };

  // Apply ONE overflow-menu action. which = 'channel' (채널 추천 안함) | 'video' (관심 없음).
  // Returns true if an item was found and clicked.
  yt.applyMenuAction = async (scope, which, settings) => {
    const labels = which === 'channel' ? LABELS.dontRecommendChannel : LABELS.notInterested;
    const dd = await yt.openMenu(scope, settings);
    if (!dd) return false;
    const item = yt.findMenuItem(dd, labels);
    if (!item) { yt.closeMenu(); return false; }
    util.clickSeq(item);
    return true;
  };

  // Run the full combined action on one video.
  // scope = { root: <reel renderer | feed card>, isShorts: boolean }
  // Returns an array of human-readable actions that were applied.
  yt.nuke = async (scope, settings) => {
    const { root, isShorts } = scope;
    const did = [];

    // 1) 싫어요 — Shorts only (feed cards have no inline dislike). Non-destructive, do first.
    if (settings.alsoDislike && isShorts) {
      const dis = yt.findDislike(root);
      if (dis && !yt.isPressed(dis)) {
        util.clickSeq(dis);
        did.push('싫어요');
        await util.sleep(settings.throttleMs);
      }
    }

    // 2) Overflow-menu action(s). Each menu click dismisses/replaces the item, so at most one
    //    action survives per card on the feed. Order 'channel' first: it's the strongest signal
    //    (channel-level block) and is the one that "wins" when only one is possible.
    const order = settings.menuAction === 'video' ? ['video']
      : settings.menuAction === 'channel' ? ['channel']
        : ['channel', 'video'];

    for (const which of order) {
      if (!root.isConnected) break; // item was removed (typical on feed) → stop
      const ok = await yt.applyMenuAction(scope, which, settings);
      if (ok) did.push(which === 'channel' ? '채널 추천 안함' : '관심 없음');
      await util.sleep(settings.throttleMs);
    }

    return did;
  };

  // ---- channel identity (DOM) ----
  yt.isShortsPage = () => location.pathname.startsWith('/shorts');

  // Extract { id, handle, name } from a card / reel / owner scope.
  // Reads LIVE DOM (never cache — Polymer reuses card nodes for different videos).
  yt.extractChannel = (scope) => {
    if (!scope) return null;
    let id = null, handle = null, name = null;

    // Resolve id AND handle from the SAME byline/owner anchor so they can't disagree
    // (a search-result description can contain links to OTHER channels). Scope to the
    // owner element first; fall back to a card-wide query only if there's no owner element.
    const owner = scope.querySelector(
      '.ytReelChannelBarViewModel, ytd-channel-name, #channel-name, #channel-info, ytd-video-owner-renderer, reel-player-header-renderer'
    ) || scope;
    const link = owner.querySelector('a[href*="/channel/UC"], a[href*="/@"]') ||
      scope.querySelector('a[href*="/channel/UC"], a[href*="/@"]');
    if (link) {
      const href = link.pathname || link.getAttribute('href') || '';
      const mi = /\/channel\/(UC[0-9A-Za-z_-]{22})/.exec(href);
      if (mi) id = mi[1];
      const mh = /\/@([^/?#]+)/.exec(href);
      if (mh) { try { handle = decodeURIComponent(mh[1]); } catch (_) { handle = mh[1]; } }
    }

    const nameEl = scope.querySelector(
      '.ytReelChannelBarViewModelChannelName, ytd-channel-name #text, ytd-channel-name yt-formatted-string, #channel-name a, ytd-channel-name a'
    );
    if (nameEl) name = (nameEl.textContent || '').trim();
    if (!name && link) name = (link.textContent || '').trim();

    if (!id && !handle && !name) return null;
    return { id, handle, name: name || null };
  };

  // ---- shorts navigation ----
  yt.getActiveReel = () =>
    document.querySelector('ytd-reel-video-renderer[is-active]') ||
    [].slice.call(document.querySelectorAll('ytd-reel-video-renderer')).find((r) => util.isInViewport(r)) ||
    null;

  yt.getActiveVideo = (reel) =>
    (reel && reel.querySelector('video')) ||
    document.querySelector('#shorts-player video') ||
    document.querySelector('video.html5-main-video');

  yt.pauseActiveVideo = (reel) => {
    const v = yt.getActiveVideo(reel);
    if (v) { try { v.pause(); v.muted = true; } catch (_) {} }
  };

  // Advance to the next short. Button click is the most reliable; scroll / keyboard fallback.
  // Returns true only for the reliable button path; scroll/keyboard are best-effort
  // fallbacks that report false so callers don't assume they advanced.
  yt.goNextShort = () => {
    const btn = document.querySelector('#navigation-button-down button') ||
      document.querySelector('#navigation-button-down');
    if (btn) { util.clickSeq(btn); return true; }
    const sc = document.getElementById('shorts-container');
    if (sc) { try { sc.scrollBy(0, window.innerHeight || 800); } catch (_) {} }
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true,
      }));
    } catch (_) {}
    return false;
  };

  EXEC.yt = yt;
})();

// config.js — shared constants: default settings, localized labels, selectors.
// Loaded first; everything hangs off the shared isolated-world namespace `window.__EXEC`.
(function () {
  'use strict';
  const EXEC = (window.__EXEC = window.__EXEC || {});

  // ---- Default user settings (overridable from the popup via chrome.storage.sync) ----
  EXEC.DEFAULTS = {
    enabled: true,        // master on/off
    onShorts: true,       // inject the button on the Shorts player action rail
    onFeed: true,         // inject the button on feed / recommendation thumbnails
    alsoDislike: true,    // also press 싫어요 (Shorts only — feed cards have no dislike control)
    menuAction: 'both',   // which overflow-menu action(s): 'both' | 'channel' | 'video'
    throttleMs: 250,      // delay between sub-actions; avoids YouTube's '금지된 작업입니다' rate-limit
    menuTimeoutMs: 1500,  // max wait for the overflow-menu popup to open

    // ---- channel block (extension-managed blocklist) ----
    blockChannel: true,   // show the "채널 영구 차단" button
    autoSkipShorts: true, // auto-advance Shorts from blocked channels (before they play)
    hideBlockedFeed: true, // hide blocked channels' cards in feeds/search/sidebar
  };

  // ---- Localized substring labels for matching menu items ----
  // Matching is whitespace-normalized + lowercased + substring. If your UI language's
  // menu items aren't being detected, add the exact visible strings here.
  EXEC.LABELS = {
    dislike: [
      'dislike', '싫어요',
      '低く評価', '不喜欢', 'no me gusta', "je n'aime pas", 'mag ich nicht', 'não gostei',
    ],
    notInterested: [
      'not interested', '관심 없음', '관심없음',
      '興味なし', '不感兴趣', '不感興趣', 'no me interesa', 'pas intéressé',
      'kein interesse', 'não tenho interesse',
    ],
    dontRecommendChannel: [
      "don't recommend channel", '채널 추천 안함', '채널 추천 안 함',
      'このチャンネルをおすすめに表示しない', '不推荐此频道', '不推薦這個頻道',
      'no recomendar el canal', 'no recomendar este canal',
      'ne plus recommander cette chaîne', 'kanal nicht mehr empfehlen',
      'não recomendar o canal',
    ],
  };

  // ---- Selectors ----
  // STABLE anchors only: ids (#...) and custom-element tag names. We intentionally avoid
  // auto-generated classes (yt-spec-button-shape-next__*) and :nth-child positions.
  EXEC.SEL = {
    // Shorts player: each visible short is its own renderer with its own action rail.
    shortsReel: 'ytd-reel-video-renderer',
    shortsRail: 'reel-action-bar-view-model, #actions',

    // Feed / recommendation cards. Each card gets its own button, scoped to that card.
    feedCards: [
      'ytd-rich-item-renderer',     // home grid
      'ytd-video-renderer',         // search / subscriptions list
      'ytd-compact-video-renderer', // watch-page sidebar (related)
      'ytd-grid-video-renderer',    // channel grids
    ].join(','),
    feedThumb: 'ytd-thumbnail, a#thumbnail, #thumbnail',

    // Dislike control (search WITHIN a scope: a short renderer). Ordered by reliability.
    dislike: [
      '#dislike-button',
      'dislike-button-view-model button',
      '#segmented-dislike-button',
      'ytd-toggle-button-renderer#dislike-button',
      'tp-yt-paper-button#button[aria-pressed]',
    ],

    // Three-dot "more actions" trigger (search WITHIN a scope). aria-labels are locale-specific.
    menuTrigger: [
      'ytd-menu-renderer yt-icon-button#button button',
      'ytd-menu-renderer yt-icon-button#button',
      'button[aria-label="More actions"]',
      'button[aria-label="Action menu"]',
      'button[aria-label="작업 메뉴"]',
      'button[aria-label="추가 작업"]',
      'button[aria-label="기타 작업"]',
      'button[aria-label="더보기"]',
      'button[aria-label="더 보기"]',
      'button[aria-label="More"]',
      'ytd-menu-renderer button',
    ],

    // The shared overflow popup (rendered once at document level and reused).
    dropdown: 'tp-yt-iron-dropdown',
    // Menu item elements (legacy renderer + modern sheet view-model).
    menuItems: 'ytd-menu-service-item-renderer, yt-list-item-view-model',
  };
})();

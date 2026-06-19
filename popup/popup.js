// popup.js — settings form (chrome.storage.sync) + blocked-channels manager (chrome.storage.local).
'use strict';

const DEFAULTS = {
  enabled: true,
  onShorts: true,
  onFeed: true,
  alsoDislike: true,
  menuAction: 'both',
  throttleMs: 250,
  menuTimeoutMs: 1500,
  blockChannel: true,
  autoSkipShorts: true,
  hideBlockedFeed: true,
};

const BL_KEY = 'blockedChannels';
const CHECKBOXES = ['enabled', 'onShorts', 'onFeed', 'alsoDislike', 'blockChannel', 'autoSkipShorts', 'hideBlockedFeed'];

const statusEl = document.getElementById('status');
let statusTimer = null;
function flash(msg) {
  statusEl.textContent = msg;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 1200);
}

// ---- settings ----
function loadSettings() {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    const v = { ...DEFAULTS, ...(s || {}) };
    CHECKBOXES.forEach((k) => { const el = document.getElementById(k); if (el) el.checked = !!v[k]; });
    document.getElementById('menuAction').value = v.menuAction;
    document.getElementById('throttleMs').value = v.throttleMs;
  });
}
function save(patch) { chrome.storage.sync.set(patch, () => flash('저장됨')); }

CHECKBOXES.forEach((k) => {
  const el = document.getElementById(k);
  if (el) el.addEventListener('change', (e) => save({ [k]: e.target.checked }));
});
document.getElementById('menuAction').addEventListener('change', (e) => save({ menuAction: e.target.value }));
document.getElementById('throttleMs').addEventListener('change', (e) => {
  let n = parseInt(e.target.value, 10);
  if (Number.isNaN(n)) n = DEFAULTS.throttleMs;
  n = Math.max(0, Math.min(2000, n));
  e.target.value = n;
  save({ throttleMs: n });
});

// ---- blocklist ----
const listEl = document.getElementById('blList');
const countEl = document.getElementById('blCount');
const emptyEl = document.getElementById('blEmpty');

function entryLabels(e) {
  const primary = e.name || (e.handle ? '@' + e.handle : '') || e.id || '(알 수 없음)';
  const subParts = [];
  if (e.handle) subParts.push('@' + e.handle);
  if (e.id) subParts.push(e.id);
  return { primary, sub: subParts.join('  ·  ') };
}

function renderList(entries) {
  listEl.textContent = '';
  countEl.textContent = String(entries.length);
  emptyEl.style.display = entries.length ? 'none' : '';
  entries.forEach((e, i) => {
    const li = document.createElement('li');

    const text = document.createElement('div');
    text.className = 'ch-text';
    const nm = document.createElement('div');
    nm.className = 'ch-name';
    const labels = entryLabels(e);
    nm.textContent = labels.primary;
    text.appendChild(nm);
    if (labels.sub) {
      const sub = document.createElement('div');
      sub.className = 'ch-sub';
      sub.textContent = labels.sub;
      text.appendChild(sub);
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '×';
    rm.title = '차단 해제';
    rm.addEventListener('click', () => removeAt(i));

    li.appendChild(text);
    li.appendChild(rm);
    listEl.appendChild(li);
  });
}

function loadList() {
  chrome.storage.local.get({ [BL_KEY]: [] }, (got) => {
    const entries = Array.isArray(got && got[BL_KEY]) ? got[BL_KEY] : [];
    renderList(entries);
  });
}

function removeAt(index) {
  chrome.storage.local.get({ [BL_KEY]: [] }, (got) => {
    const entries = Array.isArray(got && got[BL_KEY]) ? got[BL_KEY] : [];
    entries.splice(index, 1);
    chrome.storage.local.set({ [BL_KEY]: entries }, () => { flash('차단 해제됨'); });
  });
}

document.getElementById('blClear').addEventListener('click', () => {
  chrome.storage.local.set({ [BL_KEY]: [] }, () => flash('전체 차단 해제됨'));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[BL_KEY]) renderList(changes[BL_KEY].newValue || []);
});

// init
loadSettings();
loadList();

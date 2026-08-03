'use strict';

// The transcript card shown in the bottom-left corner once a dictation
// finishes. It exists for apps ColdVoice cannot type into: the full text is
// right there with Copy, Edit, Open and close, and a draining bar showing how
// long it has left. Frameless, always-on-top and normally non-focusable like
// the pill, so its clicks come from the global mouse poller — except in edit
// mode, where the window is made focusable so the user can actually type.

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { log } = require('./log');

let win = null;
let loaded = false;
let current = null;
let editing = false;
let tickTimer = null;
let remaining = 0;
let lastTick = 0;
let topTimer = null;

const WIDTH = 360;
const MIN_HEIGHT = 168;
const MAX_HEIGHT = 420;
// Everything around the transcript panel: 36px above it, 88px of button rows
// and timer bar below, plus its 1px borders. The reported height already
// includes the panel's own padding. Kept in step with preview.css.
const CHROME_HEIGHT = 126;
const MARGIN = 20;
const DISMISS_MS = 5000;
const TICK_MS = 100;

// Click zones in CSS pixels. X is measured from the left edge; Y is measured
// from whichever edge the control is pinned to, because the card grows
// downward-anchored to fit the transcript.
const BUTTONS = [
  { id: 'close', x0: 322, x1: 350, fromTop: [4, 34] },
  { id: 'copy', x0: 10, x1: 178, fromBottom: [48, 80] },
  { id: 'edit', x0: 182, x1: 350, fromBottom: [48, 80] },
  { id: 'open', x0: 10, x1: 350, fromBottom: [10, 42] },
];

function ensure() {
  if (win && !win.isDestroyed()) return win;
  loaded = false;
  win = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: '#101116',
    hasShadow: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const w = win;
  w.webContents.on('did-finish-load', () => {
    if (win !== w) return;
    loaded = true;
    if (current) w.webContents.send('preview:show', current);
  });
  w.webContents.on('render-process-gone', (_e, details) => {
    log(`preview: renderer gone (${details && details.reason})`);
    if (win === w) { win = null; loaded = false; }
    try { w.destroy(); } catch {}
  });
  w.on('closed', () => {
    if (win === w) { win = null; loaded = false; }
  });
  w.webContents.on('did-fail-load', (_e, code, desc) => log(`preview: did-fail-load ${code} ${desc}`));
  w.loadFile(path.join(__dirname, '..', 'renderer', 'preview.html'));
  return win;
}

// Always anchored to the bottom-right corner, so growing the card pushes its
// top edge up instead of walking it off the screen.
function place(height) {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: wa.x + wa.width - WIDTH - MARGIN,
    y: wa.y + wa.height - height - MARGIN,
    width: WIDTH,
    height,
  });
}

// The renderer measures the laid-out transcript and asks for the height that
// shows all of it; anything past MAX_HEIGHT scrolls inside the card.
function resize(contentHeight) {
  if (!isVisible()) return;
  const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(contentHeight) + CHROME_HEIGHT));
  if (h === win.getBounds().height) return;
  place(h);
}

function stopCountdown() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

// Drains the bar in real time. Hovering the card holds it, so the buttons stay
// reachable instead of vanishing mid-click.
function startCountdown() {
  stopCountdown();
  remaining = DISMISS_MS;
  lastTick = Date.now();
  send('preview:tick', { remaining, total: DISMISS_MS });
  tickTimer = setInterval(() => {
    if (!isVisible()) { stopCountdown(); return; }
    const now = Date.now();
    const delta = now - lastTick;
    lastTick = now;
    if (editing || hitTest()) return;
    remaining = Math.max(0, remaining - delta);
    send('preview:tick', { remaining, total: DISMISS_MS });
    if (remaining === 0) hide();
  }, TICK_MS);
}

function show({ text = '', id = null } = {}) {
  const body = String(text || '').trim();
  if (!body) return;
  const w = ensure();
  editing = false;
  current = { text: body, id, words: body.split(/\s+/).filter(Boolean).length };
  place(MIN_HEIGHT);
  if (loaded) w.webContents.send('preview:show', current);
  w.showInactive();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.moveTop();
  if (topTimer) clearInterval(topTimer);
  let bursts = 0;
  topTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || ++bursts > 8) {
      clearInterval(topTimer);
      topTimer = null;
      return;
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }, 200);
  startCountdown();
  log(`preview: shown (${current.words} words)`);
}

function isVisible() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

function isEditing() {
  return editing && isVisible();
}

function currentText() {
  return current ? current.text : '';
}

function currentId() {
  return current ? current.id : null;
}

// True when the cursor is anywhere over the card, buttons included.
function hitTest() {
  if (!isVisible()) return false;
  const b = win.getBounds();
  const c = screen.getCursorScreenPoint();
  return c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;
}

// Which button (if any) the cursor is over right now.
function buttonAtCursor() {
  if (!isVisible()) return null;
  const b = win.getBounds();
  const c = screen.getCursorScreenPoint();
  if (c.x < b.x || c.x >= b.x + b.width || c.y < b.y || c.y >= b.y + b.height) return null;
  const cssX = c.x - b.x;
  const fromTop = c.y - b.y;
  const fromBottom = b.y + b.height - c.y;
  for (const btn of BUTTONS) {
    if (cssX < btn.x0 || cssX >= btn.x1) continue;
    const [lo, hi] = btn.fromTop || btn.fromBottom;
    const y = btn.fromTop ? fromTop : fromBottom;
    if (y >= lo && y < hi) return btn.id;
  }
  return null;
}

// Editing needs real keyboard focus, which a focusable:false window never
// gets. Flip it for the duration of the edit and flip it straight back, so the
// card goes back to never stealing focus from the field being dictated into.
function beginEdit() {
  if (!isVisible() || editing) return;
  editing = true;
  stopCountdown();
  try {
    win.setFocusable(true);
    win.show();
    win.focus();
  } catch (e) {
    log('preview: focus for edit failed:', e && e.message);
  }
  send('preview:mode', { mode: 'edit' });
}

function endEdit() {
  if (!editing) return;
  editing = false;
  try {
    win.blur();
    win.setFocusable(false);
  } catch { /* ignore */ }
  send('preview:mode', { mode: 'view' });
  if (isVisible()) startCountdown();
}

// Accept edited text from the renderer, so Copy and the paste shortcut hand
// back what the user actually meant to say.
function applyEdit(text) {
  const body = String(text || '').trim();
  if (!body || !current) return null;
  current = { ...current, text: body, words: body.split(/\s+/).filter(Boolean).length };
  send('preview:show', current);
  return current;
}

// Flash the Copy button's confirmation and let the bar keep draining.
function copied() {
  if (!isVisible()) return;
  send('preview:copied');
}

function send(channel, payload) {
  if (!win || win.isDestroyed() || !loaded) return;
  win.webContents.send(channel, payload);
}

function hide() {
  stopCountdown();
  if (editing) {
    editing = false;
    try { win.blur(); win.setFocusable(false); } catch { /* ignore */ }
  }
  current = null;
  if (topTimer) { clearInterval(topTimer); topTimer = null; }
  if (win && !win.isDestroyed()) win.hide();
}

module.exports = {
  show, hide, ensure, isVisible, isEditing, hitTest, buttonAtCursor,
  copied, currentText, currentId, resize, beginEdit, endEdit, applyEdit,
};

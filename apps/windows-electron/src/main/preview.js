'use strict';

// The transcript preview card shown in the bottom-left corner once a dictation
// finishes. It exists for apps ColdVoice cannot type into: the text is right
// there with a Copy button, an Open button for the main window, and a close X.
// Frameless, always-on-top and non-focusable like the pill and the alert, so
// its clicks come from the global mouse poller, not from DOM handlers.

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { log } = require('./log');

let win = null;
let loaded = false;
let lastPayload = null;
let hideTimer = null;
let topTimer = null;

const WIDTH = 340;
const HEIGHT = 152;
const MARGIN = 18;
const DEFAULT_TIMEOUT = 14000;

// Click zones in unscaled CSS pixels, mirroring the absolute layout in
// preview.css. Main hit-tests the press position against these instead.
const BUTTONS = [
  { id: 'close', x0: 298, x1: 334, y0: 6, y1: 38 },
  { id: 'copy', x0: 14, x1: 96, y0: 114, y1: 144 },
  { id: 'open', x0: 100, x1: 222, y0: 114, y1: 144 },
];

function ensure() {
  if (win && !win.isDestroyed()) return win;
  loaded = false;
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: '#09090b',
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
    if (lastPayload) w.webContents.send('preview:show', lastPayload);
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

function position() {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: wa.x + MARGIN,
    y: wa.y + wa.height - HEIGHT - MARGIN,
    width: WIDTH,
    height: HEIGHT,
  });
}

function show({ text = '', timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const body = String(text || '').trim();
  if (!body) return;
  const w = ensure();
  lastPayload = { text: body, words: body.split(/\s+/).filter(Boolean).length };
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  position();
  if (loaded) w.webContents.send('preview:show', lastPayload);
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
  hideTimer = setTimeout(hide, timeoutMs);
  log(`preview: shown (${lastPayload.words} words)`);
}

function isVisible() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

function currentText() {
  return lastPayload ? lastPayload.text : '';
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
  const cssX = ((c.x - b.x) / b.width) * WIDTH;
  const cssY = ((c.y - b.y) / b.height) * HEIGHT;
  for (const btn of BUTTONS) {
    if (cssX >= btn.x0 && cssX < btn.x1 && cssY >= btn.y0 && cssY < btn.y1) return btn.id;
  }
  return null;
}

// Flash the Copy button's confirmation and keep the card up a little longer.
function copied() {
  if (!isVisible()) return;
  if (loaded) win.webContents.send('preview:copied');
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 3000);
}

function hide() {
  lastPayload = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (topTimer) { clearInterval(topTimer); topTimer = null; }
  if (win && !win.isDestroyed()) win.hide();
}

module.exports = { show, hide, ensure, isVisible, hitTest, buttonAtCursor, copied, currentText };

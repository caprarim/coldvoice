'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { log } = require('./log');

let win = null;
let loaded = false;
let lastPayload = null;
let hideTimer = null;
let topTimer = null;
let sticky = false;

const WIDTH = 420;
const HEIGHT = 96;

function ensure() {
  if (win && !win.isDestroyed()) return win;
  loaded = false;
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: '#17181d',
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
    if (lastPayload) w.webContents.send('alert:show', lastPayload);
  });
  w.webContents.on('render-process-gone', (_e, details) => {
    log(`alert: renderer gone (${details && details.reason})`);
    if (win === w) { win = null; loaded = false; }
    try { w.destroy(); } catch {}
  });
  w.on('closed', () => {
    if (win === w) { win = null; loaded = false; }
  });
  w.webContents.on('did-fail-load', (_e, code, desc) => log(`alert: did-fail-load ${code} ${desc}`));
  w.loadFile(path.join(__dirname, '..', 'renderer', 'alert.html'));
  return win;
}

function position() {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: Math.round(wa.x + wa.width / 2 - WIDTH / 2),
    y: wa.y + 18,
    width: WIDTH,
    height: HEIGHT,
  });
}

function show({ kind = 'disconnect', title = '', message = '', sticky: stick = false, timeoutMs = 5000 } = {}) {
  const w = ensure();
  lastPayload = { kind, title, message };
  sticky = stick;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  position();
  if (loaded) w.webContents.send('alert:show', lastPayload);
  w.showInactive();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.moveTop();
  if (topTimer) clearInterval(topTimer);
  let bursts = 0;
  topTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || ++bursts > 10) {
      clearInterval(topTimer);
      topTimer = null;
      return;
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }, 300);
  if (!stick) hideTimer = setTimeout(hide, timeoutMs);
  log(`alert: show ${kind} "${title}"`);
}

// True when the cursor is over the alert at all (the X button included).
// Renderer clicks are unreliable on this non-focusable window, so dismissal
// rides the global mouse poller exactly like the pill's drag does.
function hitTest() {
  if (!win || win.isDestroyed() || !win.isVisible()) return false;
  const b = win.getBounds();
  const c = screen.getCursorScreenPoint();
  return c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;
}

function isVisible() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

function hide() {
  sticky = false;
  lastPayload = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (topTimer) { clearInterval(topTimer); topTimer = null; }
  if (win && !win.isDestroyed()) win.hide();
}

module.exports = { show, hide, ensure, hitTest, isVisible };

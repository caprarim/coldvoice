'use strict';

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { log } = require('./log');

let win = null;
let loaded = false;
let lastPayload = null;
let hideTimer = null;
let topTimer = null;

const WIDTH = 460;
const HEIGHT = 92;
const TOP_MARGIN = 22;

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
    if (lastPayload) w.webContents.send('notice:show', lastPayload);
  });
  w.webContents.on('render-process-gone', (_e, details) => {
    log(`notice: renderer gone (${details && details.reason})`);
    if (win === w) { win = null; loaded = false; }
    try { w.destroy(); } catch {}
  });
  w.on('closed', () => {
    if (win === w) { win = null; loaded = false; }
  });
  w.webContents.on('did-fail-load', (_e, code, desc) => log(`notice: did-fail-load ${code} ${desc}`));
  w.loadFile(path.join(__dirname, '..', 'renderer', 'notice.html'));
  return win;
}

function position() {
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setBounds({
    x: Math.round(wa.x + wa.width / 2 - WIDTH / 2),
    y: wa.y + TOP_MARGIN,
    width: WIDTH,
    height: HEIGHT,
  });
}

function show({ kind = 'started', title = '', message = '', timeoutMs = 2200 } = {}) {
  const w = ensure();
  lastPayload = { kind, title, message };
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  position();
  if (loaded) w.webContents.send('notice:show', lastPayload);
  w.showInactive();
  w.setAlwaysOnTop(true, 'screen-saver');
  w.moveTop();
  if (topTimer) clearInterval(topTimer);
  let bursts = 0;
  topTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible() || ++bursts > 6) {
      clearInterval(topTimer);
      topTimer = null;
      return;
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  }, 180);
  hideTimer = setTimeout(hide, timeoutMs);
  log(`notice: ${kind} "${title}"`);
}

function isVisible() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

function bottom() {
  if (!isVisible()) return null;
  const b = win.getBounds();
  return b.y + b.height;
}

function hide() {
  lastPayload = null;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (topTimer) { clearInterval(topTimer); topTimer = null; }
  if (win && !win.isDestroyed()) win.hide();
}

module.exports = { show, hide, ensure, isVisible, bottom, HEIGHT };

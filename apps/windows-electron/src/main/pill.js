'use strict';

// The floating dark rounded pill shown during dictation — small and clean, in
// the style of Wispr Flow's flow bar. Frameless, always-on-top, non-focusable
// (so it never steals focus from the target field). It sits in one fixed spot
// (bottom-center by default) and never jumps around while dictating; the user
// can drag it anywhere and that position is remembered.

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const db = require('./db');
const { log } = require('./log');

let pill = null;

const WIDTH = 150;
const HEIGHT = 30;

function ensure() {
  if (pill && !pill.isDestroyed()) return pill;
  // Opaque window: transparent overlays do not reliably paint on Windows, so we
  // use a solid dark frameless window (Win11 rounds the corners automatically).
  pill = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: false,
    backgroundColor: '#101114',
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
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pill.setIgnoreMouseEvents(false);
  pill.webContents.on('did-fail-load', (_e, code, desc) => log(`pill: did-fail-load ${code} ${desc}`));
  pill.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html'));
  return pill;
}

// Keep a top-left corner inside the work area of whatever display it is on.
function clampToScreen(x, y) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  return {
    x: Math.round(Math.max(d.x, Math.min(x, d.x + d.width - WIDTH))),
    y: Math.round(Math.max(d.y, Math.min(y, d.y + d.height - HEIGHT))),
  };
}

// The remembered drag position, if any; otherwise null.
function savedPosition() {
  const x = parseInt(db.getSetting('pill.posX', ''), 10);
  const y = parseInt(db.getSetting('pill.posY', ''), 10);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return null;
}

// Always place the pill at its fixed spot: the user's dragged position if set,
// else bottom-center of the primary display. Never follows the focused field.
function positionFixed() {
  const p = ensure();
  const saved = savedPosition();
  let x;
  let y;
  if (saved) {
    ({ x, y } = clampToScreen(saved.x, saved.y));
  } else {
    const primary = screen.getPrimaryDisplay().workArea;
    x = Math.round(primary.x + primary.width / 2 - WIDTH / 2);
    y = primary.y + primary.height - HEIGHT - 14;
  }
  p.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

// Console windows (conhost / Windows Terminal) repaint over a non-focusable
// overlay shortly after it appears. Strategy: burst moveTop() for the first 2s
// after show (handles terminal repaint), then drop to setAlwaysOnTop-only
// reassertion (no flicker).
let burstTimer = null;
let sustainTimer = null;
let burstCount = 0;
const BURST_INTERVAL = 200;
const BURST_MAX = 10;
const SUSTAIN_INTERVAL = 1500;

function startKeepOnTop() {
  stopKeepOnTop();
  burstCount = 0;
  burstTimer = setInterval(() => {
    if (!pill || pill.isDestroyed() || !pill.isVisible()) { stopKeepOnTop(); return; }
    pill.setAlwaysOnTop(true, 'screen-saver');
    pill.moveTop();
    burstCount++;
    if (burstCount >= BURST_MAX) {
      clearInterval(burstTimer);
      burstTimer = null;
      sustainTimer = setInterval(() => {
        if (!pill || pill.isDestroyed() || !pill.isVisible()) { stopKeepOnTop(); return; }
        pill.setAlwaysOnTop(true, 'screen-saver');
      }, SUSTAIN_INTERVAL);
    }
  }, BURST_INTERVAL);
}

function stopKeepOnTop() {
  if (burstTimer) { clearInterval(burstTimer); burstTimer = null; }
  if (sustainTimer) { clearInterval(sustainTimer); sustainTimer = null; }
}

function show() {
  const p = ensure();
  if (!p.isVisible()) positionFixed();
  p.setOpacity(1);
  p.showInactive();
  p.setAlwaysOnTop(true, 'screen-saver');
  p.moveTop();
  startKeepOnTop();
}

function showIdle() {
  show();
}

// --- dragging --------------------------------------------------------------
// Manual drag driven by pointer events in the renderer: the start bounds are
// captured, then each move applies a screen-space delta. The final position is
// persisted so the bar reappears where the user left it.
let dragStart = null;

function dragBegin() {
  if (pill && !pill.isDestroyed()) dragStart = pill.getBounds();
}

function dragMove(dx, dy) {
  if (!dragStart || !pill || pill.isDestroyed()) return;
  const { x, y } = clampToScreen(dragStart.x + dx, dragStart.y + dy);
  pill.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function dragEnd() {
  if (!dragStart || !pill || pill.isDestroyed()) { dragStart = null; return; }
  const b = pill.getBounds();
  db.setSetting('pill.posX', String(b.x));
  db.setSetting('pill.posY', String(b.y));
  dragStart = null;
}

function hide() {
  stopKeepOnTop();
  if (pill && !pill.isDestroyed()) pill.hide();
}

function send(channel, payload) {
  if (pill && !pill.isDestroyed()) pill.webContents.send(channel, payload);
}

module.exports = { show, showIdle, hide, dragBegin, dragMove, dragEnd, send, ensure };

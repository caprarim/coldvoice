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

const WIDTH = 138;
const HEIGHT = 22;
const PILL_OPACITY = 0.85;
const SCALE_MIN = 0.6;
const SCALE_MAX = 4;
const CORNER_MIN_PX = 14;

let loaded = false;
let lastState = null;
let scale = null;

// Click zones in unscaled CSS pixels, mirroring the flex layout in pill.css
// (3px padding, 4px gaps, 16px round buttons: cancel | bars | pause | confirm).
// Because the window is non-focusable, DOM click handlers never fire on it —
// main hit-tests the press position against these zones instead and drives the
// actions itself.
const BUTTONS = [
  { id: 'cancel', x0: 0, x1: 21 },
  { id: 'pause', x0: 97, x1: 117 },
  { id: 'confirm', x0: 117, x1: WIDTH },
];

function clampScale(s) {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

function getScale() {
  if (scale === null) {
    const s = parseFloat(db.getSetting('pill.scale', '1'));
    scale = Number.isFinite(s) ? clampScale(s) : 1;
  }
  return scale;
}

function pillW() { return Math.round(WIDTH * getScale()); }
function pillH() { return Math.round(HEIGHT * getScale()); }

function cornerPx() {
  return Math.max(CORNER_MIN_PX, Math.round(WIDTH * getScale() * 0.18));
}

function applyScale(next) {
  scale = clampScale(next);
  if (pill && !pill.isDestroyed()) {
    try { pill.webContents.setZoomFactor(scale); } catch {}
  }
}

function ensure() {
  if (pill && !pill.isDestroyed()) return pill;
  loaded = false;
  // Opaque window: transparent overlays do not reliably paint on Windows, so we
  // use a solid dark frameless window (Win11 rounds the corners automatically).
  pill = new BrowserWindow({
    width: pillW(),
    height: pillH(),
    frame: false,
    transparent: false,
    backgroundColor: '#15161b',
    hasShadow: true,
    resizable: true,
    minWidth: Math.round(WIDTH * SCALE_MIN),
    minHeight: Math.round(HEIGHT * SCALE_MIN),
    maxWidth: Math.round(WIDTH * SCALE_MAX),
    maxHeight: Math.round(HEIGHT * SCALE_MAX),
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
  const win = pill;
  win.webContents.on('did-finish-load', () => {
    if (pill !== win) return;
    loaded = true;
    try { win.webContents.setZoomFactor(getScale()); } catch {}
    if (lastState) win.webContents.send('pill:state', lastState);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`pill: renderer gone (${details && details.reason})`);
    const wasVisible = !win.isDestroyed() && win.isVisible();
    if (pill === win) { pill = null; loaded = false; }
    try { win.destroy(); } catch {}
    if (wasVisible) show();
  });
  win.on('closed', () => {
    if (pill === win) { pill = null; loaded = false; }
  });
  pill.webContents.on('did-fail-load', (_e, code, desc) => log(`pill: did-fail-load ${code} ${desc}`));
  // The pill body is a native drag region (-webkit-app-region: drag), so the
  // OS moves the window itself. Persist wherever it lands (debounced; moves we
  // make programmatically are excluded via `positioning`).
  pill.on('move', () => {
    if (positioning || !pill || pill.isDestroyed() || !pill.isVisible()) return;
    if (moveSaveTimer) clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      moveSaveTimer = null;
      if (!pill || pill.isDestroyed()) return;
      const b = pill.getBounds();
      db.setSetting('pill.pos2X', String(b.x));
      db.setSetting('pill.pos2Y', String(b.y));
      log(`pill: position saved ${b.x},${b.y}`);
    }, 400);
  });
  pill.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html'));
  return pill;
}

let positioning = false;
let moveSaveTimer = null;

// Keep a top-left corner inside the work area of whatever display it is on.
function clampToScreen(x, y) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  return {
    x: Math.round(Math.max(d.x, Math.min(x, d.x + d.width - pillW()))),
    y: Math.round(Math.max(d.y, Math.min(y, d.y + d.height - pillH()))),
  };
}

// The remembered drag position, if any; otherwise null. The keys are
// versioned: positions saved before dragging worked were unreachable junk, so
// v2 ignores them and everyone starts back at bottom-center.
function savedPosition() {
  const x = parseInt(db.getSetting('pill.pos2X', ''), 10);
  const y = parseInt(db.getSetting('pill.pos2Y', ''), 10);
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
    x = Math.round(primary.x + primary.width / 2 - pillW() / 2);
    y = primary.y + primary.height - pillH() - 14;
  }
  positioning = true;
  p.setBounds({ x, y, width: pillW(), height: pillH() });
  setTimeout(() => { positioning = false; }, 100); // 'move' can arrive async
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
  p.setOpacity(PILL_OPACITY);
  p.showInactive();
  p.setAlwaysOnTop(true, 'screen-saver');
  p.moveTop();
  startKeepOnTop();
}

function showIdle() {
  show();
}

// --- dragging --------------------------------------------------------------
// Renderer mouse events are unreliable on this non-focusable window (and
// -webkit-app-region drag does not work on non-focusable windows at all), so
// dragging is driven ENTIRELY from the main process off the global mouse
// poller: a left-button DOWN anywhere on the pill starts tracking, and once the
// cursor moves past a tiny threshold the window is glued to the cursor until
// the global left-button UP. Presses that never move stay clicks (the buttons
// keep working); once a real drag engages, mouse events are ignored so the
// release can never fire a button underneath. The final position is persisted
// so the bar reappears where the user left it.
let dragTimer = null;
let dragOffset = null;

const DRAG_ENGAGE_PX = 4;
const DRAG_MAX_MS = 20000; // safety: never glue the window forever

// True when the cursor is over the pill at all (buttons included).
function hitTest() {
  if (!pill || pill.isDestroyed() || !pill.isVisible()) return false;
  const b = pill.getBounds();
  const c = screen.getCursorScreenPoint();
  return c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height;
}

// Which pill button (if any) a screen point lands on. Works at any scale
// because the window width always tracks WIDTH * scale.
function buttonAt(x, y) {
  if (!pill || pill.isDestroyed() || !pill.isVisible()) return null;
  const b = pill.getBounds();
  if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) return null;
  const cssX = ((x - b.x) / b.width) * WIDTH;
  for (const btn of BUTTONS) {
    if (cssX >= btn.x0 && cssX < btn.x1) return btn.id;
  }
  return null;
}

function cornerHit(b, c) {
  const grip = cornerPx();
  const gripY = Math.min(grip, Math.max(6, Math.round(b.height / 2)));
  const nearL = c.x - b.x <= grip;
  const nearR = b.x + b.width - c.x <= grip;
  const nearT = c.y - b.y <= gripY;
  const nearB = b.y + b.height - c.y <= gripY;
  if ((nearL || nearR) && (nearT || nearB)) return { left: nearL, top: nearT };
  return null;
}

function dragBegin() {
  if (dragTimer || dragOffset) { dragEnd(); return; }
  if (!pill || pill.isDestroyed() || !pill.isVisible()) return;
  const b = pill.getBounds();
  const c = screen.getCursorScreenPoint();
  const startedAt = Date.now();
  const corner = cornerHit(b, c);
  dragOffset = {
    dx: c.x - b.x, dy: c.y - b.y, startX: c.x, startY: c.y, engaged: false,
    corner, startBounds: b, startScale: getScale(), startDist: 0,
  };
  if (corner) {
    const ax = corner.left ? b.x + b.width : b.x;
    const ay = corner.top ? b.y + b.height : b.y;
    dragOffset.startDist = Math.max(1, Math.hypot(c.x - ax, c.y - ay));
  }
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!pill || pill.isDestroyed() || !pill.isVisible() || !dragOffset
        || Date.now() - startedAt > DRAG_MAX_MS) { dragEnd(); return; }
    const c2 = screen.getCursorScreenPoint();
    if (!dragOffset.engaged) {
      if (Math.abs(c2.x - dragOffset.startX) < DRAG_ENGAGE_PX
          && Math.abs(c2.y - dragOffset.startY) < DRAG_ENGAGE_PX) return;
      dragOffset.engaged = true;
      pill.setIgnoreMouseEvents(true);
      log(dragOffset.corner ? 'pill: resize engaged' : 'pill: drag engaged');
    }
    if (dragOffset.corner) {
      const b0 = dragOffset.startBounds;
      const anchorX = dragOffset.corner.left ? b0.x + b0.width : b0.x;
      const anchorY = dragOffset.corner.top ? b0.y + b0.height : b0.y;
      const dist = Math.hypot(c2.x - anchorX, c2.y - anchorY);
      const next = clampScale(dragOffset.startScale * (dist / dragOffset.startDist));
      applyScale(next);
      const w = pillW();
      const h = pillH();
      pill.setBounds({
        x: dragOffset.corner.left ? anchorX - w : anchorX,
        y: dragOffset.corner.top ? anchorY - h : anchorY,
        width: w,
        height: h,
      });
    } else {
      const { x, y } = clampToScreen(c2.x - dragOffset.dx, c2.y - dragOffset.dy);
      pill.setBounds({ x, y, width: pillW(), height: pillH() });
    }
  }, 16);
}

// Ends a press. Returns the button id when the press was a plain click on one
// of the pill's buttons (no drag engaged), so the caller can run its action.
function dragEnd() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  const press = dragOffset;
  const engaged = !!(press && press.engaged);
  const resized = !!(press && press.corner && press.engaged);
  dragOffset = null;
  if (!pill || pill.isDestroyed()) return null;
  pill.setIgnoreMouseEvents(false);
  if (!engaged) {
    if (!press) return null;
    // Require press and release to land on the same button, so a slide off the
    // button cancels it the way a normal click does.
    const down = buttonAt(press.startX, press.startY);
    if (!down) return null;
    const c = screen.getCursorScreenPoint();
    return buttonAt(c.x, c.y) === down ? down : null;
  }
  const b = pill.getBounds();
  db.setSetting('pill.pos2X', String(b.x));
  db.setSetting('pill.pos2Y', String(b.y));
  if (resized) db.setSetting('pill.scale', String(Math.round(getScale() * 100) / 100));
  log(`pill: drag ended at ${b.x},${b.y} scale ${getScale()}`);
  return null;
}

function hide() {
  stopKeepOnTop();
  if (pill && !pill.isDestroyed()) pill.hide();
}

function send(channel, payload) {
  if (channel === 'pill:state') lastState = payload;
  if (!pill || pill.isDestroyed() || !loaded) return;
  pill.webContents.send(channel, payload);
}

module.exports = { show, showIdle, hide, dragBegin, dragEnd, hitTest, buttonAt, send, ensure };

'use strict';

// The floating black rounded pill shown during dictation. Frameless,
// always-on-top, transparent, click-through-free. Positioned near the caret /
// focused window, with a top-center fallback.

const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { log } = require('./log');

let pill = null;

const WIDTH = 220;
const HEIGHT = 56;

function ensure() {
  if (pill && !pill.isDestroyed()) return pill;
  pill = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.webContents.on('did-finish-load', () => log('pill: did-finish-load'));
  pill.webContents.on('did-fail-load', (_e, code, desc) => log(`pill: did-fail-load ${code} ${desc}`));
  pill.webContents.on('render-process-gone', (_e, d) => log(`pill: render-process-gone ${JSON.stringify(d)}`));
  pill.loadFile(path.join(__dirname, '..', 'renderer', 'pill.html'));
  return pill;
}

// Place the pill near the target rectangle if available, else top-center.
function positionNear(rect) {
  const p = ensure();
  const primary = screen.getPrimaryDisplay().workArea;
  let x;
  let y;
  if (rect && rect.width >= 0 && (rect.x || rect.y)) {
    x = Math.round(rect.x + rect.width / 2 - WIDTH / 2);
    y = Math.round(rect.y - HEIGHT - 8);
    if (y < primary.y + 4) y = Math.round(rect.y + rect.height + 8);
  } else {
    x = Math.round(primary.x + primary.width / 2 - WIDTH / 2);
    y = primary.y + 24;
  }
  x = Math.max(primary.x + 4, Math.min(x, primary.x + primary.width - WIDTH - 4));
  p.setBounds({ x, y, width: WIDTH, height: HEIGHT });
}

function show(rect) {
  const p = ensure();
  positionNear(rect);
  p.setOpacity(1);
  p.showInactive();
  p.setAlwaysOnTop(true, 'screen-saver');
  log(`pill.show: visible=${p.isVisible()} bounds=${JSON.stringify(p.getBounds())} destroyed=${p.isDestroyed()}`);
}

// Move the pill to a new target rectangle while it is already visible.
function reposition(rect) {
  if (pill && !pill.isDestroyed() && pill.isVisible()) positionNear(rect);
}

function hide() {
  if (pill && !pill.isDestroyed()) pill.hide();
}

function send(channel, payload) {
  if (pill && !pill.isDestroyed()) pill.webContents.send(channel, payload);
}

module.exports = { show, hide, reposition, send, ensure };

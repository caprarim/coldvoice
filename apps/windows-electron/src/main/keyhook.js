'use strict';

// Global hold-to-dictate / toggle key detector. Wraps keyhook.ps1, which polls
// the physical key state so we get both key-DOWN and key-UP edges (Electron's
// globalShortcut gives down only). Emits clean onDown / onUp callbacks.

const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./log');

let proc = null;
let handlers = { onDown() {}, onUp() {} };

// Map an Electron-style accelerator ("Ctrl+1", "Ctrl+F1", "F1", "Alt+Shift+Z")
// to the set of Windows virtual-key codes that must all be held.
const NAMED = {
  CTRL: 0x11, CONTROL: 0x11, CMDORCTRL: 0x11, CONTROLORCMD: 0x11,
  ALT: 0x12, OPTION: 0x12, ALTGR: 0x12,
  SHIFT: 0x10,
  SPACE: 0x20, ENTER: 0x0d, RETURN: 0x0d, TAB: 0x09, ESC: 0x1b, ESCAPE: 0x1b,
};

function tokenToVk(tokenRaw) {
  const t = String(tokenRaw).trim().toUpperCase();
  if (!t) return null;
  if (NAMED[t] != null) return NAMED[t];
  let m = t.match(/^F([1-9]|1[0-9]|2[0-4])$/);
  if (m) return 0x70 + (parseInt(m[1], 10) - 1); // F1 = 0x70
  if (/^[0-9]$/.test(t)) return 0x30 + (t.charCodeAt(0) - 48); // '0' = 0x30
  if (/^[A-Z]$/.test(t)) return t.charCodeAt(0); // 'A' = 0x41
  return null;
}

function parseAccel(accel) {
  const vks = [];
  for (const part of String(accel || '').split('+')) {
    const vk = tokenToVk(part);
    if (vk != null && !vks.includes(vk)) vks.push(vk);
  }
  return vks;
}

function stop() {
  if (proc) {
    try { proc.kill(); } catch { /* ignore */ }
    proc = null;
  }
}

function start(accel, h) {
  stop();
  handlers = h || handlers;
  const vks = parseAccel(accel);
  if (!vks.length) {
    log(`keyhook: could not parse accelerator "${accel}"`);
    return;
  }
  const script = path.join(__dirname, 'keyhook.ps1');
  proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Vks', vks.join(',')],
    { windowsHide: true }
  );
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line === 'DOWN') handlers.onDown();
      else if (line === 'UP') handlers.onUp();
    }
  });
  proc.stderr.on('data', (d) => log('keyhook stderr:', d.toString().trim()));
  proc.on('exit', (code) => log(`keyhook exited (${code})`));
  log(`keyhook started for "${accel}" -> vks [${vks.join(',')}]`);
}

module.exports = { start, stop, parseAccel };

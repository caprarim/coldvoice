'use strict';

// Global hold-to-dictate / toggle key detector. Wraps keyhook.ps1, which polls
// the physical key state so we get both key-DOWN and key-UP edges (Electron's
// globalShortcut gives down only). Supports MULTIPLE chords at once (e.g. a
// hands-free toggle AND a hold-to-dictate chord live simultaneously). Emits
// clean onDown(id) / onUp(id) callbacks.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const { log } = require('./log');

let proc = null;
let handlers = { onDown() {}, onUp() {} };

// Map an Electron-style accelerator token to a Windows virtual-key code.
const NAMED = {
  CTRL: 0x11, CONTROL: 0x11, CMDORCTRL: 0x11, CONTROLORCMD: 0x11,
  ALT: 0x12, OPTION: 0x12, ALTGR: 0x12,
  SHIFT: 0x10,
  CAPS: 0x14, CAPSLOCK: 0x14,
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

function scriptPath(name) {
  const source = path.join(__dirname, name);
  if (!source.includes('.asar')) return source;
  const dir = path.join(app.getPath('userData'), 'runtime-scripts');
  const target = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(source));
    return target;
  } catch (e) {
    log(`keyhook: failed to materialize ${name}:`, e && e.message);
    return source;
  }
}

// chords: array of { id, accel }  e.g. [{id:'toggle',accel:'Ctrl+1'},{id:'hold',accel:'Ctrl+CapsLock'}]
// h: { onDown(id), onUp(id) }
function start(chords, h) {
  stop();
  handlers = h || handlers;
  const specs = [];
  for (const c of chords || []) {
    const vks = parseAccel(c.accel);
    if (vks.length) specs.push(`${c.id}:${vks.join(',')}`);
    else log(`keyhook: could not parse accelerator "${c.accel}" for ${c.id}`);
  }
  if (!specs.length) {
    log('keyhook: no parseable chords');
    return;
  }
  const script = scriptPath('keyhook.ps1');
  proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Chords', specs.join(';')],
    { windowsHide: true }
  );
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const idx = line.indexOf(':');
      const edge = idx >= 0 ? line.slice(0, idx) : line;
      const id = idx >= 0 ? line.slice(idx + 1) : '';
      if (edge === 'DOWN') handlers.onDown(id);
      else if (edge === 'UP') handlers.onUp(id);
    }
  });
  proc.stderr.on('data', (d) => log('keyhook stderr:', d.toString().trim()));
  proc.on('exit', (code) => log(`keyhook exited (${code})`));
  log(`keyhook started for chords [${specs.join(' ; ')}]`);
}

module.exports = { start, stop, parseAccel };

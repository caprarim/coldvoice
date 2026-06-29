'use strict';

// Wraps mousehook.ps1, which reports global left/middle button presses and the
// foreground window class. Emits onClick(button, className) where button is
// 'L' or 'M'. Used by the click-to-paste fallback.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const { log } = require('./log');

let proc = null;
let handler = () => {};

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
    log(`mousehook: failed to materialize ${name}:`, e && e.message);
    return source;
  }
}

function start(onClick) {
  stop();
  handler = onClick || handler;
  const script = scriptPath('mousehook.ps1');
  proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
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
      if (idx < 0) continue;
      const button = line.slice(0, idx);
      const rest = line.slice(idx + 1);
      const pipe = rest.indexOf('|');
      const className = pipe >= 0 ? rest.slice(0, pipe) : rest;
      const processName = pipe >= 0 ? rest.slice(pipe + 1) : '';
      if (button === 'L' || button === 'M') handler(button, className, processName);
    }
  });
  proc.stderr.on('data', (d) => log('mousehook stderr:', d.toString().trim()));
  proc.on('exit', (code) => log(`mousehook exited (${code})`));
  log('mousehook started');
}

module.exports = { start, stop };

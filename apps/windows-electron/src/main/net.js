'use strict';

// Online/offline auto-detection. ColdVoice itself runs fully on-device, so the
// network status only governs account/sign-in features and the UI indicator —
// dictation keeps working either way. We probe connectivity cheaply with a DNS
// lookup and notify listeners only when the state actually flips.

const dns = require('dns');
const { log } = require('./log');

let online = true;
let timer = null;
const listeners = new Set();
const PROBE_INTERVAL = 8000;
// Resolvers that are extremely likely to be reachable when the machine is
// genuinely online. A bare DNS lookup avoids shipping any tracking/telemetry.
const PROBE_HOSTS = ['cloudflare.com', 'google.com', 'apple.com'];

function probeOnce() {
  return new Promise((resolve) => {
    let settled = false;
    let pending = PROBE_HOSTS.length;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    for (const host of PROBE_HOSTS) {
      dns.lookup(host, { family: 4 }, (err) => {
        if (!err) return finish(true);
        pending -= 1;
        if (pending === 0) finish(false);
      });
    }
    // Don't let a hung resolver wedge the watcher.
    setTimeout(() => finish(false), 4000);
  });
}

function setOnline(next) {
  if (next === online) return;
  online = next;
  log(`connectivity: ${online ? 'online' : 'offline'}`);
  for (const cb of listeners) {
    try { cb(online); } catch (_) { /* ignore */ }
  }
}

async function tick() {
  setOnline(await probeOnce());
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, PROBE_INTERVAL);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function isOnline() {
  return online;
}

// Subscribe to connectivity flips. Returns an unsubscribe function.
function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

module.exports = { start, stop, isOnline, onChange, probeOnce };

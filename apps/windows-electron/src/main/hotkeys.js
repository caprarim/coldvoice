'use strict';

// Global shortcut registration. Electron's globalShortcut fires on key-DOWN only
// (no key-up), so true hold-to-talk needs a low-level hook. For the MVP we treat
// the dictation shortcut as a toggle and also honour the hands-free toggle mode;
// the renderer decides insert-on-release behaviour. The default accelerator is
// Ctrl+1 (configurable in Settings).

const { globalShortcut } = require('electron');
const { log } = require('./log');

let registered = [];

function unregisterAll() {
  globalShortcut.unregisterAll();
  registered = [];
}

// handlers: { onDictateToggle, onPasteLast, onCancel }
function register(settings, handlers) {
  unregisterAll();
  const dictate = settings['shortcut.handsFreeHoldToDictate'] || 'Ctrl+1';
  const pasteAlt = settings['shortcut.pasteLastTranscriptAlt'] || 'Alt+Shift+Z';

  tryRegister(dictate, handlers.onDictateToggle);
  tryRegister(pasteAlt, handlers.onPasteLast);
  // Note: "Middle Click" and "Esc" are handled in the renderer / pill window,
  // not as global accelerators.
  return registered;
}

function tryRegister(accel, fn) {
  try {
    const ok = globalShortcut.register(accel, fn);
    log(`register "${accel}": ${ok ? 'OK' : 'FAILED (in use?)'}`);
    if (ok) registered.push(accel);
  } catch (e) {
    log(`register "${accel}" threw: ${e && e.message}`);
  }
}

module.exports = { register, unregisterAll };

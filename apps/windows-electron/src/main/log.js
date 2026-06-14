'use strict';

// Minimal file logger. Electron main-process stdout is unreliable when launched
// detached on Windows, so we append to a file we can read back.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', '_debug.log');

function log(...args) {
  try {
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${args.join(' ')}\n`);
  } catch {
    /* ignore */
  }
}

module.exports = { log, file };

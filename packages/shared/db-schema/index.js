'use strict';

const fs = require('fs');
const path = require('path');

// Returns the schema SQL as a string. Each platform applies it with its own
// SQLite driver (better-sqlite3 on Electron, Room/SQLite on Android).
function getSchemaSql() {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

module.exports = { getSchemaSql, schemaPath: path.join(__dirname, 'schema.sql') };

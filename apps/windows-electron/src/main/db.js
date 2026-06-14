'use strict';

// SQLite access for ColdVoice via node-sqlite3-wasm (pure WASM, no native build).
// Applies the shared schema and exposes small CRUD helpers. Local file only.

const path = require('path');
const { app } = require('electron');
const { Database } = require('node-sqlite3-wasm');
const { getSchemaSql } = require('@coldvoice/db-schema');

let db;

function init() {
  const file = path.join(app.getPath('userData'), 'coldvoice.sqlite');
  db = new Database(file);
  db.exec(getSchemaSql());
  return db;
}

function get() {
  if (!db) init();
  return db;
}

// settings ------------------------------------------------------------------
function getSetting(key, fallback = null) {
  const row = get().get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  get().run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, String(value)]
  );
}

function allSettings() {
  const out = {};
  for (const r of get().all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

// dictionary ----------------------------------------------------------------
function listDictionary() {
  return get().all('SELECT * FROM dictionary_entries ORDER BY updated_at DESC');
}

function upsertDictionary(e) {
  const aliases = JSON.stringify(e.aliases || []);
  if (e.id) {
    get().run(
      `UPDATE dictionary_entries SET type=?, phrase=?, replacement=?, aliases_json=?, boost=?,
       case_sensitive=?, enabled=?, updated_at=datetime('now') WHERE id=?`,
      [e.type || 'replacement', e.phrase, e.replacement || '', aliases, e.boost || 0,
        e.case_sensitive ? 1 : 0, e.enabled === false ? 0 : 1, e.id]
    );
    return e.id;
  }
  const info = get().run(
    `INSERT INTO dictionary_entries (type, phrase, replacement, aliases_json, boost, case_sensitive, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [e.type || 'replacement', e.phrase, e.replacement || '', aliases, e.boost || 0,
      e.case_sensitive ? 1 : 0, e.enabled === false ? 0 : 1]
  );
  return info.lastInsertRowid;
}

function deleteDictionary(id) {
  get().run('DELETE FROM dictionary_entries WHERE id = ?', [id]);
}

// snippets ------------------------------------------------------------------
function listSnippets() {
  return get().all('SELECT * FROM snippets ORDER BY updated_at DESC');
}

function upsertSnippet(s) {
  if (s.id) {
    get().run(
      `UPDATE snippets SET trigger=?, expansion=?, app_scope=?, enabled=?, updated_at=datetime('now') WHERE id=?`,
      [s.trigger, s.expansion, s.app_scope || null, s.enabled === false ? 0 : 1, s.id]
    );
    return s.id;
  }
  const info = get().run(
    'INSERT INTO snippets (trigger, expansion, app_scope, enabled) VALUES (?, ?, ?, ?)',
    [s.trigger, s.expansion, s.app_scope || null, s.enabled === false ? 0 : 1]
  );
  return info.lastInsertRowid;
}

function deleteSnippet(id) {
  get().run('DELETE FROM snippets WHERE id = ?', [id]);
}

// transcripts ---------------------------------------------------------------
function saveTranscript(raw, final, targetApp) {
  if (getSetting('privacy.storeTranscripts', '0') !== '1') return;
  get().run('INSERT INTO transcripts (raw_text, final_text, target_app) VALUES (?, ?, ?)',
    [raw, final, targetApp || null]);
}

// Map DB rows to the shapes the shared pipeline expects.
function dictionaryForPipeline() {
  return listDictionary().map((r) => ({
    type: r.type,
    phrase: r.phrase,
    replacement: r.replacement,
    aliases: safeParse(r.aliases_json),
    caseSensitive: !!r.case_sensitive,
    enabled: !!r.enabled,
  }));
}

function snippetsForPipeline() {
  return listSnippets().map((r) => ({
    trigger: r.trigger,
    expansion: r.expansion,
    app_scope: r.app_scope,
    enabled: !!r.enabled,
  }));
}

function safeParse(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = {
  init, get, getSetting, setSetting, allSettings,
  listDictionary, upsertDictionary, deleteDictionary,
  listSnippets, upsertSnippet, deleteSnippet,
  saveTranscript, dictionaryForPipeline, snippetsForPipeline,
};

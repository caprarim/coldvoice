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
  migrate();
  return db;
}

// Safe additive migrations for databases created before newer columns existed.
function migrate() {
  const cols = db.all('PRAGMA table_info(transcripts)').map((c) => c.name);
  if (!cols.includes('word_count')) {
    try { db.exec('ALTER TABLE transcripts ADD COLUMN word_count INTEGER DEFAULT 0'); } catch { /* ignore */ }
  }
  if (!cols.includes('duration_ms')) {
    try { db.exec('ALTER TABLE transcripts ADD COLUMN duration_ms INTEGER DEFAULT 0'); } catch { /* ignore */ }
  }
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
function wordCount(text) {
  const m = String(text || '').trim();
  return m ? m.split(/\s+/).length : 0;
}

function saveTranscript(raw, final, targetApp, durationMs = 0) {
  if (getSetting('privacy.storeTranscripts', '1') !== '1') return;
  get().run(
    'INSERT INTO transcripts (raw_text, final_text, target_app, word_count, duration_ms) VALUES (?, ?, ?, ?, ?)',
    [raw, final, targetApp || null, wordCount(final), Math.round(durationMs) || 0]
  );
}

function listTranscripts(limit = 200) {
  return get().all(
    'SELECT id, raw_text, final_text, target_app, word_count, duration_ms, created_at FROM transcripts ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
}

function deleteTranscript(id) {
  get().run('DELETE FROM transcripts WHERE id = ?', [id]);
}

function clearTranscripts() {
  get().run('DELETE FROM transcripts');
}

// Approximate count of words ColdVoice changed between raw and final text.
function diffFixes(raw, final) {
  const a = String(raw || '').toLowerCase().split(/\s+/).filter(Boolean);
  const b = String(final || '').toLowerCase().split(/\s+/).filter(Boolean);
  const bSet = new Map();
  for (const w of b) bSet.set(w, (bSet.get(w) || 0) + 1);
  let changed = 0;
  for (const w of a) {
    const n = bSet.get(w) || 0;
    if (n > 0) bSet.set(w, n - 1);
    else changed += 1;
  }
  return changed;
}

// Aggregate stats for the Insights page and the Home stats rail.
function transcriptStats() {
  const rows = get().all('SELECT final_text, raw_text, target_app, word_count, duration_ms, created_at FROM transcripts');
  let totalWords = 0;
  let totalDurationMs = 0;
  let fixes = 0;
  const byApp = {};
  const byDay = {};
  for (const r of rows) {
    const wc = r.word_count || wordCount(r.final_text);
    totalWords += wc;
    totalDurationMs += r.duration_ms || 0;
    fixes += diffFixes(r.raw_text, r.final_text);
    const app = (r.target_app || 'unknown').toLowerCase();
    byApp[app] = (byApp[app] || 0) + wc;
    const day = String(r.created_at || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
  }
  const minutes = totalDurationMs / 60000;
  const wpm = minutes > 0.01 ? Math.round(totalWords / minutes) : 0;

  const apps = Object.entries(byApp)
    .map(([app, words]) => ({ app, words }))
    .sort((a, b) => b.words - a.words);

  // Streak: count consecutive days ending today (or yesterday) with activity.
  const today = new Date();
  function dayKey(d) { return d.toISOString().slice(0, 10); }
  let streak = 0;
  const cursor = new Date(today);
  if (!byDay[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1); // allow "yesterday" anchor
  while (byDay[dayKey(cursor)]) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const day of Object.keys(byDay).sort()) {
    if (prev) {
      const gap = (new Date(day) - new Date(prev)) / 86400000;
      run = gap === 1 ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run);
    prev = day;
  }

  return {
    totalWords,
    totalDictations: rows.length,
    totalDurationMs,
    wpm,
    fixes,
    apps,
    byDay,
    streak,
    longestStreak: longest,
  };
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
  saveTranscript, listTranscripts, deleteTranscript, clearTranscripts, transcriptStats,
  dictionaryForPipeline, snippetsForPipeline,
};

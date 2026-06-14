-- ColdVoice local SQLite schema. Local-only; no cloud, no telemetry.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dictionary_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,            -- 'vocabulary' | 'replacement' | 'term'
  phrase         TEXT NOT NULL,
  replacement    TEXT,
  aliases_json   TEXT DEFAULT '[]',
  boost          REAL DEFAULT 0,
  case_sensitive INTEGER DEFAULT 0,
  enabled        INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snippets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger    TEXT NOT NULL,
  expansion  TEXT NOT NULL,
  app_scope  TEXT,
  enabled    INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS styles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  rules_json TEXT DEFAULT '{}',
  app_scope  TEXT,
  enabled    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transcripts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text   TEXT,
  final_text TEXT,
  target_app TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id          TEXT NOT NULL,
  style_id        INTEGER,
  bubble_enabled  INTEGER DEFAULT 1,
  privacy_blocked INTEGER DEFAULT 0
);

-- Default shortcut settings (approved changes baked in).
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('shortcut.handsFreeHoldToDictate', 'Ctrl+1'),
  ('shortcut.pasteLastTranscript',    'Middle Click'),
  ('shortcut.pasteLastTranscriptAlt', 'Alt+Shift+Z'),
  ('shortcut.cancel',                 'Esc'),
  ('dictation.mode',                  'hold'),       -- 'hold' | 'toggle'
  ('dictation.insertOnRelease',       '1'),
  ('privacy.storeTranscripts',        '0'),
  ('privacy.storeAudio',              '0'),
  ('asr.model',                       'base.en');

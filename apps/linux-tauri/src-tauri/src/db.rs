// SQLite access for ColdVoice on Linux. Applies the shared schema from
// packages/shared/db-schema so the Linux database is byte-for-byte the same
// shape as the Windows one, then exposes the same small CRUD helpers the
// Electron app has. Local file only, never synced anywhere.

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::util;

const SCHEMA_SQL: &str = include_str!("../../../../packages/shared/db-schema/schema.sql");

pub fn open() -> Connection {
    let file = util::data_dir().join("coldvoice.sqlite");
    let conn = Connection::open(file).expect("open coldvoice.sqlite");
    conn.execute_batch(SCHEMA_SQL).expect("apply schema");
    migrate(&conn);
    conn
}

// Safe additive migrations for databases created before newer columns existed.
fn migrate(conn: &Connection) {
    let mut cols: Vec<String> = Vec::new();
    if let Ok(mut stmt) = conn.prepare("PRAGMA table_info(transcripts)") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) {
            for c in rows.flatten() {
                cols.push(c);
            }
        }
    }
    if !cols.iter().any(|c| c == "word_count") {
        let _ = conn.execute_batch("ALTER TABLE transcripts ADD COLUMN word_count INTEGER DEFAULT 0");
    }
    if !cols.iter().any(|c| c == "duration_ms") {
        let _ = conn.execute_batch("ALTER TABLE transcripts ADD COLUMN duration_ms INTEGER DEFAULT 0");
    }
}

// settings ------------------------------------------------------------------
pub fn get_setting(conn: &Connection, key: &str, fallback: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?", params![key], |r| {
        r.get::<_, Option<String>>(0)
    })
    .ok()
    .flatten()
    .unwrap_or_else(|| fallback.to_string())
}

pub fn has_setting(conn: &Connection, key: &str) -> bool {
    conn.query_row("SELECT 1 FROM settings WHERE key = ?", params![key], |_| Ok(()))
        .is_ok()
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

pub fn all_settings(conn: &Connection) -> Value {
    let mut out = Map::new();
    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM settings") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for (k, v) in rows.flatten() {
                out.insert(k, Value::String(v.unwrap_or_default()));
            }
        }
    }
    Value::Object(out)
}

// dictionary ----------------------------------------------------------------
pub fn list_dictionary(conn: &Connection) -> Value {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, type, phrase, replacement, aliases_json, boost, case_sensitive, enabled, created_at, updated_at
         FROM dictionary_entries ORDER BY updated_at DESC",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "type": r.get::<_, String>(1)?,
                "phrase": r.get::<_, String>(2)?,
                "replacement": r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "aliases_json": r.get::<_, Option<String>>(4)?.unwrap_or_else(|| "[]".into()),
                "boost": r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                "case_sensitive": r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                "enabled": r.get::<_, Option<i64>>(7)?.unwrap_or(1),
                "created_at": r.get::<_, Option<String>>(8)?.unwrap_or_default(),
                "updated_at": r.get::<_, Option<String>>(9)?.unwrap_or_default(),
            }))
        }) {
            for row in rows.flatten() {
                out.push(row);
            }
        }
    }
    Value::Array(out)
}

fn str_field(entry: &Value, key: &str) -> String {
    entry.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

fn bool_field(entry: &Value, key: &str, default: bool) -> bool {
    match entry.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => s == "1" || s == "true",
        _ => default,
    }
}

pub fn upsert_dictionary(conn: &Connection, entry: &Value) -> i64 {
    let aliases = entry
        .get("aliases")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    let aliases_json = serde_json::to_string(&aliases).unwrap_or_else(|_| "[]".into());
    let kind = {
        let t = str_field(entry, "type");
        if t.is_empty() { "replacement".to_string() } else { t }
    };
    let phrase = str_field(entry, "phrase");
    let replacement = str_field(entry, "replacement");
    let boost = entry.get("boost").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let case_sensitive = if bool_field(entry, "case_sensitive", false) { 1 } else { 0 };
    let enabled = if bool_field(entry, "enabled", true) { 1 } else { 0 };
    let id = entry.get("id").and_then(|v| v.as_i64());

    if let Some(id) = id {
        let _ = conn.execute(
            "UPDATE dictionary_entries SET type=?, phrase=?, replacement=?, aliases_json=?, boost=?,
             case_sensitive=?, enabled=?, updated_at=datetime('now') WHERE id=?",
            params![kind, phrase, replacement, aliases_json, boost, case_sensitive, enabled, id],
        );
        return id;
    }
    let _ = conn.execute(
        "INSERT INTO dictionary_entries (type, phrase, replacement, aliases_json, boost, case_sensitive, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![kind, phrase, replacement, aliases_json, boost, case_sensitive, enabled],
    );
    conn.last_insert_rowid()
}

pub fn delete_dictionary(conn: &Connection, id: i64) {
    let _ = conn.execute("DELETE FROM dictionary_entries WHERE id = ?", params![id]);
}

// snippets ------------------------------------------------------------------
pub fn list_snippets(conn: &Connection) -> Value {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, trigger, expansion, app_scope, enabled, created_at, updated_at
         FROM snippets ORDER BY updated_at DESC",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "trigger": r.get::<_, String>(1)?,
                "expansion": r.get::<_, String>(2)?,
                "app_scope": r.get::<_, Option<String>>(3)?,
                "enabled": r.get::<_, Option<i64>>(4)?.unwrap_or(1),
                "created_at": r.get::<_, Option<String>>(5)?.unwrap_or_default(),
                "updated_at": r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            }))
        }) {
            for row in rows.flatten() {
                out.push(row);
            }
        }
    }
    Value::Array(out)
}

pub fn upsert_snippet(conn: &Connection, s: &Value) -> i64 {
    let trigger = str_field(s, "trigger");
    let expansion = str_field(s, "expansion");
    let app_scope = s.get("app_scope").and_then(|v| v.as_str()).map(|v| v.to_string());
    let enabled = if bool_field(s, "enabled", true) { 1 } else { 0 };
    if let Some(id) = s.get("id").and_then(|v| v.as_i64()) {
        let _ = conn.execute(
            "UPDATE snippets SET trigger=?, expansion=?, app_scope=?, enabled=?, updated_at=datetime('now') WHERE id=?",
            params![trigger, expansion, app_scope, enabled, id],
        );
        return id;
    }
    let _ = conn.execute(
        "INSERT INTO snippets (trigger, expansion, app_scope, enabled) VALUES (?, ?, ?, ?)",
        params![trigger, expansion, app_scope, enabled],
    );
    conn.last_insert_rowid()
}

pub fn delete_snippet(conn: &Connection, id: i64) {
    let _ = conn.execute("DELETE FROM snippets WHERE id = ?", params![id]);
}

// transcripts ---------------------------------------------------------------
pub fn save_transcript(conn: &Connection, raw: &str, final_text: &str, target_app: Option<&str>, duration_ms: i64) {
    if get_setting(conn, "privacy.storeTranscripts", "1") != "1" {
        return;
    }
    let _ = conn.execute(
        "INSERT INTO transcripts (raw_text, final_text, target_app, word_count, duration_ms) VALUES (?, ?, ?, ?, ?)",
        params![raw, final_text, target_app, util::word_count(final_text), duration_ms.max(0)],
    );
}

pub fn list_transcripts(conn: &Connection, limit: i64) -> Value {
    let mut out = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, raw_text, final_text, target_app, word_count, duration_ms, created_at
         FROM transcripts ORDER BY created_at DESC LIMIT ?",
    ) {
        if let Ok(rows) = stmt.query_map(params![limit], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "raw_text": r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                "final_text": r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                "target_app": r.get::<_, Option<String>>(3)?,
                "word_count": r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                "duration_ms": r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                "created_at": r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            }))
        }) {
            for row in rows.flatten() {
                out.push(row);
            }
        }
    }
    Value::Array(out)
}

pub fn update_transcript(conn: &Connection, id: i64, text: &str) {
    let _ = conn.execute(
        "UPDATE transcripts SET final_text = ?, word_count = ? WHERE id = ?",
        params![text, util::word_count(text), id],
    );
}

pub fn delete_transcript(conn: &Connection, id: i64) {
    let _ = conn.execute("DELETE FROM transcripts WHERE id = ?", params![id]);
}

pub fn clear_transcripts(conn: &Connection) {
    let _ = conn.execute("DELETE FROM transcripts", []);
}

// Approximate count of words ColdVoice changed between raw and final text.
fn diff_fixes(raw: &str, final_text: &str) -> i64 {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for w in final_text.to_lowercase().split_whitespace() {
        *counts.entry(w.to_string()).or_insert(0) += 1;
    }
    let mut changed = 0;
    for w in raw.to_lowercase().split_whitespace() {
        match counts.get_mut(w) {
            Some(n) if *n > 0 => *n -= 1,
            _ => changed += 1,
        }
    }
    changed
}

// Civil calendar helpers (Howard Hinnant's algorithms) so streaks can be walked
// day by day without pulling in a date crate.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn day_key(days_from_epoch: i64) -> String {
    let (y, m, d) = civil_from_days(days_from_epoch);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn today_days() -> i64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    secs / 86400
}

// Aggregate stats for the Insights page and the Home stats rail.
pub fn transcript_stats(conn: &Connection) -> Value {
    let mut total_words: i64 = 0;
    let mut total_duration_ms: i64 = 0;
    let mut fixes: i64 = 0;
    let mut by_app: BTreeMap<String, i64> = BTreeMap::new();
    let mut by_day: BTreeMap<String, i64> = BTreeMap::new();
    let mut rows_count: i64 = 0;

    if let Ok(mut stmt) = conn.prepare(
        "SELECT final_text, raw_text, target_app, word_count, duration_ms, created_at FROM transcripts",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<i64>>(3)?.unwrap_or(0),
                r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                r.get::<_, Option<String>>(5)?.unwrap_or_default(),
            ))
        }) {
            for (final_text, raw, app, wc, dur, created) in rows.flatten() {
                rows_count += 1;
                let wc = if wc > 0 { wc } else { util::word_count(&final_text) };
                total_words += wc;
                total_duration_ms += dur;
                fixes += diff_fixes(&raw, &final_text);
                let app = app.unwrap_or_else(|| "unknown".into()).to_lowercase();
                *by_app.entry(app).or_insert(0) += wc;
                if created.len() >= 10 {
                    *by_day.entry(created[..10].to_string()).or_insert(0) += 1;
                }
            }
        }
    }

    let minutes = total_duration_ms as f64 / 60000.0;
    let wpm = if minutes > 0.01 { (total_words as f64 / minutes).round() as i64 } else { 0 };

    let mut apps: Vec<Value> = by_app
        .iter()
        .map(|(app, words)| json!({ "app": app, "words": words }))
        .collect();
    apps.sort_by(|a, b| {
        b["words"].as_i64().unwrap_or(0).cmp(&a["words"].as_i64().unwrap_or(0))
    });

    // Streak: consecutive days ending today (or yesterday) with activity.
    let mut cursor = today_days();
    if !by_day.contains_key(&day_key(cursor)) {
        cursor -= 1;
    }
    let mut streak = 0;
    while by_day.contains_key(&day_key(cursor)) {
        streak += 1;
        cursor -= 1;
    }

    let mut longest = 0;
    let mut run = 0;
    let mut prev: Option<String> = None;
    for day in by_day.keys() {
        match &prev {
            Some(p) => {
                let gap = day_index(day) - day_index(p);
                run = if gap == 1 { run + 1 } else { 1 };
            }
            None => run = 1,
        }
        if run > longest {
            longest = run;
        }
        prev = Some(day.clone());
    }

    json!({
        "totalWords": total_words,
        "totalDictations": rows_count,
        "totalDurationMs": total_duration_ms,
        "wpm": wpm,
        "fixes": fixes,
        "apps": apps,
        "byDay": by_day,
        "streak": streak,
        "longestStreak": longest,
    })
}

// "YYYY-MM-DD" to a day number, so gaps between activity days are countable.
fn day_index(key: &str) -> i64 {
    let parts: Vec<i64> = key.split('-').filter_map(|p| p.parse::<i64>().ok()).collect();
    if parts.len() != 3 {
        return 0;
    }
    days_from_civil(parts[0], parts[1] as u32, parts[2] as u32)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

// Map DB rows to the shapes the shared pipeline expects.
pub fn dictionary_for_pipeline(conn: &Connection) -> Value {
    let rows = list_dictionary(conn);
    let mapped: Vec<Value> = rows
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    let aliases: Value = r
                        .get("aliases_json")
                        .and_then(|v| v.as_str())
                        .and_then(|s| serde_json::from_str(s).ok())
                        .unwrap_or_else(|| Value::Array(vec![]));
                    json!({
                        "type": r["type"],
                        "phrase": r["phrase"],
                        "replacement": r["replacement"],
                        "aliases": if aliases.is_array() { aliases } else { Value::Array(vec![]) },
                        "caseSensitive": r["case_sensitive"].as_i64().unwrap_or(0) != 0,
                        "enabled": r["enabled"].as_i64().unwrap_or(1) != 0,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Value::Array(mapped)
}

pub fn snippets_for_pipeline(conn: &Connection) -> Value {
    let rows = list_snippets(conn);
    let mapped: Vec<Value> = rows
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    json!({
                        "trigger": r["trigger"],
                        "expansion": r["expansion"],
                        "app_scope": r["app_scope"],
                        "enabled": r["enabled"].as_i64().unwrap_or(1) != 0,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Value::Array(mapped)
}

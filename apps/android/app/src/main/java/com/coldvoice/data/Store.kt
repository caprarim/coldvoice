package com.coldvoice.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

object Store {

    data class Transcript(
        val id: Long,
        val raw: String,
        val final: String,
        val targetApp: String?,
        val wordCount: Int,
        val durationMs: Long,
        val createdAt: Long
    )

    data class DictEntry(
        val id: Long = 0,
        val phrase: String,
        val replacement: String,
        val aliases: List<String> = emptyList(),
        val caseSensitive: Boolean = false,
        val enabled: Boolean = true
    )

    data class Snippet(
        val id: Long = 0,
        val trigger: String,
        val expansion: String,
        val enabled: Boolean = true
    )

    data class AppUsage(val app: String, val words: Int)

    data class Stats(
        val totalWords: Int,
        val totalDictations: Int,
        val totalDurationMs: Long,
        val wpm: Int,
        val fixes: Int,
        val apps: List<AppUsage>,
        val byDay: Map<String, Int>,
        val streak: Int,
        val longestStreak: Int
    )

    private const val DB_NAME = "coldvoice.db"
    private const val DB_VERSION = 1

    private var helper: Helper? = null

    private class Helper(context: Context) :
        SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS transcripts (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  raw_text TEXT,
                  final_text TEXT,
                  target_app TEXT,
                  word_count INTEGER DEFAULT 0,
                  duration_ms INTEGER DEFAULT 0,
                  created_at INTEGER NOT NULL
                )
                """.trimIndent()
            )
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS dictionary_entries (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  phrase TEXT NOT NULL,
                  replacement TEXT,
                  aliases_json TEXT DEFAULT '[]',
                  case_sensitive INTEGER DEFAULT 0,
                  enabled INTEGER DEFAULT 1,
                  updated_at INTEGER NOT NULL
                )
                """.trimIndent()
            )
            db.execSQL(
                """
                CREATE TABLE IF NOT EXISTS snippets (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  trigger TEXT NOT NULL,
                  expansion TEXT NOT NULL,
                  enabled INTEGER DEFAULT 1,
                  updated_at INTEGER NOT NULL
                )
                """.trimIndent()
            )
            db.execSQL("CREATE INDEX IF NOT EXISTS idx_transcripts_created ON transcripts (created_at DESC)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }

    @Synchronized
    private fun db(context: Context): SQLiteDatabase {
        val h = helper ?: Helper(context).also { helper = it }
        return h.writableDatabase
    }

    fun warm(context: Context) {
        try { db(context) } catch (_: Exception) {}
    }

    // --- transcripts ----------------------------------------------------------

    fun saveTranscript(
        context: Context,
        raw: String,
        final: String,
        targetApp: String?,
        durationMs: Long
    ): Long {
        if (final.isBlank()) return -1
        val values = ContentValues().apply {
            put("raw_text", raw)
            put("final_text", final)
            put("target_app", targetApp)
            put("word_count", wordCount(final))
            put("duration_ms", durationMs)
            put("created_at", System.currentTimeMillis())
        }
        return try { db(context).insert("transcripts", null, values) } catch (_: Exception) { -1 }
    }

    fun listTranscripts(context: Context, limit: Int = 300): List<Transcript> {
        val out = ArrayList<Transcript>()
        try {
            db(context).rawQuery(
                "SELECT id, raw_text, final_text, target_app, word_count, duration_ms, created_at " +
                    "FROM transcripts ORDER BY created_at DESC LIMIT ?",
                arrayOf(limit.toString())
            ).use { c ->
                while (c.moveToNext()) {
                    out.add(
                        Transcript(
                            id = c.getLong(0),
                            raw = c.getString(1).orEmpty(),
                            final = c.getString(2).orEmpty(),
                            targetApp = c.getString(3),
                            wordCount = c.getInt(4),
                            durationMs = c.getLong(5),
                            createdAt = c.getLong(6)
                        )
                    )
                }
            }
        } catch (_: Exception) {}
        return out
    }

    fun updateTranscript(context: Context, id: Long, text: String) {
        val values = ContentValues().apply {
            put("final_text", text)
            put("word_count", wordCount(text))
        }
        try { db(context).update("transcripts", values, "id = ?", arrayOf(id.toString())) } catch (_: Exception) {}
    }

    fun deleteTranscript(context: Context, id: Long) {
        try { db(context).delete("transcripts", "id = ?", arrayOf(id.toString())) } catch (_: Exception) {}
    }

    fun clearTranscripts(context: Context) {
        try { db(context).delete("transcripts", null, null) } catch (_: Exception) {}
    }

    // --- dictionary -----------------------------------------------------------

    fun listDictionary(context: Context): List<DictEntry> {
        val out = ArrayList<DictEntry>()
        try {
            db(context).rawQuery(
                "SELECT id, phrase, replacement, aliases_json, case_sensitive, enabled " +
                    "FROM dictionary_entries ORDER BY updated_at DESC",
                null
            ).use { c ->
                while (c.moveToNext()) {
                    out.add(
                        DictEntry(
                            id = c.getLong(0),
                            phrase = c.getString(1).orEmpty(),
                            replacement = c.getString(2).orEmpty(),
                            aliases = parseAliases(c.getString(3)),
                            caseSensitive = c.getInt(4) == 1,
                            enabled = c.getInt(5) == 1
                        )
                    )
                }
            }
        } catch (_: Exception) {}
        return out
    }

    fun upsertDictionary(context: Context, entry: DictEntry) {
        val values = ContentValues().apply {
            put("phrase", entry.phrase)
            put("replacement", entry.replacement)
            put("aliases_json", JSONArray(entry.aliases).toString())
            put("case_sensitive", if (entry.caseSensitive) 1 else 0)
            put("enabled", if (entry.enabled) 1 else 0)
            put("updated_at", System.currentTimeMillis())
        }
        try {
            if (entry.id > 0) {
                db(context).update("dictionary_entries", values, "id = ?", arrayOf(entry.id.toString()))
            } else {
                db(context).insert("dictionary_entries", null, values)
            }
        } catch (_: Exception) {}
    }

    fun deleteDictionary(context: Context, id: Long) {
        try { db(context).delete("dictionary_entries", "id = ?", arrayOf(id.toString())) } catch (_: Exception) {}
    }

    // --- snippets -------------------------------------------------------------

    fun listSnippets(context: Context): List<Snippet> {
        val out = ArrayList<Snippet>()
        try {
            db(context).rawQuery(
                "SELECT id, trigger, expansion, enabled FROM snippets ORDER BY updated_at DESC",
                null
            ).use { c ->
                while (c.moveToNext()) {
                    out.add(
                        Snippet(
                            id = c.getLong(0),
                            trigger = c.getString(1).orEmpty(),
                            expansion = c.getString(2).orEmpty(),
                            enabled = c.getInt(3) == 1
                        )
                    )
                }
            }
        } catch (_: Exception) {}
        return out
    }

    fun upsertSnippet(context: Context, snippet: Snippet) {
        val values = ContentValues().apply {
            put("trigger", snippet.trigger)
            put("expansion", snippet.expansion)
            put("enabled", if (snippet.enabled) 1 else 0)
            put("updated_at", System.currentTimeMillis())
        }
        try {
            if (snippet.id > 0) {
                db(context).update("snippets", values, "id = ?", arrayOf(snippet.id.toString()))
            } else {
                db(context).insert("snippets", null, values)
            }
        } catch (_: Exception) {}
    }

    fun deleteSnippet(context: Context, id: Long) {
        try { db(context).delete("snippets", "id = ?", arrayOf(id.toString())) } catch (_: Exception) {}
    }

    // --- stats ----------------------------------------------------------------

    fun stats(context: Context): Stats {
        var totalWords = 0
        var totalDurationMs = 0L
        var fixes = 0
        var rows = 0
        val byApp = HashMap<String, Int>()
        val byDay = HashMap<String, Int>()
        try {
            db(context).rawQuery(
                "SELECT raw_text, final_text, target_app, word_count, duration_ms, created_at FROM transcripts",
                null
            ).use { c ->
                while (c.moveToNext()) {
                    rows++
                    val raw = c.getString(0).orEmpty()
                    val final = c.getString(1).orEmpty()
                    val app = c.getString(2)?.takeIf { it.isNotBlank() } ?: "Unknown"
                    val stored = c.getInt(3)
                    val words = if (stored > 0) stored else wordCount(final)
                    totalWords += words
                    totalDurationMs += c.getLong(4)
                    fixes += diffFixes(raw, final)
                    byApp[app] = (byApp[app] ?: 0) + words
                    val day = dayKey(c.getLong(5))
                    byDay[day] = (byDay[day] ?: 0) + 1
                }
            }
        } catch (_: Exception) {}

        val minutes = totalDurationMs / 60000.0
        val wpm = if (minutes > 0.01) Math.round(totalWords / minutes).toInt() else 0
        val apps = byApp.entries
            .map { AppUsage(it.key, it.value) }
            .sortedByDescending { it.words }

        return Stats(
            totalWords = totalWords,
            totalDictations = rows,
            totalDurationMs = totalDurationMs,
            wpm = wpm,
            fixes = fixes,
            apps = apps,
            byDay = byDay,
            streak = currentStreak(byDay),
            longestStreak = longestStreak(byDay)
        )
    }

    private fun currentStreak(byDay: Map<String, Int>): Int {
        val cursor = Calendar.getInstance()
        if (byDay[dayKey(cursor.timeInMillis)] == null) cursor.add(Calendar.DAY_OF_YEAR, -1)
        var streak = 0
        while (byDay[dayKey(cursor.timeInMillis)] != null) {
            streak++
            cursor.add(Calendar.DAY_OF_YEAR, -1)
        }
        return streak
    }

    private fun longestStreak(byDay: Map<String, Int>): Int {
        var longest = 0
        var run = 0
        var previous: Long? = null
        for (day in byDay.keys.sorted()) {
            val time = parseDay(day) ?: continue
            run = if (previous != null && time - previous!! in ONE_DAY_MIN..ONE_DAY_MAX) run + 1 else 1
            if (run > longest) longest = run
            previous = time
        }
        return longest
    }

    private fun diffFixes(raw: String, final: String): Int {
        val spoken = raw.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val produced = HashMap<String, Int>()
        for (w in final.lowercase().split(Regex("\\s+"))) {
            if (w.isEmpty()) continue
            produced[w] = (produced[w] ?: 0) + 1
        }
        var changed = 0
        for (w in spoken) {
            val n = produced[w] ?: 0
            if (n > 0) produced[w] = n - 1 else changed++
        }
        return changed
    }

    // --- helpers --------------------------------------------------------------

    fun wordCount(text: String): Int {
        val t = text.trim()
        return if (t.isEmpty()) 0 else t.split(Regex("\\s+")).size
    }

    fun dayKey(millis: Long): String = DAY_FORMAT.format(Date(millis))

    private fun parseDay(key: String): Long? =
        try { DAY_FORMAT.parse(key)?.time } catch (_: Exception) { null }

    private fun parseAliases(json: String?): List<String> {
        if (json.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(json)
            (0 until array.length()).mapNotNull { array.optString(it).takeIf { s -> s.isNotBlank() } }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private val DAY_FORMAT = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private const val ONE_DAY_MIN = 20L * 60 * 60 * 1000
    private const val ONE_DAY_MAX = 28L * 60 * 60 * 1000
}

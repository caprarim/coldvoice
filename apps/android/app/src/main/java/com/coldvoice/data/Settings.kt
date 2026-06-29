package com.coldvoice.data

import android.content.Context
import android.content.SharedPreferences
import com.coldvoice.BuildConfig

/**
 * Lightweight key/value settings, the Android analogue of the desktop app's
 * `db` settings table. Holds the same cloud-AI configuration the Windows app
 * seeds in `seedDefaults()` so dictation is polished out of the box on the free
 * Groq tier, while letting the user change or clear the key.
 *
 * Keys intentionally match the desktop names (`ai.enabled`, `ai.groqApiKey`,
 * `dictation.developerMode`) to keep the two platforms conceptually in sync.
 */
object Settings {

    private const val PREFS = "coldvoice.settings"

    const val KEY_AI_ENABLED = "ai.enabled"
    const val KEY_GROQ_API_KEY = "ai.groqApiKey"
    const val KEY_DEVELOPER_MODE = "dictation.developerMode"
    const val KEY_OFFLINE_MODE = "app.offlineMode"

    // Same free-tier Groq key the desktop app ships with (seedDefaults in main.js).
    // Whisper turbo + Llama both run on Groq's free tier through this one key.
    // Injected at build time from local.properties (GROQ_API_KEY) so the secret
    // never lives in committed source; empty when no key is configured.
    private val DEFAULT_GROQ_API_KEY: String = BuildConfig.GROQ_API_KEY

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun groqApiKey(context: Context): String =
        prefs(context).getString(KEY_GROQ_API_KEY, DEFAULT_GROQ_API_KEY)?.trim().orEmpty()

    fun setGroqApiKey(context: Context, key: String) {
        prefs(context).edit().putString(KEY_GROQ_API_KEY, key.trim()).apply()
    }

    fun hasGroqKey(context: Context): Boolean = groqApiKey(context).length > 10

    /** Master switch for the cloud AI path. On by default, like desktop. */
    fun aiEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_AI_ENABLED, true)

    fun setAiEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AI_ENABLED, enabled).apply()
    }

    /** User-forced offline mode: never touch the cloud even when online. */
    fun offlineMode(context: Context): Boolean =
        prefs(context).getBoolean(KEY_OFFLINE_MODE, false)

    fun setOfflineMode(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_OFFLINE_MODE, on).apply()
    }

    fun developerMode(context: Context): Boolean =
        prefs(context).getBoolean(KEY_DEVELOPER_MODE, true)

    fun setDeveloperMode(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_DEVELOPER_MODE, on).apply()
    }
}

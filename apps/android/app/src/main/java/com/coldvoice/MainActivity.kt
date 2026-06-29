package com.coldvoice

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.provider.Settings
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.coldvoice.data.Settings as CvSettings
import com.coldvoice.net.Connectivity

/**
 * Setup screen. Styled to match the desktop ColdVoice look — clean, blackish,
 * minimal, developer-friendly — and surfaces the live engine status (mic,
 * on-device speech, connectivity, and whether the fast cloud path is active).
 */
class MainActivity : Activity() {

    private var statusView: TextView? = null
    private var engineView: TextView? = null
    private var keyboardButton: Button? = null
    private val density get() = resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Connectivity.start(this)

        val scroll = ScrollView(this).apply { setBackgroundColor(Color.parseColor("#08090B")) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(40), dp(28), dp(28))
        }

        val title = TextView(this).apply {
            text = "ColdVoice"
            setTextColor(Color.WHITE)
            textSize = 34f
            setTypeface(typeface, Typeface.BOLD)
        }
        val tagline = TextView(this).apply {
            text = "Voice dictation for any app. Fast cloud polishing when online, fully offline when not — no account, no cost."
            setTextColor(Color.parseColor("#7A7C82"))
            textSize = 15f
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(0, dp(8), 0, dp(18))
        }

        engineView = TextView(this).apply {
            textSize = 13f
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = card()
            setTextColor(Color.parseColor("#C2C6D0"))
        }
        statusView = TextView(this).apply {
            text = setupStatus()
            setTextColor(Color.parseColor("#B5B7BD"))
            textSize = 14f
            setLineSpacing(dp(4).toFloat(), 1f)
            setPadding(0, dp(18), 0, dp(20))
        }

        root.addView(title)
        root.addView(tagline)
        root.addView(engineView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(6) })
        root.addView(statusView)
        root.addView(actionButton("Allow microphone") { requestMicPermission() })
        keyboardButton = actionButton("Enable ColdVoice keyboard") { onKeyboardButton() }
        root.addView(keyboardButton)
        root.addView(actionButton("Enable ColdVoice flow bubble") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })

        // A live field so the keyboard can actually be tried without leaving the app:
        // focus it, switch to the ColdVoice keyboard, and dictate right here.
        val tryLabel = TextView(this).apply {
            text = "Try it here"
            setTextColor(Color.parseColor("#7A7C82"))
            textSize = 13f
            setPadding(dp(2), dp(24), 0, dp(8))
        }
        val tryField = EditText(this).apply {
            hint = "Tap here, switch to the ColdVoice keyboard, then dictate…"
            setHintTextColor(Color.parseColor("#55585F"))
            setTextColor(Color.WHITE)
            textSize = 15f
            background = card()
            setPadding(dp(16), dp(16), dp(16), dp(16))
            minLines = 2
            gravity = Gravity.TOP or Gravity.START
        }
        root.addView(tryLabel)
        root.addView(tryField, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))

        scroll.addView(root)
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        statusView?.text = setupStatus()
        engineView?.text = engineStatus()
        // Once the keyboard is enabled in system settings, the button's job changes
        // from "enable it" to "switch to it" so the user is never left at a dead end.
        keyboardButton?.text =
            if (keyboardEnabled()) "Switch to ColdVoice keyboard" else "Enable ColdVoice keyboard"
    }

    /** Step 1 opens system settings to enable it; step 2 pops the keyboard picker. */
    private fun onKeyboardButton() {
        if (keyboardEnabled()) {
            (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showInputMethodPicker()
        } else {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        }
    }

    private fun keyboardEnabled(): Boolean {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        return imm.enabledInputMethodList.any { it.packageName == packageName }
    }

    private fun keyboardIsCurrent(): Boolean {
        val id = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
        return id != null && id.startsWith("$packageName/")
    }

    private fun card(): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = 14f * density
        setColor(Color.parseColor("#101114"))
        setStroke(dp(1), Color.parseColor("#23242B"))
    }

    private fun actionButton(label: String, onClick: () -> Unit): Button {
        val bg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 14f * density
            setColor(Color.parseColor("#15161B"))
            setStroke(dp(1), Color.parseColor("#23242B"))
        }
        return Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.WHITE)
            textSize = 15f
            background = bg
            setPadding(dp(18), dp(20), dp(18), dp(20))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(12) }
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setOnClickListener { onClick() }
        }
    }

    private fun requestMicPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1001)
        }
    }

    private fun check(ok: Boolean) = if (ok) "✓" else "•"

    private fun engineStatus(): String {
        val online = Connectivity.isOnline(this)
        val cloud = CvSettings.aiEnabled(this) && !CvSettings.offlineMode(this) &&
            CvSettings.hasGroqKey(this) && online
        val dot = if (online) "●" else "○"
        val engine = if (cloud) "Cloud (Groq Whisper + Llama)" else "On-device (offline)"
        return "$dot  ${if (online) "Online" else "Offline"} · Engine: $engine"
    }

    private fun setupStatus(): String {
        val mic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val speech = SpeechRecognizer.isRecognitionAvailable(this)
        val kbEnabled = keyboardEnabled()
        val kbCurrent = keyboardIsCurrent()
        val kbLine = when {
            kbCurrent -> "✓ ColdVoice keyboard active"
            kbEnabled -> "• ColdVoice keyboard enabled — tap \"Switch to ColdVoice keyboard\" to use it"
            else -> "• ColdVoice keyboard not enabled yet"
        }
        return listOf(
            "${check(mic)} Microphone ${if (mic) "allowed" else "not allowed yet"}",
            "${check(speech)} On-device speech ${if (speech) "available" else "unavailable"}",
            kbLine,
            "",
            "1. Allow the microphone.",
            "2. Enable the ColdVoice keyboard, then tap \"Switch to ColdVoice keyboard\" and pick it.",
            "3. Focus the field below (or any text field) to dictate — or enable the flow bubble for any app."
        ).joinToString("\n")
    }
}

package com.coldvoice

import android.Manifest
import android.app.Activity
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
import android.widget.Button
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
        root.addView(actionButton("Enable ColdVoice keyboard") { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) })
        root.addView(actionButton("Enable ColdVoice flow bubble") { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })

        scroll.addView(root)
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        statusView?.text = setupStatus()
        engineView?.text = engineStatus()
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
        return listOf(
            "${check(mic)} Microphone ${if (mic) "allowed" else "not allowed yet"}",
            "${check(speech)} On-device speech ${if (speech) "available" else "unavailable"}",
            "",
            "1. Allow the microphone.",
            "2. Enable the ColdVoice keyboard, then switch to it from any text field.",
            "3. Or enable the flow bubble to dictate into apps without switching keyboards."
        ).joinToString("\n")
    }
}

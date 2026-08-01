package com.coldvoice

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
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
import com.coldvoice.a11y.ColdVoiceBubbleService
import com.coldvoice.data.Settings as CvSettings
import com.coldvoice.net.Connectivity

/**
 * Setup screen. ColdVoice on Android is a floating bubble, not a keyboard — the
 * user keeps whatever keyboard they already use, and the bubble appears at the
 * right edge whenever a text field has focus.
 *
 * Everything ColdVoice needs is requested here, in the order Android will accept
 * it: the microphone, then (for sideloaded builds on Android 13+) the restricted
 * settings unlock, then the accessibility service that powers the bubble.
 */
class MainActivity : Activity() {

    private var statusView: TextView? = null
    private var engineView: TextView? = null
    private var micButton: Button? = null
    private var bubbleButton: Button? = null
    private var restrictedButton: Button? = null
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
            text = "Voice dictation for any app. Keep your own keyboard — a ColdVoice bubble appears at the side of the screen whenever you tap into a text field."
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

        micButton = actionButton("1 · Allow the microphone") { requestMicPermission() }
        root.addView(micButton)

        // Android 13+ blocks accessibility for apps installed outside the Play
        // Store until "restricted settings" are unlocked from App info. Without
        // this step the bubble switch is greyed out with no explanation.
        restrictedButton = actionButton("2 · Unlock restricted settings") { openAppInfo() }
        root.addView(restrictedButton)

        bubbleButton = actionButton("3 · Turn on the ColdVoice bubble") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        root.addView(bubbleButton)

        val tryLabel = TextView(this).apply {
            text = "Try it here"
            setTextColor(Color.parseColor("#7A7C82"))
            textSize = 13f
            setPadding(dp(2), dp(24), 0, dp(8))
        }
        val tryField = EditText(this).apply {
            hint = "Tap here — the ColdVoice bubble appears on the right. Tap it and speak."
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

        // The keyboard is still bundled for anyone who prefers it, but it is no
        // longer part of setup — the bubble is the way ColdVoice works now.
        root.addView(TextView(this).apply {
            text = "Prefer a voice keyboard instead? The optional ColdVoice keyboard is still available in your keyboard settings."
            setTextColor(Color.parseColor("#55585F"))
            textSize = 12f
            setPadding(dp(2), dp(22), 0, 0)
        })
        root.addView(actionButton("Keyboard settings (optional)") {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        })

        scroll.addView(root)
        setContentView(scroll)

        // The bubble sends the user here when it needs the mic and can't ask itself.
        if (intent?.getBooleanExtra(EXTRA_REQUEST_MIC, false) == true) requestMicPermission()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent?.getBooleanExtra(EXTRA_REQUEST_MIC, false) == true) requestMicPermission()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refresh()
    }

    private fun refresh() {
        statusView?.text = setupStatus()
        engineView?.text = engineStatus()
        micButton?.text =
            if (hasMic()) "1 · Microphone allowed ✓" else "1 · Allow the microphone"
        restrictedButton?.text =
            if (bubbleEnabled()) "2 · Restricted settings unlocked ✓" else "2 · Unlock restricted settings"
        bubbleButton?.text =
            if (bubbleEnabled()) "3 · ColdVoice bubble is on ✓" else "3 · Turn on the ColdVoice bubble"
    }

    private fun hasMic(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    private fun requestMicPermission() {
        if (!hasMic()) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 1001)
        }
    }

    /** App info, where Android 13+ hides the "Allow restricted settings" item. */
    private fun openAppInfo() {
        startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
        )
    }

    /** Is our accessibility service (the bubble) currently switched on? */
    private fun bubbleEnabled(): Boolean {
        val expected = "$packageName/${ColdVoiceBubbleService::class.java.name}"
        val enabled = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        for (entry in splitter) {
            if (entry.equals(expected, ignoreCase = true)) return true
        }
        return false
    }

    private fun keyboardEnabled(): Boolean {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        return imm.enabledInputMethodList.any { it.packageName == packageName }
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
        val lines = mutableListOf(
            "${check(hasMic())} Microphone ${if (hasMic()) "allowed" else "not allowed yet"}",
            "${check(bubbleEnabled())} ColdVoice bubble ${if (bubbleEnabled()) "on" else "off"}",
            "${check(keyboardEnabled())} ColdVoice keyboard (optional) ${if (keyboardEnabled()) "enabled" else "not enabled"}",
            "",
            "How it works: tap any text field, the ColdVoice square appears on the right of the screen. Tap it to expand and start dictating, then tap ✓ to drop the text into the field."
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !bubbleEnabled()) {
            lines.add("")
            lines.add("If the bubble switch is greyed out: open App info, tap the ⋮ menu, choose \"Allow restricted settings\", then try step 3 again. Android does this for every app installed outside the Play Store.")
        }
        return lines.joinToString("\n")
    }

    companion object {
        const val EXTRA_REQUEST_MIC = "coldvoice.requestMic"
    }
}

package com.coldvoice.ime

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.coldvoice.dictation.DictationController
import com.coldvoice.input.InsertionGuard
import com.coldvoice.net.Connectivity
import com.coldvoice.ui.PillView

/**
 * The ColdVoice voice keyboard. Redesigned to match the desktop look — a clean,
 * blackish, minimal panel — and to share the desktop dictation flow via
 * [DictationController]: cloud Groq when online, on-device recognizer offline.
 * Tap the pill's check to dictate; cleaned text is committed into the field.
 */
class ColdVoiceImeService : InputMethodService(), DictationController.Callbacks {

    private var controller: DictationController? = null
    private var pill: PillView? = null
    private var statusView: TextView? = null
    private var hintView: TextView? = null
    private var listening = false
    private val dictated = StringBuilder()

    override fun onCreate() {
        super.onCreate()
        controller = DictationController(this, this)
        Connectivity.start(this)
    }

    override fun onCreateInputView(): View {
        val density = resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0C0E"))
            setPadding(dp(20), dp(16), dp(20), dp(20))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(this).apply {
            text = "ColdVoice"
            setTextColor(Color.WHITE)
            textSize = 15f
            setTypeface(typeface, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        statusView = TextView(this).apply {
            textSize = 12f
            setPadding(dp(10), dp(4), dp(10), dp(4))
            background = chip()
            setTextColor(Color.parseColor("#B5B7BD"))
        }
        header.addView(title)
        header.addView(statusView)

        pill = PillView(this).apply {
            onCancel = { onCancelTapped() }
            onConfirm = { onConfirmTapped() }
            setState(PillView.State.IDLE)
        }
        val pillRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(12))
            addView(pill, LinearLayout.LayoutParams(dp(190), dp(40)))
        }

        hintView = TextView(this).apply {
            text = "Tap ✓ to dictate · ✕ to cancel"
            setTextColor(Color.parseColor("#6B6E76"))
            textSize = 12f
            gravity = Gravity.CENTER
        }

        root.addView(header)
        root.addView(pillRow)
        root.addView(hintView)
        refreshStatus()
        return root
    }

    override fun onStartInputView(info: android.view.inputmethod.EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        refreshStatus()
    }

    private fun chip(): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = 999f
        setColor(Color.parseColor("#15161B"))
        setStroke((resources.displayMetrics.density).toInt(), Color.parseColor("#23242B"))
    }

    private fun refreshStatus() {
        val online = Connectivity.isOnline(this)
        val cloud = controller?.plannedEngine() == DictationController.Engine.CLOUD
        statusView?.text = when {
            cloud -> "● Online · Cloud"
            online -> "● Online · Offline ASR"
            else -> "○ Offline"
        }
        statusView?.setTextColor(
            if (cloud) Color.parseColor("#69E0A6") else Color.parseColor("#B5B7BD")
        )
    }

    private fun onConfirmTapped() {
        if (listening) stopListening() else startListening()
    }

    private fun onCancelTapped() {
        if (listening) cancelListening()
    }

    private fun startListening() {
        if (!InsertionGuard.canInsert(currentInputEditorInfo)) {
            hintView?.text = "Cannot dictate into this field."
            return
        }
        if (!hasMicPermission()) {
            hintView?.text = "Allow microphone permission for ColdVoice in Android settings."
            return
        }
        dictated.setLength(0)
        listening = true
        pill?.setState(PillView.State.RECORDING)
        hintView?.text = "Listening…"
        controller?.start()
    }

    private fun stopListening() {
        controller?.stop()
        pill?.setState(PillView.State.TRANSCRIBING)
        hintView?.text = "Transcribing…"
    }

    private fun cancelListening() {
        controller?.cancel()
        listening = false
        pill?.setState(PillView.State.IDLE)
        hintView?.text = "Tap ✓ to dictate · ✕ to cancel"
    }

    // --- DictationController callbacks ----------------------------------------
    override fun onState(state: DictationController.State, message: String?) {
        when (state) {
            DictationController.State.RECORDING -> pill?.setState(PillView.State.RECORDING)
            DictationController.State.TRANSCRIBING -> pill?.setState(PillView.State.TRANSCRIBING)
            DictationController.State.DONE -> {
                listening = false
                pill?.setState(PillView.State.DONE)
                pill?.postDelayed({ pill?.setState(PillView.State.IDLE) }, 900)
                hintView?.text = "Tap ✓ to dictate · ✕ to cancel"
                refreshStatus()
            }
            DictationController.State.INFO -> {
                listening = false
                pill?.setState(PillView.State.INFO, message)
                hintView?.text = message ?: ""
                pill?.postDelayed({ pill?.setState(PillView.State.IDLE) }, 1200)
            }
            DictationController.State.ERROR -> {
                listening = false
                pill?.setState(PillView.State.ERROR, message)
                hintView?.text = message ?: "Error"
                pill?.postDelayed({ pill?.setState(PillView.State.IDLE) }, 1600)
            }
        }
    }

    override fun onLevel(level: Float) { pill?.setLevel(level) }

    override fun onPreview(text: String) {
        if (listening && text.isNotBlank()) hintView?.text = text
    }

    override fun onCommit(text: String) {
        if (!InsertionGuard.canInsert(currentInputEditorInfo)) return
        val piece = if (dictated.isEmpty()) text else " $text"
        currentInputConnection?.commitText(piece, 1)
        dictated.append(piece)
    }

    override fun onComplete(fullText: String) {
        if (dictated.isNotBlank()) copyToClipboard(dictated.toString().trim())
    }

    override fun onFinishInput() {
        super.onFinishInput()
        if (listening) controller?.cancel()
        listening = false
    }

    override fun onDestroy() {
        controller?.destroy()
        controller = null
        Connectivity.stop()
        super.onDestroy()
    }

    private fun copyToClipboard(text: String) {
        val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        clip.setPrimaryClip(ClipData.newPlainText("ColdVoice", text))
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}

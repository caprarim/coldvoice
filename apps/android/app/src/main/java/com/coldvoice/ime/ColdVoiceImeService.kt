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
import android.os.Build
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
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

    // Manual typing keyboard state.
    private var keyboardContainer: LinearLayout? = null
    private var shifted = false
    private var symbolsMode = false

    override fun onCreate() {
        super.onCreate()
        controller = DictationController(this, this)
        Connectivity.start(this)
    }

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0C0E"))
            setPadding(dp(8), dp(10), dp(8), dp(8))
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), 0)
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

        // Dictation row: the voice pill plus a compact hint, kept above the keys
        // so the user can either speak or type from the same panel.
        pill = PillView(this).apply {
            onCancel = { onCancelTapped() }
            onConfirm = { onConfirmTapped() }
            onPause = { if (listening) controller?.togglePause() }
            setState(PillView.State.IDLE)
        }
        hintView = TextView(this).apply {
            text = "Tap ✓ to dictate · 🌐 = your keyboard"
            setTextColor(Color.parseColor("#6B6E76"))
            textSize = 12f
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setPadding(dp(12), 0, 0, 0)
        }
        val pillRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(8), dp(8), dp(10))
            addView(pill, LinearLayout.LayoutParams(dp(212), dp(56)))
            addView(hintView)
        }

        keyboardContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        root.addView(header)
        root.addView(pillRow)
        root.addView(keyboardContainer)
        renderKeyboard()
        refreshStatus()
        return root
    }

    // --- Manual typing keyboard ----------------------------------------------

    private val lettersRows = listOf(
        listOf("q", "w", "e", "r", "t", "y", "u", "i", "o", "p"),
        listOf("a", "s", "d", "f", "g", "h", "j", "k", "l"),
        listOf("z", "x", "c", "v", "b", "n", "m")
    )
    private val symbolsRows = listOf(
        listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0"),
        listOf("@", "#", "$", "_", "&", "-", "+", "(", ")", "/"),
        listOf("*", "\"", "'", ":", ";", "!", "?", ",", ".")
    )

    /** Build (or rebuild) the key grid for the current letters/symbols + shift state. */
    private fun renderKeyboard() {
        val container = keyboardContainer ?: return
        container.removeAllViews()
        val rows = if (symbolsMode) symbolsRows else lettersRows
        rows.forEachIndexed { i, keys ->
            if (i == rows.lastIndex) {
                // Third row carries shift (letters only) on the left and backspace on the right.
                val leading = if (symbolsMode) null else shiftKey()
                val trailing = specialKey("⌫", 1.6f) { onBackspaceKey() }
                container.addView(keyRow(keys, leading, trailing))
            } else {
                container.addView(keyRow(keys))
            }
        }
        container.addView(bottomRow())
    }

    private fun shiftKey(): TextView = keyView("⇧", 1.6f, special = true) { toggleShift() }.apply {
        if (shifted) {
            setTextColor(Color.parseColor("#0B0C0E"))
            background = (background as GradientDrawable).also { it.setColor(Color.parseColor("#69E0A6")) }
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun keyRow(keys: List<String>, leading: View? = null, trailing: View? = null): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        leading?.let { row.addView(it) }
        for (k in keys) {
            val label = if (!symbolsMode && shifted) k.uppercase() else k
            row.addView(charKey(label, 1f) { onCharKey(k) })
        }
        trailing?.let { row.addView(it) }
        return row
    }

    /** The spacebar row: keyboard switch · mode toggle · comma · space · period · enter. */
    private fun bottomRow(): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        val modeLabel = if (symbolsMode) "ABC" else "?123"
        row.addView(specialKey("🌐", 1.2f) { switchToSystemKeyboard() })
        row.addView(specialKey(modeLabel, 1.4f) { toggleSymbols() })
        row.addView(charKey(",", 1f) { onCharKey(",") })
        row.addView(specialKey("space", 3.6f) { onCharKey(" ") })
        row.addView(charKey(".", 1f) { onCharKey(".") })
        row.addView(specialKey("⏎", 1.4f) { onEnterKey() })
        return row
    }

    /**
     * Switch back to the user's normal keyboard (e.g. the Samsung keyboard) so
     * they can type with it while the ColdVoice bubble handles dictation. Falls
     * back to the system IME picker when no previous keyboard is known.
     */
    private fun switchToSystemKeyboard() {
        val switched = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            switchToPreviousInputMethod()
        } else {
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            @Suppress("DEPRECATION")
            imm.switchToLastInputMethod(window?.window?.attributes?.token)
        }
        if (!switched) {
            (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        }
    }

    private fun onCharKey(base: String) {
        val out = if (!symbolsMode && shifted) base.uppercase() else base
        currentInputConnection?.commitText(out, 1)
        if (shifted && !symbolsMode) { shifted = false; renderKeyboard() }
    }

    private fun onEnterKey() {
        val ic = currentInputConnection ?: return
        ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
        ic.sendKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
    }

    private fun onBackspaceKey() {
        currentInputConnection?.deleteSurroundingText(1, 0)
    }

    private fun toggleShift() {
        shifted = !shifted
        renderKeyboard()
    }

    private fun toggleSymbols() {
        symbolsMode = !symbolsMode
        shifted = false
        renderKeyboard()
    }

    /** A standard tappable character key. */
    private fun charKey(label: String, weight: Float, onClick: () -> Unit): TextView =
        keyView(label, weight, special = false, onClick = onClick)

    /** A function key (shift, backspace, space, enter, mode) — styled distinctly. */
    private fun specialKey(label: String, weight: Float, onClick: () -> Unit): TextView =
        keyView(label, weight, special = true, onClick = onClick)

    private fun keyView(label: String, weight: Float, special: Boolean, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            setTextColor(if (special) Color.parseColor("#C9CCD4") else Color.WHITE)
            textSize = if (special) 13f else 18f
            background = keyBg(special)
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, dp(46), weight).apply {
                marginStart = dp(3); marginEnd = dp(3); topMargin = dp(4); bottomMargin = dp(4)
            }
        }

    private fun keyBg(special: Boolean): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(8).toFloat()
        setColor(Color.parseColor(if (special) "#15161B" else "#1C1D24"))
        setStroke(dp(1), Color.parseColor("#26272F"))
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
        val onDevice = controller?.offlineModelReady() == true
        statusView?.text = when {
            cloud -> "● Online · Cloud"
            onDevice && online -> "● On-device"
            onDevice -> "● Offline · On-device"
            else -> "○ Preparing…"
        }
        statusView?.setTextColor(
            if (cloud || onDevice) Color.parseColor("#69E0A6") else Color.parseColor("#B5B7BD")
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
        controller?.targetApp = targetAppLabel()
        controller?.start()
    }

    private fun targetAppLabel(): String? {
        val pkg = currentInputEditorInfo?.packageName?.takeIf { it.isNotBlank() } ?: return null
        return try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
            pkg
        }
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
            DictationController.State.RECORDING -> {
                pill?.setState(PillView.State.RECORDING)
                hintView?.text = "Listening…"
            }
            DictationController.State.PAUSED -> {
                pill?.setState(PillView.State.PAUSED)
                hintView?.text = "Paused · tap ▶ to carry on"
            }
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
        val ic = currentInputConnection ?: return
        // Space off whatever is already in front of the caret, not just previous
        // chunks of this dictation — otherwise speaking into a field that already
        // ends in a word runs the two together.
        val before = ic.getTextBeforeCursor(1, 0)?.toString().orEmpty()
        val needsSpace = before.isNotEmpty() && !before.last().isWhitespace()
        val piece = if (needsSpace) " $text" else text
        ic.commitText(piece, 1)
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

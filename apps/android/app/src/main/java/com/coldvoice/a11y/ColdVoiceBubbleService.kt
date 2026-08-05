package com.coldvoice.a11y

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import androidx.core.content.ContextCompat
import com.coldvoice.MainActivity
import com.coldvoice.dictation.DictationController
import com.coldvoice.input.InsertionGuard
import com.coldvoice.net.Connectivity
import com.coldvoice.ui.BubbleView
import com.coldvoice.ui.PillView
import kotlin.math.abs

/**
 * The floating ColdVoice control, Wispr-style. It has two faces:
 *
 *  - **Collapsed**: a small square carrying the ColdVoice mark, parked at the
 *    right edge, vertically centred. It exists ONLY while an editable,
 *    non-password field has focus, so it never floats over the home screen or a
 *    reading app.
 *  - **Expanded**: tapping the square swaps it for the dictation pill and starts
 *    listening straight away — cancel · waveform · pause/play · confirm. Confirm
 *    ends the dictation and writes the finished text into the field; cancel
 *    throws it away. Nothing is written until confirm, so an abandoned dictation
 *    never leaves half a sentence behind.
 *
 * The user keeps their own keyboard throughout; ColdVoice never replaces it.
 */
class ColdVoiceBubbleService : AccessibilityService(), DictationController.Callbacks {

    private var windowManager: WindowManager? = null
    private var bubble: BubbleView? = null
    private var pill: PillView? = null
    private var attached: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var focusedNode: AccessibilityNodeInfo? = null
    private var controller: DictationController? = null

    private var expanded = false
    private var listening = false

    // User-applied drag offset from the default right-centre anchor, kept so the
    // control reappears wherever it was last dropped.
    private var offsetX = 0
    private var offsetY = 0

    // Everything dictated this session. What the field already held is re-read at
    // insertion time instead of being snapshotted, so nothing typed while the
    // pill was open is lost and no stale placeholder can be carried forward.
    private val dictated = StringBuilder()
    private val main = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        controller = DictationController(this, this)
        Connectivity.start(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED -> {
                focusHint = true
                scheduleFocusCheck()
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOWS_CHANGED -> scheduleFocusCheck()
            else -> Unit
        }
    }

    /**
     * Events arrive in bursts — a tap on a field emits focus, selection and window
     * changes within a few milliseconds, and the keyboard adds its own on top.
     * Re-evaluating on each one made the control blink, so the tail of the burst
     * is collapsed into a single check.
     *
     * The first event of a burst is acted on immediately, though, and that is
     * what stopped the square arriving late. Debouncing alone rescheduled the
     * check on every event, and a keyboard sliding in emits content-changed
     * events for as long as it animates — so the check kept being pushed further
     * out and the control only appeared once the screen had settled.
     */
    private fun scheduleFocusCheck() {
        main.removeCallbacks(focusCheck)
        val now = System.currentTimeMillis()
        if (attached == null && now - lastImmediateCheck >= IMMEDIATE_MIN_GAP_MS) {
            lastImmediateCheck = now
            evaluateFocus(deep = false)
        }
        main.postDelayed(focusCheck, FOCUS_DEBOUNCE_MS)
    }

    private val focusCheck = Runnable {
        val hinted = focusHint
        focusHint = false
        evaluateFocus(deep = attached != null || focusedNode != null || hinted)
    }
    private val hideRunnable = Runnable { hideNow() }
    private var lastImmediateCheck = 0L
    private var focusHint = false

    private fun evaluateFocus(deep: Boolean) {
        // Never yank the control out from under a live dictation.
        if (expanded || listening) return
        val node = editableFocus(deep = deep)
        if (node != null) {
            main.removeCallbacks(hideRunnable)
            if (node !== focusedNode) {
                focusedNode?.recycle()
                focusedNode = AccessibilityNodeInfo.obtain(node)
            }
            showCollapsed()
        } else if (attached != null || focusedNode != null) {
            // The editor is often momentarily unreachable while the keyboard or a
            // suggestion popup takes the active window. Give it a beat to come
            // back before folding the control away.
            main.removeCallbacks(hideRunnable)
            main.postDelayed(hideRunnable, HIDE_GRACE_MS)
        }
    }

    private fun hideNow() {
        if (expanded || listening) return
        if (editableFocus(deep = true) != null) return
        focusedNode?.recycle()
        focusedNode = null
        detach()
    }

    /**
     * The focused editor, wherever it lives. The event's own source is not
     * trusted: keyboard and popup windows report themselves as the source, which
     * would otherwise read as "no text field" and hide the control mid-typing.
     *
     * The `deep` sweep walks every window, so it is reserved for the settled
     * check at the end of an event burst — the cheap lookups run first, and the
     * sweep only matters when they come back empty because the editor slipped
     * behind a popup or the keyboard's window.
     */
    private fun editableFocus(deep: Boolean): AccessibilityNodeInfo? {
        findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.let {
            if (InsertionGuard.canInsert(it, it.packageName)) return it
        }
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.let {
            if (InsertionGuard.canInsert(it, it.packageName)) return it
        }
        if (!deep) return null
        val list = try { windows } catch (_: Exception) { null } ?: return null
        for (window in list) {
            if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
            val root = window.root ?: continue
            val focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: continue
            if (InsertionGuard.canInsert(focus, focus.packageName)) return focus
        }
        return null
    }

    // --- overlay plumbing -----------------------------------------------------

    private fun ensureBubble(): BubbleView =
        bubble ?: BubbleView(this).also {
            it.onTap = { expand() }
            attachDrag(it)
            bubble = it
        }

    private fun ensurePill(): PillView =
        pill ?: PillView(this).also {
            it.onCancel = { onCancelTapped() }
            it.onConfirm = { onConfirmTapped() }
            it.onPause = { onPauseTapped() }
            attachDrag(it)
            pill = it
        }

    /**
     * Swap whichever face is on screen. Both are anchored to the right edge at
     * the vertical centre, offset by whatever the user has dragged.
     */
    private fun attach(view: View, widthDp: Int, heightDp: Int) {
        val manager = windowManager ?: return
        if (attached != null && attached !== view) detach()

        val w = dp(widthDp)
        val h = dp(heightDp)
        val metrics = resources.displayMetrics
        val lp = params ?: WindowManager.LayoutParams(
            w, h,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
        params = lp
        lp.width = w
        lp.height = h
        lp.x = (metrics.widthPixels - w - dp(10) + offsetX)
            .coerceIn(0, (metrics.widthPixels - w).coerceAtLeast(0))
        lp.y = (metrics.heightPixels / 2 - h / 2 + offsetY)
            .coerceIn(0, (metrics.heightPixels - h).coerceAtLeast(0))

        if (view.parent == null) manager.addView(view, lp) else manager.updateViewLayout(view, lp)
        attached = view
    }

    private fun detach() {
        val view = attached ?: return
        if (view.parent != null) {
            try { windowManager?.removeView(view) } catch (_: IllegalArgumentException) {}
        }
        attached = null
    }

    private fun showCollapsed() {
        expanded = false
        val view = ensureBubble()
        if (attached === view && view.parent != null) return
        attach(view, BUBBLE_DP, BUBBLE_DP)
    }

    private fun showExpanded() {
        expanded = true
        attach(ensurePill(), PILL_W_DP, PILL_H_DP)
    }

    // --- drag -----------------------------------------------------------------
    private fun attachDrag(view: View) {
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        val touchSlop = dp(6)
        view.setOnTouchListener { _, e ->
            val lp = params ?: return@setOnTouchListener false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = e.rawX; downRawY = e.rawY
                    startX = lp.x; startY = lp.y
                    dragging = false
                    false // let the buttons see the press too
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downRawX).toInt()
                    val dy = (e.rawY - downRawY).toInt()
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
                    if (dragging) {
                        lp.x = startX + dx
                        lp.y = startY + dy
                        try { windowManager?.updateViewLayout(view, lp) } catch (_: Exception) {}
                        true
                    } else false
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) rememberOffset(lp)
                    dragging
                }
                else -> false
            }
        }
    }

    /** Store the drop position as an offset from the default right-centre anchor. */
    private fun rememberOffset(lp: WindowManager.LayoutParams) {
        val metrics = resources.displayMetrics
        offsetX = lp.x - (metrics.widthPixels - lp.width - dp(10))
        offsetY = lp.y - (metrics.heightPixels / 2 - lp.height / 2)
    }

    // --- button handlers ------------------------------------------------------

    private fun expand() {
        if (!hasMicPermission()) {
            requestMicPermission()
            return
        }
        showExpanded()
        startListening()
    }

    private fun collapse() {
        // Both flags have to clear here. evaluateFocus() refuses to touch the
        // overlay while either is set, so leaving `expanded` true on the detach
        // path — which is what happened whenever the field lost focus during a
        // dictation — permanently wedged the bubble: it never came back, and
        // there was no way to dictate again short of restarting the service.
        listening = false
        expanded = false
        if (focusedNode != null) showCollapsed() else detach()
    }

    /** Tick: end the dictation and write the result into the field. */
    private fun onConfirmTapped() {
        // A controller that never got started (mic busy, permission pulled) would
        // ignore stop(), leaving the pill spinning on "transcribing" forever with
        // `listening` stuck true. Fold up instead of waiting for a callback that
        // is never coming.
        if (!listening || controller?.isActive != true) { collapse(); return }
        pill?.setState(PillView.State.TRANSCRIBING)
        controller?.stop()
    }

    /** Cross: throw the dictation away and fold back to the square. */
    private fun onCancelTapped() {
        controller?.cancel()
        dictated.setLength(0)
        collapse()
    }

    private fun onPauseTapped() {
        if (!listening) return
        controller?.togglePause()
    }

    private fun startListening() {
        dictated.setLength(0)
        listening = true
        pill?.setState(PillView.State.RECORDING)
        controller?.targetApp = focusedAppLabel()
        controller?.start()
    }

    /**
     * The app being dictated into, by its display name, so the history reads
     * "WhatsApp" rather than "com.whatsapp".
     */
    private fun focusedAppLabel(): String? {
        val pkg = focusedNode?.packageName?.toString()?.takeIf { it.isNotBlank() } ?: return null
        return try {
            val pm = packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
            pkg
        }
    }

    // --- DictationController callbacks ----------------------------------------
    override fun onState(state: DictationController.State, message: String?) {
        when (state) {
            DictationController.State.RECORDING -> pill?.setState(PillView.State.RECORDING)
            DictationController.State.PAUSED -> pill?.setState(PillView.State.PAUSED)
            DictationController.State.TRANSCRIBING -> pill?.setState(PillView.State.TRANSCRIBING)
            DictationController.State.DONE -> {
                listening = false
                pill?.setState(PillView.State.DONE)
                main.postDelayed({ collapse() }, 800)
            }
            DictationController.State.INFO -> {
                listening = false
                pill?.setState(PillView.State.INFO, message)
                main.postDelayed({ collapse() }, 1200)
            }
            DictationController.State.ERROR -> {
                listening = false
                pill?.setState(PillView.State.ERROR, message)
                main.postDelayed({ collapse() }, 1800)
            }
        }
    }

    override fun onLevel(level: Float) { pill?.setLevel(level) }

    /**
     * Live partials are deliberately NOT written into the field. The text lands
     * once, on confirm, so cancelling leaves the field exactly as it was.
     */
    override fun onPreview(text: String) = Unit

    override fun onCommit(text: String) {
        if (dictated.isNotEmpty()) dictated.append(' ')
        dictated.append(text)
    }

    override fun onComplete(fullText: String) {
        val all = dictated.toString().trim()
        if (all.isNotBlank()) writeField(all)
    }

    /**
     * What the user has actually typed into [node] — empty when the field is
     * showing its placeholder.
     *
     * An empty editor reports its placeholder as its text: Google's search box
     * answers "Ask Google", Gemini's answers "Ask Gemini". `isShowingHintText`
     * and `hintText` are the documented way to tell those apart from real
     * content, but a large share of apps never set either — Chrome and every
     * WebView-hosted field publish the placeholder as the node's
     * contentDescription instead, and some custom editors publish it as nothing
     * at all. Relying on the documented flags alone is what put "Ask Google" in
     * front of every dictation. So all three sources are checked, and a field
     * whose entire contents look like a placeholder with the caret still parked
     * at position zero is treated as empty too.
     */
    private fun fieldText(node: AccessibilityNodeInfo): String {
        val text = node.text?.toString().orEmpty()
        if (text.isBlank()) return ""
        if (node.isShowingHintText) return ""
        val body = text.trim()
        val hint = node.hintText?.toString().orEmpty().trim()
        if (hint.isNotEmpty() && body.equals(hint, ignoreCase = true)) return ""
        val description = node.contentDescription?.toString().orEmpty().trim()
        if (description.isNotEmpty() && body.equals(description, ignoreCase = true)) return ""
        if (looksLikePlaceholder(body) && node.textSelectionEnd <= 0) return ""
        return text
    }

    /**
     * The shape of an app's empty-field prompt: a short, unpunctuated call to
     * action. Only consulted when the caret says the field was never typed in,
     * so a real sentence that happens to start this way is still kept.
     */
    private fun looksLikePlaceholder(text: String): Boolean {
        if (text.length > PLACEHOLDER_MAX_CHARS) return false
        if (text.last() in ".!?,;:") return false
        return PLACEHOLDER_SHAPE.matches(text)
    }

    /** Live contents of the focused editor, or "" when it is showing a placeholder. */
    private fun currentFieldText(): String {
        val node = focusedNode ?: return ""
        try { node.refresh() } catch (_: Exception) {}
        return try { fieldText(node) } catch (_: Exception) { "" }
    }

    /**
     * Put the finished text into the field.
     *
     * Pasting is tried first: it drops the text in at the caret, replaces the
     * selection if there is one, and needs no idea of what the field already
     * held — so a placeholder can never be swept up into the result. Editors
     * that don't offer a paste action fall back to rewriting the field, and only
     * that path has to reason about existing contents, which it re-reads live
     * rather than trusting the snapshot taken when dictation started.
     */
    private fun writeField(text: String) {
        if (text.isBlank()) return
        val node = liveEditor() ?: return
        if (!InsertionGuard.canInsert(node, node.packageName)) return
        copyToClipboard(text)
        if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) return
        setFieldText(node, joinWithExisting(fieldText(node), text))
    }

    /** The focused editor as it exists right now, not as it was at start. */
    private fun liveEditor(): AccessibilityNodeInfo? {
        focusedNode?.let { node ->
            val alive = try { node.refresh() } catch (_: Exception) { false }
            if (alive) return node
        }
        return editableFocus(deep = true)
    }

    private fun joinWithExisting(existing: String, dictatedText: String): String {
        val head = existing.trim()
        if (head.isEmpty()) return dictatedText
        return "$head $dictatedText"
    }

    private fun setFieldText(node: AccessibilityNodeInfo, text: String) {
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return
        val end = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, text.length)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, text.length)
        }
        node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, end)
    }

    private fun copyToClipboard(text: String) {
        val clip = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        clip.setPrimaryClip(ClipData.newPlainText("ColdVoice", text))
    }

    private fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    /** Only the app can ask for a runtime permission, so hand off to setup. */
    private fun requestMicPermission() {
        startActivity(
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(MainActivity.EXTRA_REQUEST_MIC, true)
            }
        )
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onInterrupt() {
        controller?.cancel()
        collapse()
    }

    override fun onDestroy() {
        main.removeCallbacks(focusCheck)
        main.removeCallbacks(hideRunnable)
        focusedNode?.recycle()
        focusedNode = null
        controller?.destroy()
        controller = null
        Connectivity.stop()
        detach()
        super.onDestroy()
    }

    private companion object {
        const val FOCUS_DEBOUNCE_MS = 150L
        /** Ceiling on how often the leading-edge check runs during an event storm. */
        const val IMMEDIATE_MIN_GAP_MS = 60L
        const val HIDE_GRACE_MS = 900L
        const val BUBBLE_DP = 56
        const val PILL_W_DP = 252
        const val PILL_H_DP = 60

        const val PLACEHOLDER_MAX_CHARS = 48
        /**
         * "Ask Google", "Ask Gemini", "Search or type URL", "Message", "Type a
         * message", "Send a message to Claude" — the empty-state prompt apps put
         * in a field they have nothing in.
         */
        val PLACEHOLDER_SHAPE = Regex(
            "(?i)^(ask|search|message|chat|talk|type|write|enter|say|send|add|start|reply|compose|tell|describe|find)\\b.*"
        )
    }
}

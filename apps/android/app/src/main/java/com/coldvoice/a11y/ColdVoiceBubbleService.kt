package com.coldvoice.a11y

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.content.ContextCompat
import com.coldvoice.dictation.DictationController
import com.coldvoice.input.InsertionGuard
import com.coldvoice.net.Connectivity
import com.coldvoice.ui.PillView
import kotlin.math.abs

/**
 * Floating mic "flow bubble". It appears ONLY when an editable, non-password
 * input is focused (Wispr-style) and is hidden everywhere else. The bubble is the
 * desktop pill: dark control with cancel · waveform · confirm, draggable anywhere
 * on screen. Dictation runs through [DictationController] — the cloud Groq path
 * when online, the offline on-device recognizer otherwise.
 */
class ColdVoiceBubbleService : AccessibilityService(), DictationController.Callbacks {

    private var windowManager: WindowManager? = null
    private var pill: PillView? = null
    private var params: WindowManager.LayoutParams? = null
    private var focusedNode: AccessibilityNodeInfo? = null
    private var controller: DictationController? = null
    private var listening = false
    private var hasPlacedManually = false

    // Continuous dictation state: the text already in the field when we started,
    // plus everything dictated so far, so we never wipe existing input.
    private var baseText = ""
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
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> evaluateFocus(event)
            else -> Unit
        }
    }

    private fun evaluateFocus(event: AccessibilityEvent) {
        if (listening) return // don't move/hide the bubble mid-dictation
        val node = event.source ?: findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (node != null && InsertionGuard.canInsert(node, event.packageName)) {
            focusedNode?.recycle()
            focusedNode = AccessibilityNodeInfo.obtain(node)
            showBubble(node)
        } else {
            focusedNode?.recycle()
            focusedNode = null
            hideBubble()
        }
    }

    private fun ensurePill(): PillView {
        pill?.let { return it }
        val view = PillView(this).apply {
            onCancel = { onCancelTapped() }
            onConfirm = { onConfirmTapped() }
        }
        attachDrag(view)
        pill = view
        return view
    }

    private fun showBubble(node: AccessibilityNodeInfo) {
        val manager = windowManager ?: return
        val view = ensurePill()
        if (!listening) view.setState(PillView.State.IDLE)

        val lp = params ?: WindowManager.LayoutParams(
            dp(168), dp(38),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }
        params = lp

        // Position just below the focused field the first time; after the user
        // drags it, keep their chosen spot.
        if (!hasPlacedManually) {
            val rect = Rect()
            node.getBoundsInScreen(rect)
            lp.x = (rect.right - dp(168)).coerceAtLeast(dp(8))
            lp.y = (rect.bottom + dp(8)).coerceAtLeast(dp(8))
        }

        if (view.parent == null) manager.addView(view, lp)
        else manager.updateViewLayout(view, lp)
    }

    private fun hideBubble() {
        val view = pill ?: return
        if (view.parent != null) {
            try { windowManager?.removeView(view) } catch (_: IllegalArgumentException) {}
        }
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
                    false // let buttons receive the press too
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downRawX).toInt()
                    val dy = (e.rawY - downRawY).toInt()
                    if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) dragging = true
                    if (dragging) {
                        lp.x = startX + dx
                        lp.y = startY + dy
                        hasPlacedManually = true
                        try { windowManager?.updateViewLayout(view, lp) } catch (_: Exception) {}
                        true
                    } else false
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging
                else -> false
            }
        }
    }

    // --- button handlers ------------------------------------------------------
    private fun onConfirmTapped() {
        if (listening) stopListening() else startListening()
    }

    private fun onCancelTapped() {
        if (listening) cancelListening() else hideBubble()
    }

    private fun startListening() {
        if (!hasMicPermission()) {
            pill?.setState(PillView.State.ERROR, "Allow mic")
            return
        }
        baseText = focusedNode?.text?.toString().orEmpty()
        dictated.setLength(0)
        listening = true
        pill?.setState(PillView.State.RECORDING)
        controller?.start()
    }

    private fun stopListening() {
        controller?.stop()
        pill?.setState(PillView.State.TRANSCRIBING)
    }

    private fun cancelListening() {
        controller?.cancel()
        listening = false
        pill?.setState(PillView.State.IDLE)
    }

    // --- DictationController callbacks ----------------------------------------
    override fun onState(state: DictationController.State, message: String?) {
        when (state) {
            DictationController.State.RECORDING -> pill?.setState(PillView.State.RECORDING)
            DictationController.State.TRANSCRIBING -> pill?.setState(PillView.State.TRANSCRIBING)
            DictationController.State.DONE -> {
                listening = false
                pill?.setState(PillView.State.DONE)
                main.postDelayed({ pill?.setState(PillView.State.IDLE) }, 900)
            }
            DictationController.State.INFO -> {
                listening = false
                pill?.setState(PillView.State.INFO, message)
                main.postDelayed({ pill?.setState(PillView.State.IDLE) }, 1200)
            }
            DictationController.State.ERROR -> {
                listening = false
                pill?.setState(PillView.State.ERROR, message)
                main.postDelayed({ pill?.setState(PillView.State.IDLE) }, 1600)
            }
        }
    }

    override fun onLevel(level: Float) { pill?.setLevel(level) }

    override fun onPreview(text: String) {
        if (listening && text.isNotBlank()) writeField(combine(text))
    }

    override fun onCommit(text: String) {
        if (dictated.isNotEmpty()) dictated.append(' ')
        dictated.append(text)
        writeField(combine(null))
    }

    override fun onComplete(fullText: String) {
        writeField(combine(null))
        val all = dictated.toString().trim()
        if (all.isNotBlank()) copyToClipboard(all)
    }

    /** Combine base field text + dictated text (+ optional live tail). */
    private fun combine(livePartial: String?): String {
        val parts = ArrayList<String>()
        if (baseText.isNotBlank()) parts.add(baseText.trim())
        if (dictated.isNotBlank()) parts.add(dictated.toString().trim())
        if (!livePartial.isNullOrBlank()) parts.add(livePartial.trim())
        return parts.joinToString(" ")
    }

    private fun writeField(text: String) {
        if (text.isBlank()) return
        val node = focusedNode ?: findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        if (!InsertionGuard.canInsert(node, node.packageName)) return
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
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
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onInterrupt() {
        cancelListening()
    }

    override fun onDestroy() {
        focusedNode?.recycle()
        focusedNode = null
        controller?.destroy()
        controller = null
        Connectivity.stop()
        hideBubble()
        super.onDestroy()
    }
}

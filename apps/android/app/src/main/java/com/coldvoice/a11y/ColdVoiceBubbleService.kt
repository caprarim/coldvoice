package com.coldvoice.a11y

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.coldvoice.input.InsertionGuard

/**
 * Optional side-bubble overlay. Transparent in purpose: it listens only for
 * focus / selection changes to know when an editable, non-password field is
 * focused, so it can show or hide the ColdVoice bubble. It never reads or logs
 * password or secure field content.
 *
 * The overlay window itself is added/removed in showBubble()/hideBubble()
 * (WindowManager TYPE_ACCESSIBILITY_OVERLAY) — wired during the bubble UI step.
 */
class ColdVoiceBubbleService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED -> evaluateFocus(event)
            else -> {}
        }
    }

    private fun evaluateFocus(event: AccessibilityEvent) {
        val node: AccessibilityNodeInfo? = event.source
        if (node != null && !node.isPassword && InsertionGuard.canInsert(node, event.packageName)) {
            showBubble(node)
        } else {
            hideBubble()
        }
    }

    /** Insert text into the focused editable node (never a password field). */
    fun insertIntoFocused(text: String) {
        val node = findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return
        if (node.isPassword || !InsertionGuard.canInsert(node, node.packageName)) return
        val args = android.os.Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun showBubble(node: AccessibilityNodeInfo) {
        // TODO(bubble): add a TYPE_ACCESSIBILITY_OVERLAY window positioned beside
        // the node bounds; tap = start dictation, check = insert, X = cancel.
    }

    private fun hideBubble() {
        // TODO(bubble): remove the overlay window if present.
    }

    override fun onInterrupt() {
        hideBubble()
    }
}

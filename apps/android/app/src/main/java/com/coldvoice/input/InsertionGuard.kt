package com.coldvoice.input

import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Mirrors packages/shared/input-detection: decides whether ColdVoice may insert
 * text. Password and secure fields are always rejected.
 */
object InsertionGuard {

    // Apps where dictation/overlay must never engage.
    private val BANKING_BLOCKLIST = setOf(
        "com.google.android.apps.walletnfcrel",
        "com.paypal.android.p2pmobile"
    )

    fun isPasswordEditor(info: EditorInfo?): Boolean {
        if (info == null) return false
        val variation = info.inputType and InputType.TYPE_MASK_VARIATION
        val cls = info.inputType and InputType.TYPE_MASK_CLASS
        if (cls == InputType.TYPE_CLASS_TEXT) {
            if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            ) return true
        }
        if (cls == InputType.TYPE_CLASS_NUMBER &&
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
        ) return true
        return false
    }

    /** IME path: safe to commitText into this editor? */
    fun canInsert(info: EditorInfo?): Boolean {
        if (info == null) return false
        return !isPasswordEditor(info)
    }

    /** Accessibility-bubble path: safe to act on this node? */
    fun canInsert(node: AccessibilityNodeInfo?, packageName: CharSequence?): Boolean {
        if (node == null) return false
        if (node.isPassword) return false
        if (!node.isEditable) {
            val cls = node.className?.toString().orEmpty()
            if (!cls.contains("EditText")) return false
        }
        if (packageName != null && BANKING_BLOCKLIST.contains(packageName.toString())) return false
        return true
    }
}

package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.widget.FrameLayout

/**
 * The collapsed ColdVoice bubble: a small rounded square carrying the app mark,
 * parked at the right edge of the screen whenever a text field has focus. Tapping
 * it expands into the dictation pill.
 */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context) : FrameLayout(context) {

    var onTap: (() -> Unit)? = null

    private val d = context.resources.displayMetrics.density
    private fun dp(v: Float) = (v * d).toInt()

    private val mark = ColdVoiceMarkView(context)

    private val bg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = 14f * d
        setColor(Color.parseColor("#15161B"))
        setStroke(dp(1f), Color.parseColor("#2A2C33"))
    }

    init {
        background = bg
        elevation = 6f * d
        isClickable = true
        val pad = dp(9f)
        addView(mark, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        mark.setPadding(pad, pad, pad, pad)
        setOnClickListener { onTap?.invoke() }
    }

    /** Dim slightly while the service is busy elsewhere. */
    fun setActive(active: Boolean) {
        alpha = if (active) 1f else 0.92f
    }
}

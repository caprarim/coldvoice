package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Outline
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import com.coldvoice.R

/**
 * The collapsed ColdVoice bubble: the app icon itself, parked at the right edge of
 * the screen whenever a text field has focus. Tapping it expands into the
 * dictation pill.
 */
@SuppressLint("ViewConstructor")
class BubbleView(context: Context) : FrameLayout(context) {

    var onTap: (() -> Unit)? = null

    private val d = context.resources.displayMetrics.density

    private val icon = ImageView(context).apply {
        setImageResource(R.mipmap.ic_launcher)
        scaleType = ImageView.ScaleType.FIT_CENTER
    }

    init {
        elevation = 6f * d
        isClickable = true
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                outline.setRoundRect(0, 0, view.width, view.height, 18f * d)
            }
        }
        addView(icon, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        setOnClickListener { onTap?.invoke() }
    }

    /** Dim slightly while the service is busy elsewhere. */
    fun setActive(active: Boolean) {
        alpha = if (active) 1f else 0.92f
    }
}

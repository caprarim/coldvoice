package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/**
 * The ColdVoice mark, drawn in code: the open "C" ring with a voice waveform
 * standing inside it. Vector rather than a bitmap so it stays sharp at the small
 * sizes the floating bubble uses, on any screen density.
 */
@SuppressLint("ViewConstructor")
class ColdVoiceMarkView(context: Context) : View(context) {

    var markColor: Int = Color.parseColor("#E8EAEF")
        set(value) {
            field = value
            invalidate()
        }

    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val oval = RectF()

    // Relative bar heights, tallest in the middle — the same silhouette as the
    // desktop pill's waveform.
    private val heights = floatArrayOf(0.22f, 0.52f, 0.78f, 1.0f, 0.62f)

    override fun onDraw(canvas: Canvas) {
        val size = minOf(width, height).toFloat()
        if (size <= 0f) return
        val cx = width / 2f
        val cy = height / 2f
        val stroke = size * 0.13f
        val radius = size * 0.40f

        ring.color = markColor
        ring.strokeWidth = stroke
        oval.set(cx - radius, cy - radius, cx + radius, cy + radius)
        // Open on the right, like the app icon.
        canvas.drawArc(oval, 38f, 284f, false, ring)

        bar.color = markColor
        val barW = size * 0.075f
        val gap = size * 0.055f
        val span = heights.size * barW + (heights.size - 1) * gap
        var x = cx - span / 2f + size * 0.02f
        val maxH = size * 0.44f
        for (h in heights) {
            val barH = maxH * h
            canvas.drawRoundRect(
                x, cy - barH / 2f, x + barW, cy + barH / 2f,
                barW / 2f, barW / 2f, bar
            )
            x += barW + gap
        }
    }
}

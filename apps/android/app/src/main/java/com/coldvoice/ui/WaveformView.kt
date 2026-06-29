package com.coldvoice.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sin

/**
 * The reactive mic waveform, a direct port of the desktop pill's bar animation
 * (`pill.js` + `pill.css`). Twelve rounded bars, taller in the middle, that
 * react to the live mic level while recording and shimmer while transcribing.
 */
class WaveformView(context: Context) : View(context) {

    enum class Mode { RECORDING, TRANSCRIBING, IDLE }

    private val barCount = 12
    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rect = RectF()

    private var mode = Mode.RECORDING
    @Volatile private var level = 0f
    private var startTime = System.currentTimeMillis()

    // Per-bar base heights for an organic shape (taller in the middle), matching
    // the desktop BASE[] computation.
    private val base = FloatArray(barCount) { i ->
        val mid = (barCount - 1) / 2f
        1f - abs(i - mid) / (mid + 1.2f)
    }

    private val density = context.resources.displayMetrics.density

    init {
        barPaint.color = Color.parseColor("#E8EAEF") // --bar
        barPaint.style = Paint.Style.FILL
    }

    fun setLevel(value: Float) {
        level = value.coerceIn(0f, 1f)
    }

    fun setMode(next: Mode) {
        if (mode == next) return
        mode = next
        when (next) {
            Mode.RECORDING -> {
                barPaint.color = Color.parseColor("#E8EAEF")
                startTime = System.currentTimeMillis()
                postInvalidateOnAnimation()
            }
            Mode.TRANSCRIBING -> {
                barPaint.color = Color.parseColor("#9AA0AD") // desktop shimmer grey
                startTime = System.currentTimeMillis()
                postInvalidateOnAnimation()
            }
            Mode.IDLE -> {
                barPaint.color = Color.parseColor("#6B7280")
                level = 0f
                invalidate()
            }
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        val barW = 2f * density
        val gap = 2f * density
        val totalW = barCount * barW + (barCount - 1) * gap
        var x = (w - totalW) / 2f
        val centerY = h / 2f
        val maxBar = min(h, 14f * density)
        val minBar = 4f * density
        val radius = barW / 2f

        val t = (System.currentTimeMillis() - startTime) / 120.0

        for (i in 0 until barCount) {
            val barH = when (mode) {
                Mode.RECORDING -> {
                    val wobble = 0.5 + 0.5 * sin(t + i * 0.8)
                    val hh = minBar + base[i] * (minBar.toDouble() * 0.0 + (3f * density + level * 16f * density)) *
                        (0.55 + 0.45 * wobble)
                    min(maxBar.toDouble(), hh).toFloat()
                }
                Mode.TRANSCRIBING -> {
                    // Travelling shimmer: each bar peaks slightly after the previous.
                    val phase = t - i * 0.5
                    val s = 0.5 + 0.5 * sin(phase)
                    (minBar + (maxBar - minBar) * 0.7f * s).toFloat()
                }
                Mode.IDLE -> minBar
            }
            val half = barH / 2f
            rect.set(x, centerY - half, x + barW, centerY + half)
            canvas.drawRoundRect(rect, radius, radius, barPaint)
            x += barW + gap
        }

        if (mode != Mode.IDLE) postInvalidateOnAnimation()
    }
}

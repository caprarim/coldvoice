package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

@SuppressLint("ViewConstructor")
class GaugeView(context: Context, private val value: Int, private val max: Int) : View(context) {

    private val d = context.resources.displayMetrics.density
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 10f * d
        color = Ui.STROKE
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 10f * d
        color = Ui.ACCENT
    }
    private val oval = RectF()

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(width, (width * 0.56f).toInt())
    }

    override fun onDraw(canvas: Canvas) {
        val inset = track.strokeWidth / 2f + 2f * d
        val radius = (width - inset * 2f) / 2f
        if (radius <= 0f) return
        val cx = width / 2f
        val cy = height - inset
        oval.set(cx - radius, cy - radius, cx + radius, cy + radius)
        canvas.drawArc(oval, 180f, 180f, false, track)
        val fraction = if (max <= 0) 0f else (value.toFloat() / max).coerceIn(0f, 1f)
        if (fraction > 0f) canvas.drawArc(oval, 180f, 180f * fraction, false, fill)
    }
}

package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.coldvoice.data.Store
import java.util.Calendar

@SuppressLint("ViewConstructor")
class HeatmapView(context: Context, private val byDay: Map<String, Int>) : View(context) {

    private val cell = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val rect = RectF()
    private val d = context.resources.displayMetrics.density

    private val levels = intArrayOf(
        Color.parseColor("#17181D"),
        Color.parseColor("#1E4A38"),
        Color.parseColor("#2C6650"),
        Color.parseColor("#43A579"),
        Color.parseColor("#69E0A6")
    )

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val size = (width - (WEEKS - 1) * gap()) / WEEKS.toFloat()
        val height = (size * ROWS + gap() * (ROWS - 1)).toInt()
        setMeasuredDimension(width, height)
    }

    override fun onDraw(canvas: Canvas) {
        val size = (width - (WEEKS - 1) * gap()) / WEEKS.toFloat()
        if (size <= 0f) return

        val cursor = Calendar.getInstance()
        cursor.add(Calendar.DAY_OF_YEAR, -(WEEKS * ROWS - 1))
        for (column in 0 until WEEKS) {
            for (rowIndex in 0 until ROWS) {
                val count = byDay[Store.dayKey(cursor.timeInMillis)] ?: 0
                cell.color = levels[level(count)]
                val left = column * (size + gap())
                val top = rowIndex * (size + gap())
                rect.set(left, top, left + size, top + size)
                canvas.drawRoundRect(rect, 2f * d, 2f * d, cell)
                cursor.add(Calendar.DAY_OF_YEAR, 1)
            }
        }
    }

    private fun level(count: Int): Int = when {
        count == 0 -> 0
        count == 1 -> 1
        count <= 3 -> 2
        count <= 6 -> 3
        else -> 4
    }

    private fun gap(): Float = 3f * d

    private companion object {
        const val WEEKS = 20
        const val ROWS = 7
    }
}

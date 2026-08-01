package com.coldvoice.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The floating "flow bubble" — a faithful port of the desktop pill
 * (`pill.html` / `pill.css`): a dark rounded control with a circular cancel (X)
 * button, a reactive mic waveform in the middle, and a circular confirm (check)
 * button. Text states (info / error / done) swap the waveform for a small label,
 * exactly like the desktop version.
 *
 * Built entirely in code to match this project's no-XML-layout convention.
 */
@SuppressLint("ViewConstructor")
class PillView(context: Context) : LinearLayout(context) {

    enum class State { RECORDING, PAUSED, TRANSCRIBING, IDLE, INFO, ERROR, DONE }

    var onCancel: (() -> Unit)? = null
    var onConfirm: (() -> Unit)? = null
    var onPause: (() -> Unit)? = null

    private val d = context.resources.displayMetrics.density
    private fun dp(v: Float) = (v * d).toInt()

    private val background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = 9f * d
        setColor(Color.parseColor("#101114"))   // --bg
        setStroke(dp(1f), Color.parseColor("#2A2A2F"))
    }

    private val cancelButton = IconButton(context, IconButton.Icon.CANCEL).apply {
        circleColor = Color.parseColor("#20222A")        // --side
        iconColor = Color.parseColor("#CFD3DC")          // --side-fg
        pressedCircleColor = Color.parseColor("#E0556A") // cancel:hover
        pressedIconColor = Color.WHITE
        setOnClickListener { onCancel?.invoke() }
    }

    private val pauseButton = IconButton(context, IconButton.Icon.PAUSE).apply {
        circleColor = Color.parseColor("#20222A")
        iconColor = Color.parseColor("#CFD3DC")
        pressedCircleColor = Color.parseColor("#3A3D45")
        pressedIconColor = Color.WHITE
        setOnClickListener { onPause?.invoke() }
    }

    private val confirmButton = IconButton(context, IconButton.Icon.CONFIRM).apply {
        circleColor = Color.parseColor("#F4F5F7")        // confirm bg
        iconColor = Color.parseColor("#14151A")
        pressedCircleColor = Color.WHITE
        pressedIconColor = Color.parseColor("#14151A")
        setOnClickListener { onConfirm?.invoke() }
    }

    private val waveform = WaveformView(context)

    private val label = TextView(context).apply {
        setTextColor(Color.parseColor("#C2C6D0"))
        textSize = 12f
        gravity = Gravity.CENTER
        visibility = View.GONE
    }

    private val center = FrameLayout(context).apply {
        val fill = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        )
        addView(waveform, FrameLayout.LayoutParams(fill))
        addView(label, FrameLayout.LayoutParams(fill))
    }

    init {
        orientation = HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setBackground(background)
        setPadding(dp(5f), 0, dp(5f), 0)

        val side = dp(21f)
        addView(cancelButton, LayoutParams(side, side).apply { marginEnd = dp(5f) })
        addView(center, LayoutParams(0, dp(22f), 1f))
        addView(pauseButton, LayoutParams(side, side).apply { marginStart = dp(5f) })
        addView(confirmButton, LayoutParams(side, side).apply { marginStart = dp(5f) })

        setState(State.RECORDING)
    }

    fun setLevel(level: Float) = waveform.setLevel(level)

    fun setState(state: State, message: String? = null) {
        // The pause control only means anything mid-dictation; elsewhere it stays
        // in place (so the row never reflows) but reads as unavailable.
        pauseButton.isEnabled = state == State.RECORDING || state == State.PAUSED
        pauseButton.alpha = if (pauseButton.isEnabled) 1f else 0.3f
        setPaused(state == State.PAUSED)
        when (state) {
            State.RECORDING -> showWave(WaveformView.Mode.RECORDING)
            State.PAUSED -> showLabel(message ?: "Paused", Color.parseColor("#F5B544"))
            State.TRANSCRIBING -> showWave(WaveformView.Mode.TRANSCRIBING)
            State.IDLE -> showWave(WaveformView.Mode.IDLE)
            State.INFO -> showLabel(message ?: "", Color.parseColor("#C2C6D0"))
            State.ERROR -> showLabel(message ?: "Error", Color.parseColor("#FF8A9B"))
            State.DONE -> showLabel(message ?: "Inserted", Color.parseColor("#69E0A6"))
        }
    }

    /** Swap the pause glyph for a play glyph while the dictation is held. */
    private fun setPaused(paused: Boolean) {
        pauseButton.setIcon(if (paused) IconButton.Icon.PLAY else IconButton.Icon.PAUSE)
        pauseButton.circleColor =
            if (paused) Color.parseColor("#F5B544") else Color.parseColor("#20222A")
        pauseButton.iconColor =
            if (paused) Color.parseColor("#14151A") else Color.parseColor("#CFD3DC")
        pauseButton.invalidate()
    }

    private fun showWave(mode: WaveformView.Mode) {
        label.visibility = View.GONE
        waveform.visibility = View.VISIBLE
        waveform.setMode(mode)
    }

    private fun showLabel(text: String, color: Int) {
        waveform.visibility = View.GONE
        label.visibility = View.VISIBLE
        label.text = text
        label.setTextColor(color)
    }

    /** A circular icon button drawing an X, a check, or the pause / play glyph. */
    private class IconButton(context: Context, private var icon: Icon) : View(context) {
        enum class Icon { CANCEL, CONFIRM, PAUSE, PLAY }

        fun setIcon(next: Icon) {
            if (icon == next) return
            icon = next
            invalidate()
        }

        var circleColor = Color.DKGRAY
        var iconColor = Color.WHITE
        var pressedCircleColor = Color.DKGRAY
        var pressedIconColor = Color.WHITE

        private val d = context.resources.displayMetrics.density
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            strokeWidth = 2.4f * d
        }
        private val path = Path()
        private val solid = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }

        init {
            isClickable = true
            isFocusable = true
        }

        override fun onDraw(canvas: Canvas) {
            val w = width.toFloat()
            val h = height.toFloat()
            val cx = w / 2f
            val cy = h / 2f
            val r = minOf(w, h) / 2f

            fill.color = if (isPressed) pressedCircleColor else circleColor
            canvas.drawCircle(cx, cy, r, fill)

            stroke.color = if (isPressed) pressedIconColor else iconColor
            path.reset()
            val s = r * 0.5f // icon half-extent
            when (icon) {
                Icon.CANCEL -> {
                    path.moveTo(cx - s, cy - s); path.lineTo(cx + s, cy + s)
                    path.moveTo(cx + s, cy - s); path.lineTo(cx - s, cy + s)
                }
                Icon.CONFIRM -> {
                    path.moveTo(cx - s, cy + s * 0.1f)
                    path.lineTo(cx - s * 0.25f, cy + s * 0.75f)
                    path.lineTo(cx + s, cy - s * 0.7f)
                }
                Icon.PAUSE -> {
                    path.moveTo(cx - s * 0.5f, cy - s); path.lineTo(cx - s * 0.5f, cy + s)
                    path.moveTo(cx + s * 0.5f, cy - s); path.lineTo(cx + s * 0.5f, cy + s)
                }
                Icon.PLAY -> {
                    solid.color = if (isPressed) pressedIconColor else iconColor
                    path.moveTo(cx - s * 0.6f, cy - s)
                    path.lineTo(cx + s, cy)
                    path.lineTo(cx - s * 0.6f, cy + s)
                    path.close()
                    canvas.drawPath(path, solid)
                    return
                }
            }
            canvas.drawPath(path, stroke)
        }

        override fun setPressed(pressed: Boolean) {
            super.setPressed(pressed)
            invalidate()
        }
    }
}

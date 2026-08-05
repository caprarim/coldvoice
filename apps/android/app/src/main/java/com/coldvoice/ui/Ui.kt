package com.coldvoice.ui

import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

object Ui {

    val BG = Color.parseColor("#08090B")
    val CARD = Color.parseColor("#101114")
    val CARD_SOFT = Color.parseColor("#15161B")
    val STROKE = Color.parseColor("#23242B")
    val TEXT = Color.WHITE
    val SOFT = Color.parseColor("#C2C6D0")
    val MUTED = Color.parseColor("#7A7C82")
    val FAINT = Color.parseColor("#55585F")
    val ACCENT = Color.parseColor("#69E0A6")
    val WARN = Color.parseColor("#F5B544")
    val DANGER = Color.parseColor("#FF8A9B")

    fun dp(context: Context, value: Int): Int =
        (value * context.resources.displayMetrics.density).toInt()

    fun dpf(context: Context, value: Float): Float =
        value * context.resources.displayMetrics.density

    fun card(context: Context, fill: Int = CARD, radius: Float = 14f): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dpf(context, radius)
            setColor(fill)
            setStroke(dp(context, 1), STROKE)
        }

    fun solid(context: Context, fill: Int, radius: Float = 999f): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dpf(context, radius)
            setColor(fill)
        }

    fun column(context: Context, padding: Int = 0): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            if (padding > 0) setPadding(dp(context, padding), 0, dp(context, padding), 0)
        }

    fun row(context: Context): LinearLayout =
        LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

    fun scroll(context: Context, content: View): ScrollView =
        ScrollView(context).apply {
            isFillViewport = true
            addView(
                content,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }

    fun h1(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(TEXT)
            textSize = 28f
            setTypeface(typeface, Typeface.BOLD)
        }

    fun h2(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(SOFT)
            textSize = 13f
            letterSpacing = 0.08f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(context, 2), dp(context, 22), 0, dp(context, 8))
        }

    fun body(context: Context, text: String, color: Int = SOFT, size: Float = 15f): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(color)
            textSize = size
            setLineSpacing(dpf(context, 3f), 1f)
        }

    fun spacer(context: Context, height: Int): View =
        View(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, height)
            )
        }

    fun stretch(topMargin: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { this.topMargin = topMargin }

    fun button(
        context: Context,
        label: String,
        primary: Boolean = false,
        danger: Boolean = false,
        onClick: () -> Unit
    ): TextView = TextView(context).apply {
        text = label
        gravity = Gravity.CENTER
        textSize = 15f
        isClickable = true
        isFocusable = true
        setTextColor(
            when {
                danger -> DANGER
                primary -> Color.parseColor("#0B0C0E")
                else -> TEXT
            }
        )
        background = card(context, if (primary) ACCENT else CARD_SOFT)
        setPadding(dp(context, 18), dp(context, 15), dp(context, 18), dp(context, 15))
        setOnClickListener { onClick() }
    }

    fun glyphButton(context: Context, glyph: String, onClick: () -> Unit): TextView =
        TextView(context).apply {
            text = glyph
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(MUTED)
            isClickable = true
            isFocusable = true
            background = solid(context, CARD_SOFT, 10f)
            val pad = dp(context, 9)
            setPadding(pad, pad, pad, pad)
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dp(context, 6) }
        }

    fun input(context: Context, hint: String, value: String = "", multiline: Boolean = false): EditText =
        EditText(context).apply {
            this.hint = hint
            setText(value)
            setHintTextColor(FAINT)
            setTextColor(TEXT)
            textSize = 15f
            background = card(context, CARD_SOFT, 12f)
            setPadding(dp(context, 14), dp(context, 14), dp(context, 14), dp(context, 14))
            if (multiline) {
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                minLines = 3
                gravity = Gravity.TOP or Gravity.START
            } else {
                inputType = InputType.TYPE_CLASS_TEXT
                maxLines = 1
            }
            layoutParams = stretch(dp(context, 6))
        }

    fun label(context: Context, text: String): TextView =
        TextView(context).apply {
            this.text = text
            setTextColor(MUTED)
            textSize = 12f
            setPadding(dp(context, 2), dp(context, 12), 0, 0)
        }

    fun settingRow(
        context: Context,
        title: String,
        description: String? = null,
        control: View? = null
    ): LinearLayout {
        val labels = column(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(body(context, title, TEXT))
            if (description != null) {
                addView(body(context, description, MUTED, 12.5f).apply {
                    setPadding(0, dp(context, 3), 0, 0)
                })
            }
        }
        return row(context).apply {
            setPadding(dp(context, 16), dp(context, 15), dp(context, 16), dp(context, 15))
            addView(labels)
            if (control != null) {
                addView(control, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { marginStart = dp(context, 12) })
            }
        }
    }

    fun toggle(context: Context, checked: Boolean, onChange: (Boolean) -> Unit): Switch =
        Switch(context).apply {
            isChecked = checked
            thumbTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(ACCENT, Color.parseColor("#6B6E76"))
            )
            trackTintList = ColorStateList(
                arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
                intArrayOf(Color.parseColor("#2C6650"), Color.parseColor("#2A2B32"))
            )
            setOnCheckedChangeListener { _, value -> onChange(value) }
        }

    fun toggleRow(
        context: Context,
        title: String,
        description: String?,
        checked: Boolean,
        onChange: (Boolean) -> Unit
    ): View = settingRow(context, title, description, toggle(context, checked, onChange))

    fun divider(context: Context): View =
        View(context).apply {
            setBackgroundColor(STROKE)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(context, 1)
            ).apply {
                marginStart = dp(context, 16)
                marginEnd = dp(context, 16)
            }
        }

    fun cardGroup(context: Context, rows: List<View>): LinearLayout {
        val group = column(context).apply {
            background = card(context)
            layoutParams = stretch()
        }
        rows.forEachIndexed { index, view ->
            if (index > 0) group.addView(divider(context))
            group.addView(view, stretch())
        }
        return group
    }

    fun statCard(context: Context, value: String, caption: String): LinearLayout =
        column(context).apply {
            background = card(context)
            setPadding(dp(context, 14), dp(context, 16), dp(context, 14), dp(context, 16))
            addView(TextView(context).apply {
                text = value
                setTextColor(TEXT)
                textSize = 22f
                setTypeface(typeface, Typeface.BOLD)
            })
            addView(TextView(context).apply {
                text = caption
                setTextColor(MUTED)
                textSize = 11.5f
                setPadding(0, dp(context, 4), 0, 0)
            })
        }

    fun emptyCard(context: Context, title: String, message: String): LinearLayout =
        column(context).apply {
            background = card(context)
            setPadding(dp(context, 20), dp(context, 26), dp(context, 20), dp(context, 26))
            layoutParams = stretch()
            addView(TextView(context).apply {
                text = title
                setTextColor(TEXT)
                textSize = 17f
                setTypeface(typeface, Typeface.BOLD)
            })
            addView(body(context, message, MUTED, 13.5f).apply {
                setPadding(0, dp(context, 8), 0, 0)
            })
        }

    fun compact(value: Int): String = when {
        value >= 10000 -> "${value / 1000}K"
        value >= 1000 -> String.format("%.1fK", value / 1000f)
        else -> value.toString()
    }

    fun modal(
        context: Context,
        title: String,
        fields: List<View>,
        submitLabel: String,
        onSubmit: () -> Boolean
    ) {
        val dialog = Dialog(context)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val content = column(context).apply {
            background = card(context, CARD, 18f)
            setPadding(dp(context, 20), dp(context, 20), dp(context, 20), dp(context, 16))
            addView(TextView(context).apply {
                text = title
                setTextColor(TEXT)
                textSize = 19f
                setTypeface(typeface, Typeface.BOLD)
            })
        }
        for (field in fields) content.addView(field)

        val actions = row(context).apply {
            gravity = Gravity.END
            layoutParams = stretch(dp(context, 18))
        }
        actions.addView(button(context, "Cancel") { dialog.dismiss() }.apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            )
        })
        actions.addView(button(context, submitLabel, primary = true) {
            if (onSubmit()) dialog.dismiss()
        }.apply {
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { marginStart = dp(context, 10) }
        })
        content.addView(actions)

        dialog.setContentView(scroll(context, content))
        dialog.window?.setBackgroundDrawable(solid(context, Color.TRANSPARENT, 0f))
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        )
        dialog.show()
    }

    fun confirm(
        context: Context,
        title: String,
        message: String,
        confirmLabel: String,
        onConfirm: () -> Unit
    ) {
        modal(context, title, listOf(body(context, message, MUTED, 14f).apply {
            setPadding(0, dp(context, 12), 0, 0)
        }), confirmLabel) {
            onConfirm()
            true
        }
    }
}

package com.coldvoice.screens

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.data.Store
import com.coldvoice.ui.Ui
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.concurrent.thread

object HomeScreen {

    fun view(activity: Activity, reload: () -> Unit): View {
        val page = Ui.column(activity, 20).apply {
            setPadding(Ui.dp(activity, 20), Ui.dp(activity, 26), Ui.dp(activity, 20), Ui.dp(activity, 28))
        }
        page.addView(Ui.h1(activity, "Welcome back"))
        page.addView(Ui.body(activity, "Everything you have ever dictated, kept on this phone.", Ui.MUTED, 13.5f).apply {
            setPadding(0, Ui.dp(activity, 6), 0, 0)
        })

        val content = Ui.column(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 18)) }
        content.addView(Ui.body(activity, "Loading…", Ui.MUTED, 14f))
        page.addView(content)

        thread(name = "coldvoice-home") {
            val items = Store.listTranscripts(activity)
            val stats = Store.stats(activity)
            content.post { render(activity, content, items, stats, reload) }
        }

        return Ui.scroll(activity, page)
    }

    private fun render(
        activity: Activity,
        content: LinearLayout,
        items: List<Store.Transcript>,
        stats: Store.Stats,
        reload: () -> Unit
    ) {
        content.removeAllViews()

        val rail = Ui.row(activity).apply { layoutParams = Ui.stretch() }
        rail.addView(Ui.statCard(activity, Ui.compact(stats.totalWords), "total words"), weighted(activity, 0))
        rail.addView(Ui.statCard(activity, stats.wpm.toString(), "words / minute"), weighted(activity, 8))
        rail.addView(Ui.statCard(activity, stats.streak.toString(), "day streak"), weighted(activity, 8))
        content.addView(rail)

        if (items.isEmpty()) {
            content.addView(
                Ui.emptyCard(
                    activity,
                    "No dictations yet",
                    "Tap into any text field, then tap the ColdVoice square on the right of the screen and speak. Everything you dictate shows up here."
                ).apply { layoutParams = Ui.stretch(Ui.dp(activity, 14)) }
            )
            return
        }

        var lastLabel: String? = null
        for (item in items) {
            val label = dayLabel(item.createdAt)
            if (label != lastLabel) {
                lastLabel = label
                content.addView(TextView(activity).apply {
                    text = label
                    setTextColor(Ui.MUTED)
                    textSize = 12.5f
                    setPadding(Ui.dp(activity, 2), Ui.dp(activity, 20), 0, Ui.dp(activity, 8))
                })
            }
            content.addView(entry(activity, item, reload))
        }
    }

    private fun weighted(context: Context, startMargin: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = Ui.dp(context, startMargin)
        }

    private fun entry(activity: Activity, item: Store.Transcript, reload: () -> Unit): View {
        val text = item.final.ifBlank { item.raw }
        val body = Ui.column(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(TextView(activity).apply {
                this.text = TIME_FORMAT.format(Date(item.createdAt))
                setTextColor(Ui.FAINT)
                textSize = 11.5f
            })
            addView(Ui.body(activity, text, Ui.TEXT, 14.5f).apply {
                setPadding(0, Ui.dp(activity, 5), 0, 0)
            })
            addView(TextView(activity).apply {
                val words = if (item.wordCount > 0) item.wordCount else Store.wordCount(text)
                this.text = buildString {
                    append(words)
                    append(if (words == 1) " word" else " words")
                    if (!item.targetApp.isNullOrBlank()) append(" · ").append(item.targetApp)
                }
                setTextColor(Ui.FAINT)
                textSize = 11.5f
                setPadding(0, Ui.dp(activity, 6), 0, 0)
            })
        }

        val actions = Ui.column(activity)
        actions.addView(Ui.glyphButton(activity, "⧉") { copy(activity, text) })
        actions.addView(Ui.glyphButton(activity, "✎") { edit(activity, item, text, reload) })
        actions.addView(Ui.glyphButton(activity, "🗑") {
            Ui.confirm(activity, "Delete dictation", "This removes it from your history for good.", "Delete") {
                thread {
                    Store.deleteTranscript(activity, item.id)
                    activity.runOnUiThread { reload() }
                }
            }
        })

        return Ui.row(activity).apply {
            gravity = android.view.Gravity.TOP
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 14), Ui.dp(activity, 13), Ui.dp(activity, 10), Ui.dp(activity, 13))
            layoutParams = Ui.stretch(Ui.dp(activity, 8))
            addView(body)
            addView(actions)
        }
    }

    private fun edit(activity: Activity, item: Store.Transcript, text: String, reload: () -> Unit) {
        val field = Ui.input(activity, "Dictated text", text, multiline = true)
        Ui.modal(activity, "Edit dictation", listOf(field), "Save") {
            val next = field.text.toString().trim()
            if (next.isEmpty()) return@modal false
            thread {
                Store.updateTranscript(activity, item.id, next)
                activity.runOnUiThread { reload() }
            }
            true
        }
    }

    private fun copy(activity: Activity, text: String) {
        val clip = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        clip.setPrimaryClip(ClipData.newPlainText("ColdVoice", text))
    }

    private fun dayLabel(millis: Long): String {
        val today = Calendar.getInstance().apply { midnight() }
        val that = Calendar.getInstance().apply { timeInMillis = millis; midnight() }
        val days = ((today.timeInMillis - that.timeInMillis) / 86_400_000L).toInt()
        return when (days) {
            0 -> "Today"
            1 -> "Yesterday"
            else -> DAY_LABEL_FORMAT.format(Date(millis))
        }
    }

    private fun Calendar.midnight() {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }

    private val TIME_FORMAT = SimpleDateFormat("h:mm a", Locale.getDefault())
    private val DAY_LABEL_FORMAT = SimpleDateFormat("EEEE, d MMMM", Locale.getDefault())
}

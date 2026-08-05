package com.coldvoice.screens

import android.app.Activity
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.data.Store
import com.coldvoice.ui.GaugeView
import com.coldvoice.ui.HeatmapView
import com.coldvoice.ui.Ui
import kotlin.concurrent.thread

object InsightsScreen {

    fun view(activity: Activity): View {
        val page = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 20), Ui.dp(activity, 26), Ui.dp(activity, 20), Ui.dp(activity, 28))
        }
        page.addView(Ui.h1(activity, "Insights"))

        val content = Ui.column(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 16)) }
        content.addView(Ui.body(activity, "Loading…", Ui.MUTED, 14f))
        page.addView(content)

        thread(name = "coldvoice-insights") {
            val stats = Store.stats(activity)
            content.post { render(activity, content, stats) }
        }

        return Ui.scroll(activity, page)
    }

    private fun render(activity: Activity, content: LinearLayout, stats: Store.Stats) {
        content.removeAllViews()

        if (stats.totalDictations == 0) {
            content.addView(
                Ui.emptyCard(
                    activity,
                    "Nothing to measure yet",
                    "Your speed, streak and per-app breakdown appear here once you have dictated something."
                )
            )
            return
        }

        val speed = Ui.column(activity).apply {
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 18), Ui.dp(activity, 18), Ui.dp(activity, 18), Ui.dp(activity, 18))
            layoutParams = Ui.stretch()
            addView(bigNumber(activity, stats.wpm.toString()))
            addView(caption(activity, "Words per minute"))
            addView(GaugeView(activity, stats.wpm, 180).apply {
                layoutParams = Ui.stretch(Ui.dp(activity, 10))
            })
        }
        content.addView(speed)

        val pair = Ui.row(activity).apply {
            gravity = android.view.Gravity.TOP
            layoutParams = Ui.stretch(Ui.dp(activity, 10))
        }
        pair.addView(metricCard(activity, Ui.compact(stats.fixes), "Fixes made by ColdVoice", listOf(
            "Dictations" to stats.totalDictations.toString(),
            "Cleanup edits" to Ui.compact(stats.fixes)
        )), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        pair.addView(metricCard(activity, Ui.compact(stats.totalWords), "Total words dictated", listOf(
            "Speaking time" to minutes(stats.totalDurationMs)
        )), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = Ui.dp(activity, 10)
        })
        content.addView(pair)

        content.addView(Ui.h2(activity, "WHERE YOU DICTATE"))
        val usage = Ui.column(activity).apply {
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16))
            layoutParams = Ui.stretch()
        }
        if (stats.apps.isEmpty()) {
            usage.addView(Ui.body(activity, "No app data yet.", Ui.MUTED, 13.5f))
        } else {
            val top = stats.apps.first().words.coerceAtLeast(1)
            for (app in stats.apps.take(6)) {
                usage.addView(usageRow(activity, app.app, app.words, top))
            }
        }
        content.addView(usage)

        content.addView(Ui.h2(activity, "${stats.streak} DAY STREAK"))
        val streak = Ui.column(activity).apply {
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16))
            layoutParams = Ui.stretch()
            addView(HeatmapView(activity, stats.byDay), Ui.stretch())
            addView(Ui.body(activity, "Longest streak · ${stats.longestStreak} days", Ui.MUTED, 12f).apply {
                setPadding(0, Ui.dp(activity, 12), 0, 0)
            })
        }
        content.addView(streak)
    }

    private fun metricCard(
        activity: Activity,
        value: String,
        title: String,
        rows: List<Pair<String, String>>
    ): LinearLayout = Ui.column(activity).apply {
        background = Ui.card(activity)
        setPadding(Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16), Ui.dp(activity, 16))
        addView(bigNumber(activity, value))
        addView(caption(activity, title))
        for ((label, amount) in rows) {
            addView(Ui.row(activity).apply {
                layoutParams = Ui.stretch(Ui.dp(activity, 8))
                addView(TextView(activity).apply {
                    text = label
                    setTextColor(Ui.MUTED)
                    textSize = 12f
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(activity).apply {
                    text = amount
                    setTextColor(Ui.SOFT)
                    textSize = 12f
                    setTypeface(typeface, Typeface.BOLD)
                })
            })
        }
    }

    private fun usageRow(activity: Activity, app: String, words: Int, top: Int): View {
        val fraction = (words.toFloat() / top).coerceIn(0.04f, 1f)
        val bar = View(activity).apply {
            background = Ui.solid(activity, Ui.ACCENT, 999f)
            layoutParams = LinearLayout.LayoutParams(0, Ui.dp(activity, 8), fraction)
        }
        val rest = View(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, Ui.dp(activity, 8), 1f - fraction)
        }
        val track = Ui.row(activity).apply {
            background = Ui.solid(activity, Ui.STROKE, 999f)
            layoutParams = Ui.stretch(Ui.dp(activity, 6))
            addView(bar)
            addView(rest)
        }
        return Ui.column(activity).apply {
            layoutParams = Ui.stretch(Ui.dp(activity, 12))
            addView(Ui.row(activity).apply {
                addView(TextView(activity).apply {
                    text = app
                    setTextColor(Ui.SOFT)
                    textSize = 13f
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(activity).apply {
                    text = "${Ui.compact(words)} words"
                    setTextColor(Ui.MUTED)
                    textSize = 12f
                })
            })
            addView(track)
        }
    }

    private fun bigNumber(activity: Activity, value: String): TextView =
        TextView(activity).apply {
            text = value
            setTextColor(Ui.TEXT)
            textSize = 30f
            setTypeface(typeface, Typeface.BOLD)
        }

    private fun caption(activity: Activity, text: String): TextView =
        TextView(activity).apply {
            this.text = text
            setTextColor(Ui.MUTED)
            textSize = 12f
            setPadding(0, Ui.dp(activity, 4), 0, 0)
        }

    private fun minutes(durationMs: Long): String {
        val total = durationMs / 1000
        val mins = total / 60
        return if (mins >= 1) "$mins min" else "$total sec"
    }
}

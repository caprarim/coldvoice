package com.coldvoice.screens

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.data.Store
import com.coldvoice.ui.Ui
import kotlin.concurrent.thread

object SnippetsScreen {

    fun view(activity: Activity, reload: () -> Unit): View {
        val page = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 20), Ui.dp(activity, 26), Ui.dp(activity, 20), Ui.dp(activity, 28))
        }
        page.addView(Ui.h1(activity, "Snippets"))
        page.addView(Ui.body(activity, "Say a short trigger, get the whole thing typed out: an email address, an address, a stock reply.", Ui.MUTED, 13.5f).apply {
            setPadding(0, Ui.dp(activity, 6), 0, 0)
        })
        page.addView(Ui.button(activity, "Add a snippet", primary = true) { edit(activity, null, reload) }.apply {
            layoutParams = Ui.stretch(Ui.dp(activity, 16))
        })

        val content = Ui.column(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 14)) }
        content.addView(Ui.body(activity, "Loading…", Ui.MUTED, 14f))
        page.addView(content)

        thread(name = "coldvoice-snippets") {
            val snippets = Store.listSnippets(activity)
            content.post { render(activity, content, snippets, reload) }
        }

        return Ui.scroll(activity, page)
    }

    private fun render(
        activity: Activity,
        content: LinearLayout,
        snippets: List<Store.Snippet>,
        reload: () -> Unit
    ) {
        content.removeAllViews()
        if (snippets.isEmpty()) {
            content.addView(
                Ui.emptyCard(
                    activity,
                    "No snippets yet",
                    "Add a trigger phrase and what it should expand into. Saying the trigger during a dictation drops the full text in."
                )
            )
            return
        }
        for (snippet in snippets) content.addView(row(activity, snippet, reload))
    }

    private fun row(activity: Activity, snippet: Store.Snippet, reload: () -> Unit): View {
        val labels = Ui.column(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(TextView(activity).apply {
                text = snippet.trigger
                setTextColor(Ui.TEXT)
                textSize = 15f
            })
            addView(TextView(activity).apply {
                text = snippet.expansion
                setTextColor(Ui.MUTED)
                textSize = 12.5f
                maxLines = 2
                setPadding(0, Ui.dp(activity, 4), 0, 0)
            })
        }
        return Ui.row(activity).apply {
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 14), Ui.dp(activity, 14), Ui.dp(activity, 10), Ui.dp(activity, 14))
            layoutParams = Ui.stretch(Ui.dp(activity, 8))
            isClickable = true
            setOnClickListener { edit(activity, snippet, reload) }
            addView(labels)
            addView(Ui.glyphButton(activity, "🗑") {
                thread {
                    Store.deleteSnippet(activity, snippet.id)
                    activity.runOnUiThread { reload() }
                }
            })
        }
    }

    private fun edit(activity: Activity, snippet: Store.Snippet?, reload: () -> Unit) {
        val trigger = Ui.input(activity, "my email", snippet?.trigger.orEmpty())
        val expansion = Ui.input(activity, "you@example.com", snippet?.expansion.orEmpty(), multiline = true)
        val fields = listOf(
            Ui.label(activity, "Snippet (trigger phrase)"), trigger,
            Ui.label(activity, "Expansion"), expansion
        )
        Ui.modal(activity, if (snippet == null) "Add snippet" else "Edit snippet", fields, "Save") {
            val phrase = trigger.text.toString().trim()
            if (phrase.isEmpty()) return@modal false
            val saved = Store.Snippet(
                id = snippet?.id ?: 0,
                trigger = phrase,
                expansion = expansion.text.toString(),
                enabled = true
            )
            thread {
                Store.upsertSnippet(activity, saved)
                activity.runOnUiThread { reload() }
            }
            true
        }
    }
}

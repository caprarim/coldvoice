package com.coldvoice.screens

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.data.Store
import com.coldvoice.ui.Ui
import kotlin.concurrent.thread

object DictionaryScreen {

    fun view(activity: Activity, reload: () -> Unit): View {
        val page = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 20), Ui.dp(activity, 26), Ui.dp(activity, 20), Ui.dp(activity, 28))
        }
        page.addView(Ui.h1(activity, "Dictionary"))
        page.addView(Ui.body(activity, "Names, jargon and product spellings ColdVoice should always get right, on every dictation.", Ui.MUTED, 13.5f).apply {
            setPadding(0, Ui.dp(activity, 6), 0, 0)
        })
        page.addView(Ui.button(activity, "Add a word", primary = true) { edit(activity, null, reload) }.apply {
            layoutParams = Ui.stretch(Ui.dp(activity, 16))
        })

        val content = Ui.column(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 14)) }
        content.addView(Ui.body(activity, "Loading…", Ui.MUTED, 14f))
        page.addView(content)

        thread(name = "coldvoice-dictionary") {
            val entries = Store.listDictionary(activity)
            content.post { render(activity, content, entries, reload) }
        }

        return Ui.scroll(activity, page)
    }

    private fun render(
        activity: Activity,
        content: LinearLayout,
        entries: List<Store.DictEntry>,
        reload: () -> Unit
    ) {
        content.removeAllViews()
        if (entries.isEmpty()) {
            content.addView(
                Ui.emptyCard(
                    activity,
                    "No words yet",
                    "Add a term and the replacement, for example \"super base\" becomes \"Supabase\". Rules apply to cloud and offline dictation alike."
                )
            )
            return
        }
        for (entry in entries) content.addView(row(activity, entry, reload))
    }

    private fun row(activity: Activity, entry: Store.DictEntry, reload: () -> Unit): View {
        val labels = Ui.column(activity).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            addView(TextView(activity).apply {
                text = "${entry.phrase}  →  ${entry.replacement.ifBlank { entry.phrase }}"
                setTextColor(Ui.TEXT)
                textSize = 15f
            })
            if (entry.aliases.isNotEmpty()) {
                addView(TextView(activity).apply {
                    text = "also: ${entry.aliases.joinToString(", ")}"
                    setTextColor(Ui.FAINT)
                    textSize = 11.5f
                    setPadding(0, Ui.dp(activity, 4), 0, 0)
                })
            }
        }
        return Ui.row(activity).apply {
            background = Ui.card(activity)
            setPadding(Ui.dp(activity, 14), Ui.dp(activity, 14), Ui.dp(activity, 10), Ui.dp(activity, 14))
            layoutParams = Ui.stretch(Ui.dp(activity, 8))
            isClickable = true
            setOnClickListener { edit(activity, entry, reload) }
            addView(labels)
            addView(Ui.glyphButton(activity, "🗑") {
                thread {
                    Store.deleteDictionary(activity, entry.id)
                    activity.runOnUiThread { reload() }
                }
            })
        }
    }

    private fun edit(activity: Activity, entry: Store.DictEntry?, reload: () -> Unit) {
        val phrase = Ui.input(activity, "super base", entry?.phrase.orEmpty())
        val replacement = Ui.input(activity, "Supabase", entry?.replacement.orEmpty())
        val aliases = Ui.input(activity, "comma, separated, aliases", entry?.aliases?.joinToString(", ").orEmpty())
        val fields = listOf(
            Ui.label(activity, "Original (what is heard)"), phrase,
            Ui.label(activity, "Replace with (correct spelling)"), replacement,
            Ui.label(activity, "Aliases (optional)"), aliases
        )
        Ui.modal(activity, if (entry == null) "Add word" else "Edit word", fields, "Save") {
            val heard = phrase.text.toString().trim()
            if (heard.isEmpty()) return@modal false
            val saved = Store.DictEntry(
                id = entry?.id ?: 0,
                phrase = heard,
                replacement = replacement.text.toString().trim(),
                aliases = aliases.text.toString().split(",").map { it.trim() }.filter { it.isNotEmpty() },
                caseSensitive = entry?.caseSensitive ?: false,
                enabled = true
            )
            thread {
                Store.upsertDictionary(activity, saved)
                activity.runOnUiThread { reload() }
            }
            true
        }
    }
}

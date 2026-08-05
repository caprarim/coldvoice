package com.coldvoice.screens

import android.app.Activity
import android.os.Build
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.Setup
import com.coldvoice.asr.GroqClient
import com.coldvoice.data.Settings
import com.coldvoice.data.Store
import com.coldvoice.net.Connectivity
import com.coldvoice.ui.Ui
import kotlin.concurrent.thread

object SettingsScreen {

    fun view(activity: Activity, reload: () -> Unit): View {
        val page = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 20), Ui.dp(activity, 26), Ui.dp(activity, 20), Ui.dp(activity, 32))
        }
        page.addView(Ui.h1(activity, "Settings"))

        page.addView(Ui.h2(activity, "SETUP"))
        page.addView(setupCard(activity, reload))

        page.addView(Ui.h2(activity, "ENGINE"))
        page.addView(engineCard(activity))

        page.addView(Ui.h2(activity, "DICTATION"))
        page.addView(dictationCard(activity))

        page.addView(Ui.h2(activity, "AI GRAMMAR"))
        page.addView(aiCard(activity))

        page.addView(Ui.h2(activity, "PRIVACY"))
        page.addView(privacyCard(activity, reload))

        page.addView(Ui.h2(activity, "KEYBOARD"))
        page.addView(
            Ui.cardGroup(activity, listOf(
                Ui.settingRow(
                    activity,
                    "ColdVoice keyboard",
                    if (Setup.keyboardEnabled(activity)) "Enabled. Optional, the bubble works with your own keyboard." else "Optional. The bubble already works with the keyboard you use.",
                    Ui.button(activity, "Open") { Setup.openKeyboardSettings(activity) }
                )
            ))
        )

        return Ui.scroll(activity, page)
    }

    private fun setupCard(activity: Activity, reload: () -> Unit): View {
        val rows = ArrayList<View>()
        val micDone = Setup.hasMic(activity)
        rows.add(
            Ui.settingRow(
                activity,
                if (micDone) "Microphone allowed ✓" else "Allow the microphone",
                if (micDone) "ColdVoice can hear you." else "Needed before any dictation can start.",
                if (micDone) null else Ui.button(activity, "Allow") { Setup.requestMic(activity) }
            )
        )

        val bubbleOn = Setup.bubbleEnabled(activity)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !bubbleOn) {
            rows.add(
                Ui.settingRow(
                    activity,
                    "Unlock restricted settings",
                    "Android greys the bubble switch out for apps installed outside the Play Store. Open App info, tap ⋮, choose \"Allow restricted settings\".",
                    Ui.button(activity, "App info") { Setup.openAppInfo(activity) }
                )
            )
        }

        rows.add(
            Ui.settingRow(
                activity,
                if (bubbleOn) "ColdVoice bubble is on ✓" else "Turn on the ColdVoice bubble",
                if (bubbleOn) "The square appears whenever a text field has focus." else "The floating square that lets you dictate into any app.",
                Ui.button(activity, if (bubbleOn) "Manage" else "Turn on") {
                    Setup.openAccessibilitySettings(activity)
                }
            )
        )
        rows.add(
            Ui.settingRow(
                activity,
                "Refresh setup status",
                null,
                Ui.button(activity, "Refresh") { reload() }
            )
        )
        rows.add(
            Ui.column(activity).apply {
                setPadding(Ui.dp(activity, 16), Ui.dp(activity, 15), Ui.dp(activity, 16), Ui.dp(activity, 15))
                addView(Ui.body(activity, "Try it here", Ui.TEXT))
                addView(Ui.input(activity, "Tap here. The ColdVoice square appears on the right. Tap it and speak.", multiline = true))
            }
        )
        return Ui.cardGroup(activity, rows)
    }

    private fun engineCard(activity: Activity): View {
        val online = Connectivity.isOnline(activity)
        val cloud = Settings.aiEnabled(activity) && !Settings.offlineMode(activity) &&
            Settings.hasGroqKey(activity) && online
        return Ui.cardGroup(activity, listOf(
            Ui.settingRow(
                activity,
                if (cloud) "Cloud (Groq Whisper + Llama)" else "On-device (offline)",
                if (online) "Online" else "Offline",
                badge(activity, if (cloud) "CLOUD" else "LOCAL", if (cloud) Ui.ACCENT else Ui.SOFT)
            ),
            Ui.toggleRow(
                activity,
                "Offline mode",
                "Never touch the cloud, even when there is a connection. On-device dictation only.",
                Settings.offlineMode(activity)
            ) { Settings.setOfflineMode(activity, it) }
        ))
    }

    private fun dictationCard(activity: Activity): View {
        val current = Settings.tone(activity)
        val toneRow = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 16), Ui.dp(activity, 15), Ui.dp(activity, 16), Ui.dp(activity, 15))
            addView(Ui.body(activity, "Tone", Ui.TEXT))
            addView(Ui.body(activity, "How dictations read. Auto leaves the wording exactly as you said it.", Ui.MUTED, 12.5f).apply {
                setPadding(0, Ui.dp(activity, 3), 0, 0)
            })
        }
        val chips = Ui.row(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 12)) }
        val options = listOf(
            "auto" to "Auto",
            "default" to "Neutral",
            "casual" to "Casual",
            "professional" to "Pro"
        )
        val views = HashMap<String, TextView>()
        for ((value, label) in options) {
            val chip = chip(activity, label, value == current) {
                Settings.setTone(activity, value)
                for ((key, view) in views) styleChip(activity, view, key == value)
            }
            views[value] = chip
            chips.addView(chip, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = if (chips.childCount == 0) 0 else Ui.dp(activity, 6)
            })
        }
        toneRow.addView(chips)

        return Ui.cardGroup(activity, listOf(
            Ui.toggleRow(
                activity,
                "Developer mode",
                "Keeps code, commands, file paths and technical terms intact (Next.js, npm, IPC).",
                Settings.developerMode(activity)
            ) { Settings.setDeveloperMode(activity, it) },
            toneRow
        ))
    }

    private fun aiCard(activity: Activity): View {
        val status = Ui.body(activity, "", Ui.MUTED, 12f)
        val key = Ui.input(activity, "gsk_...", Settings.groqApiKey(activity)).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val keyRow = Ui.column(activity).apply {
            setPadding(Ui.dp(activity, 16), Ui.dp(activity, 15), Ui.dp(activity, 16), Ui.dp(activity, 15))
            addView(Ui.body(activity, "Groq API key", Ui.TEXT))
            addView(Ui.body(activity, "Free at console.groq.com/keys. Powers cloud speech recognition and AI grammar.", Ui.MUTED, 12.5f).apply {
                setPadding(0, Ui.dp(activity, 3), 0, 0)
            })
            addView(key)
            addView(status.apply { setPadding(0, Ui.dp(activity, 8), 0, 0) })
        }
        val actions = Ui.row(activity).apply { layoutParams = Ui.stretch(Ui.dp(activity, 10)) }
        actions.addView(Ui.button(activity, "Save key") {
            Settings.setGroqApiKey(activity, key.text.toString())
            status.text = "Saved."
            status.setTextColor(Ui.ACCENT)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        actions.addView(Ui.button(activity, "Test") {
            Settings.setGroqApiKey(activity, key.text.toString())
            status.text = "Testing…"
            status.setTextColor(Ui.MUTED)
            val candidate = key.text.toString().trim()
            thread(name = "coldvoice-groq-test") {
                val (ok, message) = GroqClient.test(candidate)
                activity.runOnUiThread {
                    status.text = if (ok) "Connected ✓ AI grammar is working." else "Failed: $message"
                    status.setTextColor(if (ok) Ui.ACCENT else Ui.DANGER)
                }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = Ui.dp(activity, 8)
        })
        keyRow.addView(actions)

        return Ui.cardGroup(activity, listOf(
            Ui.toggleRow(
                activity,
                "AI grammar & formatting",
                "Cloud AI fixes grammar, punctuation and formatting. Falls back to the offline rules when unavailable.",
                Settings.aiEnabled(activity)
            ) { Settings.setAiEnabled(activity, it) },
            keyRow
        ))
    }

    private fun privacyCard(activity: Activity, reload: () -> Unit): View =
        Ui.cardGroup(activity, listOf(
            Ui.toggleRow(
                activity,
                "Save dictation history",
                "Stored on this phone only. Powers Home and Insights.",
                Settings.storeTranscripts(activity)
            ) { Settings.setStoreTranscripts(activity, it) },
            Ui.settingRow(
                activity,
                "Clear all dictation history",
                "Permanently deletes every saved dictation on this phone.",
                Ui.button(activity, "Clear", danger = true) {
                    Ui.confirm(
                        activity,
                        "Delete all dictations?",
                        "Every saved dictation goes for good. This cannot be undone.",
                        "Delete all"
                    ) {
                        thread {
                            Store.clearTranscripts(activity)
                            activity.runOnUiThread { reload() }
                        }
                    }
                }
            )
        ))

    private fun badge(activity: Activity, text: String, color: Int): TextView =
        TextView(activity).apply {
            this.text = text
            setTextColor(color)
            textSize = 11f
            letterSpacing = 0.08f
            background = Ui.card(activity, Ui.CARD_SOFT, 999f)
            setPadding(Ui.dp(activity, 12), Ui.dp(activity, 6), Ui.dp(activity, 12), Ui.dp(activity, 6))
        }

    private fun chip(activity: Activity, label: String, selected: Boolean, onClick: () -> Unit): TextView =
        TextView(activity).apply {
            text = label
            gravity = android.view.Gravity.CENTER
            textSize = 13f
            isClickable = true
            setPadding(Ui.dp(activity, 8), Ui.dp(activity, 11), Ui.dp(activity, 8), Ui.dp(activity, 11))
            setOnClickListener { onClick() }
            styleChip(activity, this, selected)
        }

    private fun styleChip(activity: Activity, view: TextView, selected: Boolean) {
        view.background = Ui.card(activity, if (selected) Ui.ACCENT else Ui.CARD_SOFT, 12f)
        view.setTextColor(if (selected) Ui.BG else Ui.SOFT)
    }
}

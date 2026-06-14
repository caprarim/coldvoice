package com.coldvoice.ime

import android.inputmethodservice.InputMethodService
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.coldvoice.asr.AsrEngine
import com.coldvoice.asr.SherpaAsrEngine
import com.coldvoice.audio.MicRecorder
import com.coldvoice.input.InsertionGuard
import com.coldvoice.text.TextPipeline

/**
 * ColdVoice voice keyboard. A minimal IME whose primary control is a mic button.
 * Hold/tap to dictate; speech is transcribed offline, cleaned, and committed via
 * InputConnection.commitText. Password fields are never written to.
 */
class ColdVoiceImeService : InputMethodService() {

    private lateinit var asr: AsrEngine
    private var recorder: MicRecorder? = null
    private var status: TextView? = null
    private var micButton: Button? = null
    private var listening = false

    override fun onCreate() {
        super.onCreate()
        asr = SherpaAsrEngine(this)
    }

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 28, 32, 28)
        }
        status = TextView(this).apply { text = "ColdVoice — tap the mic to dictate" }
        micButton = Button(this).apply {
            text = "🎤  Dictate"
            setOnClickListener { toggle() }
        }
        root.addView(status)
        root.addView(micButton)
        return root
    }

    private fun toggle() {
        if (listening) stopAndInsert() else startListening()
    }

    private fun startListening() {
        val editor = currentInputEditorInfo
        if (!InsertionGuard.canInsert(editor)) {
            status?.text = "Cannot dictate into this field (password or non-editable)."
            return
        }
        if (!asr.isReady()) {
            status?.text = asr.setupMessage()
            return
        }
        asr.reset()
        recorder = MicRecorder { samples -> asr.acceptSamples(samples) }.also { it.start() }
        listening = true
        micButton?.text = "■  Stop"
        status?.text = "Listening…"
    }

    private fun stopAndInsert() {
        listening = false
        micButton?.text = "🎤  Dictate"
        recorder?.stop()
        recorder = null
        status?.text = "Transcribing…"
        try {
            val raw = asr.finish()
            val clean = TextPipeline.process(raw)
            if (clean.isNotEmpty()) currentInputConnection?.commitText(clean, 1)
            status?.text = "ColdVoice — tap the mic to dictate"
        } catch (e: Exception) {
            status?.text = e.message ?: "ASR error"
        }
    }

    override fun onFinishInput() {
        super.onFinishInput()
        if (listening) {
            recorder?.stop()
            recorder = null
            asr.reset()
            listening = false
        }
    }
}

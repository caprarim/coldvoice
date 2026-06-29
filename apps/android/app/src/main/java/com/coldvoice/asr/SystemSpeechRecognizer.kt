package com.coldvoice.asr

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * On-device speech recognition wrapper.
 *
 * Goals (to match Wispr Flow on phone):
 *  - Offline: prefers the device's on-device recognizer and sets PREFER_OFFLINE,
 *    so dictation keeps working with no connection. When online it still uses the
 *    on-device path first for speed.
 *  - Fast + long-form: in [continuous] mode it auto-restarts after each phrase and
 *    emits finalized chunks through [Callbacks.onFinal] so a 200-word dictation is
 *    inserted as you speak, instead of being cut off at the first pause.
 */
class SystemSpeechRecognizer(
    private val context: Context,
    private val callbacks: Callbacks
) : RecognitionListener {

    interface Callbacks {
        fun onReady()
        fun onPartial(text: String)
        /** A finalized chunk of speech, ready to insert. May fire repeatedly in continuous mode. */
        fun onFinal(text: String)
        /** Recognition has fully stopped (manual stop, cancel, or fatal error). */
        fun onStopped()
        fun onError(message: String)
        /** Live mic activity, normalized 0..1, for the reactive waveform. */
        fun onLevel(level: Float) {}
    }

    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var continuous = false
    private var userStopped = false
    private val handler = Handler(Looper.getMainLooper())

    /** Restart a listening session safely, off the current recognizer callback. */
    private fun restartSoon() {
        handler.post { if (continuous && !userStopped) beginSession() }
    }

    fun isAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    private fun supportsOnDevice(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    fun start(continuous: Boolean = true) {
        if (listening) return
        if (!isAvailable() && !supportsOnDevice()) {
            callbacks.onError("Speech recognition is not available on this device.")
            return
        }
        this.continuous = continuous
        userStopped = false
        beginSession()
    }

    private fun beginSession() {
        recognizer?.destroy()
        recognizer = createRecognizer().also { it.setRecognitionListener(this) }
        listening = true
        recognizer?.startListening(recognizerIntent())
    }

    private fun createRecognizer(): SpeechRecognizer =
        if (supportsOnDevice()) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }

    /** Stop after the current phrase finalizes. */
    fun stop() {
        if (!listening) return
        userStopped = true
        listening = false
        recognizer?.stopListening()
    }

    /** Abort immediately, discarding the current phrase. */
    fun cancel() {
        userStopped = true
        listening = false
        continuous = false
        recognizer?.cancel()
        callbacks.onStopped()
    }

    fun destroy() {
        userStopped = true
        listening = false
        continuous = false
        recognizer?.destroy()
        recognizer = null
    }

    private fun recognizerIntent(): Intent =
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Keep dictation on-device so it works offline and stays fast.
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak with ColdVoice")
        }

    override fun onReadyForSpeech(params: Bundle?) {
        callbacks.onReady()
    }

    override fun onBeginningOfSpeech() = Unit

    override fun onRmsChanged(rmsdB: Float) {
        // Android reports RMS roughly in the -2..12 dB range. Map it to a 0..1
        // level so the pill waveform reacts to how loud the mic is picking up.
        val level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
        callbacks.onLevel(level)
    }

    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit

    override fun onError(error: Int) {
        // In continuous mode, a quiet pause produces NO_MATCH / SPEECH_TIMEOUT.
        // Those are not real failures — just restart and keep listening.
        val recoverable = error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        if (continuous && !userStopped && recoverable) {
            restartSoon()
            return
        }
        listening = false
        if (!recoverable) callbacks.onError(errorMessage(error))
        callbacks.onStopped()
    }

    override fun onResults(results: Bundle?) {
        val text = bestText(results)
        if (text.isNotBlank()) callbacks.onFinal(text)
        if (continuous && !userStopped) {
            restartSoon()
        } else {
            listening = false
            callbacks.onStopped()
        }
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val text = bestText(partialResults)
        if (text.isNotBlank()) callbacks.onPartial(text)
    }

    override fun onEvent(eventType: Int, params: Bundle?) = Unit

    private fun bestText(results: Bundle?): String =
        results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()

    private fun errorMessage(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
        SpeechRecognizer.ERROR_CLIENT -> "Speech recognition client error."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required."
        SpeechRecognizer.ERROR_NETWORK -> "Offline model unavailable. Install your language's on-device voice model."
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Recognition timed out."
        SpeechRecognizer.ERROR_NO_MATCH -> "No speech recognized."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy."
        SpeechRecognizer.ERROR_SERVER -> "Speech recognition server error."
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard."
        else -> "Speech recognition error $error."
    }
}

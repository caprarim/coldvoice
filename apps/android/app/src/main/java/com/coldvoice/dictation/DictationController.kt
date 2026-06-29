package com.coldvoice.dictation

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.coldvoice.asr.GroqClient
import com.coldvoice.asr.SystemSpeechRecognizer
import com.coldvoice.audio.MicRecorder
import com.coldvoice.audio.WavEncoder
import com.coldvoice.data.Settings
import com.coldvoice.net.Connectivity
import com.coldvoice.text.TextPipeline
import kotlin.concurrent.thread

/**
 * The shared dictation brain for mobile, mirroring the desktop `main.js` flow:
 *
 *  - At START it snapshots whether the rich CLOUD path is usable right now
 *    (AI enabled + not forced-offline + a Groq key + actually online). That
 *    choice can't change mid-utterance, exactly like the desktop session.
 *  - CLOUD path: record the whole clip with [MicRecorder], then on stop send one
 *    fast Groq Whisper request and clean the transcript deterministically. The
 *    app must insert dictated questions, never generated answers.
 *  - OFFLINE path: the device's on-device [SystemSpeechRecognizer], cleaned by the
 *    deterministic [TextPipeline]. Works with no internet at all.
 *
 * Both paths drive the same callbacks so the pill UI (waveform + states) and the
 * two consumers (IME keyboard, accessibility bubble) stay identical.
 */
class DictationController(
    private val context: Context,
    private val callbacks: Callbacks
) : SystemSpeechRecognizer.Callbacks {

    enum class State { RECORDING, TRANSCRIBING, DONE, INFO, ERROR }

    interface Callbacks {
        fun onState(state: State, message: String? = null)
        /** Live mic activity 0..1 for the waveform. */
        fun onLevel(level: Float)
        /** Transient live preview text (offline partials). Not yet final. */
        fun onPreview(text: String)
        /** A finalized chunk of cleaned text to append into the field. */
        fun onCommit(text: String)
        /** Dictation fully finished; [fullText] is everything committed. */
        fun onComplete(fullText: String)
    }

    enum class Engine { CLOUD, OFFLINE }

    private val main = Handler(Looper.getMainLooper())

    @Volatile private var active = false
    @Volatile private var cancelled = false
    private var engine: Engine = Engine.OFFLINE

    // Offline path.
    private var recognizer: SystemSpeechRecognizer? = null

    // Cloud path.
    private var recorder: MicRecorder? = null
    private val pcm = ArrayList<Short>()
    private var lastLevelSent = 0L

    // Accumulated final text across the whole dictation (for clipboard / completion).
    private val assembled = StringBuilder()

    val isActive: Boolean get() = active

    /** Which engine the *next* start would use, for status display. */
    fun plannedEngine(): Engine = if (cloudReady()) Engine.CLOUD else Engine.OFFLINE

    private fun cloudReady(): Boolean =
        Settings.aiEnabled(context) &&
            !Settings.offlineMode(context) &&
            Settings.hasGroqKey(context) &&
            Connectivity.isOnline(context)

    fun start() {
        if (active) return
        active = true
        cancelled = false
        assembled.setLength(0)
        engine = if (cloudReady()) Engine.CLOUD else Engine.OFFLINE
        callbacks.onState(State.RECORDING)
        if (engine == Engine.CLOUD) startCloud() else startOffline()
    }

    /** Stop and produce the final transcript. */
    fun stop() {
        if (!active) return
        when (engine) {
            Engine.CLOUD -> stopCloud()
            Engine.OFFLINE -> recognizer?.stop()
        }
    }

    /** Abort immediately, discarding the current utterance. */
    fun cancel() {
        if (!active) {
            return
        }
        cancelled = true
        active = false
        when (engine) {
            Engine.CLOUD -> { try { recorder?.stop() } catch (_: Exception) {}; recorder = null; pcm.clear() }
            Engine.OFFLINE -> recognizer?.cancel()
        }
    }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
        try { recorder?.stop() } catch (_: Exception) {}
        recorder = null
    }

    // --- OFFLINE (on-device SpeechRecognizer) ---------------------------------

    private fun startOffline() {
        val r = recognizer ?: SystemSpeechRecognizer(context, this).also { recognizer = it }
        r.start(continuous = true)
    }

    override fun onReady() { if (active) post { callbacks.onState(State.RECORDING) } }

    override fun onLevel(level: Float) { if (active) post { callbacks.onLevel(level) } }

    override fun onPartial(text: String) {
        if (active && text.isNotBlank()) post { callbacks.onPreview(text) }
    }

    override fun onFinal(text: String) {
        val clean = TextPipeline.process(text)
        if (clean.isBlank()) return
        if (assembled.isNotEmpty()) assembled.append(' ')
        assembled.append(clean)
        post { callbacks.onCommit(clean) }
    }

    override fun onStopped() {
        if (engine != Engine.OFFLINE) return
        active = false
        if (cancelled) { cancelled = false; return }
        finishWithAssembled()
    }

    override fun onError(message: String) {
        if (engine != Engine.OFFLINE) return
        active = false
        post { callbacks.onState(State.ERROR, message) }
    }

    // --- CLOUD (Groq Whisper + deterministic cleanup) -------------------------

    private fun startCloud() {
        pcm.clear()
        val rec = MicRecorder { samples -> onCloudSamples(samples) }
        recorder = rec
        try {
            rec.start()
        } catch (e: Exception) {
            active = false
            post { callbacks.onState(State.ERROR, "Microphone error: ${e.message}") }
        }
    }

    private fun onCloudSamples(samples: ShortArray) {
        if (!active || cancelled) return
        synchronized(pcm) { for (s in samples) pcm.add(s) }
        // Stream a coarse level (~25 fps) for the live waveform.
        val now = System.currentTimeMillis()
        if (now - lastLevelSent > 40) {
            lastLevelSent = now
            val level = (WavEncoder.rms(samples) * 6.0).coerceAtMost(1.0).toFloat()
            post { callbacks.onLevel(level) }
        }
    }

    private fun stopCloud() {
        try { recorder?.stop() } catch (_: Exception) {}
        recorder = null
        val samples = synchronized(pcm) { pcm.toShortArray().also { pcm.clear() } }
        active = false

        val durationMs = samples.size * 1000L / SAMPLE_RATE
        if (samples.isEmpty() || durationMs < MIN_MS || WavEncoder.rms(samples) < SILENCE_RMS) {
            post { callbacks.onState(State.INFO, "No speech detected") }
            return
        }

        post { callbacks.onState(State.TRANSCRIBING) }
        val key = Settings.groqApiKey(context)
        thread(name = "coldvoice-groq") {
            try {
                val wav = WavEncoder.encode(samples, SAMPLE_RATE)
                val raw = GroqClient(key).transcribe(wav)
                val text = TextPipeline.process(raw).trim()
                if (text.isBlank()) {
                    post { callbacks.onState(State.INFO, "No speech detected") }
                } else {
                    assembled.append(text)
                    post {
                        callbacks.onCommit(text)
                        finishWithAssembled()
                    }
                }
            } catch (e: Exception) {
                // Cloud failed (rate-limited, dropped connection, bad key). The next
                // dictation re-evaluates connectivity and will use the offline path.
                post { callbacks.onState(State.ERROR, "Cloud unavailable — tap to retry") }
            }
        }
    }

    private fun finishWithAssembled() {
        val full = assembled.toString().trim()
        if (full.isBlank()) {
            post { callbacks.onState(State.INFO, "No speech detected") }
            return
        }
        post {
            callbacks.onComplete(full)
            callbacks.onState(State.DONE)
        }
    }

    private fun post(block: () -> Unit) = main.post(block)

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val MIN_MS = 250L
        private const val SILENCE_RMS = 0.002
    }
}

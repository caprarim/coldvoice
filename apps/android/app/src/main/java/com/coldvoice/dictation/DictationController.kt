package com.coldvoice.dictation

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.coldvoice.asr.GroqClient
import com.coldvoice.asr.SystemSpeechRecognizer
import com.coldvoice.asr.VoskAsrEngine
import com.coldvoice.audio.MicRecorder
import com.coldvoice.audio.WavEncoder
import com.coldvoice.data.Settings
import com.coldvoice.data.Store
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
 *  - OFFLINE path: the bundled [VoskAsrEngine] runs the whole utterance fully
 *    on-device (model shipped in the APK), streamed from [MicRecorder] for live
 *    partials, cleaned by the deterministic [TextPipeline]. Works with no internet
 *    at all and no Google offline pack — the mobile twin of desktop whisper.cpp.
 *    If the model hasn't finished unpacking yet, it falls back to the device's
 *    [SystemSpeechRecognizer] for that one utterance.
 *
 * Both paths drive the same callbacks so the pill UI (waveform + states) and the
 * two consumers (IME keyboard, accessibility bubble) stay identical.
 */
class DictationController(
    private val context: Context,
    private val callbacks: Callbacks
) : SystemSpeechRecognizer.Callbacks {

    enum class State { RECORDING, PAUSED, TRANSCRIBING, DONE, INFO, ERROR }

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
    @Volatile private var paused = false
    private var engine: Engine = Engine.OFFLINE
    /** Within the OFFLINE engine, whether this utterance is using the bundled Vosk model. */
    private var offlineUsesVosk = false

    // Offline paths.
    private var recognizer: SystemSpeechRecognizer? = null
    private val vosk = VoskAsrEngine(context)

    // Cloud path (and Vosk audio capture).
    private var recorder: MicRecorder? = null
    private val pcm = ArrayList<Short>()
    private var lastLevelSent = 0L
    /** Whether the mic delivered anything but digital silence this utterance. */
    @Volatile private var heardSignal = false

    /**
     * Which app the finished text is going into, recorded with the transcript so
     * the Home feed and Insights can break usage down per app. Set by whichever
     * consumer owns the dictation before [start].
     */
    var targetApp: String? = null

    private var startedAt = 0L
    private val rawAssembled = StringBuilder()
    private var dictionary: List<TextPipeline.DictEntry> = emptyList()
    private var snippets: List<TextPipeline.Snippet> = emptyList()
    private var tone: String? = null

    init {
        // Unpack + load the offline model off the main thread so on-device
        // dictation is ready by the time the user first taps to speak.
        thread(name = "coldvoice-vosk-init") { vosk.load() }
        thread(name = "coldvoice-store-warm") { Store.warm(context) }
    }

    /** True once the bundled offline model is loaded and on-device ASR is usable. */
    fun offlineModelReady(): Boolean = vosk.ready

    // Accumulated final text across the whole dictation (for clipboard / completion).
    private val assembled = StringBuilder()

    val isActive: Boolean get() = active
    val isPaused: Boolean get() = paused

    /** Which engine the *next* start would use, for status display. */
    fun plannedEngine(): Engine = if (cloudReady()) Engine.CLOUD else Engine.OFFLINE

    /**
     * Set when a cloud attempt fails. Being online with a valid-looking key says
     * nothing about whether Groq will actually answer — a rate-limited free tier
     * looks exactly like a healthy one until the request comes back. Without this
     * every retry re-picked the cloud and failed the same way, so dictation
     * stayed broken for as long as the limit lasted.
     */
    @Volatile private var cloudBlockedUntil = 0L

    private fun cloudReady(): Boolean =
        Settings.aiEnabled(context) &&
            !Settings.offlineMode(context) &&
            Settings.hasGroqKey(context) &&
            System.currentTimeMillis() >= cloudBlockedUntil &&
            Connectivity.isOnline(context)

    /**
     * The user's own exact rules for this utterance. Read at START so a word added
     * a moment ago is already in force, and held for the whole dictation so the
     * rules can't change halfway through it.
     */
    private fun loadUserRules() {
        dictionary = Store.listDictionary(context)
            .filter { it.enabled && it.phrase.isNotBlank() }
            .flatMap { entry ->
                val replacement = entry.replacement.ifBlank { entry.phrase }
                listOf(TextPipeline.DictEntry(entry.phrase, replacement, entry.caseSensitive)) +
                    entry.aliases.filter { it.isNotBlank() }
                        .map { TextPipeline.DictEntry(it, replacement, entry.caseSensitive) }
            }
        snippets = Store.listSnippets(context)
            .filter { it.enabled && it.trigger.isNotBlank() }
            .map { TextPipeline.Snippet(it.trigger, it.expansion, true) }
        tone = Settings.toneForModel(context)
    }

    fun start() {
        if (active) return
        active = true
        cancelled = false
        paused = false
        assembled.setLength(0)
        rawAssembled.setLength(0)
        startedAt = System.currentTimeMillis()
        loadUserRules()
        engine = if (cloudReady()) Engine.CLOUD else Engine.OFFLINE
        offlineUsesVosk = engine == Engine.OFFLINE && vosk.ready
        callbacks.onState(State.RECORDING)
        when {
            engine == Engine.CLOUD -> startCloud()
            offlineUsesVosk -> startVosk()
            else -> startOffline()
        }
    }

    /** Stop and produce the final transcript. */
    fun stop() {
        if (!active) return
        paused = false
        when {
            engine == Engine.CLOUD -> stopCloud()
            offlineUsesVosk -> stopVosk()
            else -> recognizer?.stop()
        }
    }

    /**
     * Hold the dictation without ending it. Everything captured so far is kept,
     * so [resume] carries straight on from where the speaker left off. The mic
     * stays open on the buffered paths so resuming is instant; the system
     * recognizer has no pause of its own, so its current phrase is finalized into
     * [assembled] and a fresh one starts on resume.
     */
    fun pause() {
        if (!active || paused) return
        paused = true
        if (engine == Engine.OFFLINE && !offlineUsesVosk) recognizer?.stop()
        post { callbacks.onLevel(0f) }
        post { callbacks.onState(State.PAUSED) }
    }

    fun resume() {
        if (!active || !paused) return
        paused = false
        if (engine == Engine.OFFLINE && !offlineUsesVosk) recognizer?.start(continuous = true)
        post { callbacks.onState(State.RECORDING) }
    }

    fun togglePause() {
        if (paused) resume() else pause()
    }

    /** Abort immediately, discarding the current utterance. */
    fun cancel() {
        if (!active) {
            return
        }
        cancelled = true
        active = false
        paused = false
        when {
            engine == Engine.CLOUD -> { try { recorder?.stop() } catch (_: Exception) {}; recorder = null; pcm.clear() }
            offlineUsesVosk -> { try { recorder?.stop() } catch (_: Exception) {}; recorder = null; vosk.cancel() }
            else -> recognizer?.cancel()
        }
    }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
        try { recorder?.stop() } catch (_: Exception) {}
        recorder = null
        vosk.close()
    }

    // --- OFFLINE (bundled Vosk model, fully on-device) ------------------------

    private fun startVosk() {
        vosk.begin()
        heardSignal = false
        val rec = MicRecorder { samples -> onVoskSamples(samples) }
        recorder = rec
        try {
            rec.start()
        } catch (e: Exception) {
            active = false
            recorder = null
            vosk.cancel()
            post { callbacks.onState(State.ERROR, micMessage(e)) }
        }
    }

    private fun onVoskSamples(samples: ShortArray) {
        if (!active || cancelled || paused) return
        if (!heardSignal && WavEncoder.peak(samples) > 0) heardSignal = true
        // Stream a coarse level (~25 fps) for the live waveform.
        val now = System.currentTimeMillis()
        if (now - lastLevelSent > 40) {
            lastLevelSent = now
            val level = (WavEncoder.rms(samples) * LEVEL_GAIN).coerceAtMost(1.0).toFloat()
            post { callbacks.onLevel(level) }
        }
        val finalChunk = vosk.accept(samples, samples.size)
        if (finalChunk != null) {
            commitChunk(finalChunk)
        } else {
            val partial = vosk.partial()
            if (partial.isNotBlank()) post { callbacks.onPreview(partial) }
        }
    }

    private fun stopVosk() {
        // Flip active off first so any in-flight mic callback bails before we
        // close the recognizer below.
        active = false
        val mic = recorder
        try { mic?.stop() } catch (_: Exception) {}
        val micError = mic?.lastError()
        recorder = null
        post { callbacks.onState(State.TRANSCRIBING) }
        // Flush any trailing phrase the recognizer was still forming.
        commitChunk(vosk.end())
        if (assembled.isEmpty() && !heardSignal) {
            // The mic handed back nothing but zeroes for the whole utterance, so
            // no recognizer was ever going to find words in it.
            post { callbacks.onState(State.ERROR, micError ?: MUTED_MIC) }
            return
        }
        finishWithAssembled()
    }

    /** Clean a recognized phrase and append/emit it if there's anything left. */
    private fun commitChunk(raw: String) {
        val clean = TextPipeline.process(raw, dictionary, snippets).trim()
        if (clean.isBlank()) return
        appendRaw(raw)
        if (assembled.isNotEmpty()) assembled.append(' ')
        assembled.append(clean)
        post { callbacks.onCommit(clean) }
    }

    private fun appendRaw(raw: String) {
        val piece = raw.trim()
        if (piece.isEmpty()) return
        if (rawAssembled.isNotEmpty()) rawAssembled.append(' ')
        rawAssembled.append(piece)
    }

    // --- OFFLINE (on-device SpeechRecognizer fallback) ------------------------

    private fun startOffline() {
        val r = recognizer ?: SystemSpeechRecognizer(context, this).also { recognizer = it }
        r.start(continuous = true)
    }

    override fun onReady() { if (active) post { callbacks.onState(State.RECORDING) } }

    override fun onLevel(level: Float) { if (active) post { callbacks.onLevel(level) } }

    override fun onPartial(text: String) {
        if (active && !paused && text.isNotBlank()) post { callbacks.onPreview(text) }
    }

    override fun onFinal(text: String) {
        val clean = TextPipeline.process(text, dictionary, snippets)
        if (clean.isBlank()) return
        appendRaw(text)
        if (assembled.isNotEmpty()) assembled.append(' ')
        assembled.append(clean)
        post { callbacks.onCommit(clean) }
    }

    override fun onStopped() {
        if (engine != Engine.OFFLINE) return
        // A pause stops the system recognizer on purpose; the dictation is still
        // live and resume will start a fresh phrase on top of what's assembled.
        if (paused) return
        active = false
        if (cancelled) { cancelled = false; return }
        finishWithAssembled()
    }

    override fun onError(message: String) {
        if (engine != Engine.OFFLINE) return
        // Stopping the recognizer to pause can surface a spurious "no match".
        if (paused) return
        active = false
        post { callbacks.onState(State.ERROR, message) }
    }

    // --- CLOUD (Groq Whisper + deterministic cleanup) -------------------------

    private fun startCloud() {
        pcm.clear()
        heardSignal = false
        val rec = MicRecorder { samples -> onCloudSamples(samples) }
        recorder = rec
        try {
            rec.start()
        } catch (e: Exception) {
            active = false
            recorder = null
            post { callbacks.onState(State.ERROR, micMessage(e)) }
        }
    }

    /** [MicRecorder] already words its failures for a person; anything else is a bug. */
    private fun micMessage(e: Exception): String =
        if (e is MicRecorder.MicException) e.message.orEmpty()
        else "Microphone error: ${e.message}"

    private fun onCloudSamples(samples: ShortArray) {
        if (!active || cancelled || paused) return
        if (!heardSignal && WavEncoder.peak(samples) > 0) heardSignal = true
        synchronized(pcm) { for (s in samples) pcm.add(s) }
        // Stream a coarse level (~25 fps) for the live waveform.
        val now = System.currentTimeMillis()
        if (now - lastLevelSent > 40) {
            lastLevelSent = now
            val level = (WavEncoder.rms(samples) * LEVEL_GAIN).coerceAtMost(1.0).toFloat()
            post { callbacks.onLevel(level) }
        }
    }

    private fun stopCloud() {
        val mic = recorder
        try { mic?.stop() } catch (_: Exception) {}
        val micError = mic?.lastError()
        recorder = null
        val samples = synchronized(pcm) { pcm.toShortArray().also { pcm.clear() } }
        active = false

        val durationMs = samples.size * 1000L / SAMPLE_RATE
        if (samples.isEmpty() || durationMs < MIN_MS) {
            post { callbacks.onState(State.INFO, micError ?: "No speech detected") }
            return
        }
        if (WavEncoder.peak(samples) == 0) {
            post { callbacks.onState(State.ERROR, micError ?: MUTED_MIC) }
            return
        }
        if (!hasSpeech(samples)) {
            post { callbacks.onState(State.INFO, "No speech detected") }
            return
        }

        post { callbacks.onState(State.TRANSCRIBING) }
        val key = Settings.groqApiKey(context)
        val developerMode = Settings.developerMode(context)
        val utteranceTone = tone
        thread(name = "coldvoice-groq") {
            var text = ""
            try {
                // Boost quiet audio so Whisper hears it clearly. The cap is high
                // enough that an actual whisper still reaches the model at a
                // usable level; the silence gate above already rejected real noise.
                val wav = WavEncoder.encode(
                    WavEncoder.normalizeQuiet(samples, WHISPER_MAX_GAIN), SAMPLE_RATE
                )
                val client = GroqClient(key)
                val raw = client.transcribe(wav).trim()
                appendRaw(raw)
                // Same split as desktop main.js: very short utterances go straight
                // through the deterministic rules (an LLM round-trip would cost
                // more latency than it's worth), everything else gets the real
                // grammar + formatting pass. A failed polish keeps the accurate
                // cloud transcript rather than throwing the dictation away.
                text = when {
                    raw.isBlank() -> ""
                    raw.split(Regex("\\s+")).size <= SHORT_UTTERANCE_WORDS ->
                        TextPipeline.process(raw, dictionary, snippets).trim()
                    else -> try {
                        TextPipeline.applyUserRules(
                            client.cleanText(raw, developerMode, utteranceTone), dictionary, snippets
                        ).trim()
                    } catch (e: Exception) {
                        TextPipeline.process(raw, dictionary, snippets).trim()
                    }
                }
            } catch (e: Exception) {
                // Cloud is unreachable, rate-limited or refusing the key. The
                // recording still exists, so decode it on-device rather than
                // making the user say it all again, and stop choosing the cloud
                // for a while so the next few dictations are simply fast.
                cloudBlockedUntil = System.currentTimeMillis() + CLOUD_COOLDOWN_MS
                val rescued = offlineRescue(samples)
                appendRaw(rescued)
                text = TextPipeline.process(rescued, dictionary, snippets).trim()
                if (text.isBlank()) {
                    post { callbacks.onState(State.ERROR, "Cloud unavailable — tap to retry") }
                    return@thread
                }
            }
            if (text.isBlank()) {
                post { callbacks.onState(State.INFO, "No speech detected") }
            } else {
                assembled.append(text)
                post {
                    callbacks.onCommit(text)
                    finishWithAssembled()
                }
            }
        }
    }

    /** Last-resort on-device decode of an already-recorded clip. */
    private fun offlineRescue(samples: ShortArray): String {
        if (!vosk.ready && !vosk.load()) return ""
        return vosk.transcribeClip(samples)
    }

    /**
     * Whether the clip actually contains someone talking. Both tests have to pass:
     * enough overall energy to clear the noise floor, and a loud enough burst
     * somewhere inside it. The burst test is what stops a quiet room from being
     * amplified [WHISPER_MAX_GAIN]x into something Whisper will confidently
     * transcribe as words that were never spoken.
     */
    private fun hasSpeech(samples: ShortArray): Boolean =
        WavEncoder.rms(samples) >= SILENCE_RMS &&
            WavEncoder.peakWindowRms(samples, SAMPLE_RATE / 5) >= SPEECH_PEAK_RMS

    private fun finishWithAssembled() {
        val full = assembled.toString().trim()
        if (full.isBlank()) {
            post { callbacks.onState(State.INFO, "No speech detected") }
            return
        }
        saveToHistory(full)
        post {
            callbacks.onComplete(full)
            callbacks.onState(State.DONE)
        }
    }

    /**
     * Keep the finished dictation, so mobile has the same all-time history the
     * desktop app does. Local only — the row never leaves the phone, and nothing
     * is written at all when the user has history switched off.
     */
    private fun saveToHistory(final: String) {
        if (!Settings.storeTranscripts(context)) return
        val raw = rawAssembled.toString().trim().ifBlank { final }
        val durationMs = if (startedAt > 0) System.currentTimeMillis() - startedAt else 0L
        val app = targetApp
        thread(name = "coldvoice-history") {
            Store.saveTranscript(context, raw, final, app, durationMs)
        }
    }

    private fun post(block: () -> Unit) = main.post(block)

    companion object {
        private const val SAMPLE_RATE = 16000
        private const val MIN_MS = 250L
        // Whispering sits far below normal speech: a phone held at arm's length
        // picks it up around 0.001-0.004 RMS, so the old 0.002 gate threw half of
        // it away as silence. This is set just above the noise floor of a quiet
        // room instead, and the gain below carries the rest.
        private const val SILENCE_RMS = 0.0006
        /**
         * Minimum loudness of the clip's loudest fifth of a second. Steady room
         * noise never reaches it; even a whisper does, because speech comes in
         * bursts. See [hasSpeech].
         */
        private const val SPEECH_PEAK_RMS = 0.0015
        private const val WHISPER_MAX_GAIN = 26.0
        private const val SHORT_UTTERANCE_WORDS = 3
        /** How long to stay off the cloud after it fails. */
        private const val CLOUD_COOLDOWN_MS = 5 * 60 * 1000L
        private const val MUTED_MIC =
            "No audio from the microphone. Close other apps using it, then try again."
        /** Waveform sensitivity — high enough that a whisper still visibly moves it. */
        private const val LEVEL_GAIN = 14.0
    }
}

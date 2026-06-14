package com.coldvoice.asr

/**
 * Offline ASR contract. Implementations run fully on-device (sherpa-onnx by
 * default, whisper.cpp/JNI as a fallback). No network access.
 */
interface AsrEngine {
    /** True once model files are present and the engine is initialized. */
    fun isReady(): Boolean

    /** Human-readable setup instructions when [isReady] is false. */
    fun setupMessage(): String

    /** Feed a chunk of 16 kHz mono PCM16 samples while recording. */
    fun acceptSamples(samples: ShortArray)

    /** Finish the utterance and return the final transcript. */
    fun finish(): String

    /** Discard any buffered audio (used on cancel). */
    fun reset()
}

package com.coldvoice.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlin.concurrent.thread

/**
 * Captures 16 kHz mono PCM16 from the mic and streams Short chunks to a callback
 * while recording. Stops cleanly on [stop]. No audio is persisted.
 */
class MicRecorder(private val onSamples: (ShortArray) -> Unit) {

    class MicException(message: String) : Exception(message)

    private val sampleRate = 16000
    private val minBuf = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )

    @Volatile private var recording = false
    @Volatile private var reader: Thread? = null
    private var record: AudioRecord? = null

    /** Set when the capture loop dies on its own, so the caller can report why. */
    @Volatile private var failure: String? = null

    fun lastError(): String? = failure

    /**
     * Open the mic and start streaming.
     *
     * Every step is checked. An [AudioRecord] whose constructor could not claim
     * the mic — another app holding it, the recognition source being unavailable,
     * a revoked permission — is not an exception, it is an object in
     * STATE_UNINITIALIZED whose startRecording() quietly does nothing and whose
     * read() returns an error code forever. Left unchecked that spun the capture
     * thread at full tilt and produced a dictation of pure silence, which is what
     * "it just doesn't dictate sometimes" looked like from the outside.
     */
    @SuppressLint("MissingPermission") // RECORD_AUDIO checked by the caller
    fun start() {
        if (recording) return
        failure = null
        if (minBuf <= 0) throw MicException("This device cannot record at 16 kHz.")

        val audio = try {
            AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuf, sampleRate)
            )
        } catch (e: Exception) {
            throw MicException("Microphone unavailable: ${e.message}")
        }
        if (audio.state != AudioRecord.STATE_INITIALIZED) {
            audio.release()
            throw MicException("Microphone is in use by another app.")
        }

        try {
            audio.startRecording()
        } catch (e: IllegalStateException) {
            audio.release()
            throw MicException("Microphone could not start: ${e.message}")
        }
        if (audio.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            audio.release()
            throw MicException("Microphone is in use by another app.")
        }

        record = audio
        recording = true
        reader = thread(name = "coldvoice-mic") {
            val buf = ShortArray(minBuf.coerceAtLeast(1024))
            try {
                while (recording) {
                    val n = audio.read(buf, 0, buf.size)
                    if (n > 0) {
                        onSamples(buf.copyOf(n))
                    } else if (n < 0) {
                        // ERROR_INVALID_OPERATION / ERROR_DEAD_OBJECT and friends
                        // never recover. Bail out instead of burning a core.
                        failure = "Microphone stopped delivering audio."
                        break
                    }
                }
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            }
        }
    }

    /**
     * Stop capturing and release the mic.
     *
     * The capture thread is joined before the [AudioRecord] is released:
     * releasing it while that thread is parked inside read() frees native memory
     * out from under an active call, which crashes the whole process — taking the
     * keyboard or the accessibility service down with it.
     */
    fun stop() {
        recording = false
        val thread = reader
        reader = null
        if (thread != null && thread !== Thread.currentThread()) {
            try { thread.join(JOIN_TIMEOUT_MS) } catch (_: InterruptedException) {}
        }
        val audio = record
        record = null
        if (audio != null) {
            try { audio.stop() } catch (_: IllegalStateException) {}
            audio.release()
        }
    }

    private companion object {
        /** Generous next to one read() of buffered audio, short of an ANR. */
        const val JOIN_TIMEOUT_MS = 500L
    }
}

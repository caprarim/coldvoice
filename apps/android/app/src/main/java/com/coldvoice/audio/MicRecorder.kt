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

    private val sampleRate = 16000
    private val minBuf = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )

    @Volatile private var recording = false
    private var record: AudioRecord? = null

    @SuppressLint("MissingPermission") // RECORD_AUDIO checked by the caller
    fun start() {
        if (recording) return
        record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf, sampleRate)
        )
        record?.startRecording()
        recording = true
        thread(name = "coldvoice-mic") {
            val buf = ShortArray(minBuf.coerceAtLeast(1024))
            while (recording) {
                val n = record?.read(buf, 0, buf.size) ?: -1
                if (n > 0) onSamples(buf.copyOf(n))
            }
        }
    }

    fun stop() {
        recording = false
        try {
            record?.stop()
        } catch (_: IllegalStateException) {
        }
        record?.release()
        record = null
    }
}

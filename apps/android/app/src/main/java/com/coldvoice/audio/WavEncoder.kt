package com.coldvoice.audio

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Encodes 16 kHz mono PCM16 samples into a minimal WAV container, matching the
 * desktop `asr.wavBuffer()` output that the Groq Whisper upload expects.
 */
object WavEncoder {

    /** Build a 16-bit mono WAV byte array from raw PCM16 samples. */
    fun encode(samples: ShortArray, sampleRate: Int = 16000): ByteArray {
        val dataSize = samples.size * 2
        val out = ByteArrayOutputStream(44 + dataSize)
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)

        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + dataSize)          // file size - 8
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)                     // PCM fmt chunk size
        header.putShort(1)                    // audio format = PCM
        header.putShort(1)                    // channels = mono
        header.putInt(sampleRate)             // sample rate
        header.putInt(sampleRate * 2)         // byte rate = rate * channels * bytesPerSample
        header.putShort(2)                    // block align = channels * bytesPerSample
        header.putShort(16)                   // bits per sample
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataSize)
        out.write(header.array())

        val pcm = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN)
        for (s in samples) pcm.putShort(s)
        out.write(pcm.array())

        return out.toByteArray()
    }

    /** Root-mean-square loudness of PCM16 samples, 0..1. Mirrors desktop pcmRms. */
    fun rms(samples: ShortArray): Double {
        if (samples.isEmpty()) return 0.0
        var sum = 0.0
        for (s in samples) {
            val v = s / 32768.0
            sum += v * v
        }
        return Math.sqrt(sum / samples.size)
    }

    /** Largest absolute sample value, 0..32767. Zero means digital silence. */
    fun peak(samples: ShortArray): Int {
        var peak = 0
        for (s in samples) {
            val a = if (s == Short.MIN_VALUE) 32767 else Math.abs(s.toInt())
            if (a > peak) peak = a
        }
        return peak
    }

    /**
     * Loudness of the loudest [window]-sample stretch, 0..1.
     *
     * Whole-clip RMS cannot tell a quiet talker from a quiet room: a few seconds
     * of speech surrounded by silence averages out to about the same number as
     * steady background hiss. Speech is bursty though, so its loudest window
     * stands well above its own average while noise stays flat — which is what
     * separates "they whispered" from "nobody said anything".
     */
    fun peakWindowRms(samples: ShortArray, window: Int): Double {
        if (samples.isEmpty()) return 0.0
        val size = window.coerceIn(1, samples.size)
        val step = maxOf(1, size / 2)  // overlap so a burst is never split in two
        var best = 0.0
        var i = 0
        while (i < samples.size) {
            val end = minOf(i + size, samples.size)
            var sum = 0.0
            for (j in i until end) {
                val v = samples[j] / 32768.0
                sum += v * v
            }
            val rms = Math.sqrt(sum / (end - i))
            if (rms > best) best = rms
            i += step
        }
        return best
    }

    /**
     * Peak-normalize quiet recordings (far-from-mic speech) so the ASR gets a
     * strong signal. Gain is capped so noise-only audio isn't blown up, and
     * already-loud audio is returned untouched. Mirrors the desktop recorder.
     */
    fun normalizeQuiet(samples: ShortArray, maxGain: Double = 12.0): ShortArray {
        if (samples.isEmpty()) return samples
        var peak = 0
        for (s in samples) {
            val a = if (s == Short.MIN_VALUE) 32767 else Math.abs(s.toInt())
            if (a > peak) peak = a
        }
        if (peak == 0) return samples
        val gain = Math.min(maxGain, 0.9 * 32767.0 / peak)
        if (gain <= 1.05) return samples
        val out = ShortArray(samples.size)
        for (i in samples.indices) {
            val v = Math.round(samples[i] * gain).toInt()
            out[i] = v.coerceIn(-32768, 32767).toShort()
        }
        return out
    }
}

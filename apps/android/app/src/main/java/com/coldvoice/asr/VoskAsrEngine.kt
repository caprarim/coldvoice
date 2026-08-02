package com.coldvoice.asr

import android.content.Context
import android.content.res.AssetManager
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.FileOutputStream

/**
 * Fully on-device, offline speech recognition backed by Vosk.
 *
 * The small English model ships inside the APK under `assets/model-en-us`. On
 * first use it is unpacked once into filesDir and a Vosk [Recognizer] is created
 * at the mic's 16 kHz sample rate. Nothing here ever touches the network — this
 * is the mobile equivalent of the desktop whisper.cpp offline path, so dictation
 * works with no internet and no Google offline language pack.
 *
 * Usage mirrors a streaming recognizer: [load] once, [begin] an utterance, feed
 * 16 kHz PCM16 chunks via [accept] (which returns a finalized phrase at each
 * silence boundary, or null while a live [partial] is forming), then [end] to
 * flush the trailing text.
 */
class VoskAsrEngine(private val context: Context) {

    @Volatile private var model: Model? = null
    @Volatile private var recognizer: Recognizer? = null
    @Volatile private var loadError: String? = null

    /** True once the model is unpacked and loaded — i.e. offline ASR is usable. */
    val ready: Boolean get() = model != null

    fun lastError(): String? = loadError

    /** Unpack + load the model. Heavy work runs once; safe to call repeatedly. */
    @Synchronized
    fun load(): Boolean {
        if (model != null) return true
        return try {
            val dir = unpackModel()
            model = Model(dir.absolutePath)
            loadError = null
            true
        } catch (e: Throwable) {
            loadError = e.message ?: e.toString()
            Log.e(TAG, "Failed to load Vosk model", e)
            false
        }
    }

    /** Start a fresh dictation utterance stream. */
    @Synchronized
    fun begin() {
        val m = model ?: return
        recognizer?.close()
        recognizer = Recognizer(m, SAMPLE_RATE)
    }

    /**
     * Feed a chunk of 16 kHz PCM16 samples. Returns a finalized phrase when the
     * recognizer hits a silence boundary, otherwise null (a live transcript is
     * available via [partial]).
     *
     * Synchronized with the lifecycle methods below: audio arrives on the mic
     * thread while [end], [cancel] and [close] run on the main thread, and a Vosk
     * [Recognizer] is a native handle with no locking of its own. Reading a
     * handle that another thread is closing is a segfault, and it killed the
     * whole IME or accessibility service — after which nothing dictated until
     * Android restarted it.
     */
    @Synchronized
    fun accept(buf: ShortArray, len: Int): String? {
        val rec = recognizer ?: return null
        return if (rec.acceptWaveForm(buf, len)) textOf(rec.result, "text") else null
    }

    /** Current live partial transcript (may be empty). */
    @Synchronized
    fun partial(): String {
        val rec = recognizer ?: return ""
        return textOf(rec.partialResult, "partial")
    }

    /** Flush and return any trailing recognized text, then end the stream. */
    @Synchronized
    fun end(): String {
        val rec = recognizer ?: return ""
        val text = textOf(rec.finalResult, "text")
        rec.close()
        recognizer = null
        return text
    }

    /**
     * Decode one complete clip in a single pass and return everything recognized.
     *
     * This is the rescue path for a cloud attempt that failed after the audio was
     * already captured: the recording still becomes text on-device instead of
     * being thrown away. It builds its own recognizer so a live streaming
     * utterance, if there somehow is one, is left untouched.
     */
    @Synchronized
    fun transcribeClip(samples: ShortArray): String {
        val m = model ?: return ""
        val rec = Recognizer(m, SAMPLE_RATE)
        return try {
            val out = StringBuilder()
            fun add(phrase: String) {
                if (phrase.isEmpty()) return
                if (out.isNotEmpty()) out.append(' ')
                out.append(phrase)
            }
            var i = 0
            while (i < samples.size) {
                val len = minOf(CHUNK_SAMPLES, samples.size - i)
                val chunk = samples.copyOfRange(i, i + len)
                if (rec.acceptWaveForm(chunk, len)) add(textOf(rec.result, "text"))
                i += len
            }
            add(textOf(rec.finalResult, "text"))
            out.toString()
        } catch (e: Exception) {
            Log.e(TAG, "Offline clip decode failed", e)
            ""
        } finally {
            try { rec.close() } catch (_: Exception) {}
        }
    }

    /** Abort the current stream, discarding buffered audio. */
    @Synchronized
    fun cancel() {
        recognizer?.close()
        recognizer = null
    }

    /** Release model + recognizer. The engine can be [load]ed again afterwards. */
    @Synchronized
    fun close() {
        recognizer?.close()
        recognizer = null
        model?.close()
        model = null
    }

    private fun textOf(json: String?, key: String): String =
        try {
            JSONObject(json ?: "{}").optString(key, "").trim()
        } catch (_: Exception) {
            ""
        }

    private fun unpackModel(): File {
        val target = File(context.filesDir, MODEL_DIR)
        val marker = File(target, MARKER)
        if (marker.exists()) return target
        if (target.exists()) target.deleteRecursively()
        copyAsset(context.assets, ASSET_DIR, target)
        marker.writeText(MARKER_VALUE)
        return target
    }

    private fun copyAsset(am: AssetManager, path: String, dst: File) {
        val children = am.list(path) ?: emptyArray()
        if (children.isEmpty()) {
            // Leaf: an asset file. Stream it out, decompressing transparently.
            dst.parentFile?.mkdirs()
            am.open(path).use { input -> FileOutputStream(dst).use { out -> input.copyTo(out) } }
        } else {
            dst.mkdirs()
            for (c in children) copyAsset(am, "$path/$c", File(dst, c))
        }
    }

    companion object {
        private const val TAG = "VoskAsrEngine"
        private const val ASSET_DIR = "model-en-us"
        private const val MODEL_DIR = "vosk-model-en-us"
        private const val MARKER = ".unpacked"
        private const val MARKER_VALUE = "v1"
        private const val SAMPLE_RATE = 16000f
        /** Half a second of 16 kHz audio per acceptWaveForm call. */
        private const val CHUNK_SAMPLES = 8000
    }
}

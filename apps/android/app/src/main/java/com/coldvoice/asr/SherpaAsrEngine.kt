package com.coldvoice.asr

import android.content.Context
import java.io.File

/**
 * sherpa-onnx streaming ASR adapter.
 *
 * Integration point: drop the sherpa-onnx Android library (.aar) into the app
 * module and the model files under filesDir/models, then wire the calls marked
 * TODO below to the sherpa-onnx OnlineRecognizer API. Until the model is
 * present, [isReady] returns false and the IME shows setup instructions — it
 * never falls back to any cloud service.
 */
class SherpaAsrEngine(private val context: Context) : AsrEngine {

    private val modelDir = File(context.filesDir, "models/sherpa")
    private val buffer = ArrayList<Short>()

    // private var recognizer: OnlineRecognizer? = null  // from sherpa-onnx

    override fun isReady(): Boolean = modelDir.isDirectory && (modelDir.listFiles()?.isNotEmpty() == true)

    override fun setupMessage(): String =
        "Offline ASR model not installed.\n" +
            "Place sherpa-onnx model files in: ${modelDir.absolutePath}\n" +
            "Everything runs on-device; no internet is used."

    override fun acceptSamples(samples: ShortArray) {
        for (s in samples) buffer.add(s)
        // TODO(sherpa): recognizer?.acceptWaveform(16000, samples.toFloatNormalized())
    }

    override fun finish(): String {
        if (!isReady()) throw IllegalStateException(setupMessage())
        // TODO(sherpa): recognizer?.inputFinished(); val text = recognizer?.text ?: ""
        buffer.clear()
        return "" // replaced by recognizer output once sherpa-onnx is wired in
    }

    override fun reset() {
        buffer.clear()
        // TODO(sherpa): recognizer?.reset()
    }
}

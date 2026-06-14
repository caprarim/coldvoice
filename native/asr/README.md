# native/asr

Offline ASR for ColdVoice. No internet required at runtime.

## Windows (installed)

whisper.cpp v1.8.6 CPU x64 build is installed here:

- `whisper-cli.exe` — the transcriber the app shells out to
- `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`, `whisper.dll` — required runtime libs

The model lives in `../../models/ggml-base.en.bin`. `src/main/asr.js` finds this binary
and model automatically; `tiny.en` / `small.en` also work if dropped into `models/`.

Verified end-to-end: synthesized speech → `whisper-cli` → cleanup pipeline produced the
expected text on a CPU-only machine.

## Android

sherpa-onnx streaming (default) with a whisper.cpp/JNI fallback. Model files load from
`filesDir/models/`. See `apps/android`.

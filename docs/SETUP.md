# ColdVoice Setup

## Requirements

- Node.js 18+ (for the shared packages and tests). Confirmed working on Node 25.
- Windows app (later): Electron toolchain + a C++ build toolchain for the native helper
  and whisper.cpp.
- Android app (later): Android Studio / Kotlin + NDK for the ASR JNI bridge.

## Run the shared tests

From the repo root:

```
node --test "packages/shared/**/test/**/*.test.js"
```

This needs no `npm install` — it uses Node's built-in test runner.

## Models

ASR model files live in `models/` and are **not** committed. If a model is missing the
app shows setup instructions instead of calling any cloud API.

- Windows: whisper.cpp `base.en` (default), `tiny.en` (speed), `small.en` (accuracy).
- Android: sherpa-onnx streaming model (default), whisper.cpp fallback.

## Next steps (not yet built)

4. Windows MVP: Electron UI, global hotkey (Ctrl+1), mic capture, offline ASR call,
   floating pill, insert into active input.
5. Dictionary + Snippets screens.
6. Android MVP: InputMethodService keyboard + mic + ASR + `commitText`.
7. Android optional accessibility bubble.
8. Packaging.

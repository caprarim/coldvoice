# android

ColdVoice for Android (Kotlin). Build with Android Studio or Gradle.

## Build (APK)

```
cd apps/android
./gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. No Play Store setup required.

## What's implemented

- **ColdVoice voice keyboard** (`ime/ColdVoiceImeService`): an `InputMethodService` with a
  mic button. Tap to dictate → offline ASR → shared cleanup → `commitText` into the field.
- **Insertion guard** (`input/InsertionGuard`): mirrors `packages/shared/input-detection`.
  Rejects password / secure fields (IME `EditorInfo` and accessibility-node paths) and a
  banking blocklist.
- **Text pipeline** (`text/TextPipeline`): Kotlin port of the core cleanup steps
  (whitespace, spoken punctuation, fillers, formatting, dictionary, snippets). Keep in
  sync with the JS source of truth.
- **Mic recorder** (`audio/MicRecorder`): 16 kHz mono PCM16 capture via `AudioRecord`
  (`VOICE_RECOGNITION`). No audio persisted.
- **Optional bubble** (`a11y/ColdVoiceBubbleService`): `AccessibilityService` that listens
  only for focus/selection changes to show a side bubble beside editable, non-password
  fields. Insert path uses `ACTION_SET_TEXT` on editable nodes only.

## Integration points (marked `TODO` in code)

- **sherpa-onnx**: add the Android library + model files under `filesDir/models/sherpa`,
  then wire `asr/SherpaAsrEngine`. Until present, `isReady()` is false and the keyboard
  shows setup instructions — never a cloud call. whisper.cpp/JNI is the fallback.
- **Bubble overlay window**: `showBubble()/hideBubble()` add/remove a
  `TYPE_ACCESSIBILITY_OVERLAY` window (tap = dictate, ✓ = insert, ✕ = cancel).

## Not verified here

No Android SDK build was run in this environment. Sources are written to be idiomatic and
compile-ready against AGP 8.5 / Kotlin 2.0, but treat the first `./gradlew assembleDebug`
as the real check.

# Progress — ColdVoice

## Android: true offline dictation + typing keyboard (v0.2.0)
- Bundled **Vosk** small en-us model in the APK (`assets/model-en-us`) → fully on-device
  offline dictation, no internet and no Google offline pack. New `VoskAsrEngine` unpacks
  the model once to filesDir and streams 16 kHz mic PCM for live partials/finals.
- `DictationController` offline path now uses Vosk (falls back to the system recognizer
  only while the model is still unpacking). Cloud Groq path unchanged.
- IME (`ColdVoiceImeService`) gained a full **QWERTY + ?123 symbols** layout (shift,
  backspace, space, enter, comma/period) alongside the dictation pill — type or speak.
- Trimmed to arm-only ABIs + bumped to versionCode 3 → APK ~60 MB (was 106 MB).
- Rebuilt APK, copied to website downloads, deployed to **coldvoice.vercel.app**
  (live download verified, 60.4 MB).

## Earlier
- Secured the Groq key (injected at build time from gitignored `local.properties`).
- Dual-path dictation (cloud Groq online / on-device offline) with automatic fallback.
- Fixed Android keyboard onboarding dead-end (button flips to "Switch to ColdVoice
  keyboard", status reflects enabled/active state, in-app try field).

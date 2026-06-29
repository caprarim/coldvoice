# android

ColdVoice for Android — redesigned to feel and work like the Windows/Electron
desktop app: a clean, blackish, minimal, developer-friendly UI and the same
dictation flow (fast cloud polishing when online, fully offline when not).

## Build APK

```powershell
cd apps/android
.\gradlew.bat assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/`. The website build
(`apps/website`) picks this up automatically for the download link; the committed
copy served by cold-voice.vercel.app is `apps/website/public/src/downloads/ColdVoice.apk`.

JDK: any JDK 17. Android Studio's bundled JBR works
(`JAVA_HOME=C:\Program Files\Android\Android Studio\jbr`).

## Architecture (mirrors the desktop app)

The dictation engine and pill UI are shared by both entry points (the IME keyboard
and the accessibility bubble), the same way the desktop pill is shared across the
desktop app:

| Mobile file | Desktop counterpart | Role |
|---|---|---|
| `dictation/DictationController.kt` | `main/main.js` (`handleDone`, `cloudReady`) | Picks cloud vs offline at start, drives states, falls back |
| `asr/GroqClient.kt` | `main/groq.js` | Groq Whisper ASR + Llama cleanup, same free key/models |
| `net/Connectivity.kt` | `main/net.js` | Online/offline auto-detection |
| `data/Settings.kt` | `main/db.js` settings | `ai.enabled`, `ai.groqApiKey`, `dictation.developerMode` |
| `audio/WavEncoder.kt` | `main/asr.js` (`wavBuffer`) | PCM16 → WAV for the upload |
| `audio/MicRecorder.kt` | `renderer/recorder.js` | Raw mic capture + RMS level |
| `ui/PillView.kt` + `ui/WaveformView.kt` | `renderer/pill.{html,css,js}` | The dark pill: cancel · waveform · confirm |

### Dictation flow

`DictationController` snapshots the engine at the start of each utterance, exactly
like the desktop session:

- **Cloud** (online + AI enabled + key present, not forced-offline): record the
  whole clip with `MicRecorder`, then on stop send one fast Groq Whisper request
  and polish it with Groq Llama. Sub-second on the free tier.
- **Offline** (no internet, or cloud disabled): the device's on-device
  `SystemSpeechRecognizer` (PREFER_OFFLINE), cleaned by the deterministic
  `TextPipeline`. Works with no connection.

Both paths stream a 0..1 mic level so the pill waveform reacts to your voice, and
both end by leaving the full transcript on the clipboard.

The free Groq API key is the same one the desktop app ships with (see
`data/Settings.kt`); it can be changed or cleared in code/preferences. All APIs
used are free.

## Entry points

- `ime/ColdVoiceImeService`: the ColdVoice keyboard — dark panel with the pill and
  a live online/engine indicator. Tap ✓ to dictate, ✕ to cancel.
- `a11y/ColdVoiceBubbleService`: the floating **flow bubble**. Appears ONLY when an
  editable, non-password field is focused and is hidden everywhere else. It is the
  desktop pill (cancel · waveform · confirm), **draggable** anywhere on screen.
- `MainActivity`: setup screen (mic permission, keyboard, bubble) styled to match
  the desktop look, showing live connectivity + engine status.

`asr/AsrEngine.kt` and `asr/SherpaAsrEngine.kt` remain as the future fully-offline
custom-recognizer integration point; the active offline path is the on-device
`SystemSpeechRecognizer`.

## Required user setup on device

1. Open ColdVoice.
2. Allow microphone permission.
3. Enable ColdVoice Keyboard in Android input settings, **or**
4. Enable the ColdVoice flow bubble in Android accessibility settings.

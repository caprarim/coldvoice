# Learning — ColdVoice

## Dictation finalize must not clobber a newer session
`handleDone` is async. Setting `recording = false` early lets a new dictation start while the old finalize still runs. Always pin a session object, mark it `dead` when superseded, and only clear/update the pill when `dictationSession === s`.

## Clipboard vs paste is product logic, not "always copy"
After a successful paste, leave the user's prior clipboard alone. Copy only when focus was non-editable (or password / insert-off). Keep `lastTranscript` for middle-click; suppress terminal left-click re-paste briefly instead of clearing memory.

## Android IME enablement is two steps
Enabling a keyboard in Android system settings only makes it *available* — it does not
make it active. The user must still **switch** to it from a focused text field via the
input-method picker (`InputMethodManager.showInputMethodPicker()`). Onboarding must
surface that second step (and ideally a text field to try it in), or users get stuck
thinking "nothing happened." Check enabled state with `imm.enabledInputMethodList`, and
the active one with `Settings.Secure.DEFAULT_INPUT_METHOD`.

## Keep secrets out of source, inject at build
A live API key in committed source triggers GitHub push protection and gets scraped.
The fix: read it from gitignored `local.properties` (or an env var) and expose it via
`BuildConfig` at build time. Source stays clean; binaries still ship with the key.

## "Offline" speech on Android needs a *bundled* engine, not the system recognizer
Android's `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` only works if the user has
downloaded Google's offline language pack — otherwise it silently falls back to the
network and fails with no internet. For dictation that truly always works offline,
ship your own engine + model in the APK. Vosk is the easy free path: a Maven dep
(`com.alphacephei:vosk-android`) + a model in `assets/`, unpacked once to `filesDir`,
then `Recognizer.acceptWaveForm(pcm16, len)` returns finals at silence boundaries and
`getPartialResult()` gives live text. This mirrors desktop whisper.cpp.

## APK size: ABIs and asset compression are the big levers
A bundled native lib (like Vosk) ships `.so` files for all 4 ABIs by default; real
phones only need `arm64-v8a`/`armeabi-v7a`, so `ndk { abiFilters }` roughly halves the
native payload. And if you copy bundled assets out to `filesDir` at runtime, you can let
the APK compress them (don't `noCompress`) since `AssetManager.open()` inflates
transparently — that shrank our model APK from 106 MB to 60 MB.

## Non-focusable Electron windows can't rely on renderer pointermove for dragging
The pill window is `focusable: false`, so on Windows pointer capture is unreliable and
a renderer-driven drag dies the moment the cursor slips off the 132px window. Robust
pattern: the renderer only signals drag start/end; the main process polls
`screen.getCursorScreenPoint()` on a 16ms timer and glues the window to the cursor.

## Fixed voice-activity thresholds break far-from-mic dictation
A hard RMS threshold (0.01) classified quiet distant speech as silence, so segments
were flushed mid-word every ~1.5s and transcribed as jumbled fragments. Fix: track the
ambient noise floor (fast-fall / slow-rise EMA) and treat "meaningfully above the
floor" as speech; also peak-normalize quiet segments (gain capped at 12x, silence
never amplified) before ASR, while gating hallucination checks on the *original* RMS.

## An Android IME can hand off to the user's real keyboard
`switchToPreviousInputMethod()` (API 28+) flips back to e.g. the Samsung keyboard, with
`InputMethodManager.showInputMethodPicker()` as fallback — combined with the
accessibility-overlay bubble, users get native typing plus voice dictation together.

## Whisper hallucinates "Thank you." on normalized silence tails
Every flushed segment ends with the silence that triggered its flush (~450ms), and the
final tail carries everything up to hotkey release; `normalizeQuiet` then amplified
that tail up to 12x into plausible-looking "signal", which whisper decodes as stock
YouTube-caption phrases ("Thank you.", "you"). Fix in the recorder: frame-based RMS
trim of leading/trailing sub-threshold audio (same adaptive noise-floor threshold as
pause detection, 250ms padding) BEFORE normalization, and report the trimmed RMS so the
main process silence gate still works. Silence never reaches the model, so legitimate
spoken "thank you" still transcribes fine.

- **Killed processes leave ghost tray icons; Windows only removes them on mouse-over.** The tray overflow filled with duplicate ColdWork/ColdVoice icons because every unclean exit (reinstall, taskkill during dev, crash, shutdown) dies without sending Shell_NotifyIcon NIM_DELETE, and the app never called `tray.destroy()` on quit either. Fix in both apps: destroy the tray in the quit handler, and `sweepDeadTrayIcons()` at startup, a PowerShell P/Invoke helper that sends synthetic WM_MOUSEMOVE across the notification area and the overflow flyout so Explorer re-validates each icon's owner process and drops the dead ones. Lesson: an app cannot clean its own icon after being killed, so the next launch has to sweep for corpses.

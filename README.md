# ColdVoice

Privacy-first voice dictation for **Windows** and **Android**. Speak, and the cleaned
text lands in whatever field has focus. Transcription runs on-device by default, with
an optional fast cloud path for grammar and formatting. No accounts, no telemetry.

## Downloads

Grab the latest build from the [Releases page](https://github.com/caprarim/coldvoice/releases/latest):

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | [ColdVoice-Setup.exe](https://github.com/caprarim/coldvoice/releases/latest/download/ColdVoice-Setup.exe) |
| Android 8.0+ | [ColdVoice.apk](https://github.com/caprarim/coldvoice/releases/latest/download/ColdVoice.apk) |

The desktop app also updates itself: Settings has a check-for-updates button that
downloads and installs the newest release in place.

## Windows

Press the hotkey, speak, and the text is typed into the focused field. A small floating
bar (the pill) shows what's happening and carries four controls:

| Control | What it does |
| --- | --- |
| ✕ | Cancel the dictation and throw the audio away |
| waveform | Live mic level; drag anywhere on the bar to move it, drag a corner to resize |
| ⏸ / ▶ | Pause the dictation, then carry on from exactly where you stopped |
| ✓ | Stop and insert the text |

A banner also drops in at the top centre of the screen the moment dictation starts, and
again when it stops, so a hotkey press that didn't register is impossible to miss.

The bar is a non-focusable always-on-top window so it never steals focus from the field
you're dictating into. Because of that it gets no renderer mouse events at all, so its
clicks and drags are driven from the global mouse hook in the main process.

### Default shortcuts

| Action | Keys |
| --- | --- |
| Hands-free toggle | `Ctrl+1` |
| Hold to dictate | `Ctrl+CapsLock` |
| Paste last transcript | `Alt+Shift+Z` (also middle-click) |
| Pause / resume | not set, bind it yourself in Settings |
| Cancel | `Esc` |

Pause ships unbound on purpose so it can never collide with a shortcut you already use.
Set it in Settings > Shortcuts, and clear it again with the ✕ next to the keys.

## Android

ColdVoice does **not** replace your keyboard. Keep using Samsung Keyboard, Gboard, or
whatever you already have.

Instead, a small ColdVoice square appears at the right edge of the screen, vertically
centred, whenever you focus a text field. It disappears the moment nothing editable has
focus, so it never floats over your home screen.

1. Tap the square. It expands into the dictation bar and starts listening.
2. Speak. Pause and resume with ⏸ / ▶ as often as you like.
3. Tap ✓ to stop and drop the finished text into the field, or ✕ to throw it away.

Nothing is written into the field until you confirm, so an abandoned dictation never
leaves half a sentence behind. Password and secure fields are always rejected.

### Setup

Open the app once and work through the three steps:

1. **Allow the microphone.**
2. **Unlock restricted settings.** Android 13+ blocks accessibility for any app installed
   outside the Play Store. Open App info, tap the ⋮ menu, choose "Allow restricted
   settings". Skip this on Android 12 and below.
3. **Turn on the ColdVoice bubble** in Accessibility settings.

The accessibility service is used only to notice when an editable field has focus and to
write the finished text back into it.

## Speech engines

Both platforms make the same choice at the start of every dictation, and it cannot change
mid-sentence:

- **Cloud** (when AI is enabled, a key is set, and you're online): Groq Whisper turbo for
  speech, then Llama for real grammar and formatting. Short utterances skip the language
  model and go straight through the deterministic rules.
- **Offline**: whisper.cpp on Windows, the bundled Vosk model on Android. Fully on-device,
  cleaned by the deterministic pipeline in `packages/shared/text-processing`.

If the cloud path fails for any reason, it falls back to offline without losing the
dictation.

## Layout

```
coldvoice/
  apps/
    windows-electron/   Electron desktop: hotkeys, pill, mic, ASR, insertion
    android/            Kotlin: accessibility bubble + optional voice keyboard
    website/            Static marketing site (Vercel)
  packages/shared/
    text-processing/    Punctuation, fillers, dictionary, snippets, style + tests
    input-detection/    Editable-target and password-field rules + tests
    db-schema/          SQLite schema shared by both platforms
  native/asr/           whisper.cpp binaries (not committed)
  models/               Local model files (never committed)
  docs/                 ARCHITECTURE, SETUP, PRIVACY, PACKAGING
```

## App routes (exactly 4)

Home · Snippets · Dictionary · Settings. No other routes.

## Building

From the repo root:

```
npm test                  # shared package tests, no install needed
npm run build:website
npm run dist:windows      # needs npm install first
```

Android, from `apps/android` (needs `sdk.dir` in `local.properties`):

```
./gradlew assembleRelease
```

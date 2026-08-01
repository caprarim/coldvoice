# ColdVoice — context

ColdVoice is an offline, privacy-first voice dictation app for Windows and Android. You press a hotkey, speak, and the cleaned text is typed straight into whatever field currently has focus. Nothing has to leave the machine.

## How the Windows app works

Electron, split into `src/main` (Node) and `src/renderer` (UI). A hidden recorder window owns the microphone via `getUserMedia`, streams audio segments and level data to main, and reports mic lifecycle events (`ready`, `switched`, `disconnected`, `setup-failed`) over IPC. Global hotkeys (`hotkeys.js`, `keyhook.ps1`) start and stop dictation. Audio goes to ASR: whisper.cpp locally by default, or Groq Whisper plus an LLM polish pass when AI is enabled, a key exists, and the machine is online, falling back to offline silently. The transcript runs through the ordered deterministic pipeline in `packages/shared/text-processing`, then `insertion.js` types or pastes it, but only after `canInsertInto()` from `packages/shared/input-detection` approves the target and rejects password fields. History, snippets, dictionary, and settings live in SQLite (`db.js`).

Two frameless always-on-top overlays exist: the pill (dictation status) and the alert toast (mic problems). Both are `focusable: false`, so renderer mouse events are unreliable and their clicks are driven from the global mouse poller (`mousehook.ps1`) in the main process, not from DOM handlers.

Android is a Kotlin IME. The website is static HTML/CSS/JS on Vercel.

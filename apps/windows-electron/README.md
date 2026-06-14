# windows-electron

ColdVoice desktop app for Windows (Electron).

## Run (dev)

From the **repo root** (installs Electron, better-sqlite3, and links the shared
workspaces):

```
npm install
npm start --workspace @coldvoice/windows-electron
```

`npm install` is required here because Electron and better-sqlite3 are native/large
dependencies. ColdVoice itself stays fully offline at runtime.

## What works

- Main window with **exactly 4 routes**: Home, Snippets, Dictionary, Settings.
- Home has a live "test the cleanup pipeline" box (no mic needed) wired to the shared
  text-processing package — the easiest thing to try first.
- Snippets and Dictionary screens: add / edit (pencil) / delete, persisted to SQLite.
- Settings: editable shortcut rows with a pencil button (press a key combo to rebind),
  dictation mode (hold / toggle), ASR model, and privacy toggles.
- System tray (open / start-stop dictation / quit); closing the window hides to tray.
- Floating black pill overlay (cancel ✕ · animated dots · confirm ✓; Esc cancels,
  Enter confirms).
- Hidden recorder window captures the mic and downsamples to 16 kHz mono PCM16.
- Dictation flow: global shortcut → record → offline ASR → cleanup pipeline →
  clipboard-preserving paste into the focused field. Password / non-editable targets
  are rejected via UI Automation + the shared `input-detection` rules.

## Needs setup to dictate end-to-end

Offline ASR needs a whisper.cpp build + model (the app shows exact instructions on Home
when missing, and never calls the cloud):

- `whisper-cli.exe` in `native/asr/`
- a model (e.g. `ggml-base.en.bin`) in `models/`

## Known limitations (honest)

- **Hold-to-talk**: Electron's global shortcut only reports key-down, so the default
  shortcut behaves as a **toggle** (press to start, press to stop). True hold-to-release
  needs a native low-level keyboard hook — not yet added.
- **Middle-Click paste-last** needs a global mouse hook (native) — not yet added; the
  `Alt+Shift+Z` alternative works as a global accelerator.
- Insertion uses SendKeys `^v` via PowerShell; works in standard editable fields.
- Not yet run end-to-end in this environment (no GUI / no model here). All JS files pass
  `node --check`.

Reuses `@coldvoice/text-processing`, `@coldvoice/input-detection`, `@coldvoice/db-schema`.

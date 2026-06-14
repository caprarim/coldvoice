# ColdVoice

Offline, privacy-first voice dictation for **Windows** and **Android**. Dictate into
almost any text input; speech is transcribed on-device, cleaned, corrected with your
dictionary/snippets, and inserted into the focused field. No accounts, no cloud, no
telemetry.

## Status

- **Shared (Steps 1–3, tested):** monorepo, deterministic text-processing pipeline
  (`packages/shared/text-processing`) + tests, editable-target / password-field rejection
  (`packages/shared/input-detection`) + tests, SQLite schema (`packages/shared/db-schema`).
  43 passing tests.
- **Windows Electron MVP (Step 4–5, code complete):** 4-route UI, Snippets + Dictionary
  CRUD, Settings with rebindable shortcuts, tray, floating pill, mic capture, ASR adapter,
  clipboard-preserving paste with password rejection. Needs `npm install` + a whisper.cpp
  model to run end-to-end. See `apps/windows-electron/README.md`.
- **Android (Step 6–7, code complete):** Kotlin IME voice keyboard, mic recorder, insertion
  guard, Kotlin text pipeline, optional accessibility bubble service. sherpa-onnx wiring is
  the marked integration point. See `apps/android/README.md`.
- **Packaging (Step 8):** electron-builder (NSIS) + Gradle APK. See `docs/PACKAGING.md`.
- **Website:** static Vercel site in `apps/website` with Supabase login/sign-up pages
  and a Windows `.exe` download link. In production, set `COLDVOICE_DOWNLOAD_URL`
  to the GitHub Release asset URL.

Integration work remaining: ship/install ASR binaries+models, wire sherpa-onnx on Android,
native hooks for true hold-to-talk and middle-click, and the bubble overlay window. None of
the GUI/ASR paths were run in the build environment — the shared logic is the tested part.

## Layout

```
coldvoice/
  apps/
    windows-electron/   # Electron desktop app (UI, hotkeys, insertion) — TODO
    android/            # Kotlin IME + optional accessibility bubble — TODO
  packages/shared/
    text-processing/    # punctuation, fillers, backtracking, dictionary, snippets, style
    input-detection/    # editable-target + password-field rules (both platforms)
    db-schema/          # SQLite schema (shared by Electron + Android)
  native/asr/           # offline ASR adapters (whisper.cpp / sherpa-onnx) — TODO
  models/               # local model files live here (never committed) — TODO
  docs/                 # ARCHITECTURE, SETUP, PRIVACY
```

## App routes (exactly 4)

Home · Snippets · Dictionary · Settings. No other routes.

## Default shortcuts

- Hands-free / hold-to-dictate: **Ctrl+1**
- Paste last transcript: **Middle Click** (also **Alt+Shift+Z**)
- Cancel: **Esc**

## Run the tests

From the repo root:

```
npm test
npm run build:website
npm run dist:windows
```

No dependencies required — uses Node's built-in test runner (Node 18+).

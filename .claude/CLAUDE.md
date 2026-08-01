# ColdVoice — Claude Code project context

**Read `context.md` in the repo root first whenever you need context on what this app is and how it works.**

Offline, privacy-first voice dictation for **Windows**, **Linux** and **Android**. Speech is transcribed on-device (with an optional Groq cloud path on Windows), cleaned through a deterministic pipeline, and inserted into the focused text field.

## Monorepo layout

```
apps/
  windows-electron/   Electron desktop (JS) — hotkeys, pill, mic, ASR, insertion
  linux-tauri/        Tauri v2 desktop (Rust + the same UI) for Ubuntu
  android/            Kotlin IME + optional accessibility bubble
  website/            Static marketing site (Vercel)
packages/shared/
  text-processing/    Deterministic cleanup pipeline (JS) + tests
  input-detection/    Editable-target / password-field rules (JS) + tests
  db-schema/          SQLite schema shared by both platforms
native/asr/           whisper.cpp binaries (not committed)
models/               ASR model files (never committed)
docs/                 ARCHITECTURE, SETUP, PRIVACY, PACKAGING
```

## Commands

From repo root:

```
npm test                  # shared package tests (Node built-in runner, no install needed)
npm run build:website
npm run dist:windows      # requires npm install first
```

Windows dev (needs `npm install`):

```
npm start --workspace @coldvoice/windows-electron
```

## Conventions

- **Shared logic**: plain JavaScript in `packages/shared/` — no TypeScript.
- **Windows app**: Electron main/renderer in `apps/windows-electron/src/`.
- **Linux app**: Rust in `apps/linux-tauri/src-tauri/src/`; the scenes are the Windows renderer files with a Tauri IPC bridge. The shared JS pipeline runs in a hidden webview — never fork it into Rust.
- **Android app**: Kotlin in `apps/android/app/src/main/java/com/coldvoice/`.
- **Website**: static HTML/CSS/JS in `apps/website/public/src/` (not Next.js).
- **Exactly 4 app routes**: Home · Snippets · Dictionary · Settings. No extra routes.
- **Insertion safety**: always gate on `canInsertInto()` from `@coldvoice/input-detection`; reject password fields.
- **Text pipeline**: ordered steps in `packages/shared/text-processing/src/pipeline.js` — do not reorder without reason.

## ASR paths

- **Offline default**: whisper.cpp (Windows and Linux), sherpa-onnx (Android target).
- **Windows cloud path** (`apps/windows-electron/src/main/groq.js`): Groq Whisper + LLM polish when `ai.enabled=1`, key present, and online. Falls back to offline transparently.
- Never call cloud APIs when offline mode / missing key / user disabled AI.

## Workflow rules

- Do not run `npm install` unless the user asks.
- Do not redeploy to Vercel unless the user asks.
- Do not delete files without asking first.
- Do not commit ASR models, `.gradle` caches, or local SQLite databases.
- Minimize scope — match existing naming and patterns in each platform folder.
- Only add what was explicitly requested; no drive-by refactors or extra features.

## Key docs

- `README.md` — status and layout
- `docs/ARCHITECTURE.md` — audio → text flow, pipeline order, insertion rules
- `docs/SETUP.md` — requirements and model setup
- `apps/windows-electron/README.md` — desktop dev and limitations
- `apps/linux-tauri/README.md` — Linux build, Wayland notes, gaps vs Windows
- `apps/android/README.md` — Android IME setup

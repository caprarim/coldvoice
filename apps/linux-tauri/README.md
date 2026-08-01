# ColdVoice for Linux (Tauri v2)

Offline, privacy-first voice dictation for Ubuntu. Press a hotkey, speak, and the
cleaned-up text is pasted into whatever field already has focus.

This is the same product as the Windows app, not a cut-down port: the same
scenes, the same pill, the same SQLite schema, and — literally — the same text
pipeline.

## How it maps onto the Windows build

| Linux (`src-tauri/src`) | Windows (`apps/windows-electron/src/main`) |
| --- | --- |
| `db.rs` | `db.js` — both apply `packages/shared/db-schema/schema.sql` |
| `audio.rs` | `renderer/recorder.js` — capture, pause segmentation, silence trimming |
| `asr.rs` | `asr.js` — whisper.cpp subprocess |
| `groq.rs` | `groq.js` — Groq Whisper + Llama polish, same prompts |
| `insertion.rs` | `insertion.js` — focus detection + clipboard-preserving paste |
| `overlays.rs` | `pill.js` / `alert.js` / `notice.js` |
| `pipeline.rs` | *(no equivalent)* — runs the shared JS pipeline in a hidden webview |

`packages/shared/text-processing` and `packages/shared/input-detection` are **not**
reimplemented in Rust. `tools/bundle-shared.js` bundles them into
`ui/vendor/shared.js`, a hidden `processor` webview loads them, and Rust calls
into that webview for every cleanup and every `canInsertInto()` check. One
implementation, both platforms, no drift.

## What ships in the package

- `whisper-cli` (whisper.cpp, built in CI) and the `ggml-base.en` model, so
  dictation works offline with no account and no key.
- The Groq cloud path is used only when AI is enabled, a key is set **and** the
  machine is online. It falls back to the local model silently.

## Requirements

- Ubuntu 22.04 or newer (WebKitGTK 4.1).
- `xdotool` on X11 — the `.deb` depends on it. AppImage users should install it
  themselves (`sudo apt install xdotool`).
- On Wayland, `wtype` or `ydotool` for the paste chord.

### Wayland and global hotkeys

Wayland deliberately stops applications from grabbing global hotkeys, so
`Ctrl+1` will not reach ColdVoice on a native Wayland session. Two options:

1. Log in with **Ubuntu on Xorg** from the gear on the login screen, or
2. Add a GNOME custom shortcut (Settings > Keyboard > Custom Shortcuts) that runs
   `coldvoice --toggle`. A second launch drives the already-running app.

## Build

```bash
cd apps/linux-tauri
npm install
npm run icons          # generates src-tauri/icons from icon.png, once
npm run bundle:shared  # also runs automatically before dev/build
npm run dev
npm run build          # .deb + AppImage in src-tauri/target/release/bundle
```

The bundle also expects `native/asr/whisper-cli` and `models/ggml-base.en.bin` at
the repo root (see `.github/workflows/linux.yml`, which builds and fetches both).
Release artifacts are produced by that workflow, never from a local machine.

## Known gaps against the Windows build

- Password-**field** detection needs AT-SPI, which is not wired up. Insertion is
  refused when the focused *window* is a recognised secure prompt (polkit,
  gnome-keyring, the lock screen, a password manager), and the shared
  `canInsertInto()` gate still runs on every insert.
- There is no global mouse hook, so middle-click-to-paste and the terminal
  left-click paste are not available. `Alt+Shift+Z` still pastes the last
  transcript.

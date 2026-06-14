# ColdVoice Architecture

## Goal

Offline voice dictation that inserts cleaned text into the currently focused input on
Windows and Android. Everything runs on-device.

## Audio → text flow

1. Capture mic as 16 kHz mono PCM.
2. VAD detects speech start/end.
3. Buffer chunks → offline ASR worker.
4. Optional partial transcript.
5. On silence/end, finalize transcript.
6. Run the deterministic post-processing pipeline.
7. Insert result into the target input.

## Post-processing pipeline (`packages/shared/text-processing`)

Deterministic, offline, ordered exactly:

1. Normalize whitespace
2. Spoken punctuation → marks
3. Filler removal (`um`, `uh`, `you know`, fenced `like`)
4. Backtracking/corrections (`actually`, `no,`, `I mean`, `scratch that`, `delete last word/sentence`)
5. Formatting (capitalization, repeated-punctuation cleanup, numbered/bullet lists)
6. Dictionary replacements (exact → case-insensitive → fuzzy ≥ 0.88, len ≥ 4)
7. Snippet expansion (with `{date}`/`{time}`/`{clipboard}` variables)
8. Style transform (default / casual / professional / code / raw)
9. Final trim

Optional local-LLM polishing may be added later, only if the user installs a model.

## Insertion safety (`packages/shared/input-detection`)

`canInsertInto(node)` is the single gate. It rejects password fields
(`isPassword`/secure/`inputType` contains `password`) and a banking blocklist, and only
allows editable targets (Windows: Edit/Document or Value/Text/TextEdit pattern; Android:
`isEditable` or `EditText`). Windows insertion priority: ValuePattern →
clipboard-preserving paste → keyboard simulation. Android: `commitText` (IME) or
`ACTION_SET_TEXT` on an editable node.

## Storage (`packages/shared/db-schema`)

Local SQLite: `settings`, `dictionary_entries`, `snippets`, `styles`, `transcripts`,
`app_rules`. Audio is never stored; transcript history only if the user enables it.

## Platforms

- **Windows**: Electron UI + native helper for global hotkeys, overlay positioning,
  UI Automation focus detection, mic capture, and text insertion. ASR via whisper.cpp
  (`base.en` default; `tiny.en`/`small.en` options). CPU-only must work.
- **Android**: Kotlin `InputMethodService` keyboard with a mic button; optional
  `AccessibilityService` side bubble for editable fields. ASR via sherpa-onnx (streaming
  default) with whisper.cpp fallback.

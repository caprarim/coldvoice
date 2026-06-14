# ColdVoice Privacy

ColdVoice is built to be private by default.

- **Offline only.** Transcription runs on-device. No cloud APIs are called.
- **No telemetry, no analytics.**
- **No hidden recording.** A recording indicator is always shown while listening.
- **Never records unless** you click the bubble/pill or press the hotkey.
- **Audio is never stored** by default.
- **Transcript history is stored only if you enable it** (`privacy.storeTranscripts`).
- **Password fields are blocked.** `canInsertInto()` rejects any password/secure field and
  a banking app blocklist before inserting text.
- **Privacy mode**: a disabled-apps list suppresses the bubble and dictation in chosen apps.

## Android AccessibilityService

The optional accessibility bubble is used **only** to detect when an editable input is
focused and to position the side bubble. It requires explicit user permission, never logs
passwords or secure fields, and never reads content from password inputs.

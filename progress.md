# Progress — ColdVoice

- Secured the Groq key: removed it from committed source; now injected at build time
  from gitignored `local.properties` via `BuildConfig` (Android) / `GROQ_API_KEY` env
  (Windows). Unblocked the GitHub push (secret scanning).
- Verified dual-path dictation on both platforms: cloud (Groq Whisper) when online +
  keyed, on-device offline otherwise, with automatic fallback.
- Verified live site downloads via Playwright: APK + Windows installer both serve 200.
- Fixed Android keyboard onboarding dead-end: enabling the IME left users stuck. The
  setup button now flips to "Switch to ColdVoice keyboard" (opens the IME picker),
  status reflects enabled/active state, and an in-app field lets users try it.

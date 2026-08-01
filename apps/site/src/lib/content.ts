export const SITE = {
  name: "ColdVoice",
  tagline: "Talk. It types.",
  description:
    "Offline voice dictation for Windows, Linux and Android. Press a hotkey, speak, and clean text lands in whatever field already has focus.",
  repo: "https://github.com/caprarim/coldvoice",
  windowsVersion: "0.3.1",
  linuxVersion: "0.3.1",
  androidVersion: "0.3.0",
} as const

export const DOWNLOADS = {
  windows: {
    platform: "Windows",
    icon: "Monitor",
    requirement: "Windows 10 / 11 · x64",
    file: "ColdVoice-Setup.exe",
    size: "208 MB",
    version: "0.3.1",
    href: "https://github.com/caprarim/coldvoice/releases/latest/download/ColdVoice-Setup.exe",
    note: "Electron desktop app. Global hotkeys, the floating pill, whisper.cpp and the base.en model bundled in the installer.",
  },
  linux: {
    platform: "Linux",
    icon: "Monitor",
    requirement: "Ubuntu 22.04+ · x64",
    file: "ColdVoice.deb",
    size: "170 MB",
    version: "0.3.1",
    href: "https://github.com/caprarim/coldvoice/releases/latest/download/ColdVoice.deb",
    note: "Tauri v2 desktop app with the same pill and the same offline whisper.cpp core. An AppImage is on the releases page if you would rather not install a package.",
  },
  android: {
    platform: "Android",
    icon: "Smartphone",
    requirement: "Android 8.0+ · arm64",
    file: "ColdVoice.apk",
    size: "58 MB",
    version: "0.3.0",
    href: "https://github.com/caprarim/coldvoice/releases/latest/download/ColdVoice.apk",
    note: "Native Kotlin app with a Vosk model bundled in the APK. Sideload it — allow unknown sources first.",
  },
} as const

export const STEPS = [
  {
    n: "01",
    icon: "Keyboard",
    title: "Hit the hotkey",
    body: "A low-level key watcher catches Ctrl+1 or Ctrl+CapsLock from anywhere, because Electron's own shortcut API only ever sees key-down.",
  },
  {
    n: "02",
    icon: "Mic",
    title: "Say it",
    body: "The engine is locked in the moment you start talking and never swapped mid-sentence. Pause to take a call, resume where you left off.",
  },
  {
    n: "03",
    icon: "Eraser",
    title: "It gets cleaned",
    body: "Nine ordered rules turn spoken punctuation into real marks, drop fillers, honour \"scratch that\", then your dictionary and snippets rewrite the rest.",
  },
  {
    n: "04",
    icon: "CornerDownLeft",
    title: "It lands",
    body: "Only once the target is cleared as safe. UIA first, clipboard-preserving paste second, keystrokes last. No copy, no paste, no window switch.",
  },
] as const

export const FEATURES = [
  {
    icon: "Crosshair",
    title: "Types where you already are",
    body: "Editor, terminal, browser, chat window. Insertion walks UIA ValuePattern, then a clipboard-preserving paste, then raw keystrokes, with console apps handled separately.",
    span: "wide",
    platform: "Windows & Android",
  },
  {
    icon: "WifiOff",
    title: "Offline is the default",
    body: "whisper.cpp on Windows with the base.en model in the installer, a Vosk model bundled in the APK on Android. No account, no telemetry, and it works on a plane.",
    span: "tall",
    platform: "Windows & Android",
  },
  {
    icon: "Sparkles",
    title: "Cloud polish when you want it",
    body: "Turn on AI and audio routes to Groq whisper-large-v3-turbo with a Llama pass for real punctuation. No key, no network, or switched off — it silently falls back to local without losing the take.",
    span: "normal",
    platform: "Windows",
  },
  {
    icon: "ListOrdered",
    title: "Nine deterministic steps",
    body: "Rule-based, offline, unit-tested. The same words always produce the same text — no model deciding to rephrase you today.",
    span: "normal",
    platform: "Windows & Android",
  },
  {
    icon: "BookMarked",
    title: "A dictionary that actually catches it",
    body: "Exact, then case-insensitive, then fuzzy at 0.88 similarity — and it carries your original capitalisation onto the replacement. Client names and jargon stop coming back mangled.",
    span: "wide",
    platform: "Windows & Android",
  },
  {
    icon: "Braces",
    title: "Developer mode",
    body: "Say \"next js\", get Next.js. Say \"index dot html\", get @index.html. Tech casing and spoken filenames, handled.",
    span: "normal",
    platform: "Windows",
  },
  {
    icon: "Scissors",
    title: "Snippets with live variables",
    body: "Map a trigger phrase to a whole block, with {date}, {time} and {clipboard} filled in as you speak.",
    span: "normal",
    platform: "Windows & Android",
  },
  {
    icon: "SlidersHorizontal",
    title: "Tone that reads the room",
    body: "Casual in Discord and WhatsApp, professional in Gmail and Docs, code-safe in VS Code and Cursor. Or pin one tone and leave it.",
    span: "wide",
    platform: "Windows",
  },
  {
    icon: "ShieldOff",
    title: "It refuses password fields",
    body: "Every target passes through one gate before a single character is written. Password, secure and blocklisted banking fields are rejected outright.",
    span: "normal",
    platform: "Windows & Android",
  },
  {
    icon: "Activity",
    title: "A pill that never steals focus",
    body: "Frameless, always-on-top, non-focusable, draggable and resizable, with a live mic waveform. Cancel, pause and confirm are right there.",
    span: "normal",
    platform: "Windows & Android",
  },
  {
    icon: "Gauge",
    title: "Local insights",
    body: "Words per minute on a gauge, a day-streak heatmap, per-app usage, and every past dictation one click from being re-copied. All in a SQLite file you own.",
    span: "wide",
    platform: "Windows",
  },
  {
    icon: "BellRing",
    title: "You'll know if the mic dies",
    body: "Device switched, disconnected, or failed to open fires a toast immediately, instead of leaving you talking into nothing for a paragraph.",
    span: "normal",
    platform: "Windows",
  },
] as const

export const USE_CASES = [
  {
    n: "01",
    icon: "Bot",
    title: "Brief your agents out loud",
    body: "Three paragraphs of context is a thirty-second sentence. Describe what you want built instead of typing it into the prompt box.",
  },
  {
    n: "02",
    icon: "GitBranch",
    title: "Commits, docs and replies",
    body: "PR descriptions, release notes, the message you've been putting off — spoken into the window that's already open.",
  },
  {
    n: "03",
    icon: "HeartPulse",
    title: "Easier on your hands",
    body: "A real option if your wrists are done for the day but the writing isn't.",
  },
] as const

export const PLATFORM_MATRIX = [
  { row: "Offline engine", win: "whisper.cpp · base.en bundled", droid: "Vosk · model bundled in the APK" },
  { row: "Cloud engine", win: "Groq turbo + Llama polish", droid: "Groq turbo + Llama polish" },
  { row: "Trigger", win: "Ctrl+1 toggle · Ctrl+CapsLock hold", droid: "Tap the edge square on any text field" },
  { row: "Insertion", win: "UIA → paste → keystrokes", droid: "IME commitText / ACTION_SET_TEXT" },
  { row: "Cleanup pipeline", win: true, droid: true },
  { row: "Password-field refusal", win: true, droid: true },
  { row: "Draggable pill", win: "Resizable, live waveform", droid: "Draggable bubble" },
  { row: "Pause and resume", win: true, droid: true },
  { row: "Dictionary & snippet editor", win: true, droid: false },
  { row: "Insights, WPM & streaks", win: true, droid: false },
  { row: "In-app self-update", win: true, droid: false },
] as const

export const PRIVACY_POINTS = [
  {
    icon: "HardDrive",
    kicker: "Local first",
    title: "The default path never opens a socket",
    body: "Offline transcription is not a mode you switch on — it is what happens unless you go and enable the cloud path yourself.",
  },
  {
    icon: "KeyRound",
    kicker: "Your key",
    title: "Cloud is opt-in and yours",
    body: "The Groq path only runs when AI mode is on, a key you supplied exists, and you're online. Miss any one and it drops back to local without asking.",
  },
  {
    icon: "Database",
    kicker: "Your file",
    title: "History lives in SQLite on your disk",
    body: "Transcripts, dictionary, snippets and settings sit in a local database. Nothing syncs. Delete the file and it's gone.",
  },
  {
    icon: "UserX",
    kicker: "No account",
    title: "Nothing to sign up for",
    body: "Download it, install it, start talking. There is no login wall in front of dictation and no usage meter behind it.",
  },
] as const

export const FAQ = [
  {
    tag: "Basics",
    q: "What is ColdVoice?",
    a: "A dictation app for Windows and Android. Press a hotkey, speak, and the cleaned-up text is typed into whatever field has focus. The desktop app is Electron with a native whisper.cpp core; the Android app is native Kotlin.",
  },
  {
    tag: "Privacy",
    q: "Is my voice actually private?",
    a: "On the default path, yes — audio is transcribed on your own machine and never leaves it. The cloud path is opt-in and needs AI mode enabled, your own Groq key, and a connection. Any of those missing and it falls back to local silently.",
  },
  {
    tag: "Cost",
    q: "What does it cost?",
    a: "Nothing. ColdVoice is a free download from GitHub Releases. No account, no subscription, no usage metering. If you enable the optional Groq path, that runs on your own API key.",
  },
  {
    tag: "Languages",
    q: "Which languages does it handle?",
    a: "English. The bundled local models are the English whisper.cpp builds on Windows and an English Vosk model on Android, and the cloud requests are pinned to English too. Other languages are not supported today.",
  },
  {
    tag: "Platforms",
    q: "Is there a Mac or Linux build?",
    a: "Linux yes, Mac no. Ubuntu 22.04 and newer on x64, as a .deb or an AppImage, alongside Windows 10 and 11 on x64 and Android 8.0 and above on arm. There is no macOS build.",
  },
  {
    tag: "Trust",
    q: "Could it type into a password box?",
    a: "No. Every insertion target goes through one shared check first, and password, secure and blocklisted banking fields are refused before any text is sent.",
  },
  {
    tag: "Technical",
    q: "Does it steal focus while I work?",
    a: "It can't. The pill and the alert toast are frameless, non-focusable, always-on-top windows, so the app you're typing in keeps the caret the whole time. Their buttons are driven by a global mouse watcher rather than DOM events.",
  },
  {
    tag: "Android",
    q: "Does it replace my keyboard?",
    a: "It doesn't have to. There is an optional input method, but the recommended setup is the accessibility bubble running alongside Gboard or Samsung Keyboard — a small square appears at the edge whenever a text field is focused.",
  },
  {
    tag: "Install",
    q: "Why does Android warn me on install?",
    a: "The APK is signed with the Android debug key on purpose, so existing installs can keep updating in place. You'll need to allow unknown sources, and on Android 13+ also allow restricted settings before accessibility can be switched on.",
  },
  {
    tag: "Updates",
    q: "How do updates work?",
    a: "The desktop app checks a version manifest itself and can download and run the new installer for you. On Android you reinstall the APK. Either way the latest build is always on the releases page.",
  },
] as const

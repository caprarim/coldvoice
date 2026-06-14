# ColdVoice Packaging (step 8)

## Windows (Electron → installer)

`apps/windows-electron/package.json` includes an `electron-builder` config (NSIS target).

```
cd apps/windows-electron
npm install
npm run dist
```

Output: an NSIS installer under `apps/windows-electron/dist/`. Ship `native/asr/` and
`models/` alongside, or have the app download/import them on first run (offline import —
no cloud). The `build.files` field already bundles the shared packages.

Notes:
- `better-sqlite3` is native; `electron-builder` rebuilds it for the bundled Electron.
  If a prebuilt binary isn't found, install the toolchain and run
  `npx electron-rebuild`.

## Android (APK)

```
cd apps/android
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/`. Sign with your own keystore for distribution.
APK-only is fine for now — no Play Store requirements. The sherpa-onnx model is loaded
from `filesDir/models` at runtime (imported by the user, never downloaded from a server).

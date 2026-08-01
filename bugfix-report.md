# ColdVoice bug audit + fixes (2026-07-10)

## Scope
Windows Electron app (`apps/windows-electron`) only. ColdWork is a separate product; do not couple. No sub-agents. Shared packages: 54/54 tests pass.

## Accidental close / lifecycle
| Issue | Severity | Fix |
| --- | --- | --- |
| No `before-quit` → `app.quit()` without `isQuitting` left the main window `preventDefault` half-dead (looks like app closed / tray ghost) | High | `before-quit` + `will-quit` set `isQuitting`; safer tray cleanup |
| `mainWindow` not nulled on `closed`; `showMain()` could call show/focus on destroyed window | Medium | `closed` → null; `showMain` recreates if destroyed |
| Finalize race: stop → start new dictation while `handleDone` still running nulled the *new* session and flipped the pill | High | Session `dead` flag + `sessionStillCurrent` / `clearSessionIfCurrent` |

## Dictation / paste / mic
| Issue | Severity | Fix |
| --- | --- | --- |
| Successful paste cleared `lastTranscript` → middle-click paste never worked after insert | High | Keep `lastTranscript`; 1.8s left-click suppress only |
| Always re-copied after paste (user wanted copy only when *not* in an input) | Medium | Clipboard only for clipboard mode / password / insert-off |
| `Alt+Shift+Z` documented but never registered (dead `hotkeys.js`) | High | Wired into `keyhook` + Settings rebind |
| Key/mouse PowerShell hooks exited permanently (no restart) | High | Auto-restart after unexpected exit |
| False "no mic": only counting non-default deviceIds + disconnect on empty enumerate while track still live | High | Count default devices; disconnect only if no devices AND capture dead |
| Terminal middle-click paste delays too short | Medium | Longer Shift+Insert settle delays |

## Files touched
- `coldvoice/apps/windows-electron/src/main/main.js`
- `coldvoice/apps/windows-electron/src/main/keyhook.js`
- `coldvoice/apps/windows-electron/src/main/mousehook.js`
- `coldvoice/apps/windows-electron/src/main/insertion.js`
- `coldvoice/apps/windows-electron/src/renderer/recorder.js`
- `coldvoice/apps/windows-electron/src/renderer/app.js`

## Verification
- `npm test` style: 54 shared tests pass
- `node --check` on all modified JS: clean
- Full GUI/dictation not run in this environment (needs live mic + focus)

## Not bugs (by design)
- Close (X) hides to tray; Quit is tray menu only
- Second instance exits via single-instance lock and focuses the first

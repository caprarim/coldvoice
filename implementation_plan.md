# Implementation Plan — ColdVoice Electron UI Revamp + Windows Search Icon Fix

## Part A — Modernize the Electron renderer UI (full revamp)

Direction: modern **dark, brand-matched** theme derived from the actual ColdVoice icon
(charcoal `#1c1d22` surfaces, metallic-silver logo accents, one teal→mint accent kept for
status/positive states). Real app icon replaces the "CV" text badge in the sidebar.
Refined typography, softer elevation, consistent cards/modals/inputs across all 6 routes
(Home, Insights, Dictionary, Snippets, Settings, Account) and both modals (generic + mic).

Files:
- `[NEW]` `apps/windows-electron/src/renderer/brand.png` — copy of the ColdVoice icon (rounded-tile art, has alpha; fine in-app) used in the sidebar brand + empty states. CSP is `default-src 'self'` so a local image loads fine.
- `[MODIFY]` `apps/windows-electron/src/renderer/index.html` — swap `.brand-mark` "CV" span for `<img src="brand.png">`; no structural changes otherwise.
- `[MODIFY]` `apps/windows-electron/src/renderer/styles.css` — full restyle: new token set (dark surfaces, silver ink, accent), sidebar, nav, cards, stat rail, insights gauge/heatmap colors, list rows, promo banner, settings rows, key/keys chips, toggle, both modals, scrollbars, focus rings.
- `[MODIFY]` `apps/windows-electron/src/renderer/app.js` — only the 2 hardcoded gauge colors (`#ece9e1`, `#16604f`, text fills) moved to match the new palette; no logic changes.

Not touched: pill.html/css/js and recorder.html/js (overlay pill — separate surface, not the "app UI"), all main-process files, routes/IPC.

## Part B — Fix black borders behind the Windows-search icon

Root cause (verified, matches coldcode `progress.json` → `windows-search-icon-fix`):
1. `icon.png` art is a dark **rounded** square with margin — corners render black on the dark search panel.
2. `icon.ico` has **all frames PNG-encoded** (16/32/48/64/128/256). Windows GDI renders PNG-frame transparency as opaque black for small frames — they must be full-bleed and/or true 32bpp BMP frames.

Steps (recipe from coldcode notes + `~/.claude/skills/change-icon`):
1. Sample the tile background color from `icon.png`; composite the logo **edge-to-edge onto a solid opaque square** (no rounded corners, no margin) → new 1024×1024 `icon.png`. Use sharp from `C:\dev\coldcode\node_modules` (coldvoice has no sharp; no `npm install` per project rules).
2. Build multi-size `icon.ico` (16–256) from it; verify every corner pixel is the solid bg color.
3. `[MODIFY]` repo assets: `apps/windows-electron/icon.ico`, `icon.png`, `src/main/icon.ico`, `src/main/icon.png`. Tray icons (`tray-icon.png`) checked for alpha and left as-is if already transparent RGBA (tray wants transparency; different requirement).
4. Patch the **installed** app: kill `ColdVoice.exe`, run rcedit (`--set-icon`) on `C:\Users\TempAdmin\AppData\Local\Programs\@coldvoicewindows-electron\ColdVoice.exe`. Do **not** touch `Uninstall ColdVoice.exe`.
5. Flush all four cache layers **with the shell dead first**: kill explorer/SearchApp/StartMenuExperienceHost/ShellExperienceHost → rename `Caches\*.db` (AppResolverCache), `Explorer\iconcache_*.db`, `Explorer\thumbcache_*.db`, move `Packages\Microsoft.Windows.Search_*\LocalState\AppIconCache\100\*ColdVoice*` out → `ie4uinit -ClearIconCache` → restart explorer, leave SearchApp to respawn.
6. Verify: extract the embedded exe icon at 96px and check corner pixels are solid bg (not black/transparent).

## Verification
- Part A: launch the app from source (`npm start` in the workspace — node_modules already present), screenshot each route, confirm no renderer console errors.
- Part B: corner-pixel check on the patched exe + Win-search screenshot after cache rebuild.

## Out of scope
- No rebuild of the NSIS installer (the installed exe is patched in place; next `npm run dist` picks up the new `icon.ico` automatically).
- No changes to Android, website, pill overlay, or shared packages.

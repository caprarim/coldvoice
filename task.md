# Task checklist — approved plan + terminal-paste fix

## Part C — terminal paste reliability (insertion)
- [ ] insertion.js: FOCUS_SCRIPT also captures foreground window class + process (P/Invoke) so console detection survives UIA failures
- [ ] insertion.js: isConsoleTarget recognises cascadia/openconsole + fg-window info
- [ ] insertion.js: getFocusedTarget sets `known` (real UIA element found) and appId fallback
- [ ] insertion.js: insertText policy — paste unless target is a *known* non-editable non-console (clipboard only then); password still refused
- [ ] insertion.js: pasteText — longer console delays; skip clipboard restore for consoles (restore raced the async console paste)
- [ ] main.js: keep focus promise on dictationSession; handleDone awaits it (2.5s cap) before deciding paste vs clipboard
- [ ] main.js: disarm click-to-paste fallback after a successful auto-paste (no stale re-paste on next terminal click)

## Part A — renderer UI revamp
- [ ] copy icon art to src/renderer/brand.png
- [ ] index.html: real icon in sidebar brand
- [ ] styles.css: full dark brand-matched restyle (all routes, modals, controls)
- [ ] app.js: gauge/heatmap hardcoded colors matched to new palette

## Part B — Windows search icon black borders
- [ ] generate full-bleed opaque square icon.png (1024) from logo art
- [ ] build multi-size icon.ico, corner pixels solid
- [ ] update repo assets (icon.ico/png + src/main copies)
- [ ] patch installed ColdVoice.exe with rcedit (NOT the uninstaller)
- [ ] flush icon caches (shell dead first: AppResolver, iconcache, thumbcache, SearchApp AppIconCache)
- [ ] verify extracted exe icon corners at 96px

## Verify
- [ ] node --check on all edited JS
- [ ] npm test (shared packages untouched but confirm green)
- [ ] mirror changed files into installed app resources (if unpacked) so the installed app picks them up
- [ ] launch app, screenshot routes, no console errors

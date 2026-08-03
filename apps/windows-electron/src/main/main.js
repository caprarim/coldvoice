'use strict';

const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut, session, clipboard, shell } = require('electron');

// Transparent, always-on-top overlay windows (the pill) frequently fail to
// paint on Windows when GPU compositing is on. Disabling hardware acceleration
// makes the transparent pill render reliably.
app.disableHardwareAcceleration();

const db = require('./db');
const asr = require('./asr');
const pill = require('./pill');
const alert = require('./alert');
const notice = require('./notice');
const preview = require('./preview');
const keyhook = require('./keyhook');
const mousehook = require('./mousehook');
const insertion = require('./insertion');
const net = require('./net');
const auth = require('./auth');
const groq = require('./groq');
const { log } = require('./log');
const { process: processText, applyDictionary, expandSnippets, convertSpokenPunctuation } = require('@coldvoice/text-processing');

process.on('uncaughtException', (err) => {
  try { log('uncaught exception:', (err && err.stack) || String(err)); } catch {}
});
process.on('unhandledRejection', (reason) => {
  try { log('unhandled rejection:', (reason && reason.stack) || String(reason)); } catch {}
});

// Whether the cloud AI path (Groq Whisper + Llama) should be used right now:
// the master switch is on, a key is set, AND we currently have connectivity.
// Anything false here transparently falls back to the offline whisper pipeline.
function cloudReady() {
  return groq.enabled() && net.isOnline();
}

let mainWindow = null;
let recorderWindow = null;
let tray = null;

// Dictation state machine.
let recording = false;
let paused = false;
let cancelled = false;
let activeMode = null; // 'toggle' | 'hold'
let lastTarget = { canInsert: false };
let lastTranscript = '';
// After a successful auto-insert, briefly ignore terminal left-click paste so the
// same transcript is not re-injected. Middle-click / Alt+Shift+Z still work.
let suppressLeftPasteUntil = 0;
let micConnected = true;
let currentMicLabel = '';
let noMicHold = false;
let pillNoMic = false;
// The user's mic can bounce (unplug/replug within seconds). These gate the
// disconnect/reconnect alerts so a flapping device never spams the screen,
// while micConnected itself always flips immediately and stays truthful.
let micAlertTimer = null;
let micDisconnectAlertShown = false;
let lastMicBounceAt = 0;
let lastSwitchAlert = { label: '', at: 0 };
let lastSetupFailedAlertAt = 0;
// Streaming dictation session. Audio arrives as segments (split at pauses) and
// is transcribed in the background WHILE recording, so on stop only the final
// segment is left — the WisprFlow trick for near-instant latency.
let dictationSession = null;
let sessionGen = 0;

// --- windows ---------------------------------------------------------------
function createMainWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, 'icon.ico');
  const appIcon = nativeImage.createFromPath(iconPath);
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    title: 'ColdVoice',
    icon: appIcon,
    backgroundColor: '#f6f4ef',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    // Keep running in the tray instead of quitting (X / Alt+F4 only hide).
    if (!app.isQuitting) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createRecorderWindow() {
  recorderWindow = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // CRITICAL: a hidden window is throttled by Chromium, which stalls the
      // ScriptProcessor and produced empty audio (whisper then hallucinated
      // "you"). Disabling background throttling keeps mic capture alive.
      backgroundThrottling: false,
    },
  });
  const win = recorderWindow;
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`recorder: renderer gone (${details && details.reason}), recreating`);
    if (recorderWindow === win) recorderWindow = null;
    try { win.destroy(); } catch {}
    createRecorderWindow();
    if (recording || dictationSession) failDictation('Mic capture restarted');
  });
  win.on('closed', () => {
    if (recorderWindow === win) recorderWindow = null;
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'recorder.html'));
}

function createTray() {
  if (tray) { try { tray.destroy(); } catch { /* ignore */ } tray = null; }
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(trayIcon);
  const menu = Menu.buildFromTemplate([
    { label: 'Open ColdVoice', click: () => showMain() },
    { label: 'Start / stop dictation', click: () => toggleDictation() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('ColdVoice');
  tray.setContextMenu(menu);
  tray.on('click', () => showMain());
}

// Ghost tray icons: when a previous ColdVoice process was killed without a
// clean quit (reinstall, crash, taskkill, shutdown), Windows keeps its dead
// icon in the notification area until the mouse passes over it. Sweep both the
// visible tray and the overflow flyout with synthetic WM_MOUSEMOVEs so
// Explorer re-validates each icon's owner process and drops the dead ones.
function sweepDeadTrayIcons() {
  const ps = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TraySweep {
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string win);
  [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string win);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  static void Sweep(IntPtr h) {
    if (h == IntPtr.Zero) return;
    RECT r;
    if (!GetClientRect(h, out r)) return;
    for (int x = 0; x < r.Right; x += 4)
      for (int y = 0; y < r.Bottom; y += 4)
        SendMessage(h, 0x0200, IntPtr.Zero, (IntPtr)((y << 16) | (x & 0xFFFF)));
  }
  public static void Run() {
    IntPtr notify = FindWindowEx(FindWindow("Shell_TrayWnd", null), IntPtr.Zero, "TrayNotifyWnd", null);
    IntPtr pager = FindWindowEx(notify, IntPtr.Zero, "SysPager", null);
    Sweep(FindWindowEx(pager, IntPtr.Zero, "ToolbarWindow32", null));
    Sweep(FindWindowEx(FindWindow("NotifyIconOverflowWindow", null), IntPtr.Zero, "ToolbarWindow32", null));
  }
}
'@
[TraySweep]::Run()`;
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true }, () => {});
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

// Push the current online/offline status to the main UI so its indicator stays
// live without polling. Dictation never depends on this — only account features.
function broadcastConnectivity(online) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:connectivity', { online });
  }
}

// Defensive guarantee: the dictation pill must NEVER linger on screen. It only
// belongs up during an active dictation, or as the opt-in idle bar. If neither
// is true, force it hidden. Called on startup and whenever a session ends.
function ensurePillHidden() {
  if (recording || noMicHold) return;
  if (db.getSetting('dictation.showBarAlways', '0') === '1') return;
  pill.hide();
}

function refreshPillMicState() {
  if (recording || micConnected) return;
  const idle = db.getSetting('dictation.showBarAlways', '0') === '1';
  if (noMicHold || idle) {
    pillNoMic = true;
    pill.showIdle();
    pill.send('pill:state', { state: 'nomic', message: 'No microphone' });
  }
}

function onMicBack() {
  if (!noMicHold && !pillNoMic) return;
  noMicHold = false;
  pillNoMic = false;
  if (!recording) finishPill(0);
}

function dismissNoMicHold() {
  noMicHold = false;
  pillNoMic = false;
  finishPill(0);
}

// Keep the main window's mic status truthful in real time — it drives the
// "Mic is not ready" modal. Connects are pushed immediately; disconnects are
// pushed from the debounced alert timer so a bounce never flashes the modal.
function broadcastMicStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mic:status', { connected: micConnected, label: currentMicLabel });
  }
}

function handleMicStatus(s) {
  const ev = s.event;
  if (ev === 'disconnected' || (ev === 'setup-failed' && !s.hasMic)) {
    const was = micConnected;
    micConnected = false;
    currentMicLabel = '';
    log(`mic: disconnected${s.label ? ` (${s.label})` : ''}`);
    if (was || ev === 'disconnected') {
      // Hold the alert briefly — and longer while the mic is actively
      // flapping — so a quick bounce never shows a false "disconnected".
      const delay = Date.now() - lastMicBounceAt < 15000 ? 5000 : 1200;
      if (micAlertTimer) clearTimeout(micAlertTimer);
      micAlertTimer = setTimeout(() => {
        micAlertTimer = null;
        if (micConnected) return;
        micDisconnectAlertShown = true;
        broadcastMicStatus();
        alert.show({
          kind: 'disconnect',
          title: 'Microphone disconnected',
          message: 'ColdVoice lost your microphone. Check the cable, then plug it back in.',
          sticky: true,
        });
      }, delay);
    } else {
      broadcastMicStatus();
    }
    refreshPillMicState();
  } else if (ev === 'switched') {
    micConnected = true;
    currentMicLabel = s.label || '';
    if (micAlertTimer) { clearTimeout(micAlertTimer); micAlertTimer = null; }
    micDisconnectAlertShown = false;
    log(`mic: switched to ${s.label || 'unknown'}`);
    broadcastMicStatus();
    // A flapping pinned mic can trigger the same switch repeatedly — only
    // announce each target once per window.
    const dup = lastSwitchAlert.label === currentMicLabel && Date.now() - lastSwitchAlert.at < 10000;
    if (!dup) {
      lastSwitchAlert = { label: currentMicLabel, at: Date.now() };
      alert.show({
        kind: 'switch',
        title: 'Microphone switched',
        message: s.label ? `Now using: ${s.label}` : 'Now using a different microphone.',
        timeoutMs: 5000,
      });
    }
    onMicBack();
  } else if (ev === 'ready') {
    const was = micConnected;
    micConnected = true;
    currentMicLabel = s.label || '';
    if (micAlertTimer) { clearTimeout(micAlertTimer); micAlertTimer = null; }
    broadcastMicStatus();
    if (!was) {
      lastMicBounceAt = Date.now();
      log(`mic: reconnected${s.label ? ` (${s.label})` : ''}`);
      // Only announce the reconnect if the disconnect was actually shown —
      // a silent bounce recovers silently.
      if (micDisconnectAlertShown) {
        micDisconnectAlertShown = false;
        alert.show({
          kind: 'connected',
          title: 'Microphone connected',
          message: s.label ? `Using: ${s.label}` : 'Your microphone is back.',
          timeoutMs: 4000,
        });
      }
      onMicBack();
    }
  } else if (ev === 'setup-failed') {
    log('mic: setup failed with a mic present');
    // The recorder now retries with backoff, so this can repeat — alert at
    // most every 30s.
    if (Date.now() - lastSetupFailedAlertAt > 30000) {
      lastSetupFailedAlertAt = Date.now();
      alert.show({
        kind: 'disconnect',
        title: 'Microphone error',
        message: 'Your microphone could not start. Unplug it and plug it back in.',
        timeoutMs: 7000,
      });
    }
  } else if (ev === 'tooLoud') {
    log('mic: level too loud');
    alert.show({
      kind: 'level',
      title: 'Mic too loud',
      message: 'Please stay quiet or lower your mic volume.',
      timeoutMs: 4000,
    });
  } else if (ev === 'tooQuiet') {
    log('mic: level too quiet');
    alert.show({
      kind: 'level',
      title: 'Mic too quiet',
      message: 'Please speak up or move closer to your mic.',
      timeoutMs: 4000,
    });
  }
}

// --- dictation flow --------------------------------------------------------
let lastToggle = 0;
async function toggleDictation() {
  const now = Date.now();
  if (now - lastToggle < 250) return;
  lastToggle = now;
  if (noMicHold) return dismissNoMicHold();
  if (recording) return stopDictation();
  return startDictation('toggle');
}

function startDictation(mode = 'toggle') {
  if (recording) return;
  if (!micConnected) {
    noMicHold = true;
    refreshPillMicState();
    // The "no mic" state could be stale (e.g. a missed devicechange). Poke the
    // recorder to re-probe: if the mic actually works, its ready event clears
    // this hold and the alert automatically.
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.webContents.send('recorder:refresh');
    }
    alert.show({
      kind: 'disconnect',
      title: 'Microphone disconnected',
      message: 'No microphone is connected. Plug one in to dictate.',
      sticky: true,
    });
    log('dictation blocked: no microphone');
    return;
  }
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    log('dictation blocked: recorder window missing, recreating');
    createRecorderWindow();
    pill.show();
    pill.send('pill:state', { state: 'error', message: 'Mic restarting, retry' });
    finishPill(2500);
    return;
  }
  cancelled = false;
  recording = true;
  paused = false;
  activeMode = mode;
  lastTarget = { canInsert: false };
  // Mark any in-flight finalize so it cannot clobber this new session or the pill.
  if (dictationSession) dictationSession.dead = true;
  // Fresh streaming session. Segments are transcribed serially (one whisper run
  // at a time) so we never thrash the CPU, yet keep up with speech.
  // `cloud` is snapshotted at start so a mid-sentence connectivity flip can't
  // split one dictation across two engines.
  sessionGen += 1;
  dictationSession = {
    id: sessionGen,
    dead: false,
    model: 'base.en',
    ready: asr.isReady('base.en'),
    cloud: cloudReady(),
    parts: [],
    pcm: [],
    queue: Promise.resolve(),
  };
  preview.hide();
  notice.show({
    kind: 'started',
    title: 'ColdVoice has started dictating',
    message: 'Listening. Speak now.',
    timeoutMs: 2200,
  });
  log(`dictation engine: ${dictationSession.cloud ? 'cloud (Groq)' : 'local (whisper.cpp)'}`);
  if (dictationSession.cloud) {
    groq.warm();
  } else {
    alert.show({
      kind: 'fallback',
      title: 'Offline speech model',
      message: 'Cloud AI unavailable. Using local base.en (lower accuracy).',
      timeoutMs: 7000,
    });
  }

  // Show the pill IMMEDIATELY in its fixed spot so there is instant feedback. It
  // stays put while we detect the focused field in the background (used only to
  // decide where the text goes, not where the bar sits).
  pill.show();
  pill.send('pill:state', { state: 'recording' });
  sendRecorder('recorder:start', { segment: !dictationSession.cloud });
  globalShortcut.register('Escape', () => cancelDictation());
  log(`dictation started (mode=${mode})`);

  // Detect the focused field in the background. The promise is kept on the
  // session so handleDone can await it — racing it (and losing on short
  // dictations) was why terminal dictations sometimes only hit the clipboard.
  dictationSession.focus = insertion
    .getFocusedTarget()
    .then((t) => {
      lastTarget = t || { canInsert: false };
      return lastTarget;
    })
    .catch((e) => {
      log('focus detect failed:', e && e.message);
      return { canInsert: false };
    });
}

function sendRecorder(channel, data) {
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    log(`recorder send skipped (${channel}): window missing`);
    createRecorderWindow();
    return false;
  }
  try {
    recorderWindow.webContents.send(channel, data);
    return true;
  } catch (e) {
    log(`recorder send failed (${channel}):`, e && e.message);
    return false;
  }
}

// Hold / release the live dictation. Audio captured before the pause is kept,
// so resuming carries on the same transcript from where the user left off.
function togglePause() {
  if (!recording) return;
  paused = !paused;
  const sent = sendRecorder(paused ? 'recorder:pause' : 'recorder:resume');
  if (!sent) {
    paused = false;
    failDictation('Mic capture restarted');
    return;
  }
  pill.send('pill:state', { state: paused ? 'paused' : 'recording' });
  log(`dictation ${paused ? 'paused' : 'resumed'}`);
}

function stopDictation() {
  if (!recording) return;
  paused = false;
  const sent = sendRecorder('recorder:stop');
  try { globalShortcut.unregister('Escape'); } catch {}
  notice.show({
    kind: 'stopped',
    title: 'ColdVoice has stopped dictating',
    message: 'Transcribing, then inserting your text.',
    timeoutMs: 2000,
  });
  if (!sent) failDictation('Mic capture restarted');
  // The final segment + a 'recorder:done' arrive via their IPC handlers.
}

function cancelDictation() {
  if (noMicHold) return dismissNoMicHold();
  if (recording) {
    notice.show({
      kind: 'stopped',
      title: 'ColdVoice has stopped dictating',
      message: 'Cancelled. Nothing was inserted.',
      timeoutMs: 2000,
    });
  }
  cancelled = true;
  recording = false;
  paused = false;
  activeMode = null;
  const s = dictationSession;
  if (s) s.dead = true;
  sendRecorder('recorder:stop');
  try { globalShortcut.unregister('Escape'); } catch {}
  finishPill();
}

function failDictation(message) {
  recording = false;
  paused = false;
  cancelled = false;
  activeMode = null;
  const s = dictationSession;
  if (s) s.dead = true;
  if (dictationSession === s) dictationSession = null;
  try { globalShortcut.unregister('Escape'); } catch {}
  pill.send('pill:state', { state: 'error', message: message || 'Mic error' });
  finishPill(3000);
}

function clearSessionIfCurrent(s) {
  if (dictationSession === s) dictationSession = null;
}

function sessionStillCurrent(s) {
  return !!(s && !s.dead && dictationSession === s);
}

// After a dictation ends, either hide the pill or drop it back to the always-on
// idle bar, depending on the setting.
function finishPill(delay = 0) {
  const idle = db.getSetting('dictation.showBarAlways', '0') === '1';
  setTimeout(() => {
    if (recording) return;
    if (idle) {
      pill.showIdle();
      if (!micConnected) {
        pillNoMic = true;
        pill.send('pill:state', { state: 'nomic', message: 'No microphone' });
      } else {
        pill.send('pill:state', { state: 'idle' });
      }
    } else if (noMicHold) {
      pillNoMic = true;
      pill.showIdle();
      pill.send('pill:state', { state: 'nomic', message: 'No microphone' });
    } else {
      pill.hide();
    }
  }, delay);
}

const TERMINAL_PROCESSES = new Set([
  'cmd', 'powershell', 'pwsh', 'conhost', 'windowsterminal', 'wt',
  'openconsole', 'windowsterminal', 'hyper', 'alacritty', 'wezterm-gui',
  'wezterm', 'fluentterminal', 'terminus', 'tabby',
]);

function isTerminalClass(className) {
  const cls = String(className || '').toLowerCase();
  return cls.includes('console')
    || cls.includes('terminal')
    || cls.includes('cascadia')
    || cls.includes('windowsterminal')
    || cls.includes('mintty')
    || cls.includes('xterm');
}

function isTerminalProcess(processName) {
  const proc = String(processName || '').trim().toLowerCase().replace(/\.exe$/i, '');
  return TERMINAL_PROCESSES.has(proc);
}

let pasteInFlight = false;
let lastClickPasteAt = 0;
const CLICK_PASTE_DEBOUNCE_MS = 600;

async function pasteLastTranscript(isConsole) {
  if (!lastTranscript || !lastTranscript.trim()) return;
  if (pasteInFlight) return;
  const now = Date.now();
  if (now - lastClickPasteAt < CLICK_PASTE_DEBOUNCE_MS) return;
  lastClickPasteAt = now;
  pasteInFlight = true;
  const text = lastTranscript;
  clipboard.writeText(text);
  try {
    await insertion.pasteFromClipboard(!!isConsole);
  } catch (e) {
    log('click paste failed:', e && e.message);
  } finally {
    // Keep the last dictation on the clipboard for a manual paste if SendKeys
    // failed (common in elevated terminals without focus).
    clipboard.writeText(text);
    pasteInFlight = false;
  }
}

async function pasteLastWithFocus() {
  if (recording || !lastTranscript || !lastTranscript.trim()) return;
  try {
    const t = await insertion.getFocusedTarget();
    await pasteLastTranscript(!!(t && t.isConsole));
  } catch (e) {
    log('pasteLastWithFocus failed:', e && e.message);
    await pasteLastTranscript(false);
  }
}

// Persist the raw WAV to the user data folder when "Store audio" is enabled.
function maybeStoreAudio(pcmBuffer, sampleRate) {
  if (db.getSetting('privacy.storeAudio', '0') !== '1') return;
  try {
    const dir = path.join(app.getPath('userData'), 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `dictation-${Date.now()}.wav`);
    fs.writeFileSync(file, asr.wavBuffer(pcmBuffer, sampleRate));
    log(`stored audio: ${file}`);
  } catch (e) {
    log('storeAudio failed:', e && e.message);
  }
}

const SILENCE_RMS = 0.002;
const MIN_MS = 250;

// Overall loudness of a PCM16 buffer (0..1). Used to reject near-silent clips,
// which Whisper otherwise hallucinates into "Thank you" / "you".
function pcmRms(buf) {
  const n = Math.floor((buf.length || 0) / 2);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

// A speech segment arrived (split at a pause, or the final tail on stop). We
// transcribe it in the background, serialized so only one whisper run happens at
// a time, and stash the text in order. By the time the user stops, most segments
// are already done.
function handlePartial({ pcm, sampleRate, samples = 0, rms = 0 }) {
  if (!dictationSession || dictationSession.dead || cancelled) return;
  const buffer = Buffer.from(pcm);
  dictationSession.pcm.push(buffer);
  dictationSession.sampleRate = sampleRate;
  // Loudest original (pre-normalization) segment level — the pcm itself is
  // gain-normalized by the recorder, so it can't be used to detect silence.
  dictationSession.maxSegRms = Math.max(dictationSession.maxSegRms || 0, rms);
  // Cloud path: just accumulate the audio. The whole recording is sent to Groq
  // in one fast request on stop (more accurate than per-segment, and turbo is so
  // fast the tail latency is still sub-second).
  if (dictationSession.cloud) return;
  dictationSession.queue = dictationSession.queue.then(async () => {
    if (cancelled || !dictationSession || !dictationSession.ready) return;
    // Skip silent segments — whisper hallucinates "you" / "thank you" on silence.
    if (!samples || rms < SILENCE_RMS) return;
    try {
      const t = await asr.transcribe(buffer, dictationSession.model, sampleRate);
      const clean = (t || '').trim();
      if (clean) dictationSession.parts.push(clean);
      log(`segment asr: ${JSON.stringify(clean)}`);
    } catch (e) {
      log('segment asr failed:', e && e.message);
    }
  });
}

// Recording stopped. Wait for any in-flight segments, then assemble, post-process
// and insert the full transcript.
async function handleDone(data) {
  recording = false;
  paused = false;
  activeMode = null;
  try { globalShortcut.unregister('Escape'); } catch {}
  if (cancelled) {
    cancelled = false;
    const s = dictationSession;
    if (s) s.dead = true;
    clearSessionIfCurrent(s);
    finishPill();
    return;
  }
  if (!dictationSession) { finishPill(); return; }
  const s = dictationSession;
  if (s.dead) { clearSessionIfCurrent(s); finishPill(); return; }
  pill.send('pill:state', { state: 'transcribing' });
  await s.queue; // drain remaining segments
  if (!sessionStillCurrent(s)) return;

  const audio = s.pcm.length ? Buffer.concat(s.pcm) : Buffer.alloc(0);
  const durationMs = Math.round((audio.length / 2 / (s.sampleRate || 16000)) * 1000);
  const sampleRate = s.sampleRate || 16000;

  // Bail on an empty / too-short / near-silent recording before spending any ASR
  // work — Whisper hallucinates phantom phrases ("Thank you") on silence.
  const inputRms = s.maxSegRms !== undefined ? s.maxSegRms : pcmRms(audio);
  if (!audio.length || durationMs < MIN_MS || inputRms < SILENCE_RMS) {
    if (!sessionStillCurrent(s)) return;
    pill.send('pill:state', { state: 'info', message: 'No speech detected' });
    finishPill(1400);
    clearSessionIfCurrent(s);
    return;
  }
  // Neither engine available (offline + no local model): show the setup hint.
  if (!s.cloud && !s.ready) {
    if (!sessionStillCurrent(s)) return;
    pill.send('pill:state', { state: 'error', message: 'Offline model missing' });
    finishPill(3500);
    clearSessionIfCurrent(s);
    return;
  }
  maybeStoreAudio(audio, sampleRate);

  const developerMode = db.getSetting('dictation.developerMode', '1') === '1';
  const toneSetting = db.getSetting('dictation.tone', 'auto');
  const tone = toneSetting === 'auto' ? undefined : toneSetting;
  let raw = '';
  let final = '';
  let usedCloud = false;

  // 1) Cloud path (Wispr-style): Groq Whisper for ASR, then Groq Llama for the
  //    real grammar correction + formatting. User dictionary/snippets are exact
  //    rules, so they still apply on top of the AI output.
  let cloudAsr = null;
  let cloudAsrStartedAt = 0;
  if (s.cloud) {
    const opus = data && data.opus ? Buffer.from(data.opus) : null;
    const upload = opus || asr.wavBuffer(audio, sampleRate);
    cloudAsrStartedAt = Date.now();
    log(`cloud asr upload: ${upload.length} bytes (${opus ? 'opus' : 'wav'})`);
    cloudAsr = groq.transcribe(upload, opus ? 'webm' : 'wav');
    cloudAsr.catch(() => {});
  }
  // Make sure focus detection (kicked off when dictation started) has landed
  // before deciding between paste and clipboard. Capped so a hung PowerShell
  // query can never stall the transcript.
  if (s.focus) {
    await Promise.race([s.focus, new Promise((r) => setTimeout(r, 2500))]);
  }
  if (!sessionStillCurrent(s)) return;
  if (cloudAsr) {
    try {
      raw = await cloudAsr;
      log(`cloud asr done in ${Date.now() - cloudAsrStartedAt}ms`);
    } catch (e) {
      // Only ASR failures fall through to the offline whisper. A cleanup
      // failure below must NOT discard a good cloud transcript.
      raw = '';
      log('cloud asr failed, falling back to offline:', e && e.message);
      alert.show({
        kind: 'fallback',
        title: 'Switched to offline speech',
        message: 'Cloud transcription failed. Using local base.en (weaker).',
        timeoutMs: 8000,
      });
    }
    if (raw) {
      if (!sessionStillCurrent(s)) return;
      const autoLists = !lastTarget.isConsole;
      const wordCount = raw.trim().split(/\s+/).length;
      if (wordCount <= 3) {
        final = processText(raw, {
          dictionary: db.dictionaryForPipeline(),
          snippets: db.snippetsForPipeline(),
          appId: lastTarget.appId,
          developerMode,
          autoLists,
          style: tone,
        });
      } else {
        pill.send('pill:state', { state: 'transcribing', message: 'Polishing' });
        const polishStartedAt = Date.now();
        try {
          const cleanedResult = await groq.cleanText(raw, {
            developerMode,
            autoLists,
            tone,
            context: lastTarget.textContext,
          });
          if (cleanedResult.usedFallback) {
            alert.show({
              kind: 'fallback',
              title: 'Weaker grammar model',
              message: 'Primary LLM rate-limited. Using llama-3.1-8b-instant.',
              timeoutMs: 7000,
            });
          }
          if (cleanedResult.aborted) {
            alert.show({
              kind: 'fallback',
              title: 'Grammar polish skipped',
              message: 'Cleanup output looked wrong. Using raw cloud transcript.',
              timeoutMs: 7000,
            });
          }
          let cleaned = cleanedResult.text;
          cleaned = convertSpokenPunctuation(cleaned);
          cleaned = applyDictionary(cleaned, db.dictionaryForPipeline());
          cleaned = expandSnippets(cleaned, db.snippetsForPipeline());
          final = cleaned.trim();
          log(`cloud polish done in ${Date.now() - polishStartedAt}ms`);
        } catch (e) {
          // Cleanup unavailable (rate limit, timeout): keep the accurate cloud
          // transcript and run the deterministic pipeline on it instead of
          // re-transcribing with the much weaker local model.
          log('cloud cleanup failed, using raw cloud transcript:', e && e.message);
          alert.show({
            kind: 'fallback',
            title: 'Grammar polish unavailable',
            message: 'Cleanup failed. Using cloud speech with basic rules only.',
            timeoutMs: 7000,
          });
          final = processText(raw, {
            dictionary: db.dictionaryForPipeline(),
            snippets: db.snippetsForPipeline(),
            appId: lastTarget.appId,
            developerMode,
            autoLists,
            style: tone,
          });
        }
      }
      if (!sessionStillCurrent(s)) return;
      usedCloud = true;
    }
  }
  if (!sessionStillCurrent(s)) return;

  // 2) Offline fallback: local whisper + the deterministic rule pipeline. Uses
  //    the streamed segments when present, else transcribes the whole clip.
  if (!usedCloud) {
    if (s.parts.length) {
      raw = s.parts.join(' ').replace(/\s+/g, ' ').trim();
    } else if (asr.isReady('base.en')) {
      try {
        raw = (await asr.transcribe(audio, 'base.en', sampleRate) || '').trim();
      } catch (e) {
        log('offline asr failed:', e && e.message);
      }
    }
    if (!sessionStillCurrent(s)) return;
    if (raw) {
      final = processText(raw, {
        dictionary: db.dictionaryForPipeline(),
        snippets: db.snippetsForPipeline(),
        appId: lastTarget.appId,
        developerMode,
        autoLists: !lastTarget.isConsole,
        style: tone,
      });
    }
  }

  log(`asr raw: ${JSON.stringify(raw)} durMs=${durationMs} cloud=${usedCloud}`);
  if (!sessionStillCurrent(s)) return;

  if (!raw || !final) {
    pill.send('pill:state', { state: 'info', message: 'No speech detected' });
    finishPill(1400);
    clearSessionIfCurrent(s);
    return;
  }

  try {
    lastTranscript = final;
    db.saveTranscript(raw, final, lastTarget.appId, durationMs);
    notifyTranscript();
    // Bottom-left card with the finished text, for apps ColdVoice cannot type
    // into: copy it from there, or open the main window.
    preview.show({ text: final });

    if (final) {
      // When "insert on release" is off, just copy — never auto-paste.
      if (db.getSetting('dictation.insertOnRelease', '1') !== '1') {
        clipboard.writeText(final);
        if (!sessionStillCurrent(s)) return;
        pill.send('pill:state', { state: 'info', message: 'Copied to clipboard' });
        finishPill(1600);
        clearSessionIfCurrent(s);
        return;
      }
      // Pass the start-of-dictation target through whenever detection resolved
      // an actual element OR a console — insertText only re-queries focus when
      // the earlier detection came back empty.
      const res = await insertion.insertText(
        final,
        lastTarget.known || lastTarget.isConsole ? lastTarget : null
      );
      if (!sessionStillCurrent(s)) return;
      // Clipboard policy: only leave the transcript on the clipboard when we did
      // NOT paste into an editable field (game / desktop / non-input focus, or
      // password skip). After a successful paste, restore is already done inside
      // pasteText — do not overwrite the user's prior clipboard.
      if (!res.ok && res.reason === 'password') {
        clipboard.writeText(final);
        pill.send('pill:state', { state: 'info', message: 'Copied (password field skipped)' });
        finishPill(1800);
        clearSessionIfCurrent(s);
        return;
      }
      if (res.ok && res.mode === 'clipboard') {
        clipboard.writeText(final);
        pill.send('pill:state', { state: 'info', message: 'Copied to clipboard' });
        finishPill(1600);
        clearSessionIfCurrent(s);
        return;
      }
      if (res.ok && res.mode === 'paste') {
        // Keep lastTranscript for middle-click / Alt+Shift+Z, but block the
        // terminal left-click auto-paste briefly so the next click does not
        // re-inject the same text.
        suppressLeftPasteUntil = Date.now() + 1800;
      }
    }
    if (!sessionStillCurrent(s)) return;
    pill.send('pill:state', { state: 'done' });
  } catch (err) {
    if (lastTranscript) clipboard.writeText(lastTranscript);
    if (sessionStillCurrent(s)) {
      pill.send('pill:state', { state: 'error', message: String(err && err.message ? err.message : err) });
      finishPill(3500);
    }
    clearSessionIfCurrent(s);
    return;
  }
  clearSessionIfCurrent(s);
  finishPill(500);
}

// Tell the main UI a new dictation was saved so Home updates live (no refresh).
function notifyTranscript() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('transcript:new');
  }
}

// --- IPC -------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('recorder:partial', (_e, data) => handlePartial(data));
  ipcMain.on('recorder:done', (_e, data) => handleDone(data));
  ipcMain.on('recorder:error', (_e, data) => {
    const message = (data && data.message) || 'Mic error';
    log('recorder error:', message);
    if (!recording) return;
    failDictation(message);
  });
  ipcMain.on('recorder:micStatus', (_e, data) => handleMicStatus(data || {}));
  ipcMain.on('recorder:ready', () => {});
  ipcMain.on('recorder:level', (_e, data) => pill.send('pill:level', data));
  ipcMain.on('pill:cancel', () => { log('pill: cancel clicked'); cancelDictation(); });
  ipcMain.on('pill:confirm', () => {
    log('pill: confirm clicked');
    if (noMicHold) return dismissNoMicHold();
    stopDictation();
  });
  ipcMain.on('alert:dismiss', () => { log('alert: dismissed'); alert.hide(); });

  ipcMain.handle('db:getSettings', () => db.allSettings());
  ipcMain.handle('db:setSetting', (_e, { key, value }) => {
    db.setSetting(key, value);
    applySideEffects(key);
    return true;
  });
  ipcMain.handle('db:listDictionary', () => db.listDictionary());
  ipcMain.handle('db:upsertDictionary', (_e, entry) => db.upsertDictionary(entry));
  ipcMain.handle('db:deleteDictionary', (_e, id) => { db.deleteDictionary(id); return true; });
  ipcMain.handle('db:listSnippets', () => db.listSnippets());
  ipcMain.handle('db:upsertSnippet', (_e, s) => db.upsertSnippet(s));
  ipcMain.handle('db:deleteSnippet', (_e, id) => { db.deleteSnippet(id); return true; });
  ipcMain.handle('db:listTranscripts', (_e, limit) => db.listTranscripts(limit || 200));
  ipcMain.handle('db:updateTranscript', (_e, { id, text }) => { db.updateTranscript(id, text); return true; });
  ipcMain.handle('db:deleteTranscript', (_e, id) => { db.deleteTranscript(id); return true; });
  ipcMain.handle('db:clearTranscripts', () => { db.clearTranscripts(); return true; });
  ipcMain.handle('db:transcriptStats', () => db.transcriptStats());
  ipcMain.handle('asr:status', () => ({ ready: asr.isReady('base.en') }));

  // Live mic state for the main window, and the Windows Sound settings page
  // (input device list) for the "Mic is not ready" modal.
  ipcMain.handle('mic:status', () => ({ connected: micConnected, label: currentMicLabel }));
  ipcMain.handle('app:openSoundSettings', () => {
    shell.openExternal('ms-settings:sound');
    return true;
  });

  // AI grammar engine (Groq). status reports whether it will actually be used.
  ipcMain.handle('ai:status', () => ({
    hasKey: groq.hasKey(),
    enabled: db.getSetting('ai.enabled', '1') === '1',
    online: net.isOnline(),
    active: cloudReady(),
  }));
  ipcMain.handle('ai:test', async () => groq.test());

  // Connectivity + account.
  ipcMain.handle('app:isOnline', () => ({ online: net.isOnline() }));
  ipcMain.handle('auth:status', () => auth.status());
  ipcMain.handle('auth:signIn', async (_e, { mode, email, password }) => {
    try {
      return { ok: true, status: await auth.signIn(mode, email, password) };
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });
  ipcMain.handle('auth:signOut', () => ({ ok: true, status: auth.signOut() }));

  const UPDATE_LATEST_URL = 'https://coldvoice.vercel.app/downloads/latest.json';

  function compareVersions(a, b) {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  let updateDownloadInFlight = false;
  let updateReadyPath = null;
  let updateInstallerUrl = '';

  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const res = await fetch(`${UPDATE_LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const latest = typeof data.version === 'string' ? data.version.trim() : '';
      if (!/^\d+(\.\d+)*$/.test(latest)) throw new Error('Bad version format');
      updateInstallerUrl = typeof data.windows === 'string' && data.windows
        ? new URL(data.windows, UPDATE_LATEST_URL).toString()
        : new URL(`ColdVoice-Setup-${latest}.exe`, UPDATE_LATEST_URL).toString();
      return { ok: true, current, latest, updateAvailable: compareVersions(latest, current) > 0 };
    } catch (err) {
      return { ok: false, current, error: err && err.message ? err.message : 'Check failed' };
    }
  });

  ipcMain.handle('update:download', async (event) => {
    if (updateDownloadInFlight) return { error: 'An update is already downloading.' };
    if (updateReadyPath && fs.existsSync(updateReadyPath)) return { ok: true, ready: true };
    if (!updateInstallerUrl) return { error: 'Check for updates first.' };
    updateDownloadInFlight = true;
    const dest = path.join(app.getPath('temp'), 'ColdVoice-Update.exe');
    try {
      const res = await fetch(updateInstallerUrl);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length') || 0);
      const out = fs.createWriteStream(dest);
      let received = 0;
      let lastSent = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        received += buf.length;
        if (!out.write(buf)) {
          await new Promise((resolve) => out.once('drain', resolve));
        }
        const now = Date.now();
        if (now - lastSent > 250) {
          lastSent = now;
          try { event.sender.send('update:progress', { received, total }); } catch {}
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (received < 1024 * 1024) throw new Error('Download incomplete. Try again.');
      updateReadyPath = dest;
      return { ok: true, ready: true };
    } catch (err) {
      try { fs.unlinkSync(dest); } catch {}
      return { error: err && err.message ? err.message : 'Download failed. Try again.' };
    } finally {
      updateDownloadInFlight = false;
    }
  });

  ipcMain.handle('update:install', async () => {
    if (!updateReadyPath || !fs.existsSync(updateReadyPath)) {
      return { error: 'Download the update first.' };
    }
    try {
      spawn(updateReadyPath, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => {
        app.isQuitting = true;
        app.quit();
      }, 800);
      return { ok: true };
    } catch (err) {
      return { error: err && err.message ? err.message : 'Update failed. Try again.' };
    }
  });
}

function applySideEffects(key) {
  if (
    key === 'shortcut.handsFreeToggle'
    || key === 'shortcut.holdToDictate'
    || key === 'shortcut.pasteLastTranscriptAlt'
    || key === 'shortcut.pauseResume'
  ) refreshHotkeys();
  else if (key === 'app.launchAtLogin') applyLaunchAtLogin();
  else if (key === 'dictation.microphoneDeviceId') {
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.webContents.send('recorder:refresh');
    }
  }
  else if (key === 'dictation.showBarAlways') {
    if (!recording) finishPill(0);
  }
}

function onPillButton(id) {
  log(`pill: ${id} clicked`);
  // Any button dismisses the "no microphone" hold — the bar is only up to be
  // acknowledged at that point.
  if (noMicHold) return dismissNoMicHold();
  if (id === 'cancel') cancelDictation();
  else if (id === 'pause') togglePause();
  else if (id === 'confirm') stopDictation();
}

function onPreviewButton(id) {
  if (!id) return;
  log(`preview: ${id} clicked`);
  if (id === 'copy') {
    const text = preview.currentText();
    if (text) clipboard.writeText(text);
    preview.copied();
  } else if (id === 'open') {
    preview.hide();
    showMain();
  } else if (id === 'close') {
    preview.hide();
  }
}

function startMousePasteHook() {
  mousehook.start((button, className, processName) => {
    // Pill dragging and its buttons both ride the same global poller: press
    // anywhere on the pill grabs it, and the left-button-up edge either ends the
    // drag or — when the press never moved and landed on a button — fires that
    // button. DOM handlers cannot do this: the pill is non-focusable, so it
    // never receives renderer mouse events. A press anywhere on the pill is the
    // pill's own business — never click-to-paste.
    if (button === 'LU') {
      const clicked = pill.dragEnd();
      if (clicked) onPillButton(clicked);
      return;
    }
    if (button === 'L' && preview.hitTest()) {
      onPreviewButton(preview.buttonAtCursor());
      return;
    }
    if (button === 'L' && alert.hitTest()) {
      log('alert: dismissed by click');
      alert.hide();
      return;
    }
    if (button === 'L' && pill.hitTest()) {
      pill.dragBegin();
      return;
    }
    // Never fire while a dictation is live: clicking the pill's buttons over a
    // terminal used to re-paste the PREVIOUS transcript into it.
    if (recording) return;
    const isConsole = isTerminalClass(className) || isTerminalProcess(processName);
    if (button === 'M') pasteLastTranscript(isConsole);
    else if (button === 'L' && isConsole) {
      if (Date.now() < suppressLeftPasteUntil) return;
      pasteLastTranscript(true);
    }
  });
}

function refreshHotkeys() {
  const toggle = db.getSetting('shortcut.handsFreeToggle', 'Ctrl+1');
  const hold = db.getSetting('shortcut.holdToDictate', 'Ctrl+CapsLock');
  const pasteAlt = db.getSetting('shortcut.pasteLastTranscriptAlt', 'Alt+Shift+Z');
  // Pause has no default binding: it stays off until the user sets one in
  // Settings, so it can never collide with an existing shortcut out of the box.
  const pauseKey = (db.getSetting('shortcut.pauseResume', '') || '').trim();
  const chords = [
    { id: 'toggle', accel: toggle },
    { id: 'hold', accel: hold },
    { id: 'paste', accel: pasteAlt },
  ];
  if (pauseKey) chords.push({ id: 'pauseResume', accel: pauseKey });
  keyhook.start(
    chords,
    {
      onDown: (id) => {
        if (id === 'toggle') toggleDictation();
        else if (id === 'hold' && !recording) startDictation('hold');
        else if (id === 'paste') pasteLastWithFocus();
        else if (id === 'pauseResume') togglePause();
      },
      onUp: (id) => {
        if (id === 'hold' && recording && activeMode === 'hold') stopDictation();
      },
    }
  );
  log(`dictation armed: toggle=${toggle} hold=${hold} paste=${pasteAlt} pause=${pauseKey || 'not set'}`);
}

function applyLaunchAtLogin() {
  try {
    const open = db.getSetting('app.launchAtLogin', '0') === '1';
    app.setLoginItemSettings({ openAtLogin: open });
  } catch (e) {
    log('launchAtLogin failed:', e && e.message);
  }
}

// Seed any settings missing from older databases.
function seedDefaults() {
  const defaults = {
    'shortcut.handsFreeToggle': 'Ctrl+1',
    'shortcut.holdToDictate': 'Ctrl+CapsLock',
    'shortcut.cancel': 'Esc',
    'shortcut.pasteLastTranscriptAlt': 'Alt+Shift+Z',
    'shortcut.pauseResume': '',
    'dictation.insertOnRelease': '1',
    'dictation.showBarAlways': '0',
    'dictation.developerMode': '1',
    'dictation.tone': 'auto',
    'app.launchAtLogin': '0',
    'app.offlineMode': '0',
    'privacy.storeTranscripts': '1',
    'privacy.storeAudio': '0',
    // Cloud AI grammar (Groq). Enabled by default with a working key so dictation
    // is polished out of the box; the user can change or clear the key in Settings.
    'ai.enabled': '1',
    'ai.groqApiKey': process.env.GROQ_API_KEY || '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (db.getSetting(k, null) == null) db.setSetting(k, v);
  }
}

// --- lifecycle -------------------------------------------------------------
// Only one ColdVoice may run, or two key listeners would fight over the mic.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(() => {
    log('app ready');
    db.init();
    seedDefaults();
    // Auto-grant the microphone permission for our own renderers.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'microphone');
    });
    createMainWindow();
    createRecorderWindow();
    pill.ensure();
    alert.ensure();
    notice.ensure();
    preview.ensure();
    createTray();
    sweepDeadTrayIcons();
    registerIpc();
    refreshHotkeys();
    startMousePasteHook();
    applyLaunchAtLogin();
    net.start();
    net.onChange(broadcastConnectivity);
    // Warm the model so the first real dictation isn't slow: this pulls the model
    // file into the OS cache and primes whisper's code paths on 1s of silence.
    setTimeout(() => {
      try {
        if (asr.isReady('base.en')) {
          asr.transcribe(Buffer.alloc(16000 * 2), 'base.en', 16000).catch(() => {});
        }
      } catch { /* ignore */ }
    }, 1500);
    if (db.getSetting('dictation.showBarAlways', '0') === '1') {
      pill.showIdle();
      if (micConnected) pill.send('pill:state', { state: 'idle' });
      else pill.send('pill:state', { state: 'nomic', message: 'No microphone' });
    } else {
      // Never start up with a stray pill on screen.
      ensurePillHidden();
    }
  });

  // Ensure tray-quit, OS logoff, and any future app.quit() callers all allow the
  // main window to actually close (otherwise preventDefault on 'close' can leave
  // a half-dead process that looks like the app "closed by itself").
  app.on('before-quit', () => {
    app.isQuitting = true;
  });
  app.on('will-quit', () => {
    app.isQuitting = true;
    if (tray) { try { tray.destroy(); } catch { /* ignore */ } tray = null; }
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
    keyhook.stop();
    mousehook.stop();
    net.stop();
  });
  app.on('window-all-closed', () => {
    // Stay alive in the tray; do not quit on Windows.
  });
}

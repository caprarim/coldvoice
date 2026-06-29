'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut, session, clipboard } = require('electron');

// Transparent, always-on-top overlay windows (the pill) frequently fail to
// paint on Windows when GPU compositing is on. Disabling hardware acceleration
// makes the transparent pill render reliably.
app.disableHardwareAcceleration();

const db = require('./db');
const asr = require('./asr');
const pill = require('./pill');
const keyhook = require('./keyhook');
const mousehook = require('./mousehook');
const insertion = require('./insertion');
const net = require('./net');
const auth = require('./auth');
const groq = require('./groq');
const { log } = require('./log');
const { process: processText, applyDictionary, expandSnippets } = require('@coldvoice/text-processing');

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
let cancelled = false;
let activeMode = null; // 'toggle' | 'hold'
let lastTarget = { canInsert: false };
let lastTranscript = '';
// Streaming dictation session. Audio arrives as segments (split at pauses) and
// is transcribed in the background WHILE recording, so on stop only the final
// segment is left — the WisprFlow trick for near-instant latency.
let dictationSession = null;

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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    // Keep running in the tray instead of quitting.
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
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
  recorderWindow.loadFile(path.join(__dirname, '..', 'renderer', 'recorder.html'));
}

function createTray() {
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

function showMain() {
  if (!mainWindow) createMainWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
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
  if (recording) return;
  if (db.getSetting('dictation.showBarAlways', '0') === '1') return;
  pill.hide();
}

// --- dictation flow --------------------------------------------------------
let lastToggle = 0;
async function toggleDictation() {
  const now = Date.now();
  if (now - lastToggle < 250) return;
  lastToggle = now;
  if (recording) return stopDictation();
  return startDictation('toggle');
}

function startDictation(mode = 'toggle') {
  if (recording) return;
  cancelled = false;
  recording = true;
  activeMode = mode;
  lastTarget = { canInsert: false };
  // Fresh streaming session. Segments are transcribed serially (one whisper run
  // at a time) so we never thrash the CPU, yet keep up with speech.
  // `cloud` is snapshotted at start so a mid-sentence connectivity flip can't
  // split one dictation across two engines.
  dictationSession = {
    model: 'base.en',
    ready: asr.isReady('base.en'),
    cloud: cloudReady(),
    parts: [],
    pcm: [],
    queue: Promise.resolve(),
  };
  log(`dictation engine: ${dictationSession.cloud ? 'cloud (Groq)' : 'local (whisper.cpp)'}`);

  // Show the pill IMMEDIATELY in its fixed spot so there is instant feedback. It
  // stays put while we detect the focused field in the background (used only to
  // decide where the text goes, not where the bar sits).
  pill.show();
  pill.send('pill:state', { state: 'recording' });
  recorderWindow.webContents.send('recorder:start');
  globalShortcut.register('Escape', () => cancelDictation());
  log(`dictation started (mode=${mode})`);

  insertion
    .getFocusedTarget()
    .then((t) => {
      lastTarget = t || { canInsert: false };
    })
    .catch((e) => log('focus detect failed:', e && e.message));
}

function stopDictation() {
  if (!recording) return;
  recorderWindow.webContents.send('recorder:stop');
  globalShortcut.unregister('Escape');
  // The final segment + a 'recorder:done' arrive via their IPC handlers.
}

function cancelDictation() {
  cancelled = true;
  recording = false;
  activeMode = null;
  recorderWindow.webContents.send('recorder:stop');
  globalShortcut.unregister('Escape');
  finishPill();
}

// After a dictation ends, either hide the pill or drop it back to the always-on
// idle bar, depending on the setting.
function finishPill(delay = 0) {
  const idle = db.getSetting('dictation.showBarAlways', '0') === '1';
  setTimeout(() => {
    if (idle) { pill.showIdle(); pill.send('pill:state', { state: 'idle' }); }
    else pill.hide();
  }, delay);
}

const TERMINAL_PROCESSES = new Set([
  'cmd', 'powershell', 'pwsh', 'conhost', 'windowsterminal', 'wt',
]);

function isTerminalClass(className) {
  const cls = String(className || '').toLowerCase();
  return cls.includes('console')
    || cls.includes('terminal')
    || cls.includes('cascadia')
    || cls.includes('windowsterminal');
}

function isTerminalProcess(processName) {
  const proc = String(processName || '').trim().toLowerCase().replace(/\.exe$/i, '');
  return TERMINAL_PROCESSES.has(proc);
}

async function pasteLastTranscript(isConsole) {
  if (!lastTranscript || !lastTranscript.trim()) return;
  clipboard.writeText(lastTranscript);
  try {
    await insertion.pasteFromClipboard(!!isConsole);
  } catch (e) {
    log('click paste failed:', e && e.message);
  } finally {
    clipboard.writeText(lastTranscript);
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
  if (!dictationSession || cancelled) return;
  const buffer = Buffer.from(pcm);
  dictationSession.pcm.push(buffer);
  dictationSession.sampleRate = sampleRate;
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
async function handleDone() {
  recording = false;
  activeMode = null;
  if (cancelled) {
    cancelled = false;
    dictationSession = null;
    finishPill();
    return;
  }
  if (!dictationSession) { finishPill(); return; }
  const s = dictationSession;
  pill.send('pill:state', { state: 'transcribing' });
  await s.queue; // drain remaining segments

  const audio = s.pcm.length ? Buffer.concat(s.pcm) : Buffer.alloc(0);
  const durationMs = Math.round((audio.length / 2 / (s.sampleRate || 16000)) * 1000);
  const sampleRate = s.sampleRate || 16000;

  // Bail on an empty / too-short / near-silent recording before spending any ASR
  // work — Whisper hallucinates phantom phrases ("Thank you") on silence.
  if (!audio.length || durationMs < MIN_MS || pcmRms(audio) < SILENCE_RMS) {
    pill.send('pill:state', { state: 'info', message: 'No speech detected' });
    finishPill(1400);
    dictationSession = null;
    return;
  }
  // Neither engine available (offline + no local model): show the setup hint.
  if (!s.cloud && !s.ready) {
    pill.send('pill:state', { state: 'error', message: 'Offline model missing' });
    finishPill(3500);
    dictationSession = null;
    return;
  }
  maybeStoreAudio(audio, sampleRate);

  const developerMode = db.getSetting('dictation.developerMode', '1') === '1';
  let raw = '';
  let final = '';
  let usedCloud = false;

  // 1) Cloud path (Wispr-style): Groq Whisper for ASR, then Groq Llama for the
  //    real grammar correction + formatting. User dictionary/snippets are exact
  //    rules, so they still apply on top of the AI output.
  if (s.cloud) {
    try {
      raw = await groq.transcribe(asr.wavBuffer(audio, sampleRate));
      if (raw) {
        pill.send('pill:state', { state: 'transcribing', message: 'Polishing' });
        let cleaned = await groq.cleanText(raw, { developerMode });
        cleaned = applyDictionary(cleaned, db.dictionaryForPipeline());
        cleaned = expandSnippets(cleaned, db.snippetsForPipeline());
        final = cleaned.trim();
        usedCloud = true;
      }
    } catch (e) {
      log('cloud dictation failed, falling back to offline:', e && e.message);
    }
  }

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
    if (raw) {
      final = processText(raw, {
        dictionary: db.dictionaryForPipeline(),
        snippets: db.snippetsForPipeline(),
        appId: lastTarget.appId,
        developerMode,
      });
    }
  }

  log(`asr raw: ${JSON.stringify(raw)} durMs=${durationMs} cloud=${usedCloud}`);

  if (!raw || !final) {
    pill.send('pill:state', { state: 'info', message: 'No speech detected' });
    finishPill(1400);
    dictationSession = null;
    return;
  }

  try {
    lastTranscript = final;
    db.saveTranscript(raw, final, lastTarget.appId, durationMs);
    notifyTranscript();

    if (final) {
      // When "insert on release" is off, just copy — never auto-paste.
      if (db.getSetting('dictation.insertOnRelease', '1') !== '1') {
        clipboard.writeText(final);
        pill.send('pill:state', { state: 'info', message: 'Copied to clipboard' });
        finishPill(1600);
        dictationSession = null;
        return;
      }
      const res = await insertion.insertText(final, lastTarget.canInsert ? lastTarget : null);
      // Always leave the latest transcript on the clipboard, no matter where the
      // focus was. insertText's paste path restores the previous clipboard, so we
      // re-copy here to guarantee the user can always paste the text they just
      // dictated (e.g. when the focused target was not an editable field).
      clipboard.writeText(final);
      if (!res.ok && res.reason === 'password') {
        pill.send('pill:state', { state: 'info', message: 'Copied (password field skipped)' });
        finishPill(1800);
        dictationSession = null;
        return;
      }
      if (res.ok && res.mode === 'clipboard') {
        pill.send('pill:state', { state: 'info', message: 'Copied to clipboard' });
        finishPill(1600);
        dictationSession = null;
        return;
      }
    }
    pill.send('pill:state', { state: 'done' });
  } catch (err) {
    if (lastTranscript) clipboard.writeText(lastTranscript);
    pill.send('pill:state', { state: 'error', message: String(err && err.message ? err.message : err) });
    finishPill(3500);
    dictationSession = null;
    return;
  }
  dictationSession = null;
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
  ipcMain.on('recorder:done', () => handleDone());
  ipcMain.on('recorder:error', (_e, data) => {
    pill.send('pill:state', { state: 'error', message: (data && data.message) || 'Mic error' });
    finishPill(3000);
  });
  ipcMain.on('recorder:ready', () => {});
  ipcMain.on('recorder:level', (_e, data) => pill.send('pill:level', data));
  ipcMain.on('pill:cancel', () => cancelDictation());
  ipcMain.on('pill:confirm', () => stopDictation());
  ipcMain.on('pill:dragStart', () => pill.dragBegin());
  ipcMain.on('pill:dragMove', (_e, d) => pill.dragMove((d && d.dx) || 0, (d && d.dy) || 0));
  ipcMain.on('pill:dragEnd', () => pill.dragEnd());

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
  ipcMain.handle('db:deleteTranscript', (_e, id) => { db.deleteTranscript(id); return true; });
  ipcMain.handle('db:clearTranscripts', () => { db.clearTranscripts(); return true; });
  ipcMain.handle('db:transcriptStats', () => db.transcriptStats());
  ipcMain.handle('asr:status', () => ({ ready: asr.isReady('base.en') }));

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
}

function applySideEffects(key) {
  if (key === 'shortcut.handsFreeToggle' || key === 'shortcut.holdToDictate') refreshHotkeys();
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

function startMousePasteHook() {
  mousehook.start((button, className, processName) => {
    const isConsole = isTerminalClass(className) || isTerminalProcess(processName);
    if (button === 'M') pasteLastTranscript(isConsole);
    else if (button === 'L' && isConsole) pasteLastTranscript(true);
  });
}

function refreshHotkeys() {
  const toggle = db.getSetting('shortcut.handsFreeToggle', 'Ctrl+1');
  const hold = db.getSetting('shortcut.holdToDictate', 'Ctrl+CapsLock');
  keyhook.start(
    [{ id: 'toggle', accel: toggle }, { id: 'hold', accel: hold }],
    {
      onDown: (id) => {
        if (id === 'toggle') toggleDictation();
        else if (id === 'hold' && !recording) startDictation('hold');
      },
      onUp: (id) => {
        if (id === 'hold' && recording && activeMode === 'hold') stopDictation();
      },
    }
  );
  log(`dictation armed: toggle=${toggle} hold=${hold}`);
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
    'dictation.insertOnRelease': '1',
    'dictation.showBarAlways': '0',
    'dictation.developerMode': '1',
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
    createTray();
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
      pill.send('pill:state', { state: 'idle' });
    } else {
      // Never start up with a stray pill on screen.
      ensurePillHidden();
    }
  });

  app.on('will-quit', () => { globalShortcut.unregisterAll(); keyhook.stop(); mousehook.stop(); net.stop(); });
  app.on('window-all-closed', () => {
    // Stay alive in the tray; do not quit on Windows.
  });
}

'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');

// Transparent, always-on-top overlay windows (the pill) frequently fail to
// paint on Windows when GPU compositing is on. Disabling hardware acceleration
// makes the transparent pill render reliably.
app.disableHardwareAcceleration();

const db = require('./db');
const asr = require('./asr');
const pill = require('./pill');
const hotkeys = require('./hotkeys');
const keyhook = require('./keyhook');
const insertion = require('./insertion');
const { log } = require('./log');
const { process: processText } = require('@coldvoice/text-processing');

let mainWindow = null;
let recorderWindow = null;
let tray = null;

// Dictation state machine.
let recording = false;
let cancelled = false;
let lastTarget = { canInsert: false };
let lastTranscript = '';

// --- windows ---------------------------------------------------------------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    title: 'ColdVoice',
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
    },
  });
  recorderWindow.loadFile(path.join(__dirname, '..', 'renderer', 'recorder.html'));
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
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

// --- dictation flow --------------------------------------------------------
// Windows RegisterHotKey auto-repeats WM_HOTKEY while the key is held, which
// would toggle start->stop->start on a single press. Ignore repeats that arrive
// within a short window so one physical press = one toggle.
let lastToggle = 0;
async function toggleDictation() {
  const now = Date.now();
  if (now - lastToggle < 250) {
    log('toggleDictation ignored (debounce)');
    return;
  }
  lastToggle = now;
  log(`toggleDictation fired (recording=${recording})`);
  if (recording) return stopDictation();
  return startDictation();
}

function startDictation() {
  if (recording) return;
  cancelled = false;
  recording = true;
  lastTarget = { canInsert: false };

  // Show the pill IMMEDIATELY (top-center fallback) so there is instant feedback,
  // then detect the focused field in the background and reposition near it.
  pill.show(null);
  pill.send('pill:state', { state: 'recording' });
  recorderWindow.webContents.send('recorder:start');
  log('dictation started — pill.show called');

  insertion
    .getFocusedTarget()
    .then((t) => {
      lastTarget = t || { canInsert: false };
      pill.reposition(lastTarget);
    })
    .catch((e) => log('focus detect failed:', e && e.message));
}

function stopDictation() {
  if (!recording) return;
  recorderWindow.webContents.send('recorder:stop');
  // Audio returns via the 'recorder:audio' handler.
}

function cancelDictation() {
  cancelled = true;
  recording = false;
  recorderWindow.webContents.send('recorder:stop');
  pill.hide();
}

async function handleAudio({ pcm, sampleRate }) {
  recording = false;
  if (cancelled) {
    cancelled = false;
    pill.hide();
    return;
  }
  const model = db.getSetting('asr.model', 'base.en');
  if (!asr.isReady(model)) {
    pill.send('pill:state', { state: 'error', message: asr.setupMessage(model) });
    setTimeout(() => pill.hide(), 4000);
    return;
  }
  pill.send('pill:state', { state: 'transcribing' });
  try {
    const buffer = Buffer.from(pcm);
    const raw = await asr.transcribe(buffer, model, sampleRate);
    const final = processText(raw, {
      dictionary: db.dictionaryForPipeline(),
      snippets: db.snippetsForPipeline(),
      appId: lastTarget.appId,
    });
    lastTranscript = final;
    db.saveTranscript(raw, final, lastTarget.appId);

    const insertOnRelease = db.getSetting('dictation.insertOnRelease', '1') === '1';
    if (insertOnRelease && final) {
      const res = await insertion.insertText(final);
      if (!res.ok && res.reason === 'password') {
        pill.send('pill:state', { state: 'error', message: 'Skipped: password field.' });
        setTimeout(() => pill.hide(), 2500);
        return;
      }
    }
  } catch (err) {
    pill.send('pill:state', { state: 'error', message: String(err && err.message ? err.message : err) });
    setTimeout(() => pill.hide(), 4000);
    return;
  }
  pill.hide();
}

async function pasteLast() {
  if (!lastTranscript) return;
  await insertion.insertText(lastTranscript);
}

// --- IPC -------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('recorder:audio', (_e, data) => handleAudio(data));
  ipcMain.on('recorder:error', (_e, data) => {
    pill.send('pill:state', { state: 'error', message: data && data.message });
  });
  ipcMain.on('recorder:ready', () => {});
  ipcMain.on('pill:cancel', () => cancelDictation());
  ipcMain.on('pill:confirm', () => stopDictation());

  ipcMain.handle('db:getSettings', () => db.allSettings());
  ipcMain.handle('db:setSetting', (_e, { key, value }) => {
    db.setSetting(key, value);
    refreshHotkeys();
    return true;
  });
  ipcMain.handle('db:listDictionary', () => db.listDictionary());
  ipcMain.handle('db:upsertDictionary', (_e, entry) => db.upsertDictionary(entry));
  ipcMain.handle('db:deleteDictionary', (_e, id) => { db.deleteDictionary(id); return true; });
  ipcMain.handle('db:listSnippets', () => db.listSnippets());
  ipcMain.handle('db:upsertSnippet', (_e, s) => db.upsertSnippet(s));
  ipcMain.handle('db:deleteSnippet', (_e, id) => { db.deleteSnippet(id); return true; });
  ipcMain.handle('asr:status', () => {
    const model = db.getSetting('asr.model', 'base.en');
    return { ready: asr.isReady(model), model, message: asr.isReady(model) ? '' : asr.setupMessage(model) };
  });
  // Lets the Home screen test the cleanup pipeline without a mic.
  ipcMain.handle('app:processText', (_e, { text, appId }) =>
    processText(text, {
      dictionary: db.dictionaryForPipeline(),
      snippets: db.snippetsForPipeline(),
      appId,
    })
  );
}

function refreshHotkeys() {
  const settings = db.allSettings();
  // Register the dictation accelerator as a no-op global shortcut purely to
  // swallow it (so e.g. "1" doesn't reach the focused app), plus the real
  // paste-last shortcut. The dictation logic itself is driven by keyhook below,
  // which gives us key-UP for true hold-to-dictate.
  hotkeys.register(settings, {
    onDictateToggle: () => {},
    onPasteLast: () => pasteLast(),
  });

  const accel = settings['shortcut.handsFreeHoldToDictate'] || 'Ctrl+1';
  const mode = settings['dictation.mode'] || 'hold';
  keyhook.start(accel, {
    onDown: () => {
      if (mode === 'hold') startDictation();
      else toggleDictation();
    },
    onUp: () => {
      if (mode === 'hold') stopDictation();
    },
  });
  log(`dictation armed: mode=${mode} shortcut=${accel}`);
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
    createMainWindow();
    createRecorderWindow();
    pill.ensure();
    createTray();
    registerIpc();
    refreshHotkeys();
  });

  app.on('will-quit', () => { hotkeys.unregisterAll(); keyhook.stop(); });
  app.on('window-all-closed', () => {
    // Stay alive in the tray; do not quit on Windows.
  });
}

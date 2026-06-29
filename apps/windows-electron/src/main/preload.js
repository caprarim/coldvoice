'use strict';

// A small, explicit IPC bridge shared by all renderers (main UI, pill, recorder).
// contextIsolation is on; renderers get no direct Node access.

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_SEND = new Set([
  'recorder:ready', 'recorder:partial', 'recorder:done', 'recorder:error', 'recorder:level',
  'pill:cancel', 'pill:confirm',
  'pill:dragStart', 'pill:dragMove', 'pill:dragEnd',
]);

const ALLOWED_ON = new Set([
  'recorder:start', 'recorder:stop', 'recorder:refresh',
  'pill:state', 'pill:level',
  'app:connectivity', 'transcript:new',
]);

const ALLOWED_INVOKE = new Set([
  'db:getSettings', 'db:setSetting',
  'db:listDictionary', 'db:upsertDictionary', 'db:deleteDictionary',
  'db:listSnippets', 'db:upsertSnippet', 'db:deleteSnippet',
  'db:listTranscripts', 'db:deleteTranscript', 'db:clearTranscripts', 'db:transcriptStats',
  'asr:status', 'ai:status', 'ai:test',
  'app:isOnline', 'auth:status', 'auth:signIn', 'auth:signOut',
]);

contextBridge.exposeInMainWorld('coldvoice', {
  send(channel, data) {
    if (ALLOWED_SEND.has(channel)) ipcRenderer.send(channel, data);
  },
  on(channel, cb) {
    if (ALLOWED_ON.has(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  invoke(channel, data) {
    if (ALLOWED_INVOKE.has(channel)) return ipcRenderer.invoke(channel, data);
    return Promise.reject(new Error(`blocked channel: ${channel}`));
  },
});

'use strict';

// A small, explicit IPC bridge shared by all renderers (main UI, pill, recorder).
// contextIsolation is on; renderers get no direct Node access.

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_SEND = new Set([
  'recorder:ready', 'recorder:audio', 'recorder:error',
  'pill:cancel', 'pill:confirm',
]);

const ALLOWED_ON = new Set([
  'recorder:start', 'recorder:stop',
  'pill:state',
]);

const ALLOWED_INVOKE = new Set([
  'db:getSettings', 'db:setSetting',
  'db:listDictionary', 'db:upsertDictionary', 'db:deleteDictionary',
  'db:listSnippets', 'db:upsertSnippet', 'db:deleteSnippet',
  'asr:status', 'app:processText',
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

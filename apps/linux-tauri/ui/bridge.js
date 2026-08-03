'use strict';

// The same small, explicit IPC surface the Electron renderers get from
// preload.js, backed by Tauri commands and events instead of ipcRenderer.
// Keeping the channel names identical is what lets the Linux app run the very
// same scene code as the Windows app.

const T = window.__TAURI__;
const core = T && T.core;
const events = T && T.event;

// channel -> [command, argument builder]
const INVOKE = {
  'db:getSettings': ['db_get_settings'],
  'db:setSetting': ['db_set_setting', (d) => ({ key: d.key, value: String(d.value) })],
  'db:listDictionary': ['db_list_dictionary'],
  'db:upsertDictionary': ['db_upsert_dictionary', (d) => ({ entry: d })],
  'db:deleteDictionary': ['db_delete_dictionary', (id) => ({ id })],
  'db:listSnippets': ['db_list_snippets'],
  'db:upsertSnippet': ['db_upsert_snippet', (d) => ({ snippet: d })],
  'db:deleteSnippet': ['db_delete_snippet', (id) => ({ id })],
  'db:listTranscripts': ['db_list_transcripts', (limit) => ({ limit: limit || 200 })],
  'db:updateTranscript': ['db_update_transcript', (d) => ({ id: d.id, text: d.text })],
  'db:deleteTranscript': ['db_delete_transcript', (id) => ({ id })],
  'db:clearTranscripts': ['db_clear_transcripts'],
  'db:transcriptStats': ['db_transcript_stats'],
  'asr:status': ['asr_status'],
  'ai:status': ['ai_status'],
  'ai:test': ['ai_test'],
  'app:isOnline': ['app_is_online'],
  'app:openSoundSettings': ['app_open_sound_settings'],
  'auth:status': ['auth_status'],
  'auth:signIn': ['auth_sign_in', (d) => ({ mode: d.mode, email: d.email, password: d.password })],
  'auth:signOut': ['auth_sign_out'],
  'mic:status': ['mic_status'],
  'mic:list': ['mic_list'],
  'mic:previewStart': ['mic_preview_start', (ids) => ({ deviceIds: ids || [] })],
  'mic:previewStop': ['mic_preview_stop'],
  'mic:verify': ['mic_verify', (id) => ({ deviceId: id || '' })],
  'pill:action': ['pill_action', (action) => ({ action })],
  'pill:savePosition': ['pill_save_position'],
  'alert:dismiss': ['alert_dismiss'],
  'preview:action': ['preview_action', (d) => ({ action: d.action, text: d.text || '' })],
  'preview:resize': ['preview_resize', (d) => ({ height: d.height || 0 })],
  'pipeline:result': ['pipeline_result', (d) => ({ id: d.id, result: d.result })],
  'update:check': ['update_check'],
  'update:download': ['update_download'],
  'update:install': ['update_install'],
};

const ALLOWED_ON = new Set([
  'pill:state', 'pill:level',
  'alert:show',
  'notice:show',
  'preview:show',
  'app:connectivity', 'transcript:new', 'mic:status',
  'mic:levels', 'mic:dead',
  'update:progress',
  'pipeline:request',
]);

window.coldvoice = {
  invoke(channel, data) {
    const entry = INVOKE[channel];
    if (!entry) return Promise.reject(new Error(`blocked channel: ${channel}`));
    const [command, build] = entry;
    return core.invoke(command, build ? build(data) : undefined);
  },
  // Fire and forget, so scene code written against the Electron bridge keeps
  // working unchanged.
  send(channel, data) {
    if (!INVOKE[channel]) return;
    this.invoke(channel, data).catch(() => {});
  },
  on(channel, cb) {
    if (!ALLOWED_ON.has(channel)) return;
    events.listen(channel, (e) => cb(e.payload));
  },
  window: T && T.window,
};

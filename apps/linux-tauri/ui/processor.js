'use strict';

// The hidden processor window. It exists for one reason: to run the SHARED
// JavaScript logic — packages/shared/text-processing and
// packages/shared/input-detection — so the Linux build cleans text and gates
// insertion with the exact same code as the Windows build, not a re-implementation
// that would quietly drift.
//
// This mirrors the hidden recorder window the Electron app already runs. Rust
// emits pipeline:request, this answers with pipeline:result. Every request is
// bounded by a timeout on the Rust side, so a failure here degrades to the raw
// transcript instead of losing a dictation.

const cv = window.coldvoice;
const shared = window.ColdVoiceShared || {};
const tp = shared.textProcessing || {};
const detection = shared.inputDetection || {};

function reply(id, result) {
  cv.invoke('pipeline:result', { id, result }).catch(() => {});
}

function run(op, payload) {
  if (op === 'process') {
    return tp.process(payload.text || '', payload.options || {});
  }
  if (op === 'userRules') {
    // The cloud path already had the LLM fix grammar and formatting, so only the
    // user's own exact rules are applied on top — same order as on Windows.
    const options = payload.options || {};
    let text = tp.convertSpokenPunctuation(payload.text || '');
    text = tp.applyDictionary(text, options.dictionary || []);
    text = tp.expandSnippets(text, options.snippets || []);
    return text.trim();
  }
  if (op === 'canInsert') {
    return !!detection.canInsertInto(payload || {});
  }
  return null;
}

cv.on('pipeline:request', (request) => {
  if (!request || typeof request.id !== 'number') return;
  let result = null;
  try {
    result = run(request.op, request.payload || {});
  } catch (e) {
    result = null;
  }
  reply(request.id, result);
});

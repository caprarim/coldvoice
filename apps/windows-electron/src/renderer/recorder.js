'use strict';

// Hidden recorder renderer. Captures the mic, buffers Float32 chunks while
// recording, and on stop downsamples to 16 kHz mono PCM16 and sends the bytes to
// the main process. It also streams a live RMS level so the pill can draw a
// reactive waveform. The recorder window runs with backgroundThrottling:false
// (set in main.js) so ScriptProcessor callbacks keep firing while hidden — the
// previous throttling produced empty audio, which whisper hallucinated as "you".

const TARGET_RATE = 16000;
// Voice-activity segmentation. We flush a segment after a short pause (so words
// aren't cut mid-syllable) but force a flush once it gets long. Each flushed
// segment is transcribed in the background while recording continues — so when
// the user stops, only the final tail is left to process.
// The speech threshold is adaptive: a fixed level (the old 0.01) treated quiet
// far-from-mic speech as silence, so segments were flushed mid-word and the
// transcript came out jumbled. We track the ambient noise floor and count
// anything meaningfully above it as speech.
const VOICE_RMS_MIN = 0.003;   // absolute floor for the speech threshold
const NOISE_FLOOR_MAX = 0.02;  // never let the tracked floor climb past this
const SEGMENT_MIN_MS = 1500;   // never flush a segment shorter than this
const SEGMENT_MAX_MS = 7000;   // force a flush past this length
const SEGMENT_HARD_MS = 12000;
const SILENCE_HOLD_MS = 450;   // trailing silence that ends a segment
const SILENCE_DIP_MS = 150;
const BUFFER_HARD_MS = 120000;
const QUIET_RMS = 0.015;
const QUIET_MIN_VOICED_MS = 2500;
const LOUD_RMS = 0.35;
const LOUD_HOLD_MS = 600;
const CLIP_SAMPLE = 0.98;
const CLIP_FRACTION = 0.003;

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let processor = null;
let recording = false;
let paused = false;    // dictation held: mic frames are dropped, buffers kept
let pending = [];      // Float32 buffers captured since the last flush
let segSamples = 0;    // samples accumulated in the pending segment
let lastVoiceAt = 0;   // last time speech was heard (for pause detection)
let inputRate = 48000;
let lastLevelSent = 0;
let setupInFlight = null;
let noiseFloor = 0.001;  // running estimate of ambient (non-speech) level
let segmentEnabled = true;
let levelLoudSent = false;
let levelQuietSent = false;
let clipCount = 0;
let clipWindow = 0;
let hotMs = 0;
let voicedMs = 0;
let voicedQuietMs = 0;
let voicedMaxRms = 0;
let currentLabel = '';
let lastMicCount = -1;
let lastDefaultLabel = '';
let deviceChangeTimer = null;
let reconnectTimer = null;
let reconnectDelayMs = 600;
let mediaRecorder = null;
let opusChunks = [];

// Retry capture with backoff after a disconnect or failed setup. devicechange
// usually re-triggers setup, but a flaky USB mic doesn't always fire it — the
// timer guarantees we keep trying until the mic (or another one) comes back.
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    setup().catch(() => {
      reconnectDelayMs = Math.min(8000, reconnectDelayMs * 2);
      scheduleReconnect();
    });
  }, reconnectDelayMs);
}

function sendMicStatus(payload) {
  window.coldvoice.send('recorder:micStatus', payload);
}

async function micInputs() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

async function refreshDeviceSnapshot() {
  const inputs = await micInputs();
  // Windows often only exposes "default" / "communications" until labels
  // populate. Counting only physical deviceIds caused false "no mic" events.
  const physical = inputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
  lastMicCount = physical.length > 0 ? physical.length : (inputs.length > 0 ? 1 : 0);
  const def = inputs.find((d) => d.deviceId === 'default');
  lastDefaultLabel = def ? def.label : '';
  return inputs;
}

function closeAudio() {
  recording = false;
  paused = false;
  try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch { /* ignore */ }
  mediaRecorder = null;
  try { if (processor) processor.disconnect(); } catch { /* ignore */ }
  try { if (sourceNode) sourceNode.disconnect(); } catch { /* ignore */ }
  try { if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop()); } catch { /* ignore */ }
  try { if (audioCtx) audioCtx.close(); } catch { /* ignore */ }
  audioCtx = null;
  mediaStream = null;
  sourceNode = null;
  processor = null;
}

async function getAudioConstraints() {
  let settings = {};
  try { settings = await window.coldvoice.invoke('db:getSettings'); } catch { settings = {}; }
  const deviceId = settings['dictation.microphoneDeviceId'] || '';
  const base = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) base.deviceId = { exact: deviceId };
  return { audio: base };
}

async function setup() {
  if (setupInFlight) return setupInFlight;
  setupInFlight = setupInner().finally(() => { setupInFlight = null; });
  return setupInFlight;
}

async function setupInner() {
  try {
    closeAudio();
    const constraints = await getAudioConstraints();
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (micErr) {
      if (constraints.audio && constraints.audio.deviceId) {
        delete constraints.audio.deviceId;
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } else {
        throw micErr;
      }
    }
    const track = mediaStream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') throw new Error('Microphone did not start.');
    const prevLabel = currentLabel;
    currentLabel = track.label || '';
    track.onended = () => {
      sendMicStatus({ event: 'disconnected', label: currentLabel });
      if (recording) stop();
      closeAudio();
      scheduleReconnect();
    };
    await refreshDeviceSnapshot();
    if (prevLabel && currentLabel && prevLabel !== currentLabel) {
      sendMicStatus({ event: 'switched', label: currentLabel });
    } else {
      sendMicStatus({ event: 'ready', label: currentLabel });
    }
    // Prefer a 16 kHz context so no resampling is needed; fall back to default.
    try {
      audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      audioCtx = new AudioContext();
    }
    inputRate = audioCtx.sampleRate;
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!recording || paused) return;
      const input = e.inputBuffer.getChannelData(0);
      pending.push(new Float32Array(input));
      segSamples += input.length;
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const now = Date.now();
      // Track the noise floor: follow drops quickly, climb slowly so speech
      // doesn't drag it up. Speech = meaningfully above the floor.
      if (rms < noiseFloor) noiseFloor = noiseFloor * 0.8 + rms * 0.2;
      else noiseFloor = Math.min(NOISE_FLOOR_MAX, noiseFloor * 0.995 + rms * 0.005);
      const voiceThreshold = Math.max(VOICE_RMS_MIN, noiseFloor * 2.5);
      if (rms >= voiceThreshold) lastVoiceAt = now;
      const bufMs = (input.length / inputRate) * 1000;
      let clipped = 0;
      for (let i = 0; i < input.length; i++) {
        if (Math.abs(input[i]) >= CLIP_SAMPLE) clipped++;
      }
      clipCount += clipped;
      clipWindow += input.length;
      if (rms >= LOUD_RMS) hotMs += bufMs;
      else hotMs = Math.max(0, hotMs - bufMs);
      if (rms >= voiceThreshold) {
        voicedMs += bufMs;
        if (rms > voicedMaxRms) voicedMaxRms = rms;
        if (rms < QUIET_RMS) voicedQuietMs += bufMs;
      }
      if (clipWindow >= inputRate) {
        const clipFrac = clipCount / clipWindow;
        if (!levelLoudSent && (clipFrac >= CLIP_FRACTION || hotMs >= LOUD_HOLD_MS)) {
          levelLoudSent = true;
          sendMicStatus({ event: 'tooLoud' });
        }
        if (!levelQuietSent && !levelLoudSent && voicedMs >= QUIET_MIN_VOICED_MS
            && voicedMaxRms < QUIET_RMS * 1.3 && voicedQuietMs / voicedMs > 0.9) {
          levelQuietSent = true;
          sendMicStatus({ event: 'tooQuiet' });
        }
        clipCount = 0;
        clipWindow = 0;
      }
      // Stream a coarse level (~25 fps) for the live waveform. The curve is
      // compressed so quiet far-from-mic speech still visibly registers.
      if (now - lastLevelSent > 40) {
        lastLevelSent = now;
        window.coldvoice.send('recorder:level', { level: Math.min(1, Math.pow(rms * 8, 0.7)) });
      }
      // Flush at a natural pause, or once the segment gets long.
      const segMs = (segSamples / inputRate) * 1000;
      const silenceMs = now - lastVoiceAt;
      if (segmentEnabled) {
        if (segMs >= SEGMENT_HARD_MS
            || (segMs >= SEGMENT_MIN_MS && silenceMs >= SILENCE_HOLD_MS)
            || (segMs >= SEGMENT_MAX_MS && silenceMs >= SILENCE_DIP_MS)) {
          flushSegment();
        }
      } else if (segMs >= BUFFER_HARD_MS) {
        flushSegment();
      }
    };
    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelayMs = 600;
    window.coldvoice.send('recorder:ready');
  } catch (err) {
    closeAudio();
    await refreshDeviceSnapshot();
    sendMicStatus({ event: 'setup-failed', hasMic: lastMicCount > 0 });
    window.coldvoice.send('recorder:error', { message: String(err && err.message ? err.message : err) });
    scheduleReconnect();
    throw err;
  }
}

function downsample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(float32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += float32[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function rmsOf(float32) {
  if (!float32.length) return 0;
  let sum = 0;
  for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
  return Math.sqrt(sum / float32.length);
}

function concat(buffers) {
  let len = 0;
  for (const b of buffers) len += b.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const b of buffers) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

// Trim leading/trailing sub-threshold audio from a segment, keeping a little
// padding so words are never clipped. Whisper hallucinates phrases like
// "Thank you." on silence, and every segment ends with the silence that
// triggered its flush (or, for the final tail, everything up to the moment the
// user released the hotkey) — which normalizeQuiet below can then amplify into
// a strong-looking "signal". Returns null when no frame reaches the threshold.
const TRIM_FRAME_MS = 20;
const TRIM_PAD_MS = 250;
function trimSilence(float32, rate, threshold) {
  const frame = Math.max(1, Math.round((rate * TRIM_FRAME_MS) / 1000));
  const frames = Math.floor(float32.length / frame);
  let first = -1;
  let last = -1;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * frame;
    for (let i = start; i < start + frame; i++) sum += float32[i] * float32[i];
    if (Math.sqrt(sum / frame) >= threshold) {
      if (first < 0) first = f;
      last = f;
    }
  }
  if (first < 0) return null;
  const pad = Math.round((rate * TRIM_PAD_MS) / 1000);
  const from = Math.max(0, first * frame - pad);
  const to = Math.min(float32.length, (last + 1) * frame + pad);
  return float32.subarray(from, to);
}

// Peak-normalize quiet speech so whisper gets a strong signal even when the
// user is far from the mic. Gain is capped so noise-only audio is not blown up
// into something whisper hallucinates on, and loud audio is left untouched.
function normalizeQuiet(float32, rms) {
  if (rms < 0.0015) return float32; // effectively silence — don't amplify noise
  let peak = 0;
  for (let i = 0; i < float32.length; i++) {
    const a = Math.abs(float32[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-6) return float32;
  const gain = Math.min(12, 0.9 / peak);
  if (gain <= 1.05) return float32; // already loud enough
  const out = new Float32Array(float32.length);
  for (let i = 0; i < float32.length; i++) out[i] = float32[i] * gain;
  return out;
}

// Downsample the pending segment to 16 kHz PCM16 and ship it to the main process
// for background transcription. Resets the pending buffer. The reported rms is
// the ORIGINAL (pre-normalization) level so the main process can still reject
// true silence.
function flushSegment() {
  if (!pending.length) return;
  const merged = concat(pending);
  pending = [];
  segSamples = 0;
  const down = downsample(merged, inputRate, TARGET_RATE);
  // Cut the silence off both ends (same adaptive threshold as pause detection)
  // so whisper never sees a normalized noise tail to hallucinate "Thank you" on.
  // A fully-silent segment is still shipped with its true (near-zero) rms so the
  // main process rejects it.
  const voiceThreshold = Math.max(VOICE_RMS_MIN, noiseFloor * 2.5);
  const trimmed = trimSilence(down, TARGET_RATE, voiceThreshold);
  const voiced = trimmed || down;
  const rms = rmsOf(voiced);
  const pcm16 = floatToPcm16(normalizeQuiet(voiced, rms));
  window.coldvoice.send('recorder:partial', {
    pcm: pcm16.buffer,
    sampleRate: TARGET_RATE,
    samples: voiced.length,
    rms: trimmed ? rms : rmsOf(down),
  });
}

async function start(opts) {
  segmentEnabled = !(opts && opts.segment === false);
  levelLoudSent = false;
  levelQuietSent = false;
  clipCount = 0;
  clipWindow = 0;
  hotMs = 0;
  voicedMs = 0;
  voicedQuietMs = 0;
  voicedMaxRms = 0;
  if (!audioCtx || !mediaStream || !mediaStream.getAudioTracks().some((track) => track.readyState === 'live')) {
    try {
      await setup();
    } catch (err) {
      window.coldvoice.send('recorder:error', {
        message: String(err && err.message ? err.message : err),
      });
      return;
    }
  }
  if (audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch { /* ignore */ }
  }
  pending = [];
  segSamples = 0;
  lastVoiceAt = Date.now();
  recording = true;
  paused = false;
  if (!segmentEnabled && mediaStream) {
    try {
      opusChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 32000,
      });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size) opusChunks.push(e.data);
      };
      mediaRecorder.start(1000);
    } catch {
      mediaRecorder = null;
      opusChunks = [];
    }
  }
}

// Hold the dictation without ending it: mic frames are dropped while paused,
// but everything captured so far stays buffered, so resuming continues the same
// transcript from exactly where the user left off. The Opus recorder (cloud
// path) is paused too, so its stream also stitches back together with no gap.
function pause() {
  if (!recording || paused) return;
  paused = true;
  try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause(); } catch { /* ignore */ }
  window.coldvoice.send('recorder:level', { level: 0 });
}

function resume() {
  if (!recording || !paused) return;
  paused = false;
  // The pause looks like a long silence to the segmenter; restart the clock so
  // it doesn't immediately flush the buffered speech mid-word.
  lastVoiceAt = Date.now();
  try { if (mediaRecorder && mediaRecorder.state === 'paused') mediaRecorder.resume(); } catch { /* ignore */ }
}

function finishOpus() {
  return new Promise((resolve) => {
    const rec = mediaRecorder;
    mediaRecorder = null;
    if (!rec || rec.state === 'inactive') return resolve(null);
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      try {
        const blob = new Blob(opusChunks, { type: 'audio/webm' });
        opusChunks = [];
        resolve(blob.size > 200 ? await blob.arrayBuffer() : null);
      } catch {
        resolve(null);
      }
    };
    const timer = setTimeout(finish, 1500);
    rec.onstop = () => {
      clearTimeout(timer);
      finish();
    };
    try {
      rec.stop();
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

function stop() {
  recording = false;
  paused = false;
  flushSegment();               // send the final tail segment, if any
  finishOpus().then((opus) => {
    window.coldvoice.send('recorder:done', opus ? { opus } : {});
  });
}

navigator.mediaDevices.addEventListener('devicechange', () => {
  if (deviceChangeTimer) clearTimeout(deviceChangeTimer);
  deviceChangeTimer = setTimeout(async () => {
    deviceChangeTimer = null;
    const prevDefault = lastDefaultLabel;
    const inputs = await refreshDeviceSnapshot();
    const live = mediaStream && mediaStream.getAudioTracks().some((t) => t.readyState === 'live');
    // Only report disconnect when no devices are listed AND capture is dead.
    // A transient empty enumerateDevices() while a track is still live used to
    // flash "No microphone" and block dictation.
    if (!lastMicCount && !live) {
      sendMicStatus({ event: 'disconnected', label: currentLabel });
      return;
    }
    if (!live) {
      setup().catch(() => {});
      return;
    }
    let settings = {};
    try { settings = await window.coldvoice.invoke('db:getSettings'); } catch { settings = {}; }
    const pinned = settings['dictation.microphoneDeviceId'] || '';
    if (pinned) {
      // The user's chosen mic came back while we were running on a fallback
      // device — move back to it. Never yank the stream mid-dictation; the
      // next devicechange or session restart will pick it up.
      const track = mediaStream.getAudioTracks()[0];
      const usingId = track && track.getSettings ? (track.getSettings().deviceId || '') : '';
      const pinnedPresent = inputs.some((d) => d.deviceId === pinned);
      if (!recording && pinnedPresent && usingId && usingId !== pinned) {
        closeAudio();
        setup().catch(() => {});
      }
      return;
    }
    if (prevDefault && lastDefaultLabel && prevDefault !== lastDefaultLabel) {
      if (recording) {
        sendMicStatus({ event: 'switched', label: lastDefaultLabel.replace(/^Default - /, '') });
      } else {
        closeAudio();
        setup().catch(() => {});
      }
    }
  }, 300);
});

window.coldvoice.on('recorder:start', start);
window.coldvoice.on('recorder:stop', stop);
window.coldvoice.on('recorder:pause', pause);
window.coldvoice.on('recorder:resume', resume);
window.coldvoice.on('recorder:refresh', () => {
  const wasRecording = recording;
  closeAudio();
  setup().then(() => {
    if (wasRecording) start({ segment: segmentEnabled });
  }).catch(() => {});
});

setup();

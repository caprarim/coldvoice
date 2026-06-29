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
const VOICE_RMS = 0.01;        // per-buffer level that counts as speech
const SEGMENT_MIN_MS = 1500;   // never flush a segment shorter than this
const SEGMENT_MAX_MS = 7000;   // force a flush past this length
const SILENCE_HOLD_MS = 450;   // trailing silence that ends a segment

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let processor = null;
let recording = false;
let pending = [];      // Float32 buffers captured since the last flush
let segSamples = 0;    // samples accumulated in the pending segment
let lastVoiceAt = 0;   // last time speech was heard (for pause detection)
let inputRate = 48000;
let lastLevelSent = 0;
let setupInFlight = null;

function closeAudio() {
  recording = false;
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
    track.onended = () => {
      if (recording) {
        window.coldvoice.send('recorder:error', { message: 'Microphone stopped. Restarting capture.' });
        setup().then(() => start()).catch((err) => {
          window.coldvoice.send('recorder:error', { message: String(err && err.message ? err.message : err) });
        });
      }
    };
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
      if (!recording) return;
      const input = e.inputBuffer.getChannelData(0);
      pending.push(new Float32Array(input));
      segSamples += input.length;
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const now = Date.now();
      if (rms >= VOICE_RMS) lastVoiceAt = now;
      // Stream a coarse level (~25 fps) for the live waveform.
      if (now - lastLevelSent > 40) {
        lastLevelSent = now;
        window.coldvoice.send('recorder:level', { level: Math.min(1, rms * 6) });
      }
      // Flush at a natural pause, or once the segment gets long.
      const segMs = (segSamples / inputRate) * 1000;
      const silenceMs = now - lastVoiceAt;
      if (segMs >= SEGMENT_MAX_MS || (segMs >= SEGMENT_MIN_MS && silenceMs >= SILENCE_HOLD_MS)) {
        flushSegment();
      }
    };
    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);
    window.coldvoice.send('recorder:ready');
  } catch (err) {
    closeAudio();
    window.coldvoice.send('recorder:error', { message: String(err && err.message ? err.message : err) });
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

// Downsample the pending segment to 16 kHz PCM16 and ship it to the main process
// for background transcription. Resets the pending buffer.
function flushSegment() {
  if (!pending.length) return;
  const merged = concat(pending);
  pending = [];
  segSamples = 0;
  const down = downsample(merged, inputRate, TARGET_RATE);
  const pcm16 = floatToPcm16(down);
  const rms = rmsOf(down);
  window.coldvoice.send('recorder:partial', {
    pcm: pcm16.buffer,
    sampleRate: TARGET_RATE,
    samples: down.length,
    rms,
  });
}

async function start() {
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
}

function stop() {
  if (!recording && !pending.length) return;
  recording = false;
  flushSegment();               // send the final tail segment, if any
  window.coldvoice.send('recorder:done', {});
}

window.coldvoice.on('recorder:start', start);
window.coldvoice.on('recorder:stop', stop);
window.coldvoice.on('recorder:refresh', () => {
  const wasRecording = recording;
  closeAudio();
  setup().then(() => {
    if (wasRecording) start();
  }).catch(() => {});
});

setup();

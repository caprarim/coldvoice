'use strict';

// Hidden recorder renderer. Captures the mic at the device rate, buffers Float32
// chunks while recording, and on stop downsamples to 16 kHz mono PCM16 and sends
// the bytes to the main process. A simple energy gate marks speech presence.

const TARGET_RATE = 16000;

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let processor = null;
let recording = false;
let chunks = [];
let inputRate = 48000;

async function setup() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    audioCtx = new AudioContext();
    inputRate = audioCtx.sampleRate;
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!recording) return;
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    sourceNode.connect(processor);
    processor.connect(audioCtx.destination);
    window.coldvoice.send('recorder:ready');
  } catch (err) {
    window.coldvoice.send('recorder:error', { message: String(err && err.message ? err.message : err) });
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

function start() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  chunks = [];
  recording = true;
}

function stop() {
  recording = false;
  const merged = concat(chunks);
  chunks = [];
  const down = downsample(merged, inputRate, TARGET_RATE);
  const pcm16 = floatToPcm16(down);
  // Transfer the underlying ArrayBuffer to main.
  window.coldvoice.send('recorder:audio', { pcm: pcm16.buffer, sampleRate: TARGET_RATE });
}

window.coldvoice.on('recorder:start', start);
window.coldvoice.on('recorder:stop', stop);

setup();

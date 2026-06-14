'use strict';

// Offline ASR adapter for Windows using whisper.cpp. It shells out to a local
// whisper-cli executable and reads back the transcript. No cloud service is used.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEV_NATIVE_DIR = path.join(ROOT, 'native', 'asr');
const DEV_MODELS_DIR = path.join(ROOT, 'models');
const PACKAGED_NATIVE_DIR = path.join(process.resourcesPath || '', 'native', 'asr');
const PACKAGED_MODELS_DIR = path.join(process.resourcesPath || '', 'models');

const MODEL_FILES = {
  'tiny.en': 'ggml-tiny.en.bin',
  'base.en': 'ggml-base.en.bin',
  'small.en': 'ggml-small.en.bin',
};

function dedupe(paths) {
  return paths.filter((p, i) => p && paths.indexOf(p) === i);
}

function nativeDirs() {
  return dedupe([PACKAGED_NATIVE_DIR, DEV_NATIVE_DIR]);
}

function modelDirs() {
  return dedupe([PACKAGED_MODELS_DIR, DEV_MODELS_DIR]);
}

function findBinary() {
  const candidates = ['whisper-cli.exe', 'main.exe', 'whisper.exe'];
  for (const dir of nativeDirs()) {
    for (const c of candidates) {
      const p = path.join(dir, c);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function modelPath(modelName) {
  const file = MODEL_FILES[modelName] || MODEL_FILES['base.en'];
  for (const dir of modelDirs()) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function isReady(modelName = 'base.en') {
  return !!findBinary() && !!modelPath(modelName);
}

function setupMessage(modelName = 'base.en') {
  const file = MODEL_FILES[modelName] || MODEL_FILES['base.en'];
  return (
    'Offline ASR is not set up yet.\n' +
    `1. Put a whisper.cpp build (whisper-cli.exe) in: ${nativeDirs().join(' or ')}\n` +
    `2. Put the model "${file}" in: ${modelDirs().join(' or ')}\n` +
    'No internet is used - everything runs locally.'
  );
}

function toBuffer(pcm16) {
  if (Buffer.isBuffer(pcm16)) return pcm16;
  if (ArrayBuffer.isView(pcm16)) {
    return Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  }
  return Buffer.from(pcm16);
}

function writeWav(pcm16, sampleRate = 16000) {
  const data = toBuffer(pcm16);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  const file = path.join(os.tmpdir(), `coldvoice-${Date.now()}.wav`);
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}

function runWhisper(wavFile, modelName) {
  return new Promise((resolve, reject) => {
    const bin = findBinary();
    const model = modelPath(modelName);
    if (!bin || !model) return reject(new Error(setupMessage(modelName)));
    const args = ['-m', model, '-f', wavFile, '-nt', '-otxt', '-of', wavFile];
    execFile(bin, args, { timeout: 120000 }, (err) => {
      if (err) return reject(err);
      const txtFile = `${wavFile}.txt`;
      try {
        const text = stripNonSpeech(fs.readFileSync(txtFile, 'utf8'));
        cleanup([wavFile, txtFile]);
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function stripNonSpeech(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\[[^\]]*\]/g, '').replace(/\((?:blank_audio|silence|inaudible|music|pause|noise)\)/gi, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function cleanup(files) {
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

async function transcribe(pcm16, modelName = 'base.en', sampleRate = 16000) {
  const wav = writeWav(pcm16, sampleRate);
  try {
    return await runWhisper(wav, modelName);
  } finally {
    cleanup([wav]);
  }
}

module.exports = {
  transcribe,
  isReady,
  setupMessage,
  get MODELS_DIR() { return modelDirs()[0]; },
  get NATIVE_DIR() { return nativeDirs()[0]; },
  modelDirs,
  nativeDirs,
};

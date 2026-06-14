'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const src = path.join(root, 'public', 'src');
const dist = path.join(root, 'dist');
const installerName = 'ColdVoice-Setup-0.0.1.exe';
const installerSource = path.resolve(root, '..', 'windows-electron', 'dist', installerName);
const downloadsDir = path.join(dist, 'downloads');

function copy(file) {
  fs.copyFileSync(path.join(src, file), path.join(dist, file));
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of ['index.html', 'login.html', 'signup.html', 'styles.css', 'app.js', 'auth.js']) {
  copy(file);
}

const downloadUrl = process.env.COLDVOICE_DOWNLOAD_URL || `/downloads/${installerName}`;
const config = {
  supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  downloadUrl,
  version: '0.0.1',
};

fs.writeFileSync(
  path.join(dist, 'config.js'),
  `window.COLDVOICE_CONFIG = ${JSON.stringify(config, null, 2)};\n`
);

if (downloadUrl.startsWith('/downloads/') && fs.existsSync(installerSource)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.copyFileSync(installerSource, path.join(downloadsDir, installerName));
}

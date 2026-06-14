'use strict';

const config = window.COLDVOICE_CONFIG || {};
const downloadUrl = config.downloadUrl || './downloads/ColdVoice-Setup-0.0.1.exe';

for (const link of document.querySelectorAll('[data-download-link]')) {
  link.setAttribute('href', downloadUrl);
}

const statusEl = document.querySelector('[data-download-status]');
if (statusEl) {
  fetch(downloadUrl, { method: 'HEAD' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      const size = len ? ` (${Math.round(len / 1024 / 1024)} MB)` : '';
      statusEl.textContent = `Windows installer ready${size}.`;
      statusEl.classList.add('ok');
    })
    .catch(() => {
      statusEl.textContent = 'Installer link is configured; build or release upload still needs to provide the .exe.';
      statusEl.classList.add('warn');
    });
}

'use strict';

const config = window.COLDVOICE_CONFIG || {};
const downloadUrl = config.downloadUrl || './downloads/ColdVoice-Setup-0.0.1.exe';
const androidUrl = config.androidDownloadUrl || './downloads/ColdVoice.apk';

for (const link of document.querySelectorAll('[data-download-link]')) {
  link.setAttribute('href', downloadUrl);
}
for (const link of document.querySelectorAll('[data-android-link]')) {
  link.setAttribute('href', androidUrl);
}

// --- download status -------------------------------------------------------
const statusEl = document.querySelector('[data-download-status]');
if (statusEl) {
  const isExternal = /^https?:\/\//i.test(downloadUrl) && !downloadUrl.startsWith(window.location.origin);
  if (isExternal) {
    statusEl.textContent = 'Windows installer ready via release.';
    statusEl.classList.add('ok');
  } else {
    fetch(downloadUrl, { method: 'HEAD' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get('content-length') || 0);
        const size = len ? ` (${Math.round(len / 1024 / 1024)} MB)` : '';
        statusEl.textContent = `Windows + Android builds ready${size}.`;
        statusEl.classList.add('ok');
      })
      .catch(() => {
        statusEl.textContent = 'Download links are configured; the build still needs to upload the installer.';
        statusEl.classList.add('warn');
      });
  }
}

// --- mobile hamburger menu -------------------------------------------------
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
if (hamburger && mobileMenu) {
  const setOpen = (open) => {
    hamburger.classList.toggle('open', open);
    mobileMenu.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  hamburger.addEventListener('click', () => setOpen(!mobileMenu.classList.contains('open')));
  for (const link of mobileMenu.querySelectorAll('a')) {
    link.addEventListener('click', () => setOpen(false));
  }
}

// --- cursor glow on cards --------------------------------------------------
for (const card of document.querySelectorAll('.glow-card')) {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  });
}

// --- faq accordion ---------------------------------------------------------
for (const btn of document.querySelectorAll('.faq-btn')) {
  btn.addEventListener('click', () => {
    const body = btn.nextElementSibling;
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!isOpen));
    body.classList.toggle('open', !isOpen);
  });
}

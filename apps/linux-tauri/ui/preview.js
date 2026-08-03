'use strict';

// Unlike Windows, this overlay is driven by ordinary DOM handlers — there is no
// global mouse poller on Linux.

const cv = window.coldvoice;
const card = document.getElementById('card');
const textEl = document.getElementById('text');
const metaEl = document.getElementById('meta');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');
const openBtn = document.getElementById('open');
const closeBtn = document.getElementById('close');

let text = '';

cv.on('preview:show', (payload) => {
  const p = payload || {};
  text = p.text || '';
  textEl.textContent = text;
  metaEl.textContent = `${p.words || 0} words · click Copy to grab it`;
  copyBtn.classList.remove('done');
  copyLabel.textContent = 'Copy';
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
});

copyBtn.addEventListener('click', () => {
  cv.send('preview:action', { action: 'copy', text });
  copyBtn.classList.add('done');
  copyLabel.textContent = 'Copied';
});
openBtn.addEventListener('click', () => cv.send('preview:action', { action: 'open' }));
closeBtn.addEventListener('click', () => cv.send('preview:action', { action: 'close' }));

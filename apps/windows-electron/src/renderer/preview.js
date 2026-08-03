'use strict';

const card = document.getElementById('card');
const textEl = document.getElementById('text');
const metaEl = document.getElementById('meta');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');

window.coldvoice.on('preview:show', (payload) => {
  const p = payload || {};
  textEl.textContent = p.text || '';
  metaEl.textContent = `${p.words || 0} words · click Copy to grab it`;
  copyBtn.classList.remove('done');
  copyLabel.textContent = 'Copy';
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';
});

window.coldvoice.on('preview:copied', () => {
  copyBtn.classList.add('done');
  copyLabel.textContent = 'Copied';
});

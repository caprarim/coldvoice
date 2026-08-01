'use strict';

const root = document.getElementById('notice');
const titleEl = document.getElementById('title');
const messageEl = document.getElementById('message');

window.coldvoice.on('notice:show', (payload) => {
  const p = payload || {};
  root.dataset.kind = p.kind === 'stopped' ? 'stopped' : 'started';
  titleEl.textContent = p.title || '';
  messageEl.textContent = p.message || '';
  messageEl.style.display = p.message ? '' : 'none';
  root.style.animation = 'none';
  void root.offsetWidth;
  root.style.animation = '';
});

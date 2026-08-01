'use strict';

const cv = window.coldvoice;
const root = document.getElementById('alert');
const title = document.getElementById('title');
const message = document.getElementById('message');

cv.on('alert:show', (data) => {
  if (!data) return;
  root.setAttribute('data-kind', data.kind || 'disconnect');
  title.textContent = data.title || '';
  message.textContent = data.message || '';
});

root.addEventListener('click', () => cv.send('alert:dismiss'));

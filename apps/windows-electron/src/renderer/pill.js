'use strict';

const cv = window.coldvoice;
const center = document.getElementById('center');

function dots() {
  center.className = 'center';
  center.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
}

function message(text, isError) {
  center.className = 'center text' + (isError ? ' error' : '');
  center.textContent = text;
}

document.getElementById('cancel').addEventListener('click', () => cv.send('pill:cancel'));
document.getElementById('confirm').addEventListener('click', () => cv.send('pill:confirm'));

// Esc cancels, Enter confirms (per spec).
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cv.send('pill:cancel');
  if (e.key === 'Enter') cv.send('pill:confirm');
});

cv.on('pill:state', (data) => {
  if (!data) return;
  if (data.state === 'recording') dots();
  else if (data.state === 'transcribing') message('Transcribing…');
  else if (data.state === 'error') message(data.message || 'Error', true);
});

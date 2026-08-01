'use strict';

const cv = window.coldvoice;
const pill = document.getElementById('pill');
const label = document.getElementById('label');
const barEls = Array.from(document.querySelectorAll('#bars span'));

let state = 'recording';
let level = 0;
let raf = 0;

// Per-bar base heights for an organic waveform shape (taller in the middle).
const BASE = barEls.map((_, i) => {
  const mid = (barEls.length - 1) / 2;
  return 1 - Math.abs(i - mid) / (mid + 1.2);
});

function render() {
  if (state === 'recording') {
    const t = Date.now() / 120;
    for (let i = 0; i < barEls.length; i++) {
      const wobble = 0.5 + 0.5 * Math.sin(t + i * 0.8);
      const h = 3 + BASE[i] * (3 + level * 12) * (0.55 + 0.45 * wobble);
      barEls[i].style.height = `${Math.min(10, h).toFixed(1)}px`;
    }
    raf = requestAnimationFrame(render);
  }
}

function setState(next) {
  state = next;
  pill.setAttribute('data-state', next);
  cancelAnimationFrame(raf);
  if (next === 'recording') {
    raf = requestAnimationFrame(render);
  } else if (next === 'idle' || next === 'paused') {
    for (const b of barEls) b.style.height = '3px';
  }
}

// Clicks and dragging are handled entirely by the main process (global mouse
// poller + window glue): this window is non-focusable, so DOM mouse events on
// it never fire. Main hit-tests the press against the button zones instead.

cv.on('pill:level', (data) => {
  if (data && typeof data.level === 'number') level = data.level;
});

cv.on('pill:state', (data) => {
  if (!data) return;
  if (data.state === 'recording') { level = 0; setState('recording'); }
  else if (data.state === 'paused') { level = 0; label.textContent = 'Paused'; setState('paused'); }
  else if (data.state === 'transcribing') setState('transcribing');
  else if (data.state === 'idle') setState('idle');
  else if (data.state === 'done') { label.textContent = 'Inserted'; setState('done'); }
  else if (data.state === 'info') { label.textContent = data.message || ''; setState('info'); }
  else if (data.state === 'error') { label.textContent = data.message || 'Error'; setState('error'); }
  else if (data.state === 'nomic') { label.textContent = data.message || 'No microphone'; setState('nomic'); }
});

setState('recording');

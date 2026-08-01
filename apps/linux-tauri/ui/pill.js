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

// On Linux the pill is an ordinary window, so its buttons and dragging are
// driven straight from the DOM — no global mouse poller. Insertion re-activates
// the window that had focus when dictation started, so the pill briefly holding
// focus can never misdirect a dictation.
for (const id of ['cancel', 'pause', 'confirm']) {
  const btn = document.getElementById(id);
  if (!btn) continue;
  btn.addEventListener('mousedown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    cv.invoke('pill:action', id).catch(() => {});
  });
}

// Drag the pill anywhere, resize it from a corner, and remember both.
const appWindow = cv.window && cv.window.getCurrentWindow ? cv.window.getCurrentWindow() : null;
const CORNER = 8;

function cornerAt(e) {
  const dirs = cv.window && cv.window.ResizeDirection;
  if (!dirs) return null;
  const left = e.clientX <= CORNER;
  const right = window.innerWidth - e.clientX <= CORNER;
  const top = e.clientY <= CORNER;
  const bottom = window.innerHeight - e.clientY <= CORNER;
  if (!(left || right) || !(top || bottom)) return null;
  if (top && left) return dirs.NorthWest;
  if (top && right) return dirs.NorthEast;
  if (bottom && left) return dirs.SouthWest;
  return dirs.SouthEast;
}

pill.addEventListener('mousedown', async (e) => {
  if (e.button !== 0 || !appWindow) return;
  try {
    const dir = cornerAt(e);
    if (dir != null && appWindow.startResizeDragging) await appWindow.startResizeDragging(dir);
    else await appWindow.startDragging();
  } catch { /* ignore */ }
});

// startDragging / startResizeDragging hand the pointer to the window manager, so
// the only reliable moment to persist the layout is once the pointer is back.
window.addEventListener('mouseup', () => {
  setTimeout(() => {
    const scale = window.innerWidth ? window.innerWidth / 138 : 1;
    cv.invoke('pill:savePosition', { scale }).catch(() => {});
  }, 120);
});

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

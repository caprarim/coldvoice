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
// Grips track the pill's size the way the Windows build does, so a bigger pill
// still leaves most of its body as drag surface instead of resize edges.
function gripX() { return Math.max(6, Math.round(window.innerWidth * 0.1)); }
function gripY() { return Math.min(gripX(), Math.max(4, Math.round(window.innerHeight * 0.3))); }

function cornerAt(e) {
  const dirs = cv.window && cv.window.ResizeDirection;
  if (!dirs) return null;
  const gx = gripX();
  const gy = gripY();
  const left = e.clientX <= gx;
  const right = window.innerWidth - e.clientX <= gx;
  const top = e.clientY <= gy;
  const bottom = window.innerHeight - e.clientY <= gy;
  if (!(left || right) || !(top || bottom)) return null;
  if (top && left) return dirs.NorthWest;
  if (top && right) return dirs.NorthEast;
  if (bottom && left) return dirs.SouthWest;
  return dirs.SouthEast;
}

// Some window managers ignore the _NET_WM_MOVERESIZE request behind
// startDragging, which left the pill stuck in place. When that happens the
// pointer is tracked here and the window is moved directly instead.
let manual = null;

function manualBegin(e) {
  if (!appWindow || !appWindow.outerPosition || !appWindow.setPosition) return;
  Promise.all([appWindow.outerPosition(), appWindow.scaleFactor()])
    .then(([pos, scale]) => {
      manual = {
        screenX: e.screenX,
        screenY: e.screenY,
        x: pos.x / scale,
        y: pos.y / scale,
      };
    })
    .catch(() => { manual = null; });
}

window.addEventListener('mousemove', (e) => {
  if (!manual) return;
  const x = manual.x + (e.screenX - manual.screenX);
  const y = manual.y + (e.screenY - manual.screenY);
  const Logical = cv.dpi && cv.dpi.LogicalPosition;
  const next = Logical ? new Logical(x, y) : { type: 'Logical', x, y };
  appWindow.setPosition(next).catch(() => {});
});

window.addEventListener('mouseup', () => { manual = null; });

pill.addEventListener('mousedown', async (e) => {
  if (e.button !== 0 || !appWindow) return;
  const dir = cornerAt(e);
  try {
    if (dir != null && appWindow.startResizeDragging) await appWindow.startResizeDragging(dir);
    else await appWindow.startDragging();
  } catch {
    if (dir == null) manualBegin(e);
  }
});

// startDragging / startResizeDragging hand the pointer to the window manager, so
// the only reliable moment to persist the layout is once the pointer is back.
window.addEventListener('mouseup', () => {
  setTimeout(() => {
    const scale = window.innerWidth ? window.innerWidth / 138 : 1;
    cv.invoke('pill:savePosition', { scale }).catch(() => {});
  }, 120);
});

cv.on('pill:scale', (data) => {
  const s = data && typeof data.scale === 'number' && data.scale > 0 ? data.scale : 1;
  document.documentElement.style.zoom = String(s);
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

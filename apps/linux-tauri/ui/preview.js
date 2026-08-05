'use strict';

// Unlike Windows, this overlay is driven by ordinary DOM handlers — there is no
// global mouse poller on Linux, and the webview takes focus on its own, so
// editing needs no focusable juggling either.

const cv = window.coldvoice;
const card = document.getElementById('card');
const textEl = document.getElementById('text');
const editorEl = document.getElementById('editor');
const countEl = document.getElementById('count');
const fillEl = document.getElementById('fill');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');
const editBtn = document.getElementById('edit');
const openBtn = document.getElementById('open');
const closeBtn = document.getElementById('close');
const saveBtn = document.getElementById('save');
const cancelBtn = document.getElementById('cancel');

const DISMISS_MS = 5000;
const TICK_MS = 100;

let text = '';
let hold = false;
let timer = null;

// Ask the backend for a card tall enough to show the whole transcript.
function reportHeight() {
  cv.send('preview:resize', { height: textEl.scrollHeight });
}

// Drains the bar in real time. Hovering the card holds it, so the buttons stay
// reachable instead of vanishing mid-click.
function startCountdown() {
  stopCountdown();
  let remaining = DISMISS_MS;
  let last = Date.now();
  fillEl.style.width = '100%';
  timer = setInterval(() => {
    const now = Date.now();
    const delta = now - last;
    last = now;
    if (hold) return;
    remaining = Math.max(0, remaining - delta);
    fillEl.style.width = `${(remaining / DISMISS_MS) * 100}%`;
    if (remaining === 0) {
      stopCountdown();
      cv.send('preview:action', { action: 'close' });
    }
  }, TICK_MS);
}

function stopCountdown() {
  if (timer) { clearInterval(timer); timer = null; }
}

function setMode(mode) {
  card.dataset.mode = mode;
  if (mode === 'edit') {
    stopCountdown();
    editorEl.focus();
    editorEl.setSelectionRange(editorEl.value.length, editorEl.value.length);
  } else {
    requestAnimationFrame(reportHeight);
    startCountdown();
  }
}

cv.on('preview:show', (payload) => {
  const p = payload || {};
  text = p.text || '';
  textEl.textContent = text;
  editorEl.value = text;
  countEl.textContent = `${p.words || 0} words`;
  copyBtn.classList.remove('done');
  copyLabel.textContent = 'Copy';
  textEl.scrollTop = 0;
  hold = false;
  card.dataset.mode = 'view';
  requestAnimationFrame(reportHeight);
  startCountdown();
});

card.addEventListener('mouseenter', () => { hold = true; });
card.addEventListener('mouseleave', () => { hold = false; });

copyBtn.addEventListener('click', () => {
  cv.send('preview:action', { action: 'copy', text });
  copyBtn.classList.add('done');
  copyLabel.textContent = 'Copied';
});
editBtn.addEventListener('click', () => setMode('edit'));
openBtn.addEventListener('click', () => cv.send('preview:action', { action: 'open' }));
closeBtn.addEventListener('click', () => cv.send('preview:action', { action: 'close' }));

function save() {
  const next = editorEl.value.trim();
  if (!next) return;
  text = next;
  textEl.textContent = next;
  countEl.textContent = `${next.split(/\s+/).filter(Boolean).length} words`;
  cv.send('preview:action', { action: 'save', text: next });
  setMode('view');
}

saveBtn.addEventListener('click', save);
cancelBtn.addEventListener('click', () => { editorEl.value = text; setMode('view'); });

editorEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { editorEl.value = text; setMode('view'); }
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
});

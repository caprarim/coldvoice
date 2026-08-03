'use strict';

const cv = window.coldvoice;
const card = document.getElementById('card');
const textEl = document.getElementById('text');
const editorEl = document.getElementById('editor');
const countEl = document.getElementById('count');
const fillEl = document.getElementById('fill');
const copyBtn = document.getElementById('copy');
const copyLabel = document.getElementById('copy-label');
const saveBtn = document.getElementById('save');
const cancelBtn = document.getElementById('cancel');

// Ask main for a card tall enough to show the whole transcript. Measuring the
// laid-out block is the only way to know: the text wraps at the card's width.
function reportHeight() {
  cv.send('preview:resize', { height: textEl.scrollHeight });
}

cv.on('preview:show', (payload) => {
  const p = payload || {};
  textEl.textContent = p.text || '';
  editorEl.value = p.text || '';
  countEl.textContent = `${p.words || 0} words`;
  copyBtn.classList.remove('done');
  copyLabel.textContent = 'Copy';
  textEl.scrollTop = 0;
  requestAnimationFrame(reportHeight);
});

cv.on('preview:tick', (payload) => {
  const p = payload || {};
  const total = p.total || 1;
  fillEl.style.width = `${Math.max(0, Math.min(100, (p.remaining / total) * 100))}%`;
});

cv.on('preview:copied', () => {
  copyBtn.classList.add('done');
  copyLabel.textContent = 'Copied';
});

// Edit mode is the one state where the window is focusable, so these DOM
// handlers fire; in view mode every click is routed through the mouse poller.
cv.on('preview:mode', (payload) => {
  const mode = (payload && payload.mode) === 'edit' ? 'edit' : 'view';
  card.dataset.mode = mode;
  if (mode === 'edit') {
    editorEl.focus();
    editorEl.setSelectionRange(editorEl.value.length, editorEl.value.length);
  } else {
    requestAnimationFrame(reportHeight);
  }
});

saveBtn.addEventListener('click', () => cv.send('preview:save', { text: editorEl.value }));
cancelBtn.addEventListener('click', () => cv.send('preview:cancelEdit'));

editorEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cv.send('preview:cancelEdit');
  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cv.send('preview:save', { text: editorEl.value });
});

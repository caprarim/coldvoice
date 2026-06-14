'use strict';

const cv = window.coldvoice;
const view = document.getElementById('view');

// Tiny DOM helper.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function clear() { view.innerHTML = ''; }

// --- routing ---------------------------------------------------------------
const routes = {};
function navigate(route) {
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.classList.toggle('active', b.dataset.route === route)
  );
  clear();
  (routes[route] || routes.home)();
}

document.querySelectorAll('.nav-item').forEach((b) =>
  b.addEventListener('click', () => navigate(b.dataset.route))
);

// --- Home ------------------------------------------------------------------
routes.home = async () => {
  const status = await cv.invoke('asr:status');
  const settings = await cv.invoke('db:getSettings');

  view.appendChild(el('h1', { text: 'Home' }));
  view.appendChild(el('p', { class: 'sub', text: 'Offline voice dictation. Press your shortcut, speak, and ColdVoice inserts cleaned text.' }));

  const statusCard = el('div', { class: 'card' }, [
    el('div', { class: 'row' }, [
      el('div', {}, [
        el('div', { text: 'Offline ASR' }),
        el('div', { class: 'meta', text: `Model: ${status.model}` }),
      ]),
      el('span', {
        class: 'pill-badge ' + (status.ready ? 'badge-ok' : 'badge-bad'),
        text: status.ready ? 'Ready' : 'Setup needed',
      }),
    ]),
    status.ready ? null : el('p', { class: 'mono', style: 'margin-top:10px;color:var(--muted);font-size:12px', text: status.message }),
  ]);
  view.appendChild(statusCard);

  view.appendChild(el('div', { class: 'card' }, [
    el('div', { text: 'Shortcuts' }),
    el('div', { class: 'meta', style: 'margin-top:6px', text:
      `Dictate: ${settings['shortcut.handsFreeHoldToDictate'] || 'Ctrl+1'}   ·   ` +
      `Paste last: ${settings['shortcut.pasteLastTranscript'] || 'Middle Click'} / ${settings['shortcut.pasteLastTranscriptAlt'] || 'Alt+Shift+Z'}   ·   ` +
      `Cancel: ${settings['shortcut.cancel'] || 'Esc'}` }),
  ]));

  // Pipeline tester (no mic needed).
  const input = el('textarea', { placeholder: 'um hello comma world period new line this is great' });
  const out = el('div', { class: 'card mono', style: 'min-height:40px;color:var(--muted)' });
  const runBtn = el('button', { class: 'btn', onclick: async () => {
    out.textContent = await cv.invoke('app:processText', { text: input.value });
  } }, 'Clean text');
  view.appendChild(el('h2', { text: 'Test the cleanup pipeline' }));
  view.appendChild(el('div', { class: 'card' }, [input, el('div', { style: 'margin-top:10px' }, [runBtn])]));
  view.appendChild(out);
};

// --- Snippets --------------------------------------------------------------
routes.snippets = async () => {
  view.appendChild(el('h1', { text: 'Snippets' }));
  view.appendChild(el('p', { class: 'sub', text: 'Trigger phrases that expand into longer text after dictation.' }));

  const form = snippetForm();
  view.appendChild(form.node);

  const list = el('div', { class: 'card' });
  view.appendChild(list);

  async function refresh() {
    list.innerHTML = '';
    const rows = await cv.invoke('db:listSnippets');
    if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: 'No snippets yet.' })); return; }
    for (const s of rows) {
      list.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', { text: s.trigger }),
          el('div', { class: 'meta', text: (s.enabled ? '' : '(disabled) ') + s.expansion }),
        ]),
        el('div', { class: 'actions' }, [
          el('button', { class: 'icon', title: 'Edit', onclick: () => form.load(s) }, '✏'),
          el('button', { class: 'icon', title: 'Delete', onclick: async () => { await cv.invoke('db:deleteSnippet', s.id); refresh(); } }, '🗑'),
        ]),
      ]));
    }
  }
  form.onSaved = refresh;
  refresh();
};

function snippetForm() {
  let editing = null;
  const trigger = el('input', { type: 'text', placeholder: 'my email' });
  const expansion = el('textarea', { placeholder: 'capra.rim6@gmail.com' });
  const enabled = el('input', { type: 'checkbox', checked: true });
  const node = el('div', { class: 'card' }, [
    el('label', { text: 'Trigger phrase' }), trigger,
    el('label', { text: 'Expansion text' }), expansion,
    el('label', { class: 'toggle', style: 'flex-direction:row;align-items:center;margin-top:12px' }, [enabled, document.createTextNode(' Enabled')]),
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', onclick: save }, 'Save snippet'),
      el('button', { class: 'btn secondary', onclick: reset }, 'Clear'),
    ]),
  ]);
  async function save() {
    if (!trigger.value.trim()) return;
    await cv.invoke('db:upsertSnippet', {
      id: editing, trigger: trigger.value.trim(), expansion: expansion.value, enabled: enabled.checked,
    });
    reset();
    api.onSaved && api.onSaved();
  }
  function reset() { editing = null; trigger.value = ''; expansion.value = ''; enabled.checked = true; }
  const api = {
    node,
    load(s) { editing = s.id; trigger.value = s.trigger; expansion.value = s.expansion; enabled.checked = !!s.enabled; trigger.focus(); },
    onSaved: null,
  };
  return api;
}

// --- Dictionary ------------------------------------------------------------
routes.dictionary = async () => {
  view.appendChild(el('h1', { text: 'Dictionary' }));
  view.appendChild(el('p', { class: 'sub', text: 'Fix names and terms. Example: "cold work" -> "ColdWork", "super base" -> "Supabase".' }));

  const form = dictionaryForm();
  view.appendChild(form.node);
  const list = el('div', { class: 'card' });
  view.appendChild(list);

  async function refresh() {
    list.innerHTML = '';
    const rows = await cv.invoke('db:listDictionary');
    if (!rows.length) { list.appendChild(el('div', { class: 'empty', text: 'No entries yet.' })); return; }
    for (const d of rows) {
      list.appendChild(el('div', { class: 'list-row' }, [
        el('div', {}, [
          el('div', { text: `${d.phrase}  →  ${d.replacement || d.phrase}` }),
          el('div', { class: 'meta', text: `${d.type}${d.case_sensitive ? ' · case-sensitive' : ''}${d.enabled ? '' : ' · disabled'}` }),
        ]),
        el('div', { class: 'actions' }, [
          el('button', { class: 'icon', title: 'Edit', onclick: () => form.load(d) }, '✏'),
          el('button', { class: 'icon', title: 'Delete', onclick: async () => { await cv.invoke('db:deleteDictionary', d.id); refresh(); } }, '🗑'),
        ]),
      ]));
    }
  }
  form.onSaved = refresh;
  refresh();
};

function dictionaryForm() {
  let editing = null;
  const type = el('select', {}, [
    el('option', { value: 'replacement' }, 'replacement'),
    el('option', { value: 'vocabulary' }, 'vocabulary'),
    el('option', { value: 'term' }, 'term'),
  ]);
  const phrase = el('input', { type: 'text', placeholder: 'super base' });
  const replacement = el('input', { type: 'text', placeholder: 'Supabase' });
  const aliases = el('input', { type: 'text', placeholder: 'comma,separated,aliases' });
  const caseSensitive = el('input', { type: 'checkbox' });
  const node = el('div', { class: 'card' }, [
    el('label', { text: 'Type' }), type,
    el('label', { text: 'Phrase (what is heard)' }), phrase,
    el('label', { text: 'Replacement (correct form)' }), replacement,
    el('label', { text: 'Aliases (optional)' }), aliases,
    el('label', { class: 'toggle', style: 'flex-direction:row;align-items:center;margin-top:12px' }, [caseSensitive, document.createTextNode(' Case sensitive')]),
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', onclick: save }, 'Save entry'),
      el('button', { class: 'btn secondary', onclick: reset }, 'Clear'),
    ]),
  ]);
  async function save() {
    if (!phrase.value.trim()) return;
    await cv.invoke('db:upsertDictionary', {
      id: editing, type: type.value, phrase: phrase.value.trim(), replacement: replacement.value.trim(),
      aliases: aliases.value.split(',').map((s) => s.trim()).filter(Boolean),
      case_sensitive: caseSensitive.checked, enabled: true,
    });
    reset();
    api.onSaved && api.onSaved();
  }
  function reset() { editing = null; phrase.value = ''; replacement.value = ''; aliases.value = ''; caseSensitive.checked = false; type.value = 'replacement'; }
  const api = {
    node,
    load(d) {
      editing = d.id; type.value = d.type; phrase.value = d.phrase; replacement.value = d.replacement || '';
      aliases.value = (safeParse(d.aliases_json) || []).join(',');
      caseSensitive.checked = !!d.case_sensitive; phrase.focus();
    },
    onSaved: null,
  };
  return api;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return []; } }

// --- Settings --------------------------------------------------------------
routes.settings = async () => {
  const s = await cv.invoke('db:getSettings');
  view.appendChild(el('h1', { text: 'Settings' }));
  view.appendChild(el('p', { class: 'sub', text: 'Shortcuts, dictation behaviour, and privacy.' }));

  // Editable shortcut rows with a pencil/edit button.
  const shortcuts = [
    ['Hands-free mode', 'shortcut.handsFreeHoldToDictate'],
    ['Paste Last Transcript', 'shortcut.pasteLastTranscript'],
    ['Cancel', 'shortcut.cancel'],
  ];
  const scCard = el('div', { class: 'card' });
  scCard.appendChild(el('h2', { text: 'Keyboard shortcuts', style: 'margin-top:0' }));
  for (const [label, key] of shortcuts) scCard.appendChild(shortcutRow(label, key, s[key] || ''));
  view.appendChild(scCard);

  // Dictation mode.
  view.appendChild(el('div', { class: 'card' }, [
    el('h2', { text: 'Dictation', style: 'margin-top:0' }),
    selectRow('Mode', 'dictation.mode', s['dictation.mode'] || 'hold', [
      ['hold', 'Hold-to-dictate'],
      ['toggle', 'Hands-free toggle'],
    ]),
    checkRow('Insert when I release / confirm', 'dictation.insertOnRelease', s['dictation.insertOnRelease'] === '1'),
    selectRow('ASR model', 'asr.model', s['asr.model'] || 'base.en', [
      ['tiny.en', 'tiny.en (fastest)'],
      ['base.en', 'base.en (default)'],
      ['small.en', 'small.en (most accurate)'],
    ]),
  ]));

  // Privacy.
  view.appendChild(el('div', { class: 'card' }, [
    el('h2', { text: 'Privacy', style: 'margin-top:0' }),
    checkRow('Store transcript history', 'privacy.storeTranscripts', s['privacy.storeTranscripts'] === '1'),
    checkRow('Store audio (off by default)', 'privacy.storeAudio', s['privacy.storeAudio'] === '1'),
  ]));
};

function shortcutRow(label, key, value) {
  const keysSpan = el('span', { class: 'keys', text: value || '—' });
  const editBtn = el('button', { class: 'icon', title: 'Edit shortcut' }, '✏');
  editBtn.addEventListener('click', async () => {
    const next = await captureShortcut(keysSpan);
    if (next) { keysSpan.textContent = next; await cv.invoke('db:setSetting', { key, value: next }); }
  });
  return el('div', { class: 'shortcut-row' }, [
    el('div', { text: label }),
    el('div', { class: 'right' }, [keysSpan, editBtn]),
  ]);
}

// Capture the next key combination the user presses.
function captureShortcut(target) {
  return new Promise((resolve) => {
    const prev = target.textContent;
    target.textContent = 'Press keys…';
    function onKey(e) {
      e.preventDefault();
      if (e.key === 'Escape') { cleanup(); resolve('Esc'); return; }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (!['Control', 'Alt', 'Shift'].includes(e.key)) { parts.push(k); cleanup(); resolve(parts.join('+')); }
    }
    function cleanup() { window.removeEventListener('keydown', onKey, true); if (target.textContent === 'Press keys…') target.textContent = prev; }
    window.addEventListener('keydown', onKey, true);
  });
}

function selectRow(label, key, value, options) {
  const sel = el('select', {}, options.map(([v, t]) => el('option', { value: v }, t)));
  sel.value = value;
  sel.addEventListener('change', () => cv.invoke('db:setSetting', { key, value: sel.value }));
  return el('div', { class: 'shortcut-row' }, [el('div', { text: label }), el('div', { class: 'right', style: 'min-width:200px' }, [sel])]);
}

function checkRow(label, key, checked) {
  const box = el('input', { type: 'checkbox', checked });
  box.addEventListener('change', () => cv.invoke('db:setSetting', { key, value: box.checked ? '1' : '0' }));
  return el('div', { class: 'shortcut-row' }, [el('div', { text: label }), el('div', { class: 'right' }, [box])]);
}

navigate('home');

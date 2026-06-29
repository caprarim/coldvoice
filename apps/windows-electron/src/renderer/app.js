'use strict';

const cv = window.coldvoice;
const view = document.getElementById('view');
const modalRoot = document.getElementById('modal-root');

// --- tiny DOM helper -------------------------------------------------------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// --- icons (inline SVG) ----------------------------------------------------
const S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  home: S('<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/>'),
  insights: S('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-4"/><path d="M12 16V8"/><path d="M16 16v-6"/>'),
  dictionary: S('<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z"/><path d="M5 16h13"/>'),
  snippets: S('<path d="M8 4h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8"/><path d="M16 9H4"/><path d="m7 6-3 3 3 3"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/>'),
  copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  trash: S('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/>'),
  edit: S('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M14 6l4 4"/>'),
  search: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  sort: S('<path d="M7 4v16"/><path d="m4 8 3-4 3 4"/><path d="M17 20V4"/><path d="m20 16-3 4-3-4"/>'),
  refresh: S('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  app: S('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/>'),
  mic: S('<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><path d="M12 19v2"/>'),
  account: S('<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
};

// --- routing ---------------------------------------------------------------
const routes = {};
let current = 'home';
function navigate(route) {
  current = routes[route] ? route : 'home';
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === current));
  view.innerHTML = '';
  routes[current]();
}
document.querySelectorAll('.nav-item').forEach((b) => {
  if (b.dataset.icon && ICON[b.dataset.icon]) b.insertAdjacentHTML('afterbegin', ICON[b.dataset.icon]);
  b.addEventListener('click', () => navigate(b.dataset.route));
});

function page(children) {
  const p = el('div', { class: 'page' }, children);
  view.appendChild(p);
  return p;
}
function iconBtn(name, title, onclick) {
  return el('button', { class: 'icon-btn', title, onclick, html: ICON[name] });
}

// --- modal -----------------------------------------------------------------
function openModal({ title, body, submitLabel = 'Save', onSubmit }) {
  const close = () => { modalRoot.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const submit = el('button', { class: 'btn', onclick: async () => { const ok = await onSubmit(); if (ok !== false) close(); } }, submitLabel);
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, [
    el('div', { class: 'modal' }, [
      el('h3', { text: title }),
      body,
      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn ghost', onclick: close }, 'Cancel'),
        submit,
      ]),
    ]),
  ]);
  modalRoot.appendChild(backdrop);
  const first = backdrop.querySelector('input, textarea');
  if (first) first.focus();
}

function toggle(checked, onChange) {
  const input = el('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, [input, el('span', { class: 'slider' })]);
}

// --- date helpers ----------------------------------------------------------
function parseUTC(s) { return new Date(String(s).replace(' ', 'T') + 'Z'); }
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}
function timeLabel(d) { return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(n); }

// --- Home ------------------------------------------------------------------
routes.home = async () => {
  const [items, stats] = await Promise.all([
    cv.invoke('db:listTranscripts', 200),
    cv.invoke('db:transcriptStats'),
  ]);

  const p = page([el('div', { class: 'page-head' }, [el('h1', { text: 'Welcome back' })])]);

  const grid = el('div', { class: 'home-grid' });
  const feed = el('div', {});
  const rail = el('div', { class: 'stat-rail' }, [
    el('div', { class: 'card stat-card' }, [el('div', { class: 'num', text: fmt(stats.totalWords) }), el('div', { class: 'lbl', text: 'total words' })]),
    el('div', { class: 'card stat-card' }, [el('div', { class: 'num', text: String(stats.wpm) }), el('div', { class: 'lbl', text: 'words / minute' })]),
    el('div', { class: 'card stat-card' }, [el('div', { class: 'num', text: String(stats.streak) }), el('div', { class: 'lbl', text: 'day streak' })]),
  ]);
  grid.appendChild(feed);
  grid.appendChild(rail);
  p.appendChild(grid);

  if (!items.length) {
    feed.appendChild(el('div', { class: 'card empty' }, [
      el('div', { class: 'big', text: 'No dictations yet' }),
      el('div', { text: 'Tap Ctrl + 1 to start dictating, or hold Ctrl + CapsLock. What you say lands in the focused app.' }),
    ]));
    return;
  }

  let lastLabel = null;
  let day = null;
  for (const t of items) {
    const d = parseUTC(t.created_at);
    const label = dayLabel(d);
    if (label !== lastLabel) {
      lastLabel = label;
      day = el('div', { class: 'feed-day' }, [el('div', { class: 'feed-day-label', text: label })]);
      feed.appendChild(day);
    }
    const text = t.final_text || t.raw_text || '';
    day.appendChild(el('div', { class: 'dictation' }, [
      el('div', { class: 'time', text: timeLabel(d) }),
      el('div', { class: 'body' }, [
        el('div', { class: 'text', text }),
        el('div', { class: 'meta', text: `${t.word_count || text.split(/\s+/).filter(Boolean).length} words${t.target_app ? ' · ' + t.target_app : ''}` }),
      ]),
      el('div', { class: 'row-actions' }, [
        iconBtn('copy', 'Copy', (e) => { copyText(text); flash(e); }),
        iconBtn('trash', 'Delete', async () => { await cv.invoke('db:deleteTranscript', t.id); navigate('home'); }),
      ]),
    ]));
  }
};

// --- Insights --------------------------------------------------------------
function gauge(value, max) {
  const r = 52, cx = 64, cy = 64;
  const pct = Math.max(0, Math.min(1, value / max));
  const circ = Math.PI * r; // semicircle length
  const dash = `${(circ * pct).toFixed(1)} ${circ.toFixed(1)}`;
  return el('div', { class: 'gauge', html:
    `<svg width="128" height="78" viewBox="0 0 128 78">
       <path d="M12 64 A52 52 0 0 1 116 64" fill="none" stroke="#ece9e1" stroke-width="12" stroke-linecap="round"/>
       <path d="M12 64 A52 52 0 0 1 116 64" fill="none" stroke="#16604f" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash}"/>
       <text x="64" y="56" text-anchor="middle" font-size="22" font-weight="650" fill="#1b1c1f">${value}</text>
       <text x="64" y="72" text-anchor="middle" font-size="10" fill="#6c6f76">WPM</text>
     </svg>` });
}

function heatmap(byDay) {
  const cells = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 181);
  start.setDate(start.getDate() - start.getDay()); // align to Sunday
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const c = byDay[key] || 0;
    const lvl = c === 0 ? '' : c === 1 ? 'l1' : c <= 3 ? 'l2' : c <= 6 ? 'l3' : 'l4';
    cells.push(el('i', { class: lvl, title: `${key}: ${c}` }));
  }
  return el('div', { class: 'heat' }, cells);
}

routes.insights = async () => {
  const stats = await cv.invoke('db:transcriptStats');
  const p = page([
    el('div', { class: 'page-head' }, [el('h1', { text: 'Insights' })]),
    el('div', { class: 'tabs' }, [el('div', { class: 'tab active', text: 'Your Usage' })]),
  ]);

  p.appendChild(el('div', { class: 'metric-grid' }, [
    el('div', { class: 'card metric' }, [
      el('div', { class: 'big', text: String(stats.wpm) }),
      el('div', { class: 'cap', text: 'Words per minute' }),
      gauge(stats.wpm, 180),
    ]),
    el('div', { class: 'card metric' }, [
      el('div', { class: 'big', text: fmt(stats.fixes) }),
      el('div', { class: 'cap', text: 'Fixes made by ColdVoice' }),
      el('div', { class: 'divider' }),
      el('div', { class: 'sub-row' }, [el('span', { text: 'Dictations' }), el('b', { text: String(stats.totalDictations) })]),
      el('div', { class: 'sub-row' }, [el('span', { text: 'Cleanup edits' }), el('b', { text: fmt(stats.fixes) })]),
    ]),
    el('div', { class: 'card metric' }, [
      el('div', { class: 'big', text: fmt(stats.totalWords) }),
      el('div', { class: 'cap', text: 'Total words dictated' }),
      el('div', { class: 'divider' }),
      el('div', { class: 'sub-row' }, [el('span', { text: '🖥  Desktop' }), el('b', { text: `${fmt(stats.totalWords)} words` })]),
    ]),
  ]));

  // App usage bars
  const maxWords = stats.apps.reduce((m, a) => Math.max(m, a.words), 0) || 1;
  const usageRows = stats.apps.slice(0, 6).map((a, i) => {
    const pct = Math.round((a.words / maxWords) * 100);
    return el('div', { class: 'usage-row' }, [
      el('span', { class: 'u-ico', html: ICON.app }),
      el('div', { class: 'usage-bar' + (i ? ' small' : '') }, [el('span', { style: `--pct:${pct}%`, text: pct + '%' })]),
      el('span', { class: 'usage-name', text: a.app }),
    ]);
  });

  p.appendChild(el('div', { class: 'insight-grid' }, [
    el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [el('h3', { text: 'Desktop usage' }), el('span', { class: 'hint', text: `Apps used | ${stats.apps.length}` })]),
      usageRows.length ? el('div', {}, usageRows) : el('div', { class: 'empty', text: 'No app data yet.' }),
    ]),
    el('div', { class: 'card panel' }, [
      el('div', { class: 'panel-head' }, [el('h3', { text: `${stats.streak} day streak` }), el('span', { class: 'hint', text: `Longest | ${stats.longestStreak} days` })]),
      heatmap(stats.byDay),
      el('div', { class: 'heat-legend' }, [
        el('span', { text: 'Less' }),
        el('i', {}), el('i', { class: 'l1' }), el('i', { class: 'l2' }), el('i', { class: 'l3' }), el('i', { class: 'l4' }),
        el('span', { text: 'More' }),
      ]),
    ]),
  ]));
};

// --- Dictionary ------------------------------------------------------------
let dictBannerDismissed = false;
routes.dictionary = async () => {
  const rows = await cv.invoke('db:listDictionary');
  const p = page([
    el('div', { class: 'page-head' }, [
      el('h1', { text: 'Dictionary' }),
      el('button', { class: 'btn', onclick: () => dictModal() }, [el('span', { html: ICON.plus, style: 'display:flex' }), 'Add new']),
    ]),
    tabsBar(),
  ]);

  if (!dictBannerDismissed) {
    p.appendChild(el('div', { class: 'promo' }, [
      el('button', { class: 'close', html: ICON.close, onclick: (e) => { dictBannerDismissed = true; e.target.closest('.promo').remove(); } }),
      el('h3', { html: 'ColdVoice spells the way <em>you</em> do.' }),
      el('p', { html: 'It learns your unique words and names. <b>Add personal terms, company jargon, client names, or industry-specific lingo</b> so dictation always gets them right.' }),
      el('div', { class: 'chips' }, [
        el('button', { class: 'chip light', onclick: () => dictModal() }, 'Add new word'),
        el('button', { class: 'chip', onclick: () => dictModal({ phrase: 'cold work', replacement: 'ColdWork' }) }, 'ColdWork'),
        el('button', { class: 'chip', onclick: () => dictModal({ phrase: 'super base', replacement: 'Supabase' }) }, 'Supabase'),
      ]),
    ]));
  }

  if (!rows.length) {
    p.appendChild(el('div', { class: 'list' }, [el('div', { class: 'empty', text: 'No words yet. Add terms ColdVoice should always spell your way.' })]));
    return;
  }
  const list = el('div', { class: 'list' });
  for (const d of rows) {
    list.appendChild(el('div', { class: 'list-row', onclick: () => dictModal(d) }, [
      el('div', { class: 'lr-main', html: `${escapeHtml(d.phrase)}<span class="arrow">→</span><span class="to">${escapeHtml(d.replacement || d.phrase)}</span>` }),
      el('div', { class: 'lr-actions' }, [
        iconBtn('trash', 'Delete', stop(async () => { await cv.invoke('db:deleteDictionary', d.id); navigate('dictionary'); })),
      ]),
    ]));
  }
  p.appendChild(list);
};

function dictModal(entry = {}) {
  const phrase = el('input', { type: 'text', placeholder: 'super base', value: entry.phrase || '' });
  const replacement = el('input', { type: 'text', placeholder: 'Supabase', value: entry.replacement || '' });
  const aliases = el('input', { type: 'text', placeholder: 'comma, separated, aliases', value: (safeArr(entry.aliases_json)).join(', ') });
  openModal({
    title: entry.id ? 'Edit word' : 'Add word',
    submitLabel: entry.id ? 'Save' : 'Add word',
    body: el('div', {}, [
      el('label', { text: 'Original (what is heard)' }), phrase,
      el('label', { text: 'Replace with (correct spelling)' }), replacement,
      el('label', { text: 'Aliases (optional)' }), aliases,
    ]),
    onSubmit: async () => {
      if (!phrase.value.trim()) return false;
      await cv.invoke('db:upsertDictionary', {
        id: entry.id, type: entry.type || 'replacement', phrase: phrase.value.trim(), replacement: replacement.value.trim(),
        aliases: aliases.value.split(',').map((s) => s.trim()).filter(Boolean), case_sensitive: !!entry.case_sensitive, enabled: true,
      });
      navigate('dictionary');
    },
  });
}

// --- Snippets --------------------------------------------------------------
routes.snippets = async () => {
  const rows = await cv.invoke('db:listSnippets');
  const p = page([
    el('div', { class: 'page-head' }, [
      el('h1', { text: 'Snippets' }),
      el('button', { class: 'btn', onclick: () => snipModal() }, [el('span', { html: ICON.plus, style: 'display:flex' }), 'Add new']),
    ]),
    tabsBar(),
  ]);
  if (!rows.length) {
    p.appendChild(el('div', { class: 'list' }, [el('div', { class: 'empty', text: 'No snippets yet. Trigger phrases expand into longer text after dictation.' })]));
    return;
  }
  const list = el('div', { class: 'list' });
  for (const s of rows) {
    list.appendChild(el('div', { class: 'list-row', onclick: () => snipModal(s) }, [
      el('div', { class: 'lr-main', html: `${escapeHtml(s.trigger)}<span class="arrow">→</span><span class="to">${escapeHtml(s.expansion)}</span>` }),
      el('div', { class: 'lr-actions' }, [
        iconBtn('trash', 'Delete', stop(async () => { await cv.invoke('db:deleteSnippet', s.id); navigate('snippets'); })),
      ]),
    ]));
  }
  p.appendChild(list);
};

function snipModal(s = {}) {
  const trigger = el('input', { type: 'text', placeholder: 'my email', value: s.trigger || '' });
  const expansion = el('textarea', { placeholder: 'capra.rim6@gmail.com' });
  expansion.value = s.expansion || '';
  openModal({
    title: s.id ? 'Edit snippet' : 'Add snippet',
    submitLabel: s.id ? 'Save' : 'Add snippet',
    body: el('div', {}, [
      el('label', { text: 'Snippet (trigger phrase)' }), trigger,
      el('label', { text: 'Expansion' }), expansion,
    ]),
    onSubmit: async () => {
      if (!trigger.value.trim()) return false;
      await cv.invoke('db:upsertSnippet', { id: s.id, trigger: trigger.value.trim(), expansion: expansion.value, enabled: true });
      navigate('snippets');
    },
  });
}

// --- Settings --------------------------------------------------------------
routes.settings = async () => {
  const s = await cv.invoke('db:getSettings');
  const p = page([el('div', { class: 'page-head' }, [el('h1', { text: 'Settings' })])]);

  p.appendChild(section('', [
    microphoneRow(s),
  ], 'settings-section flush'));

  // Shortcuts
  p.appendChild(section('Shortcuts', [
    shortcutRow('Hands-free toggle', 'shortcut.handsFreeToggle', s['shortcut.handsFreeToggle'] || 'Ctrl+1', 'Tap to start, tap again to stop.'),
    shortcutRow('Hold to dictate', 'shortcut.holdToDictate', s['shortcut.holdToDictate'] || 'Ctrl+CapsLock', 'Hold to record, release to insert.'),
    staticRow('Cancel', 'Esc', 'While the bar is up.'),
  ]));

  // Dictation
  p.appendChild(section('Dictation', [
    toggleRow('Insert when I release / confirm', 'dictation.insertOnRelease', s['dictation.insertOnRelease'] === '1', 'Otherwise the text is just copied to the clipboard.'),
    toggleRow('Show the ColdVoice bar at all times', 'dictation.showBarAlways', s['dictation.showBarAlways'] === '1', 'Keep a small idle bar on screen, Flow-style.'),
    toggleRow('Developer mode', 'dictation.developerMode', s['dictation.developerMode'] !== '0', 'Auto-cases tech terms (Next.js, IPC) and tags filenames like @helper.swift.'),
  ]));

  // AI grammar (Groq cloud). Falls back to the offline pipeline when off/offline.
  p.appendChild(section('AI grammar', [
    toggleRow('AI grammar & formatting', 'ai.enabled', s['ai.enabled'] !== '0', 'Cloud AI (Groq) fixes grammar, punctuation, and formatting — Wispr-style. Falls back to offline when unavailable.'),
    apiKeyRow(s),
    aiStatusRow(),
  ]));

  // General
  p.appendChild(section('General', [
    toggleRow('Launch at login', 'app.launchAtLogin', s['app.launchAtLogin'] === '1'),
  ]));

  // Privacy
  p.appendChild(section('Privacy', [
    toggleRow('Save dictation history', 'privacy.storeTranscripts', s['privacy.storeTranscripts'] !== '0', 'Stored locally only, powers Home and Insights.'),
    toggleRow('Store audio', 'privacy.storeAudio', s['privacy.storeAudio'] === '1', 'Off by default. Audio is never kept unless you enable this.'),
    el('div', { class: 'set-row' }, [
      el('div', { class: 'lab' }, [el('div', { text: 'Clear all dictation history' }), el('div', { class: 'desc', text: 'Permanently deletes every saved dictation.' })]),
      el('div', { class: 'right' }, [el('button', { class: 'btn danger', onclick: async (e) => {
        if (!window.confirm('Delete all saved dictations? This cannot be undone.')) return;
        await cv.invoke('db:clearTranscripts');
        const b = e.target; b.textContent = 'Cleared'; setTimeout(() => { b.textContent = 'Clear history'; }, 1500);
      } }, 'Clear history')]),
    ]),
  ]));
};

function section(title, rows, className = 'settings-section') {
  return el('div', { class: className }, [title ? el('h2', { text: title }) : null, el('div', { class: 'card' }, rows)]);
}
function toggleRow(label, key, checked, desc) {
  return el('div', { class: 'set-row' }, [
    el('div', { class: 'lab' }, [el('div', { text: label }), desc ? el('div', { class: 'desc', text: desc }) : null]),
    el('div', { class: 'right' }, [toggle(checked, (v) => cv.invoke('db:setSetting', { key, value: v ? '1' : '0' }))]),
  ]);
}
function staticRow(label, value, desc) {
  return el('div', { class: 'set-row' }, [
    el('div', { class: 'lab' }, [el('div', { text: label }), desc ? el('div', { class: 'desc', text: desc }) : null]),
    el('div', { class: 'right' }, [el('span', { class: 'keys', text: value })]),
  ]);
}
// Groq API key field. Saves on change (stored locally only, never transmitted
// anywhere but Groq). Test button verifies the key end-to-end.
function apiKeyRow(settings) {
  const input = el('input', {
    type: 'password',
    class: 'key-input',
    placeholder: 'gsk_...',
    value: settings['ai.groqApiKey'] || '',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const status = el('div', { class: 'desc key-status' });
  const save = async () => {
    await cv.invoke('db:setSetting', { key: 'ai.groqApiKey', value: input.value.trim() });
  };
  input.addEventListener('change', save);
  input.addEventListener('blur', save);
  const testBtn = el('button', { class: 'btn ghost', onclick: async () => {
    await save();
    testBtn.disabled = true;
    status.textContent = 'Testing…';
    status.className = 'desc key-status';
    try {
      const res = await cv.invoke('ai:test');
      if (res && res.ok) { status.textContent = 'Connected ✓ AI grammar is working.'; status.className = 'desc key-status ok'; }
      else { status.textContent = `Failed: ${(res && res.error) || 'unknown error'}`; status.className = 'desc key-status err'; }
    } catch (e) {
      status.textContent = `Failed: ${e && e.message ? e.message : e}`;
      status.className = 'desc key-status err';
    } finally {
      testBtn.disabled = false;
    }
  } }, 'Test');
  return el('div', { class: 'set-row key-row' }, [
    el('div', { class: 'lab' }, [
      el('div', { text: 'Groq API key' }),
      el('div', { class: 'desc', text: 'Free at console.groq.com/keys. Powers speech recognition + AI grammar.' }),
      status,
    ]),
    el('div', { class: 'right key-right' }, [input, testBtn]),
  ]);
}
// Live indicator of whether the cloud AI path will actually be used right now.
function aiStatusRow() {
  const badge = el('span', { class: 'keys', text: '…' });
  cv.invoke('ai:status').then((st) => {
    if (!st) return;
    if (st.active) { badge.textContent = 'Active'; badge.className = 'keys ok'; }
    else if (!st.enabled) { badge.textContent = 'Off'; badge.className = 'keys'; }
    else if (!st.hasKey) { badge.textContent = 'No key'; badge.className = 'keys err'; }
    else if (!st.online) { badge.textContent = 'Offline'; badge.className = 'keys err'; }
    else { badge.textContent = 'Inactive'; badge.className = 'keys'; }
  }).catch(() => { badge.textContent = '—'; });
  return el('div', { class: 'set-row' }, [
    el('div', { class: 'lab' }, [
      el('div', { text: 'Status' }),
      el('div', { class: 'desc', text: 'When inactive, ColdVoice uses the offline whisper + rule pipeline.' }),
    ]),
    el('div', { class: 'right' }, [badge]),
  ]);
}
function microphoneRow(settings) {
  const label = settings['dictation.microphoneLabel'] || 'Auto-detect';
  return el('div', { class: 'set-row mic-row' }, [
    el('div', { class: 'lab' }, [
      el('div', { text: 'Microphone' }),
      el('div', { class: 'desc mic-current', text: label }),
    ]),
    el('div', { class: 'right' }, [
      el('button', { class: 'mic-change', onclick: openMicrophoneModal }, 'Change'),
    ]),
  ]);
}

async function requestMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Microphone access is not available.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

async function listMicrophones() {
  await requestMicPermission();
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput');
}

function deviceName(device, index) {
  return device.label || `Microphone ${index + 1}`;
}

async function verifyMicrophone(deviceId) {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const track = stream.getAudioTracks()[0];
  const ok = !!track && track.readyState === 'live';
  stream.getTracks().forEach((item) => item.stop());
  if (!ok) throw new Error('That microphone did not start.');
}

function closeMicrophoneModal() {
  modalRoot.innerHTML = '';
}

function renderMicrophoneOptions(container, devices, settings) {
  const selected = settings['dictation.microphoneDeviceId'] || '';
  const options = [
    { id: '', label: 'Auto-detect', sub: 'From computer settings', selected: !selected, meter: true },
    ...devices.map((device, index) => ({
      id: device.deviceId,
      label: deviceName(device, index),
      sub: '',
      selected: selected === device.deviceId,
      meter: false,
    })),
  ];

  container.innerHTML = '';
  for (const option of options) {
    const btn = el('button', { class: `mic-option${option.selected ? ' selected' : ''}`, type: 'button' }, [
      el('span', { class: 'mic-copy' }, [
        el('span', { class: 'mic-title', text: option.label }),
        option.sub ? el('span', { class: 'mic-sub', text: option.sub }) : null,
      ]),
      option.meter ? el('span', { class: 'mic-meter', html: '<i></i><i></i><i></i><i></i><i></i><i></i>' }) : null,
    ]);
    btn.addEventListener('click', async () => {
      try {
        await verifyMicrophone(option.id);
        await cv.invoke('db:setSetting', { key: 'dictation.microphoneDeviceId', value: option.id });
        await cv.invoke('db:setSetting', { key: 'dictation.microphoneLabel', value: option.label });
        closeMicrophoneModal();
        navigate('settings');
      } catch (err) {
        container.innerHTML = '';
        container.appendChild(el('div', { class: 'mic-empty', text: String(err && err.message ? err.message : err) }));
      }
    });
    container.appendChild(btn);
  }
}

function openMicrophoneModal() {
  modalRoot.innerHTML = '';
  const list = el('div', { class: 'mic-list' }, [el('div', { class: 'mic-empty', text: 'Detecting microphones...' })]);
  const backdrop = el('div', { class: 'modal-backdrop mic-backdrop', onclick: (e) => { if (e.target === backdrop) closeMicrophoneModal(); } }, [
    el('div', { class: 'mic-modal' }, [
      el('div', { class: 'mic-head' }, [
        el('h3', { text: 'Microphone' }),
        el('button', { class: 'mic-close', onclick: closeMicrophoneModal }, 'x'),
      ]),
      list,
      el('button', { class: 'mic-help', type: 'button' }, 'Find the right mic for you ->'),
    ]),
  ]);
  modalRoot.appendChild(backdrop);
  Promise.all([listMicrophones(), cv.invoke('db:getSettings')])
    .then(([devices, settings]) => {
      if (!devices.length) {
        list.innerHTML = '';
        list.appendChild(el('div', { class: 'mic-empty', text: 'No microphones detected.' }));
        return;
      }
      renderMicrophoneOptions(list, devices, settings);
    })
    .catch((err) => {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'mic-empty', text: String(err && err.message ? err.message : err) }));
    });
}
function shortcutRow(label, key, value, desc) {
  const keysSpan = el('span', { class: 'keys', text: value || '—' });
  const editBtn = iconBtn('edit', 'Rebind', async () => {
    const next = await captureShortcut(keysSpan);
    if (next) { keysSpan.textContent = next; await cv.invoke('db:setSetting', { key, value: next }); }
  });
  return el('div', { class: 'set-row' }, [
    el('div', { class: 'lab' }, [el('div', { text: label }), desc ? el('div', { class: 'desc', text: desc }) : null]),
    el('div', { class: 'right' }, [keysSpan, editBtn]),
  ]);
}
function captureShortcut(target) {
  return new Promise((resolve) => {
    const prev = target.textContent;
    target.textContent = 'Press keys…';
    function done(val) { window.removeEventListener('keydown', onKey, true); if (target.textContent === 'Press keys…') target.textContent = prev; resolve(val); }
    function onKey(e) {
      e.preventDefault();
      if (e.key === 'Escape') return done('Esc');
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const mods = ['Control', 'Alt', 'Shift', 'Meta'];
      if (mods.includes(e.key)) return; // wait for a non-modifier
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      parts.push(k);
      done(parts.join('+'));
    }
    window.addEventListener('keydown', onKey, true);
  });
}

// --- shared bits -----------------------------------------------------------
function tabsBar() {
  return el('div', { class: 'tabs' }, [
    el('div', { class: 'tab active', text: 'All' }),
    el('div', { class: 'tab', text: 'Personal' }),
    el('div', { class: 'tab', text: 'Shared with team' }),
  ]);
}
function stop(fn) { return (e) => { e.stopPropagation(); return fn(e); }; }
function copyText(t) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).catch(() => fallbackCopy(t)); return; } } catch { /* ignore */ }
  fallbackCopy(t);
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
}
function flash(e) {
  const btn = e.currentTarget || e.target; if (!btn) return;
  btn.style.color = 'var(--accent)';
  setTimeout(() => { btn.style.color = ''; }, 700);
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function safeArr(s) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } }

// --- Account / sign-in -----------------------------------------------------
routes.account = async () => {
  const status = await cv.invoke('auth:status');
  const p = page([el('div', { class: 'page-head' }, [el('h1', { text: 'Account' })])]);

  if (status.signedIn) {
    p.appendChild(section('Signed in', [
      el('div', { class: 'set-row' }, [
        el('div', { class: 'lab' }, [
          el('div', { text: status.email }),
          el('div', { class: 'desc', text: status.online ? 'Connected · syncing available.' : 'Offline · your session stays active and dictation keeps working.' }),
        ]),
        el('div', { class: 'right' }, [el('button', { class: 'btn ghost', onclick: async () => { await cv.invoke('auth:signOut'); navigate('account'); } }, 'Sign out')]),
      ]),
    ]));
    return;
  }

  // Signed-out: a real sign-in / sign-up form, blocked while offline.
  let mode = 'login';
  const email = el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
  const password = el('input', { type: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
  const statusLine = el('div', { class: 'auth-msg' });
  const submit = el('button', { class: 'btn' }, 'Log in');
  const switcher = el('button', { class: 'chip light' }, 'Create an account instead');

  function applyOffline(online) {
    email.disabled = password.disabled = submit.disabled = !online;
    if (!online) {
      statusLine.textContent = 'You are offline. Sign in needs a connection — an existing session would keep working offline.';
      statusLine.className = 'auth-msg warn';
    } else if (statusLine.classList.contains('warn')) {
      statusLine.textContent = '';
      statusLine.className = 'auth-msg';
    }
  }

  function setMode(next) {
    mode = next;
    submit.textContent = mode === 'signup' ? 'Create account' : 'Log in';
    switcher.textContent = mode === 'signup' ? 'I already have an account' : 'Create an account instead';
    password.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
  }
  switcher.addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));

  submit.addEventListener('click', async () => {
    statusLine.textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    statusLine.className = 'auth-msg';
    const res = await cv.invoke('auth:signIn', { mode, email: email.value, password: password.value });
    if (res.ok) navigate('account');
    else { statusLine.textContent = res.error; statusLine.className = 'auth-msg error'; }
  });

  p.appendChild(section('Sign in to ColdVoice', [
    el('div', { class: 'auth-form' }, [
      el('label', { text: 'Email' }), email,
      el('label', { text: 'Password' }), password,
      submit,
      statusLine,
      switcher,
    ]),
  ]));

  const online = (await cv.invoke('app:isOnline')).online;
  applyOffline(online);
  connListeners.push(applyOffline);
};

// --- live connectivity indicator -------------------------------------------
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const connListeners = [];
function setConnectivity(online) {
  if (connDot) connDot.classList.toggle('offline', !online);
  if (connLabel) connLabel.textContent = online ? 'Online · on-device' : 'Offline · on-device';
  for (const cb of connListeners) { try { cb(online); } catch { /* ignore */ } }
}
cv.on('app:connectivity', (data) => { if (data) setConnectivity(!!data.online); });
// A new dictation was just saved — refresh Home instantly, no manual reload.
cv.on('transcript:new', () => { if (current === 'home') navigate('home'); });
cv.invoke('app:isOnline').then((r) => setConnectivity(!!(r && r.online))).catch(() => {});

// Reset per-page connectivity subscribers when navigating away.
const _navigate = navigate;
navigate = function (route) { connListeners.length = 0; return _navigate(route); };

navigate('home');

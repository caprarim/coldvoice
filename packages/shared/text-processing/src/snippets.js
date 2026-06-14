'use strict';

// Step 7: snippet expansion. Trigger phrase -> expansion text.
// Optional variables: {date}, {time}, {clipboard} resolved from ctx if provided.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveVariables(text, ctx) {
  return text.replace(/\{(date|time|clipboard)\}/gi, (m, name) => {
    const key = name.toLowerCase();
    if (ctx && ctx[key] != null) return String(ctx[key]);
    if (key === 'date') return new Date().toISOString().slice(0, 10);
    if (key === 'time') return new Date().toTimeString().slice(0, 5);
    return m; // leave {clipboard} untouched if not supplied
  });
}

function expandSnippets(text, snippets, ctx) {
  if (!snippets || snippets.length === 0) return text;
  let out = text;
  for (const s of snippets) {
    if (!s || s.enabled === false || !s.trigger) continue;
    const re = new RegExp(`\\b${escapeRegExp(s.trigger)}\\b`, 'gi');
    out = out.replace(re, () => resolveVariables(s.expansion || '', ctx));
  }
  return out;
}

module.exports = { expandSnippets, resolveVariables };

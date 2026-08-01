'use strict';

// Step 5: capitalization, repeated-punctuation cleanup, and list commands.

function cleanRepeatedPunctuation(text) {
  return text
    .replace(/([!?.,;:])\1+/g, '$1')
    .replace(/\s+([,.;:!?])/g, '$1');
}

function capitalizeSentences(text) {
  let out = text.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  // Standalone "i" -> "I".
  out = out.replace(/\bi\b/g, 'I').replace(/\bi(['’])/g, 'I$1');
  return out;
}

// "numbered list a, b, c" -> "1. a\n2. b\n3. c"
// "bullet list a, b, c"   -> "- a\n- b\n- c"
function formatLists(text) {
  let out = text;
  out = out.replace(/\bnumbered list\b:?\s*(.+)/i, (m, items) => {
    const parts = items.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
  });
  out = out.replace(/\bbullet list\b:?\s*(.+)/i, (m, items) => {
    const parts = items.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return parts.map((p) => `- ${p}`).join('\n');
  });
  return out;
}

const LIST_ITEM_MARKER = /\b(what|how|why|when|where|whether|which|who|if)\b/gi;

function splitLeadIn(firstPart) {
  let match;
  let last = null;
  LIST_ITEM_MARKER.lastIndex = 0;
  while ((match = LIST_ITEM_MARKER.exec(firstPart)) !== null) last = match;
  if (!last || last.index === 0) return null;
  const leadIn = firstPart.slice(0, last.index).trim().replace(/[,:]$/, '');
  const item = firstPart.slice(last.index).trim();
  if (!leadIn || leadIn.split(/\s+/).length < 2) return null;
  if (!item || item.split(/\s+/).length < 2) return null;
  return { leadIn, item };
}

function autoFormatLists(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (/^\s*([-*]|\d+\.)\s/.test(line)) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => convertSentenceToList(sentence))
        .reduce((acc, cur) => {
          if (!acc) return cur;
          const sep = acc.includes('\n') || cur.includes('\n') ? '\n' : ' ';
          return acc + sep + cur;
        }, '');
    })
    .join('\n');
}

function convertSentenceToList(sentence) {
  const trimmed = sentence.trim();
  if (!trimmed || trimmed.includes('\n')) return sentence;
  const ending = /[.!?]$/.test(trimmed) ? trimmed.slice(-1) : '';
  const body = ending ? trimmed.slice(0, -1) : trimmed;
  const parts = body.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return sentence;
  const lastRaw = parts[parts.length - 1];
  const lastMatch = lastRaw.match(/^(?:and|or)\s+(.+)$/i);
  if (!lastMatch) return sentence;
  const split = splitLeadIn(parts[0]);
  if (!split) return sentence;
  const items = [split.item, ...parts.slice(1, -1), lastMatch[1]];
  if (items.some((it) => it.split(/\s+/).length < 2)) return sentence;
  return `${split.leadIn}:\n` + items.map((it) => `- ${it}`).join('\n');
}

function applyFormatting(text, opts = {}) {
  let out = formatLists(text);
  if (opts.autoLists) out = autoFormatLists(out);
  out = cleanRepeatedPunctuation(out);
  out = capitalizeSentences(out);
  return out;
}

module.exports = { applyFormatting, capitalizeSentences, cleanRepeatedPunctuation, formatLists, autoFormatLists };

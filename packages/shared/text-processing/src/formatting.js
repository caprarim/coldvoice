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

function applyFormatting(text) {
  let out = formatLists(text);
  out = cleanRepeatedPunctuation(out);
  out = capitalizeSentences(out);
  return out;
}

module.exports = { applyFormatting, capitalizeSentences, cleanRepeatedPunctuation, formatLists };

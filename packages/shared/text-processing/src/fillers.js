'use strict';

// Step 3: remove filler words at phrase boundaries.
// NOTE: "I mean" is intentionally NOT removed here — it is handled as a
// correction command in backtracking.js. "like" is only removed when it is
// clearly a discourse marker (surrounded by commas), never as a verb.

const ALWAYS = ['um', 'umm', 'uh', 'uhh', 'er', 'err', 'erm', 'ah', 'hmm', 'mm'];

function removeFillers(text) {
  let out = text;

  // Standalone hesitation sounds, anywhere.
  const always = new RegExp(`\\b(?:${ALWAYS.join('|')})\\b`, 'gi');
  out = out.replace(always, '');

  // "you know" as a discourse filler.
  out = out.replace(/\byou know\b/gi, '');

  // "like" only when fenced by commas: "it was, like, huge".
  out = out.replace(/,\s*like\s*,/gi, ',');

  // Clean up the gaps left behind (preserve newlines).
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = out.replace(/[ \t]+([,.;:!?])/g, '$1');
  out = out.replace(/,[ \t]*,/g, ',');
  out = out.replace(/(^|[.!?][ \t]*),[ \t]*/g, '$1');
  out = out.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').trim();

  return out;
}

module.exports = { removeFillers };

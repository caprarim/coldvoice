'use strict';

// Step 4: spoken corrections / backtracking.
// Each rule is deterministic and operates left-to-right on the string.
// Documented behavior (single preceding token unless noted):
//   "X actually Y"      -> "Y"      (replace previous word with Y)
//   "X, no, Y"          -> "Y"      (replace previous word with Y)
//   "X I mean Y"        -> "Y"      (replace previous word with Y)
//   "... scratch that"  -> deletes everything back to the clause start
//   "X delete last word"     -> removes X and the command
//   "<sentence>. delete last sentence" -> removes the previous sentence

function applyBacktracking(text) {
  let out = text;

  // Replace previous word with the following word.
  out = out.replace(/\b(\w+)\s+actually\s+(\w+)\b/gi, '$2');
  out = out.replace(/\b(\w+)\s*,\s*no\s*,\s+(\w+)\b/gi, '$2');
  out = out.replace(/\b(\w+)\s+i mean\s+(\w+)\b/gi, '$2');

  // "delete last word": drop the word immediately before the command.
  out = out.replace(/\s*\b\w+\s+delete last word\b[.,]?/gi, '');

  // "delete last sentence": drop the sentence immediately before the command.
  out = out.replace(/(.*)\bdelete last sentence\b[.,]?\s*/is, (m, before) => {
    const parts = before.match(/[^.!?]+[.!?]+/g) || [];
    parts.pop();
    return parts.join('').trim();
  });

  // "scratch that": delete from the clause start through the command.
  out = out.replace(/(^|[.!?]\s*)[^.!?]*?\bscratch that\b[.,]?\s*/gi, '$1');

  out = out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:!?])/g, '$1').trim();
  return out;
}

module.exports = { applyBacktracking };

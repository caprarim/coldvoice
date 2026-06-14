'use strict';

// Step 2 of the pipeline: convert spoken punctuation words into real marks.
// Multi-word phrases must be matched before single words.

const OPENQ = 'OQ';
const CLOSEQ = 'CQ';
const OPENP = 'OP';
const CLOSEP = 'CP';

const PHRASES = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bquestion mark\b/gi, '?'],
  [/\bexclamation (?:mark|point)\b/gi, '!'],
  [/\bfull stop\b/gi, '.'],
  [/\bopen quote\b/gi, OPENQ],
  [/\bclose quote\b/gi, CLOSEQ],
  [/\bopen paren(?:thesis)?\b/gi, OPENP],
  [/\bclose paren(?:thesis)?\b/gi, CLOSEP],
  [/\bsemicolon\b/gi, ';'],
  [/\bcolon\b/gi, ':'],
  [/\bcomma\b/gi, ','],
  [/\bperiod\b/gi, '.'],
  [/\bdash\b/gi, '-'],
];

function convertSpokenPunctuation(text) {
  let out = text;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);

  // Closing punctuation hugs the preceding word.
  out = out.replace(/[ \t]+([,.;:!?])/g, '$1');
  // Trim horizontal space around inserted newlines.
  out = out.replace(/[ \t]*\n[ \t]*/g, '\n');
  // Remove a space before a closing quote/paren, and after an opening one.
  out = out.split(` ${CLOSEQ}`).join(CLOSEQ).split(` ${CLOSEP}`).join(CLOSEP);
  out = out.split(`${OPENQ} `).join(OPENQ).split(`${OPENP} `).join(OPENP);

  out = out
    .split(OPENQ).join('"')
    .split(CLOSEQ).join('"')
    .split(OPENP).join('(')
    .split(CLOSEP).join(')');

  return out;
}

module.exports = { convertSpokenPunctuation };

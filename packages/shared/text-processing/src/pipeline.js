'use strict';

// The full deterministic, offline post-processing pipeline.
// Order matches the ColdVoice spec exactly.

const { convertSpokenPunctuation } = require('./punctuation');
const { removeFillers } = require('./fillers');
const { applyBacktracking } = require('./backtracking');
const { applyFormatting } = require('./formatting');
const { applyDevTerms } = require('./dev-terms');
const { applyDictionary } = require('./dictionary');
const { expandSnippets } = require('./snippets');
const { applyStyle, styleForApp } = require('./style');

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// options:
//   dictionary: array of entries
//   snippets:   array of snippets
//   style:      style name (overrides appId)
//   appId:      target app, used to pick a style if `style` not given
//   snippetCtx: variables for snippet expansion ({date},{time},{clipboard})
function process(rawText, options = {}) {
  const style = options.style || styleForApp(options.appId) || 'default';

  // 1. Normalize whitespace (always).
  let text = normalizeWhitespace(rawText);

  // Raw transcript style skips all cleanup.
  if (style.toLowerCase() === 'raw') return text;

  // 2. Spoken punctuation.
  text = convertSpokenPunctuation(text);
  // 3. Filler removal.
  text = removeFillers(text);
  // 4. Backtracking / corrections.
  text = applyBacktracking(text);
  // 5. Formatting (capitalization, repeated punctuation, lists).
  text = applyFormatting(text);
  // 5b. Developer awareness (tech-term casing + @filename mentions).
  if (options.developerMode) text = applyDevTerms(text);
  // 6. Dictionary replacements.
  text = applyDictionary(text, options.dictionary || []);
  // 7. Snippet expansion.
  text = expandSnippets(text, options.snippets || [], options.snippetCtx);
  // 8. Style transform.
  text = applyStyle(text, style);
  // 9. Final trim.
  return text.replace(/[ \t]+\n/g, '\n').replace(/\s+$/g, '').trim();
}

module.exports = { process, normalizeWhitespace };

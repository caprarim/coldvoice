'use strict';

// Step 6: dictionary replacements.
// Match priority: exact -> case-insensitive -> fuzzy (>= 0.88, phrase len >= 4).
// Capitalization of the matched text is preserved onto the replacement.

const { similarity } = require('./fuzzy');

const FUZZY_THRESHOLD = 0.88;
const FUZZY_MIN_LEN = 4;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(source, replacement) {
  if (source === source.toUpperCase() && /[A-Z]/.test(source)) return replacement.toUpperCase();
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Normalize entries into a flat list of { phrase, replacement, caseSensitive }.
function flatten(entries) {
  const rules = [];
  for (const e of entries) {
    if (!e || e.enabled === false) continue;
    const replacement = e.replacement || e.phrase;
    if (e.phrase) rules.push({ phrase: e.phrase, replacement, caseSensitive: !!e.caseSensitive });
    const aliases = e.aliases || e.aliases_json || [];
    const list = Array.isArray(aliases) ? aliases : safeParse(aliases);
    for (const a of list) rules.push({ phrase: a, replacement, caseSensitive: !!e.caseSensitive });
  }
  return rules;
}

function safeParse(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function applyDictionary(text, entries) {
  if (!entries || entries.length === 0) return text;
  let out = text;
  const rules = flatten(entries);

  for (const rule of rules) {
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const re = new RegExp(`\\b${escapeRegExp(rule.phrase)}\\b`, flags);
    out = out.replace(re, (m) => matchCase(m, rule.replacement));
  }

  // Fuzzy pass on single tokens for phrases long enough to be safe.
  for (const rule of rules) {
    if (rule.phrase.includes(' ')) continue;
    if (rule.phrase.length < FUZZY_MIN_LEN) continue;
    out = out.replace(/\b[\w']+\b/g, (word) => {
      if (word.toLowerCase() === rule.replacement.toLowerCase()) return word;
      if (similarity(word, rule.phrase) >= FUZZY_THRESHOLD) return matchCase(word, rule.replacement);
      return word;
    });
  }

  return out;
}

module.exports = { applyDictionary, matchCase };

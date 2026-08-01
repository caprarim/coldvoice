'use strict';

// Built-in ASR mishearing fixes. Whisper (and similar models) routinely mangle
// agent/dev phrases when the speaker talks fast. These are deterministic,
// offline, longest-match-first replacements applied after fillers/backtracking
// and before the user dictionary.

// Always-on: high-confidence garble patterns that almost never mean the
// literal words in normal dictation.
const CORE_MISHEARS = [
  // Whole-phrase collapses seen in real ColdVoice logs
  ['have decreased and disrespected due to the non-launchiness of the agency',
    'have to get straight to work and please do this respectively, and do not launch any sub-agents'],
  ['have decreased and disrespected due to the non launchiness of the agency',
    'have to get straight to work and please do this respectively, and do not launch any sub-agents'],
  ['decreased and disrespected due to the non-launchiness of the agency',
    'to get straight to work and please do this respectively, and do not launch any sub-agents'],
  ['decreased and disrespected due to the non launchiness of the agency',
    'to get straight to work and please do this respectively, and do not launch any sub-agents'],
  ['due to the non-launchiness of the agency', 'and do not launch any sub-agents'],
  ['due to the non launchiness of the agency', 'and do not launch any sub-agents'],
  ['the non-launchiness of the agency', 'do not launch any sub-agents'],
  ['the non launchiness of the agency', 'do not launch any sub-agents'],
  ['non-launchiness of the agency', 'do not launch any sub-agents'],
  ['non launchiness of the agency', 'do not launch any sub-agents'],
  ['nonlaunchiness of the agency', 'do not launch any sub-agents'],
  ['have decreased and disrespected',
    'have to get straight to work and please do this respectively'],
  ['decreased and disrespected',
    'to get straight to work and please do this respectively'],

  // "sub-agents" family (surveillance / subagency / agency)
  ['do not launch any surveillance', 'do not launch any sub-agents'],
  ["don't launch any surveillance", "don't launch any sub-agents"],
  ['dont launch any surveillance', "don't launch any sub-agents"],
  ['never launch any surveillance', 'never launch any sub-agents'],
  ['no surveillance', 'no sub-agents'],
  ['launch any surveillance', 'launch any sub-agents'],
  ['launch surveillance', 'launch sub-agents'],
  ['launching surveillance', 'launching sub-agents'],
  ['launch any subagency', 'launch any sub-agents'],
  ['launch any sub-agency', 'launch any sub-agents'],
  ['launch any sub agency', 'launch any sub-agents'],
  ['launch any the agency', 'launch any sub-agents'],
  ['launch the agency', 'launch sub-agents'],
  ['launch any agency', 'launch any sub-agents'],
  ['do not launch any agency', 'do not launch any sub-agents'],
  ["don't launch any agency", "don't launch any sub-agents"],
  ['do not launch any subagency', 'do not launch any sub-agents'],
  ["don't launch any subagency", "don't launch any sub-agents"],
  ['do not launch any sub agency', 'do not launch any sub-agents'],
  ['do not launch any sub-agency', 'do not launch any sub-agents'],
  ['no subagency', 'no sub-agents'],
  ['no sub agency', 'no sub-agents'],
  ['no sub-agency', 'no sub-agents'],
  ['subagencies', 'sub-agents'],
  ['sub-agencies', 'sub-agents'],
  ['sub agencies', 'sub-agents'],
  ['subagency', 'sub-agents'],
  ['sub-agency', 'sub-agents'],
  ['sub agency', 'sub-agents'],
  ['sub agents', 'sub-agents'],
  ['sub agent', 'sub-agent'],
  ['subagents', 'sub-agents'],
  ['subagent', 'sub-agent'],

  // "respectively" family in instruction phrasing
  ['do this respectfully', 'do this respectively'],
  ['do it respectfully', 'do it respectively'],
  ['do that respectfully', 'do that respectively'],
  ['please do this respectfully', 'please do this respectively'],
  ['please do it respectfully', 'please do it respectively'],
  ['make these changes respectfully', 'make these changes respectively'],
  ['make the changes respectfully', 'make the changes respectively'],
  ['make this change respectfully', 'make this change respectively'],
  ['fix it respectfully', 'fix it respectively'],
  ['fix this respectfully', 'fix this respectively'],
  ['handle this respectfully', 'handle this respectively'],
  ['and respectfully fix', 'and respectively fix'],
  ['please respectfully', 'please respectively'],
  ['changes respectfully', 'changes respectively'],
  ['this respectfully', 'this respectively'],
  ['it respectfully', 'it respectively'],
];

// Extra aggressive single-token fixes used only in developer mode.
const DEV_MISHEARS = [
  ['respectfully', 'respectively'],
  ['surveillance', 'sub-agents'],
];

// Terms fed into Whisper's prompt so the model biases toward the right spellings
// even before post-processing. Keep short; Whisper prompt budget is tight.
const ASR_VOCAB_TERMS = [
  'sub-agents',
  'sub-agent',
  'respectively',
  'do not launch any sub-agents',
  'please do this respectively',
  'get straight to work',
  'ColdVoice',
  'ColdWork',
  'Supabase',
  'TypeScript',
  'JavaScript',
  'Next.js',
  'GitHub',
  'pull request',
  'codebase',
  'refactor',
  'dictation',
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyRuleList(text, rules) {
  let out = text;
  // Longest source first so multi-word phrases win over their substrings.
  const sorted = rules.slice().sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of sorted) {
    const body = escapeRegExp(from).replace(/ +/g, '\\s+');
    const re = new RegExp(`\\b${body}\\b`, 'gi');
    out = out.replace(re, to);
  }
  return out;
}

function applyMishears(text, options = {}) {
  let out = String(text || '');
  if (!out) return out;
  out = applyRuleList(out, CORE_MISHEARS);
  if (options.developerMode) out = applyRuleList(out, DEV_MISHEARS);
  return out;
}

function asrVocabTerms() {
  return ASR_VOCAB_TERMS.slice();
}

module.exports = {
  applyMishears,
  asrVocabTerms,
  CORE_MISHEARS,
  DEV_MISHEARS,
  ASR_VOCAB_TERMS,
};

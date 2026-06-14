'use strict';

// Step 8: rule-based style transforms. No cloud LLM.
// Styles: default, casual, professional, code, raw.

const SLANG = [
  [/\bgonna\b/gi, 'going to'],
  [/\bwanna\b/gi, 'want to'],
  [/\bgotta\b/gi, 'got to'],
  [/\bkinda\b/gi, 'kind of'],
  [/\bsorta\b/gi, 'sort of'],
  [/\bdunno\b/gi, "don't know"],
  [/\byeah\b/gi, 'yes'],
  [/\byep\b/gi, 'yes'],
  [/\bnope\b/gi, 'no'],
  [/\bcuz\b/gi, 'because'],
  [/\b'cause\b/gi, 'because'],
];

function toProfessional(text) {
  let out = text;
  for (const [re, rep] of SLANG) out = out.replace(re, rep);
  return out.replace(/\s{2,}/g, ' ').trim();
}

// Map a per-app scope to a style name. Used by app_rules.
const APP_STYLE = {
  whatsapp: 'casual',
  discord: 'casual',
  telegram: 'casual',
  gmail: 'professional',
  docs: 'professional',
  'google docs': 'professional',
  outlook: 'professional',
  'vs code': 'code',
  vscode: 'code',
  code: 'code',
  cursor: 'code',
};

function styleForApp(appId) {
  if (!appId) return null;
  return APP_STYLE[String(appId).toLowerCase()] || null;
}

function applyStyle(text, style) {
  switch ((style || 'default').toLowerCase()) {
    case 'raw':
      return text; // raw transcript: untouched
    case 'code':
      return text; // preserve symbols, casing, file names
    case 'casual':
      return text; // keep natural tone
    case 'professional':
      return toProfessional(text);
    case 'default':
    default:
      return text;
  }
}

module.exports = { applyStyle, styleForApp, toProfessional, APP_STYLE };

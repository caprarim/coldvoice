'use strict';

// Developer awareness. Two transforms, applied only when developer mode is on:
//   1. Spoken filenames -> @-mentions  ("helper swift" / "index dot html" ->
//      "@helper.swift" / "@index.html"), the way WisprFlow tabs a file.
//   2. Spoken tech terms -> canonical casing ("next js" -> "Next.js",
//      "type script" -> "TypeScript", "ipc" -> "IPC").
// Everything is deterministic and offline.

// Spoken extension word -> real file extension. Kept to forms that are rarely
// ambiguous in everyday speech so we don't tag plain sentences by accident.
const EXTENSIONS = {
  swift: 'swift',
  js: 'js',
  ts: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  py: 'py',
  python: 'py',
  rs: 'rs',
  rust: 'rs',
  go: 'go',
  golang: 'go',
  kt: 'kt',
  kotlin: 'kt',
  java: 'java',
  rb: 'rb',
  php: 'php',
  cpp: 'cpp',
  md: 'md',
  markdown: 'md',
  yml: 'yml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  sh: 'sh',
  vue: 'vue',
  svelte: 'svelte',
};

// Canonical casing for tech terms, keyed by lowercased spoken form. Multi-word
// keys are matched before single-word keys so "react native" wins over "react".
const TECH_TERMS = {
  'next js': 'Next.js',
  nextjs: 'Next.js',
  'node js': 'Node.js',
  nodejs: 'Node.js',
  'react native': 'React Native',
  react: 'React',
  vue: 'Vue',
  angular: 'Angular',
  svelte: 'Svelte',
  'type script': 'TypeScript',
  typescript: 'TypeScript',
  'java script': 'JavaScript',
  javascript: 'JavaScript',
  tailwind: 'Tailwind',
  github: 'GitHub',
  gitlab: 'GitLab',
  graphql: 'GraphQL',
  postgres: 'Postgres',
  postgresql: 'PostgreSQL',
  'mongo db': 'MongoDB',
  mongodb: 'MongoDB',
  'vs code': 'VS Code',
  vscode: 'VS Code',
  electron: 'Electron',
  npm: 'npm',
  api: 'API',
  apis: 'APIs',
  ipc: 'IPC',
  cli: 'CLI',
  ui: 'UI',
  ux: 'UX',
  url: 'URL',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  jsx: 'JSX',
  tsx: 'TSX',
  http: 'HTTP',
  https: 'HTTPS',
  oauth: 'OAuth',
  jwt: 'JWT',
  sdk: 'SDK',
};

const EXT_WORDS = Object.keys(EXTENSIONS).join('|');

// Words that are never filenames, so "the html spec" doesn't become "@the.html".
const STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'in', 'on', 'of', 'at',
  'is', 'it', 'and', 'or', 'to', 'my', 'your', 'our', 'their', 'some', 'any',
  'for', 'with', 'as', 'by', 'be', 'are', 'was', 'were', 'into', 'using', 'use',
]);

// "<name> dot <ext>" or "<name> <ext>" -> "@name.ext". The name is a single
// identifier-ish token; an optional "dot" makes the intent explicit.
const FILENAME_RE = new RegExp(
  String.raw`\b([A-Za-z][A-Za-z0-9_-]*)\s+(?:dot\s+)?(${EXT_WORDS})\b`,
  'gi'
);

function tagFilenames(text) {
  return String(text).replace(FILENAME_RE, (m, name, extWord) => {
    if (STOPWORDS.has(name.toLowerCase())) return m;
    const ext = EXTENSIONS[extWord.toLowerCase()];
    if (!ext) return m;
    return `@${name}.${ext}`;
  });
}

// Replace tech terms, longest spoken form first so multi-word keys win.
function applyTechTerms(text) {
  const keys = Object.keys(TECH_TERMS).sort((a, b) => b.length - a.length);
  let out = text;
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    out = out.replace(re, TECH_TERMS[key]);
  }
  return out;
}

// Tech terms run first so known phrases ("next js" -> "Next.js") are consumed
// before filename tagging, which then only fires on leftover "<name> <ext>"
// pairs ("helper swift" -> "@helper.swift").
function applyDevTerms(text) {
  let out = applyTechTerms(String(text));
  out = tagFilenames(out);
  return out;
}

module.exports = { applyDevTerms, tagFilenames, applyTechTerms, TECH_TERMS, EXTENSIONS };

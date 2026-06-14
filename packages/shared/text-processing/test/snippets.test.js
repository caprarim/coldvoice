'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { expandSnippets } = require('../src/snippets');

const SNIPPETS = [
  { trigger: 'my email', expansion: 'capra.rim6@gmail.com', enabled: true },
  { trigger: 'sig', expansion: 'Best,\nCapra', enabled: true },
  { trigger: 'off', expansion: 'nope', enabled: false },
];

test('expands a trigger phrase', () => {
  assert.strictEqual(expandSnippets('contact me at my email', SNIPPETS), 'contact me at capra.rim6@gmail.com');
});

test('is case-insensitive on the trigger', () => {
  assert.strictEqual(expandSnippets('My Email please', SNIPPETS), 'capra.rim6@gmail.com please');
});

test('ignores disabled snippets', () => {
  assert.strictEqual(expandSnippets('this is off', SNIPPETS), 'this is off');
});

test('resolves {date} from context', () => {
  const s = [{ trigger: 'today', expansion: '{date}', enabled: true }];
  assert.strictEqual(expandSnippets('today', s, { date: '2026-06-14' }), '2026-06-14');
});

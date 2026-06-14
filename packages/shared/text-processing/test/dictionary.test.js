'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyDictionary } = require('../src/dictionary');

const ENTRIES = [
  { type: 'replacement', phrase: 'cold work', replacement: 'ColdWork' },
  { type: 'replacement', phrase: 'super base', replacement: 'Supabase' },
  { type: 'vocabulary', phrase: 'Supabase' },
];

test('exact phrase replacement', () => {
  assert.strictEqual(applyDictionary('I use cold work daily', ENTRIES), 'I use ColdWork daily');
});

test('case-insensitive replacement', () => {
  assert.strictEqual(applyDictionary('I use Cold Work daily', ENTRIES), 'I use ColdWork daily');
});

test('multi-word replacement', () => {
  assert.strictEqual(applyDictionary('deploy to super base now', ENTRIES), 'deploy to Supabase now');
});

test('fuzzy match for close misspelling', () => {
  // "javascrpt" -> "javascript": 1 edit over length 10 => similarity 0.9 (>= 0.88).
  const out = applyDictionary('I write javascrpt', [{ phrase: 'javascript', replacement: 'JavaScript' }]);
  assert.strictEqual(out, 'I write JavaScript');
});

test('no replacement for unrelated word', () => {
  assert.strictEqual(applyDictionary('the cat sat', ENTRIES), 'the cat sat');
});

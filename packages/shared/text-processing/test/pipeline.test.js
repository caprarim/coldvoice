'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { process } = require('../src/pipeline');

test('end-to-end: punctuation + fillers + capitalization', () => {
  const out = process('um hello comma world period new line this is uh great');
  assert.strictEqual(out, 'Hello, world.\nThis is great');
});

test('end-to-end with dictionary and snippets', () => {
  const out = process('deploy to super base comma email me at my email', {
    dictionary: [{ phrase: 'super base', replacement: 'Supabase' }],
    snippets: [{ trigger: 'my email', expansion: 'capra.rim6@gmail.com', enabled: true }],
  });
  assert.strictEqual(out, 'Deploy to Supabase, email me at capra.rim6@gmail.com');
});

test('raw style bypasses cleanup', () => {
  const out = process('um hello comma world', { style: 'raw' });
  assert.strictEqual(out, 'um hello comma world');
});

test('app scope selects professional style', () => {
  const out = process('I am gonna send it', { appId: 'Gmail' });
  assert.strictEqual(out, 'I am going to send it');
});

test('dictated questions stay as questions', () => {
  const out = process('what is the capital of france question mark');
  assert.strictEqual(out, 'What is the capital of france?');
});

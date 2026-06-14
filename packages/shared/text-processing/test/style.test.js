'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyStyle, styleForApp } = require('../src/style');

test('professional removes slang', () => {
  assert.strictEqual(applyStyle('I am gonna check it', 'professional'), 'I am going to check it');
});

test('casual keeps natural tone', () => {
  assert.strictEqual(applyStyle('I am gonna check it', 'casual'), 'I am gonna check it');
});

test('code mode preserves symbols and casing', () => {
  assert.strictEqual(applyStyle('const fooBar = 1;', 'code'), 'const fooBar = 1;');
});

test('raw transcript is untouched', () => {
  assert.strictEqual(applyStyle('um yeah whatever', 'raw'), 'um yeah whatever');
});

test('app scope maps to a style', () => {
  assert.strictEqual(styleForApp('WhatsApp'), 'casual');
  assert.strictEqual(styleForApp('Gmail'), 'professional');
  assert.strictEqual(styleForApp('VS Code'), 'code');
});

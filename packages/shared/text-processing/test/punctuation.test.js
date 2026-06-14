'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { convertSpokenPunctuation } = require('../src/punctuation');

test('comma and period hug the previous word', () => {
  assert.strictEqual(convertSpokenPunctuation('hello comma world period'), 'hello, world.');
});

test('question and exclamation marks', () => {
  assert.strictEqual(convertSpokenPunctuation('really question mark wow exclamation mark'), 'really? wow!');
});

test('full stop and new line', () => {
  assert.strictEqual(convertSpokenPunctuation('done full stop new line next'), 'done.\nnext');
});

test('parentheses spacing', () => {
  assert.strictEqual(convertSpokenPunctuation('note open paren important close paren'), 'note (important)');
});

test('new paragraph', () => {
  assert.strictEqual(convertSpokenPunctuation('one new paragraph two'), 'one\n\ntwo');
});

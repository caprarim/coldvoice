'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { removeFillers } = require('../src/fillers');

test('removes hesitation sounds', () => {
  assert.strictEqual(removeFillers('um so uh this is er the plan'), 'so this is the plan');
});

test('removes "you know" filler', () => {
  assert.strictEqual(removeFillers('this is you know really good'), 'this is really good');
});

test('removes "like" only when fenced by commas', () => {
  assert.strictEqual(removeFillers('it was, like, huge'), 'it was, huge');
});

test('keeps "like" as a real verb', () => {
  assert.strictEqual(removeFillers('I like coffee'), 'I like coffee');
});

test('does not remove "I mean" (left to backtracking)', () => {
  assert.strictEqual(removeFillers('go left I mean right'), 'go left I mean right');
});

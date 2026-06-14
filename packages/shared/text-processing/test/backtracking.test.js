'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyBacktracking } = require('../src/backtracking');

test('"actually" replaces the previous word', () => {
  assert.strictEqual(applyBacktracking('meet at five actually six'), 'meet at six');
});

test('"no," correction replaces the previous word', () => {
  assert.strictEqual(applyBacktracking('send it Monday, no, Friday'), 'send it Friday');
});

test('"I mean" correction replaces the previous word', () => {
  assert.strictEqual(applyBacktracking('go left I mean right'), 'go right');
});

test('"scratch that" deletes back to the clause start', () => {
  assert.strictEqual(applyBacktracking('remember to buy milk scratch that get bread'), 'get bread');
});

test('"delete last word" removes the preceding word', () => {
  assert.strictEqual(applyBacktracking('the meeting is on friday delete last word'), 'the meeting is on');
});

test('"delete last sentence" removes the preceding sentence', () => {
  assert.strictEqual(applyBacktracking('Hello there. This is wrong. delete last sentence'), 'Hello there.');
});

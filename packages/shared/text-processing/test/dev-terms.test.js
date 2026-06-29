'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyDevTerms } = require('../src/dev-terms');
const { process } = require('../src/pipeline');

test('bare filename becomes an @mention', () => {
  assert.strictEqual(applyDevTerms('I updated helper swift'), 'I updated @helper.swift');
});

test('"dot" filename becomes an @mention', () => {
  assert.strictEqual(applyDevTerms('open index dot html'), 'open @index.html');
});

test('spoken extension words map to real extensions', () => {
  assert.strictEqual(applyDevTerms('check main python'), 'check @main.py');
});

test('tech phrase wins over filename detection', () => {
  assert.strictEqual(applyDevTerms('make a next js page'), 'make a Next.js page');
});

test('tech terms get canonical casing', () => {
  assert.strictEqual(applyDevTerms('build with type script and tailwind'), 'build with TypeScript and Tailwind');
});

test('stopword is not tagged as a filename', () => {
  assert.strictEqual(applyDevTerms('read the html spec'), 'read the HTML spec');
});

test('multi-word tech term wins over single word', () => {
  assert.strictEqual(applyDevTerms('built in react native'), 'built in React Native');
});

test('common acronyms are upper-cased', () => {
  assert.strictEqual(applyDevTerms('updated the ipc call and the api'), 'updated the IPC call and the API');
});

test('pipeline applies dev terms only when developerMode is on', () => {
  const on = process('i updated the ipc call in helper swift', { developerMode: true });
  assert.strictEqual(on, 'I updated the IPC call in @helper.swift');
  const off = process('i updated the ipc call in helper swift', { developerMode: false });
  assert.strictEqual(off, 'I updated the ipc call in helper swift');
});

test('plain sentence without dev cues is untouched', () => {
  assert.strictEqual(applyDevTerms('the meeting is at noon'), 'the meeting is at noon');
});

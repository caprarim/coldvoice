'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { applyMishears } = require('../src/mishears');
const { process } = require('../src/pipeline');

test('full ColdVoice garble from screenshot is restored', () => {
  const raw =
    'Yes, but you have decreased and disrespected due to the non-launchiness of the agency. And I also wanted to check whether people can delete their account or not.';
  const out = applyMishears(raw);
  assert.match(out, /get straight to work/i);
  assert.match(out, /respectively/i);
  assert.match(out, /do not launch any sub-agents/i);
  assert.doesNotMatch(out, /non-launchiness/i);
  assert.doesNotMatch(out, /surveillance/i);
});

test('surveillance near launch becomes sub-agents', () => {
  assert.strictEqual(
    applyMishears('do not launch any surveillance'),
    'do not launch any sub-agents'
  );
});

test('subagency variants become sub-agents', () => {
  assert.strictEqual(applyMishears('no subagency please'), 'no sub-agents please');
  assert.strictEqual(applyMishears('no sub agency please'), 'no sub-agents please');
  assert.strictEqual(applyMishears('no sub-agency please'), 'no sub-agents please');
  assert.strictEqual(applyMishears('launch any sub agents'), 'launch any sub-agents');
});

test('instruction respectfully becomes respectively', () => {
  assert.strictEqual(
    applyMishears('please do this respectfully and fix it'),
    'please do this respectively and fix it'
  );
  assert.strictEqual(
    applyMishears('make these changes respectfully'),
    'make these changes respectively'
  );
});

test('bare respectfully only flips in developer mode', () => {
  assert.strictEqual(applyMishears('said respectfully'), 'said respectfully');
  assert.strictEqual(
    applyMishears('said respectfully', { developerMode: true }),
    'said respectively'
  );
});

test('pipeline applies mishears after formatting', () => {
  const out = process(
    'do not launch any surveillance and please do this respectfully',
    { developerMode: true }
  );
  assert.match(out, /sub-agents/i);
  assert.match(out, /respectively/i);
});

test('unrelated prose is untouched', () => {
  const s = 'The meeting is at noon and the weather is fine.';
  assert.strictEqual(applyMishears(s), s);
});

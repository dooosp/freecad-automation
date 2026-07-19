import assert from 'node:assert/strict';

import { resolvePartIndex } from '../public/js/app/scene-interactions.js';

const root = { userData: {}, parent: null };
const part = { userData: { partIndex: 1 }, parent: root };
const edgeLines = { userData: {}, parent: part };

assert.equal(resolvePartIndex(part, 2), 1, 'a directly hit part should resolve itself');
assert.equal(
  resolvePartIndex(edgeLines, 2),
  1,
  'a child edge-line hit should resolve the owning part from its parent chain',
);

const invalidChild = { userData: { partIndex: 9 }, parent: part };
assert.equal(
  resolvePartIndex(invalidChild, 2),
  1,
  'an out-of-bounds child index should not hide a valid owning part',
);
assert.equal(resolvePartIndex(part, 1), -1, 'an out-of-bounds part index should be rejected');
assert.equal(resolvePartIndex({ userData: {}, parent: root }, 2), -1, 'an unrelated object should not resolve');
assert.equal(resolvePartIndex(null, 2), -1, 'a missing intersection object should be safe');

console.log('scene-interactions.test.js: ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertSvgSnapshot, normalizeSvgSnapshot } from './helpers/svg-snapshot.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures', 'svg');
const SNAPSHOT_DIR = join(ROOT, 'tests', 'fixtures', 'snapshots', 'svg');
const EXPECT_UPDATED = process.env.UPDATE_SNAPSHOTS === '1';

const fixtureNames = ['techdraw_bracket', 'techdraw_assembly'];

for (const fixtureName of fixtureNames) {
  const svgText = readFileSync(join(FIXTURES_DIR, `${fixtureName}.svg`), 'utf8');
  const result = assertSvgSnapshot(fixtureName, svgText, { snapshotDir: SNAPSHOT_DIR });
  assert.equal(result.updated, EXPECT_UPDATED, `${fixtureName} baseline update state should match UPDATE_SNAPSHOTS`);
}

const noisySvg = `
<svg xmlns="http://www.w3.org/2000/svg" data-generated-at="2026-03-27T11:00:00Z" data-source-path="/Users/tester/tmp/output/example.svg">
  <defs><clipPath id="clipPath1001"><rect x="0" y="0" width="10" height="10" /></clipPath></defs>
  <g id="view-123e4567-e89b-12d3-a456-426614174000">
    <path clip-path="url(#clipPath1001)" d="M0 0 L10 0" />
  </g>
</svg>
`;

const stableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" data-generated-at="2026-03-27T12:00:00Z" data-source-path="/Users/tester/elsewhere/output/example.svg">
  <defs><clipPath id="clipPath9999"><rect x="0" y="0" width="10" height="10" /></clipPath></defs>
  <g id="view-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee">
    <path clip-path="url(#clipPath9999)" d="M0 0 L10 0" />
  </g>
</svg>
`;

assert.equal(normalizeSvgSnapshot(noisySvg), normalizeSvgSnapshot(stableSvg), 'Volatile metadata should normalize away');

const changedSvg = stableSvg.replace('L10 0', 'L11 0');
assert.notEqual(normalizeSvgSnapshot(noisySvg), normalizeSvgSnapshot(changedSvg), 'Meaningful geometry changes should survive normalization');

if (!EXPECT_UPDATED) {
  assert.throws(
    () => assertSvgSnapshot('techdraw_bracket', readFileSync(join(FIXTURES_DIR, 'techdraw_bracket.svg'), 'utf8').replace('L120 70', 'L121 70'), { snapshotDir: SNAPSHOT_DIR }),
    /SVG snapshot mismatch[\s\S]*First diff at line/,
    'Meaningful drawing changes should fail snapshot comparison with a useful diff'
  );
}

console.log('svg-snapshot.test.js: ok');

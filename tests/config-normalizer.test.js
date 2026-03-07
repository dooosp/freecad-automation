import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfig } from '../lib/config-loader.js';
import { normalizeConfig } from '../lib/config-normalizer.js';

const baseConfig = {
  name: 'schema-compat',
  shapes: [{ id: 'base', type: 'box', length: 10, width: 10, height: 10 }],
  operations: [{ type: 'fuse', base: 'base', tool: 'base' }],
  parts: [
    {
      id: 'child',
      shapes: [{ id: 'child_base', type: 'box', length: 5, width: 5, height: 5 }],
      operations: [{ type: 'cut', base: 'child_base', tool: 'child_base' }],
    },
  ],
};

const normalized = normalizeConfig(baseConfig);
assert.equal(baseConfig.operations[0].op, undefined, 'normalization should not mutate the original config');
assert.equal(normalized.operations[0].op, 'fuse');
assert.equal(normalized.parts[0].operations[0].op, 'cut');
assert.equal(normalized.parts[0].shapes[0].type, 'box', 'shape specs should retain their type field');

const tmpDir = mkdtempSync(join(tmpdir(), 'fcad-config-normalizer-'));
const cfgPath = join(tmpDir, 'compat.toml');
writeFileSync(cfgPath, `
name = "compat"

[[shapes]]
id = "body"
type = "box"
length = 10
width = 10
height = 4

[[operations]]
type = "fillet"
target = "body"
radius = 1
`, 'utf8');

const loaded = await loadConfig(cfgPath);
assert.equal(loaded.operations[0].op, 'fillet');
assert.equal(loaded.operations[0].type, 'fillet');

rmSync(tmpDir, { recursive: true, force: true });
console.log('config-normalizer.test.js: ok');

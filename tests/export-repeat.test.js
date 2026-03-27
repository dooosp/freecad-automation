import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runScript } from '../lib/runner.js';
import { hasFreeCADRuntime } from '../lib/paths.js';

if (!hasFreeCADRuntime()) {
  console.log('export-repeat.test.js: skipped (FreeCAD runtime not available)');
  process.exit(0);
}

const outDir = mkdtempSync(join(tmpdir(), 'fcad-export-repeat-'));

try {
  const config = {
    name: 'step_repeat_box',
    shapes: [{ id: 'box', type: 'box', length: 10, width: 20, height: 30 }],
    operations: [],
    export: { formats: ['step'], directory: outDir },
  };

  const first = await runScript('create_model.py', config, { timeout: 120_000 });
  const second = await runScript('create_model.py', config, { timeout: 120_000 });
  const stepPath = join(outDir, 'step_repeat_box.step');
  const inspected = await runScript('inspect_model.py', { file: stepPath }, { timeout: 60_000 });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(existsSync(stepPath), true);
  assert.equal(inspected.success, true);
  assert(Math.abs(inspected.model.volume - 6000) < 1, `expected STEP volume ~6000, got ${inspected.model.volume}`);

  console.log('export-repeat.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

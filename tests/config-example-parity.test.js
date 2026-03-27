import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { readRawConfigFile, validateConfigDocument } from '../lib/config-schema.js';

const ROOT = resolve(import.meta.dirname, '..');
const CANONICAL_EXAMPLES = [
  'configs/examples/ks_bracket.toml',
  'configs/examples/bracket_fem.toml',
  'configs/examples/infotainment_display_bracket.toml',
  'configs/examples/controller_housing.toml',
  'configs/examples/controller_housing_eol.toml',
  'configs/examples/pcb_mount_plate.toml',
];

function visitOperationLists(config, visitor) {
  if (!config || typeof config !== 'object') return;

  if (Array.isArray(config.operations)) {
    visitor(config.operations);
  }

  if (Array.isArray(config.parts)) {
    for (const part of config.parts) {
      visitOperationLists(part, visitor);
    }
  }
}

function buildLegacyVariant(config) {
  const legacy = structuredClone(config);
  delete legacy.config_version;

  if (legacy.manufacturing?.material && legacy.material === undefined) {
    legacy.material = legacy.manufacturing.material;
  }
  if (legacy.manufacturing?.process && legacy.process === undefined) {
    legacy.process = legacy.manufacturing.process;
  }

  if (Array.isArray(legacy.export?.formats)) {
    for (const format of legacy.export.formats) {
      legacy.export[format] = true;
    }
    delete legacy.export.formats;
  }

  visitOperationLists(legacy, (operations) => {
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      if (typeof operation.op === 'string') {
        operation.type = operation.op;
        delete operation.op;
      }
    }
  });

  return legacy;
}

function stripCompatibilityFields(config) {
  const stripped = structuredClone(config);
  delete stripped.material;
  delete stripped.process;

  if (stripped.export && typeof stripped.export === 'object' && !Array.isArray(stripped.export)) {
    for (const key of ['step', 'stl', 'brep', 'dxf', 'svg', 'pdf']) {
      delete stripped.export[key];
    }
  }

  visitOperationLists(stripped, (operations) => {
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      delete operation.type;
    }
  });

  return stripped;
}

for (const relativePath of CANONICAL_EXAMPLES) {
  const absolutePath = resolve(ROOT, relativePath);
  const { parsed } = await readRawConfigFile(absolutePath);
  const canonical = validateConfigDocument(parsed, { filepath: absolutePath });

  assert.equal(canonical.valid, true, `${relativePath} should validate cleanly`);
  assert.equal(
    canonical.summary.warnings.length,
    0,
    `${relativePath} should stay strict-clean, found warnings: ${canonical.summary.warnings.join(' | ')}`
  );
  assert.equal(canonical.config.config_version, 1, `${relativePath} should load as config_version = 1`);

  const legacy = validateConfigDocument(buildLegacyVariant(parsed), {
    filepath: `${absolutePath}#legacy-parity`,
  });

  assert.equal(legacy.valid, true, `${relativePath} legacy compatibility variant should still validate`);
  assert(
    legacy.summary.warnings.length > 0,
    `${relativePath} legacy compatibility variant should emit migration warnings`
  );
  assert.deepEqual(
    stripCompatibilityFields(legacy.config),
    stripCompatibilityFields(canonical.config),
    `${relativePath} migrated legacy variant should preserve effective behavior`
  );
}

console.log('config-example-parity.test.js: ok');

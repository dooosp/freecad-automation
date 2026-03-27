import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfigWithDiagnostics } from '../lib/config-schema.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-config-schema-'));

function runCli(args) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

try {
  const checkedInStrictPath = resolve(ROOT, 'configs', 'examples', 'controller_housing_eol.toml');
  const validConfigPath = join(TMP_DIR, 'valid-config.toml');
  writeFileSync(validConfigPath, `
config_version = 1
name = "valid_bracket"
final = "body_fillet"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 4

[[operations]]
op = "fillet"
target = "body"
radius = 1
result = "body_fillet"

[drawing]
views = ["front", "top"]

[export]
formats = ["step"]
directory = "output"
`, 'utf8');

  const invalidConfigPath = join(TMP_DIR, 'invalid-config.json');
  writeFileSync(invalidConfigPath, JSON.stringify({
    config_version: 1,
    name: 'invalid_bracket',
    shapes: 'not-an-array',
    operations: [{ radius: 1 }],
    export: { formats: ['step', 5] },
  }, null, 2), 'utf8');

  const invalidNestedPath = join(TMP_DIR, 'invalid-nested.toml');
  writeFileSync(invalidNestedPath, `
config_version = 1
name = "invalid_nested"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 4

[production]
sites = "Korea-Ulsan"
target_ct_sec = "36"

[quality.traceability]
serial_level = 42

[[quality.critical_dimensions]]
id = "cd-01"
target_mm = "140"
tolerance = "±0.10"

[drawing]
views = "front"

[standards]
profile = 3

[export]
formats = ["step"]
`, 'utf8');

  const legacyConfigPath = join(TMP_DIR, 'legacy-config.toml');
  writeFileSync(legacyConfigPath, `
name = "legacy_bracket"
material = "AL6061"
process = "machining"

[[shapes]]
id = "body"
type = "box"
length = 20
width = 10
height = 4

[[operations]]
type = "fillet"
target = "body"
radius = 1
result = "body_fillet"

[export]
step = true
stl = true
directory = "output"
`, 'utf8');

  const validHuman = runCli(['validate-config', validConfigPath]);
  assert.equal(validHuman.status, 0, validHuman.stderr || validHuman.stdout);
  assert.match(validHuman.stdout, /VALID:/);
  assert.doesNotMatch(validHuman.stdout, /Deprecated fields:/);

  const validJson = runCli(['validate-config', validConfigPath, '--json']);
  assert.equal(validJson.status, 0, validJson.stderr || validJson.stdout);
  const validParsed = JSON.parse(validJson.stdout);
  assert.equal(validParsed.valid, true);
  assert.equal(validParsed.counts.errors, 0);
  assert.equal(validParsed.counts.warnings, 0);
  assert.equal(validParsed.target_version, 1);

  const invalidJson = runCli(['validate-config', invalidConfigPath, '--json']);
  assert.notEqual(invalidJson.status, 0, 'invalid config should fail validation');
  const invalidParsed = JSON.parse(invalidJson.stdout);
  assert.equal(invalidParsed.valid, false);
  assert(invalidParsed.counts.errors >= 2, 'invalid config should report multiple actionable errors');
  assert(invalidParsed.errors.some((entry) => entry.includes('root.shapes')), 'invalid shapes type should be called out');
  assert(
    invalidParsed.errors.some((entry) => entry.includes('root.operations[0] must include `op`')),
    'missing operation op/type should be called out'
  );

  const invalidNested = runCli(['validate-config', invalidNestedPath, '--json']);
  assert.notEqual(invalidNested.status, 0, 'invalid nested config should fail validation');
  const invalidNestedParsed = JSON.parse(invalidNested.stdout);
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.production.sites')),
    'production.sites type mismatch should be surfaced'
  );
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.production.target_ct_sec')),
    'production.target_ct_sec type mismatch should be surfaced'
  );
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.quality.traceability.serial_level')),
    'quality.traceability.serial_level type mismatch should be surfaced'
  );
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.quality.critical_dimensions[0].target_mm')),
    'quality.critical_dimensions target_mm type mismatch should be surfaced'
  );
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.drawing.views')),
    'drawing.views type mismatch should be surfaced'
  );
  assert(
    invalidNestedParsed.errors.some((entry) => entry.includes('root.standards.profile')),
    'standards.profile type mismatch should be surfaced'
  );

  const validateLegacy = runCli(['validate-config', legacyConfigPath]);
  assert.equal(validateLegacy.status, 0, validateLegacy.stderr || validateLegacy.stdout);
  assert.match(validateLegacy.stdout, /VALID:/);
  assert.match(validateLegacy.stdout, /Changed fields:/);
  assert.match(validateLegacy.stdout, /Deprecated fields:/);
  assert.match(validateLegacy.stdout, /root\.material/);
  assert.match(validateLegacy.stdout, /root\.process/);

  const strictLegacy = runCli(['validate-config', legacyConfigPath, '--strict']);
  assert.notEqual(strictLegacy.status, 0, 'strict validation should fail when warnings are present');

  const strictCheckedIn = runCli(['validate-config', checkedInStrictPath, '--strict']);
  assert.equal(
    strictCheckedIn.status,
    0,
    `checked-in canonical example should pass strict validation: ${strictCheckedIn.stderr || strictCheckedIn.stdout}`
  );

  const migrationWarnings = [];
  const loadedLegacy = await loadConfigWithDiagnostics(legacyConfigPath, {
    onWarning: (warning) => migrationWarnings.push(warning),
  });
  assert(migrationWarnings.some((entry) => entry.includes('root.material')), 'normal loading should emit deprecation warnings');

  const migratedPath = join(TMP_DIR, 'legacy-config.migrated.toml');
  const migrate = runCli(['migrate-config', legacyConfigPath, '--out', migratedPath]);
  assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);
  assert.equal(existsSync(migratedPath), true);
  assert.match(migrate.stdout, /Migrated config written to:/);
  assert.match(migrate.stdout, /Changed fields:/);
  assert.match(migrate.stdout, /Deprecated fields:/);

  const migratedText = readFileSync(migratedPath, 'utf8');
  assert.match(migratedText, /config_version = 1/);
  assert.match(migratedText, /formats = \[\s*"step", "stl"\s*\]/);
  assert.match(migratedText, /op = "fillet"/);
  assert.match(migratedText, /\[manufacturing\]/);

  const loadedMigrated = await loadConfigWithDiagnostics(migratedPath);
  assert.deepEqual(loadedMigrated.config, loadedLegacy.config, 'migrated config should preserve effective runtime behavior');

  console.log('config-schema-cli.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  buildArtifactManifest,
  validateArtifactManifest,
  writeArtifactManifest,
} from '../lib/artifact-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-artifact-manifest-'));

try {
  const artifactPath = join(TMP_DIR, 'output.json');
  writeFileSync(artifactPath, JSON.stringify({ ok: true }, null, 2), 'utf8');

  const manifest = await buildArtifactManifest({
    projectRoot: ROOT,
    interface: 'cli',
    command: 'readiness-report',
    status: 'succeeded',
    configPath: join(ROOT, 'configs', 'examples', 'controller_housing_eol.toml'),
    configSummary: {
      input_version: 1,
      target_version: 1,
      warnings: ['Example warning'],
      deprecated_fields: ['root.process is compatibility-only; prefer root.manufacturing.process.'],
      changed_fields: [],
    },
    selectedProfile: 'site_korea_ulsan',
    ruleProfile: {
      id: 'ks-basic',
      label: 'KS basic',
      description: '',
      standards_pack: { id: 'ks-basic', label: 'KS basic' },
      material_pack: { id: 'common-metals-basic', label: 'Common metals basic' },
      process_pack: { id: 'ks-basic', label: 'KS basic' },
      selection: { requested: 'ks-basic', resolved: 'ks-basic', reason: 'requested' },
    },
    artifacts: [
      {
        type: 'review.readiness.json',
        path: artifactPath,
        label: 'Readiness report JSON',
        scope: 'user-facing',
        stability: 'stable',
      },
    ],
    timestamps: {
      created_at: '2026-03-27T00:00:00.000Z',
      started_at: '2026-03-27T00:00:00.000Z',
      finished_at: '2026-03-27T00:00:01.000Z',
    },
  });

  const validation = validateArtifactManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.manifest_version, '1.0');
  assert.equal(manifest.command, 'readiness-report');
  assert.equal(manifest.selected_profile, 'site_korea_ulsan');
  assert.equal(manifest.rule_packs.standards.id, 'ks-basic');
  assert.equal(manifest.artifacts[0].exists, true);
  assert.equal(typeof manifest.artifacts[0].sha256, 'string');

  const schema = JSON.parse(
    readFileSync(join(ROOT, 'schemas', 'artifact-manifest.schema.json'), 'utf8')
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  assert.equal(validate(manifest), true, (validate.errors || []).map((error) => error.message).join('\n'));

  const manifestPath = join(TMP_DIR, 'artifact-manifest.json');
  await writeArtifactManifest(manifestPath, manifest);
  const persisted = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(persisted.artifacts[0].path, artifactPath);

  console.log('artifact-manifest.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

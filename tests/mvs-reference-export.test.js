import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildOutputManifest } from '../lib/output-manifest.js';
import { exportReference } from '../scripts/export-mvs-reference.js';

const root = resolve(import.meta.dirname, '..');
await mkdir(join(root, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(join(root, 'tmp/codex/mvs-export-test-'));
try {
  const configPath = join(temp, 'config.json');
  const modelPath = join(temp, 'model.brep');
  const sourceManifestPath = join(temp, 'source.json');
  const config = JSON.parse(await readFile(join(root, 'configs/examples/usb_hub_reference_mount.json')));
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(modelPath, 'inert fake native bytes for refusal tests only');
  async function manifest() {
    const value = await buildOutputManifest({
      projectRoot: root, command: 'create', inputPath: configPath,
      outputs: [{ path: modelPath, kind: 'model.brep' }], status: 'pass',
      repoContext: { root, headSha: '1'.repeat(40), branch: 'unit-test', dirtyAtStart: false },
      runtimeDiagnostics: { status: 'not_invoked', available: false, probe_status: 'not_invoked' },
    });
    await writeFile(sourceManifestPath, JSON.stringify(value));
  }
  await manifest();
  const options = { configPath, modelPath, sourceManifestPath, partId: 'USB-REF-ADAPTER',
    cadRevision: 'R1', outDir: join(temp, 'export') };
  await assert.rejects(exportReference({ ...options, sourceManifestPath: join(temp, 'missing') }), /ENOENT|manifest/i);
  await writeFile(modelPath, 'changed');
  await assert.rejects(exportReference(options), /model.*hash|CAD.*hash/i);
  await manifest();
  await writeFile(configPath, JSON.stringify({ ...config, name: 'changed' }));
  await assert.rejects(exportReference(options), /config.*hash|input.*hash/i);
  await writeFile(configPath, JSON.stringify({ ...config, shapes: config.shapes.filter(s => s.id !== 'hole_H4') }));
  await manifest();
  await assert.rejects(exportReference(options), /eight|hole_H4/i);
  await writeFile(configPath, JSON.stringify(config));
  await manifest();
  await assert.rejects(exportReference(options, { runNative: async () => { throw new Error('native failed'); } }), /native failed/);
  await assert.rejects(access(options.outDir), /ENOENT/);
  const dangling = join(temp, 'dangling-output');
  await symlink(join(temp, 'absent-target'), dangling);
  await assert.rejects(exportReference({ ...options, outDir: dangling }, {
    runNative: async () => { throw new Error('must reject existing link before native'); },
  }), /directory exists/);
  await mkdir(options.outDir);
  await writeFile(join(options.outDir, 'keep'), 'original');
  await assert.rejects(exportReference(options), /exists|overwrite/i);
  assert.equal(await readFile(join(options.outDir, 'keep'), 'utf8'), 'original');
  console.log('mvs-reference-export.test.js: ok');
} finally { await rm(temp, { recursive: true, force: true }); }

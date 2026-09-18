#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runScript } from '../lib/runner.js';
import { buildOutputManifest, collectRepoContext, validateOutputManifest, writeOutputManifest } from '../lib/output-manifest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
async function exists(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

export async function exportReference({ configPath, modelPath, sourceManifestPath, outDir, partId, cadRevision }, { runNative = runScript } = {}) {
  const startedAt = new Date().toISOString();
  for (const value of [configPath, modelPath, sourceManifestPath, outDir, partId, cadRevision]) {
    if (typeof value !== 'string' || !value) throw new Error('All explicit input/output paths and identities are required');
  }
  outDir = resolve(outDir);
  if (await exists(outDir)) throw new Error('Output directory exists; refusing overwrite');
  const configBytes = await readFile(configPath);
  const modelBytes = await readFile(modelPath);
  const sourceBytes = await readFile(sourceManifestPath);
  const config = JSON.parse(configBytes);
  const source = JSON.parse(sourceBytes);
  const validation = validateOutputManifest(source);
  if (!validation.ok || source.command !== 'create' || source.status !== 'pass') throw new Error('Source must be a passing create output manifest');
  if (hash(configBytes) !== source.input.sha256 || configBytes.length !== source.input.size_bytes) throw new Error('Config input hash differs from source manifest');
  const suffix = extname(modelPath).toLowerCase();
  if (!['.brep', '.step'].includes(suffix)) throw new Error('Only explicit single-part BREP/STEP is supported');
  const modelHash = hash(modelBytes);
  if (!source.outputs.some(entry => entry.kind === `model${suffix}` && entry.sha256 === modelHash && entry.exists && entry.size_bytes === modelBytes.length)) throw new Error('CAD model hash differs from source manifest');
  const expectedIds = ['H', 'P'].flatMap(group => [1, 2, 3, 4].map(i => `hole_${group}${i}`));
  const holes = config.shapes?.filter(shape => shape.id?.startsWith('hole_')) ?? [];
  if (JSON.stringify(holes.map(shape => shape.id).sort()) !== JSON.stringify(expectedIds)) throw new Error('Config requires exactly eight expected hole_H1..H4/hole_P1..P4 features');
  if (partId !== 'USB-REF-ADAPTER' || cadRevision !== config.product?.revision) throw new Error('Part/revision does not match the supported config identity');
  const repoContext = collectRepoContext(ROOT);
  const scriptNames = ['scripts/export-mvs-reference.js', 'scripts/export_mvs_reference.py', 'scripts/mvs_reference_projection.py'];
  const sourceHashes = [];
  for (const name of scriptNames) sourceHashes.push([name, hash(await readFile(join(ROOT, name)))]);
  await mkdir(dirname(outDir), { recursive: true });
  const staging = await mkdtemp(join(dirname(outDir), `.${basename(outDir)}-staging-`));
  try {
    const snapshotModel = join(staging, `native-input${suffix}`);
    await writeFile(snapshotModel, modelBytes, { flag: 'wx' });
    const native = await runNative('export_mvs_reference.py', { config, model_path: snapshotModel, image_path: join(staging, 'reference.png') });
    if (native.success !== true || native.valid_shape !== true || native.features?.length !== 8) throw new Error('Native inspection did not return a valid eight-hole plate');
    await rm(snapshotModel);
    const identity = { part_id: partId, cad_revision: cadRevision };
    const metadata = { profile: 'coolgear-plate-top/v1', part_identity: identity, source_kind: 'native_freecad',
      source_manifest_sha256: hash(sourceBytes), source_manifest_base64: sourceBytes.toString('base64'),
      source_commit: source.repo.head_sha, config_sha256: hash(configBytes), model_sha256: modelHash,
      producer_commit: repoContext.headSha, producer_source_sha256: hash(jsonBytes(sourceHashes)),
      freecad_version: native.freecad_version, width_px: 1520, height_px: 840, units: 'mm',
      cad_to_pixel: [[10, 0, 50], [0, -10, 790], [0, 0, 1]], holes: native.holes,
      physical_test: 'not_tested', manufacturing_release: false, installed_load_rating_N: null, fastening_torque_Nm: null };
    await writeFile(join(staging, 'feature-map.json'), jsonBytes({ profile: metadata.profile, features: native.features }), { flag: 'wx' });
    await writeFile(join(staging, 'cad-metadata.json'), jsonBytes(metadata), { flag: 'wx' });
    const artifacts = [];
    for (const [name, role, media] of [['reference.png', 'reference_render', 'image/png'], ['feature-map.json', 'feature_map', 'application/json'], ['cad-metadata.json', 'cad_metadata', 'application/json']]) {
      const data = await readFile(join(staging, name));
      artifacts.push({ artifact_id: role, role, relative_path: name, media_type: media, sha256: hash(data), byte_size: data.length });
    }
    const manifest = { schema_version: '1.0.0', adapter_id: 'freecad-automation-read-only-export', adapter_version: '1.0.0',
      export_id: `coolgear-${cadRevision.toLowerCase()}-${hash(sourceBytes).slice(0, 16)}`,
      producer: { system_id: 'freecad-automation', system_version: '1.1.0', export_schema_version: '1.0.0', exported_at: startedAt },
      part_identity: identity, source_manifest_sha256: hash(sourceBytes),
      adapter_policy: { access_mode: 'read_only', copy_on_import: true, allow_external_paths: false, allow_symlinks: false, execute_freecad: false },
      features: native.features, artifacts,
      limitations: ['Native CAD silhouette in declared top view; no camera calibration or physical testing.', 'Eight hole ROIs only; no exterior-edge inspection region. Manufacturing release is false.'] };
    await writeFile(join(staging, 'freecad-export-adapter-manifest.json'), jsonBytes(manifest), { flag: 'wx' });
    const outputRecords = [];
    for (const name of [...artifacts.map(a => a.relative_path), 'freecad-export-adapter-manifest.json']) {
      const data = await readFile(join(staging, name));
      outputRecords.push({ path: join(outDir, name), kind: `mvs-reference.${name}`, exists: true, size_bytes: data.length, sha256: hash(data) });
    }
    const output = await buildOutputManifest({ projectRoot: ROOT, repoContext, command: 'export-mvs-reference',
      commandArgs: ['--config', resolve(configPath), '--model', resolve(modelPath), '--source-manifest', resolve(sourceManifestPath), '--out-dir', outDir, '--part-id', partId, '--cad-revision', cadRevision],
      inputPath: resolve(configPath), inputRecord: { path: resolve(configPath), sha256: hash(configBytes), size_bytes: configBytes.length },
      outputRecords, status: 'pass', timings: { startedAt, finishedAt: new Date().toISOString() } });
    await writeOutputManifest(join(staging, 'output-manifest.json'), output);
    if (await exists(outDir)) throw new Error('Output directory exists; refusing overwrite');
    await rename(staging, outDir);
    return { outDir, manifest_sha256: hash(jsonBytes(manifest)), export_id: manifest.export_id };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const keys = { '--config': 'configPath', '--model': 'modelPath', '--source-manifest': 'sourceManifestPath', '--out-dir': 'outDir', '--part-id': 'partId', '--cad-revision': 'cadRevision' };
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = keys[process.argv[i]];
      if (!key || !process.argv[i + 1] || options[key]) throw new Error(`Invalid or duplicate argument: ${process.argv[i]}`);
      options[key] = process.argv[i + 1];
    }
    console.log(JSON.stringify(await exportReference(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

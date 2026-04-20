import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { validateArtifactManifest } from '../lib/artifact-manifest.js';
import { validateCreateQualityReport } from '../lib/create-quality.js';
import { validateOutputManifest } from '../lib/output-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = join(ROOT, 'output', 'runtime-smoke');
const CONFIG_DIR = join(ROOT, 'output', 'runtime-smoke-configs');
const REPORT_DIR = join(ROOT, 'output');
const MANIFEST_PATH = join(OUTPUT_DIR, 'smoke-manifest.json');

const smokeManifest = {
  generated_at: new Date().toISOString(),
  source_configs: [],
  commands: [],
  artifact_manifests: [],
  artifacts: [],
  excluded_commands: [
    {
      command: 'tolerance',
      reason: 'Assembly-plus-Monte-Carlo runtime flow is still left to deeper local validation so the repository-owned smoke lane stays stable.',
    },
  ],
};

function runCli(args) {
  const completed = spawnSync('node', [join(ROOT, 'bin', 'fcad.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (completed.stdout) process.stdout.write(completed.stdout);
  if (completed.stderr) process.stderr.write(completed.stderr);

  assert.equal(
    completed.status,
    0,
    `Command failed: fcad ${args.join(' ')}`
  );

  smokeManifest.commands.push({
    command: `fcad ${args.join(' ')}`,
    status: completed.status,
  });

  return completed;
}

function runCliExpectFailure(args) {
  const completed = spawnSync('node', [join(ROOT, 'bin', 'fcad.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (completed.stdout) process.stdout.write(completed.stdout);
  if (completed.stderr) process.stderr.write(completed.stderr);

  assert.notEqual(
    completed.status,
    0,
    `Command unexpectedly passed: fcad ${args.join(' ')}`
  );

  smokeManifest.commands.push({
    command: `fcad ${args.join(' ')}`,
    status: completed.status,
    expected_failure: true,
  });

  return completed;
}

function cloneConfigWithOutput(sourcePath, targetName, rewrittenName) {
  const source = readFileSync(sourcePath, 'utf8');
  const escapedOutputDir = OUTPUT_DIR.replace(/\\/g, '\\\\');
  const withOutputDir = source.replace(
    /directory\s*=\s*"[^"]*"/,
    `directory = "${escapedOutputDir}"`
  );
  const rewritten = withOutputDir.replace(
    /^name\s*=\s*"[^"]*"/m,
    `name = "${rewrittenName}"`
  );

  const targetPath = join(CONFIG_DIR, targetName);
  writeFileSync(targetPath, rewritten, 'utf8');
  return targetPath;
}

function assertArtifact(path) {
  assert.equal(existsSync(path), true, `Expected artifact to exist: ${path}`);
  const stats = statSync(path);
  assert(stats.size > 0, `Expected artifact to be non-empty: ${path}`);
  smokeManifest.artifacts.push({
    path,
    size_bytes: stats.size,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function syncArtifactsForReport(baseName) {
  const artifactNames = [
    `${baseName}_create_quality.json`,
    `${baseName}_drawing_quality.json`,
    `${baseName}_manifest.json`,
    `${baseName}_drawing_manifest.json`,
    `${baseName}_traceability.json`,
  ];

  for (const artifactName of artifactNames) {
    const sourcePath = join(OUTPUT_DIR, artifactName);
    const targetPath = join(REPORT_DIR, artifactName);
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function assertTimestamp(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T/, `${label} must be ISO-like`);
}

function assertManifestArtifactRecord(record) {
  assert.equal(record.exists, true, `Manifest artifact missing on disk: ${record.path}`);
  assert.equal(typeof record.type, 'string', `Manifest artifact type missing for ${record.path}`);
  assert.equal(typeof record.path, 'string', 'Manifest artifact path must be a string');
  assert.equal(typeof record.scope, 'string', `Manifest artifact scope missing for ${record.type}`);
  assert.equal(typeof record.stability, 'string', `Manifest artifact stability missing for ${record.type}`);
  assert.equal(Number.isInteger(record.size_bytes), true, `Manifest artifact size missing for ${record.type}`);
  assert(record.size_bytes > 0, `Manifest artifact must be non-empty: ${record.path}`);
  assert.match(record.sha256 || '', /^[a-f0-9]{64}$/, `Manifest artifact sha256 missing for ${record.path}`);
  const stats = statSync(record.path);
  assert.equal(stats.size, record.size_bytes, `Manifest size mismatch for ${record.path}`);
}

function assertArtifactManifest(manifestPath, {
  command,
  requiredArtifactTypes = [],
  expectedConfigSuffix = null,
  detailChecks = null,
} = {}) {
  assertArtifact(manifestPath);
  const manifest = readJson(manifestPath);
  const validation = validateArtifactManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.command, command);
  assert.equal(manifest.status, 'succeeded');
  assert.equal(manifest.interface, 'cli');
  assert.equal(manifest.manifest_type, 'fcad.artifact-manifest');
  assertTimestamp(manifest.timestamps?.created_at, `${command} manifest created_at`);
  assertTimestamp(manifest.timestamps?.finished_at, `${command} manifest finished_at`);
  assert.equal(Array.isArray(manifest.artifacts), true, `${command} manifest artifacts must be an array`);
  assert.equal(typeof manifest.runtime?.freecad?.available, 'boolean', `${command} manifest must include runtime availability`);
  assert.equal(manifest.runtime?.freecad?.available, true, `${command} manifest should record a live FreeCAD runtime`);
  assert.equal(typeof manifest.runtime?.freecad?.version, 'string', `${command} manifest must include a FreeCAD version`);
  if (expectedConfigSuffix) {
    assert.match(
      manifest.config_path || '',
      new RegExp(`${expectedConfigSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    );
  }

  const stableUserFacingArtifacts = manifest.artifacts.filter(
    (artifact) => artifact.scope === 'user-facing' && artifact.stability === 'stable'
  );
  assert(
    stableUserFacingArtifacts.length > 0,
    `${command} manifest should contain at least one stable user-facing artifact`
  );

  for (const artifact of stableUserFacingArtifacts) {
    assertManifestArtifactRecord(artifact);
  }

  for (const artifactType of requiredArtifactTypes) {
    const artifact = manifest.artifacts.find((entry) => entry.type === artifactType);
    assert(artifact, `${command} manifest missing artifact type ${artifactType}`);
    assertManifestArtifactRecord(artifact);
  }

  if (detailChecks) {
    detailChecks(manifest);
  }

  smokeManifest.artifact_manifests.push({
    command,
    path: manifestPath,
    required_artifact_types: requiredArtifactTypes,
    stable_user_facing_types: stableUserFacingArtifacts.map((artifact) => artifact.type),
  });

  for (const artifact of stableUserFacingArtifacts) {
    smokeManifest.artifacts.push({
      command,
      type: artifact.type,
      path: artifact.path,
      size_bytes: artifact.size_bytes,
      sha256: artifact.sha256,
    });
  }

  return manifest;
}

function assertOutputManifest(manifestPath, { command, linkedQualityPath = null } = {}) {
  assertArtifact(manifestPath);
  const manifest = readJson(manifestPath);
  const validation = validateOutputManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.command, command);
  if (linkedQualityPath) {
    assert.equal(manifest.linked_artifacts.quality_json, linkedQualityPath);
  }
  return manifest;
}

rmSync(OUTPUT_DIR, { recursive: true, force: true });
mkdirSync(CONFIG_DIR, { recursive: true });

const bracketConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'ks_bracket.toml'),
  'ks_bracket.runtime-smoke.toml',
  'ks_bracket_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'ks_bracket.toml'));

const femConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'bracket_fem.toml'),
  'bracket_fem.runtime-smoke.toml',
  'bracket_fem_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'bracket_fem.toml'));

const qualityPassConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'quality_pass_bracket.toml'),
  'quality_pass_bracket.runtime-smoke.toml',
  'quality_pass_bracket_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'quality_pass_bracket.toml'));

rmSync(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'), { force: true });
rmSync(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report_artifact-manifest.json'), { force: true });
rmSync(join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report.pdf'), { force: true });
rmSync(join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report_artifact-manifest.json'), { force: true });
rmSync(join(REPORT_DIR, 'bracket_fem_runtime_smoke.FCStd'), { force: true });
rmSync(join(OUTPUT_DIR, 'bracket_fem_runtime_smoke_fem_artifact-manifest.json'), { force: true });

runCli(['check-runtime']);
runCli(['create', bracketConfig]);
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step'));
const createQualityPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_create_quality.json');
assertArtifact(createQualityPath);
const createQuality = readJson(createQualityPath);
const createQualityValidation = validateCreateQualityReport(createQuality);
assert.equal(createQualityValidation.ok, true, createQualityValidation.errors.join('\n'));
assert.notEqual(createQuality.status, 'skipped', 'live runtime smoke should not report skipped create quality');
assert.equal(createQuality.step_roundtrip.reimport_attempted, true);
assert.equal(createQuality.stl_quality.mesh_load_attempted, true);
assertArtifactManifest(
  join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_artifact-manifest.json'),
  {
    command: 'create',
    requiredArtifactTypes: ['model.step', 'model.stl'],
    expectedConfigSuffix: 'output/runtime-smoke-configs/ks_bracket.runtime-smoke.toml',
  }
);
assertOutputManifest(
  join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_manifest.json'),
  {
    command: 'create',
    linkedQualityPath: createQualityPath,
  }
);
assert.equal(createQuality.status, 'fail');

const ksStrictCreate = runCliExpectFailure(['create', bracketConfig, '--strict-quality']);
assert.match(
  `${ksStrictCreate.stdout}\n${ksStrictCreate.stderr}`,
  /strict-quality found blocking quality issues|Strict create quality gate failed/i
);

runCli(['draw', bracketConfig, '--bom']);
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing.svg'));
assertArtifact(join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_qa.json'));
const bomArtifact = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_bom.csv');
if (existsSync(bomArtifact)) {
  assertArtifact(bomArtifact);
}
assertArtifactManifest(
  join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_artifact-manifest.json'),
  {
    command: 'draw',
    requiredArtifactTypes: ['drawing.svg', 'drawing.qa-report'],
    expectedConfigSuffix: 'output/runtime-smoke-configs/ks_bracket.runtime-smoke.toml',
  }
);
const ksDrawingQualityPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_quality.json');
assertArtifact(ksDrawingQualityPath);
const ksDrawingQuality = readJson(ksDrawingQualityPath);
assert.equal(ksDrawingQuality.status, 'fail');

const ksStrictDraw = runCliExpectFailure(['draw', bracketConfig, '--bom', '--strict-quality']);
assert.match(
  `${ksStrictDraw.stdout}\n${ksStrictDraw.stderr}`,
  /Strict drawing quality gate failed/i
);

runCli(['inspect', join(OUTPUT_DIR, 'ks_bracket_runtime_smoke.step')]);
runCli([
  'fem',
  femConfig,
  '--manifest-out',
  join(OUTPUT_DIR, 'bracket_fem_runtime_smoke_fem_artifact-manifest.json'),
]);
assertArtifact(join(OUTPUT_DIR, 'bracket_fem_runtime_smoke.step'));
assertArtifactManifest(
  join(OUTPUT_DIR, 'bracket_fem_runtime_smoke_fem_artifact-manifest.json'),
  {
    command: 'fem',
    requiredArtifactTypes: ['analysis.fem.step'],
    expectedConfigSuffix: 'output/runtime-smoke-configs/bracket_fem.runtime-smoke.toml',
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.analysis_type, 'static');
      assert.equal(typeof manifest.details?.export_count, 'number');
      assert(manifest.details.export_count >= 1, 'FEM smoke should export at least one artifact');
      assert.equal(typeof manifest.details?.safety_factor, 'number');
      assert(manifest.details.safety_factor > 0, 'FEM smoke should report a positive safety factor');
    },
  }
);

syncArtifactsForReport('ks_bracket_runtime_smoke');
runCli(['report', bracketConfig, '--dfm']);
assertArtifact(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'));
const ksReportSummaryPath = join(REPORT_DIR, 'ks_bracket_runtime_smoke_report_summary.json');
assertArtifact(ksReportSummaryPath);
const ksReportSummary = readJson(ksReportSummaryPath);
assert.equal(ksReportSummary.ready_for_manufacturing_review, false);
assert.equal(ksReportSummary.overall_status, 'fail');
assertArtifactManifest(
  join(REPORT_DIR, 'ks_bracket_runtime_smoke_report_artifact-manifest.json'),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: 'output/runtime-smoke-configs/ks_bracket.runtime-smoke.toml',
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.include_fem, false);
      assert.equal(manifest.details?.include_tolerance, true);
    },
  }
);

runCli(['create', qualityPassConfig, '--strict-quality']);
const qualityPassCreateQualityPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_create_quality.json');
assertArtifact(qualityPassCreateQualityPath);
const qualityPassCreateQuality = readJson(qualityPassCreateQualityPath);
const qualityPassCreateValidation = validateCreateQualityReport(qualityPassCreateQuality);
assert.equal(qualityPassCreateValidation.ok, true, qualityPassCreateValidation.errors.join('\n'));
assert.equal(qualityPassCreateQuality.status, 'pass');
assertOutputManifest(
  join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_manifest.json'),
  {
    command: 'create',
    linkedQualityPath: qualityPassCreateQualityPath,
  }
);

runCli(['draw', qualityPassConfig, '--bom', '--strict-quality']);
const qualityPassDrawingQualityPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_drawing_quality.json');
assertArtifact(qualityPassDrawingQualityPath);
const qualityPassDrawingQuality = readJson(qualityPassDrawingQualityPath);
assert.equal(qualityPassDrawingQuality.status, 'pass');
assert.equal(qualityPassDrawingQuality.dimensions.coverage_percent, 100);
assert.equal(qualityPassDrawingQuality.traceability.coverage_percent >= 95, true);

const qualityPassDfm = runCli(['dfm', qualityPassConfig]);
assert.match(qualityPassDfm.stdout, /DFM Score: 100\/100|DFM Score: 9\d\/100|DFM Score: 8\d\/100/);

syncArtifactsForReport('quality_pass_bracket_runtime_smoke');
runCli(['report', qualityPassConfig, '--dfm']);
assertArtifact(join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report.pdf'));
const qualityPassReportSummaryPath = join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report_summary.json');
assertArtifact(qualityPassReportSummaryPath);
const qualityPassReportSummary = readJson(qualityPassReportSummaryPath);
assert.equal(qualityPassReportSummary.ready_for_manufacturing_review, true);
assert.equal(qualityPassReportSummary.overall_status, 'pass');
assertArtifactManifest(
  join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report_artifact-manifest.json'),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: 'output/runtime-smoke-configs/quality_pass_bracket.runtime-smoke.toml',
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.include_fem, false);
      assert.equal(manifest.details?.include_tolerance, true);
    },
  }
);

writeFileSync(MANIFEST_PATH, JSON.stringify(smokeManifest, null, 2) + '\n', 'utf8');
const persistedSmokeManifest = readJson(MANIFEST_PATH);
assert.equal(Array.isArray(persistedSmokeManifest.source_configs), true);
assert.equal(Array.isArray(persistedSmokeManifest.commands), true);
assert.equal(Array.isArray(persistedSmokeManifest.artifact_manifests), true);
assert.equal(Array.isArray(persistedSmokeManifest.artifacts), true);
assert.equal(persistedSmokeManifest.source_configs.length, 3);
assert.equal(persistedSmokeManifest.artifact_manifests.length, 5);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad fem') && entry.command.includes('bracket_fem.runtime-smoke.toml')
  ),
  'Smoke manifest should record the FEM runtime command'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad create') && entry.command.includes('--strict-quality') && entry.expected_failure === true
  ),
  'Smoke manifest should record the expected-fail ks_bracket strict create check'
);
assert(
  persistedSmokeManifest.artifacts.some((artifact) => artifact.type === 'analysis.fem.step'),
  'Smoke manifest should summarize the FEM STEP artifact'
);

console.log('runtime-smoke-cli.js: ok');

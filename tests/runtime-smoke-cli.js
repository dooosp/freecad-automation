import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { validateArtifactManifest } from '../lib/artifact-manifest.js';
import { validateCreateQualityReport } from '../lib/create-quality.js';
import { validateOutputManifest } from '../lib/output-manifest.js';
import {
  createQualityFixtureSmokeMatrix,
  getQualityFixtureExpectation,
  getQualityFixtureSmokeRecord,
} from './quality-fixture-matrix.js';

const ROOT = resolve(import.meta.dirname, '..');
const RUN_ID = String(process.env.FCAD_SMOKE_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')).replace(/[^A-Za-z0-9_.-]+/g, '-');
const OUTPUT_DIR = join(ROOT, 'output', 'smoke', RUN_ID);
const CONFIG_DIR = join(OUTPUT_DIR, 'configs');
const REPORT_DIR = OUTPUT_DIR;
const MANIFEST_PATH = join(OUTPUT_DIR, 'smoke-manifest.json');

const smokeManifest = {
  generated_at: new Date().toISOString(),
  run_id: RUN_ID,
  output_dir: OUTPUT_DIR,
  source_configs: [],
  commands: [],
  artifact_manifests: [],
  artifacts: [],
  quality_fixture_matrix: createQualityFixtureSmokeMatrix(),
  excluded_commands: [
    {
      command: 'tolerance',
      reason: 'Assembly-plus-Monte-Carlo runtime flow is still left to deeper local validation so the repository-owned smoke lane stays stable.',
    },
  ],
};

const ksFixture = getQualityFixtureExpectation('ks_bracket');
const qualityPassFixture = getQualityFixtureExpectation('quality_pass_bracket');
const ksFixtureRecord = getQualityFixtureSmokeRecord(smokeManifest.quality_fixture_matrix, 'ks_bracket');
const qualityPassFixtureRecord = getQualityFixtureSmokeRecord(smokeManifest.quality_fixture_matrix, 'quality_pass_bracket');
const CLI_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function runCli(args) {
  const completed = spawnSync('node', [join(ROOT, 'bin', 'fcad.js'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: CLI_MAX_BUFFER_BYTES,
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
    maxBuffer: CLI_MAX_BUFFER_BYTES,
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

function cloneConfigWithOutput(sourcePath, targetName, rewrittenName, {
  reviewerFeedbackPath = null,
} = {}) {
  const source = readFileSync(sourcePath, 'utf8');
  const escapedOutputDir = OUTPUT_DIR.replace(/\\/g, '\\\\');
  const withOutputDir = source.replace(
    /directory\s*=\s*"[^"]*"/,
    `directory = "${escapedOutputDir}"`
  );
  let rewritten = withOutputDir.replace(
    /^name\s*=\s*"[^"]*"/m,
    `name = "${rewrittenName}"`
  );

  if (reviewerFeedbackPath) {
    const escapedReviewerFeedbackPath = reviewerFeedbackPath.replace(/\\/g, '\\\\');
    if (/\[reviewer_feedback\]/.test(rewritten)) {
      rewritten = rewritten.replace(
        /(\[reviewer_feedback\][\s\S]*?path\s*=\s*)"[^"]*"/,
        `$1"${escapedReviewerFeedbackPath}"`
      );
    } else {
      rewritten += `\n[reviewer_feedback]\npath = "${escapedReviewerFeedbackPath}"\n`;
    }
  }

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

function provenanceById(report) {
  return new Map(
    (report.engineering_quality?.measurement_provenance || []).map((entry) => [entry.measurement_id, entry])
  );
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else {
      files.push(filePath);
    }
  }
  return files;
}

function collectCandidateRefs(value, trail = []) {
  const refs = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const status = String(value.status || value.availability || '').toLowerCase();
    const required = value.required === true;
    const pathKeys = ['path', 'artifact_path', 'input_path', 'output_path', 'relative_path', 'href'];
    for (const key of pathKeys) {
      if (typeof value[key] === 'string' && value[key]) {
        refs.push({
          raw: value[key],
          trail: trail.concat(key).join('.'),
          status,
          required,
          object: value,
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      refs.push(...collectCandidateRefs(child, trail.concat(key)));
    }
    return refs;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      refs.push(...collectCandidateRefs(item, trail.concat(String(index))));
    });
    return refs;
  }

  if (
    typeof value === 'string'
    && (
      value.includes('output/')
      || value.includes('output\\')
      || value.endsWith('.json')
      || value.endsWith('.svg')
      || value.endsWith('.pdf')
      || value.endsWith('.png')
      || value.endsWith('.html')
      || value.endsWith('.csv')
      || value.endsWith('.toml')
    )
  ) {
    refs.push({
      raw: value,
      trail: trail.join('.'),
      status: '',
      required: undefined,
      object: null,
    });
  }
  return refs;
}

function assertNoUnsafeOrMissingArtifactRefs(rootDir) {
  const jsonFiles = walkFiles(rootDir).filter((filePath) => filePath.endsWith('.json'));
  const badRefs = [];
  const missingRefs = [];
  const optionalUnavailableWithPath = [];
  const requiredUnavailable = [];

  for (const filePath of jsonFiles) {
    let parsed;
    try {
      parsed = readJson(filePath);
    } catch {
      continue;
    }

    const relFile = relative(ROOT, filePath);
    for (const ref of collectCandidateRefs(parsed)) {
      if (
        ref.object
        && ['not_available', 'missing', 'unavailable'].includes(ref.status)
        && ref.required
      ) {
        requiredUnavailable.push({ file: relFile, field: ref.trail, object: ref.object });
      }
      if (
        ref.object
        && ['not_available', 'missing', 'unavailable'].includes(ref.status)
        && !ref.required
      ) {
        optionalUnavailableWithPath.push({ file: relFile, field: ref.trail, raw: ref.raw });
      }

      const resolved = isAbsolute(ref.raw) ? ref.raw : resolve(ROOT, ref.raw);
      const rel = relative(ROOT, resolved);
      const normalized = rel.split(sep).join('/');
      if (ref.raw.includes('..') || normalized.startsWith('..') || (isAbsolute(ref.raw) && !resolved.startsWith(ROOT))) {
        badRefs.push({ file: relFile, field: ref.trail, raw: ref.raw });
        continue;
      }
      if (
        (
          normalized.startsWith('output/')
          || normalized.startsWith('configs/')
          || normalized.startsWith('docs/')
          || normalized.startsWith('src/')
          || normalized.startsWith('tests/')
        )
        && !existsSync(resolved)
      ) {
        missingRefs.push({ file: relFile, field: ref.trail, raw: ref.raw });
      }
    }
  }

  assert.deepEqual(badRefs, [], `Unsafe artifact references found:\n${JSON.stringify(badRefs, null, 2)}`);
  assert.deepEqual(missingRefs, [], `Missing artifact references found:\n${JSON.stringify(missingRefs, null, 2)}`);
  assert.deepEqual(
    optionalUnavailableWithPath,
    [],
    `Optional unavailable artifacts must not serialize stale paths:\n${JSON.stringify(optionalUnavailableWithPath, null, 2)}`
  );
  assert.deepEqual(
    requiredUnavailable,
    [],
    `Required artifacts must resolve to generated files:\n${JSON.stringify(requiredUnavailable, null, 2)}`
  );
}

function assertRuntimeLayoutReadability(layoutReadability, label, {
  requireFinding = false,
} = {}) {
  assert.equal(layoutReadability && typeof layoutReadability === 'object', true, `${label} layout readability must be an object`);
  assert.equal(layoutReadability.advisory_only, true, `${label} layout readability must stay advisory-only`);
  assert(['available', 'partial', 'missing'].includes(layoutReadability.evidence_state), `${label} evidence_state should be conservative`);
  assert(['complete', 'partial', 'missing'].includes(layoutReadability.completeness_state), `${label} completeness_state should be explicit`);
  const sourceCompleteness = layoutReadability.provenance?.source_completeness;
  assert.equal(sourceCompleteness && typeof sourceCompleteness === 'object', true, `${label} source completeness must be present`);
  assert.equal(sourceCompleteness.layout_report?.source_kind, 'layout_report');
  assert.equal(sourceCompleteness.qa_metrics?.source_kind, 'qa_metrics');
  assert.equal(sourceCompleteness.svg_view_metadata?.source_kind, 'svg_view_metadata');
  assert.equal(typeof sourceCompleteness.layout_report?.completeness_state, 'string');
  assert.equal(typeof sourceCompleteness.qa_metrics?.completeness_state, 'string');
  assert.equal(typeof sourceCompleteness.svg_view_metadata?.completeness_state, 'string');
  assert.equal(Array.isArray(layoutReadability.provenance?.sources), true, `${label} layout sources must be listed`);

  const findings = Array.isArray(layoutReadability.findings) ? layoutReadability.findings : [];
  if (requireFinding) {
    assert(findings.length > 0, `${label} should retain at least one advisory layout finding`);
  }
  for (const finding of findings) {
    assert.equal(finding.advisory_only, true, `${label} layout findings must stay advisory-only`);
    assert.equal(typeof finding.source_kind, 'string', `${label} finding source_kind missing`);
    assert.equal(typeof finding.source_ref, 'string', `${label} finding source_ref missing`);
    assert.equal(typeof finding.evidence_state, 'string', `${label} finding evidence_state missing`);
    assert.equal(typeof finding.completeness_state, 'string', `${label} finding completeness_state missing`);
    assert.equal(finding.provenance && typeof finding.provenance === 'object', true, `${label} finding provenance missing`);
  }
}

function assertExpectedExitCode(status, expectedExit, label) {
  if (expectedExit === 'nonzero') {
    assert.notEqual(status, 0, `${label} should fail with a non-zero exit code`);
    return;
  }
  assert.equal(status, expectedExit, `${label} exited unexpectedly`);
}

function syncArtifactsForReport(baseName) {
  const artifactNames = [
    `${baseName}_create_quality.json`,
    `${baseName}_drawing_quality.json`,
    `${baseName}_extracted_drawing_semantics.json`,
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

function assertOutputManifest(manifestPath, { command, linkedQualityPath = null, linkedArtifacts = {} } = {}) {
  assertArtifact(manifestPath);
  const manifest = readJson(manifestPath);
  const validation = validateOutputManifest(manifest);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(manifest.command, command);
  if (linkedQualityPath) {
    assert.equal(manifest.linked_artifacts.quality_json, linkedQualityPath);
  }
  for (const [artifactKey, artifactPath] of Object.entries(linkedArtifacts)) {
    assert.equal(
      manifest.linked_artifacts?.[artifactKey],
      artifactPath,
      `${manifestPath} should link ${artifactKey}`
    );
  }
  return manifest;
}

function findRequiredViewClassification(drawingQuality, requirementId) {
  return drawingQuality.semantic_quality?.extracted_evidence?.required_views
    ?.find((entry) => entry.requirement_id === requirementId);
}

function assertRuntimeViewEvidence(semantics, {
  id,
  viewKind,
  identity,
  sourceView = null,
  regionRef,
  drawingSvgPath,
}) {
  const view = semantics.views.find((entry) => entry.id === id && entry.view_kind === viewKind);
  assert(view, `Expected extracted ${viewKind} view evidence for ${id}`);
  assert.equal(view.identity, identity);
  assert.equal(view.source_view, sourceView);
  assert.equal(view.source, drawingSvgPath);
  assert.equal(view.provenance?.artifact_type, 'svg');
  assert.equal(view.provenance?.method, 'svg_view_group_metadata');
  assert.equal(view.provenance?.svg_region_ref, regionRef);
  assert.match(view.provenance?.svg_group_id || '', /^drawing-view-/);
  assert.equal(view.confidence >= 0.9, true);
  return view;
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

const qualityFailWrongHoleDiameterConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'quality_fail_wrong_hole_diameter.toml'),
  'quality_fail_wrong_hole_diameter.runtime-smoke.toml',
  'quality_fail_wrong_hole_diameter_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'quality_fail_wrong_hole_diameter.toml'));

const qualityFailWrongHoleCenterConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'quality_fail_wrong_hole_center.toml'),
  'quality_fail_wrong_hole_center.runtime-smoke.toml',
  'quality_fail_wrong_hole_center_runtime_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'quality_fail_wrong_hole_center.toml'));

const sectionDetailConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'section_detail_runtime_probe.toml'),
  'section_detail_runtime_probe.runtime-smoke.toml',
  'section_detail_runtime_probe_smoke'
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'section_detail_runtime_probe.toml'));

const reviewerFeedbackInputPath = join(CONFIG_DIR, 'runtime-linked-open-feedback.json');
copyFileSync(
  join(ROOT, 'tests', 'fixtures', 'reviewer-feedback', 'runtime-linked-open-feedback.json'),
  reviewerFeedbackInputPath
);
const reviewerFeedbackConfig = cloneConfigWithOutput(
  join(ROOT, 'configs', 'examples', 'reviewer_feedback_runtime_probe.toml'),
  'reviewer_feedback_runtime_probe.runtime-smoke.toml',
  'reviewer_feedback_runtime_probe_smoke',
  { reviewerFeedbackPath: './runtime-linked-open-feedback.json' }
);
smokeManifest.source_configs.push(join(ROOT, 'configs', 'examples', 'reviewer_feedback_runtime_probe.toml'));

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
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/ks_bracket.runtime-smoke.toml`,
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
ksFixtureRecord.observed.createQualityStatus = createQuality.status;

const ksStrictCreate = runCliExpectFailure(['create', bracketConfig, '--strict-quality']);
ksFixtureRecord.observed.strictCreateExit = ksStrictCreate.status;
assert.match(
  `${ksStrictCreate.stdout}\n${ksStrictCreate.stderr}`,
  /strict-quality found blocking quality issues|Strict create quality gate failed/i
);
assertExpectedExitCode(ksStrictCreate.status, ksFixture.strictCreate.expectedExit, 'ks_bracket strict create');

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
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/ks_bracket.runtime-smoke.toml`,
  }
);
const ksDrawingQualityPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_quality.json');
const ksExtractedSemanticsPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_extracted_drawing_semantics.json');
const ksDrawingPlannerPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_planner.json');
const ksDrawingIntentPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_intent.json');
const ksFeatureCatalogPath = join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_feature_catalog.json');
assertArtifact(ksDrawingQualityPath);
assertArtifact(ksExtractedSemanticsPath);
assertArtifact(ksDrawingPlannerPath);
assertArtifact(ksDrawingIntentPath);
assertArtifact(ksFeatureCatalogPath);
const ksDrawingQuality = readJson(ksDrawingQualityPath);
const ksDrawingPlanner = readJson(ksDrawingPlannerPath);
assert.equal(ksDrawingQuality.status, 'fail');
assertRuntimeLayoutReadability(ksDrawingQuality.layout_readability, 'ks_bracket drawing quality', {
  requireFinding: true,
});
assert.equal(ksDrawingQuality.reviewer_feedback.status, 'none');
assert.equal(ksDrawingQuality.reviewer_feedback.unresolved_count, 0);
assert.equal(ksDrawingQuality.extracted_drawing_semantics_file, ksExtractedSemanticsPath);
assert.equal(ksDrawingQuality.semantic_quality.extracted_evidence.coverage.required_dimensions.extracted >= 0, true);
assert.equal(ksDrawingQuality.semantic_quality.extracted_evidence.required_dimensions.some((entry) => entry.classification === 'unknown' || entry.classification === 'missing'), true);
assert.equal(
  ksDrawingQuality.semantic_quality.extracted_evidence.required_dimensions.find((entry) => entry.requirement_id === 'MOUNTING_HOLE_DIA')?.classification,
  'extracted'
);
assert.equal(
  ksDrawingQuality.semantic_quality.extracted_evidence.required_dimensions.find((entry) => entry.requirement_id === 'BASE_PLATE_ENVELOPE')?.classification,
  'unknown'
);
assert.equal(
  ksDrawingQuality.semantic_quality.extracted_evidence.required_notes.every((entry) => entry.classification === 'extracted'),
  true
);
assert.equal(
  ksDrawingQuality.semantic_quality.extracted_evidence.required_notes.some((entry) => entry.requirement_id === 'SURFACE_FINISH' && entry.classification === 'extracted'),
  true
);
assert.equal(Array.isArray(ksDrawingQuality.semantic_quality.required_blockers), true);
assert.equal(
  ksDrawingQuality.semantic_quality.required_blockers.some((entry) => entry.includes('BASE_PLATE_ENVELOPE')),
  true
);
assert.equal(Array.isArray(ksDrawingPlanner.suggested_action_details), true);
assert.equal(ksDrawingPlanner.suggested_action_details.some((entry) => entry.classification === 'unknown' || entry.classification === 'missing'), true);
assert.equal(ksDrawingPlanner.suggested_action_details.some((entry) => entry.category === 'note'), false);
ksFixtureRecord.observed.drawingQualityStatus = ksDrawingQuality.status;

const ksStrictDraw = runCliExpectFailure(['draw', bracketConfig, '--bom', '--strict-quality']);
ksFixtureRecord.observed.strictDrawExit = ksStrictDraw.status;
assert.match(
  `${ksStrictDraw.stdout}\n${ksStrictDraw.stderr}`,
  /Strict drawing quality gate failed/i
);
assertExpectedExitCode(ksStrictDraw.status, ksFixture.strictDraw.expectedExit, 'ks_bracket strict draw');
assertOutputManifest(
  join(OUTPUT_DIR, 'ks_bracket_runtime_smoke_drawing_manifest.json'),
  {
    command: 'draw',
    linkedQualityPath: ksDrawingQualityPath,
    linkedArtifacts: {
      planner_json: ksDrawingPlannerPath,
      extracted_drawing_semantics_json: ksExtractedSemanticsPath,
      drawing_intent_json: ksDrawingIntentPath,
      feature_catalog_json: ksFeatureCatalogPath,
    },
  }
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
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/bracket_fem.runtime-smoke.toml`,
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
runCli(['report', bracketConfig, '--dfm', '--out-dir', OUTPUT_DIR]);
assertArtifact(join(REPORT_DIR, 'ks_bracket_runtime_smoke_report.pdf'));
const ksReportSummaryPath = join(REPORT_DIR, 'ks_bracket_runtime_smoke_report_summary.json');
assertArtifact(ksReportSummaryPath);
const ksReportSummary = readJson(ksReportSummaryPath);
assertRuntimeLayoutReadability(
  ksReportSummary.surfaces.drawing_quality.layout_readability,
  'ks_bracket report summary',
  { requireFinding: true }
);
assert.equal(ksReportSummary.ready_for_manufacturing_review, ksFixture.report.readyForManufacturingReview);
assert.equal(ksReportSummary.overall_status, ksFixture.report.overallStatus);
assert.equal(
  ksReportSummary.surfaces.drawing_quality.semantic_quality.required_blockers.some((entry) => entry.includes('BASE_PLATE_ENVELOPE')),
  true
);
assert.equal(ksReportSummary.surfaces.drawing_quality.reviewer_feedback.status, 'none');
assert.equal(ksReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.path, ksDrawingIntentPath);
assert.equal(ksReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.status, 'available');
assert.equal(ksReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.path, ksFeatureCatalogPath);
assert.equal(ksReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.status, 'available');
assert.equal(
  ksReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.path,
  ksExtractedSemanticsPath
);
assert.equal(
  ksReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.path,
  ksExtractedSemanticsPath
);
ksFixtureRecord.observed.reportReadyForManufacturingReview = ksReportSummary.ready_for_manufacturing_review;
ksFixtureRecord.observed.reportOverallStatus = ksReportSummary.overall_status;
assertArtifactManifest(
  join(REPORT_DIR, 'ks_bracket_runtime_smoke_report_artifact-manifest.json'),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/ks_bracket.runtime-smoke.toml`,
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.include_fem, false);
      assert.equal(manifest.details?.include_tolerance, true);
    },
  }
);

const qualityPassStrictCreate = runCli(['create', qualityPassConfig, '--strict-quality']);
const qualityPassCreateQualityPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_create_quality.json');
assertArtifact(qualityPassCreateQualityPath);
const qualityPassCreateQuality = readJson(qualityPassCreateQualityPath);
const qualityPassCreateValidation = validateCreateQualityReport(qualityPassCreateQuality);
assert.equal(qualityPassCreateValidation.ok, true, qualityPassCreateValidation.errors.join('\n'));
assert.equal(qualityPassCreateQuality.status, qualityPassFixture.strictCreate.qualityStatus);
const qualityPassCreateProvenance = provenanceById(qualityPassCreateQuality);
assert.equal(qualityPassCreateProvenance.get('bbox')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('thickness')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('volume')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_left_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_left_center')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_right_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_right_center')?.source, 'generated_shape_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_left_step_diameter')?.source, 'reimported_step_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_left_step_center')?.source, 'reimported_step_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_right_step_diameter')?.source, 'reimported_step_geometry');
assert.equal(qualityPassCreateProvenance.get('hole_right_step_center')?.source, 'reimported_step_geometry');
assert.equal(
  qualityPassCreateQuality.engineering_quality.measurements
    .filter((entry) => entry.source === 'reimported_step_geometry')
    .every((entry) => entry.validation_kind === 'reimported_step_geometry_check' && entry.status === 'pass'),
  true
);
assert.equal(
  qualityPassCreateQuality.engineering_quality.measurements
    .filter((entry) => entry.source === 'reimported_step_geometry').length,
  4
);
qualityPassFixtureRecord.observed.createQualityStatus = qualityPassCreateQuality.status;
qualityPassFixtureRecord.observed.strictCreateExit = qualityPassStrictCreate.status;
assertOutputManifest(
  join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_manifest.json'),
  {
    command: 'create',
    linkedQualityPath: qualityPassCreateQualityPath,
  }
);

const qualityFailWrongHoleStrictCreate = runCliExpectFailure([
  'create',
  qualityFailWrongHoleDiameterConfig,
  '--strict-quality',
]);
assert.match(
  `${qualityFailWrongHoleStrictCreate.stdout}\n${qualityFailWrongHoleStrictCreate.stderr}`,
  /strict-quality found blocking quality issues|Strict create quality gate failed/i
);
const qualityFailWrongHoleCreateQualityPath = join(
  OUTPUT_DIR,
  'quality_fail_wrong_hole_diameter_runtime_smoke_create_quality.json'
);
assertArtifact(qualityFailWrongHoleCreateQualityPath);
const qualityFailWrongHoleCreateQuality = readJson(qualityFailWrongHoleCreateQualityPath);
const qualityFailWrongHoleCreateValidation = validateCreateQualityReport(qualityFailWrongHoleCreateQuality);
assert.equal(qualityFailWrongHoleCreateValidation.ok, true, qualityFailWrongHoleCreateValidation.errors.join('\n'));
assert.equal(qualityFailWrongHoleCreateQuality.status, 'fail');
assert.equal(qualityFailWrongHoleCreateQuality.engineering_quality.status, 'fail');
assert.equal(
  qualityFailWrongHoleCreateQuality.engineering_quality.measurements.find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA')?.status,
  'fail'
);
assert.equal(
  qualityFailWrongHoleCreateQuality.engineering_quality.measurements.find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA')?.source,
  'generated_shape_geometry'
);
assert.equal(
  qualityFailWrongHoleCreateQuality.engineering_quality.measurements.find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA')?.validation_kind,
  'generated_shape_geometry_check'
);
const qualityFailWrongHoleProvenance = provenanceById(qualityFailWrongHoleCreateQuality);
assert.equal(qualityFailWrongHoleProvenance.get('hole_left_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityFailWrongHoleProvenance.get('hole_left_center')?.source, 'generated_shape_geometry');
assert.equal(qualityFailWrongHoleProvenance.get('hole_left_step_diameter')?.source, 'reimported_step_geometry');
assert.equal(
  qualityFailWrongHoleCreateQuality.engineering_quality.measurements
    .find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA_STEP_REIMPORT')?.status,
  'fail'
);
assert.equal(
  qualityFailWrongHoleCreateQuality.engineering_quality.measurements
    .find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA_STEP_REIMPORT')?.source,
  'reimported_step_geometry'
);

const qualityFailWrongHoleCenterStrictCreate = runCliExpectFailure([
  'create',
  qualityFailWrongHoleCenterConfig,
  '--strict-quality',
]);
assert.match(
  `${qualityFailWrongHoleCenterStrictCreate.stdout}\n${qualityFailWrongHoleCenterStrictCreate.stderr}`,
  /strict-quality found blocking quality issues|Strict create quality gate failed/i
);
assert.equal(qualityFailWrongHoleCenterStrictCreate.status, 1);
const qualityFailWrongHoleCenterCreateQualityPath = join(
  OUTPUT_DIR,
  'quality_fail_wrong_hole_center_runtime_smoke_create_quality.json'
);
assertArtifact(qualityFailWrongHoleCenterCreateQualityPath);
const qualityFailWrongHoleCenterCreateQuality = readJson(qualityFailWrongHoleCenterCreateQualityPath);
const qualityFailWrongHoleCenterCreateValidation = validateCreateQualityReport(qualityFailWrongHoleCenterCreateQuality);
assert.equal(
  qualityFailWrongHoleCenterCreateValidation.ok,
  true,
  qualityFailWrongHoleCenterCreateValidation.errors.join('\n')
);
assert.equal(qualityFailWrongHoleCenterCreateQuality.status, 'fail');
assert.equal(qualityFailWrongHoleCenterCreateQuality.engineering_quality.status, 'fail');
const wrongCenterMeasurement = qualityFailWrongHoleCenterCreateQuality.engineering_quality.measurements
  .find((entry) => entry.requirement_id === 'hole_left_CENTER');
assert.equal(wrongCenterMeasurement?.status, 'fail');
assert.equal(wrongCenterMeasurement?.source, 'generated_shape_geometry');
assert.equal(wrongCenterMeasurement?.validation_kind, 'generated_shape_geometry_check');
assert.deepEqual(wrongCenterMeasurement?.expected_center_xy_mm, [30, 30]);
assert.deepEqual(wrongCenterMeasurement?.actual_center_xy_mm, [32, 30]);
assert.equal(wrongCenterMeasurement?.tolerance_mm, 0.2);
assert.equal(wrongCenterMeasurement?.center_delta_mm, 2);
assert.equal(
  qualityFailWrongHoleCenterCreateQuality.engineering_quality.measurements
    .find((entry) => entry.requirement_id === 'HOLE_LEFT_DIA')?.status,
  'pass'
);
const qualityFailWrongHoleCenterProvenance = provenanceById(qualityFailWrongHoleCenterCreateQuality);
assert.equal(qualityFailWrongHoleCenterProvenance.get('hole_left_center')?.source, 'generated_shape_geometry');
assert.equal(qualityFailWrongHoleCenterProvenance.get('hole_left_diameter')?.source, 'generated_shape_geometry');
assert.equal(qualityFailWrongHoleCenterProvenance.get('hole_left_step_center')?.source, 'reimported_step_geometry');
const stepWrongCenterMeasurement = qualityFailWrongHoleCenterCreateQuality.engineering_quality.measurements
  .find((entry) => entry.requirement_id === 'hole_left_CENTER_STEP_REIMPORT');
assert.equal(stepWrongCenterMeasurement?.status, 'fail');
assert.equal(stepWrongCenterMeasurement?.source, 'reimported_step_geometry');
assert.deepEqual(stepWrongCenterMeasurement?.actual_center_xy_mm, [32, 30]);
assert.equal(stepWrongCenterMeasurement?.center_delta_mm, 2);

const qualityPassStrictDraw = runCli(['draw', qualityPassConfig, '--bom', '--strict-quality']);
const qualityPassDrawingQualityPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_drawing_quality.json');
const qualityPassExtractedSemanticsPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_extracted_drawing_semantics.json');
const qualityPassDrawingPlannerPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_drawing_planner.json');
const qualityPassDrawingIntentPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_drawing_intent.json');
const qualityPassFeatureCatalogPath = join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_feature_catalog.json');
assertArtifact(qualityPassDrawingQualityPath);
assertArtifact(qualityPassExtractedSemanticsPath);
assertArtifact(qualityPassDrawingPlannerPath);
assertArtifact(qualityPassDrawingIntentPath);
assertArtifact(qualityPassFeatureCatalogPath);
const qualityPassDrawingQuality = readJson(qualityPassDrawingQualityPath);
const qualityPassDrawingPlanner = readJson(qualityPassDrawingPlannerPath);
assert.equal(qualityPassDrawingQuality.status, qualityPassFixture.strictDraw.qualityStatus);
assertRuntimeLayoutReadability(qualityPassDrawingQuality.layout_readability, 'quality_pass_bracket drawing quality');
assert.equal(qualityPassDrawingQuality.reviewer_feedback.status, 'none');
assert.equal(qualityPassDrawingQuality.reviewer_feedback.unresolved_count, 0);
assert.equal(qualityPassDrawingQuality.dimensions.coverage_percent, 100);
assert.equal(qualityPassDrawingQuality.traceability.coverage_percent >= 95, true);
assert.equal(qualityPassDrawingQuality.extracted_drawing_semantics_file, qualityPassExtractedSemanticsPath);
assert.equal(qualityPassDrawingQuality.semantic_quality.extracted_evidence.coverage.required_dimensions.missing, 0);
assert.equal(qualityPassDrawingQuality.semantic_quality.extracted_evidence.required_dimensions.every((entry) => entry.classification === 'extracted'), true);
assert.deepEqual(qualityPassDrawingQuality.semantic_quality.required_blockers, []);
assert.deepEqual(qualityPassDrawingPlanner.suggested_action_details || [], []);
qualityPassFixtureRecord.observed.drawingQualityStatus = qualityPassDrawingQuality.status;
qualityPassFixtureRecord.observed.strictDrawExit = qualityPassStrictDraw.status;
assertOutputManifest(
  join(OUTPUT_DIR, 'quality_pass_bracket_runtime_smoke_drawing_manifest.json'),
  {
    command: 'draw',
    linkedQualityPath: qualityPassDrawingQualityPath,
    linkedArtifacts: {
      planner_json: qualityPassDrawingPlannerPath,
      extracted_drawing_semantics_json: qualityPassExtractedSemanticsPath,
      drawing_intent_json: qualityPassDrawingIntentPath,
      feature_catalog_json: qualityPassFeatureCatalogPath,
    },
  }
);

const qualityPassDfm = runCli(['dfm', qualityPassConfig]);
const qualityPassDfmScoreMatch = `${qualityPassDfm.stdout}\n${qualityPassDfm.stderr}`.match(/DFM Score:\s*(\d+)\/100/i);
assert(qualityPassDfmScoreMatch, 'quality_pass_bracket DFM output should include a score');
const qualityPassDfmScore = Number.parseInt(qualityPassDfmScoreMatch[1], 10);
assert.equal(qualityPassDfmScore, qualityPassFixture.dfm.expectedScore);
qualityPassFixtureRecord.observed.dfmExit = qualityPassDfm.status;
qualityPassFixtureRecord.observed.dfmScore = qualityPassDfmScore;

syncArtifactsForReport('quality_pass_bracket_runtime_smoke');
runCli(['report', qualityPassConfig, '--dfm', '--out-dir', OUTPUT_DIR]);
assertArtifact(join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report.pdf'));
const qualityPassReportSummaryPath = join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report_summary.json');
assertArtifact(qualityPassReportSummaryPath);
const qualityPassReportSummary = readJson(qualityPassReportSummaryPath);
assertRuntimeLayoutReadability(
  qualityPassReportSummary.surfaces.drawing_quality.layout_readability,
  'quality_pass_bracket report summary'
);
assert.equal(
  qualityPassReportSummary.ready_for_manufacturing_review,
  qualityPassFixture.report.readyForManufacturingReview
);
assert.equal(qualityPassReportSummary.overall_status, qualityPassFixture.report.overallStatus);
assert.deepEqual(qualityPassReportSummary.surfaces.drawing_quality.semantic_quality.required_blockers, []);
assert.equal(qualityPassReportSummary.surfaces.drawing_quality.reviewer_feedback.status, 'none');
assert.equal(
  qualityPassReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.path,
  qualityPassDrawingIntentPath
);
assert.equal(
  qualityPassReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.status,
  'available'
);
assert.equal(
  qualityPassReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.path,
  qualityPassFeatureCatalogPath
);
assert.equal(
  qualityPassReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.status,
  'available'
);
assert.equal(
  qualityPassReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.path,
  qualityPassExtractedSemanticsPath
);
assert.equal(
  qualityPassReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.path,
  qualityPassExtractedSemanticsPath
);
qualityPassFixtureRecord.observed.reportReadyForManufacturingReview =
  qualityPassReportSummary.ready_for_manufacturing_review;
qualityPassFixtureRecord.observed.reportOverallStatus = qualityPassReportSummary.overall_status;
assertArtifactManifest(
  join(REPORT_DIR, 'quality_pass_bracket_runtime_smoke_report_artifact-manifest.json'),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/quality_pass_bracket.runtime-smoke.toml`,
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.include_fem, false);
      assert.equal(manifest.details?.include_tolerance, true);
    },
  }
);

const sectionDetailBase = 'section_detail_runtime_probe_smoke';
const sectionDetailStrictCreate = runCli(['create', sectionDetailConfig, '--strict-quality']);
const sectionDetailCreateQualityPath = join(OUTPUT_DIR, `${sectionDetailBase}_create_quality.json`);
assertArtifact(join(OUTPUT_DIR, `${sectionDetailBase}.step`));
assertArtifact(join(OUTPUT_DIR, `${sectionDetailBase}.stl`));
assertArtifact(sectionDetailCreateQualityPath);
const sectionDetailCreateQuality = readJson(sectionDetailCreateQualityPath);
assert.equal(sectionDetailCreateQuality.status, 'pass');
assert.equal(sectionDetailStrictCreate.status, 0);
assertArtifactManifest(
  join(OUTPUT_DIR, `${sectionDetailBase}_artifact-manifest.json`),
  {
    command: 'create',
    requiredArtifactTypes: ['model.step', 'model.stl'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/section_detail_runtime_probe.runtime-smoke.toml`,
  }
);
assertOutputManifest(
  join(OUTPUT_DIR, `${sectionDetailBase}_manifest.json`),
  {
    command: 'create',
    linkedQualityPath: sectionDetailCreateQualityPath,
  }
);

runCli(['draw', sectionDetailConfig]);
const sectionDetailDrawingSvgPath = join(OUTPUT_DIR, `${sectionDetailBase}_drawing.svg`);
const sectionDetailDrawingQualityPath = join(OUTPUT_DIR, `${sectionDetailBase}_drawing_quality.json`);
const sectionDetailExtractedSemanticsPath = join(OUTPUT_DIR, `${sectionDetailBase}_extracted_drawing_semantics.json`);
const sectionDetailDrawingPlannerPath = join(OUTPUT_DIR, `${sectionDetailBase}_drawing_planner.json`);
const sectionDetailDrawingIntentPath = join(OUTPUT_DIR, `${sectionDetailBase}_drawing_intent.json`);
const sectionDetailFeatureCatalogPath = join(OUTPUT_DIR, `${sectionDetailBase}_feature_catalog.json`);
const sectionDetailLayoutReportPath = join(OUTPUT_DIR, `${sectionDetailBase}_layout_report.json`);
assertArtifact(sectionDetailDrawingSvgPath);
assertArtifact(sectionDetailDrawingQualityPath);
assertArtifact(sectionDetailExtractedSemanticsPath);
assertArtifact(sectionDetailDrawingPlannerPath);
assertArtifact(sectionDetailDrawingIntentPath);
assertArtifact(sectionDetailFeatureCatalogPath);
assertArtifact(sectionDetailLayoutReportPath);
assertArtifactManifest(
  join(OUTPUT_DIR, `${sectionDetailBase}_drawing_artifact-manifest.json`),
  {
    command: 'draw',
    requiredArtifactTypes: ['drawing.svg', 'drawing.qa-report'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/section_detail_runtime_probe.runtime-smoke.toml`,
  }
);
const sectionDetailSemantics = readJson(sectionDetailExtractedSemanticsPath);
const sectionDetailDrawingQuality = readJson(sectionDetailDrawingQualityPath);
const sectionDetailDrawingPlanner = readJson(sectionDetailDrawingPlannerPath);
assertRuntimeLayoutReadability(
  sectionDetailDrawingQuality.layout_readability,
  'section_detail_runtime_probe drawing quality'
);
assert.equal(sectionDetailSemantics.sources.some((entry) => entry.method === 'svg_view_group_metadata' && entry.inspected === true), true);
assert.equal(sectionDetailSemantics.coverage.required_views_extracted, 3);
assertRuntimeViewEvidence(sectionDetailSemantics, {
  id: 'section_a_a',
  viewKind: 'section',
  identity: 'A-A',
  sourceView: 'top',
  regionRef: 'cell:iso',
  drawingSvgPath: sectionDetailDrawingSvgPath,
});
assertRuntimeViewEvidence(sectionDetailSemantics, {
  id: 'detail_b',
  viewKind: 'detail',
  identity: 'B',
  sourceView: 'top',
  regionRef: 'cell:right',
  drawingSvgPath: sectionDetailDrawingSvgPath,
});
assert.equal(sectionDetailDrawingQuality.status, 'pass');
assert.equal(sectionDetailDrawingQuality.semantic_quality.extracted_evidence.coverage.required_views.extracted, 3);
assert.equal(sectionDetailDrawingQuality.semantic_quality.extracted_evidence.coverage.required_views.missing, 0);
assert.equal(sectionDetailDrawingQuality.semantic_quality.extracted_evidence.coverage.required_views.unknown, 0);
assert.equal(findRequiredViewClassification(sectionDetailDrawingQuality, 'section_a_a')?.classification, 'extracted');
assert.equal(findRequiredViewClassification(sectionDetailDrawingQuality, 'detail_b')?.classification, 'extracted');
assert.equal(Array.isArray(sectionDetailDrawingPlanner.suggested_actions), true);
assert.equal(
  sectionDetailDrawingPlanner.suggested_actions.some((entry) => entry.includes('detail view')),
  true
);
assert.equal(Array.isArray(sectionDetailDrawingPlanner.suggested_action_details), true);
assertOutputManifest(
  join(OUTPUT_DIR, `${sectionDetailBase}_drawing_manifest.json`),
  {
    command: 'draw',
    linkedQualityPath: sectionDetailDrawingQualityPath,
    linkedArtifacts: {
      planner_json: sectionDetailDrawingPlannerPath,
      extracted_drawing_semantics_json: sectionDetailExtractedSemanticsPath,
      drawing_intent_json: sectionDetailDrawingIntentPath,
      feature_catalog_json: sectionDetailFeatureCatalogPath,
    },
  }
);

syncArtifactsForReport(sectionDetailBase);
runCli(['report', sectionDetailConfig, '--out-dir', OUTPUT_DIR]);
assertArtifact(join(REPORT_DIR, `${sectionDetailBase}_report.pdf`));
const sectionDetailReportSummaryPath = join(REPORT_DIR, `${sectionDetailBase}_report_summary.json`);
assertArtifact(sectionDetailReportSummaryPath);
const sectionDetailReportSummary = readJson(sectionDetailReportSummaryPath);
assertRuntimeLayoutReadability(
  sectionDetailReportSummary.surfaces.drawing_quality.layout_readability,
  'section_detail_runtime_probe report summary'
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'create_quality')?.path,
  sectionDetailCreateQualityPath
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'create_quality')?.status,
  'available'
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'create_manifest')?.status,
  'available'
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.path,
  sectionDetailDrawingIntentPath
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.path,
  sectionDetailFeatureCatalogPath
);
assert.equal(
  sectionDetailReportSummary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.path,
  sectionDetailExtractedSemanticsPath
);
assert.equal(
  sectionDetailReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.path,
  sectionDetailExtractedSemanticsPath
);
assert.equal(
  sectionDetailReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.coverage.required_views.extracted,
  3
);
assert.equal(
  sectionDetailReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.required_views
    .some((entry) => entry.requirement_id === 'section_a_a' && entry.classification === 'extracted'),
  true
);
assert.equal(
  sectionDetailReportSummary.surfaces.drawing_quality.semantic_quality.extracted_evidence.required_views
    .some((entry) => entry.requirement_id === 'detail_b' && entry.classification === 'extracted'),
  true
);
assertArtifactManifest(
  join(REPORT_DIR, `${sectionDetailBase}_report_artifact-manifest.json`),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/section_detail_runtime_probe.runtime-smoke.toml`,
    detailChecks: (manifest) => {
      assert.equal(manifest.details?.include_fem, false);
      assert.equal(manifest.details?.include_tolerance, true);
    },
  }
);

runCli(['create', reviewerFeedbackConfig, '--strict-quality']);
const reviewerFeedbackBase = 'reviewer_feedback_runtime_probe_smoke';
const reviewerFeedbackCreateQualityPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_create_quality.json`);
assertArtifact(reviewerFeedbackCreateQualityPath);
const reviewerFeedbackCreateQuality = readJson(reviewerFeedbackCreateQualityPath);
assert.equal(reviewerFeedbackCreateQuality.status, 'pass');

runCli(['draw', reviewerFeedbackConfig, '--bom', '--strict-quality']);
const reviewerFeedbackDrawingQualityPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_drawing_quality.json`);
const reviewerFeedbackExtractedSemanticsPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_extracted_drawing_semantics.json`);
const reviewerFeedbackDrawingPlannerPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_drawing_planner.json`);
const reviewerFeedbackDrawingIntentPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_drawing_intent.json`);
const reviewerFeedbackFeatureCatalogPath = join(OUTPUT_DIR, `${reviewerFeedbackBase}_feature_catalog.json`);
assertArtifact(reviewerFeedbackInputPath);
assertArtifact(reviewerFeedbackDrawingQualityPath);
assertArtifact(reviewerFeedbackExtractedSemanticsPath);
assertArtifact(reviewerFeedbackDrawingPlannerPath);
assertArtifact(reviewerFeedbackDrawingIntentPath);
assertArtifact(reviewerFeedbackFeatureCatalogPath);
const reviewerFeedbackDrawingQuality = readJson(reviewerFeedbackDrawingQualityPath);
const reviewerFeedbackDrawingPlanner = readJson(reviewerFeedbackDrawingPlannerPath);
const reviewerFeedbackSummary = reviewerFeedbackDrawingQuality.reviewer_feedback;
const reviewerFeedbackItem = reviewerFeedbackSummary.items.find((entry) => entry.id === 'rf-runtime-open-001');
assert.equal(reviewerFeedbackDrawingQuality.status, 'pass');
assert.equal(reviewerFeedbackSummary.advisory_only, true);
assert.equal(reviewerFeedbackSummary.status, 'available');
assert.equal(reviewerFeedbackSummary.evidence_state, 'linked');
assert.equal(reviewerFeedbackSummary.total_count, 1);
assert.equal(reviewerFeedbackSummary.unresolved_count, 1);
assert.equal(reviewerFeedbackSummary.linked_count, 1);
assert.equal(reviewerFeedbackSummary.invalid_count, 0);
assert.equal(reviewerFeedbackSummary.provenance.path, reviewerFeedbackInputPath);
assert(reviewerFeedbackItem, 'Runtime reviewer feedback item should be surfaced in drawing quality');
assert.equal(reviewerFeedbackItem.target_type, 'required_dimension');
assert.equal(reviewerFeedbackItem.target_id, 'HOLE_LEFT_DIA');
assert.equal(reviewerFeedbackItem.link_status, 'linked');
assert.equal(reviewerFeedbackItem.resolution_state, 'unresolved');
assert.equal(reviewerFeedbackItem.provenance.path, reviewerFeedbackInputPath);
assert.equal(
  reviewerFeedbackItem.linked_evidence.some(
    (entry) => entry.path === 'required_dimensions.HOLE_LEFT_DIA.classification' && entry.value === 'extracted'
  ),
  true
);
assert.equal(
  reviewerFeedbackDrawingQuality.semantic_quality.extracted_evidence.required_dimensions.every(
    (entry) => entry.classification === 'extracted'
  ),
  true
);
assert.equal(
  reviewerFeedbackDrawingPlanner.suggested_action_details.some(
    (entry) => entry.category === 'reviewer_feedback' && entry.classification === 'linked'
  ),
  true
);
assertArtifactManifest(
  join(OUTPUT_DIR, `${reviewerFeedbackBase}_drawing_artifact-manifest.json`),
  {
    command: 'draw',
    requiredArtifactTypes: ['drawing.svg', 'drawing.qa-report'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/reviewer_feedback_runtime_probe.runtime-smoke.toml`,
  }
);
assertOutputManifest(
  join(OUTPUT_DIR, `${reviewerFeedbackBase}_drawing_manifest.json`),
  {
    command: 'draw',
    linkedQualityPath: reviewerFeedbackDrawingQualityPath,
    linkedArtifacts: {
      planner_json: reviewerFeedbackDrawingPlannerPath,
      extracted_drawing_semantics_json: reviewerFeedbackExtractedSemanticsPath,
      drawing_intent_json: reviewerFeedbackDrawingIntentPath,
      feature_catalog_json: reviewerFeedbackFeatureCatalogPath,
      reviewer_feedback_json: reviewerFeedbackInputPath,
    },
  }
);

syncArtifactsForReport(reviewerFeedbackBase);
runCli(['report', reviewerFeedbackConfig, '--dfm', '--out-dir', OUTPUT_DIR]);
assertArtifact(join(REPORT_DIR, `${reviewerFeedbackBase}_report.pdf`));
const reviewerFeedbackReportSummaryPath = join(REPORT_DIR, `${reviewerFeedbackBase}_report_summary.json`);
assertArtifact(reviewerFeedbackReportSummaryPath);
const reviewerFeedbackReportSummary = readJson(reviewerFeedbackReportSummaryPath);
assert.equal(reviewerFeedbackReportSummary.ready_for_manufacturing_review, true);
assert.equal(reviewerFeedbackReportSummary.overall_status, 'pass');
assert.equal(reviewerFeedbackReportSummary.surfaces.drawing_quality.reviewer_feedback.status, 'available');
assert.equal(reviewerFeedbackReportSummary.surfaces.drawing_quality.reviewer_feedback.unresolved_count, 1);
assert.equal(reviewerFeedbackReportSummary.surfaces.drawing_quality.reviewer_feedback.linked_count, 1);
assert.equal(
  reviewerFeedbackReportSummary.surfaces.drawing_quality.reviewer_feedback.items
    .some((entry) => entry.id === 'rf-runtime-open-001' && entry.link_status === 'linked'),
  true
);
assert.equal(
  reviewerFeedbackReportSummary.inputs_consumed
    .some((entry) => entry.key === 'reviewer_feedback_json' && entry.path === reviewerFeedbackInputPath),
  true
);
assertArtifactManifest(
  join(REPORT_DIR, `${reviewerFeedbackBase}_report_artifact-manifest.json`),
  {
    command: 'report',
    requiredArtifactTypes: ['report.pdf'],
    expectedConfigSuffix: `output/smoke/${RUN_ID}/configs/reviewer_feedback_runtime_probe.runtime-smoke.toml`,
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
assert.equal(persistedSmokeManifest.source_configs.length, 7);
assert.equal(persistedSmokeManifest.artifact_manifests.length, 10);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad fem') && entry.command.includes('bracket_fem.runtime-smoke.toml')
  ),
  'Smoke manifest should record the FEM runtime command'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad draw') && entry.command.includes('section_detail_runtime_probe.runtime-smoke.toml')
  ),
  'Smoke manifest should record the section/detail runtime draw command'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad draw') && entry.command.includes('reviewer_feedback_runtime_probe.runtime-smoke.toml')
  ),
  'Smoke manifest should record the reviewer-feedback runtime draw command'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad create')
      && entry.command.includes('quality_fail_wrong_hole_diameter.runtime-smoke.toml')
      && entry.expected_failure === true
  ),
  'Smoke manifest should record the expected-fail wrong-hole-diameter strict create check'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad create')
      && entry.command.includes('quality_fail_wrong_hole_center.runtime-smoke.toml')
      && entry.expected_failure === true
  ),
  'Smoke manifest should record the expected-fail wrong-hole-center strict create check'
);
assert(
  persistedSmokeManifest.artifacts.some(
    (artifact) => artifact.path === sectionDetailExtractedSemanticsPath
  ),
  'Smoke manifest should summarize the section/detail extracted semantics artifact'
);
assert(
  persistedSmokeManifest.artifacts.some(
    (artifact) => artifact.path === reviewerFeedbackDrawingQualityPath
  ),
  'Smoke manifest should summarize the reviewer-feedback drawing quality artifact'
);
assert(
  persistedSmokeManifest.commands.some(
    (entry) => entry.command.includes('fcad create') && entry.command.includes('--strict-quality') && entry.expected_failure === true
  ),
  'Smoke manifest should record the expected-fail ks_bracket strict create check'
);
assert.equal(Array.isArray(persistedSmokeManifest.quality_fixture_matrix), true);
assert.equal(
  persistedSmokeManifest.quality_fixture_matrix.find((entry) => entry.id === 'quality_pass_bracket')?.observed?.reportReadyForManufacturingReview,
  true
);
assert.equal(
  persistedSmokeManifest.quality_fixture_matrix.find((entry) => entry.id === 'ks_bracket')?.observed?.reportReadyForManufacturingReview,
  false
);
assert(
  persistedSmokeManifest.artifacts.some((artifact) => artifact.type === 'analysis.fem.step'),
  'Smoke manifest should summarize the FEM STEP artifact'
);
assertNoUnsafeOrMissingArtifactRefs(OUTPUT_DIR);

console.log('runtime-smoke-cli.js: ok');

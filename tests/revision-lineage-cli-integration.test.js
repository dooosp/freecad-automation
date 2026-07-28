import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { validateJobRequest } from '../src/services/jobs/job-executor.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const scratchParent = join(ROOT, 'tmp', 'codex');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'revision-lineage-cli-'));
const proofInputScratch = mkdtempSync(join(ROOT, 'tests', 'fixtures', 'revision-lineage-cli-'));

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function assertRejected(run, pattern, label) {
  assert.notEqual(run.status, 0, `${label} unexpectedly succeeded:\n${run.stdout}`);
  assert.match(`${run.stdout}\n${run.stderr}`, pattern, label);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshotFlatDirectory(directory) {
  return new Map(
    readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .map((name) => [name, readFileSync(join(directory, name))])
  );
}

function assertFlatDirectoryBytesEqual(leftDirectory, rightDirectory, label) {
  const left = snapshotFlatDirectory(leftDirectory);
  const right = snapshotFlatDirectory(rightDirectory);
  assert.deepEqual([...right.keys()], [...left.keys()], `${label} file inventory`);
  for (const [name, bytes] of left) {
    assert.deepEqual(
      right.get(name),
      bytes,
      `${label} must be byte-identical for ${name}`
    );
  }
}

try {
  const contextPath = join(scratch, 'hinge-context.json');
  writeFileSync(contextPath, `${JSON.stringify({
    metadata: {
      created_at: '2026-07-27T00:00:00Z',
      warnings: [],
      source_files: [],
    },
    part: {
      part_id: 'hinge_block',
      name: 'hinge_block',
      revision: 'A',
      material: 'AL6061',
      process: 'machining',
    },
    geometry_source: {
      path: null,
      file_type: 'fixture_metadata',
      model_metadata: {
        volume: 54000,
        area: 15600,
        faces: 18,
        edges: 36,
        vertices: 24,
        bounding_box: {
          min: [0, 0, 0],
          max: [90, 50, 38],
          size: [90, 50, 38],
        },
      },
      feature_hints: { cylinders: [], bolt_circles: [], fillets: [], chamfers: [] },
    },
    bom: [],
    inspection_results: [],
    quality_issues: [],
    manufacturing_context: {},
  }, null, 2)}\n`, 'utf8');

  assertRejected(
    runCli(['review-context', '--proof-lineage=false']),
    /valueless flag/i,
    'review-context assigned proof flag'
  );
  assertRejected(
    runCli(['review-context', '--proof-lineage', 'false']),
    /valueless flag/i,
    'review-context separated proof value'
  );
  assertRejected(
    runCli(['review-context', '--context', contextPath, '--proof-lineage', '--out', join(scratch, 'missing-config.json')]),
    /requires --config/i,
    'review-context proof without config'
  );
  assertRejected(
    runCli(['review-context', '--context', contextPath, '--config', 'configs/examples/hinge_block.toml', '--out', join(scratch, 'config-without-proof.json')]),
    /accepted only with.*proof-lineage/i,
    'review-context config without proof policy'
  );
  assertRejected(
    runCli(['review-pack', '--proof-lineage']),
    /not proof-lineage eligible/i,
    'standalone review-pack proof activation'
  );
  assertRejected(
    runCli(['ingest', '--proof-lineage']),
    /not proof-lineage eligible/i,
    'standalone ingest proof activation'
  );
  for (const command of ['compare-rev', 'stabilization-review', 'process-plan']) {
    assertRejected(
      runCli([command, '--proof-lineage']),
      /not proof-lineage eligible/i,
      `${command} unsupported proof activation`
    );
  }
  assertRejected(
    runCli(['readiness-report', 'configs/examples/hinge_block.toml', '--proof-lineage']),
    /positional config compatibility mode is proof-ineligible/i,
    'config-positional readiness proof activation'
  );
  assertRejected(
    runCli(['inspection-plan', '--proof-lineage=false']),
    /valueless flag/i,
    'inspection-plan assigned proof flag'
  );
  assertRejected(
    runCli(['pack', '--proof-lineage=false']),
    /valueless flag/i,
    'pack assigned proof flag'
  );

  const duplicateReviewPath = join(scratch, 'duplicate-review-pack.json');
  writeFileSync(
    duplicateReviewPath,
    '{"artifact_type":"review_pack","artifact_type":"review_pack"}\n',
    'utf8'
  );
  const duplicateReadinessOutput = join(scratch, 'duplicate-readiness.json');
  assertRejected(
    runCli([
      'readiness-pack',
      '--review-pack', relative(ROOT, duplicateReviewPath),
      '--proof-lineage',
      '--out', duplicateReadinessOutput,
    ]),
    /duplicate json object keys|duplicate_json_key/i,
    'proof readiness duplicate-key input'
  );
  assert.equal(existsSync(duplicateReadinessOutput), false);

  const selectedRunDir = join(scratch, 'run-a');
  mkdirSync(selectedRunDir, { recursive: true });
  const selectedOutput = join(selectedRunDir, 'review_pack.json');
  const selectedManifestPath = join(selectedRunDir, 'review_pack_artifact-manifest.json');
  const selectedProofRun = runCli([
      'review-context',
      '--context', contextPath,
      '--config', 'configs/examples/hinge_block.toml',
      '--part-id', 'hinge_block',
      '--revision', 'A',
      '--proof-lineage',
      '--out', selectedOutput,
    ]);
  assert.equal(selectedProofRun.status, 0, `${selectedProofRun.stdout}\n${selectedProofRun.stderr}`);
  const selectedReview = JSON.parse(readFileSync(selectedOutput, 'utf8'));
  const selectedManifest = JSON.parse(readFileSync(selectedManifestPath, 'utf8'));
  assert.deepEqual(selectedReview.revision_lineage.identity, {
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    config_sha256: sha256(readFileSync(join(ROOT, 'configs/examples/hinge_block.toml'))),
  });
  assert.equal(selectedReview.part.package_slug, 'hinge-block');
  assert.deepEqual(selectedManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(selectedManifest.revision_lineage, selectedReview.revision_lineage);
  for (const filename of [
    'review_pack_geometry_intelligence.json',
    'review_pack_manufacturing_hotspots.json',
    'review_pack_inspection_linkage.json',
    'review_pack_quality_linkage.json',
    'review_pack_review_priorities.json',
  ]) {
    assert.equal(
      JSON.parse(readFileSync(join(selectedRunDir, filename), 'utf8')).generated_at,
      selectedReview.generated_at,
      `${filename} must inherit the proof review timestamp`
    );
  }

  const mismatchedReadinessOutput = join(scratch, 'outside-run-readiness.json');
  assertRejected(
    runCli([
      'readiness-pack',
      '--review-pack', relative(ROOT, selectedOutput),
      '--proof-lineage',
      '--out', mismatchedReadinessOutput,
    ]),
    /output must share the review-pack run directory/i,
    'proof readiness output outside portable run root'
  );
  assert.equal(existsSync(mismatchedReadinessOutput), false);

  const selectedReadinessOutput = join(selectedRunDir, 'readiness_report.json');
  const selectedReadinessRun = runCli([
    'readiness-pack',
    '--review-pack', relative(ROOT, selectedOutput),
    '--proof-lineage',
    '--out', selectedReadinessOutput,
  ]);
  assert.equal(
    selectedReadinessRun.status,
    0,
    `${selectedReadinessRun.stdout}\n${selectedReadinessRun.stderr}`
  );
  const selectedReadiness = JSON.parse(readFileSync(selectedReadinessOutput, 'utf8'));
  assert.deepEqual(selectedReadiness.revision_lineage.identity, selectedReview.revision_lineage.identity);
  assert.equal(selectedReadiness.process_plan.generated_at, selectedReview.generated_at);
  assert.equal(selectedReadiness.quality_risk.generated_at, selectedReview.generated_at);
  assert.equal(selectedReadiness.generated_at, selectedReview.generated_at);

  const mismatchedInspectionOutput = join(scratch, 'outside-run-inspection-plan.json');
  assertRejected(
    runCli([
      'inspection-plan',
      '--review-pack', relative(ROOT, selectedOutput).replaceAll('\\', '/'),
      '--readiness', relative(ROOT, selectedReadinessOutput).replaceAll('\\', '/'),
      '--config', 'configs/examples/hinge_block.toml',
      '--scope', 'full',
      '--proof-lineage',
      '--generated-at', '2026-07-27T02:03:04.000Z',
      '--out', mismatchedInspectionOutput,
    ]),
    /outputs must share the review-pack run directory/i,
    'proof inspection output outside portable run root'
  );
  assert.equal(existsSync(mismatchedInspectionOutput), false);

  const selectedInspectionPlanOutput = join(selectedRunDir, 'inspection_plan.json');
  const selectedInspectionPlanRun = runCli([
    'inspection-plan',
    '--review-pack', relative(ROOT, selectedOutput).replaceAll('\\', '/'),
    '--readiness', relative(ROOT, selectedReadinessOutput).replaceAll('\\', '/'),
    '--config', 'configs/examples/hinge_block.toml',
    '--scope', 'full',
    '--proof-lineage',
    '--generated-at', '2026-07-27T02:03:04.000Z',
    '--out', selectedInspectionPlanOutput,
  ]);
  assert.equal(
    selectedInspectionPlanRun.status,
    0,
    `${selectedInspectionPlanRun.stdout}\n${selectedInspectionPlanRun.stderr}`
  );
  const selectedInspectionPlan = JSON.parse(readFileSync(selectedInspectionPlanOutput, 'utf8'));
  assert.deepEqual(selectedInspectionPlan.package, {
    slug: 'hinge-block',
    revision: 'A',
    part_identifier: 'hinge_block',
  });
  assert.deepEqual(
    selectedInspectionPlan.revision_lineage.identity,
    selectedReview.revision_lineage.identity
  );

  const standardDocsGeneratedAt = '2026-07-27T03:04:05.000Z';
  const selectedStandardDocsDir = join(selectedRunDir, 'standard-docs');
  const standardDocsArgs = [
    'generate-standard-docs',
    'configs/examples/hinge_block.toml',
    '--readiness-report', relative(ROOT, selectedReadinessOutput),
    '--proof-lineage',
    '--generated-at', standardDocsGeneratedAt,
    '--out-dir', selectedStandardDocsDir,
  ];
  const firstStandardDocsRun = runCli(standardDocsArgs);
  assert.equal(
    firstStandardDocsRun.status,
    0,
    `${firstStandardDocsRun.stdout}\n${firstStandardDocsRun.stderr}`
  );
  const standardDocsManifestPath = join(selectedStandardDocsDir, 'standard_docs_manifest.json');
  const standardDocsArtifactManifestPath = join(selectedStandardDocsDir, 'artifact-manifest.json');
  const standardDocsManifest = JSON.parse(readFileSync(standardDocsManifestPath, 'utf8'));
  const standardDocsArtifactManifest = JSON.parse(readFileSync(standardDocsArtifactManifestPath, 'utf8'));
  assert.equal(standardDocsManifest.generated_at, standardDocsGeneratedAt);
  assert.deepEqual(standardDocsManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(standardDocsArtifactManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(standardDocsArtifactManifest.revision_lineage, standardDocsManifest.revision_lineage);
  assert.deepEqual(standardDocsArtifactManifest.timestamps, {
    created_at: standardDocsGeneratedAt,
    started_at: standardDocsGeneratedAt,
    finished_at: standardDocsGeneratedAt,
  });
  const selectedConfigParent = selectedReadiness.revision_lineage.parents.find(
    (parent) => parent.role === 'authoritative_config'
  );
  assert.deepEqual(
    standardDocsManifest.revision_lineage.parents.find(
      (parent) => parent.role === 'authoritative_config'
    ),
    selectedConfigParent
  );
  const selectedReadinessBytes = readFileSync(selectedReadinessOutput);
  assert.deepEqual(
    standardDocsManifest.revision_lineage.parents.find(
      (parent) => parent.role === 'readiness_report'
    ),
    {
      artifact_type: 'readiness_report',
      role: 'readiness_report',
      path: 'run/readiness_report.json',
      sha256: sha256(selectedReadinessBytes),
      size_bytes: selectedReadinessBytes.length,
    }
  );
  const firstStandardDocsPublication = snapshotFlatDirectory(selectedStandardDocsDir);
  const secondStandardDocsRun = runCli(standardDocsArgs);
  assert.equal(
    secondStandardDocsRun.status,
    0,
    `${secondStandardDocsRun.stdout}\n${secondStandardDocsRun.stderr}`
  );
  for (const [name, bytes] of firstStandardDocsPublication) {
    assert.deepEqual(
      readFileSync(join(selectedStandardDocsDir, name)),
      bytes,
      `proof standard-docs rerun must be deterministic for ${name}`
    );
  }

  const tamperedReadiness = structuredClone(selectedReadiness);
  tamperedReadiness.revision_lineage.parents.find(
    (parent) => parent.role === 'authoritative_config'
  ).sha256 = '0'.repeat(64);
  const tamperedReadinessPath = join(proofInputScratch, 'tampered-selected-readiness.json');
  writeFileSync(tamperedReadinessPath, `${JSON.stringify(tamperedReadiness, null, 2)}\n`, 'utf8');
  const tamperedStandardDocsDir = join(proofInputScratch, 'tampered-standard-docs');
  assertRejected(
    runCli([
      'generate-standard-docs',
      'configs/examples/hinge_block.toml',
      '--readiness-report', relative(ROOT, tamperedReadinessPath),
      '--proof-lineage',
      '--generated-at', standardDocsGeneratedAt,
      '--out-dir', tamperedStandardDocsDir,
    ]),
    /does not match the exact proof snapshot|digest_mismatch|digest/i,
    'tampered standard-docs readiness parent'
  );
  assert.equal(existsSync(tamperedStandardDocsDir), false);

  const duplicateReadinessPath = join(proofInputScratch, 'duplicate-selected-readiness.json');
  writeFileSync(
    duplicateReadinessPath,
    readFileSync(selectedReadinessOutput, 'utf8').replace(
      '"schema_version": "1.0",',
      '"schema_version": "1.0",\n  "schema_version": "1.0",'
    ),
    'utf8'
  );
  const duplicateStandardDocsDir = join(proofInputScratch, 'duplicate-standard-docs');
  assertRejected(
    runCli([
      'generate-standard-docs',
      'configs/examples/hinge_block.toml',
      '--readiness-report', relative(ROOT, duplicateReadinessPath),
      '--proof-lineage',
      '--out-dir', duplicateStandardDocsDir,
    ]),
    /duplicate json object keys|duplicate_json_key/i,
    'duplicate-key standard-docs readiness snapshot'
  );
  assert.equal(existsSync(duplicateStandardDocsDir), false);

  const docsBundleDir = join(selectedRunDir, 'docs-proof-bundle');
  const docsBundleOutput = join(docsBundleDir, 'release_bundle.zip');
  const docsPackArgs = [
    'pack',
    '--readiness', selectedReadinessOutput,
    '--docs-manifest', standardDocsManifestPath,
    '--proof-lineage',
    '--generated-at', standardDocsGeneratedAt,
    '--out', docsBundleOutput,
  ];
  const firstDocsPackRun = runCli(docsPackArgs);
  assert.equal(firstDocsPackRun.status, 0, `${firstDocsPackRun.stdout}\n${firstDocsPackRun.stderr}`);
  const docsReleaseManifest = JSON.parse(
    readFileSync(join(docsBundleDir, 'release_bundle_manifest.json'), 'utf8')
  );
  assert.deepEqual(docsReleaseManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(docsReleaseManifest.revision_lineage, selectedReadiness.revision_lineage);
  assert.equal(docsReleaseManifest.coverage.docs_included, true);
  const bundledDocsManifest = docsReleaseManifest.bundle_artifacts.find(
    (entry) => entry.artifact_type === 'docs_manifest'
  );
  assert.equal(bundledDocsManifest.sha256, sha256(readFileSync(standardDocsManifestPath)));
  const firstDocsBundlePublication = snapshotFlatDirectory(docsBundleDir);
  const secondDocsPackRun = runCli(docsPackArgs);
  assert.equal(secondDocsPackRun.status, 0, `${secondDocsPackRun.stdout}\n${secondDocsPackRun.stderr}`);
  for (const [name, bytes] of firstDocsBundlePublication) {
    assert.deepEqual(
      readFileSync(join(docsBundleDir, name)),
      bytes,
      `proof docs bundle rerun must be deterministic for ${name}`
    );
  }

  const alternateRunDir = join(scratch, 'run-b');
  mkdirSync(alternateRunDir, { recursive: true });
  const alternateReviewOutput = join(alternateRunDir, 'review_pack.json');
  const alternateReviewRun = runCli([
    'review-context',
    '--context', contextPath,
    '--config', 'configs/examples/hinge_block.toml',
    '--part-id', 'hinge_block',
    '--revision', 'A',
    '--proof-lineage',
    '--out', alternateReviewOutput,
  ]);
  assert.equal(alternateReviewRun.status, 0, `${alternateReviewRun.stdout}\n${alternateReviewRun.stderr}`);

  const alternateReadinessOutput = join(alternateRunDir, 'readiness_report.json');
  const alternateReadinessRun = runCli([
    'readiness-pack',
    '--review-pack', relative(ROOT, alternateReviewOutput),
    '--proof-lineage',
    '--out', alternateReadinessOutput,
  ]);
  assert.equal(
    alternateReadinessRun.status,
    0,
    `${alternateReadinessRun.stdout}\n${alternateReadinessRun.stderr}`
  );

  const alternateInspectionOutput = join(alternateRunDir, 'inspection_plan.json');
  const alternateInspectionRun = runCli([
    'inspection-plan',
    '--review-pack', relative(ROOT, alternateReviewOutput).replaceAll('\\', '/'),
    '--readiness', relative(ROOT, alternateReadinessOutput).replaceAll('\\', '/'),
    '--config', 'configs/examples/hinge_block.toml',
    '--scope', 'full',
    '--proof-lineage',
    '--generated-at', '2026-07-27T02:03:04.000Z',
    '--out', alternateInspectionOutput,
  ]);
  assert.equal(
    alternateInspectionRun.status,
    0,
    `${alternateInspectionRun.stdout}\n${alternateInspectionRun.stderr}`
  );

  const alternateStandardDocsDir = join(alternateRunDir, 'standard-docs');
  const alternateStandardDocsRun = runCli([
    'generate-standard-docs',
    'configs/examples/hinge_block.toml',
    '--readiness-report', relative(ROOT, alternateReadinessOutput),
    '--proof-lineage',
    '--generated-at', standardDocsGeneratedAt,
    '--out-dir', alternateStandardDocsDir,
  ]);
  assert.equal(
    alternateStandardDocsRun.status,
    0,
    `${alternateStandardDocsRun.stdout}\n${alternateStandardDocsRun.stderr}`
  );

  const alternateBundleDir = join(alternateRunDir, 'docs-proof-bundle');
  const alternatePackRun = runCli([
    'pack',
    '--readiness', alternateReadinessOutput,
    '--docs-manifest', join(alternateStandardDocsDir, 'standard_docs_manifest.json'),
    '--proof-lineage',
    '--generated-at', standardDocsGeneratedAt,
    '--out', join(alternateBundleDir, 'release_bundle.zip'),
  ]);
  assert.equal(alternatePackRun.status, 0, `${alternatePackRun.stdout}\n${alternatePackRun.stderr}`);

  assertFlatDirectoryBytesEqual(
    selectedRunDir,
    alternateRunDir,
    'separate proof run directories'
  );
  assertFlatDirectoryBytesEqual(
    selectedStandardDocsDir,
    alternateStandardDocsDir,
    'separate proof standard-docs directories'
  );
  assertFlatDirectoryBytesEqual(
    docsBundleDir,
    alternateBundleDir,
    'separate proof release-bundle directories'
  );

  const guardedTmpInputDir = join(selectedRunDir, 'guarded-tmp-input');
  mkdirSync(guardedTmpInputDir, { recursive: true });
  const guardedReviewPath = join(guardedTmpInputDir, 'review_pack.json');
  writeFileSync(guardedReviewPath, readFileSync(selectedOutput));
  const arbitraryTmpSourcePath = join(guardedTmpInputDir, 'not-a-lineage-parent.txt');
  writeFileSync(arbitraryTmpSourcePath, 'must not be bundled\n', 'utf8');
  const readinessWithArbitraryTmpRef = structuredClone(selectedReadiness);
  readinessWithArbitraryTmpRef.revision_lineage.parents.find(
    (parent) => parent.role === 'review_pack'
  ).path = relative(ROOT, guardedReviewPath).replaceAll('\\', '/');
  readinessWithArbitraryTmpRef.source_artifact_refs.push({
    artifact_type: 'source_file',
    path: relative(ROOT, arbitraryTmpSourcePath).replaceAll('\\', '/'),
    role: 'input',
    label: 'Arbitrary ignored-run sidecar',
  });
  const readinessWithArbitraryTmpRefPath = join(guardedTmpInputDir, 'readiness_report.json');
  writeFileSync(
    readinessWithArbitraryTmpRefPath,
    `${JSON.stringify(readinessWithArbitraryTmpRef, null, 2)}\n`,
    'utf8'
  );
  const guardedTmpBundleDir = join(selectedRunDir, 'guarded-tmp-bundle');
  const guardedTmpPackRun = runCli([
    'pack',
    '--readiness', readinessWithArbitraryTmpRefPath,
    '--proof-lineage',
    '--generated-at', standardDocsGeneratedAt,
    '--out', join(guardedTmpBundleDir, 'release_bundle.zip'),
  ]);
  assert.equal(guardedTmpPackRun.status, 0, `${guardedTmpPackRun.stdout}\n${guardedTmpPackRun.stderr}`);
  const guardedTmpManifest = JSON.parse(
    readFileSync(join(guardedTmpBundleDir, 'release_bundle_manifest.json'), 'utf8')
  );
  assert.equal(
    guardedTmpManifest.bundle_artifacts.some((entry) => entry.artifact_type === 'source_file'),
    false
  );
  assert.equal(
    guardedTmpManifest.skipped_artifacts.some((entry) => (
      entry.artifact_type === 'source_file'
      && entry.reason === 'disallowed_repo_source_path'
    )),
    true
  );

  const tamperedDocsManifest = structuredClone(standardDocsManifest);
  tamperedDocsManifest.revision_lineage.parents.find(
    (parent) => parent.role === 'readiness_report'
  ).sha256 = '0'.repeat(64);
  const tamperedDocsManifestPath = join(proofInputScratch, 'tampered-standard-docs-manifest.json');
  writeFileSync(tamperedDocsManifestPath, `${JSON.stringify(tamperedDocsManifest, null, 2)}\n`, 'utf8');
  const rejectedDocsBundleDir = join(proofInputScratch, 'rejected-docs-bundle');
  assertRejected(
    runCli([
      'pack',
      '--readiness', selectedReadinessOutput,
      '--docs-manifest', tamperedDocsManifestPath,
      '--proof-lineage',
      '--generated-at', standardDocsGeneratedAt,
      '--out', join(rejectedDocsBundleDir, 'release_bundle.zip'),
    ]),
    /readiness parent does not match|digest/i,
    'pack tampered docs readiness parent'
  );
  assert.equal(existsSync(rejectedDocsBundleDir), false);

  const missingDocsLineage = structuredClone(standardDocsManifest);
  delete missingDocsLineage.effective_policy;
  delete missingDocsLineage.revision_lineage;
  const missingDocsLineagePath = join(proofInputScratch, 'missing-lineage-standard-docs-manifest.json');
  writeFileSync(missingDocsLineagePath, `${JSON.stringify(missingDocsLineage, null, 2)}\n`, 'utf8');
  const missingDocsBundleDir = join(proofInputScratch, 'missing-lineage-docs-bundle');
  assertRejected(
    runCli([
      'pack',
      '--readiness', selectedReadinessOutput,
      '--docs-manifest', missingDocsLineagePath,
      '--proof-lineage',
      '--generated-at', standardDocsGeneratedAt,
      '--out', join(missingDocsBundleDir, 'release_bundle.zip'),
    ]),
    /docs-manifest revision_lineage|revision_lineage/i,
    'pack missing docs lineage'
  );
  assert.equal(existsSync(missingDocsBundleDir), false);

  const legacyOutput = join(scratch, 'legacy-review-pack.json');
  const legacyRun = runCli([
    'review-context',
    '--context', contextPath,
    '--out', legacyOutput,
  ]);
  assert.equal(legacyRun.status, 0, `${legacyRun.stdout}\n${legacyRun.stderr}`);
  const legacyReviewPack = JSON.parse(readFileSync(legacyOutput, 'utf8'));
  assert.equal(Object.hasOwn(legacyReviewPack, 'revision_lineage'), false);

  const proofConfigPath = join(proofInputScratch, 'proof-config.json');
  const proofConfigBytes = Buffer.from(`${JSON.stringify({
    config_version: 1,
    name: 'hinge_block',
    product: {
      package_slug: 'hinge-block',
      part_id: 'hinge_block',
      revision: 'A',
    },
  }, null, 2)}\n`);
  writeFileSync(proofConfigPath, proofConfigBytes);
  const proofConfigRef = relative(ROOT, proofConfigPath).replaceAll('\\', '/');
  const configParent = {
    artifact_type: 'config',
    role: 'authoritative_config',
    path: proofConfigRef,
    sha256: sha256(proofConfigBytes),
    size_bytes: proofConfigBytes.length,
  };
  const proofReviewPack = structuredClone(legacyReviewPack);
  proofReviewPack.revision_lineage = {
    schema_version: '1.0',
    mode: 'proof',
    identity: {
      package_slug: 'hinge-block',
      part_id: 'hinge_block',
      revision: 'A',
      config_sha256: configParent.sha256,
    },
    parents: [configParent],
  };
  proofReviewPack.source_artifact_refs = [
    ...(proofReviewPack.source_artifact_refs || []).filter((entry) => entry.artifact_type !== 'config'),
    {
      artifact_type: 'config',
      path: proofConfigRef,
      role: 'input',
      label: 'Authoritative proof-lineage config',
      sha256: configParent.sha256,
      size_bytes: configParent.size_bytes,
    },
  ];
  const proofReviewPath = join(proofInputScratch, 'proof-review-pack.json');
  writeFileSync(proofReviewPath, `${JSON.stringify(proofReviewPack, null, 2)}\n`, 'utf8');
  const proofReadinessOutput = join(proofInputScratch, 'proof-readiness.json');
  const proofReadinessRun = runCli([
    'readiness-pack',
    '--review-pack', relative(ROOT, proofReviewPath),
    '--proof-lineage',
    '--out', proofReadinessOutput,
  ]);
  assert.equal(proofReadinessRun.status, 0, `${proofReadinessRun.stdout}\n${proofReadinessRun.stderr}`);
  const proofReadiness = JSON.parse(readFileSync(proofReadinessOutput, 'utf8'));
  const proofReadinessManifestPath = join(proofInputScratch, 'proof-readiness_artifact-manifest.json');
  const proofReadinessManifest = JSON.parse(readFileSync(proofReadinessManifestPath, 'utf8'));
  assert.deepEqual(proofReadinessManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(proofReadinessManifest.revision_lineage, proofReadiness.revision_lineage);
  assert.deepEqual(proofReadinessManifest.timestamps, {
    created_at: proofReadiness.generated_at,
    started_at: proofReadiness.generated_at,
    finished_at: proofReadiness.generated_at,
  });

  const proofBundleOutput = join(scratch, 'proof-release.zip');
  const proofPackArgs = [
    'pack',
    '--readiness', proofReadinessOutput,
    '--proof-lineage',
    '--generated-at', '2026-07-27T00:00:00Z',
    '--out', proofBundleOutput,
  ];
  const firstProofPack = runCli(proofPackArgs);
  assert.equal(firstProofPack.status, 0, `${firstProofPack.stdout}\n${firstProofPack.stderr}`);
  const proofBundleManifestPath = join(scratch, 'proof-release_artifact-manifest.json');
  const proofBundleManifest = JSON.parse(readFileSync(proofBundleManifestPath, 'utf8'));
  assert.deepEqual(proofBundleManifest.effective_policy, { proof_lineage: true });
  assert.deepEqual(proofBundleManifest.revision_lineage, proofReadiness.revision_lineage);
  assert.deepEqual(proofBundleManifest.timestamps, {
    created_at: '2026-07-27T00:00:00Z',
    started_at: '2026-07-27T00:00:00Z',
    finished_at: '2026-07-27T00:00:00Z',
  });
  const proofPublicationPaths = [
    proofBundleManifestPath,
    ...proofBundleManifest.artifacts
      .filter((entry) => entry.scope === 'user-facing')
      .map((entry) => entry.path.startsWith('run/')
        ? join(dirname(proofBundleManifestPath), entry.path.slice('run/'.length))
        : entry.path.startsWith('repo/')
          ? join(ROOT, entry.path.slice('repo/'.length))
          : entry.path),
  ];
  const firstProofPublication = new Map(
    proofPublicationPaths.map((path) => [path, readFileSync(path)])
  );
  const secondProofPack = runCli(proofPackArgs);
  assert.equal(secondProofPack.status, 0, `${secondProofPack.stdout}\n${secondProofPack.stderr}`);
  for (const [path, bytes] of firstProofPublication) {
    assert.deepEqual(readFileSync(path), bytes, `proof pack rerun must be deterministic for ${path}`);
  }

  const validReviewJob = validateJobRequest({
    type: 'review-context',
    config_path: 'configs/examples/hinge_block.toml',
    context_path: 'tests/fixtures/sample_part_context.json',
    options: { proof_lineage: true },
  });
  assert.equal(validReviewJob.ok, true, validReviewJob.errors.join('\n'));

  const invalidReviewProofValues = [
    {
      type: 'review-context',
      config_path: 'configs/examples/hinge_block.toml',
      context_path: 'tests/fixtures/sample_part_context.json',
      options: { proof_lineage: false },
    },
    {
      type: 'review-context',
      context_path: 'tests/fixtures/sample_part_context.json',
      options: { proof_lineage: true },
    },
    {
      type: 'review-context',
      config_path: '/tmp/hinge_block.toml',
      context_path: 'tests/fixtures/sample_part_context.json',
      options: { proof_lineage: true },
    },
    {
      type: 'compare-rev',
      baseline_path: 'tests/fixtures/revision-impact/tightened-tolerance-baseline-review-pack.json',
      candidate_path: 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json',
      options: { proof_lineage: true },
    },
    {
      type: 'stabilization-review',
      baseline_path: 'docs/examples/hinge-block/readiness/readiness_report.json',
      candidate_path: 'docs/examples/hinge-block/readiness/readiness_report.json',
      options: { proof_lineage: true },
    },
  ];
  for (const request of invalidReviewProofValues) {
    const validation = validateJobRequest(request);
    assert.equal(validation.ok, false, JSON.stringify(request));
  }

  const validInspectionJob = validateJobRequest({
    type: 'inspection-plan',
    review_pack_path: 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json',
    config_path: 'configs/examples/hinge_block.toml',
    scope: 'full',
    options: { proof_lineage: true },
  });
  assert.equal(validInspectionJob.ok, true, validInspectionJob.errors.join('\n'));

  const validReadinessJob = validateJobRequest({
    type: 'readiness-pack',
    review_pack_path: 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json',
    options: { proof_lineage: true },
  });
  assert.equal(validReadinessJob.ok, true, validReadinessJob.errors.join('\n'));

  const validStandardDocsJob = validateJobRequest({
    type: 'generate-standard-docs',
    config_path: 'configs/examples/hinge_block.toml',
    readiness_report_path: 'docs/examples/hinge-block/readiness/readiness_report.json',
    options: { proof_lineage: true },
  });
  assert.equal(validStandardDocsJob.ok, true, validStandardDocsJob.errors.join('\n'));

  const validPackJob = validateJobRequest({
    type: 'pack',
    readiness_report_path: 'docs/examples/hinge-block/readiness/readiness_report.json',
    options: { proof_lineage: true },
  });
  assert.equal(validPackJob.ok, true, validPackJob.errors.join('\n'));
} finally {
  rmSync(scratch, { recursive: true, force: true });
  rmSync(proofInputScratch, { recursive: true, force: true });
}

console.log('revision-lineage-cli-integration.test.js: ok');

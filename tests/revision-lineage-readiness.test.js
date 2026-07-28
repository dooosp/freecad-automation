import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildRevisionLineage,
  buildRevisionLineageParent,
} from '../lib/revision-lineage-contract.js';
import { validateCArtifact } from '../lib/c-artifact-schema.js';
import {
  buildProcessPlanFromReviewPack,
  buildQualityRiskFromReviewPack,
  buildReadinessReportFromReviewPack,
  writeCanonicalReadinessArtifacts,
} from '../src/workflows/canonical-readiness-builders.js';

const ROOT = resolve(import.meta.dirname, '..');
const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-revision-lineage-readiness-'));
const FIXTURE_PATH = join(ROOT, 'tests', 'fixtures', 'd-artifacts', 'sample_review_pack.canonical.json');
const REVIEW_LOCATOR = 'review/proof_review_pack.json';
const REVIEW_PROOF_LOCATOR = 'run/proof_review_pack.json';
const REVIEW_PATH = join(TMP_DIR, REVIEW_LOCATOR);
const CONFIG_SHA256 = 'c'.repeat(64);
const CONFIG_SIZE_BYTES = 321;
const GENERATED_AT = '2026-07-27T00:00:00.000Z';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function proofReviewPack() {
  const reviewPack = clone(readJson(FIXTURE_PATH));
  const identity = {
    package_slug: 'proof-bracket',
    part_id: reviewPack.part_id,
    revision: reviewPack.revision,
    config_sha256: CONFIG_SHA256,
  };
  reviewPack.source_artifact_refs.push({
    artifact_type: 'config',
    path: 'configs/proof_bracket.toml',
    role: 'input',
    label: 'Authoritative config snapshot',
    sha256: CONFIG_SHA256,
    size_bytes: CONFIG_SIZE_BYTES,
  });
  reviewPack.revision_lineage = buildRevisionLineage({
    identity,
    parents: [buildRevisionLineageParent({
      artifactType: 'config',
      role: 'authoritative_config',
      path: 'configs/proof_bracket.toml',
      sha256: CONFIG_SHA256,
      sizeBytes: CONFIG_SIZE_BYTES,
    })],
  });
  return reviewPack;
}

function snapshotReviewPack(reviewPack, {
  locator = REVIEW_LOCATOR,
  write = true,
  useSizeAlias = false,
} = {}) {
  const bytes = Buffer.from(`${JSON.stringify(reviewPack, null, 2)}\n`);
  if (write) {
    const outputPath = join(TMP_DIR, locator);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, bytes);
  }
  return {
    path: locator,
    bytes,
    sha256: sha256(bytes),
    ...(useSizeAlias ? { size: bytes.length } : { size_bytes: bytes.length }),
  };
}

function assertLineageError(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error?.name, 'RevisionLineageError');
    assert.equal(error?.code, code);
    assert.equal(error?.reason_code, code);
    return true;
  });
}

function assertExactProofPropagation(artifact, snapshot, expectedLineage) {
  assert.deepEqual(artifact.revision_lineage, expectedLineage);
  assert.equal(artifact.part.package_slug, expectedLineage.identity.package_slug);
  assert.equal(artifact.part.part_id, expectedLineage.identity.part_id);
  assert.equal(artifact.part.revision, expectedLineage.identity.revision);
  const configRef = artifact.source_artifact_refs.find((ref) => (
    ref.artifact_type === 'config' && ref.path === 'configs/proof_bracket.toml'
  ));
  assert.equal(configRef.sha256, CONFIG_SHA256);
  assert.equal(configRef.size_bytes, CONFIG_SIZE_BYTES);
  const reviewRef = artifact.source_artifact_refs.find((ref) => (
    ref.artifact_type === 'review_pack'
    && ref.role === 'input'
    && ref.path === REVIEW_PROOF_LOCATOR
  ));
  assert.equal(reviewRef.sha256, snapshot.sha256);
  assert.equal(reviewRef.size_bytes, snapshot.size ?? snapshot.size_bytes);
}

try {
  const legacyNullable = clone(readJson(FIXTURE_PATH));
  legacyNullable.part_id = null;
  legacyNullable.revision = null;
  legacyNullable.part.part_id = null;
  legacyNullable.part.revision = null;
  const legacyReport = buildReadinessReportFromReviewPack({
    reviewPack: legacyNullable,
    generatedAt: GENERATED_AT,
  });
  assert.equal(legacyReport.part.part_id, null);
  assert.equal(legacyReport.part.revision, null);
  assert.equal('revision_lineage' in legacyReport, false);
  assert.equal('revision_lineage' in legacyReport.process_plan, false);
  assert.equal('revision_lineage' in legacyReport.quality_risk, false);

  const proofPack = proofReviewPack();
  const proofSnapshot = snapshotReviewPack(proofPack, { useSizeAlias: true });

  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: 'true',
  }), 'malformed_policy');
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    requireAuthoritativeLineage: true,
  }), 'missing_parent');
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: 'review/different_locator.json',
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
  }), 'conflicting_identity');
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: '../review/proof_review_pack.json',
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
  }), 'unsafe_path');

  const nonActivated = buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    generatedAt: GENERATED_AT,
  });
  assert.equal('revision_lineage' in nonActivated, false, 'lineage presence alone must not activate proof mode');

  const processPlan = buildProcessPlanFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    generatedAt: GENERATED_AT,
  });
  const qualityRisk = buildQualityRiskFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    generatedAt: GENERATED_AT,
  });
  const report = buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    processPlan,
    qualityRisk,
    generatedAt: GENERATED_AT,
  });

  const expectedReviewParent = buildRevisionLineageParent({
    artifactType: 'review_pack',
    role: 'review_pack',
    path: REVIEW_PROOF_LOCATOR,
    sha256: proofSnapshot.sha256,
    sizeBytes: proofSnapshot.size,
  });
  const expectedLineage = buildRevisionLineage({
    identity: proofPack.revision_lineage.identity,
    parents: [...proofPack.revision_lineage.parents, expectedReviewParent],
  });
  const digestMismatchedProcessPlan = clone(processPlan);
  const mismatchedReviewParent = digestMismatchedProcessPlan.revision_lineage.parents.find((parent) => (
    parent.role === 'review_pack'
  ));
  mismatchedReviewParent.sha256 = 'd'.repeat(64);
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    processPlan: digestMismatchedProcessPlan,
    qualityRisk,
    generatedAt: GENERATED_AT,
  }), 'digest_mismatch');
  const basisConflictProcessPlan = clone(processPlan);
  basisConflictProcessPlan.planning_basis.source_review_pack.revision = 'CONFLICTING-REVISION';
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    processPlan: basisConflictProcessPlan,
    qualityRisk,
    generatedAt: GENERATED_AT,
  }), 'conflicting_identity');
  const missingBasisAliasProcessPlan = clone(processPlan);
  delete missingBasisAliasProcessPlan.planning_basis.source_review_pack.part_id;
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
    processPlan: missingBasisAliasProcessPlan,
    qualityRisk,
    generatedAt: GENERATED_AT,
  }), 'missing_identity');
  for (const artifact of [processPlan, qualityRisk, report]) {
    assertExactProofPropagation(artifact, proofSnapshot, expectedLineage);
    assert.equal(
      artifact.generated_at,
      proofPack.generated_at,
      'proof readiness timestamps must derive from the exact review pack'
    );
  }
  assert.deepEqual(report.review_pack, proofPack, 'proof readiness must embed the exact review-pack parent document');
  assert.deepEqual(report.process_plan.revision_lineage, expectedLineage);
  assert.deepEqual(report.quality_risk.revision_lineage, expectedLineage);
  assert.equal(processPlan.planning_basis.source_review_pack.config_sha256, CONFIG_SHA256);
  assert.equal(processPlan.planning_basis.source_review_pack.sha256, proofSnapshot.sha256);
  assert.equal(processPlan.planning_basis.source_review_pack.size_bytes, proofSnapshot.size);
  const validation = validateCArtifact('readiness_report', report);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const aliasConflict = proofReviewPack();
  aliasConflict.part.part_id = 'CONFLICTING-PART';
  const aliasConflictSnapshot = snapshotReviewPack(aliasConflict, {
    locator: 'review/alias_conflict.json',
    write: false,
  });
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: aliasConflict,
    reviewPackPath: 'review/alias_conflict.json',
    reviewPackSnapshot: aliasConflictSnapshot,
    requireAuthoritativeLineage: true,
  }), 'conflicting_identity');

  const missingAlias = proofReviewPack();
  delete missingAlias.revision;
  const missingAliasSnapshot = snapshotReviewPack(missingAlias, {
    locator: 'review/missing_alias.json',
    write: false,
  });
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: missingAlias,
    reviewPackPath: 'review/missing_alias.json',
    reviewPackSnapshot: missingAliasSnapshot,
    requireAuthoritativeLineage: true,
  }), 'missing_identity');

  const mismatchedConfigSource = proofReviewPack();
  mismatchedConfigSource.source_artifact_refs.find((ref) => ref.artifact_type === 'config').sha256 = 'd'.repeat(64);
  const mismatchedConfigSourceSnapshot = snapshotReviewPack(mismatchedConfigSource, {
    locator: 'review/mismatched_config_source.json',
    write: false,
  });
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: mismatchedConfigSource,
    reviewPackPath: 'review/mismatched_config_source.json',
    reviewPackSnapshot: mismatchedConfigSourceSnapshot,
    requireAuthoritativeLineage: true,
  }), 'digest_mismatch');

  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: { ...proofSnapshot, sha256: 'd'.repeat(64) },
    requireAuthoritativeLineage: true,
  }), 'digest_mismatch');

  const duplicateKeyBytes = Buffer.from(proofSnapshot.bytes.toString('utf8').replace(
    `"part_id": "${proofPack.part_id}",`,
    `"part_id": "${proofPack.part_id}",\n  "part_id": "${proofPack.part_id}",`
  ));
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: {
      path: REVIEW_LOCATOR,
      bytes: duplicateKeyBytes,
      sha256: sha256(duplicateKeyBytes),
      size_bytes: duplicateKeyBytes.length,
    },
    requireAuthoritativeLineage: true,
  }), 'digest_mismatch');

  const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), proofSnapshot.bytes]);
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: proofPack,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: {
      path: REVIEW_LOCATOR,
      bytes: bomBytes,
      sha256: sha256(bomBytes),
      size_bytes: bomBytes.length,
    },
    requireAuthoritativeLineage: true,
  }), 'digest_mismatch');

  const excessiveDepthPack = proofReviewPack();
  let depthProbe = {};
  for (let depth = 0; depth < 70; depth += 1) depthProbe = { child: depthProbe };
  excessiveDepthPack.depth_probe = depthProbe;
  const excessiveDepthSnapshot = snapshotReviewPack(excessiveDepthPack, {
    locator: 'review/excessive_depth.json',
    write: false,
  });
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: excessiveDepthPack,
    reviewPackPath: 'review/excessive_depth.json',
    reviewPackSnapshot: excessiveDepthSnapshot,
    requireAuthoritativeLineage: true,
  }), 'input_size_out_of_bounds');

  const bytesMismatch = proofReviewPack();
  bytesMismatch.part.description = 'Changed after the review snapshot was captured.';
  assertLineageError(() => buildReadinessReportFromReviewPack({
    reviewPack: bytesMismatch,
    reviewPackPath: REVIEW_LOCATOR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
  }), 'digest_mismatch');

  const outputJson = join(dirname(REVIEW_PATH), 'readiness_report.json');
  const outputMarkdown = join(dirname(REVIEW_PATH), 'readiness_report.md');
  await assert.rejects(
    writeCanonicalReadinessArtifacts(outputJson, report, { projectRoot: TMP_DIR }),
    (error) => {
      assert.equal(error?.code, 'malformed_policy');
      return true;
    }
  );
  assert.equal(existsSync(outputJson), false, 'proof-looking report without explicit policy must not write JSON');
  assert.equal(existsSync(outputMarkdown), false, 'proof-looking report without explicit policy must not write Markdown');
  const originalReviewBytes = readFileSync(REVIEW_PATH);
  await assert.rejects(
    writeCanonicalReadinessArtifacts(REVIEW_PATH, report, {
      projectRoot: TMP_DIR,
      reviewPackSnapshot: proofSnapshot,
      requireAuthoritativeLineage: true,
    }),
    (error) => {
      assert.equal(error?.code, 'unsafe_path');
      return true;
    }
  );
  assert.deepEqual(readFileSync(REVIEW_PATH), originalReviewBytes, 'readiness output must not overwrite its review parent');
  const outsideRunOutput = join(TMP_DIR, 'outside-run-readiness.json');
  await assert.rejects(
    writeCanonicalReadinessArtifacts(outsideRunOutput, report, {
      projectRoot: TMP_DIR,
      reviewPackSnapshot: proofSnapshot,
      requireAuthoritativeLineage: true,
    }),
    (error) => error?.code === 'unsafe_path'
  );
  assert.equal(existsSync(outsideRunOutput), false);
  await writeCanonicalReadinessArtifacts(outputJson, report, {
    projectRoot: TMP_DIR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
  });
  const originalJson = readFileSync(outputJson);
  const originalMarkdown = readFileSync(outputMarkdown);

  const concurrentlyMutatedReport = clone(report);
  const concurrentWrite = writeCanonicalReadinessArtifacts(outputJson, concurrentlyMutatedReport, {
    projectRoot: TMP_DIR,
    reviewPackSnapshot: proofSnapshot,
    requireAuthoritativeLineage: true,
  });
  concurrentlyMutatedReport.part.revision = 'MUTATED-DURING-WRITE';
  await concurrentWrite;
  assert.equal(readJson(outputJson).part.revision, report.part.revision, 'writer must publish its read-once report snapshot');

  await assert.rejects(
    writeCanonicalReadinessArtifacts(outputJson, {
      ...report,
      review_pack: {
        ...report.review_pack,
        data_quality_notes: [...(report.review_pack.data_quality_notes || []), 'Tampered after build.'],
      },
    }, {
      projectRoot: TMP_DIR,
      reviewPackSnapshot: proofSnapshot,
      requireAuthoritativeLineage: true,
    }),
    (error) => {
      assert.equal(error?.code, 'digest_mismatch');
      return true;
    }
  );
  assert.deepEqual(readFileSync(outputJson), originalJson, 'tampered embedded review must not replace readiness JSON');
  assert.deepEqual(readFileSync(outputMarkdown), originalMarkdown, 'tampered embedded review must not replace readiness Markdown');

  writeFileSync(REVIEW_PATH, `${readFileSync(REVIEW_PATH, 'utf8')} `, 'utf8');
  await assert.rejects(
    writeCanonicalReadinessArtifacts(outputJson, {
      ...report,
      summary: { ...report.summary, stale_write_must_not_land: true },
    }, {
      projectRoot: TMP_DIR,
      reviewPackSnapshot: proofSnapshot,
      requireAuthoritativeLineage: true,
    }),
    (error) => {
      assert.equal(error?.name, 'RevisionLineageError');
      assert.equal(error?.code, 'stale_parent');
      return true;
    }
  );
  assert.deepEqual(readFileSync(outputJson), originalJson, 'stale review bytes must not replace readiness JSON');
  assert.deepEqual(readFileSync(outputMarkdown), originalMarkdown, 'stale review bytes must not replace readiness Markdown');

  console.log('revision-lineage-readiness.test.js: ok');
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import {
  canonicalizeRevisionImpactJson,
  renderRevisionImpactMarkdown,
} from '../lib/revision-impact-contract.js';
import {
  REVISION_IMPACT_MAX_JSON_BYTES,
  RevisionImpactServiceError,
  buildRevisionImpactReport,
  createRevisionImpactReportFromPaths,
  loadRevisionImpactInputSet,
  writeRevisionImpactArtifacts,
} from '../src/services/revision-impact/revision-impact-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-07-11T00:00:00Z';
const CANONICAL_REVIEW_PACK = 'docs/examples/quality-pass-bracket/review/review_pack.json';

function makeSide({
  slug = 'sample-bracket',
  revision = 'A',
  partId = 'PART-100',
  material = 'AL6061',
  process = 'machining',
  nominal = 10,
  unit = 'mm',
  tolerance = '±0.20 mm',
  characteristics = null,
  evidenceEnvelope = null,
} = {}) {
  const dimensions = characteristics || [{
    id: 'CHAR.HOLE_DIAMETER',
    feature: 'hole-1',
    ...(unit === 'mm' ? { value_mm: nominal } : { value: nominal, unit }),
    tolerance,
    required: true,
    specification_ref: 'DWG-100:HOLE-DIAMETER',
    inspection_method: 'calibrated_bore_gauge',
  }];
  return {
    reviewPack: {
      artifact_type: 'review_pack',
      revision,
      part_id: partId,
      part: {
        part_id: partId,
        revision,
        material,
        process,
        description: null,
      },
      metadata: { package_slug: slug },
      geometry_features: { records: [] },
    },
    drawing_intent: {
      material,
      manufacturing_process: process,
      required_dimensions: dimensions,
      critical_features: [],
      required_notes: [],
      required_views: ['top'],
      datum_strategy: { primary: 'datum-a' },
    },
    ...(evidenceEnvelope ? { evidenceEnvelope } : {}),
  };
}

function errorCode(code) {
  return (error) => error instanceof RevisionImpactServiceError && error.code === code;
}

const unchanged = buildRevisionImpactReport({
  baseline: makeSide(),
  candidate: makeSide(),
  generatedAt: GENERATED_AT,
});
assert.equal(unchanged.summary.decision, 'no_material_change');
assert.equal(unchanged.baseline.part_id, 'PART-100');
assert.equal(unchanged.candidate.part_id, 'PART-100');
assert.equal(unchanged.reinspection_plan.items.length, 0);
assert.equal(unchanged.boundaries.canonical_artifacts_mutated, false);
assert.equal(unchanged.boundaries.inspection_evidence_attached, false);

const shuffled = buildRevisionImpactReport({
  baseline: makeSide(),
  candidate: {
    ...makeSide(),
    drawing_intent: {
      ...makeSide().drawing_intent,
      required_views: ['top'],
      required_notes: [],
      critical_features: [],
    },
  },
  generatedAt: GENERATED_AT,
});
assert.equal(canonicalizeRevisionImpactJson(shuffled), canonicalizeRevisionImpactJson(unchanged));

const tightened = buildRevisionImpactReport({
  baseline: makeSide({ revision: 'A', tolerance: '±0.20 mm' }),
  candidate: makeSide({ revision: 'B', tolerance: '±0.10 mm' }),
  generatedAt: GENERATED_AT,
});
assert.equal(tightened.summary.decision, 'reinspection_required');
assert.equal(tightened.changes.some((change) => (
  change.change_type === 'tolerance_change'
  && change.required_action === 'reinspect'
  && change.affected_entity_id === 'CHAR.HOLE_DIAMETER'
)), true);
assert.equal(tightened.reinspection_plan.items.length, 1);
assert.deepEqual(tightened.reinspection_plan.items[0].tolerance, {
  lower: -0.1,
  upper: 0.1,
  unit: 'mm',
});
assert.equal(tightened.evidence_applicability.authoritative_evidence_state_changed, false);

const loosened = buildRevisionImpactReport({
  baseline: makeSide({ revision: 'A', tolerance: '±0.10 mm' }),
  candidate: makeSide({ revision: 'B', tolerance: '±0.20 mm' }),
  generatedAt: GENERATED_AT,
});
assert.equal(loosened.summary.decision, 'review_required');
assert.equal(loosened.reinspection_plan.items.length, 0);
assert.equal(loosened.changes.find((change) => change.change_type === 'tolerance_change')?.required_action, 'human_review');

const exactInchConversion = buildRevisionImpactReport({
  baseline: makeSide({ revision: 'A', nominal: 1, unit: 'inch', tolerance: '±0.01 inch' }),
  candidate: makeSide({ revision: 'B', nominal: 25.4, unit: 'mm', tolerance: '±0.254 mm' }),
  generatedAt: GENERATED_AT,
});
assert.equal(exactInchConversion.changes.some((change) => change.change_type === 'nominal_dimension_change'), false);
assert.equal(exactInchConversion.changes.some((change) => change.change_type === 'tolerance_change'), false);

const unsupportedUnits = buildRevisionImpactReport({
  baseline: makeSide({ revision: 'A', nominal: 1, unit: 'cm', tolerance: '±0.1 cm' }),
  candidate: makeSide({ revision: 'B', nominal: 1, unit: 'cm', tolerance: '±0.1 cm' }),
  generatedAt: GENERATED_AT,
});
assert.equal(unsupportedUnits.summary.decision, 'blocked_insufficient_identity_or_inputs');
assert.equal(unsupportedUnits.summary.unable_to_determine_count > 0, true);

const sameRevisionChanged = buildRevisionImpactReport({
  baseline: makeSide({ revision: 'A', nominal: 10 }),
  candidate: makeSide({ revision: 'A', nominal: 11 }),
  generatedAt: GENERATED_AT,
});
assert.equal(sameRevisionChanged.summary.decision, 'blocked_insufficient_identity_or_inputs');
assert.equal(sameRevisionChanged.changes.some((change) => (
  change.change_type === 'unresolved_identity_change'
  && change.affected_entity_id === 'package:revision_governance'
)), true);

assert.throws(
  () => buildRevisionImpactReport({
    baseline: makeSide({ slug: 'sample-bracket' }),
    candidate: makeSide({ slug: 'different-bracket', revision: 'B' }),
    generatedAt: GENERATED_AT,
  }),
  errorCode('package_mismatch')
);

const missingIdentity = buildRevisionImpactReport({
  baseline: makeSide({ slug: null, revision: null }),
  candidate: makeSide({ slug: null, revision: null }),
  generatedAt: GENERATED_AT,
});
assert.equal(missingIdentity.baseline.package_slug, null);
assert.equal(missingIdentity.baseline.revision, null);
assert.equal(missingIdentity.summary.decision, 'blocked_insufficient_identity_or_inputs');

const productIdentityOnlyBaseline = makeSide({ revision: 'A' });
const productIdentityOnlyCandidate = makeSide({ revision: 'B' });
for (const side of [productIdentityOnlyBaseline, productIdentityOnlyCandidate]) {
  delete side.reviewPack.part_id;
  delete side.reviewPack.part.part_id;
  delete side.reviewPack.metadata.package_slug;
  side.config = {
    product: {
      package_slug: 'sample-bracket',
      part_id: 'PART-100',
      revision: side.reviewPack.revision,
    },
  };
}
const productIdentityOnly = buildRevisionImpactReport({
  baseline: productIdentityOnlyBaseline,
  candidate: productIdentityOnlyCandidate,
  generatedAt: GENERATED_AT,
});
assert.equal(productIdentityOnly.baseline.package_slug, 'sample-bracket');
assert.equal(productIdentityOnly.baseline.part_id, 'PART-100');
assert.equal(productIdentityOnly.baseline.revision, 'A');
assert.equal(productIdentityOnly.candidate.revision, 'B');

assert.throws(
  () => buildRevisionImpactReport({
    baseline: makeSide({ characteristics: [
      { id: 'DUPLICATE', value_mm: 1, required: true },
      { id: 'DUPLICATE', value_mm: 2, required: true },
    ] }),
    candidate: makeSide(),
    generatedAt: GENERATED_AT,
  }),
  errorCode('duplicate_stable_id')
);

const fixtureEnvelope = {
  synthetic: true,
  test_scope: 'fixture',
  production_trust: false,
  evidence_id: 'fixture-evidence',
  measured_characteristics: [{
    characteristic_id: 'CHAR.HOLE_DIAMETER',
    specification_ref: 'DWG-100:HOLE-DIAMETER',
  }],
};
const syntheticAssessment = buildRevisionImpactReport({
  baseline: makeSide({ evidenceEnvelope: fixtureEnvelope }),
  candidate: makeSide(),
  generatedAt: GENERATED_AT,
});
assert.equal(syntheticAssessment.evidence_applicability.assessments[0].applicability_status, 'not_applicable');
assert.equal(syntheticAssessment.evidence_applicability.assessments[0].human_decision_required, false);

await mkdir(join(ROOT, 'tmp', 'codex'), { recursive: true });
const tempRoot = await mkdtemp(join(ROOT, 'tmp', 'codex', 'revision-impact-service-'));
const externalJobRoot = await realpath(await mkdtemp(join(tmpdir(), 'revision-impact-job-store-')));
try {
  const invalidDir = join(tempRoot, 'invalid');
  await mkdir(invalidDir);
  const candidatePath = resolve(ROOT, CANONICAL_REVIEW_PACK);
  const loadWithInvalidBaseline = async (name, bytes) => {
    const path = join(invalidDir, name);
    await writeFile(path, bytes);
    return loadRevisionImpactInputSet({
      projectRoot: ROOT,
      baselineReviewPackPath: path,
      candidateReviewPackPath: candidatePath,
    });
  };

  await assert.rejects(loadWithInvalidBaseline('duplicate.json', '{"x":1,"x":2}\n'), errorCode('duplicate_json_key'));
  await assert.rejects(
    loadWithInvalidBaseline('bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}\n')])),
    errorCode('json_bom_forbidden')
  );
  await assert.rejects(
    loadWithInvalidBaseline('invalid-utf8.json', Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d])),
    (error) => error instanceof RevisionImpactServiceError && /UTF-8|encoded data/i.test(error.message)
  );
  await assert.rejects(loadWithInvalidBaseline('nonfinite.json', '{"x":1e400}\n'), errorCode('non_finite_number'));
  await assert.rejects(
    loadWithInvalidBaseline('deep.json', `${'['.repeat(66)}0${']'.repeat(66)}\n`),
    errorCode('json_depth_limit_exceeded')
  );
  await assert.rejects(
    loadWithInvalidBaseline(
      'oversize.json',
      `{"pad":"${'x'.repeat(REVISION_IMPACT_MAX_JSON_BYTES)}"}\n`
    ),
    errorCode('input_size_out_of_bounds')
  );
  await assert.rejects(loadWithInvalidBaseline('thin.json', '{}\n'), (error) => error?.name === 'ArtifactSchemaValidationError');

  const symlinkPath = join(invalidDir, 'symlink-review.json');
  await symlink(candidatePath, symlinkPath);
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: symlinkPath,
    candidateReviewPackPath: candidatePath,
  }), errorCode('symlink_forbidden'));

  const hardlinkSource = join(invalidDir, 'hardlink-source.json');
  const hardlinkAlias = join(invalidDir, 'hardlink-alias.json');
  await writeFile(hardlinkSource, await readFile(candidatePath));
  await link(hardlinkSource, hardlinkAlias);
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: hardlinkAlias,
    candidateReviewPackPath: candidatePath,
  }), errorCode('hardlink_forbidden'));

  const malformedSupport = join(invalidDir, 'malformed-support.json');
  await writeFile(malformedSupport, '{}\n');
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
    baselineReadinessPath: malformedSupport,
  }), (error) => error?.name === 'CArtifactSchemaValidationError');
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
    baselineEvidenceEnvelopePath: malformedSupport,
  }), errorCode('evidence_envelope_invalid'));
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
    baselineEvidenceReceiptPath: malformedSupport,
  }), errorCode('evidence_receipt_invalid'));

  const invalidConfig = join(invalidDir, 'invalid-config.json');
  await writeFile(invalidConfig, '{"config_version":2}\n');
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
    baselineConfigPath: invalidConfig,
  }), errorCode('config_schema_invalid'));

  const tamperedReview = JSON.parse(await readFile(candidatePath, 'utf8'));
  const boundRecord = tamperedReview.evidence_ledger.records.find((record) => record.type === 'feature_catalog');
  boundRecord.sha256 = '0'.repeat(64);
  const tamperedReviewPath = join(invalidDir, 'tampered-ledger-review.json');
  await writeFile(tamperedReviewPath, `${JSON.stringify(tamperedReview, null, 2)}\n`);
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: tamperedReviewPath,
    candidateReviewPackPath: candidatePath,
  }), errorCode('declared_artifact_hash_mismatch'));

  const invalidEvidenceGraph = {
    artifact_type: 'evidence_graph',
    schema_version: '1.0',
    package_slug: tamperedReview.package_slug,
    nodes: [{ id: 'node:incomplete', kind: 'review_pack' }],
    edges: [],
  };
  const invalidEvidenceGraphBytes = `${JSON.stringify(invalidEvidenceGraph, null, 2)}\n`;
  const invalidEvidenceGraphPath = join(invalidDir, 'invalid-evidence-graph.json');
  await writeFile(invalidEvidenceGraphPath, invalidEvidenceGraphBytes);
  const invalidEvidenceGraphRef = relative(ROOT, invalidEvidenceGraphPath).replaceAll('\\', '/');
  const graphReview = JSON.parse(await readFile(candidatePath, 'utf8'));
  graphReview.source_artifact_refs.push({
    artifact_type: 'evidence_graph',
    path: invalidEvidenceGraphRef,
    role: 'evidence',
    label: 'Invalid evidence graph contract fixture',
  });
  const ledgerTemplate = graphReview.evidence_ledger.records.find((record) => record.sha256);
  graphReview.evidence_ledger.records.push({
    ...ledgerTemplate,
    evidence_id: `package:evidence_graph:${invalidEvidenceGraphRef}`,
    type: 'evidence_graph',
    artifact_type: 'evidence_graph',
    source_ref: invalidEvidenceGraphRef,
    file_name: basename(invalidEvidenceGraphPath),
    title: 'Invalid evidence graph contract fixture',
    size_bytes: Buffer.byteLength(invalidEvidenceGraphBytes),
    sha256: createHash('sha256').update(invalidEvidenceGraphBytes).digest('hex'),
  });
  const graphReviewPath = join(invalidDir, 'invalid-evidence-graph-review.json');
  await writeFile(graphReviewPath, `${JSON.stringify(graphReview, null, 2)}\n`);
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: graphReviewPath,
    candidateReviewPackPath: candidatePath,
  }), errorCode('evidence_graph_invalid'));

  const loaded = await loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
  });
  assert.equal(loaded.baseline.artifacts.feature_catalog.document.artifact_type, 'feature_catalog');
  assert.equal(loaded.baseline.artifacts.drawing_intent.document.required_dimensions.length > 0, true);

  const externalReviewPack = join(externalJobRoot, 'selected-review-pack.json');
  await writeFile(externalReviewPack, await readFile(candidatePath));
  await assert.rejects(loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: externalReviewPack,
    candidateReviewPackPath: candidatePath,
  }), errorCode('input_path_escape'));
  const trustedExternalInput = await loadRevisionImpactInputSet({
    projectRoot: ROOT,
    baselineReviewPackPath: externalReviewPack,
    candidateReviewPackPath: candidatePath,
    trustedInputRoots: [externalJobRoot],
  });
  assert.equal(trustedExternalInput.baseline.sources.review_pack.ref.includes('..'), true);
  const externalInputReport = buildRevisionImpactReport({
    ...trustedExternalInput,
    generatedAt: GENERATED_AT,
  });
  assert.equal(externalInputReport.baseline.artifact_refs.some((ref) => ref.includes('..')), false);
  assert.equal(externalInputReport.baseline.artifact_refs.some((ref) => ref.startsWith('input/')), true);

  const created = await createRevisionImpactReportFromPaths({
    projectRoot: ROOT,
    baselineReviewPackPath: candidatePath,
    candidateReviewPackPath: candidatePath,
    generatedAt: GENERATED_AT,
  });
  assert.equal(created.report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.ok(created.baseline.reviewPack);

  const outputDir = join(tempRoot, 'artifacts');
  const jsonPath = join(outputDir, 'revision_impact_report.json');
  const markdownPath = join(outputDir, 'revision_impact_report.md');
  const firstWrite = await writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [outputDir],
  });
  assert.equal(await readFile(jsonPath, 'utf8'), canonicalizeRevisionImpactJson(unchanged));
  assert.equal(await readFile(markdownPath, 'utf8'), renderRevisionImpactMarkdown(unchanged));
  const firstJson = await readFile(jsonPath);
  const firstMarkdown = await readFile(markdownPath);
  const secondWrite = await writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [outputDir],
  });
  assert.equal(secondWrite.jsonSha256, firstWrite.jsonSha256);
  assert.equal(secondWrite.markdownSha256, firstWrite.markdownSha256);
  assert.deepEqual(await readFile(jsonPath), firstJson);
  assert.deepEqual(await readFile(markdownPath), firstMarkdown);

  const jsonOnlyPath = join(outputDir, 'json-only.json');
  const jsonOnly = await writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: jsonOnlyPath,
    markdownPath: null,
    allowedOutputRoots: [outputDir],
  });
  assert.equal(jsonOnly.markdownPath, null);

  const externalOutputPath = join(externalJobRoot, 'artifacts', 'revision_impact_report.json');
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: externalOutputPath,
  }), errorCode('output_path_escape'));
  const externalWrite = await writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: externalOutputPath,
    allowedOutputRoots: [dirname(externalOutputPath)],
    trustedOutputRoots: [externalJobRoot],
  });
  assert.equal(externalWrite.jsonPath, externalOutputPath);
  assert.equal(await readFile(externalOutputPath, 'utf8'), canonicalizeRevisionImpactJson(unchanged));

  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: 'docs/examples/quality-pass-bracket/revision_impact_report.json',
  }), errorCode('canonical_output_forbidden'));
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: `${outputDir}/../escaped.json`,
    allowedOutputRoots: [outputDir],
  }), errorCode('path_traversal_forbidden'));
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: `${outputDir}/nul\0.json`,
    allowedOutputRoots: [outputDir],
  }), errorCode('unsafe_path'));

  const outputSymlink = join(outputDir, 'symlink.json');
  await symlink(jsonOnlyPath, outputSymlink);
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: outputSymlink,
    allowedOutputRoots: [outputDir],
  }), errorCode('symlink_output_forbidden'));

  const outputHardlinkSource = join(outputDir, 'hardlink-source.json');
  const outputHardlink = join(outputDir, 'hardlink.json');
  await writeFile(outputHardlinkSource, '{}\n');
  await link(outputHardlinkSource, outputHardlink);
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: outputHardlink,
    allowedOutputRoots: [outputDir],
  }), errorCode('hardlink_output_forbidden'));

  const atomicJsonPath = join(outputDir, 'atomic.json');
  await assert.rejects(writeRevisionImpactArtifacts({
    projectRoot: ROOT,
    report: unchanged,
    jsonPath: atomicJsonPath,
    markdownPath: 'docs/examples/quality-pass-bracket/forbidden.md',
    allowedOutputRoots: [outputDir],
  }), errorCode('canonical_output_forbidden'));
  await assert.rejects(readFile(atomicJsonPath), (error) => error.code === 'ENOENT');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
  await rm(externalJobRoot, { recursive: true, force: true });
}

console.log('revision-impact service tests passed');

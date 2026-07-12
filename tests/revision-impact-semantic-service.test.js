import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRevisionImpactReport } from '../src/services/revision-impact/revision-impact-service.js';

const GENERATED_AT = '2026-07-12T00:00:00Z';
const PACKAGE_SLUG = 'semantic-impact-bracket';
const PART_ID = 'SEMANTIC-IMPACT-100';
const BASELINE_REVIEW_REF = 'tests/fixtures/revision-impact/semantic-baseline-review-pack.json';
const CANDIDATE_REVIEW_REF = 'tests/fixtures/revision-impact/semantic-candidate-review-pack.json';
const BASELINE_REVIEW_HASH = '1'.repeat(64);
const CANDIDATE_REVIEW_HASH = '2'.repeat(64);
const BASELINE_EXTRACTED_REF = 'tests/fixtures/revision-impact/semantic-baseline-extracted-drawing-semantics.json';
const CANDIDATE_EXTRACTED_REF = 'tests/fixtures/revision-impact/semantic-candidate-extracted-drawing-semantics.json';
const BASELINE_EXTRACTED_HASH = 'a'.repeat(64);
const CANDIDATE_EXTRACTED_HASH = 'b'.repeat(64);

function sourceFor(side, kind) {
  if (kind === 'review_pack') {
    return side === 'baseline'
      ? { ref: BASELINE_REVIEW_REF, sha256: BASELINE_REVIEW_HASH }
      : { ref: CANDIDATE_REVIEW_REF, sha256: CANDIDATE_REVIEW_HASH };
  }
  if (kind === 'extracted_drawing_semantics') {
    return side === 'baseline'
      ? { ref: BASELINE_EXTRACTED_REF, sha256: BASELINE_EXTRACTED_HASH }
      : { ref: CANDIDATE_EXTRACTED_REF, sha256: CANDIDATE_EXTRACTED_HASH };
  }
  const prefix = side === 'baseline' ? '3' : '4';
  return {
    ref: `tests/fixtures/revision-impact/semantic-${side}-${kind.replaceAll('_', '-')}.json`,
    sha256: prefix.repeat(64),
  };
}

function wrapArtifact(side, kind, document) {
  return { document, source: sourceFor(side, kind) };
}

function makeSide({
  side,
  revision,
  drawingIntent = null,
  featureCatalog = null,
  qualityRisk = null,
  extractedDrawingSemantics = null,
  createQuality = null,
  drawingQuality = null,
  drawingQa = null,
  dfm = null,
  evidenceGraph = null,
  inspectionRequirements = null,
  evidenceEnvelope = null,
  geometryFeatures = [],
  material = 'AL6061',
  process = 'machining',
} = {}) {
  const reviewPack = {
    artifact_type: 'review_pack',
    package_slug: PACKAGE_SLUG,
    revision,
    part_id: PART_ID,
    part: {
      part_id: PART_ID,
      revision,
      material,
      process,
      description: null,
    },
    metadata: { package_slug: PACKAGE_SLUG },
    geometry_features: { records: geometryFeatures },
  };
  if (inspectionRequirements !== null) {
    reviewPack.inspection_linkage = {
      summary: {
        count: inspectionRequirements.length,
        out_of_tolerance: 0,
        in_tolerance: 0,
        unknown: inspectionRequirements.length,
      },
      records: inspectionRequirements,
    };
  }

  const artifacts = {};
  if (drawingIntent) artifacts.drawing_intent = wrapArtifact(side, 'drawing_intent', drawingIntent);
  if (featureCatalog) artifacts.feature_catalog = wrapArtifact(side, 'feature_catalog', featureCatalog);
  if (qualityRisk) artifacts.quality_risk = wrapArtifact(side, 'quality_risk', qualityRisk);
  if (createQuality) artifacts.create_quality = wrapArtifact(side, 'create_quality', createQuality);
  if (drawingQuality) artifacts.drawing_quality = wrapArtifact(side, 'drawing_quality', drawingQuality);
  if (drawingQa) artifacts.drawing_qa = wrapArtifact(side, 'drawing_qa', drawingQa);
  if (dfm) artifacts.dfm = wrapArtifact(side, 'dfm', dfm);
  if (evidenceGraph) artifacts.evidence_graph = wrapArtifact(side, 'evidence_graph', evidenceGraph);
  if (extractedDrawingSemantics) {
    artifacts.extracted_drawing_semantics = wrapArtifact(
      side,
      'extracted_drawing_semantics',
      extractedDrawingSemantics
    );
  }

  return {
    reviewPack,
    sources: { review_pack: sourceFor(side, 'review_pack') },
    ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
    ...(evidenceEnvelope ? { evidenceEnvelope } : {}),
  };
}

function buildReport(baseline, candidate) {
  return buildRevisionImpactReport({ baseline, candidate, generatedAt: GENERATED_AT });
}

function inspectionRequirement({
  id = 'CHAR.HOLE_DIAMETER',
  featureId = 'FEATURE.HOLE_001',
  nominal = 10,
  tolerance = { lower: -0.2, upper: 0.2 },
  datum = 'A|B',
  method = 'CMM',
  specificationRef = 'DRW-100:HOLE_DIAMETER',
} = {}) {
  return {
    record_id: `REQ-${id}`,
    record_role: 'inspection_requirement',
    status: 'requirement_defined',
    characteristic_id: id,
    feature_id: featureId,
    nominal_value: nominal,
    unit: 'mm',
    tolerance,
    datum_reference: datum,
    critical: true,
    inspection_method: method,
    specification_reference: specificationRef,
    process_sensitive: true,
  };
}

function releasedDimension({
  id = 'CHAR.HOLE_DIAMETER',
  featureId = 'FEATURE.HOLE_001',
  nominal = 10,
  tolerance = '±0.20 mm',
  datum = 'A|B',
  method = 'CMM',
  specificationRef = 'DRW-100:HOLE_DIAMETER',
} = {}) {
  return {
    id,
    feature: featureId,
    label: 'Released hole diameter',
    value_mm: nominal,
    tolerance,
    datum,
    required: true,
    view: 'top',
    inspection_method: method,
    specification_ref: specificationRef,
    process_sensitive: true,
  };
}

function drawingIntent({ dimensions = [], primaryDatum = 'A' } = {}) {
  return {
    material: 'AL6061',
    manufacturing_process: 'machining',
    required_dimensions: dimensions,
    critical_features: [],
    required_notes: [],
    required_views: ['top'],
    datum_strategy: { primary: primaryDatum },
  };
}

function featureCatalog(diameter = 10) {
  return {
    artifact_type: 'feature_catalog',
    schema_version: '1.0',
    features: [{
      feature_id: 'FEATURE.HOLE_001',
      type: 'hole',
      critical: true,
      dimensions: { diameter_mm: diameter },
    }],
  };
}

function qualityRisk() {
  return {
    artifact_type: 'quality_risk',
    quality_gates: [{
      gate_id: 'GATE.DRAWING_TRACEABILITY',
      status: 'pass',
      rationale: 'All released dimensions are linked.',
    }],
  };
}

function createQuality(actualValue) {
  return {
    artifact_type: 'create_quality_report',
    schema_version: '1.0',
    status: 'pass',
    geometry: { valid_shape: true },
    engineering_quality: {
      status: 'pass',
      measurements: [{
        requirement_id: 'CREATE.WIDTH',
        source_requirement_id: 'CHAR.CREATE_WIDTH',
        feature_id: 'FEATURE.BODY',
        measurement_type: 'width',
        expected_value_mm: 100,
        actual_value_mm: actualValue,
        status: 'pass',
      }],
    },
  };
}

function drawingQuality(classification) {
  return {
    artifact_type: 'drawing_quality_report',
    schema_version: '1.0',
    status: 'pass',
    score: 100,
    views: {
      required_count: 1,
      generated_count: 1,
      missing_views: [],
      overlap_count: 0,
    },
    dimensions: {
      required_count: 1,
      mapped_count: 1,
      coverage_percent: 100,
      missing_required_intents: [],
      conflict_count: 0,
      duplicate_count: 0,
    },
    traceability: {
      coverage_percent: 100,
      unmapped_required_entities: [],
    },
    blocking_issues: [],
    requirements: [{
      requirement_id: 'CHAR.DRAWING_WIDTH',
      feature_id: 'FEATURE.BODY',
      classification,
    }],
  };
}

function drawingQa(score) {
  return {
    artifact_type: 'drawing_qa_report',
    schema_version: '1.0',
    status: 'pass',
    score,
    weight_profile: 'default',
    metrics: { overflow_count: 0, required_presence_miss: 0 },
    deductions: {},
  };
}

function dfm(actualValue) {
  return {
    artifact_type: 'dfm_report',
    schema_version: '1.0',
    score: 100,
    summary: { errors: 0, warnings: 0 },
    checks: [{
      rule_id: 'DFM.MIN_WALL',
      feature_id: 'FEATURE.WALL_001',
      status: 'pass',
      actual_value: actualValue,
      required_value: 1.5,
      actual_unit: 'mm',
      required_unit: 'mm',
    }],
  };
}

function evidenceGraph(evidenceHash) {
  return {
    artifact_type: 'evidence_graph',
    schema_version: '1.0',
    package_slug: PACKAGE_SLUG,
    summary: { node_count: 1, edge_count: 0 },
    nodes: [{
      id: 'evidence:EVIDENCE-001',
      kind: 'inspection_evidence',
      evidence_class: 'dimensional_inspection',
      sha256: evidenceHash,
    }],
    edges: [],
  };
}

function genuineBaselineEvidence() {
  return {
    synthetic: false,
    generated: false,
    test_scope: 'production',
    production_trust: true,
    evidence_id: 'EVIDENCE-HOLE-001',
    package: { slug: PACKAGE_SLUG, revision: 'A' },
    source: { document: { sha256: 'c'.repeat(64) } },
    measured_characteristics: [{
      characteristic_id: 'CHAR.HOLE_DIAMETER',
      specification_ref: 'DRW-100:HOLE_DIAMETER',
      nominal_value: 10,
      measured_value: 10.01,
      unit: 'mm',
      result: 'pass',
    }],
  };
}

function extractedDrawingSemantics({ side, value }) {
  const sourcePath = `tests/fixtures/revision-impact/${side}-drawing.svg`;
  return {
    schema_version: 1,
    artifact_type: 'extracted_drawing_semantics',
    status: 'available',
    decision: 'advisory',
    methods: ['svg_text_scan'],
    sources: [{
      artifact_type: 'svg',
      path: sourcePath,
      inspected: true,
      method: 'svg_text_scan',
    }],
    views: [],
    dimensions: [{
      id: `svg_${side}_width`,
      raw_text: String(value),
      value,
      unit: 'mm',
      matched_intent_id: 'DRAWING.WIDTH',
      matched_feature_id: 'FEATURE.BODY',
      source: sourcePath,
      confidence: 0.98,
      provenance: {
        artifact_type: 'svg',
        path: sourcePath,
        method: 'svg_dimension_text_scan',
      },
    }],
    notes: [],
    title_block: {
      part_name: null,
      material: null,
      tolerance: null,
      drawing_number: null,
    },
    coverage: {
      required_dimensions_total: 1,
      required_dimensions_extracted: 1,
      required_notes_total: 0,
      required_notes_extracted: 0,
      required_views_total: 0,
      required_views_extracted: 0,
    },
    unknowns: [],
    limitations: ['Generated extraction is advisory and is not released inspection evidence.'],
  };
}

test('uses inspection_linkage inspection requirements when drawing intent is absent', () => {
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    inspectionRequirements: [inspectionRequirement({ nominal: 10 })],
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    inspectionRequirements: [inspectionRequirement({ nominal: 11 })],
  });

  const report = buildReport(baseline, candidate);
  const change = report.changes.find((entry) => (
    entry.change_type === 'nominal_dimension_change'
    && entry.affected_entity_id === 'CHAR.HOLE_DIAMETER'
  ));

  assert.ok(change, 'inspection requirements should produce a stable characteristic change');
  assert.equal(change.before_value, 10);
  assert.equal(change.after_value, 11);
  assert.equal(change.baseline_source_ref, BASELINE_REVIEW_REF);
  assert.equal(change.candidate_source_ref, CANDIDATE_REVIEW_REF);
  assert.equal(change.required_action, 'reinspect');
  assert.equal(report.summary.decision, 'reinspection_required');
  assert.equal(
    report.reinspection_plan.items.some((item) => (
      item.affected_entity_id === 'CHAR.HOLE_DIAMETER'
      && item.specification_ref === 'DRW-100:HOLE_DIAMETER'
      && item.suggested_method === 'CMM'
    )),
    true
  );
});

test('merges identical drawing intent and inspection requirements by stable characteristic ID', () => {
  const baselineDimension = releasedDimension({ nominal: 10 });
  const candidateDimension = releasedDimension({ nominal: 11 });
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    drawingIntent: drawingIntent({ dimensions: [baselineDimension] }),
    inspectionRequirements: [inspectionRequirement({ nominal: 10 })],
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    drawingIntent: drawingIntent({ dimensions: [candidateDimension] }),
    inspectionRequirements: [inspectionRequirement({ nominal: 11 })],
  });

  const report = buildReport(baseline, candidate);
  const characteristicChanges = report.changes.filter((entry) => (
    entry.affected_entity_id === 'CHAR.HOLE_DIAMETER'
    && entry.change_type === 'nominal_dimension_change'
  ));

  assert.equal(characteristicChanges.length, 1, 'merged sources should emit one semantic change');
  assert.equal(report.summary.decision, 'reinspection_required');
  assert.equal(
    report.reinspection_plan.items.filter((item) => item.affected_entity_id === 'CHAR.HOLE_DIAMETER').length,
    1,
    'merged sources should emit one future-work item'
  );
});

test('blocks conflicting drawing intent and inspection requirements instead of choosing a source', () => {
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    drawingIntent: drawingIntent({ dimensions: [releasedDimension({ nominal: 10 })] }),
    inspectionRequirements: [inspectionRequirement({ nominal: 10 })],
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    drawingIntent: drawingIntent({ dimensions: [releasedDimension({ nominal: 11 })] }),
    inspectionRequirements: [inspectionRequirement({ nominal: 12 })],
  });

  const report = buildReport(baseline, candidate);
  const conflict = report.changes.find((entry) => (
    entry.change_type === 'unresolved_identity_change'
    && JSON.stringify([entry.before_value, entry.after_value]).includes('CHAR.HOLE_DIAMETER')
  ));

  assert.ok(conflict, 'the conflicting stable ID should remain visible in the report');
  assert.equal(conflict.determinability, 'unable_to_determine');
  assert.equal(conflict.required_action, 'resolve_identity_or_inputs');
  assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.equal(report.summary.unable_to_determine_count > 0, true);
  assert.equal(
    report.changes.some((entry) => (
      entry.affected_entity_id === 'CHAR.HOLE_DIAMETER'
      && entry.change_type === 'nominal_dimension_change'
    )),
    false,
    'a source conflict must not be reported as an authoritative nominal change'
  );
  assert.equal(
    report.evidence_applicability.assessments.some((entry) => (
      entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
      && entry.applicability_status === 'unable_to_determine'
    )),
    true
  );
  assert.equal(report.reinspection_plan.items.length, 0);
});

test('links a modified feature to baseline evidence through the requirement feature_id', () => {
  const requirement = inspectionRequirement();
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    featureCatalog: featureCatalog(10),
    inspectionRequirements: [requirement],
    evidenceEnvelope: genuineBaselineEvidence(),
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    featureCatalog: featureCatalog(11),
    inspectionRequirements: [requirement],
  });

  const report = buildReport(baseline, candidate);
  const featureChange = report.changes.find((entry) => (
    entry.change_type === 'geometry_feature_modified'
    && entry.affected_entity_id === 'FEATURE.HOLE_001'
  ));
  assert.ok(featureChange, 'the stable feature modification should be explicit');

  const assessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
  ));
  assert.ok(assessment, 'the baseline evidence characteristic should be assessed');
  assert.equal(assessment.related_change_ids.includes(featureChange.change_id), true);
  assert.equal(assessment.applicability_status, 'reinspection_required');
  assert.equal(assessment.authoritative_evidence_state_changed, false);
  assert.equal(
    report.reinspection_plan.items.some((item) => (
      item.affected_entity_id === 'CHAR.HOLE_DIAMETER'
      && item.related_change_ids.includes(featureChange.change_id)
    )),
    true,
    'feature-linked evidence should produce future reinspection work for the characteristic'
  );
});

const oneSidedSurfaces = [
  {
    name: 'feature catalog',
    option: 'featureCatalog',
    document: featureCatalog(10),
    forbiddenTypes: ['geometry_feature_added', 'geometry_feature_removed'],
  },
  {
    name: 'drawing intent',
    option: 'drawingIntent',
    document: drawingIntent({ dimensions: [releasedDimension()] }),
    forbiddenTypes: [
      'critical_characteristic_change',
      'datum_or_reference_change',
      'drawing_requirement_change',
    ],
  },
  {
    name: 'quality risk surface',
    option: 'qualityRisk',
    document: qualityRisk(),
    forbiddenTypes: ['quality_gate_change'],
  },
  {
    name: 'evidence graph surface',
    option: 'evidenceGraph',
    document: evidenceGraph('e'.repeat(64)),
    forbiddenTypes: ['evidence_reference_change'],
  },
];

for (const surface of oneSidedSurfaces) {
  for (const presentSide of ['baseline', 'candidate']) {
    test(`${surface.name} available only on ${presentSide} is indeterminate, not an engineering add/remove`, () => {
      const baseline = makeSide({
        side: 'baseline',
        revision: 'A',
        ...(presentSide === 'baseline' ? { [surface.option]: surface.document } : {}),
      });
      const candidate = makeSide({
        side: 'candidate',
        revision: 'B',
        ...(presentSide === 'candidate' ? { [surface.option]: surface.document } : {}),
      });

      const report = buildReport(baseline, candidate);
      assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
      assert.equal(report.summary.unable_to_determine_count > 0, true);
      assert.equal(
        report.changes.some((entry) => (
          entry.change_type === 'unresolved_identity_change'
          && entry.determinability === 'unable_to_determine'
        )),
        true,
        'surface availability asymmetry should be explicit and indeterminate'
      );
      assert.equal(
        report.changes.some((entry) => surface.forbiddenTypes.includes(entry.change_type)),
        false,
        'absence of the comparison surface must not be classified as an engineering entity add/remove'
      );
      assert.equal(report.reinspection_plan.items.length, 0);
    });
  }
}

test('an unlinked global datum-strategy change is indeterminate and does not create a plan item', () => {
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    drawingIntent: drawingIntent({ dimensions: [], primaryDatum: 'DATUM_A' }),
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    drawingIntent: drawingIntent({ dimensions: [], primaryDatum: 'DATUM_B' }),
  });

  const report = buildReport(baseline, candidate);
  const datumChange = report.changes.find((entry) => (
    entry.change_type === 'datum_or_reference_change'
    && entry.affected_entity_id === 'drawing:datum_strategy'
  ));

  assert.ok(datumChange, 'the global datum-strategy delta should remain explicit');
  assert.equal(datumChange.determinability, 'unable_to_determine');
  assert.equal(datumChange.severity, 'blocking');
  assert.equal(datumChange.required_action, 'resolve_identity_or_inputs');
  assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.equal(report.reinspection_plan.items.length, 0);
});

const advisorySemanticSurfaces = [
  {
    name: 'create-quality measurement',
    option: 'createQuality',
    kind: 'create_quality',
    baselineDocument: createQuality(100),
    candidateDocument: createQuality(100.1),
    changeType: 'quality_gate_change',
    entityId: 'CHAR.CREATE_WIDTH',
  },
  {
    name: 'drawing-quality requirement',
    option: 'drawingQuality',
    kind: 'drawing_quality',
    baselineDocument: drawingQuality('present'),
    candidateDocument: drawingQuality('missing'),
    changeType: 'quality_gate_change',
    entityId: 'CHAR.DRAWING_WIDTH',
  },
  {
    name: 'drawing-QA overall record',
    option: 'drawingQa',
    kind: 'drawing_qa',
    baselineDocument: drawingQa(100),
    candidateDocument: drawingQa(99),
    changeType: 'quality_gate_change',
    entityId: 'overall',
  },
  {
    name: 'DFM rule record',
    option: 'dfm',
    kind: 'dfm',
    baselineDocument: dfm(2),
    candidateDocument: dfm(1.9),
    changeType: 'quality_gate_change',
    entityId: 'FEATURE.WALL_001',
  },
  {
    name: 'evidence-graph node',
    option: 'evidenceGraph',
    kind: 'evidence_graph',
    baselineDocument: evidenceGraph('e'.repeat(64)),
    candidateDocument: evidenceGraph('f'.repeat(64)),
    changeType: 'evidence_reference_change',
    entityId: 'node:evidence:EVIDENCE-001',
  },
];

for (const surface of advisorySemanticSurfaces) {
  test(`${surface.name} change stays advisory with stable entity and artifact provenance`, () => {
    const baseline = makeSide({
      side: 'baseline',
      revision: 'A',
      [surface.option]: surface.baselineDocument,
    });
    const candidate = makeSide({
      side: 'candidate',
      revision: 'B',
      [surface.option]: surface.candidateDocument,
    });

    const report = buildReport(baseline, candidate);
    const semanticChanges = report.changes.filter((entry) => entry.change_type === surface.changeType);
    const repeatedReport = buildReport(structuredClone(baseline), structuredClone(candidate));
    const repeatedChange = repeatedReport.changes.find((entry) => entry.change_type === surface.changeType);
    const baselineSource = sourceFor('baseline', surface.kind);
    const candidateSource = sourceFor('candidate', surface.kind);

    assert.equal(semanticChanges.length, 1, 'one stable semantic record should produce one advisory change');
    const [semanticChange] = semanticChanges;
    assert.equal(semanticChange.affected_entity_id, surface.entityId);
    assert.equal(semanticChange.required_action, 'human_review');
    assert.equal(semanticChange.determinability, 'determined');
    assert.equal(semanticChange.baseline_source_ref, baselineSource.ref);
    assert.equal(semanticChange.candidate_source_ref, candidateSource.ref);
    assert.deepEqual(semanticChange.source_hashes, {
      baseline: baselineSource.sha256,
      candidate: candidateSource.sha256,
    });
    assert.equal(repeatedChange?.change_id, semanticChange.change_id, 'stable semantic input should yield a stable change ID');
    assert.equal(report.summary.decision, 'review_required');
    assert.equal(report.summary.reinspection_required_count, 0);
    assert.equal(report.reinspection_plan.items.length, 0);
  });
}

test('a stable extracted-semantics record change uses advisory drawing taxonomy and artifact provenance', () => {
  const baseline = makeSide({
    side: 'baseline',
    revision: 'A',
    extractedDrawingSemantics: extractedDrawingSemantics({ side: 'baseline', value: 100 }),
  });
  const candidate = makeSide({
    side: 'candidate',
    revision: 'B',
    extractedDrawingSemantics: extractedDrawingSemantics({ side: 'candidate', value: 101 }),
  });

  const report = buildReport(baseline, candidate);
  const semanticChange = report.changes.find((entry) => (
    entry.change_type === 'drawing_requirement_change'
    && entry.affected_entity_id === 'DRAWING.WIDTH'
  ));

  assert.ok(semanticChange, 'matched_intent_id should be the stable advisory semantic identity');
  assert.equal(semanticChange.required_action, 'human_review');
  assert.equal(semanticChange.determinability, 'determined');
  assert.equal(semanticChange.baseline_source_ref, BASELINE_EXTRACTED_REF);
  assert.equal(semanticChange.candidate_source_ref, CANDIDATE_EXTRACTED_REF);
  assert.deepEqual(semanticChange.source_hashes, {
    baseline: BASELINE_EXTRACTED_HASH,
    candidate: CANDIDATE_EXTRACTED_HASH,
  });
  assert.equal(
    report.changes.some((entry) => (
      entry.affected_entity_id === 'DRAWING.WIDTH'
      && entry.change_type === 'nominal_dimension_change'
    )),
    false,
    'generated advisory semantics must not be promoted to a released nominal change'
  );
  assert.equal(report.summary.decision, 'review_required');
  assert.equal(report.summary.reinspection_required_count, 0);
  assert.equal(report.reinspection_plan.items.length, 0);
});

test('preserves ordered engineering arrays when comparing geometry values', () => {
  const geometryFeature = (axis) => ({
    feature_id: 'FEATURE.ORDERED_AXIS',
    feature_type: 'axis_reference',
    critical: true,
    details: { axis },
  });
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', geometryFeatures: [geometryFeature([1, 2, 3])] }),
    makeSide({ side: 'candidate', revision: 'B', geometryFeatures: [geometryFeature([3, 2, 1])] })
  );

  assert.equal(
    report.changes.some((entry) => (
      entry.change_type === 'geometry_feature_modified'
      && entry.affected_entity_id === 'FEATURE.ORDERED_AXIS'
    )),
    true,
    'an ordered coordinate permutation must not be normalized away'
  );
});

test('blocks identical semantic records that lack stable identity', () => {
  const unmappedQualityRisk = {
    artifact_type: 'quality_risk',
    quality_gates: [{ status: 'pass', rationale: 'Stable ID intentionally absent.' }],
  };
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', qualityRisk: unmappedQualityRisk }),
    makeSide({ side: 'candidate', revision: 'B', qualityRisk: structuredClone(unmappedQualityRisk) })
  );

  assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.equal(
    report.changes.some((entry) => (
      entry.change_type === 'unresolved_identity_change'
      && entry.determinability === 'unable_to_determine'
      && entry.before_value?.artifact_kind === 'quality_risk'
    )),
    true
  );
});

test('uses the changed review-pack contributor for merged feature provenance', () => {
  const reviewFeature = (regionRef) => ({
    feature_id: 'FEATURE.HOLE_001',
    feature_type: 'hole',
    critical: true,
    region_ref: regionRef,
    details: null,
  });
  const report = buildReport(
    makeSide({
      side: 'baseline',
      revision: 'A',
      geometryFeatures: [reviewFeature('REGION-1')],
      featureCatalog: featureCatalog(10),
    }),
    makeSide({
      side: 'candidate',
      revision: 'B',
      geometryFeatures: [reviewFeature('REGION-2')],
      featureCatalog: featureCatalog(10),
    })
  );
  const change = report.changes.find((entry) => (
    entry.change_type === 'geometry_feature_modified'
    && entry.affected_entity_id === 'FEATURE.HOLE_001'
  ));

  assert.ok(change);
  assert.equal(change.baseline_source_ref, BASELINE_REVIEW_REF);
  assert.equal(change.candidate_source_ref, CANDIDATE_REVIEW_REF);
  assert.deepEqual(change.source_hashes, {
    baseline: BASELINE_REVIEW_HASH,
    candidate: CANDIDATE_REVIEW_HASH,
  });
});

test('keeps same-feature DFM rule changes uniquely identified', () => {
  const dfmWithRules = (actualValue) => ({
    artifact_type: 'dfm_report',
    schema_version: '1.0',
    score: 100,
    summary: { errors: 0, warnings: 0 },
    checks: ['DFM.RULE_1', 'DFM.RULE_2'].map((ruleId) => ({
      rule_id: ruleId,
      feature_id: 'FEATURE.SHARED',
      status: 'pass',
      actual_value: actualValue,
      required_value: 1.5,
      actual_unit: 'mm',
      required_unit: 'mm',
    })),
  });
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', dfm: dfmWithRules(2) }),
    makeSide({ side: 'candidate', revision: 'B', dfm: dfmWithRules(1.9) })
  );
  const changes = report.changes.filter((entry) => (
    entry.change_type === 'quality_gate_change'
    && entry.affected_entity_id === 'FEATURE.SHARED'
  ));

  assert.equal(changes.length, 2);
  assert.equal(new Set(changes.map((entry) => entry.change_id)).size, 2);
});

test('does not create a characteristic plan item after that characteristic is removed', () => {
  const requirement = inspectionRequirement();
  const report = buildReport(
    makeSide({
      side: 'baseline',
      revision: 'A',
      featureCatalog: featureCatalog(10),
      inspectionRequirements: [requirement],
      evidenceEnvelope: genuineBaselineEvidence(),
    }),
    makeSide({
      side: 'candidate',
      revision: 'B',
      featureCatalog: featureCatalog(11),
      inspectionRequirements: [],
    })
  );

  const removedAssessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
  ));
  assert.equal(
    removedAssessment?.applicability_status,
    'review_required',
    JSON.stringify({
      assessments: report.evidence_applicability.assessments,
      changes: report.changes,
    }, null, 2)
  );
  assert.equal(
    report.reinspection_plan.items.some((entry) => entry.affected_entity_id === 'CHAR.HOLE_DIAMETER'),
    false
  );
  assert.equal(
    report.reinspection_plan.items.some((entry) => entry.affected_entity_id === 'FEATURE.HOLE_001'),
    true,
    'the still-present modified candidate feature may retain future reinspection work'
  );
});

test('links process changes to every explicit process-sensitive candidate characteristic', () => {
  const requirement = inspectionRequirement();
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', inspectionRequirements: [requirement], process: 'machining' }),
    makeSide({ side: 'candidate', revision: 'B', inspectionRequirements: [requirement], process: 'casting' })
  );
  const assessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
  ));

  assert.equal(assessment?.applicability_status, 'review_required');
  assert.equal(assessment.related_change_ids.some((id) => (
    report.changes.find((change) => change.change_id === id)?.change_type === 'manufacturing_process_change'
  )), true);
});

test('emits an explicit unaffected assessment for an unrelated stable characteristic', () => {
  const changed = inspectionRequirement({ id: 'CHAR.CHANGED', featureId: 'FEATURE.CHANGED', nominal: 10 });
  const unrelated = inspectionRequirement({ id: 'CHAR.UNRELATED', featureId: 'FEATURE.UNRELATED', nominal: 20 });
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', inspectionRequirements: [changed, unrelated] }),
    makeSide({
      side: 'candidate',
      revision: 'B',
      inspectionRequirements: [inspectionRequirement({
        id: 'CHAR.CHANGED',
        featureId: 'FEATURE.CHANGED',
        nominal: 11,
      }), unrelated],
    })
  );
  const assessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.UNRELATED'
  ));

  assert.equal(assessment?.applicability_status, 'unaffected');
  assert.equal(assessment?.human_decision_required, false);
  assert.deepEqual(assessment?.related_change_ids, []);
});

test('detects stable semantic feature remapping even when observations are unchanged', () => {
  const baselineQuality = createQuality(100);
  const candidateQuality = structuredClone(baselineQuality);
  candidateQuality.engineering_quality.measurements[0].feature_id = 'FEATURE.BODY_REPLACEMENT';
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', createQuality: baselineQuality }),
    makeSide({ side: 'candidate', revision: 'B', createQuality: candidateQuality })
  );

  assert.equal(
    report.changes.some((entry) => (
      entry.change_type === 'quality_gate_change'
      && entry.affected_entity_id === 'CHAR.CREATE_WIDTH'
    )),
    true
  );
});

test('rejects duplicate stable feature IDs within one source', () => {
  const duplicateCatalog = featureCatalog(10);
  duplicateCatalog.features.push(structuredClone(duplicateCatalog.features[0]));
  assert.throws(
    () => buildReport(
      makeSide({ side: 'baseline', revision: 'A', featureCatalog: duplicateCatalog }),
      makeSide({ side: 'candidate', revision: 'B', featureCatalog: featureCatalog(10) })
    ),
    (error) => error?.code === 'duplicate_stable_id'
  );
});

test('keeps a removed merged contributor bound to that artifact on both sides', () => {
  const reviewFeature = {
    feature_id: 'FEATURE.HOLE_001',
    feature_type: 'hole',
    critical: true,
    region_ref: 'REGION-1',
    details: null,
  };
  const report = buildReport(
    makeSide({
      side: 'baseline',
      revision: 'A',
      geometryFeatures: [reviewFeature],
      featureCatalog: featureCatalog(10),
    }),
    makeSide({
      side: 'candidate',
      revision: 'B',
      geometryFeatures: [],
      featureCatalog: featureCatalog(10),
    })
  );
  const change = report.changes.find((entry) => (
    entry.change_type === 'geometry_feature_modified'
    && entry.affected_entity_id === 'FEATURE.HOLE_001'
  ));

  assert.ok(change);
  assert.equal(change.baseline_source_ref, BASELINE_REVIEW_REF);
  assert.equal(change.candidate_source_ref, CANDIDATE_REVIEW_REF);
});

test('requires review when process sensitivity is unknown during a process change', () => {
  const requirement = inspectionRequirement();
  delete requirement.process_sensitive;
  const report = buildReport(
    makeSide({ side: 'baseline', revision: 'A', inspectionRequirements: [requirement], process: 'machining' }),
    makeSide({ side: 'candidate', revision: 'B', inspectionRequirements: [requirement], process: 'casting' })
  );
  const assessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
  ));

  assert.equal(assessment?.applicability_status, 'review_required');
  assert.equal(assessment?.human_decision_required, true);
});

test('propagates a global blocking identity gap to every candidate characteristic', () => {
  const requirement = inspectionRequirement();
  const baseline = makeSide({ side: 'baseline', revision: 'A', inspectionRequirements: [requirement] });
  baseline.reviewPack.package_slug = null;
  baseline.reviewPack.metadata.package_slug = null;
  const candidate = makeSide({ side: 'candidate', revision: 'B', inspectionRequirements: [requirement] });
  const report = buildReport(baseline, candidate);
  const assessment = report.evidence_applicability.assessments.find((entry) => (
    entry.evidence_or_characteristic_id === 'CHAR.HOLE_DIAMETER'
  ));

  assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.equal(assessment?.applicability_status, 'unable_to_determine');
  assert.equal(assessment?.human_decision_required, true);
});

test('treats a one-sided fallback config feature surface as indeterminate', () => {
  const baseline = makeSide({ side: 'baseline', revision: 'A' });
  baseline.config = { shapes: [{ id: 'CONFIG.FEATURE', type: 'box', length_mm: 10 }] };
  baseline.sources.config = sourceFor('baseline', 'config');
  const candidate = makeSide({ side: 'candidate', revision: 'B' });
  const report = buildReport(baseline, candidate);

  assert.equal(report.summary.decision, 'blocked_insufficient_identity_or_inputs');
  assert.equal(
    report.changes.some((entry) => entry.change_type === 'geometry_feature_removed'),
    false
  );
  assert.equal(
    report.changes.some((entry) => (
      entry.change_type === 'unresolved_identity_change'
      && entry.determinability === 'unable_to_determine'
    )),
    true
  );
});

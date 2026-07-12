import assert from 'node:assert/strict';

import {
  collectRevisionImpactSemanticRecords,
  validateRevisionImpactSemanticArtifact,
} from '../src/services/revision-impact/revision-impact-semantic-adapters.js';

function assertValid(kind, document) {
  const validation = validateRevisionImpactSemanticArtifact(kind, document);
  assert.equal(validation.ok, true, `${kind}: ${validation.errors.join(' | ')}`);
}

function recordById(result, id) {
  return result.records.find((record) => record.id === id);
}

const semantics = {
  artifact_type: 'extracted_drawing_semantics',
  schema_version: 1,
  status: 'available',
  views: [
    {
      matched_intent_id: 'front',
      view_kind: 'orthographic',
      raw_text: 'FRONT',
      source: '/tmp/front.svg',
      provenance: { path: '/tmp/front.svg' },
    },
    {
      matched_intent_id: 'front',
      view_kind: 'orthographic',
      raw_text: 'Front duplicate extraction',
      source: '/another/front.svg',
    },
  ],
  dimensions: [
    {
      matched_intent_id: 'WIDTH',
      matched_feature_id: 'body',
      value: 40,
      unit: 'mm',
      raw_text: '40 mm',
      source: '/tmp/drawing.svg',
    },
    {
      matched_intent_id: null,
      matched_feature_id: 'unmapped-hole',
      value: 6,
      unit: 'mm',
      raw_text: '⌀6',
    },
  ],
  notes: [
    {
      matched_intent_id: 'MATERIAL',
      category: 'material',
      raw_text: 'Material: AL6061',
      source_text: 'supplier title block text',
    },
  ],
};

assertValid('extracted_drawing_semantics', semantics);
const semanticsBefore = JSON.stringify(semantics);
const semanticRecords = collectRevisionImpactSemanticRecords('extracted_drawing_semantics', semantics);
assert.equal(JSON.stringify(semantics), semanticsBefore, 'semantic collection must not mutate its input');
assert.deepEqual(
  semanticRecords.records.map((record) => record.id),
  ['dimension:WIDTH', 'note:MATERIAL', 'view:front']
);
assert.equal(recordById(semanticRecords, 'dimension:WIDTH').featureId, 'body');
assert.equal(recordById(semanticRecords, 'dimension:WIDTH').characteristicId, 'WIDTH');
assert.deepEqual(recordById(semanticRecords, 'dimension:WIDTH').value.matched_feature_ids, ['body']);
assert.equal(recordById(semanticRecords, 'dimension:WIDTH').value.matched_intent_id, 'WIDTH');
assert.equal(recordById(semanticRecords, 'view:front').value.observations.length, 1);
assert.equal(semanticRecords.unmapped.length, 1);
assert.equal(semanticRecords.unmapped[0].reason, 'missing_matched_intent_id');
assert.doesNotMatch(JSON.stringify(semanticRecords), /FRONT|supplier title block|\/tmp\/|raw_text/);

const shuffledSemantics = {
  ...structuredClone(semantics),
  views: [...semantics.views].reverse(),
  dimensions: [...semantics.dimensions].reverse(),
  notes: [...semantics.notes].reverse(),
};
assert.deepEqual(
  collectRevisionImpactSemanticRecords('extracted_drawing_semantics', shuffledSemantics),
  semanticRecords,
  'semantic array ordering must not change collected records'
);

const remappedSemantics = structuredClone(semantics);
remappedSemantics.dimensions[0].matched_feature_id = 'body-v2';
assert.notDeepEqual(
  recordById(
    collectRevisionImpactSemanticRecords('extracted_drawing_semantics', remappedSemantics),
    'dimension:WIDTH'
  ).value,
  recordById(semanticRecords, 'dimension:WIDTH').value,
  'stable extracted feature linkage must participate in record equality'
);

const createQuality = {
  schema_version: '1.0',
  status: 'pass',
  input_config: '/tmp/part.toml',
  generated_at: '2026-07-11T00:00:00Z',
  geometry: {
    valid_shape: true,
    volume: 2400,
    area: 1000,
    bbox: { min: [0, 0, 0], max: [40, 20, 3], size: [40, 20, 3] },
    solid_count: 1,
    face_count: 6,
    edge_count: 12,
  },
  step_roundtrip: {
    exported: true,
    reimport_attempted: true,
    reimport_valid: true,
    volume_delta_percent: 0,
    bbox_delta: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], max_abs_mm: 0 },
    reimported_geometry: null,
    warnings: ['step source diagnostic'],
  },
  brep_roundtrip: {
    exported: false,
    reimport_attempted: false,
    reimport_valid: null,
    volume_delta_percent: null,
    bbox_delta: null,
    reimported_geometry: null,
    warnings: [],
  },
  stl_quality: {
    exported: true,
    mesh_load_attempted: true,
    triangle_count: 120,
    watertight_or_closed: true,
    non_manifold_count: 0,
    warnings: ['mesh source diagnostic'],
  },
  engineering_quality: {
    status: 'pass',
    source: 'generated_shape_geometry',
    validation_kind: 'generated_shape_geometry_check',
    blocking_issues: [],
    warnings: ['engineering source diagnostic'],
    measurements: [
      {
        requirement_id: 'WIDTH',
        source_requirement_id: 'WIDTH',
        feature_id: 'body',
        measurement_type: 'width',
        expected_value_mm: 40,
        actual_value_mm: 40,
        status: 'pass',
        source_field: 'geometry.faces[face_index=8].width',
        matched_face_index: 8,
        generated_at: '2026-07-11T00:00:00Z',
      },
      {
        requirement_id: 'HOLE_DIA',
        source_requirement_id: 'HOLE_DIA',
        feature_id: 'hole-1',
        measurement_type: 'hole_diameter',
        expected_value_mm: 6,
        actual_value_mm: 6,
        status: 'pass',
      },
      {
        feature_id: 'unmapped-feature',
        measurement_type: 'unknown',
        actual_value_mm: 3,
      },
    ],
  },
  blocking_issues: [],
  warnings: ['top-level source diagnostic'],
};

assertValid('create_quality', createQuality);
const createRecords = collectRevisionImpactSemanticRecords('create_quality', createQuality);
assert.deepEqual(
  createRecords.records.map((record) => record.id),
  ['create_quality:overall', 'measurement:HOLE_DIA', 'measurement:WIDTH']
);
assert.equal(recordById(createRecords, 'measurement:WIDTH').featureId, 'body');
assert.equal(recordById(createRecords, 'measurement:WIDTH').characteristicId, 'WIDTH');
assert.deepEqual(recordById(createRecords, 'measurement:WIDTH').value.matched_feature_ids, ['body']);
assert.deepEqual(recordById(createRecords, 'measurement:WIDTH').value.characteristic_ids, ['WIDTH']);
assert.equal(createRecords.unmapped[0].reason, 'missing_requirement_id');
const createOverall = recordById(createRecords, 'create_quality:overall').value;
assert.equal(createOverall.status, 'pass');
assert.equal(createOverall.geometry.valid_shape, true);
assert.equal(createOverall.step_roundtrip.reimport_valid, true);
assert.equal(createOverall.stl_quality.watertight_or_closed, true);
assert.equal(createOverall.engineering_quality.status, 'pass');
assert.equal(createOverall.engineering_quality.measurement_count, 3);
assert.doesNotMatch(JSON.stringify(createOverall), /source diagnostic|\/tmp\//);

const volatileCreateQuality = structuredClone(createQuality);
volatileCreateQuality.input_config = '/different-machine/part.toml';
volatileCreateQuality.generated_at = '2030-01-01T00:00:00Z';
volatileCreateQuality.engineering_quality.measurements[0].source_field = 'other.faces[face_index=99].width';
volatileCreateQuality.engineering_quality.measurements[0].matched_face_index = 99;
volatileCreateQuality.engineering_quality.measurements[0].generated_at = '2030-01-01T00:00:00Z';
volatileCreateQuality.warnings = ['different private top-level detail'];
volatileCreateQuality.step_roundtrip.warnings = ['different private STEP detail'];
volatileCreateQuality.stl_quality.warnings = ['different private mesh detail'];
volatileCreateQuality.engineering_quality.warnings = ['different private engineering detail'];
assert.deepEqual(
  collectRevisionImpactSemanticRecords('create_quality', volatileCreateQuality),
  createRecords,
  'timestamps, paths, and face indices must not create semantic changes'
);

const createResultMutations = [
  ['top-level status', (document) => { document.status = 'fail'; }],
  ['geometry validity', (document) => { document.geometry.valid_shape = false; }],
  ['STEP round-trip validity', (document) => { document.step_roundtrip.reimport_valid = false; }],
  ['BREP round-trip export', (document) => { document.brep_roundtrip.exported = true; }],
  ['STL watertight state', (document) => { document.stl_quality.watertight_or_closed = false; }],
  ['engineering-quality status', (document) => { document.engineering_quality.status = 'fail'; }],
];
for (const [label, mutate] of createResultMutations) {
  const changed = structuredClone(createQuality);
  mutate(changed);
  assert.notDeepEqual(
    recordById(
      collectRevisionImpactSemanticRecords('create_quality', changed),
      'create_quality:overall'
    ).value,
    createOverall,
    `${label} must participate in create-quality overall record equality`
  );
}

const remappedCreateQuality = structuredClone(createQuality);
remappedCreateQuality.engineering_quality.measurements[0].feature_id = 'body-v2';
const remappedCreateWidth = recordById(
  collectRevisionImpactSemanticRecords('create_quality', remappedCreateQuality),
  'measurement:WIDTH'
);
assert.notDeepEqual(
  remappedCreateWidth.value,
  recordById(createRecords, 'measurement:WIDTH').value,
  'stable create-quality feature linkage must participate in record equality'
);

const relinkedCreateQuality = structuredClone(createQuality);
relinkedCreateQuality.engineering_quality.measurements[0].source_requirement_id = 'WIDTH-V2';
assert.notDeepEqual(
  recordById(
    collectRevisionImpactSemanticRecords('create_quality', relinkedCreateQuality),
    'measurement:WIDTH'
  ).value,
  recordById(createRecords, 'measurement:WIDTH').value,
  'stable create-quality characteristic linkage must participate in record equality'
);

const duplicateCreateQuality = structuredClone(createQuality);
duplicateCreateQuality.engineering_quality.measurements.push({
  requirement_id: 'WIDTH',
  feature_id: 'body',
  actual_value_mm: 41,
});
const duplicateCreateValidation = validateRevisionImpactSemanticArtifact(
  'create_quality',
  duplicateCreateQuality
);
assert.equal(duplicateCreateValidation.ok, true);
const aggregatedCreateRecords = collectRevisionImpactSemanticRecords(
  'create_quality',
  duplicateCreateQuality
);
const aggregatedWidth = aggregatedCreateRecords.records.find((record) => record.id === 'measurement:WIDTH');
assert.equal(aggregatedWidth.value.observations.length, 2);
assert.equal(
  aggregatedCreateRecords.records.filter((record) => record.id === 'measurement:WIDTH').length,
  1,
  'repeated physical observations for one requirement must aggregate deterministically'
);

const drawingQuality = {
  schema_version: '1.0',
  status: 'fail',
  score: 82,
  input_config: '/tmp/part.toml',
  drawing_svg: '/tmp/drawing.svg',
  views: {
    required_count: 2,
    generated_count: 1,
    missing_views: ['section'],
    overlap_count: 0,
  },
  dimensions: {
    required_count: 2,
    mapped_count: 1,
    coverage_percent: 50,
    missing_required_intents: ['DEPTH'],
    conflict_count: 0,
    duplicate_count: 0,
  },
  traceability: {
    coverage_percent: 50,
    unmapped_required_entities: ['DEPTH'],
  },
  blocking_issues: [
    { code: 'missing-view', severity: 'high', raw_text: 'source text', path: '/tmp/a' },
    { code: 'missing-dimension', severity: 'high' },
  ],
  requirements: [
    { requirement_id: 'DEPTH', classification: 'missing', feature_id: 'body' },
    { requirement_id: 'WIDTH', classification: 'extracted', feature_id: 'body' },
    { classification: 'unknown', matched_raw_text: 'unkeyed text' },
  ],
  semantic_quality: {
    decision: 'fail',
    enforceable: true,
    required_dimensions_total: 2,
    required_dimensions_present: 1,
    missing_required_dimensions: ['DEPTH'],
    traceability: {
      rows: [
        { dimension_id: 'WIDTH', feature_id: 'body', status: 'linked' },
      ],
    },
    extracted_evidence: {
      required_dimensions: [
        {
          requirement_id: 'WIDTH',
          matched_feature_id: 'body',
          classification: 'extracted',
          matched_raw_text: '40',
          provenance: { path: '/tmp/drawing.svg' },
        },
      ],
    },
  },
};

assertValid('drawing_quality', drawingQuality);
const drawingRecords = collectRevisionImpactSemanticRecords('drawing_quality', drawingQuality);
assert.deepEqual(drawingRecords.records.map((record) => record.id), [
  'issue:missing-dimension',
  'issue:missing-view',
  'overall',
  'requirement:DEPTH',
  'requirement:WIDTH',
]);
assert.equal(recordById(drawingRecords, 'requirement:WIDTH').featureId, 'body');
assert.equal(recordById(drawingRecords, 'requirement:WIDTH').characteristicId, 'WIDTH');
assert.equal(drawingRecords.unmapped.some((entry) => entry.reason === 'missing_requirement_id'), true);
assert.doesNotMatch(JSON.stringify(drawingRecords), /source text|unkeyed text|\/tmp\/drawing\.svg/);

const duplicateDrawingIssues = structuredClone(drawingQuality);
duplicateDrawingIssues.blocking_issues.push({ code: 'missing-view', severity: 'low' });
const duplicateDrawingValidation = validateRevisionImpactSemanticArtifact(
  'drawing_quality',
  duplicateDrawingIssues
);
assert.equal(duplicateDrawingValidation.ok, false);
assert.match(duplicateDrawingValidation.errors.join('\n'), /duplicate stable ID "missing-view"/);

const drawingQa = {
  score: 94,
  status: 'pass',
  timestamp: '2026-07-11T00:00:00Z',
  file: '/tmp/drawing.svg',
  weight_profile: 'ks',
  metrics: {
    overflow_count: 0,
    required_presence_miss: 0,
  },
  deductions: {},
  details: {
    text_overlaps: [{ raw_text: 'SIZE / SHEET', face_index: 4 }],
  },
};
assertValid('drawing_qa', drawingQa);
const qaRecords = collectRevisionImpactSemanticRecords('drawing_qa', drawingQa);
assert.deepEqual(qaRecords.records.map((record) => record.id), ['overall']);
const volatileQa = {
  ...structuredClone(drawingQa),
  timestamp: '2030-01-01T00:00:00Z',
  file: '/another/drawing.svg',
  details: { raw_text: 'different raw source text', face_index: 99 },
};
assert.deepEqual(
  collectRevisionImpactSemanticRecords('drawing_qa', volatileQa),
  qaRecords,
  'QA collection must ignore volatile metadata and raw source details'
);

const dfm = {
  artifact_type: 'dfm_report',
  schema_version: '1.0',
  status: 'fail',
  success: true,
  score: 70,
  summary: {
    status: 'fail',
    errors: 1,
    warnings: 1,
    info: 0,
    total: 3,
    severity_counts: { critical: 1, major: 1, minor: 0, info: 0 },
    score_impact: { error_penalty: 15, warning_penalty: 5, total_penalty: 20 },
    top_fixes: [{ suggested_fix: 'private raw recommendation' }],
  },
  checks: [
    {
      rule_id: 'DFM-10',
      status: 'warning',
      actual_value: 'unknown',
      required_value: 'supported_process_profile',
    },
    {
      rule_id: 'DFM-01',
      feature_id: 'wall-1',
      status: 'fail',
      actual_value: 0.5,
      required_value: 1.5,
      actual_unit: 'mm',
      required_unit: 'mm',
    },
    { code: 'DFM-UNKNOWN', status: 'warning', source_text: 'raw checker output' },
  ],
  issues: [
    {
      rule_id: 'DFM-01',
      feature_id: 'wall-1',
      severity: 'critical',
      status: 'fail',
      suggested_fix: 'Increase wall thickness.',
    },
  ],
};
assertValid('dfm', dfm);
const dfmRecords = collectRevisionImpactSemanticRecords('dfm', dfm);
assert.deepEqual(dfmRecords.records.map((record) => record.id), [
  'dfm:overall',
  'rule:DFM-01:feature:wall-1',
  'rule:DFM-10:feature:global',
]);
assert.equal(recordById(dfmRecords, 'rule:DFM-01:feature:wall-1').featureId, 'wall-1');
assert.equal(recordById(dfmRecords, 'rule:DFM-01:feature:wall-1').value.observations.length, 2);
assert.equal(dfmRecords.unmapped[0].reason, 'missing_rule_id');
const dfmOverall = recordById(dfmRecords, 'dfm:overall').value;
assert.equal(dfmOverall.status, 'fail');
assert.equal(dfmOverall.success, true);
assert.equal(dfmOverall.score, 70);
assert.equal(dfmOverall.summary.errors, 1);
assert.equal(dfmOverall.summary.severity_counts.critical, 1);
assert.equal(dfmOverall.summary.score_impact.total_penalty, 20);
assert.equal(dfmOverall.summary.top_fix_count, 1);
assert.doesNotMatch(JSON.stringify(dfmOverall), /private raw recommendation/);

const dfmOverallMutations = [
  ['status', (document) => { document.status = 'pass'; }],
  ['score', (document) => { document.score = 95; }],
  ['summary', (document) => {
    document.summary.errors = 0;
    document.summary.score_impact.total_penalty = 5;
  }],
];
for (const [label, mutate] of dfmOverallMutations) {
  const changed = structuredClone(dfm);
  mutate(changed);
  assert.notDeepEqual(
    recordById(collectRevisionImpactSemanticRecords('dfm', changed), 'dfm:overall').value,
    dfmOverall,
    `DFM ${label} changes must participate in overall record equality`
  );
}

const qualityRisk = {
  artifact_type: 'quality_risk',
  schema_version: '1.0',
  generated_at: '2026-07-11T00:00:00Z',
  summary: { overall_risk_level: 'high' },
  quality_gates: [
    { gate_id: 'G-2', status: 'open', linked_categories: ['b', 'a'] },
    { gate_id: 'G-1', status: 'pass' },
  ],
  quality_risks: [
    { risk_id: 'R-1', category: 'wall', severity: 'high', source: 'review_pack' },
  ],
  critical_dimensions: [
    { id: 'C-1', name: 'width', status: 'out_of_tolerance', deviation: 0.1 },
  ],
  inspection_required_points: [
    { inspection_id: 'I-1', checkpoint: 'width', status: 'open' },
    { checkpoint: 'unkeyed legacy checkpoint', status: 'open' },
  ],
};
assertValid('quality_risk', qualityRisk);
const riskRecords = collectRevisionImpactSemanticRecords('quality_risk', qualityRisk);
assert.deepEqual(riskRecords.records.map((record) => record.id), [
  'critical:C-1',
  'gate:G-1',
  'gate:G-2',
  'inspection:I-1',
  'risk:R-1',
]);
assert.equal(recordById(riskRecords, 'critical:C-1').characteristicId, 'C-1');
assert.equal(riskRecords.unmapped[0].reason, 'missing_stable_id');

const duplicateQualityRisk = structuredClone(qualityRisk);
duplicateQualityRisk.quality_gates.push({ gate_id: 'G-1', status: 'open' });
const duplicateRiskValidation = validateRevisionImpactSemanticArtifact('quality_risk', duplicateQualityRisk);
assert.equal(duplicateRiskValidation.ok, false);
assert.match(duplicateRiskValidation.errors.join('\n'), /duplicate stable ID "G-1"/);

const evidenceGraph = {
  artifact_type: 'evidence_graph',
  schema_version: '1.0',
  package_slug: 'sample',
  generated_at: '2026-07-11T00:00:00Z',
  summary: { node_count: 4, edge_count: 3 },
  nodes: [
    { id: 'record:b', kind: 'review_artifact', path: '/tmp/b.json', label: 'B' },
    { id: 'package:sample', kind: 'package', package_id: 'sample' },
    { id: 'source:0:create_quality_report', kind: 'generated_artifact', path: '/tmp/a.json' },
    { kind: 'review_artifact', path: '/tmp/unkeyed.json' },
  ],
  edges: [
    {
      from: 'package:sample',
      to: 'record:b',
      kind: 'has_record',
    },
    {
      id: 'record:b->package:sample',
      source: 'record:b',
      target: 'package:sample',
      relationship: 'belongs_to',
    },
    {
      from: 'package:sample',
      to: 'source:0:create_quality_report',
      kind: 'has_source',
    },
  ],
};
assertValid('evidence_graph', evidenceGraph);
const graphRecords = collectRevisionImpactSemanticRecords('evidence_graph', evidenceGraph);
assert.deepEqual(graphRecords.records.map((record) => record.id), [
  'edge:package:sample->record:b:has_record',
  'edge:record:b->package:sample',
  'node:package:sample',
  'node:record:b',
]);
assert.equal(
  graphRecords.unmapped.filter((entry) => entry.reason === 'unstable_positional_identity').length,
  2,
  'numeric source node and its edge must remain unmapped'
);
assert.equal(graphRecords.unmapped.some((entry) => entry.reason === 'missing_node_id'), true);
assert.doesNotMatch(JSON.stringify(graphRecords), /\/tmp\//);

const shuffledGraph = {
  ...structuredClone(evidenceGraph),
  nodes: [...evidenceGraph.nodes].reverse(),
  edges: [...evidenceGraph.edges].reverse(),
};
assert.deepEqual(
  collectRevisionImpactSemanticRecords('evidence_graph', shuffledGraph),
  graphRecords,
  'graph collection must be independent of node and edge array order'
);

const duplicateGraph = structuredClone(evidenceGraph);
duplicateGraph.nodes.push({ id: 'record:b', kind: 'review_artifact' });
const duplicateGraphValidation = validateRevisionImpactSemanticArtifact('evidence_graph', duplicateGraph);
assert.equal(duplicateGraphValidation.ok, false);
assert.match(duplicateGraphValidation.errors.join('\n'), /duplicate stable ID "record:b"/);

for (const [kind, thin] of [
  ['create_quality', { artifact_type: 'create_quality_report', schema_version: '1.0' }],
  ['drawing_quality', { artifact_type: 'drawing_quality_report', schema_version: '1.0' }],
  ['drawing_qa', { artifact_type: 'drawing_qa_report', schema_version: '1.0' }],
  ['dfm', { artifact_type: 'dfm_report', schema_version: '1.0' }],
  ['quality_risk', { artifact_type: 'quality_risk', schema_version: '1.0' }],
  ['evidence_graph', { artifact_type: 'evidence_graph', schema_version: '1.0' }],
]) {
  const validation = validateRevisionImpactSemanticArtifact(kind, thin);
  assert.equal(validation.ok, false, `${kind} thin object must fail`);
  assert.equal(validation.errors.length > 0, true);
}

assert.deepEqual(
  validateRevisionImpactSemanticArtifact('unknown', {}),
  { ok: false, errors: ['unsupported semantic artifact kind: unknown'] }
);

console.log('revision-impact-semantic-adapters.test.js: ok');

import { readFileSync } from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';

const EVIDENCE_GRAPH_SCHEMA_VERSION = '1.0';
const EVIDENCE_GRAPH_SCHEMA = JSON.parse(
  readFileSync(new URL('../../../schemas/evidence-graph.schema.json', import.meta.url), 'utf8')
);
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateEvidenceGraphSchema = ajv.compile(EVIDENCE_GRAPH_SCHEMA);

const GENERATED_ARTIFACT_TYPES = new Set([
  'artifact_manifest',
  'create_quality_report',
  'dfm_report',
  'docs_manifest',
  'drawing_intent',
  'drawing_qa_report',
  'drawing_quality_report',
  'feature_catalog',
  'output_manifest',
  'readiness_report',
  'release_bundle',
  'release_bundle_manifest',
  'standard_docs_manifest',
]);

const REVIEW_ARTIFACT_TYPES = new Set([
  'design_review',
  'review_context',
  'review_pack',
  'review_priorities',
]);

const CONTROL_ARTIFACT_TYPES = new Set([
  'inspection_evidence_intake_report',
  'inspection_evidence_promotion_dry_run_manifest',
  'stage5b_audit_manifest',
  'stage5b_evidence_attachment_control_manifest',
  'stage5b_evidence_pipeline_doctor_manifest',
  'stage5b_evidence_review_dry_run_manifest',
  'surrogate_inspection_validation',
]);

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeIdentity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeToken(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function normalizeOptionalPath(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function recordType(record = {}) {
  return firstString(record.type, record.artifact_type, record.evidence_type, record.kind);
}

function recordPath(record = {}) {
  return firstString(record.path, record.source_ref, record.file, record.href);
}

function recordId(record = {}, index = 0) {
  return firstString(record.id, record.record_id, record.name, recordPath(record))
    || `record-${index + 1}`;
}

function isInspectionEvidenceRecord(record = {}) {
  return record.inspection_evidence === true && record.type === 'inspection_evidence';
}

function isGeneratedArtifactRecord(record = {}) {
  if (isInspectionEvidenceRecord(record)) return false;
  const type = recordType(record);
  return record.generated_artifact === true || GENERATED_ARTIFACT_TYPES.has(type);
}

function classifyRecord(record = {}) {
  if (isInspectionEvidenceRecord(record)) return 'inspection_evidence';
  const type = recordType(record);
  if (CONTROL_ARTIFACT_TYPES.has(type)) return 'control_artifact';
  if (REVIEW_ARTIFACT_TYPES.has(type)) return 'review_artifact';
  if (isGeneratedArtifactRecord(record)) return 'generated_artifact';
  return 'review_artifact';
}

function readinessSummary(readinessReport = {}) {
  const report = safeObject(readinessReport);
  const nestedReadiness = safeObject(report.readiness_summary);
  const nestedSummary = safeObject(report.summary);
  return {
    status: firstString(
      report.status,
      nestedReadiness.status,
      nestedSummary.readiness_status,
      nestedSummary.status
    ),
    gate_decision: firstString(
      report.gate_decision,
      nestedReadiness.gate_decision,
      nestedSummary.readiness_gate_decision,
      nestedSummary.gate_decision
    ),
  };
}

function partIdentity({ packageId, reviewPack = {}, readinessReport = {} } = {}) {
  const reviewPart = safeObject(safeObject(reviewPack).part);
  const readinessPart = safeObject(safeObject(readinessReport).part);
  return {
    part_id: firstString(reviewPart.part_id, readinessPart.part_id, safeObject(reviewPack).part_id, safeObject(readinessReport).part_id, packageId),
    name: firstString(reviewPart.name, readinessPart.name, safeObject(reviewPack).name, safeObject(readinessReport).name, packageId),
    revision: firstString(reviewPart.revision, readinessPart.revision, safeObject(reviewPack).revision, safeObject(readinessReport).revision),
  };
}

function evidenceLedgerRecords(reviewPack = {}) {
  return safeArray(safeObject(safeObject(reviewPack).evidence_ledger).records);
}

function sourceArtifactRefs(document = {}) {
  return safeArray(safeObject(document).source_artifact_refs);
}

function topLevelArtifactType(document = {}) {
  const source = safeObject(document);
  return firstString(source.artifact_type, source.type);
}

function extractPackageIdentities(document = {}) {
  const source = safeObject(document);
  const readinessSummarySource = safeObject(source.readiness_summary);
  const summarySource = safeObject(source.summary);
  const partSource = safeObject(source.part);
  const readinessSummaryPartSource = safeObject(readinessSummarySource.part);
  const summaryPartSource = safeObject(summarySource.part);
  return uniqueStrings([
    source.package_id,
    source.package_slug,
    source.package,
    source.slug,
    source.part_id,
    source.part_name,
    readinessSummarySource.package_id,
    readinessSummarySource.package_slug,
    readinessSummarySource.package,
    readinessSummarySource.slug,
    readinessSummarySource.part_id,
    readinessSummarySource.part_name,
    summarySource.package_id,
    summarySource.package_slug,
    summarySource.package,
    summarySource.slug,
    summarySource.part_id,
    summarySource.part_name,
    partSource.package_id,
    partSource.package_slug,
    partSource.package,
    partSource.slug,
    partSource.part_id,
    partSource.name,
    readinessSummaryPartSource.package_id,
    readinessSummaryPartSource.package_slug,
    readinessSummaryPartSource.package,
    readinessSummaryPartSource.slug,
    readinessSummaryPartSource.part_id,
    readinessSummaryPartSource.name,
    summaryPartSource.package_id,
    summaryPartSource.package_slug,
    summaryPartSource.package,
    summaryPartSource.slug,
    summaryPartSource.part_id,
    summaryPartSource.name,
  ]);
}

function hasDocumentSignal(source = {}, signal) {
  const value = source[signal];
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
}

function hasReviewPackSignal(source = {}) {
  const document = safeObject(source);
  const part = safeObject(document.part);
  const hasPartIdentity = Boolean(firstString(part.part_id, part.name, document.part_id, document.package_id));
  return evidenceLedgerRecords(document).length > 0
    && sourceArtifactRefs(document).length > 0
    && hasPartIdentity;
}

function hasReadinessReportSignal(source = {}) {
  const document = safeObject(source);
  const nestedReadiness = safeObject(document.readiness_summary);
  const part = safeObject(document.part);
  const hasReadinessDecision = Boolean(
    firstString(nestedReadiness.status)
    && Number.isFinite(nestedReadiness.score)
    && firstString(nestedReadiness.gate_decision)
  );
  const hasPartIdentity = Boolean(firstString(part.part_id, part.name, document.part_id, document.package_id));
  return hasReadinessDecision
    && sourceArtifactRefs(document).length > 0
    && hasPartIdentity;
}

function assertInputKind({
  label,
  document,
  expectedType,
  expectedDescription = expectedType,
  rejectSignals = [],
  hasExpectedSignal = null,
}) {
  const source = safeObject(document);
  const explicitType = topLevelArtifactType(source);
  if (!explicitType) {
    throw new Error(`${label} input is not a ${expectedDescription}: artifact_type/type is required`);
  }
  if (explicitType !== expectedType) {
    throw new Error(`${label} input is not a ${expectedDescription}: artifact_type/type is ${explicitType}`);
  }
  if (rejectSignals.some((signal) => hasDocumentSignal(source, signal))) {
    throw new Error(`${label} input is not a ${expectedDescription}: document has incompatible readiness/review signals`);
  }
  if (typeof hasExpectedSignal === 'function' && hasExpectedSignal(source)) return;
  throw new Error(`${label} input is not a ${expectedDescription}: document does not contain required ${expectedDescription} signals`);
}

function assertIdentitiesMatch(label, requestedPackageId, identities = []) {
  const requested = normalizeIdentity(requestedPackageId);
  if (!requested) return;
  for (const identity of identities) {
    if (normalizeIdentity(identity) !== requested) {
      throw new Error(`${label} package identity ${identity} does not match requested package ${requestedPackageId}`);
    }
  }
}

export function assertEvidenceGraphInputIdentity({ packageId, reviewPack = {}, readinessReport = {} } = {}) {
  const requestedPackageId = firstString(packageId);
  if (!requestedPackageId) {
    throw new Error('evidence graph requires --package <slug>');
  }

  assertInputKind({
    label: 'review-pack',
    document: reviewPack,
    expectedType: 'review_pack',
    rejectSignals: ['readiness_summary', 'gate_decision', 'missing_inputs'],
    hasExpectedSignal: hasReviewPackSignal,
  });
  assertInputKind({
    label: 'readiness',
    document: readinessReport,
    expectedType: 'readiness_report',
    expectedDescription: 'readiness report',
    rejectSignals: ['evidence_ledger'],
    hasExpectedSignal: hasReadinessReportSignal,
  });

  const reviewIdentities = extractPackageIdentities(reviewPack);
  const readinessIdentities = extractPackageIdentities(readinessReport);
  assertIdentitiesMatch('review-pack', requestedPackageId, reviewIdentities);
  assertIdentitiesMatch('readiness report', requestedPackageId, readinessIdentities);
  return {
    package_id: requestedPackageId,
    review_pack_identities: reviewIdentities,
    readiness_report_identities: readinessIdentities,
  };
}

export function validateEvidenceGraph(graph) {
  const valid = validateEvidenceGraphSchema(graph);
  return {
    ok: valid === true,
    errors: valid ? [] : formatSchemaErrors(validateEvidenceGraphSchema.errors || []),
  };
}

export function assertValidEvidenceGraph(graph) {
  const validation = validateEvidenceGraph(graph);
  if (!validation.ok) {
    throw new Error(`Invalid evidence graph: ${validation.errors.join(' | ')}`);
  }
  return graph;
}

export function buildEvidenceGraph({
  packageId,
  reviewPack = {},
  readinessReport = {},
  reviewPackPath = null,
  readinessReportPath = null,
} = {}) {
  assertEvidenceGraphInputIdentity({ packageId, reviewPack, readinessReport });

  const resolvedPackageId = firstString(
    packageId,
    safeObject(reviewPack).package_id,
    safeObject(readinessReport).package_id,
    safeObject(safeObject(readinessReport).part).package_id,
    safeObject(safeObject(reviewPack).part).package_id
  ) || 'unknown-package';

  const packageNodeId = `package:${normalizeToken(resolvedPackageId, 'unknown-package')}`;
  const records = evidenceLedgerRecords(reviewPack);
  const part = partIdentity({ packageId: resolvedPackageId, reviewPack, readinessReport });
  const sourceArtifactRefs = [
    {
      artifact_type: 'review_pack',
      path: normalizeOptionalPath(reviewPackPath),
      role: 'graph_review_source',
      label: 'Review pack JSON',
    },
    {
      artifact_type: 'readiness_report',
      path: normalizeOptionalPath(readinessReportPath),
      role: 'graph_readiness_source',
      label: 'Readiness report JSON',
    },
  ];
  const nodes = [
    {
      id: packageNodeId,
      kind: 'package',
      label: resolvedPackageId,
      package_id: resolvedPackageId,
    },
  ];
  const edges = [];

  records.forEach((record, index) => {
    const id = recordId(record, index);
    const type = recordType(record);
    const artifactType = firstString(record.artifact_type, record.evidence_type);
    const nodeId = `evidence-record:${normalizeToken(id, `record-${index + 1}`)}`;
    const kind = classifyRecord(record);

    nodes.push({
      id: nodeId,
      kind,
      label: id,
      record_id: id,
      type,
      artifact_type: artifactType,
      path: recordPath(record),
      inspection_evidence: kind === 'inspection_evidence',
      generated_artifact: kind === 'generated_artifact',
    });
    edges.push({
      id: `${packageNodeId}->${nodeId}`,
      source: packageNodeId,
      target: nodeId,
      relationship: 'has_evidence_record',
    });
  });

  const readiness = readinessSummary(readinessReport);
  const inspectionEvidenceRecordCount = records.filter((record) => isInspectionEvidenceRecord(record)).length;
  const generatedArtifactCount = records.filter((record) => isGeneratedArtifactRecord(record)).length;

  return {
    schema_version: EVIDENCE_GRAPH_SCHEMA_VERSION,
    artifact_type: 'evidence_graph',
    package_id: resolvedPackageId,
    part,
    source_artifact_refs: sourceArtifactRefs,
    coverage: {
      review_record_count: records.length,
      source_artifact_count: sourceArtifactRefs.length,
    },
    confidence: {
      level: 'heuristic',
      score: 0.82,
      rationale: 'Evidence graph links existing review-pack ledger records and readiness summary fields without mutating source artifacts.',
    },
    warnings: [],
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      inspection_evidence_record_count: inspectionEvidenceRecordCount,
      generated_artifact_count: generatedArtifactCount,
      readiness_gate_decision: readiness.gate_decision,
      readiness_status: readiness.status,
    },
    nodes,
    edges,
  };
}

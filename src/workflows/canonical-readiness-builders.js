import { writeFile } from 'node:fs/promises';

import {
  C_ARTIFACT_SCHEMA_VERSION,
  assertValidCArtifact,
  getCCommandContract,
} from '../../lib/c-artifact-schema.js';
import { writeValidatedCArtifact } from '../../lib/context-loader.js';
import { assertValidDArtifact, buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';

function nowIso(explicitValue = null) {
  if (typeof explicitValue === 'string' && explicitValue.trim()) return explicitValue.trim();
  return new Date().toISOString();
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function mergeSourceArtifactRefs(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();

  for (const ref of [...primary, ...secondary]) {
    if (!ref?.artifact_type || !ref?.role) continue;
    const key = `${ref.artifact_type}|${ref.path || ''}|${ref.role}|${ref.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      artifact_type: ref.artifact_type,
      path: ref.path || null,
      role: ref.role,
      label: ref.label || null,
    });
  }

  return merged;
}

function buildCanonicalArtifactDescriptor(kind, contract) {
  return {
    json_is_source_of_truth: true,
    artifact_type: kind,
    artifact_filename: contract?.primary_output || `${kind}.json`,
    derived_outputs: contract?.derived_outputs || [],
    rationale: kind === 'readiness_report'
      ? 'readiness_report.json is the canonical C artifact; downstream markdown and release packaging derive from it.'
      : 'This JSON artifact is the canonical machine-readable source for the downstream C output.',
  };
}

function rankToSeverity(priorityRank) {
  if (priorityRank === 1) return 'high';
  if (priorityRank === 2 || priorityRank === 3) return 'medium';
  return 'low';
}

function riskLevelFromSignals({ missingInputs = [], warnings = [], priorities = [] } = {}) {
  if (missingInputs.length > 0 || warnings.length >= 3) return 'high';
  if (priorities.length >= 4 || warnings.length >= 1) return 'medium';
  return 'low';
}

function buildPropagatedConfidence(sourceConfidence, {
  propagatedFrom,
  propagationNotes = [],
  sourceConfidenceRefs = [],
} = {}) {
  const upstream = safeObject(sourceConfidence);
  return {
    level: upstream.level || 'heuristic',
    score: Number.isFinite(upstream.score) ? upstream.score : 0.5,
    rationale: upstream.rationale || 'Confidence propagated from source artifact.',
    propagated_from: propagatedFrom || null,
    propagation_notes: propagationNotes.filter(Boolean),
    source_confidence_refs: sourceConfidenceRefs,
  };
}

function collectDataQualityMessages(reviewPack) {
  const notes = safeList(reviewPack.data_quality_notes);
  return notes
    .map((note) => note?.message)
    .filter((message) => typeof message === 'string' && message.trim());
}

function collectMissingInputs(reviewPack) {
  return uniqueStrings(safeList(reviewPack.uncertainty_coverage_report?.missing_inputs));
}

function getReviewPackExecutiveSummary(reviewPack) {
  const explicit = safeObject(reviewPack.executive_summary);
  if (Object.keys(explicit).length > 0) return explicit;

  const priorities = safeList(reviewPack.review_priorities);
  const topCategories = priorities.slice(0, 3).map((priority) => priority.category).filter(Boolean);
  return {
    headline: `${reviewPack.part?.name || 'unknown_part'} revision ${reviewPack.part?.revision || reviewPack.revision || 'n/a'} packages ${priorities.length} prioritized review topics.`,
    part_revision: reviewPack.part?.revision || reviewPack.revision || null,
    top_risk_categories: topCategories,
    priority_count: priorities.length,
    geometry_hotspot_count: safeList(reviewPack.geometry_hotspots).length,
    inspection_anomaly_count: safeList(reviewPack.inspection_anomalies).length,
    quality_signal_count: safeList(reviewPack.quality_linkage?.records).length,
    recommended_action_count: safeList(reviewPack.recommended_actions).length,
    confidence: {
      label: reviewPack.confidence?.level || 'heuristic',
      numeric_score: reviewPack.confidence?.score ?? null,
    },
  };
}

function getReviewPackPrioritizedHotspots(reviewPack) {
  const explicit = safeList(reviewPack.prioritized_hotspots);
  if (explicit.length > 0) return explicit;
  return safeList(reviewPack.review_priorities).map((priority) => ({
    title: priority.title || `Review ${priority.category || 'priority'}`,
    category: priority.category || null,
    priority_rank: priority.priority_rank ?? null,
    score: priority.score ?? null,
  }));
}

function getReviewPackUncertaintyReport(reviewPack) {
  const explicit = safeObject(reviewPack.uncertainty_coverage_report);
  if (Object.keys(explicit).length > 0) return explicit;
  return {
    analysis_confidence: reviewPack.confidence?.level || 'heuristic',
    numeric_score: reviewPack.confidence?.score ?? null,
    partial_evidence: false,
    missing_inputs: [],
    coverage: safeObject(reviewPack.coverage),
    warnings: safeList(reviewPack.warnings),
  };
}

function getReviewPackEvidenceLedger(reviewPack) {
  const explicit = safeObject(reviewPack.evidence_ledger);
  if (Object.keys(explicit).length > 0) return explicit;
  const geometryCount = safeList(reviewPack.geometry_hotspots).length;
  const inspectionCount = safeList(reviewPack.inspection_anomalies).length;
  const qualityCount = safeList(reviewPack.quality_linkage?.records).length;
  return {
    record_count: geometryCount + inspectionCount + qualityCount,
    counts_by_type: {
      geometry_hotspot: geometryCount,
      inspection_anomaly: inspectionCount,
      quality_pattern: qualityCount,
    },
    records: [],
  };
}

function collectReviewPackWarnings(reviewPack, extraWarnings = []) {
  return uniqueStrings([
    ...safeList(reviewPack.warnings),
    ...safeList(reviewPack.uncertainty_coverage_report?.warnings),
    ...collectDataQualityMessages(reviewPack),
    ...extraWarnings,
  ]);
}

function normalizePart(part = {}) {
  return {
    part_id: part.part_id || null,
    name: part.name || 'unknown_part',
    description: part.description || null,
    revision: part.revision || null,
    material: part.material || null,
    process: part.process || null,
  };
}

function extractReviewPackIdentity(reviewPack, { includeRevision = true } = {}) {
  const part = safeObject(reviewPack?.part);
  return {
    part_id: part.part_id || reviewPack?.part_id || null,
    name: part.name || null,
    revision: includeRevision ? (part.revision || reviewPack?.revision || null) : null,
  };
}

function extractArtifactIdentity(artifact, { includeRevision = true } = {}) {
  const part = safeObject(artifact?.part);
  return {
    part_id: part.part_id || artifact?.part_id || null,
    name: part.name || null,
    revision: includeRevision ? (part.revision || artifact?.revision || null) : null,
  };
}

function describeIdentity(identity = {}, { includeRevision = true } = {}) {
  const parts = [];
  if (identity.part_id) parts.push(`part_id=${identity.part_id}`);
  if (identity.name) parts.push(`name=${identity.name}`);
  if (includeRevision && identity.revision) parts.push(`revision=${identity.revision}`);
  return parts.join(', ') || 'unknown identity';
}

function collectIdentityMismatches(expected, actual, { allowRevisionDifference = false } = {}) {
  const mismatches = [];
  if (expected.part_id && actual.part_id && expected.part_id !== actual.part_id) {
    mismatches.push(`part_id mismatch (${expected.part_id} != ${actual.part_id})`);
  }
  if (expected.name && actual.name && expected.name !== actual.name) {
    mismatches.push(`name mismatch (${expected.name} != ${actual.name})`);
  }
  if (!allowRevisionDifference && expected.revision && actual.revision && expected.revision !== actual.revision) {
    mismatches.push(`revision mismatch (${expected.revision} != ${actual.revision})`);
  }
  return mismatches;
}

function findSourceArtifactRefs(artifact, artifactType) {
  return safeList(artifact?.source_artifact_refs)
    .filter((ref) => ref?.artifact_type === artifactType && typeof ref.path === 'string' && ref.path.trim());
}

function assertArtifactMatchesReviewPack(reviewPack, artifact, {
  artifactKind,
  reviewPackPath = null,
} = {}) {
  if (!artifact) return;

  const reviewPackIdentity = extractReviewPackIdentity(reviewPack);
  const artifactIdentity = extractArtifactIdentity(artifact);
  const mismatches = collectIdentityMismatches(reviewPackIdentity, artifactIdentity);
  if (mismatches.length > 0) {
    throw new Error(
      `${artifactKind} does not match the supplied review_pack identity (${describeIdentity(reviewPackIdentity)} vs ${describeIdentity(artifactIdentity)}): ${mismatches.join('; ')}`
    );
  }

  const reviewPackRefs = findSourceArtifactRefs(artifact, 'review_pack');
  if (reviewPackPath && reviewPackRefs.length > 0 && !reviewPackRefs.some((ref) => ref.path === reviewPackPath)) {
    throw new Error(
      `${artifactKind} does not reference the supplied review_pack path (${reviewPackPath}).`
    );
  }

  if (artifactKind === 'process_plan') {
    const basis = safeObject(artifact.planning_basis?.source_review_pack);
    if (reviewPackPath && basis.path && basis.path !== reviewPackPath) {
      throw new Error(
        `${artifactKind} planning_basis.source_review_pack.path does not match the supplied review_pack path (${reviewPackPath}).`
      );
    }
    if (reviewPackIdentity.revision && basis.revision && basis.revision !== reviewPackIdentity.revision) {
      throw new Error(
        `${artifactKind} planning_basis.source_review_pack.revision does not match the supplied review_pack revision (${reviewPackIdentity.revision}).`
      );
    }
  }
}

function assertComparableReadinessReports(baselineReport, candidateReport) {
  const baselineIdentity = extractArtifactIdentity(baselineReport, { includeRevision: false });
  const candidateIdentity = extractArtifactIdentity(candidateReport, { includeRevision: false });
  const mismatches = collectIdentityMismatches(baselineIdentity, candidateIdentity, {
    allowRevisionDifference: true,
  });

  if (mismatches.length > 0) {
    throw new Error(
      `Baseline and candidate readiness reports do not describe the same part lineage (${describeIdentity(baselineIdentity, { includeRevision: false })} vs ${describeIdentity(candidateIdentity, { includeRevision: false })}): ${mismatches.join('; ')}`
    );
  }
}

function buildArtifactEnvelope(payload, {
  kind,
  command,
  generatedAt = null,
  warnings = [],
  coverage = {},
  confidence = null,
  sourceArtifactRefs = [],
}) {
  const contract = getCCommandContract(command);
  return {
    ...payload,
    schema_version: C_ARTIFACT_SCHEMA_VERSION,
    artifact_type: kind,
    generated_at: payload.generated_at || nowIso(generatedAt),
    warnings: uniqueStrings([...(payload.warnings || []), ...warnings]),
    coverage: payload.coverage || coverage,
    confidence: payload.confidence || confidence,
    source_artifact_refs: mergeSourceArtifactRefs(payload.source_artifact_refs || [], sourceArtifactRefs),
    canonical_artifact: payload.canonical_artifact || buildCanonicalArtifactDescriptor(kind, contract),
    contract: payload.contract || contract,
  };
}

function buildReviewPackSourceRefs(reviewPack, reviewPackPath) {
  return mergeSourceArtifactRefs(
    safeList(reviewPack.source_artifact_refs),
    reviewPackPath
      ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'input', 'Canonical review-pack JSON')]
      : []
  );
}

function indexInspectionRecords(reviewPack) {
  const inspectionRecords = safeList(reviewPack.inspection_linkage?.records);
  return new Map(
    inspectionRecords
      .filter((record) => record?.record_id)
      .map((record) => [record.record_id, record])
  );
}

function indexInspectionAnomalies(reviewPack) {
  const anomalies = safeList(reviewPack.inspection_anomalies);
  return new Map(
    anomalies
      .filter((record) => record?.record_id)
      .map((record) => [record.record_id, record])
  );
}

function indexQualityRecords(reviewPack) {
  const qualityRecords = safeList(reviewPack.quality_linkage?.records);
  return new Map(
    qualityRecords
      .filter((record) => record?.issue_id)
      .map((record) => [record.issue_id, record])
  );
}

function actionMapForReviewPack(reviewPack) {
  return new Map(
    safeList(reviewPack.recommended_actions)
      .filter((action) => action?.category)
      .map((action) => [action.category, action])
  );
}

function buildProcessFlow(reviewPack) {
  const priorities = safeList(reviewPack.review_priorities);
  const actionsByCategory = actionMapForReviewPack(reviewPack);
  const inspectionRecordsById = indexInspectionRecords(reviewPack);
  const qualityRecordsById = indexQualityRecords(reviewPack);
  const steps = priorities.map((priority, index) => {
    const action = actionsByCategory.get(priority.category) || null;
    const linkedInspection = safeList(priority.related_inspection_records)
      .map((recordId) => inspectionRecordsById.get(recordId))
      .filter(Boolean);
    const linkedQuality = safeList(priority.related_quality_issues)
      .map((issueId) => qualityRecordsById.get(issueId))
      .filter(Boolean);
    return {
      step: (index + 1) * 10,
      operation: priority.title || `Review ${priority.category || 'priority'}`,
      execution_type: linkedInspection.length > 0 || linkedQuality.length > 0
        ? 'evidence_closure'
        : 'risk_review',
      priority_rank: priority.priority_rank ?? null,
      category: priority.category || null,
      score: priority.score ?? null,
      recommended_action: action?.recommended_action || null,
      related_inspection_records: linkedInspection.map((record) => ({
        record_id: record.record_id || null,
        dimension_name: record.dimension_name || null,
        status: record.status || null,
      })),
      related_quality_issues: linkedQuality.map((record) => ({
        issue_id: record.issue_id || null,
        description: record.description || null,
        defect_code: record.defect_code || null,
      })),
      completion_evidence: uniqueStrings([
        ...(linkedInspection.map((record) => record.dimension_name).filter(Boolean)),
        ...(linkedQuality.map((record) => record.description).filter(Boolean)),
        action?.recommended_action || '',
      ]),
      rationale: priority.rationale || null,
    };
  });

  const missingInputs = collectMissingInputs(reviewPack);
  if (missingInputs.length > 0) {
    steps.push({
      step: (steps.length + 1) * 10,
      operation: 'Close missing evidence before release',
      execution_type: 'evidence_gap_closure',
      priority_rank: null,
      category: 'evidence_gap',
      score: null,
      recommended_action: `Collect or validate: ${missingInputs.join(', ')}`,
      related_inspection_records: [],
      related_quality_issues: [],
      completion_evidence: missingInputs,
      rationale: 'Review-pack uncertainty report identified missing upstream evidence that must stay visible in C outputs.',
    });
  }

  if (steps.length === 0) {
    steps.push({
      step: 10,
      operation: 'Review upstream readiness evidence',
      execution_type: 'evidence_review',
      priority_rank: null,
      category: 'readiness_review',
      score: null,
      recommended_action: 'No prioritized hotspots were present; confirm the review-pack inputs and release assumptions.',
      related_inspection_records: [],
      related_quality_issues: [],
      completion_evidence: [],
      rationale: 'No review priorities were present in the supplied review pack.',
    });
  }

  return steps;
}

function buildKeyInspectionPoints(reviewPack) {
  const priorities = safeList(reviewPack.review_priorities);
  const priorityRankByCategory = new Map(
    priorities
      .filter((priority) => priority?.category)
      .map((priority) => [priority.category, priority.priority_rank ?? null])
  );
  const anomaliesById = indexInspectionAnomalies(reviewPack);
  const inspectionPoints = [];
  const seen = new Set();

  for (const record of safeList(reviewPack.inspection_linkage?.records)) {
    const categories = safeList(record.matched_categories);
    const primaryCategory = categories[0] || 'inspection_variation';
    const anomaly = anomaliesById.get(record.record_id) || {};
    const key = `${record.record_id || ''}|${record.dimension_name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    inspectionPoints.push({
      id: record.record_id || record.dimension_name || `inspection-${inspectionPoints.length + 1}`,
      checkpoint: record.dimension_name || 'Inspection checkpoint',
      status: record.status || anomaly.status || null,
      deviation: anomaly.magnitude ?? record.deviation ?? null,
      linked_categories: categories,
      priority_rank: priorityRankByCategory.get(primaryCategory) ?? null,
      rationale: record.rationale || null,
    });
  }

  return inspectionPoints;
}

function buildAutomationCandidates(reviewPack) {
  const triggerPattern = /\b(auto|automation|vision|camera|inline|fixture|probe)\b/i;
  return uniqueStrings(
    safeList(reviewPack.recommended_actions)
      .map((action) => action?.recommended_action)
      .filter((text) => typeof text === 'string' && triggerPattern.test(text))
  );
}

function buildProcessPlanCoverage(reviewPack, processFlow, inspectionPoints, automationCandidates, sourceArtifactRefs) {
  return {
    ...safeObject(reviewPack.coverage),
    review_priority_count: safeList(reviewPack.review_priorities).length,
    recommended_action_count: safeList(reviewPack.recommended_actions).length,
    process_step_count: processFlow.length,
    key_inspection_point_count: inspectionPoints.length,
    automation_candidate_count: automationCandidates.length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function buildProcessPlanFromReviewPack({ reviewPack, reviewPackPath = null, generatedAt = null } = {}) {
  assertValidDArtifact('review_pack', reviewPack, { command: 'process-plan' });

  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack);
  const normalizedPart = normalizePart(reviewPack.part);
  const processFlow = buildProcessFlow(reviewPack);
  const inspectionPoints = buildKeyInspectionPoints(reviewPack);
  const automationCandidates = buildAutomationCandidates(reviewPack);
  const warnings = collectReviewPackWarnings(reviewPack);
  const missingInputs = collectMissingInputs(reviewPack);
  const sourceArtifactRefs = buildReviewPackSourceRefs(reviewPack, reviewPackPath);
  const coverage = buildProcessPlanCoverage(
    reviewPack,
    processFlow,
    inspectionPoints,
    automationCandidates,
    sourceArtifactRefs
  );
  const confidence = buildPropagatedConfidence(reviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Process-plan-specific interpretation lives in planning_basis and summary fields instead of confidence.',
    ],
    sourceConfidenceRefs: reviewPackPath
      ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
      : [],
  });

  return buildArtifactEnvelope({
    agent: 'process_planning',
    part: normalizedPart,
    summary: {
      overall_risk_level: riskLevelFromSignals({
        missingInputs,
        warnings,
        priorities: safeList(reviewPack.review_priorities),
      }),
      planning_mode: 'review_pack_execution',
      priority_count: safeList(reviewPack.review_priorities).length,
      recommended_action_count: safeList(reviewPack.recommended_actions).length,
      highest_priority_category: safeList(reviewPack.review_priorities)[0]?.category || null,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    planning_basis: {
      source_review_pack: {
        part_id: reviewPack.part_id || null,
        revision: reviewPack.revision || null,
        generated_at: reviewPack.generated_at || null,
        path: reviewPackPath || null,
      },
      review_pack_headline: executiveSummary.headline || null,
      top_risk_categories: safeList(executiveSummary.top_risk_categories),
      uncertainty_coverage_report: cloneJson(uncertaintyReport),
      upstream_confidence: cloneJson(reviewPack.confidence || {}),
    },
    process_flow: processFlow,
    key_inspection_points: inspectionPoints,
    automation_candidates: automationCandidates,
    bottleneck_risks: uniqueStrings([
      ...safeList(reviewPack.review_priorities).slice(0, 3).map((priority) => priority.title).filter(Boolean),
      ...missingInputs.map((item) => `Missing evidence: ${item}`),
    ]),
    planning_notes: uniqueStrings([
      ...warnings,
      missingInputs.length > 0
        ? 'Partial evidence propagated from review-pack uncertainty coverage report.'
        : '',
    ]),
  }, {
    kind: 'process_plan',
    command: 'process-plan',
    generatedAt,
    warnings,
    coverage,
    confidence,
    sourceArtifactRefs,
  });
}

function buildQualityRisks(reviewPack) {
  const actionsByCategory = actionMapForReviewPack(reviewPack);
  return safeList(reviewPack.review_priorities).map((priority, index) => {
    const action = actionsByCategory.get(priority.category) || null;
    return {
      risk_id: `quality-risk-${priority.priority_rank || index + 1}`,
      title: priority.title || `Review ${priority.category || 'priority'}`,
      category: priority.category || null,
      severity: rankToSeverity(priority.priority_rank),
      priority_rank: priority.priority_rank ?? null,
      score: priority.score ?? null,
      evidence_count: priority.evidence_count ?? 0,
      linked_inspection_records: safeList(priority.related_inspection_records),
      linked_quality_issues: safeList(priority.related_quality_issues),
      recommended_action: action?.recommended_action || null,
      rationale: priority.rationale || null,
      source: 'review_pack',
    };
  });
}

function buildCriticalDimensions(reviewPack) {
  const records = [];
  const seen = new Set();
  const anomaliesById = indexInspectionAnomalies(reviewPack);

  for (const record of safeList(reviewPack.inspection_linkage?.records)) {
    const key = record.dimension_name || record.record_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const anomaly = anomaliesById.get(record.record_id) || {};
    records.push({
      id: record.record_id || key,
      name: record.dimension_name || key,
      status: record.status || anomaly.status || null,
      deviation: anomaly.magnitude ?? record.deviation ?? null,
      linked_categories: safeList(record.matched_categories),
    });
  }

  return records;
}

function buildQualityGates(reviewPack, criticalDimensions, qualityRisks) {
  const gates = [];
  const seen = new Set();

  for (const dimension of criticalDimensions) {
    const key = `inspection|${dimension.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({
      gate_id: `gate-${dimension.id}`,
      title: `Verify ${dimension.name}`,
      gate_type: 'inspection_confirmation',
      linked_categories: safeList(dimension.linked_categories),
      status: dimension.status || null,
      deviation: dimension.deviation ?? null,
    });
  }

  for (const risk of qualityRisks) {
    const key = `risk|${risk.category}|${risk.priority_rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gates.push({
      gate_id: `gate-priority-${risk.priority_rank || gates.length + 1}`,
      title: risk.title,
      gate_type: risk.linked_quality_issues.length > 0 ? 'quality_containment' : 'readiness_review',
      linked_categories: risk.category ? [risk.category] : [],
      priority_rank: risk.priority_rank ?? null,
      recommended_action: risk.recommended_action || null,
    });
  }

  return gates;
}

function buildQualityRiskCoverage(reviewPack, criticalDimensions, qualityRisks, qualityGates, sourceArtifactRefs) {
  return {
    ...safeObject(reviewPack.coverage),
    critical_dimension_count: criticalDimensions.length,
    quality_risk_count: qualityRisks.length,
    quality_gate_count: qualityGates.length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function buildQualityRiskFromReviewPack({ reviewPack, reviewPackPath = null, generatedAt = null } = {}) {
  assertValidDArtifact('review_pack', reviewPack, { command: 'quality-risk' });

  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack);
  const normalizedPart = normalizePart(reviewPack.part);
  const warnings = collectReviewPackWarnings(reviewPack);
  const missingInputs = collectMissingInputs(reviewPack);
  const sourceArtifactRefs = buildReviewPackSourceRefs(reviewPack, reviewPackPath);
  const criticalDimensions = buildCriticalDimensions(reviewPack);
  const qualityRisks = buildQualityRisks(reviewPack);
  const qualityGates = buildQualityGates(reviewPack, criticalDimensions, qualityRisks);
  const coverage = buildQualityRiskCoverage(
    reviewPack,
    criticalDimensions,
    qualityRisks,
    qualityGates,
    sourceArtifactRefs
  );
  const confidence = buildPropagatedConfidence(reviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Quality-risk-specific interpretation lives in evidence_pack and summary fields instead of confidence.',
    ],
    sourceConfidenceRefs: reviewPackPath
      ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
      : [],
  });

  return buildArtifactEnvelope({
    agent: 'quality_traceability',
    part: normalizedPart,
    summary: {
      overall_risk_level: riskLevelFromSignals({
        missingInputs,
        warnings,
        priorities: safeList(reviewPack.review_priorities),
      }),
      quality_signal_count: safeList(reviewPack.quality_linkage?.records).length,
      linked_priority_count: safeList(reviewPack.review_priorities).length,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    critical_dimensions: criticalDimensions,
    inspection_required_points: buildKeyInspectionPoints(reviewPack),
    traceability_summary: {
      source_file_count: safeObject(reviewPack.coverage).source_file_count ?? 0,
      evidence_record_count: safeObject(reviewPack.evidence_ledger).record_count ?? 0,
      inspection_record_count: safeObject(reviewPack.coverage).inspection_record_count ?? 0,
      quality_issue_count: safeObject(reviewPack.coverage).quality_issue_count ?? 0,
      partial_evidence: missingInputs.length > 0,
      missing_inputs: missingInputs,
    },
    quality_risks: qualityRisks,
    quality_gates: qualityGates,
    evidence_pack: {
      review_pack_headline: executiveSummary.headline || null,
      linkage_summary: {
        inspection: cloneJson(reviewPack.inspection_linkage?.summary || {}),
        quality: cloneJson(reviewPack.quality_linkage?.summary || {}),
      },
      uncertainty_coverage_report: cloneJson(uncertaintyReport),
      data_quality_notes: cloneJson(reviewPack.data_quality_notes || []),
      upstream_confidence: cloneJson(reviewPack.confidence || {}),
    },
  }, {
    kind: 'quality_risk',
    command: 'quality-risk',
    generatedAt,
    warnings,
    coverage,
    confidence,
    sourceArtifactRefs,
  });
}

function calculateReadinessScore(reviewPack, processPlan, qualityRisk, warnings, missingInputs) {
  const reviewPackConfidence = Number.isFinite(reviewPack?.confidence?.score) ? reviewPack.confidence.score : 0.5;
  const uncertaintyReport = getReviewPackUncertaintyReport(reviewPack || {});
  const uncertaintyScore = Number.isFinite(uncertaintyReport.numeric_score)
    ? uncertaintyReport.numeric_score
    : reviewPackConfidence;
  const baseScore = 30 + (uncertaintyScore * 30) + (reviewPackConfidence * 25);
  const warningPenalty = warnings.length * 5;
  const missingInputPenalty = missingInputs.length * 8;
  const gateCoverageBonus = Math.min((qualityRisk.quality_gates || []).length, 4) * 2;
  const planCoverageBonus = Math.min((processPlan.process_flow || []).length, 5);
  const rawScore = baseScore + gateCoverageBonus + planCoverageBonus - warningPenalty - missingInputPenalty;
  return Math.max(20, Math.min(95, Math.round(rawScore)));
}

function readinessStatusForScore(score, missingInputs, confidenceLevel) {
  if (missingInputs.length > 0 || confidenceLevel === 'low') {
    return {
      status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
    };
  }
  if (score >= 80) {
    return {
      status: 'candidate_for_pilot_line_review',
      gate_decision: 'candidate_for_pilot_line_review',
    };
  }
  if (score >= 65) {
    return {
      status: 'needs_risk_reduction',
      gate_decision: 'hold_before_line_commitment',
    };
  }
  return {
    status: 'hold_before_line_commitment',
    gate_decision: 'hold_before_line_commitment',
  };
}

function buildReadinessSummary(report, missingInputs) {
  const score = calculateReadinessScore(
    report.review_pack,
    report.process_plan,
    report.quality_risk,
    safeList(report.warnings),
    missingInputs
  );
  return {
    score,
    ...readinessStatusForScore(score, missingInputs, report.confidence.level),
  };
}

function buildDecisionSummary(reviewPack, processPlan, qualityRisk, readinessSummary, warnings, missingInputs) {
  const goSignals = [];
  const holdPoints = [];

  if (missingInputs.length === 0) {
    goSignals.push('Canonical review-pack includes geometry, inspection, and quality evidence for downstream readiness packaging.');
  } else {
    holdPoints.push(`Upstream evidence is still partial: ${missingInputs.join(', ')}.`);
  }

  if ((processPlan.process_flow || []).length > 0) {
    goSignals.push('Manufacturing execution steps were derived directly from review priorities and recommended actions.');
  }

  if ((qualityRisk.quality_gates || []).length > 0) {
    goSignals.push('Quality gates and inspection-required points are explicitly listed for downstream follow-up.');
  } else {
    holdPoints.push('No auditable quality gates were derived from the supplied review pack.');
  }

  if (warnings.length > 0) {
    holdPoints.push(`Propagated warnings remain open: ${warnings.slice(0, 3).join('; ')}.`);
  }

  if (readinessSummary.status === 'candidate_for_pilot_line_review') {
    goSignals.push('Evidence completeness and propagated confidence are sufficient for pilot-line planning review.');
  } else {
    holdPoints.push('Release readiness remains gated until the open evidence and risk actions are closed.');
  }

  const nextActions = uniqueStrings([
    ...safeList(reviewPack.recommended_actions).map((action) => action.recommended_action),
    ...safeList(processPlan.process_flow).map((step) => step.recommended_action),
    ...safeList(qualityRisk.quality_risks).map((risk) => risk.recommended_action),
  ]).slice(0, 5);

  return {
    go_signals: goSignals,
    hold_points: holdPoints,
    next_actions: nextActions,
  };
}

function buildReportSummary(reviewPack, processPlan, qualityRisk, readinessSummary, warnings, missingInputs) {
  const prioritizedHotspots = getReviewPackPrioritizedHotspots(reviewPack);
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  return {
    overall_risk_level: readinessSummary.status === 'candidate_for_pilot_line_review'
      ? 'low'
      : readinessSummary.status === 'needs_risk_reduction'
        ? 'medium'
        : 'high',
    top_issues: uniqueStrings([
      ...prioritizedHotspots.slice(0, 3).map((item) => item.title),
      ...missingInputs.map((item) => `Missing evidence: ${item}`),
      ...warnings.slice(0, 2),
    ]).slice(0, 5),
    recommended_actions: uniqueStrings([
      ...safeList(reviewPack.recommended_actions).map((action) => action.recommended_action),
      ...safeList(processPlan.process_flow).map((step) => step.recommended_action),
    ]).slice(0, 5),
    likely_bottleneck_candidates: safeList(processPlan.bottleneck_risks).slice(0, 5),
    likely_automation_candidates: safeList(processPlan.automation_candidates).slice(0, 5),
    launch_stabilization_focus: [],
    review_pack_headline: executiveSummary.headline || null,
  };
}

function buildReadinessCoverage(reviewPack, processPlan, qualityRisk, sourceArtifactRefs) {
  const evidenceLedger = getReviewPackEvidenceLedger(reviewPack);
  return {
    ...safeObject(reviewPack.coverage),
    required_section_count: 4,
    available_section_count: 4,
    process_step_count: safeList(processPlan.process_flow).length,
    quality_gate_count: safeList(qualityRisk.quality_gates).length,
    missing_input_count: collectMissingInputs(reviewPack).length,
    evidence_record_count: evidenceLedger.record_count ?? 0,
    source_artifact_count: sourceArtifactRefs.length,
    upstream_review_pack_coverage: cloneJson(reviewPack.coverage || {}),
  };
}

export function renderCanonicalReadinessMarkdown(report) {
  const reviewPack = safeObject(report.review_pack);
  const executiveSummary = getReviewPackExecutiveSummary(reviewPack);
  const summary = safeObject(report.summary);
  const decision = safeObject(report.decision_summary);
  const warnings = safeList(report.warnings);
  const missingInputs = collectMissingInputs(reviewPack);

  return `# Production Readiness Report: ${report.part.name}

- Status: ${report.readiness_summary.status}
- Composite score: ${report.readiness_summary.score}
- Gate decision: ${report.readiness_summary.gate_decision}
- Review-pack headline: ${executiveSummary.headline || 'n/a'}

## Executive Summary

- Overall risk level: ${summary.overall_risk_level ?? 'n/a'}
- Top issues: ${(summary.top_issues || []).join('; ') || 'none'}
- Recommended actions: ${(summary.recommended_actions || []).join('; ') || 'none'}
- Missing inputs: ${missingInputs.join(', ') || 'none'}

## Process Plan

- Flow steps: ${(report.process_plan?.process_flow || []).length}
- Key inspection points: ${(report.process_plan?.key_inspection_points || []).length}
- Bottleneck risks: ${(report.process_plan?.bottleneck_risks || []).join('; ') || 'none'}

## Quality Risk

- Critical dimensions: ${(report.quality_risk?.critical_dimensions || []).length}
- Quality risks: ${(report.quality_risk?.quality_risks || []).length}
- Quality gates: ${(report.quality_risk?.quality_gates || []).length}

## Decision Summary

- Go signals: ${(decision.go_signals || []).join('; ') || 'none'}
- Hold points: ${(decision.hold_points || []).join('; ') || 'none'}
- Next actions: ${(decision.next_actions || []).join('; ') || 'none'}

## Propagated Signals

- Warnings: ${warnings.join('; ') || 'none'}
- Confidence: ${report.confidence?.level || 'n/a'} (${report.confidence?.score ?? 'n/a'})
`;
}

export function buildReadinessReportFromReviewPack({
  reviewPack,
  reviewPackPath = null,
  processPlan = null,
  qualityRisk = null,
  generatedAt = null,
} = {}) {
  assertValidDArtifact('review_pack', reviewPack, { command: 'readiness-report' });
  assertArtifactMatchesReviewPack(reviewPack, processPlan, {
    artifactKind: 'process_plan',
    reviewPackPath,
  });
  assertArtifactMatchesReviewPack(reviewPack, qualityRisk, {
    artifactKind: 'quality_risk',
    reviewPackPath,
  });

  const resolvedProcessPlan = processPlan || buildProcessPlanFromReviewPack({
    reviewPack,
    reviewPackPath,
    generatedAt,
  });
  const resolvedQualityRisk = qualityRisk || buildQualityRiskFromReviewPack({
    reviewPack,
    reviewPackPath,
    generatedAt,
  });
  const sourceArtifactRefs = mergeSourceArtifactRefs(
    buildReviewPackSourceRefs(reviewPack, reviewPackPath),
    mergeSourceArtifactRefs(
      safeList(resolvedProcessPlan.source_artifact_refs),
      safeList(resolvedQualityRisk.source_artifact_refs)
    )
  );
  const warnings = uniqueStrings([
    ...collectReviewPackWarnings(reviewPack),
    ...safeList(resolvedProcessPlan.warnings),
    ...safeList(resolvedQualityRisk.warnings),
  ]);
  const confidence = buildPropagatedConfidence(reviewPack.confidence, {
    propagatedFrom: 'review_pack',
    propagationNotes: [
      'C preserves D confidence from review_pack without recalculating score or level.',
      'Readiness score, gate decision, and action synthesis remain downstream packaging fields, not confidence rewrites.',
    ],
    sourceConfidenceRefs: [
      ...(reviewPackPath
        ? [buildSourceArtifactRef('review_pack', reviewPackPath, 'confidence_source', 'Review-pack confidence source')]
        : []),
      ...safeList(resolvedProcessPlan.source_artifact_refs).filter((ref) => ref.artifact_type === 'review_pack'),
      ...safeList(resolvedQualityRisk.source_artifact_refs).filter((ref) => ref.artifact_type === 'review_pack'),
    ],
  });

  const report = buildArtifactEnvelope({
    workflow: 'production_readiness',
    part: normalizePart(reviewPack.part),
    review_pack: cloneJson(reviewPack),
    process_plan: resolvedProcessPlan,
    quality_risk: resolvedQualityRisk,
  }, {
    kind: 'readiness_report',
    command: 'readiness-report',
    generatedAt,
    warnings,
    coverage: buildReadinessCoverage(reviewPack, resolvedProcessPlan, resolvedQualityRisk, sourceArtifactRefs),
    confidence,
    sourceArtifactRefs,
  });

  const missingInputs = collectMissingInputs(reviewPack);
  report.readiness_summary = buildReadinessSummary(report, missingInputs);
  report.summary = buildReportSummary(reviewPack, resolvedProcessPlan, resolvedQualityRisk, report.readiness_summary, warnings, missingInputs);
  report.decision_summary = buildDecisionSummary(reviewPack, resolvedProcessPlan, resolvedQualityRisk, report.readiness_summary, warnings, missingInputs);
  report.markdown = renderCanonicalReadinessMarkdown(report);
  return report;
}

export async function writeCanonicalReadinessArtifacts(outputJsonPath, report) {
  const jsonPath = await writeValidatedCArtifact(outputJsonPath, 'readiness_report', report, {
    command: 'readiness-report',
  });
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  await writeFile(markdownPath, `${String(report.markdown || '').trim()}\n`, 'utf8');
  return { json: jsonPath, markdown: markdownPath };
}

function diffLists(baseline, candidate) {
  const baselineSet = new Set(safeList(baseline));
  const candidateSet = new Set(safeList(candidate));
  return {
    added: [...candidateSet].filter((item) => !baselineSet.has(item)),
    removed: [...baselineSet].filter((item) => !candidateSet.has(item)),
  };
}

function collectMissingInputsFromReport(report) {
  return uniqueStrings([
    ...safeList(report.review_pack?.uncertainty_coverage_report?.missing_inputs),
    ...safeList(report.process_plan?.summary?.missing_inputs),
    ...safeList(report.quality_risk?.summary?.missing_inputs),
  ]);
}

function buildStabilizationChangeReasons(baseline, candidate) {
  const reasons = [];
  const baselineMissing = collectMissingInputsFromReport(baseline);
  const candidateMissing = collectMissingInputsFromReport(candidate);
  const warningDiff = diffLists(baseline.warnings, candidate.warnings);
  const actionDiff = diffLists(
    safeList(baseline.summary?.recommended_actions),
    safeList(candidate.summary?.recommended_actions)
  );
  const topIssueDiff = diffLists(
    safeList(baseline.summary?.top_issues),
    safeList(candidate.summary?.top_issues)
  );
  const riskCategoryDiff = diffLists(
    safeList(getReviewPackExecutiveSummary(baseline.review_pack || {}).top_risk_categories),
    safeList(getReviewPackExecutiveSummary(candidate.review_pack || {}).top_risk_categories)
  );

  const readinessDelta = (candidate.readiness_summary?.score || 0) - (baseline.readiness_summary?.score || 0);
  if (readinessDelta !== 0) {
    reasons.push({
      change_type: 'readiness_score',
      delta: readinessDelta,
      reason: `Readiness score changed from ${baseline.readiness_summary?.score ?? 'n/a'} to ${candidate.readiness_summary?.score ?? 'n/a'}.`,
    });
  }
  if (baselineMissing.length !== candidateMissing.length || baselineMissing.join('|') !== candidateMissing.join('|')) {
    reasons.push({
      change_type: 'missing_evidence',
      baseline_missing_inputs: baselineMissing,
      candidate_missing_inputs: candidateMissing,
      reason: candidateMissing.length > baselineMissing.length
        ? 'Candidate readiness report carries more missing upstream evidence.'
        : 'Candidate readiness report closes some previously missing upstream evidence.',
    });
  }
  if (warningDiff.added.length > 0 || warningDiff.removed.length > 0) {
    reasons.push({
      change_type: 'warning_propagation',
      added: warningDiff.added,
      removed: warningDiff.removed,
      reason: 'Propagated warnings changed between the compared readiness reports.',
    });
  }
  if (topIssueDiff.added.length > 0 || topIssueDiff.removed.length > 0) {
    reasons.push({
      change_type: 'top_issue_shift',
      added: topIssueDiff.added,
      removed: topIssueDiff.removed,
      reason: 'The top readiness issues changed between the compared artifacts.',
    });
  }
  if (riskCategoryDiff.added.length > 0 || riskCategoryDiff.removed.length > 0) {
    reasons.push({
      change_type: 'priority_category_shift',
      added: riskCategoryDiff.added,
      removed: riskCategoryDiff.removed,
      reason: 'Upstream review-pack risk categories shifted between revisions.',
    });
  }
  if (actionDiff.added.length > 0 || actionDiff.removed.length > 0) {
    reasons.push({
      change_type: 'action_register',
      added: actionDiff.added,
      removed: actionDiff.removed,
      reason: 'Recommended action register changed between readiness revisions.',
    });
  }

  const baselineConfidence = safeObject(baseline.confidence);
  const candidateConfidence = safeObject(candidate.confidence);
  if ((baselineConfidence.score ?? null) !== (candidateConfidence.score ?? null)) {
    reasons.push({
      change_type: 'confidence_shift',
      baseline_score: baselineConfidence.score ?? null,
      candidate_score: candidateConfidence.score ?? null,
      baseline_level: baselineConfidence.level || null,
      candidate_level: candidateConfidence.level || null,
      reason: 'Composite readiness confidence changed because upstream evidence completeness or warnings changed.',
    });
  }

  return reasons;
}

function buildComparisonSummary(baseline, candidate, changeReasons) {
  const readinessDelta = (candidate.readiness_summary?.score || 0) - (baseline.readiness_summary?.score || 0);
  return {
    comparison_basis: 'readiness_report_delta',
    baseline_revision: baseline.part?.revision || null,
    candidate_revision: candidate.part?.revision || null,
    status_change: baseline.readiness_summary?.status === candidate.readiness_summary?.status
      ? 'unchanged'
      : `${baseline.readiness_summary?.status || 'unknown'} -> ${candidate.readiness_summary?.status || 'unknown'}`,
    readiness_score_delta: readinessDelta,
    higher_risk_revision: readinessDelta < 0
      ? candidate.part?.revision || 'candidate'
      : baseline.part?.revision || 'baseline',
    key_change_drivers: changeReasons.map((reason) => reason.reason).slice(0, 5),
    recommended_actions: uniqueStrings([
      ...safeList(candidate.summary?.recommended_actions),
      ...safeList(candidate.decision_summary?.next_actions),
    ]).slice(0, 5),
  };
}

function buildComparisonCoverage(baseline, candidate, sourceArtifactRefs) {
  return {
    baseline_warning_count: safeList(baseline.warnings).length,
    candidate_warning_count: safeList(candidate.warnings).length,
    baseline_missing_input_count: collectMissingInputsFromReport(baseline).length,
    candidate_missing_input_count: collectMissingInputsFromReport(candidate).length,
    baseline_process_step_count: safeList(baseline.process_plan?.process_flow).length,
    candidate_process_step_count: safeList(candidate.process_plan?.process_flow).length,
    baseline_quality_gate_count: safeList(baseline.quality_risk?.quality_gates).length,
    candidate_quality_gate_count: safeList(candidate.quality_risk?.quality_gates).length,
    source_artifact_count: sourceArtifactRefs.length,
  };
}

export function buildStabilizationReviewFromReadinessReports({
  baselineReport,
  candidateReport,
  baselinePath = null,
  candidatePath = null,
  generatedAt = null,
} = {}) {
  assertValidCArtifact('readiness_report', baselineReport, { command: 'stabilization-review' });
  assertValidCArtifact('readiness_report', candidateReport, { command: 'stabilization-review' });
  assertComparableReadinessReports(baselineReport, candidateReport);

  const sourceArtifactRefs = mergeSourceArtifactRefs(
    mergeSourceArtifactRefs(
      safeList(baselineReport.source_artifact_refs),
      baselinePath ? [buildSourceArtifactRef('readiness_report', baselinePath, 'input', 'Baseline readiness report')] : []
    ),
    mergeSourceArtifactRefs(
      safeList(candidateReport.source_artifact_refs),
      candidatePath ? [buildSourceArtifactRef('readiness_report', candidatePath, 'input', 'Candidate readiness report')] : []
    )
  );
  const changeReasons = buildStabilizationChangeReasons(baselineReport, candidateReport);
  const warnings = uniqueStrings([
    ...safeList(baselineReport.warnings),
    ...safeList(candidateReport.warnings),
  ]);
  const confidence = buildPropagatedConfidence(candidateReport.confidence, {
    propagatedFrom: 'candidate_readiness_report',
    propagationNotes: [
      'Stabilization review preserves the candidate readiness confidence without recalculating score or level.',
      'Baseline-versus-candidate confidence differences are reported under change_reasons instead of being folded into a new confidence value.',
    ],
    sourceConfidenceRefs: [
      ...(candidatePath
        ? [buildSourceArtifactRef('readiness_report', candidatePath, 'confidence_source', 'Candidate readiness confidence source')]
        : []),
      ...(baselinePath
        ? [buildSourceArtifactRef('readiness_report', baselinePath, 'comparison_confidence_source', 'Baseline readiness confidence reference')]
        : []),
    ],
  });

  return buildArtifactEnvelope({
    agent: 'stabilization_review',
    part: normalizePart(candidateReport.part || baselineReport.part || {}),
    summary: buildComparisonSummary(baselineReport, candidateReport, changeReasons),
    comparison_basis: {
      mode: 'readiness_report_delta',
      baseline_path: baselinePath || null,
      candidate_path: candidatePath || null,
    },
    baseline: {
      revision: baselineReport.part?.revision || null,
      readiness_summary: cloneJson(baselineReport.readiness_summary || {}),
      summary: cloneJson(baselineReport.summary || {}),
      warnings: cloneJson(baselineReport.warnings || []),
      coverage: cloneJson(baselineReport.coverage || {}),
      confidence: cloneJson(baselineReport.confidence || {}),
    },
    candidate: {
      revision: candidateReport.part?.revision || null,
      readiness_summary: cloneJson(candidateReport.readiness_summary || {}),
      summary: cloneJson(candidateReport.summary || {}),
      warnings: cloneJson(candidateReport.warnings || []),
      coverage: cloneJson(candidateReport.coverage || {}),
      confidence: cloneJson(candidateReport.confidence || {}),
    },
    readiness_deltas: {
      score_delta: (candidateReport.readiness_summary?.score || 0) - (baselineReport.readiness_summary?.score || 0),
      warning_delta: safeList(candidateReport.warnings).length - safeList(baselineReport.warnings).length,
      missing_input_delta: collectMissingInputsFromReport(candidateReport).length - collectMissingInputsFromReport(baselineReport).length,
      process_step_delta: safeList(candidateReport.process_plan?.process_flow).length - safeList(baselineReport.process_plan?.process_flow).length,
      quality_gate_delta: safeList(candidateReport.quality_risk?.quality_gates).length - safeList(baselineReport.quality_risk?.quality_gates).length,
    },
    change_reasons: changeReasons,
    recommended_action_changes: {
      ...diffLists(
        safeList(baselineReport.summary?.recommended_actions),
        safeList(candidateReport.summary?.recommended_actions)
      ),
    },
    warning_changes: {
      ...diffLists(baselineReport.warnings, candidateReport.warnings),
    },
  }, {
    kind: 'stabilization_review',
    command: 'stabilization-review',
    generatedAt,
    warnings,
    coverage: buildComparisonCoverage(baselineReport, candidateReport, sourceArtifactRefs),
    confidence,
    sourceArtifactRefs,
  });
}

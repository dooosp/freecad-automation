import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { getDrawingIntent } from '../../../lib/drawing-intent.js';

const REPORT_SUMMARY_SCHEMA = JSON.parse(
  readFileSync(new URL('../../../schemas/report-summary.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateSummary = ajv.compile(REPORT_SUMMARY_SCHEMA);

export const REPORT_SUMMARY_SCHEMA_VERSION = '1.0';
export const DEFAULT_REPORT_THRESHOLDS = Object.freeze({
  tolerance_success_rate_pct: 95,
});

const OPTIONAL_ARTIFACT_KEYS = new Set([
  'fem',
  'tolerance',
  'create_manifest',
  'drawing_manifest',
  'feature_catalog',
  'extracted_drawing_semantics',
  'report_manifest',
  'traceability_json',
  'drawing_intent',
]);

const REQUIRED_ARTIFACT_KEYS = new Set([
  'report_pdf',
  'report_summary_json',
  'create_quality',
  'drawing_quality',
  'dfm',
]);

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeString(value, fallback = null) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function safeFilenameComponent(value, defaultValue = 'report') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function roundNumber(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function summarizeRequiredEvidence(entries = []) {
  return asArray(entries)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      requirement_id: safeString(entry.requirement_id),
      requirement_label: safeString(entry.requirement_label),
      classification: safeString(entry.classification, 'unknown'),
      matched_extracted_id: safeString(entry.matched_extracted_id),
      matched_raw_text: safeString(entry.matched_raw_text),
      matched_feature_id: safeString(entry.matched_feature_id),
      source_artifact: safeString(entry.source_artifact),
      confidence: finiteNumberOrNull(entry.confidence),
      reason: safeString(entry.reason),
      provenance: entry.provenance && typeof entry.provenance === 'object' ? entry.provenance : null,
      candidate_matches: asArray(entry.candidate_matches)
        .filter((candidate) => candidate && typeof candidate === 'object')
        .map((candidate) => ({
          matched_extracted_id: safeString(candidate.matched_extracted_id),
          matched_raw_text: safeString(candidate.matched_raw_text),
          matched_feature_id: safeString(candidate.matched_feature_id),
          source_artifact: safeString(candidate.source_artifact),
          confidence: finiteNumberOrNull(candidate.confidence),
          reason: safeString(candidate.reason),
          provenance: candidate.provenance && typeof candidate.provenance === 'object' ? candidate.provenance : null,
        })),
    }));
}

function summarizeUnmatchedEvidence(entries = []) {
  return asArray(entries)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      extracted_id: safeString(entry.extracted_id),
      raw_text: safeString(entry.raw_text),
      category: safeString(entry.category),
      matched_feature_id: safeString(entry.matched_feature_id),
      source_artifact: safeString(entry.source_artifact),
      confidence: finiteNumberOrNull(entry.confidence),
      reason: safeString(entry.reason),
      provenance: entry.provenance && typeof entry.provenance === 'object' ? entry.provenance : null,
    }));
}

function summarizeSuggestedActionDetails(entries = []) {
  return asArray(entries)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: safeString(entry.id),
      severity: safeString(entry.severity),
      category: safeString(entry.category),
      target_requirement_id: safeString(entry.target_requirement_id),
      target_feature_id: safeString(entry.target_feature_id),
      classification: safeString(entry.classification, 'unknown'),
      title: safeString(entry.title),
      message: safeString(entry.message),
      recommended_fix: safeString(entry.recommended_fix),
      evidence: asArray(entry.evidence)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          source: safeString(item.source),
          path: safeString(item.path),
          value: safeString(item.value),
        })),
    }));
}

function summarizeReviewerFeedbackItem(entry = {}) {
  return {
    id: safeString(entry.id),
    source: safeString(entry.source),
    reviewer_label: safeString(entry.reviewer_label),
    target_type: safeString(entry.target_type),
    target_id: safeString(entry.target_id),
    target_path: safeString(entry.target_path),
    category: safeString(entry.category),
    status: safeString(entry.status),
    severity: safeString(entry.severity),
    link_status: safeString(entry.link_status),
    resolution_state: safeString(entry.resolution_state),
    comment: safeString(entry.comment),
    requested_action: safeString(entry.requested_action),
    linked_evidence: asArray(entry.linked_evidence)
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        source: safeString(item.source),
        path: safeString(item.path),
        value: safeString(item.value),
      })),
    validation_errors: uniqueStrings(entry.validation_errors || []),
    provenance: entry.provenance && typeof entry.provenance === 'object' ? entry.provenance : null,
  };
}

function summarizeReviewerFeedback(reviewerFeedback = null) {
  if (!reviewerFeedback || typeof reviewerFeedback !== 'object') {
    return {
      advisory_only: true,
      status: 'none',
      evidence_state: 'none',
      total_count: 0,
      unresolved_count: 0,
      linked_count: 0,
      unmatched_count: 0,
      stale_count: 0,
      orphaned_count: 0,
      invalid_count: 0,
      accepted_count: 0,
      resolved_count: 0,
      items: [],
      summary: 'Reviewer feedback was not provided.',
      suggested_actions: [],
      suggested_action_details: [],
      path: null,
      provenance: null,
    };
  }

  const provenance = reviewerFeedback.provenance && typeof reviewerFeedback.provenance === 'object'
    ? reviewerFeedback.provenance
    : null;
  return {
    advisory_only: reviewerFeedback.advisory_only !== false,
    status: safeString(reviewerFeedback.status, 'none'),
    evidence_state: safeString(reviewerFeedback.evidence_state, 'none'),
    total_count: Number(reviewerFeedback.total_count || 0),
    unresolved_count: Number(reviewerFeedback.unresolved_count || 0),
    linked_count: Number(reviewerFeedback.linked_count || 0),
    unmatched_count: Number(reviewerFeedback.unmatched_count || 0),
    stale_count: Number(reviewerFeedback.stale_count || 0),
    orphaned_count: Number(reviewerFeedback.orphaned_count || 0),
    invalid_count: Number(reviewerFeedback.invalid_count || 0),
    accepted_count: Number(reviewerFeedback.accepted_count || 0),
    resolved_count: Number(reviewerFeedback.resolved_count || 0),
    items: asArray(reviewerFeedback.items).map((entry) => summarizeReviewerFeedbackItem(entry)),
    summary: safeString(reviewerFeedback.summary),
    suggested_actions: uniqueStrings(reviewerFeedback.suggested_actions || []),
    suggested_action_details: summarizeSuggestedActionDetails(reviewerFeedback.suggested_action_details),
    path: safeString(provenance?.path),
    provenance,
  };
}

function artifactRef(key, label, path, status, note = null, options = {}) {
  const required = typeof options.required === 'boolean'
    ? options.required
    : REQUIRED_ARTIFACT_KEYS.has(key) || !OPTIONAL_ARTIFACT_KEYS.has(key);
  return {
    key,
    label,
    path: path ? resolve(path) : null,
    status,
    required,
    note,
  };
}

function preferManifestValue(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || null;
}

function deriveBaseStem(primaryOutputPath = null, configName = null) {
  if (primaryOutputPath) {
    return parse(resolve(primaryOutputPath)).name.replace(/_report$/i, '');
  }
  return safeFilenameComponent(configName, 'report');
}

export function deriveReportArtifactPaths({ primaryOutputPath = null, outputDir = null, configName = null } = {}) {
  const pdfPath = primaryOutputPath
    ? resolve(primaryOutputPath)
    : join(resolve(outputDir || '.'), `${deriveBaseStem(null, configName)}_report.pdf`);
  const dir = dirname(pdfPath);
  const reportStem = parse(pdfPath).name;
  const baseStem = deriveBaseStem(pdfPath, configName);

  return {
    report_pdf: pdfPath,
    report_summary_json: join(dir, `${baseStem}_report_summary.json`),
    report_manifest: join(dir, `${reportStem}_manifest.json`),
    create_quality: join(dir, `${baseStem}_create_quality.json`),
    create_manifest: join(dir, `${baseStem}_manifest.json`),
    drawing_quality: join(dir, `${baseStem}_drawing_quality.json`),
    extracted_drawing_semantics: join(dir, `${baseStem}_extracted_drawing_semantics.json`),
    drawing_manifest: join(dir, `${baseStem}_drawing_manifest.json`),
    drawing_intent: join(dir, `${baseStem}_drawing_intent.json`),
    feature_catalog: join(dir, `${baseStem}_feature_catalog.json`),
    traceability_json: join(dir, `${baseStem}_traceability.json`),
    tolerance_csv: join(dir, `${baseStem}_tolerance.csv`),
  };
}

export function createReportSummaryPath({ primaryOutputPath = null, outputDir = null, configName = null } = {}) {
  return deriveReportArtifactPaths({ primaryOutputPath, outputDir, configName }).report_summary_json;
}

function summarizeCreateQuality(createQuality) {
  if (!createQuality || typeof createQuality !== 'object') {
    return {
      available: false,
      status: 'not_available',
      score: null,
      invalid_shape: null,
      blocking_issues: [],
      warnings: [],
    };
  }

  const blockingIssues = uniqueStrings(createQuality.blocking_issues || []);
  const warnings = uniqueStrings(createQuality.warnings || []);
  const invalidShape = createQuality.geometry?.valid_shape === false
    || blockingIssues.some((issue) => /shape is invalid/i.test(issue));

  return {
    available: true,
    status: createQuality.status || (blockingIssues.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass'),
    score: null,
    invalid_shape: invalidShape,
    blocking_issues: blockingIssues,
    warnings,
  };
}

function summarizeSemanticDrawingQuality(semanticQuality = null) {
  if (!semanticQuality || typeof semanticQuality !== 'object') {
    return {
      decision: 'not_available',
      advisory_decision: 'unknown',
      enforceable: false,
      score: null,
      critical_features_total: 0,
      critical_features_covered: 0,
      required_dimensions_total: 0,
      required_dimensions_present: 0,
      missing_required_dimensions: [],
      required_notes_missing: [],
      required_views_missing: [],
      traceability: {
        required_dimensions_total: 0,
        linked_required_dimensions: 0,
        missing_required_dimensions: [],
        unknown_required_dimensions: [],
      },
      missing_critical_information: [],
      required_blockers: [],
      optional_missing_information: [],
      suggested_actions: [],
      suggested_action_details: [],
      extracted_evidence: {
        status: 'not_run',
        advisory_only: true,
        file: null,
        path: null,
        sources: [],
        coverage: {
          required_dimensions: { total: 0, extracted: 0, missing: 0, unknown: 0, unsupported: 0, extracted_percent: null },
          required_notes: { total: 0, extracted: 0, missing: 0, unknown: 0, unsupported: 0, extracted_percent: null },
          required_views: { total: 0, extracted: 0, missing: 0, unknown: 0, unsupported: 0, extracted_percent: null },
          total_required: 0,
          total_extracted: 0,
          total_missing: 0,
          total_unknown: 0,
          total_unsupported: 0,
        },
        required_dimensions: [],
        required_notes: [],
        required_views: [],
        unmatched_dimensions: [],
        unmatched_notes: [],
        matched_required_dimensions: 0,
        matched_required_notes: 0,
        matched_required_views: 0,
        missing_required_items: [],
        unknowns: [],
        limitations: [],
        suggested_actions: [],
        suggested_action_details: [],
      },
    };
  }

  const extractedEvidence = asObject(semanticQuality.extracted_evidence);
  const coverage = asObject(extractedEvidence.coverage);
  const requiredDimensionCoverage = asObject(coverage.required_dimensions);
  const requiredNoteCoverage = asObject(coverage.required_notes);
  const requiredViewCoverage = asObject(coverage.required_views);

  return {
    decision: semanticQuality.decision || 'unknown',
    advisory_decision: semanticQuality.advisory_decision || 'unknown',
    enforceable: semanticQuality.enforceable === true,
    score: finiteNumberOrNull(semanticQuality.score),
    critical_features_total: Number(semanticQuality.critical_features_total || 0),
    critical_features_covered: Number(semanticQuality.critical_features_covered || 0),
    required_dimensions_total: Number(semanticQuality.required_dimensions_total || 0),
    required_dimensions_present: Number(semanticQuality.required_dimensions_present || 0),
    missing_required_dimensions: uniqueStrings(semanticQuality.missing_required_dimensions || []),
    required_notes_missing: uniqueStrings(semanticQuality.required_notes_missing || []),
    required_views_missing: uniqueStrings(semanticQuality.required_views_missing || []),
    traceability: {
      required_dimensions_total: Number(semanticQuality.traceability?.required_dimensions_total || 0),
      linked_required_dimensions: Number(semanticQuality.traceability?.linked_required_dimensions || 0),
      missing_required_dimensions: uniqueStrings(semanticQuality.traceability?.missing_required_dimensions || []),
      unknown_required_dimensions: uniqueStrings(semanticQuality.traceability?.unknown_required_dimensions || []),
    },
    missing_critical_information: uniqueStrings(semanticQuality.missing_critical_information || []),
    required_blockers: uniqueStrings(semanticQuality.required_blockers || []),
    optional_missing_information: uniqueStrings(semanticQuality.optional_missing_information || []),
    suggested_actions: uniqueStrings(semanticQuality.suggested_actions || []),
    suggested_action_details: summarizeSuggestedActionDetails(semanticQuality.suggested_action_details),
    extracted_evidence: {
      status: extractedEvidence.status || 'not_run',
      advisory_only: extractedEvidence.advisory_only !== false,
      file: safeString(extractedEvidence.file),
      path: safeString(extractedEvidence.path),
      sources: asArray(extractedEvidence.sources),
      coverage: {
        required_dimensions: {
          total: Number(requiredDimensionCoverage.total || 0),
          extracted: Number(requiredDimensionCoverage.extracted || 0),
          missing: Number(requiredDimensionCoverage.missing || 0),
          unknown: Number(requiredDimensionCoverage.unknown || 0),
          unsupported: Number(requiredDimensionCoverage.unsupported || 0),
          extracted_percent: finiteNumberOrNull(requiredDimensionCoverage.extracted_percent),
        },
        required_notes: {
          total: Number(requiredNoteCoverage.total || 0),
          extracted: Number(requiredNoteCoverage.extracted || 0),
          missing: Number(requiredNoteCoverage.missing || 0),
          unknown: Number(requiredNoteCoverage.unknown || 0),
          unsupported: Number(requiredNoteCoverage.unsupported || 0),
          extracted_percent: finiteNumberOrNull(requiredNoteCoverage.extracted_percent),
        },
        required_views: {
          total: Number(requiredViewCoverage.total || 0),
          extracted: Number(requiredViewCoverage.extracted || 0),
          missing: Number(requiredViewCoverage.missing || 0),
          unknown: Number(requiredViewCoverage.unknown || 0),
          unsupported: Number(requiredViewCoverage.unsupported || 0),
          extracted_percent: finiteNumberOrNull(requiredViewCoverage.extracted_percent),
        },
        total_required: Number(coverage.total_required || 0),
        total_extracted: Number(coverage.total_extracted || 0),
        total_missing: Number(coverage.total_missing || 0),
        total_unknown: Number(coverage.total_unknown || 0),
        total_unsupported: Number(coverage.total_unsupported || 0),
      },
      required_dimensions: summarizeRequiredEvidence(extractedEvidence.required_dimensions),
      required_notes: summarizeRequiredEvidence(extractedEvidence.required_notes),
      required_views: summarizeRequiredEvidence(extractedEvidence.required_views),
      unmatched_dimensions: summarizeUnmatchedEvidence(extractedEvidence.unmatched_dimensions),
      unmatched_notes: summarizeUnmatchedEvidence(extractedEvidence.unmatched_notes),
      matched_required_dimensions: Number(extractedEvidence.matched_required_dimensions || 0),
      matched_required_notes: Number(extractedEvidence.matched_required_notes || 0),
      matched_required_views: Number(extractedEvidence.matched_required_views || 0),
      missing_required_items: uniqueStrings(extractedEvidence.missing_required_items || []),
      unknowns: uniqueStrings(extractedEvidence.unknowns || []),
      limitations: uniqueStrings(extractedEvidence.limitations || []),
      suggested_actions: uniqueStrings(extractedEvidence.suggested_actions || []),
      suggested_action_details: summarizeSuggestedActionDetails(extractedEvidence.suggested_action_details),
    },
  };
}

function summarizeDrawingQuality(drawingQuality) {
  if (!drawingQuality || typeof drawingQuality !== 'object') {
    return {
      available: false,
      status: 'not_available',
      score: null,
      missing_required_dimensions: [],
      conflict_count: 0,
      overlap_count: 0,
      traceability_coverage_percent: null,
      semantic_quality: summarizeSemanticDrawingQuality(null),
      layout_readability: summarizeLayoutReadability(null),
      reviewer_feedback: summarizeReviewerFeedback(null),
      recommended_actions: [],
      blocking_issues: [],
      warnings: [],
    };
  }

  const semanticQuality = summarizeSemanticDrawingQuality(drawingQuality.semantic_quality);
  const reviewerFeedback = summarizeReviewerFeedback(drawingQuality.reviewer_feedback);

  return {
    available: true,
    status: drawingQuality.status || 'warning',
    score: Number.isFinite(Number(drawingQuality.score)) ? Number(drawingQuality.score) : null,
    missing_required_dimensions: uniqueStrings(drawingQuality.dimensions?.missing_required_intents || []),
    conflict_count: Number.isFinite(Number(drawingQuality.dimensions?.conflict_count))
      ? Number(drawingQuality.dimensions.conflict_count)
      : 0,
    overlap_count: Number.isFinite(Number(drawingQuality.views?.overlap_count))
      ? Number(drawingQuality.views.overlap_count)
      : 0,
    traceability_coverage_percent: Number.isFinite(Number(drawingQuality.traceability?.coverage_percent))
      ? Number(drawingQuality.traceability.coverage_percent)
      : null,
    semantic_quality: semanticQuality,
    layout_readability: summarizeLayoutReadability(drawingQuality.layout_readability),
    reviewer_feedback: reviewerFeedback,
    recommended_actions: uniqueStrings([
      ...(drawingQuality.recommended_actions || []),
      ...semanticQuality.suggested_actions,
      ...reviewerFeedback.suggested_actions,
    ]),
    blocking_issues: uniqueStrings((drawingQuality.blocking_issues || []).map((issue) => (
      typeof issue === 'string' ? issue : issue?.message
    ))),
    warnings: uniqueStrings(drawingQuality.warnings || []),
  };
}

function summarizeLayoutReadability(layoutReadability) {
  if (!layoutReadability || typeof layoutReadability !== 'object') {
    return {
      status: 'not_evaluated',
      score: null,
      confidence: null,
      advisory_only: true,
      evidence_state: 'missing',
      completeness_state: 'missing',
      summary: 'Layout/readability scoring was not evaluated.',
      finding_count: 0,
      warning_count: 0,
      findings: [],
      provenance: null,
    };
  }

  return {
    status: safeString(layoutReadability.status, 'not_evaluated'),
    score: finiteNumberOrNull(layoutReadability.score),
    confidence: safeString(layoutReadability.confidence),
    advisory_only: layoutReadability.advisory_only !== false,
    evidence_state: safeString(layoutReadability.evidence_state),
    completeness_state: safeString(layoutReadability.completeness_state),
    summary: safeString(layoutReadability.summary),
    finding_count: Number.isFinite(Number(layoutReadability.finding_count))
      ? Number(layoutReadability.finding_count)
      : asArray(layoutReadability.findings).length,
    warning_count: Number.isFinite(Number(layoutReadability.warning_count))
      ? Number(layoutReadability.warning_count)
      : asArray(layoutReadability.findings).filter((entry) => entry?.severity === 'warning').length,
    findings: asArray(layoutReadability.findings)
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        type: safeString(entry.type),
        severity: safeString(entry.severity),
        message: safeString(entry.message),
        recommendation: safeString(entry.recommendation),
        view_ids: uniqueStrings(entry.view_ids || []),
        element_ids: uniqueStrings(entry.element_ids || []),
        labels: uniqueStrings(entry.labels || []),
        raw_source: entry.raw_source && typeof entry.raw_source === 'object' ? entry.raw_source : null,
        source_kind: safeString(entry.source_kind),
        source_artifact: safeString(entry.source_artifact),
        source_ref: safeString(entry.source_ref),
        evidence_state: safeString(entry.evidence_state),
        completeness_state: safeString(entry.completeness_state),
        advisory_only: entry.advisory_only !== false,
        provenance: entry.provenance && typeof entry.provenance === 'object' ? entry.provenance : null,
      })),
    provenance: layoutReadability.provenance && typeof layoutReadability.provenance === 'object'
      ? layoutReadability.provenance
      : null,
  };
}

function summarizeDfm(dfm) {
  if (!dfm || typeof dfm !== 'object') {
    return {
      available: false,
      status: 'not_run',
      score: null,
      severity_counts: {
        critical: 0,
        major: 0,
        minor: 0,
        info: 0,
      },
      top_fixes: [],
      blocking_issues: [],
      warnings: [],
    };
  }

  const summaryCounts = dfm.summary?.severity_counts || {};
  const issues = Array.isArray(dfm.issues) ? dfm.issues : [];
  const severityCounts = {
    critical: Number(summaryCounts.critical || 0),
    major: Number(summaryCounts.major || 0),
    minor: Number(summaryCounts.minor || 0),
    info: Number(summaryCounts.info || 0),
  };
  if (!issues.length && Array.isArray(dfm.checks)) {
    for (const check of dfm.checks) {
      if (check?.severity === 'error') severityCounts.critical += 1;
      else if (check?.severity === 'warning') severityCounts.major += 1;
      else if (check?.severity === 'info') severityCounts.info += 1;
    }
  }

  const topFixes = (dfm.summary?.top_fixes || issues)
    .map((entry) => entry?.suggested_fix || entry?.message)
    .filter(Boolean)
    .slice(0, 5);

  const blockingIssues = issues
    .filter((issue) => issue?.severity === 'critical')
    .map((issue) => issue?.message || issue?.rule_name || issue?.rule_id)
    .filter(Boolean);
  const warnings = issues
    .filter((issue) => issue?.severity === 'major')
    .map((issue) => issue?.message || issue?.rule_name || issue?.rule_id)
    .filter(Boolean);

  const status = severityCounts.critical > 0
    ? 'fail'
    : severityCounts.major > 0
      ? 'warning'
      : 'pass';

  return {
    available: true,
    status,
    score: Number.isFinite(Number(dfm.score)) ? Number(dfm.score) : null,
    severity_counts: severityCounts,
    top_fixes: uniqueStrings(topFixes),
    blocking_issues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
  };
}

function summarizeFem(fem) {
  const femPayload = fem?.fem && typeof fem.fem === 'object' ? fem.fem : fem;
  if (!femPayload || typeof femPayload !== 'object') {
    return {
      available: false,
      status: 'not_available',
      score: null,
      mesh_convergence_checked: null,
      blocking_issues: [],
      warnings: [],
    };
  }

  const convergenceChecked = femPayload.mesh?.convergence_checked
    ?? femPayload.mesh?.mesh_convergence_checked
    ?? femPayload.results?.mesh_convergence_checked
    ?? null;
  const warnings = [];
  if (convergenceChecked !== true) {
    warnings.push('FEM mesh convergence was not checked.');
  }

  return {
    available: true,
    status: warnings.length > 0 ? 'warning' : 'pass',
    score: null,
    mesh_convergence_checked: convergenceChecked === true,
    blocking_issues: [],
    warnings,
  };
}

function summarizeTolerance(tolerance, toleranceSuccessThreshold) {
  if (!tolerance || typeof tolerance !== 'object') {
    return {
      available: false,
      status: 'not_available',
      score: null,
      success_rate_pct: null,
      blocking_issues: [],
      warnings: [],
    };
  }

  const successRate = Number.isFinite(Number(tolerance.stack_up?.success_rate_pct))
    ? Number(tolerance.stack_up.success_rate_pct)
    : null;
  const blockingIssues = [];
  const warnings = [];

  if (successRate !== null && successRate < toleranceSuccessThreshold) {
    blockingIssues.push(
      `Tolerance success rate ${roundNumber(successRate)}% is below the required ${roundNumber(toleranceSuccessThreshold)}%.`
    );
  } else if (successRate === null) {
    warnings.push('Tolerance success rate is unavailable.');
  }

  return {
    available: true,
    status: blockingIssues.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    score: successRate,
    success_rate_pct: successRate,
    blocking_issues: blockingIssues,
    warnings,
  };
}

function deriveArtifactStatus(pathValue, loadedValue, { generated = false, inMemory = false } = {}) {
  if (generated) return 'generated';
  if (loadedValue) return 'available';
  if (inMemory) return 'in_memory';
  return pathValue ? 'not_available' : 'not_run';
}

function aggregateScore(surfaces) {
  const numericScores = [
    surfaces.drawing_quality.score,
    surfaces.dfm.score,
    surfaces.tolerance.success_rate_pct,
  ].filter((value) => Number.isFinite(value));
  if (numericScores.length < 2) return null;
  return roundNumber(numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length, 1);
}

function escalateStatus(current, next) {
  const order = {
    pass: 0,
    warning: 1,
    incomplete: 2,
    fail: 3,
  };
  return order[next] > order[current] ? next : current;
}

function renderTopRisks(surfaces, criticalInputsMissing = []) {
  const risks = [];
  if (criticalInputsMissing.includes('create_quality')) {
    risks.push('Create quality data is not available, so geometry readiness cannot be confirmed.');
  }
  if (criticalInputsMissing.includes('drawing_quality')) {
    risks.push('Drawing quality data is not available, so drawing readiness cannot be confirmed.');
  }
  if (criticalInputsMissing.includes('dfm')) {
    risks.push('DFM data is not available, so manufacturability readiness cannot be confirmed.');
  }
  if (surfaces.create_quality.invalid_shape) {
    risks.push('Generated model shape is invalid.');
  }
  if (surfaces.drawing_quality.missing_required_dimensions.length > 0) {
    risks.push(`Missing required drawing dimensions: ${surfaces.drawing_quality.missing_required_dimensions.join(', ')}.`);
  }
  if (surfaces.drawing_quality.conflict_count > 0) {
    risks.push(`Drawing dimension conflicts detected: ${surfaces.drawing_quality.conflict_count}.`);
  }
  if (surfaces.drawing_quality.overlap_count > 0) {
    risks.push(`Drawing view/layout overlaps detected: ${surfaces.drawing_quality.overlap_count}.`);
  }
  if (surfaces.drawing_quality.semantic_quality.enforceable && surfaces.drawing_quality.semantic_quality.required_blockers.length > 0) {
    risks.push(...surfaces.drawing_quality.semantic_quality.required_blockers);
  } else if (surfaces.drawing_quality.semantic_quality.missing_critical_information.length > 0) {
    risks.push('Drawing intent has advisory missing required semantic evidence.');
  }
  if (Number(surfaces.drawing_quality.reviewer_feedback.unresolved_count || 0) > 0) {
    risks.push(`Open reviewer feedback items remain: ${surfaces.drawing_quality.reviewer_feedback.unresolved_count}.`);
  }
  if (['partial', 'invalid', 'unsupported'].includes(surfaces.drawing_quality.reviewer_feedback.status)) {
    risks.push(surfaces.drawing_quality.reviewer_feedback.summary || 'Reviewer feedback input needs review.');
  }
  if ((surfaces.dfm.severity_counts?.critical || 0) > 0) {
    risks.push(`DFM critical findings: ${surfaces.dfm.severity_counts.critical}.`);
  }
  if ((surfaces.dfm.severity_counts?.major || 0) > 0) {
    risks.push(`DFM major findings: ${surfaces.dfm.severity_counts.major}.`);
  }
  if (surfaces.fem.available && surfaces.fem.mesh_convergence_checked !== true) {
    risks.push('FEM mesh convergence was not checked.');
  }
  if (surfaces.tolerance.available && surfaces.tolerance.status === 'fail') {
    risks.push(...surfaces.tolerance.blocking_issues);
  }
  return uniqueStrings(risks).slice(0, 5);
}

function renderRecommendedActions(surfaces, criticalInputsMissing = []) {
  const actions = [];
  if (criticalInputsMissing.includes('create_quality')) {
    actions.push('Generate or attach the create quality report before making a readiness decision.');
  }
  if (criticalInputsMissing.includes('drawing_quality')) {
    actions.push('Generate or attach the drawing quality report before making a readiness decision.');
  }
  if (criticalInputsMissing.includes('dfm')) {
    actions.push('Run DFM or attach structured DFM findings before making a readiness decision.');
  }
  if (surfaces.create_quality.invalid_shape) {
    actions.push('Repair the generated model geometry before proceeding to manufacturing review.');
  }
  actions.push(...surfaces.drawing_quality.recommended_actions);
  actions.push(...surfaces.dfm.top_fixes);
  if (surfaces.fem.available && surfaces.fem.mesh_convergence_checked !== true) {
    actions.push('Run or document FEM mesh convergence before relying on structural conclusions.');
  }
  if (surfaces.tolerance.available && surfaces.tolerance.status === 'fail') {
    actions.push('Improve the tolerance stack-up or lower variation before manufacturing review.');
  }
  return uniqueStrings(actions).slice(0, 5);
}

export function buildDecisionReportSummary({
  configPath = null,
  config = {},
  reportPdfPath = null,
  reportGeneratedAt = null,
  repoContext = null,
  runtimeInfo = null,
  artifactPaths = {},
  createQuality = null,
  drawingQuality = null,
  createManifest = null,
  drawingManifest = null,
  extractedDrawingSemantics = null,
  featureCatalog = null,
  reportManifest = null,
  dfm = null,
  fem = null,
  tolerance = null,
} = {}) {
  const thresholds = {
    ...DEFAULT_REPORT_THRESHOLDS,
    ...(config?.tolerance?.review_threshold_pct ? { tolerance_success_rate_pct: config.tolerance.review_threshold_pct } : {}),
  };
  const paths = {
    ...deriveReportArtifactPaths({ primaryOutputPath: reportPdfPath, configName: config?.name }),
    ...(artifactPaths || {}),
  };

  const surfaces = {
    create_quality: summarizeCreateQuality(createQuality),
    drawing_quality: summarizeDrawingQuality(drawingQuality),
    dfm: summarizeDfm(dfm),
    fem: summarizeFem(fem),
    tolerance: summarizeTolerance(tolerance, thresholds.tolerance_success_rate_pct),
  };
  const drawingIntent = getDrawingIntent(config);

  let overallStatus = 'pass';
  let readyForManufacturingReview = true;
  const blockingIssues = [];
  const warnings = [];
  const criticalInputsMissing = [];

  if (!surfaces.create_quality.available) criticalInputsMissing.push('create_quality');
  if (!surfaces.drawing_quality.available) criticalInputsMissing.push('drawing_quality');
  if (!surfaces.dfm.available) criticalInputsMissing.push('dfm');
  if (criticalInputsMissing.length > 0) {
    overallStatus = escalateStatus(overallStatus, 'incomplete');
    readyForManufacturingReview = null;
    warnings.push(...criticalInputsMissing.map((key) => `${key.replaceAll('_', ' ')} data is not available.`));
  }

  if (surfaces.create_quality.invalid_shape) {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
    blockingIssues.push(...surfaces.create_quality.blocking_issues);
  }

  if (
    surfaces.drawing_quality.missing_required_dimensions.length > 0
    || surfaces.drawing_quality.conflict_count > 0
    || surfaces.drawing_quality.overlap_count > 0
    || surfaces.drawing_quality.status === 'fail'
    || (
      surfaces.drawing_quality.semantic_quality.enforceable
      && surfaces.drawing_quality.semantic_quality.required_blockers.length > 0
    )
  ) {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
    blockingIssues.push(
      ...surfaces.drawing_quality.blocking_issues,
      ...surfaces.drawing_quality.semantic_quality.required_blockers,
    );
  }

  if ((surfaces.dfm.severity_counts.critical || 0) > 0 || surfaces.dfm.status === 'fail') {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
    blockingIssues.push(...surfaces.dfm.blocking_issues);
  } else if ((surfaces.dfm.severity_counts.major || 0) > 0) {
    overallStatus = escalateStatus(overallStatus, 'warning');
    readyForManufacturingReview = readyForManufacturingReview === null ? null : false;
    warnings.push(...surfaces.dfm.warnings);
  }

  if (surfaces.fem.available && surfaces.fem.mesh_convergence_checked !== true) {
    overallStatus = escalateStatus(overallStatus, 'warning');
    warnings.push(...surfaces.fem.warnings);
  }

  if (surfaces.tolerance.available && surfaces.tolerance.status === 'fail') {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
    blockingIssues.push(...surfaces.tolerance.blocking_issues);
  } else if (surfaces.tolerance.available && surfaces.tolerance.status === 'warning') {
    overallStatus = escalateStatus(overallStatus, 'warning');
    warnings.push(...surfaces.tolerance.warnings);
  }

  const runId = preferManifestValue(
    reportManifest?.run_id,
    createManifest?.run_id,
    drawingManifest?.run_id
  );
  const gitCommit = preferManifestValue(
    reportManifest?.repo?.head_sha,
    createManifest?.repo?.head_sha,
    drawingManifest?.repo?.head_sha,
    repoContext?.headSha
  );
  const gitBranch = preferManifestValue(
    reportManifest?.repo?.branch,
    createManifest?.repo?.branch,
    drawingManifest?.repo?.branch,
    repoContext?.branch
  );
  const reviewerFeedbackPath = safeString(surfaces.drawing_quality.reviewer_feedback.path);

  const artifactsReferenced = [
    artifactRef('report_pdf', 'Engineering report PDF', paths.report_pdf, 'generated'),
    artifactRef('report_summary_json', 'Report summary JSON', paths.report_summary_json, 'generated'),
    artifactRef(
      'create_quality',
      'Create quality JSON',
      paths.create_quality,
      deriveArtifactStatus(paths.create_quality, createQuality),
    ),
    artifactRef(
      'drawing_quality',
      'Drawing quality JSON',
      paths.drawing_quality,
      deriveArtifactStatus(paths.drawing_quality, drawingQuality),
    ),
    artifactRef(
      'dfm',
      'DFM analysis',
      null,
      deriveArtifactStatus(null, null, { inMemory: Boolean(dfm) }),
    ),
    artifactRef(
      'fem',
      'FEM analysis',
      null,
      deriveArtifactStatus(null, null, { inMemory: Boolean(fem) }),
    ),
    artifactRef(
      'tolerance',
      'Tolerance analysis',
      paths.tolerance_csv,
      tolerance ? 'in_memory' : 'not_available',
    ),
    artifactRef(
      'traceability_json',
      'Drawing traceability JSON',
      paths.traceability_json,
      deriveArtifactStatus(paths.traceability_json, drawingQuality?.traceability_file),
    ),
    artifactRef(
      'extracted_drawing_semantics',
      'Extracted drawing semantics JSON',
      paths.extracted_drawing_semantics,
      deriveArtifactStatus(paths.extracted_drawing_semantics, extractedDrawingSemantics),
      'Advisory extraction from generated drawing evidence only.',
      { required: false },
    ),
    artifactRef(
      'create_manifest',
      'Create output manifest',
      paths.create_manifest,
      deriveArtifactStatus(paths.create_manifest, createManifest),
    ),
    artifactRef(
      'drawing_manifest',
      'Drawing output manifest',
      paths.drawing_manifest,
      deriveArtifactStatus(paths.drawing_manifest, drawingManifest),
    ),
    ...(drawingIntent
      ? [artifactRef(
          'drawing_intent',
          'Drawing intent JSON',
          paths.drawing_intent,
          deriveArtifactStatus(paths.drawing_intent, drawingIntent, { inMemory: true }),
          'Drawing intent is optional semantic metadata.',
          { required: false },
        )]
      : []),
    ...(featureCatalog
      ? [artifactRef(
          'feature_catalog',
          'Conservative feature catalog JSON',
          paths.feature_catalog,
          deriveArtifactStatus(paths.feature_catalog, featureCatalog),
          'Feature recognition is conservative and evidence-scoped.',
          { required: false },
        )]
      : []),
    artifactRef(
      'report_manifest',
      'Report output manifest',
      paths.report_manifest,
      deriveArtifactStatus(paths.report_manifest, reportManifest, { generated: Boolean(paths.report_manifest) }),
    ),
  ];

  const missingOptionalArtifacts = artifactsReferenced
    .filter((artifact) => OPTIONAL_ARTIFACT_KEYS.has(artifact.key) && artifact.status === 'not_available')
    .map((artifact) => artifact.key);

  const summary = {
    schema_version: REPORT_SUMMARY_SCHEMA_VERSION,
    command: 'report',
    input_config: safeString(configPath),
    report_pdf: resolve(paths.report_pdf),
    report_summary_json: resolve(paths.report_summary_json),
    overall_status: overallStatus,
    overall_score: aggregateScore(surfaces),
    ready_for_manufacturing_review: readyForManufacturingReview,
    config_name: safeFilenameComponent(config?.name, 'report'),
    run_id: runId,
    git_commit: gitCommit,
    git_branch: gitBranch,
    generated_at: reportGeneratedAt || new Date().toISOString(),
    runtime_status: {
      mode: runtimeInfo?.mode ?? null,
      available: Boolean(runtimeInfo?.available ?? runtimeInfo?.mode),
    },
    inputs_consumed: [
      artifactRef('config', 'Input config', configPath, configPath ? 'available' : 'not_run'),
      ...(reviewerFeedbackPath && ['available', 'partial', 'invalid'].includes(surfaces.drawing_quality.reviewer_feedback.status)
        ? [artifactRef('reviewer_feedback_json', 'Reviewer feedback JSON', reviewerFeedbackPath, 'available', 'Explicit reviewer feedback remains advisory-only.', { required: false })]
        : []),
      artifactRef('dfm_input', 'In-memory DFM results', null, dfm ? 'in_memory' : 'not_run'),
      artifactRef('fem_input', 'In-memory FEM results', null, fem ? 'in_memory' : 'not_run'),
      artifactRef('tolerance_input', 'In-memory tolerance results', null, tolerance ? 'in_memory' : 'not_run'),
    ],
    artifacts_referenced: artifactsReferenced,
    blocking_issues: uniqueStrings(blockingIssues),
    warnings: uniqueStrings(warnings),
    recommended_actions: renderRecommendedActions(surfaces, criticalInputsMissing),
    missing_optional_artifacts: uniqueStrings(missingOptionalArtifacts),
    top_risks: renderTopRisks(surfaces, criticalInputsMissing),
    surfaces,
    ...(drawingIntent ? { drawing_intent: drawingIntent } : {}),
    ...(featureCatalog
      ? {
          feature_catalog: {
            path: resolve(paths.feature_catalog),
            available: true,
            total_features: Number(featureCatalog.summary?.total_features || 0),
            recognized_features: Number(featureCatalog.summary?.recognized_features || 0),
            unknown_features: Number(featureCatalog.summary?.unknown_features || 0),
            recognition_policy: featureCatalog.recognition_policy || null,
          },
        }
      : {}),
  };

  return summary;
}

export function validateDecisionReportSummary(summary) {
  const valid = validateSummary(summary);
  return {
    ok: Boolean(valid),
    errors: valid ? [] : formatSchemaErrors(validateSummary.errors || []),
  };
}

export async function writeDecisionReportSummary(summaryPath, summary) {
  const validation = validateDecisionReportSummary(summary);
  if (!validation.ok) {
    throw new Error(`Invalid report summary: ${validation.errors.join(' | ')}`);
  }
  const resolvedPath = resolve(summaryPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

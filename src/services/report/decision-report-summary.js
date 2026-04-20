import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

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
  'report_manifest',
  'traceability_json',
]);

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
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

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function artifactRef(key, label, path, status, note = null) {
  return {
    key,
    label,
    path: path ? resolve(path) : null,
    status,
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
    drawing_manifest: join(dir, `${baseStem}_drawing_manifest.json`),
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
      recommended_actions: [],
      blocking_issues: [],
      warnings: [],
    };
  }

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
    recommended_actions: uniqueStrings(drawingQuality.recommended_actions || []),
    blocking_issues: uniqueStrings((drawingQuality.blocking_issues || []).map((issue) => (
      typeof issue === 'string' ? issue : issue?.message
    ))),
    warnings: uniqueStrings(drawingQuality.warnings || []),
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
  ) {
    overallStatus = 'fail';
    readyForManufacturingReview = false;
    blockingIssues.push(...surfaces.drawing_quality.blocking_issues);
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

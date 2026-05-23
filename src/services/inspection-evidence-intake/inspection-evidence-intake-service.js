import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateInspectionEvidence } from '../../../lib/inspection-evidence.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';

const execFile = promisify(execFileCallback);

const REPORT_SCHEMA_VERSION = '1.0';

const GENERATED_PATH_PATTERNS = Object.freeze([
  /(^|\/)[^/]*_create_quality\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_quality\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_qa\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_drawing_intent\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_feature_catalog\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)[^/]*_dfm_report\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)(?:review_pack|review-pack)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i,
  /(^|\/)(?:readiness_report|readiness-report)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i,
  /(^|\/)standard_docs_manifest\.(?:json|csv|tsv|md|markdown|txt)$/i,
  /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i,
  /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i,
  /(^|\/)(?:artifact-manifest|output-manifest)\.(?:json|csv|tsv|md|markdown|txt)$/i,
]);

const EVIDENCE_PATH_PATTERNS = Object.freeze([
  /inspection[-_]?evidence/i,
  /(^|\/)inspection\//i,
  /cmm/i,
  /caliper/i,
  /(^|[-_/])gauge([-_/]|$)/i,
  /first[-_ ]?article/i,
  /supplier[-_ ]?inspection/i,
]);

const NON_GENUINE_TEXT_PATTERN = /synthetic|fixture|template|collection guide|generated|not readiness evidence|not package readiness evidence/i;

const TABLE_HEADER_ALIASES = Object.freeze({
  schema_version: ['schema_version', 'schema', 'contract_version'],
  evidence_type: ['evidence_type', 'record_type', 'type'],
  source_type: ['source_type', 'inspection_source_type', 'inspection_type', 'report_type'],
  inspected_part: ['inspected_part', 'part', 'part_id', 'part_number', 'part_name'],
  package_id: ['package_id', 'package', 'package_slug'],
  inspected_at: ['inspected_at', 'inspection_timestamp', 'inspection_time', 'completed_at'],
  inspection_date: ['inspection_date', 'date', 'inspected_date'],
  measurement_system: ['measurement_system', 'system'],
  units: ['units', 'unit'],
  source_ref: ['source_ref', 'source_file', 'source_path', 'provenance', 'provenance_path'],
  overall_result: ['overall_result', 'overall_status', 'overall_disposition', 'inspection_result'],
  inspector: ['inspector', 'inspection_author', 'author'],
  feature_id: ['feature_id', 'feature', 'feature_name', 'characteristic', 'characteristic_id', 'dimension_id'],
  drawing_ref: ['drawing_ref', 'drawing', 'drawing_reference'],
  requirement_ref: ['requirement_ref', 'requirement', 'requirement_reference', 'spec_ref'],
  nominal_value: ['nominal_value', 'nominal', 'target', 'target_value'],
  measured_value: ['measured_value', 'measurement', 'measured', 'actual', 'actual_value', 'observed_value'],
  tolerance_upper: ['tolerance_upper', 'upper_tolerance', 'upper_tol', 'tol_plus', 'plus_tolerance'],
  tolerance_lower: ['tolerance_lower', 'lower_tolerance', 'lower_tol', 'tol_minus', 'minus_tolerance'],
  feature_units: ['feature_units', 'feature_unit'],
  result: ['result', 'feature_result', 'status', 'disposition'],
  measurement_method: ['measurement_method', 'method', 'inspection_method', 'instrument', 'gauge'],
});

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRepoPath(pathValue) {
  return String(pathValue || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function isGeneratedArtifactPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  return GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isEvidencePathCandidate(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (!normalized || normalized.startsWith('.git/') || normalized.includes('/node_modules/')) return false;
  if (isGeneratedArtifactPath(normalized)) return true;
  return EVIDENCE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function packageSlugFromPath(relativePath, packageSlugs = []) {
  const normalized = normalizeRepoPath(relativePath);
  const match = normalized.match(/^docs\/examples\/([^/]+)\//);
  if (match && packageSlugs.includes(match[1])) return match[1];
  const guideMatch = normalized.match(/^docs\/inspection-evidence-collection\/([^/.]+)\.md$/);
  if (guideMatch && packageSlugs.includes(guideMatch[1])) return guideMatch[1];
  return null;
}

function isPackageInspectionPath(relativePath, slug) {
  return normalizeRepoPath(relativePath).startsWith(`docs/examples/${slug}/inspection/`);
}

async function pathExists(projectRoot, relativePath) {
  try {
    await stat(resolve(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPossible(projectRoot, relativePath) {
  try {
    const raw = await readFile(resolve(projectRoot, relativePath), 'utf8');
    return {
      ok: true,
      raw,
      document: JSON.parse(raw),
    };
  } catch (error) {
    return {
      ok: false,
      raw: null,
      document: null,
      error,
    };
  }
}

async function readTextIfPossible(projectRoot, relativePath) {
  try {
    const raw = await readFile(resolve(projectRoot, relativePath), 'utf8');
    return {
      ok: true,
      raw,
    };
  } catch (error) {
    return {
      ok: false,
      raw: null,
      error,
    };
  }
}

function sourceFormatForPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath).toLowerCase();
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.csv')) return 'csv';
  if (normalized.endsWith('.tsv')) return 'tsv';
  if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) return 'markdown_table';
  return 'unknown';
}

function normalizeTableHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseDelimitedRows(raw, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => String(cell || '').trim())) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => String(cell || '').trim())) rows.push(row);
  return rows;
}

function splitMarkdownRow(line) {
  const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let field = '';
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      field += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(field.trim());
      field = '';
      continue;
    }
    field += char;
  }
  cells.push(field.trim());
  return cells;
}

function isMarkdownSeparatorRow(cells = []) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell || '').trim()));
}

function parseMarkdownTableRows(raw) {
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !lines[index + 1].includes('|')) continue;
    const header = splitMarkdownRow(lines[index]);
    const separator = splitMarkdownRow(lines[index + 1]);
    if (!isMarkdownSeparatorRow(separator)) continue;

    const rows = [header];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      if (!line.includes('|')) break;
      const cells = splitMarkdownRow(line);
      if (isMarkdownSeparatorRow(cells)) continue;
      if (cells.some((cell) => String(cell || '').trim())) rows.push(cells);
    }
    return rows;
  }
  return [];
}

function tableMatrixToRows(matrix = []) {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeTableHeader);
  return matrix.slice(1).map((cells) => headers.reduce((row, header, index) => {
    if (header) row[header] = String(cells[index] ?? '').trim();
    return row;
  }, {})).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

function tableValue(row, aliases = []) {
  for (const alias of aliases) {
    const key = normalizeTableHeader(alias);
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstTableValue(rows = [], aliases = []) {
  for (const row of rows) {
    const value = tableValue(row, aliases);
    if (value !== null) return value;
  }
  return null;
}

function parseNumericValue(value) {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  const numberPattern = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
  if (!numberPattern.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : undefined;
}

function parseMeasuredValue(value) {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
  return parseNumericValue(trimmed) ?? trimmed;
}

function normalizeSourceType(value) {
  const normalized = normalizeTableHeader(value);
  if (!normalized) return null;
  if (normalized === 'cmm' || normalized === 'cmm_report') return 'cmm_report';
  if (normalized === 'caliper' || normalized === 'manual_caliper' || normalized === 'manual_caliper_check') return 'manual_caliper_check';
  if (normalized === 'gauge' || normalized === 'go_no_go' || normalized === 'go_no_go_gauge') return 'go_no_go_gauge';
  if (normalized === 'first_article' || normalized === 'first_article_inspection' || normalized === 'fai') return 'first_article_inspection';
  if (normalized === 'supplier' || normalized === 'supplier_inspection' || normalized === 'supplier_inspection_report') return 'supplier_inspection_report';
  if (normalized === 'other' || normalized === 'other_inspection_source') return 'other_inspection_source';
  return normalized;
}

function normalizeOverallResult(value) {
  const normalized = normalizeTableHeader(value);
  if (!normalized) return null;
  if (['pass', 'passed', 'ok', 'accepted', 'accept'].includes(normalized)) return 'pass';
  if (['fail', 'failed', 'ng', 'rejected', 'reject'].includes(normalized)) return 'fail';
  if (['partial', 'partially_passed'].includes(normalized)) return 'partial';
  if (['unknown', 'undetermined'].includes(normalized)) return 'unknown';
  return normalized;
}

function normalizeFeatureResult(value) {
  const normalized = normalizeTableHeader(value);
  if (!normalized) return null;
  if (['pass', 'passed', 'ok', 'accepted', 'accept', 'in_tolerance'].includes(normalized)) return 'pass';
  if (['fail', 'failed', 'ng', 'rejected', 'reject', 'out_of_tolerance'].includes(normalized)) return 'fail';
  if (['not_measured', 'not_meas', 'not_measured_na', 'not_applicable', 'na', 'n_a'].includes(normalized)) return 'not_measured';
  return normalized;
}

function setIfPresent(target, key, value) {
  if (value !== null && value !== undefined && value !== '') {
    target[key] = value;
  }
}

function normalizeTableEvidenceDocument(rows, relativePath) {
  const document = {};
  const sourceType = normalizeSourceType(firstTableValue(rows, TABLE_HEADER_ALIASES.source_type));
  const overallResult = normalizeOverallResult(firstTableValue(rows, TABLE_HEADER_ALIASES.overall_result));

  setIfPresent(document, 'schema_version', firstTableValue(rows, TABLE_HEADER_ALIASES.schema_version));
  setIfPresent(document, 'evidence_type', firstTableValue(rows, TABLE_HEADER_ALIASES.evidence_type));
  setIfPresent(document, 'source_type', sourceType);
  setIfPresent(document, 'inspected_part', firstTableValue(rows, TABLE_HEADER_ALIASES.inspected_part));
  setIfPresent(document, 'package_id', firstTableValue(rows, TABLE_HEADER_ALIASES.package_id));
  setIfPresent(document, 'inspected_at', firstTableValue(rows, TABLE_HEADER_ALIASES.inspected_at));
  setIfPresent(document, 'inspection_date', firstTableValue(rows, TABLE_HEADER_ALIASES.inspection_date));
  setIfPresent(document, 'measurement_system', firstTableValue(rows, TABLE_HEADER_ALIASES.measurement_system));
  setIfPresent(document, 'units', firstTableValue(rows, TABLE_HEADER_ALIASES.units));
  setIfPresent(document, 'source_ref', firstTableValue(rows, TABLE_HEADER_ALIASES.source_ref) || relativePath);
  setIfPresent(document, 'overall_result', overallResult);
  setIfPresent(document, 'inspector', firstTableValue(rows, TABLE_HEADER_ALIASES.inspector));

  document.measured_features = rows.map((row) => {
    const feature = {};
    const featureId = tableValue(row, TABLE_HEADER_ALIASES.feature_id);
    const measuredValue = parseMeasuredValue(tableValue(row, TABLE_HEADER_ALIASES.measured_value));
    const toleranceUpper = parseNumericValue(tableValue(row, TABLE_HEADER_ALIASES.tolerance_upper));
    const toleranceLower = parseNumericValue(tableValue(row, TABLE_HEADER_ALIASES.tolerance_lower));
    const result = normalizeFeatureResult(tableValue(row, TABLE_HEADER_ALIASES.result));
    const measurementMethod = tableValue(row, TABLE_HEADER_ALIASES.measurement_method) || sourceType;

    setIfPresent(feature, 'feature_id', featureId);
    setIfPresent(feature, 'drawing_ref', tableValue(row, TABLE_HEADER_ALIASES.drawing_ref));
    setIfPresent(feature, 'requirement_ref', tableValue(row, TABLE_HEADER_ALIASES.requirement_ref));
    setIfPresent(feature, 'nominal_value', parseMeasuredValue(tableValue(row, TABLE_HEADER_ALIASES.nominal_value)));
    setIfPresent(feature, 'measured_value', measuredValue);
    setIfPresent(feature, 'tolerance_upper', toleranceUpper);
    setIfPresent(feature, 'tolerance_lower', toleranceLower);
    setIfPresent(feature, 'units', tableValue(row, TABLE_HEADER_ALIASES.feature_units) || document.units);
    setIfPresent(feature, 'result', result);
    setIfPresent(feature, 'measurement_method', measurementMethod);
    return feature;
  }).filter((feature) => Object.keys(feature).length > 0);

  return document;
}

async function parseMachineReadableTableCandidate(projectRoot, relativePath) {
  const sourceFormat = sourceFormatForPath(relativePath);
  if (!['csv', 'tsv', 'markdown_table'].includes(sourceFormat)) {
    return {
      ok: false,
      source_format: sourceFormat,
      document: null,
      errors: ['candidate format is not a supported machine-readable table'],
    };
  }

  const text = await readTextIfPossible(projectRoot, relativePath);
  if (!text.ok) {
    return {
      ok: false,
      source_format: sourceFormat,
      document: null,
      errors: [text.error?.message || 'candidate table could not be read'],
    };
  }

  const matrix = sourceFormat === 'csv'
    ? parseDelimitedRows(text.raw, ',')
    : sourceFormat === 'tsv'
      ? parseDelimitedRows(text.raw, '\t')
      : parseMarkdownTableRows(text.raw);
  const rows = tableMatrixToRows(matrix);
  if (rows.length === 0) {
    return {
      ok: false,
      source_format: sourceFormat,
      document: null,
      errors: ['candidate table has no machine-readable header/data rows'],
    };
  }

  return {
    ok: true,
    source_format: sourceFormat,
    document: normalizeTableEvidenceDocument(rows, relativePath),
    errors: [],
  };
}

async function listTrackedPaths(projectRoot, explicitTrackedPaths = null) {
  if (Array.isArray(explicitTrackedPaths)) {
    return explicitTrackedPaths.map(normalizeRepoPath).filter(Boolean).sort();
  }
  try {
    const { stdout } = await execFile('git', ['ls-files'], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.split(/\r?\n/).map(normalizeRepoPath).filter(Boolean).sort();
  } catch {
    return [];
  }
}

function classifyNonJsonPath(relativePath) {
  const normalized = normalizeRepoPath(relativePath);
  if (normalized.startsWith('docs/inspection-evidence-collection/')) {
    return {
      classification: 'invalid_provenance',
      reasons: ['inspection collection guides are templates/instructions, not completed inspection records'],
      validation_errors: [],
    };
  }
  return {
    classification: 'invalid_schema',
    reasons: ['candidate is not a JSON inspection evidence record'],
    validation_errors: ['candidate is not supported JSON, CSV, TSV, or Markdown-table inspection evidence'],
  };
}

function sourcePathFromDocument(document = {}) {
  return normalizeRepoPath(document.source_ref || document.source_file || '');
}

function documentText(document = {}) {
  return [
    document.notes,
    document.inspected_part,
    document.package_id,
    document.inspector,
    document.inspection_author,
    document.source_ref,
    document.source_file,
  ].filter((value) => typeof value === 'string').join('\n');
}

async function hasGenuineLocalProvenance({
  projectRoot,
  relativePath,
  document,
  packageSlugs,
}) {
  const reasons = [];
  const slug = packageSlugFromPath(relativePath, packageSlugs);
  if (!slug || !isPackageInspectionPath(relativePath, slug)) {
    reasons.push('valid inspection-shaped JSON is not located under a canonical package inspection directory');
  }

  if (/^tests\/fixtures\//.test(relativePath) || /^schemas\//.test(relativePath)) {
    reasons.push('fixtures and schemas are contract references, not genuine completed inspection evidence');
  }

  if (NON_GENUINE_TEXT_PATTERN.test(documentText(document))) {
    reasons.push('document provenance text marks it as synthetic, generated, fixture, template, or guide material');
  }

  const sourcePath = sourcePathFromDocument(document);
  if (!sourcePath) {
    reasons.push('document does not provide a source_ref/source_file provenance path');
  } else if (isGeneratedArtifactPath(sourcePath)) {
    reasons.push('source_ref/source_file points at generated non-inspection output');
  } else if (/^tests\/fixtures\//.test(sourcePath) || /^schemas\//.test(sourcePath)) {
    reasons.push('source_ref/source_file points at fixture or schema material');
  } else if (slug && !isPackageInspectionPath(sourcePath, slug)) {
    reasons.push('source_ref/source_file is not under the same canonical package inspection directory');
  } else if (!(await pathExists(projectRoot, sourcePath)) && sourcePath !== relativePath) {
    reasons.push('source_ref/source_file provenance path was not found in the checkout');
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

async function classifyCandidate({
  projectRoot,
  relativePath,
  packageSlugs,
  sourceKind = 'tracked_repo_file',
}) {
  const normalized = normalizeRepoPath(relativePath);
  const slug = packageSlugFromPath(normalized, packageSlugs);
  const baseCandidate = {
    path: normalized,
    source_kind: sourceKind,
    source_format: sourceFormatForPath(normalized),
    adapter: normalized.toLowerCase().endsWith('.json') ? 'json_contract' : null,
    package_slug: slug,
    classification: null,
    reasons: [],
    validation_errors: [],
    contract_ok: false,
    evidence_type: null,
    source_type: null,
    measured_feature_count: null,
    normalized_source_ref: null,
  };

  if (isGeneratedArtifactPath(normalized)) {
    return {
      ...baseCandidate,
      classification: 'invalid_generated',
      reasons: ['generated CAD, drawing, readiness, review, docs, release, or manifest artifacts are not inspection evidence'],
    };
  }

  if (!normalized.toLowerCase().endsWith('.json')) {
    if (normalized.startsWith('docs/inspection-evidence-collection/')) {
      return {
        ...baseCandidate,
        ...classifyNonJsonPath(normalized),
      };
    }

    const tableCandidate = await parseMachineReadableTableCandidate(projectRoot, normalized);
    const tableBaseCandidate = {
      ...baseCandidate,
      source_format: tableCandidate.source_format,
      adapter: 'machine_readable_table',
    };
    if (!tableCandidate.ok) {
      return {
        ...tableBaseCandidate,
        classification: 'invalid_schema',
        reasons: ['candidate could not be normalized as a CSV, TSV, or Markdown-table inspection evidence record'],
        validation_errors: tableCandidate.errors,
      };
    }

    const document = safeObject(tableCandidate.document);
    const validation = validateInspectionEvidence(document);
    const enriched = {
      ...tableBaseCandidate,
      contract_ok: validation.ok,
      evidence_type: document.evidence_type || document.artifact_type || document.type || null,
      source_type: document.source_type || null,
      measured_feature_count: Array.isArray(document.measured_features) ? document.measured_features.length : null,
      validation_errors: validation.errors,
      normalized_source_ref: document.source_ref || document.source_file || null,
    };

    if (!validation.ok) {
      const generatedError = validation.errors.some((error) => /generated .*artifacts are not inspection evidence|generated artifact path/i.test(error));
      return {
        ...enriched,
        classification: generatedError ? 'invalid_generated' : 'invalid_schema',
        reasons: generatedError
          ? ['candidate is generated/non-inspection output even though it normalized to inspection-shaped table data']
          : ['candidate table does not normalize to the inspection evidence schema/contract'],
      };
    }

    const provenance = await hasGenuineLocalProvenance({
      projectRoot,
      relativePath: normalized,
      document,
      packageSlugs,
    });
    if (!provenance.ok) {
      return {
        ...enriched,
        classification: 'invalid_provenance',
        reasons: provenance.reasons,
      };
    }

    return {
      ...enriched,
      classification: 'genuine_valid',
      reasons: ['machine-readable table normalized to contract-valid completed inspection record with local canonical package provenance'],
    };
  }

  const parsed = await readJsonIfPossible(projectRoot, normalized);
  if (!parsed.ok) {
    return {
      ...baseCandidate,
      classification: 'invalid_schema',
      reasons: ['candidate could not be parsed as JSON inspection evidence'],
      validation_errors: [parsed.error?.message || 'invalid JSON'],
    };
  }

  const document = safeObject(parsed.document);
  const validation = validateInspectionEvidence(document);
  const enriched = {
    ...baseCandidate,
    contract_ok: validation.ok,
    evidence_type: document.evidence_type || document.artifact_type || document.type || null,
    source_type: document.source_type || null,
    measured_feature_count: Array.isArray(document.measured_features) ? document.measured_features.length : null,
    validation_errors: validation.errors,
    normalized_source_ref: document.source_ref || document.source_file || null,
  };

  if (!validation.ok) {
    const generatedError = validation.errors.some((error) => /generated .*artifacts are not inspection evidence|generated artifact path/i.test(error));
    return {
      ...enriched,
      classification: generatedError ? 'invalid_generated' : 'invalid_schema',
      reasons: generatedError
        ? ['candidate is generated/non-inspection output even though it is inspection-shaped']
        : ['candidate does not satisfy the inspection evidence schema/contract'],
    };
  }

  const provenance = await hasGenuineLocalProvenance({
    projectRoot,
    relativePath: normalized,
    document,
    packageSlugs,
  });
  if (!provenance.ok) {
    return {
      ...enriched,
      classification: 'invalid_provenance',
      reasons: provenance.reasons,
    };
  }

  return {
    ...enriched,
    classification: 'genuine_valid',
    reasons: ['contract-valid completed inspection record with local canonical package provenance'],
  };
}

async function readReadinessState(projectRoot, slug) {
  const readinessPath = `docs/examples/${slug}/readiness/readiness_report.json`;
  const parsed = await readJsonIfPossible(projectRoot, readinessPath);
  const summary = safeObject(parsed.document?.readiness_summary);
  const missingInputs = Array.isArray(summary.missing_inputs)
    ? summary.missing_inputs
    : uniqueStrings([
      ...safeList(parsed.document?.review_pack?.uncertainty_coverage_report?.missing_inputs),
      ...safeList(parsed.document?.process_plan?.summary?.missing_inputs),
      ...safeList(parsed.document?.quality_risk?.summary?.missing_inputs),
    ]);
  return {
    status: summary.status || null,
    score: summary.score ?? null,
    gate_decision: summary.gate_decision || null,
    missing_inputs: missingInputs,
    inspection_evidence_missing: missingInputs.includes('inspection_evidence'),
    source_of_truth_path: readinessPath,
  };
}

function canonicalCommandPlan(slug, acceptedCandidate) {
  const packageRoot = `docs/examples/${slug}`;
  const candidatePath = acceptedCandidate.path;
  const attachmentPath = acceptedCandidate.source_format === 'json'
    ? candidatePath
    : `${packageRoot}/inspection/inspection_evidence.json`;
  return {
    review_context: [
      'fcad',
      'review-context',
      '--model',
      `${packageRoot}/cad/<canonical-model-file>`,
      '--inspection-evidence',
      attachmentPath,
      '--out',
      `${packageRoot}/review/review_pack.json`,
    ],
    readiness_pack: [
      'fcad',
      'readiness-pack',
      '--review-pack',
      `${packageRoot}/review/review_pack.json`,
      '--out',
      `${packageRoot}/readiness/readiness_report.json`,
    ],
    generate_standard_docs: [
      'fcad',
      'generate-standard-docs',
      `${packageRoot}/config.toml`,
      '--readiness-report',
      `${packageRoot}/readiness/readiness_report.json`,
      '--out-dir',
      `${packageRoot}/standard-docs`,
    ],
    pack: [
      'fcad',
      'pack',
      '--readiness',
      `${packageRoot}/readiness/readiness_report.json`,
      '--out',
      `${packageRoot}/release/release_bundle.zip`,
    ],
  };
}

function packageClassification({ acceptedCandidates, packageRejectedCandidates }) {
  if (acceptedCandidates.length > 0) return 'genuine_valid';
  const inspectionRecordRejects = packageRejectedCandidates.filter((candidate) => (
    candidate.package_candidate === true
  ));
  if (inspectionRecordRejects.length === 0) return 'no_candidate';
  if (inspectionRecordRejects.some((candidate) => candidate.classification === 'invalid_generated')) return 'invalid_generated';
  if (inspectionRecordRejects.some((candidate) => candidate.classification === 'invalid_provenance')) return 'invalid_provenance';
  return 'invalid_schema';
}

function isPackageCandidate(candidate, slug) {
  return candidate.package_slug === slug && isPackageInspectionPath(candidate.path, slug);
}

function normalizeGithubEntries(kind, parsed) {
  if (kind === 'github_actions_artifacts') {
    const pages = Array.isArray(parsed) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page?.artifacts))
      .map((artifact) => ({
        name: artifact.name || null,
        expired: artifact.expired ?? null,
        createdAt: artifact.created_at || null,
        url: artifact.archive_download_url || null,
        workflowRun: artifact.workflow_run?.html_url || null,
      }));
  }

  if (kind === 'github_issue_comments' || kind === 'github_pull_review_comments') {
    const pages = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page))
      .map((comment) => ({
        url: comment.html_url || null,
        body: comment.body || null,
        updatedAt: comment.updated_at || null,
      }));
  }

  return Array.isArray(parsed) ? parsed : [];
}

async function githubSearchResults({ githubRepo, githubRunner = execFile }) {
  const sources = [];
  const rejected = [];
  const repoApiPath = `repos/${githubRepo}`;
  const commands = [
    {
      kind: 'github_issues_open',
      args: ['search', 'issues', 'inspection evidence', '--repo', githubRepo, '--state', 'open', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_issues_closed',
      args: ['search', 'issues', 'inspection evidence', '--repo', githubRepo, '--state', 'closed', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_physical_inspection_terms_open',
      args: ['search', 'issues', 'CMM OR caliper OR gauge OR first article OR supplier inspection', '--repo', githubRepo, '--state', 'open', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_physical_inspection_terms_closed',
      args: ['search', 'issues', 'CMM OR caliper OR gauge OR first article OR supplier inspection', '--repo', githubRepo, '--state', 'closed', '--include-prs', '--json', 'number,title,state,url,isPullRequest,body,updatedAt', '--limit', '100'],
    },
    {
      kind: 'github_issue_comments',
      args: ['api', `${repoApiPath}/issues/comments`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_pull_review_comments',
      args: ['api', `${repoApiPath}/pulls/comments`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_actions_artifacts',
      args: ['api', `${repoApiPath}/actions/artifacts`, '--paginate', '--slurp'],
    },
    {
      kind: 'github_release_records',
      args: ['release', 'list', '--repo', githubRepo, '--limit', '100', '--json', 'tagName,name,isDraft,isPrerelease,publishedAt'],
    },
  ];

  for (const command of commands) {
    try {
      const { stdout } = await githubRunner('gh', command.args, {
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || '[]');
      const entries = normalizeGithubEntries(command.kind, parsed);
      const matchingEntries = entries.filter((entry) => (
        /inspection|cmm|caliper|gauge|first.article|supplier/i.test(JSON.stringify(entry))
      ));
      sources.push({
        kind: command.kind,
        status: 'searched',
        entry_count: entries.length,
        candidate_count: matchingEntries.length,
      });
      matchingEntries.forEach((entry) => {
        rejected.push({
          path: entry.url || entry.tagName || entry.name || command.kind,
          source_kind: command.kind,
          source_format: 'github_metadata',
          adapter: 'github_metadata_scan',
          package_slug: null,
          classification: 'invalid_provenance',
          reasons: ['GitHub metadata mention is not an attached machine-readable completed inspection record'],
          validation_errors: [],
          contract_ok: false,
          evidence_type: null,
          source_type: null,
          measured_feature_count: null,
          normalized_source_ref: null,
        });
      });
    } catch (error) {
      sources.push({
        kind: command.kind,
        status: 'failed',
        error: error.message,
      });
    }
  }

  return { sources, rejected };
}

export async function discoverInspectionEvidenceIntake({
  projectRoot,
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  trackedPaths = null,
  includeGitHub = false,
  githubRepo = 'dooosp/freecad-automation',
  githubRunner = execFile,
  generatedAt = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const slugs = safeList(packageSlugs).length > 0 ? packageSlugs : CANONICAL_PACKAGE_SLUGS;
  const normalizedSlugs = slugs.map(String);
  const tracked = await listTrackedPaths(resolvedRoot, trackedPaths);
  const candidatePaths = uniqueStrings([
    ...tracked.filter(isEvidencePathCandidate),
    ...normalizedSlugs.map((slug) => `docs/examples/${slug}/inspection/inspection_evidence.json`),
  ]).filter((candidatePath) => tracked.includes(candidatePath) || isEvidencePathCandidate(candidatePath));

  const localCandidates = [];
  for (const candidatePath of candidatePaths) {
    if (!(tracked.includes(candidatePath) || await pathExists(resolvedRoot, candidatePath))) continue;
    localCandidates.push(await classifyCandidate({
      projectRoot: resolvedRoot,
      relativePath: candidatePath,
      packageSlugs: normalizedSlugs,
    }));
  }

  const github = includeGitHub
    ? await githubSearchResults({ githubRepo, githubRunner })
    : {
        sources: [{
          kind: 'github_public_metadata',
          status: 'not_requested',
          reason: 'Use --include-github in connected environments; hosted tests keep network disabled.',
        }],
        rejected: [],
      };

  const allCandidates = [...localCandidates, ...github.rejected];
  const acceptedCandidates = allCandidates.filter((candidate) => candidate.classification === 'genuine_valid');
  const rejectedCandidates = allCandidates
    .filter((candidate) => candidate.classification !== 'genuine_valid')
    .map((candidate) => ({
      ...candidate,
      package_candidate: candidate.package_slug
        ? isPackageCandidate(candidate, candidate.package_slug)
        : false,
    }));

  const packages = [];
  for (const slug of normalizedSlugs) {
    const packageAccepted = acceptedCandidates.filter((candidate) => candidate.package_slug === slug);
    const packageRejected = rejectedCandidates.filter((candidate) => candidate.package_slug === slug);
    const readiness = await readReadinessState(resolvedRoot, slug);
    const classification = packageClassification({
      acceptedCandidates: packageAccepted,
      packageRejectedCandidates: packageRejected,
    });
    packages.push({
      slug,
      classification,
      readiness_before: readiness,
      readiness_after: packageAccepted.length > 0
        ? {
            ...readiness,
            status: readiness.status || 'pending_regeneration',
            gate_decision: readiness.gate_decision || 'pending_canonical_regeneration',
          }
        : readiness,
      searched_sources: [
        {
          kind: 'canonical_package_expected_path',
          status: await pathExists(resolvedRoot, `docs/examples/${slug}/inspection/inspection_evidence.json`)
            ? 'found'
            : 'missing',
          path: `docs/examples/${slug}/inspection/inspection_evidence.json`,
        },
        {
          kind: 'tracked_repo_files',
          status: 'searched',
          candidate_path_count: candidatePaths.length,
        },
        ...github.sources,
      ],
      accepted_candidates: packageAccepted,
      rejected_candidates: packageRejected,
      intake_action: packageAccepted.length > 0
        ? {
            status: 'ready_for_canonical_attachment',
            mode: 'canonical_review_context_chain_required',
            candidate_path: packageAccepted[0].path,
            candidate_format: packageAccepted[0].source_format,
            normalization_required: packageAccepted[0].source_format !== 'json',
            normalized_contract_target: packageAccepted[0].source_format === 'json'
              ? packageAccepted[0].path
              : `docs/examples/${slug}/inspection/inspection_evidence.json`,
            canonical_commands: canonicalCommandPlan(slug, packageAccepted[0]),
            note: packageAccepted[0].source_format === 'json'
              ? 'Attach only through review-context, then regenerate readiness, standard-doc, and release artifacts.'
              : 'Adapter validated explicit table rows; serialize the normalized inspection-evidence JSON contract before review-context attachment. Do not hand-enter measurements.',
          }
        : {
            status: 'hold_for_evidence_completion',
            mode: 'no_human_measurement_entry_requested',
            note: 'No genuine completed inspection evidence was found; readiness must remain held.',
          },
    });
  }

  return {
    artifact_type: 'inspection_evidence_intake_report',
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: nowIso(generatedAt),
    source_boundary: {
      allowed_sources: [
        'tracked repo files',
        'docs/examples/tests/fixtures inside the checkout',
        'existing non-secret local files in the checkout',
        'public GitHub metadata when --include-github is used',
      ],
      adapter_coverage: [
        'JSON inspection evidence contract files',
        'CSV/TSV/Markdown tables with explicit inspection evidence columns',
      ],
      hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
      rejected_as_final_evidence: [
        'generated CAD/drawing/quality/DFM/readiness/review/standard-doc/release artifacts',
        'fixtures',
        'templates',
        'collection guides',
        'CI summaries',
        'release bundles',
      ],
    },
    searched_sources: [
      {
        kind: 'tracked_repo_files',
        status: 'searched',
        path_count: tracked.length,
        candidate_path_count: candidatePaths.length,
      },
      ...github.sources,
    ],
    packages,
    accepted_candidates: acceptedCandidates,
    rejected_candidates: rejectedCandidates,
    summary: {
      package_count: packages.length,
      candidate_count: allCandidates.length,
      accepted_candidate_count: acceptedCandidates.length,
      rejected_candidate_count: rejectedCandidates.length,
      genuine_inspection_evidence_found: acceptedCandidates.length > 0,
      packages_with_genuine_evidence: packages
        .filter((pkg) => pkg.classification === 'genuine_valid')
        .map((pkg) => pkg.slug),
      packages_without_genuine_evidence: packages
        .filter((pkg) => pkg.classification !== 'genuine_valid')
        .map((pkg) => pkg.slug),
      requires_human_measurement_entry: false,
      readiness_truth: acceptedCandidates.length > 0
        ? 'valid candidates require canonical review-context attachment/regeneration before readiness may change'
        : 'readiness remains needs_more_evidence / hold_for_evidence_completion',
    },
  };
}

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, posix, resolve, win32 } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { promisify } from 'node:util';

import { validateInspectionEvidence } from '../../../lib/inspection-evidence.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';
import { assertValidStage5bIntakeReport } from './stage5b-runtime-validation.js';

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
  /(^|\/)validation_diagnostics\.json$/i,
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

const GITHUB_ALLOWED_FILE_EXTENSIONS = new Set(['.json', '.csv', '.tsv', '.md', '.markdown', '.txt']);
const GITHUB_ALLOWED_ARCHIVE_EXTENSIONS = new Set(['.zip']);
const GITHUB_MAX_DOWNLOADS = 20;
const GITHUB_MAX_TEXT_BYTES = 256 * 1024;
const GITHUB_MAX_ZIP_BYTES = 2 * 1024 * 1024;
const GITHUB_MAX_ZIP_ENTRIES = 50;
const GITHUB_MAX_ZIP_INNER_BYTES = 256 * 1024;
const GITHUB_MAX_ZIP_TOTAL_INNER_BYTES = 1024 * 1024;
const GITHUB_MAX_REPO_DOC_LINK_FILES = 100;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const WINDOWS_PATH_PATTERN = /(?:[A-Za-z]:\\(?:[^\\\r\n"'`<>|]+\\?)+|\\\\[^\s"'`<>|]+(?:\\[^\s"'`<>|]+)+)/g;
const POSIX_PATH_PATTERN = /(?:\/(?:[^\/\s"'`<>()]+\/)+[^\/\s"'`<>()]+)/g;

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

function uniqueObjects(values = [], keyFn = JSON.stringify) {
  const seen = new Set();
  const unique = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(value);
  }
  return unique;
}

function normalizeRepoPath(pathValue) {
  return String(pathValue || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeMatchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function splitFeatureRefs(value) {
  return uniqueStrings(String(value || '')
    .split(/[,;|]/)
    .flatMap((part) => part.split(/\s+and\s+/i))
    .map((part) => part.trim()));
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
  if (normalized.endsWith('.txt')) return 'txt';
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
  if (!['csv', 'tsv', 'markdown_table', 'txt'].includes(sourceFormat)) {
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
      : sourceFormat === 'markdown_table'
        ? parseMarkdownTableRows(text.raw)
        : parseMarkdownTableRows(text.raw).length > 0
          ? parseMarkdownTableRows(text.raw)
          : text.raw.includes('\t')
            ? parseDelimitedRows(text.raw, '\t')
            : parseDelimitedRows(text.raw, ',');
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

function packageSlugFromDocument(document = {}, packageSlugs = []) {
  const values = uniqueStrings([
    document.package_id,
    document.inspected_part,
  ].map((value) => (value === null || value === undefined ? '' : String(value))));
  return packageSlugs.find((slug) => values.includes(slug)) || null;
}

function isGithubSourceKind(sourceKind) {
  return String(sourceKind || '').startsWith('github_') || sourceKind === 'repo_doc_public_link';
}

function isExternalCandidate(candidate = {}) {
  return isGithubSourceKind(candidate.source_kind);
}

function safeReportSourceRef(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const sanitized = sanitizePublicUrl(trimmed);
    return sanitized.ok ? sanitized.url : '[redacted-url]';
  }
  return normalizeRepoPath(trimmed);
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

function documentAttachmentSignals(document = {}) {
  const measuredFeatures = safeList(document.measured_features)
    .filter((feature) => feature && typeof feature === 'object' && !Array.isArray(feature))
    .map((feature) => ({
      feature_id: typeof feature.feature_id === 'string' ? feature.feature_id : null,
      requirement_ref: typeof feature.requirement_ref === 'string' ? feature.requirement_ref : null,
      drawing_ref: typeof feature.drawing_ref === 'string' ? feature.drawing_ref : null,
      nominal_value: typeof feature.nominal_value === 'number' ? feature.nominal_value : null,
      units: typeof feature.units === 'string' ? feature.units : null,
      measurement_method: typeof feature.measurement_method === 'string' ? feature.measurement_method : null,
    }));
  return {
    package_id: typeof document.package_id === 'string' ? document.package_id : null,
    inspected_part: typeof document.inspected_part === 'string' ? document.inspected_part : null,
    source_ref: safeReportSourceRef(document.source_ref || document.source_file),
    traceability_refs: uniqueStrings(safeList(document.traceability_refs)),
    measured_features: measuredFeatures,
    measured_feature_ids: uniqueStrings(measuredFeatures.map((feature) => feature.feature_id)),
    requirement_refs: uniqueStrings(measuredFeatures.map((feature) => feature.requirement_ref)),
    drawing_refs: uniqueStrings(measuredFeatures.map((feature) => feature.drawing_ref)),
  };
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

function hasGenuineGithubProvenance({
  relativePath,
  document,
  packageSlugs,
  sourceProvenance,
}) {
  const reasons = [];
  const slug = packageSlugFromDocument(document, packageSlugs) || packageSlugFromPath(relativePath, packageSlugs);
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
  } else if (/^https?:\/\//i.test(sourcePath) && !sanitizePublicUrl(sourcePath).ok) {
    reasons.push('source_ref/source_file URL is not a safe public URL');
  }

  if (!sourceProvenance?.source_url) {
    reasons.push('GitHub candidate does not have sanitized public source URL provenance');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    package_slug: slug,
  };
}

async function classifyCandidate({
  projectRoot,
  relativePath,
  packageSlugs,
  sourceKind = 'tracked_repo_file',
  sourceProvenance = null,
}) {
  const normalized = normalizeRepoPath(relativePath);
  const slug = packageSlugFromPath(normalized, packageSlugs);
  const baseCandidate = {
    path: normalized,
    source_kind: sourceKind,
    source_format: sourceFormatForPath(normalized),
    adapter: normalized.toLowerCase().endsWith('.json') ? 'json_contract' : null,
    package_slug: slug,
    source_provenance: sourceProvenance,
    classification: null,
    reasons: [],
    validation_errors: [],
    contract_ok: false,
    evidence_type: null,
    source_type: null,
    measured_feature_count: null,
    normalized_source_ref: null,
    document_signals: null,
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
    const documentPackageSlug = slug || packageSlugFromDocument(document, packageSlugs);
    const enriched = {
      ...tableBaseCandidate,
      package_slug: documentPackageSlug,
      contract_ok: validation.ok,
      evidence_type: document.evidence_type || document.artifact_type || document.type || null,
      source_type: document.source_type || null,
      measured_feature_count: Array.isArray(document.measured_features) ? document.measured_features.length : null,
      validation_errors: validation.errors,
      normalized_source_ref: safeReportSourceRef(document.source_ref || document.source_file),
      document_signals: documentAttachmentSignals(document),
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

    const provenance = isGithubSourceKind(sourceKind)
      ? hasGenuineGithubProvenance({
          relativePath: normalized,
          document,
          packageSlugs,
          sourceProvenance,
        })
      : await hasGenuineLocalProvenance({
          projectRoot,
          relativePath: normalized,
          document,
          packageSlugs,
        });
    if (!provenance.ok) {
      return {
        ...enriched,
        package_slug: provenance.package_slug || enriched.package_slug,
        classification: 'invalid_provenance',
        reasons: provenance.reasons,
      };
    }

    return {
      ...enriched,
      classification: 'genuine_valid',
      reasons: [isGithubSourceKind(sourceKind)
        ? 'machine-readable table normalized to contract-valid completed inspection record with sanitized GitHub/public-link provenance'
        : 'machine-readable table normalized to contract-valid completed inspection record with local canonical package provenance'],
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
  const documentPackageSlug = slug || packageSlugFromDocument(document, packageSlugs);
  const enriched = {
    ...baseCandidate,
    package_slug: documentPackageSlug,
    contract_ok: validation.ok,
    evidence_type: document.evidence_type || document.artifact_type || document.type || null,
    source_type: document.source_type || null,
    measured_feature_count: Array.isArray(document.measured_features) ? document.measured_features.length : null,
    validation_errors: validation.errors,
    normalized_source_ref: safeReportSourceRef(document.source_ref || document.source_file),
    document_signals: documentAttachmentSignals(document),
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

  const provenance = isGithubSourceKind(sourceKind)
    ? hasGenuineGithubProvenance({
        relativePath: normalized,
        document,
        packageSlugs,
        sourceProvenance,
      })
    : await hasGenuineLocalProvenance({
        projectRoot,
        relativePath: normalized,
        document,
        packageSlugs,
      });
  if (!provenance.ok) {
    return {
      ...enriched,
      package_slug: provenance.package_slug || enriched.package_slug,
      classification: 'invalid_provenance',
      reasons: provenance.reasons,
    };
  }

  return {
    ...enriched,
    classification: 'genuine_valid',
    reasons: [isGithubSourceKind(sourceKind)
      ? 'contract-valid completed inspection record with sanitized GitHub/public-link provenance'
      : 'contract-valid completed inspection record with local canonical package provenance'],
  };
}

async function readReadinessState(projectRoot, slug) {
  const readinessPath = `docs/examples/${slug}/readiness/readiness_report.json`;
  const parsed = await readJsonIfPossible(projectRoot, readinessPath);
  const summary = safeObject(parsed.document?.readiness_summary);
  const explicitMissingInputs = Array.isArray(summary.missing_inputs);
  const missingInputs = explicitMissingInputs
    ? summary.missing_inputs
    : uniqueStrings([
      ...safeList(parsed.document?.review_pack?.uncertainty_coverage_report?.missing_inputs),
      ...safeList(parsed.document?.process_plan?.summary?.missing_inputs),
      ...safeList(parsed.document?.quality_risk?.summary?.missing_inputs),
    ]);
  const synthesizeHeldState = !parsed.ok
    || (!summary.status && !summary.gate_decision && missingInputs.length === 0);
  const effectiveMissingInputs = missingInputs.length > 0
    ? missingInputs
    : synthesizeHeldState
      ? ['inspection_evidence']
      : [];
  return {
    status: summary.status || (synthesizeHeldState ? 'needs_more_evidence' : null),
    score: summary.score ?? null,
    gate_decision: summary.gate_decision || (synthesizeHeldState ? 'hold_for_evidence_completion' : null),
    missing_inputs: effectiveMissingInputs,
    inspection_evidence_missing: effectiveMissingInputs.includes('inspection_evidence'),
    source_of_truth_path: readinessPath,
  };
}

async function findCanonicalModelPath(projectRoot, slug) {
  const cadRoot = `docs/examples/${slug}/cad`;
  try {
    const entries = await readdir(resolve(projectRoot, cadRoot));
    const preferred = [
      entries.find((entry) => /\.step$/i.test(entry)),
      entries.find((entry) => /\.stp$/i.test(entry)),
      entries.find((entry) => /\.fcstd$/i.test(entry)),
      entries.find((entry) => /\.stl$/i.test(entry)),
    ].find(Boolean);
    return preferred ? `${cadRoot}/${preferred}` : null;
  } catch {
    return null;
  }
}

async function listPackageDrawingJsonPaths(projectRoot, slug) {
  const drawingRoot = `docs/examples/${slug}/drawing`;
  try {
    const entries = await readdir(resolve(projectRoot, drawingRoot));
    return entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => `${drawingRoot}/${entry}`);
  } catch {
    return [];
  }
}

function basenameStem(pathValue) {
  return basename(normalizeRepoPath(pathValue)).replace(/\.[^.]+$/, '');
}

function collectProfileTextTokens(values = []) {
  return uniqueStrings(values)
    .flatMap((value) => {
      const raw = String(value || '').trim();
      const stem = basenameStem(raw);
      return [raw, stem, raw.replaceAll('-', '_'), stem.replaceAll('-', '_')];
    })
    .map(normalizeMatchToken)
    .filter((token) => token && token.length >= 3);
}

function normalizedTextContains(values = [], token) {
  const normalizedToken = normalizeMatchToken(token);
  if (!normalizedToken) return false;
  return values.some((value) => normalizeMatchToken(value).includes(normalizedToken));
}

function featureCatalogEntries(document = {}) {
  return safeList(document.features)
    .filter((feature) => feature && typeof feature === 'object' && !Array.isArray(feature))
    .map((feature) => {
      const id = feature.id || feature.feature_id || feature.name || feature.label || null;
      return {
        id: typeof id === 'string' ? id : null,
        type: feature.type || feature.kind || feature.feature_type || null,
        label: feature.label || feature.name || null,
        dimensions: safeObject(feature.dimensions),
      };
    })
    .filter((feature) => feature.id);
}

function requiredDimensionEntries(document = {}) {
  return safeList(document.required_dimensions)
    .filter((dimension) => dimension && typeof dimension === 'object' && !Array.isArray(dimension))
    .map((dimension) => ({
      id: typeof dimension.id === 'string' ? dimension.id : null,
      feature_ids: splitFeatureRefs(dimension.feature),
      label: typeof dimension.label === 'string' ? dimension.label : null,
      dimension_type: typeof dimension.dimension_type === 'string' ? dimension.dimension_type : null,
      value_mm: typeof dimension.value_mm === 'number' ? dimension.value_mm : null,
      required: dimension.required !== false,
    }))
    .filter((dimension) => dimension.id || dimension.feature_ids.length > 0);
}

async function readPackageProfile(projectRoot, slug) {
  const packageRoot = `docs/examples/${slug}`;
  const reviewPackPath = `${packageRoot}/review/review_pack.json`;
  const reviewPack = (await readJsonIfPossible(projectRoot, reviewPackPath)).document || {};
  const sourceRefs = safeList(reviewPack.source_artifact_refs);
  const drawingPaths = uniqueStrings([
    ...sourceRefs
      .filter((ref) => ['drawing_intent', 'feature_catalog'].includes(ref?.artifact_type))
      .map((ref) => ref.path),
    ...await listPackageDrawingJsonPaths(projectRoot, slug),
  ]);
  const drawingJsonDocuments = [];
  for (const drawingPath of drawingPaths) {
    const parsed = await readJsonIfPossible(projectRoot, drawingPath);
    if (parsed.ok) {
      drawingJsonDocuments.push({
        path: drawingPath,
        document: parsed.document,
      });
    }
  }

  const features = drawingJsonDocuments.flatMap((entry) => featureCatalogEntries(entry.document));
  const requiredDimensions = drawingJsonDocuments.flatMap((entry) => requiredDimensionEntries(entry.document));
  const featureTokens = new Map();
  for (const feature of features) {
    featureTokens.set(normalizeMatchToken(feature.id), feature);
  }

  const requiredTokens = new Map();
  for (const dimension of requiredDimensions) {
    if (dimension.id) requiredTokens.set(normalizeMatchToken(dimension.id), dimension);
  }

  const sourcePaths = uniqueStrings([
    reviewPackPath,
    ...sourceRefs.map((ref) => ref.path),
    ...drawingPaths,
  ]);
  const modelAndDrawingSignals = collectProfileTextTokens([
    slug,
    reviewPack.part_id,
    reviewPack.part?.id,
    reviewPack.part?.name,
    ...sourcePaths,
    ...sourceRefs.map((ref) => ref.label),
  ]);

  return {
    slug,
    package_root: packageRoot,
    canonical_model_path: await findCanonicalModelPath(projectRoot, slug),
    review_pack_path: reviewPackPath,
    source_paths: sourcePaths,
    model_and_drawing_signals: modelAndDrawingSignals,
    feature_tokens: featureTokens,
    required_tokens: requiredTokens,
    required_dimensions: requiredDimensions.filter((dimension) => dimension.required),
  };
}

async function readPackageProfiles(projectRoot, slugs = []) {
  const profiles = [];
  for (const slug of slugs) {
    profiles.push(await readPackageProfile(projectRoot, slug));
  }
  return profiles;
}

function candidateRawSignals(candidate = {}) {
  const documentSignals = safeObject(candidate.document_signals);
  const provenance = safeObject(candidate.source_provenance);
  return uniqueStrings([
    candidate.path,
    candidate.normalized_source_ref,
    documentSignals.source_ref,
    documentSignals.package_id,
    documentSignals.inspected_part,
    provenance.source_url,
    provenance.source_page_url,
    provenance.source_label,
    provenance.inner_path,
    ...safeList(documentSignals.traceability_refs),
    ...safeList(documentSignals.drawing_refs),
  ]);
}

function candidateFeatureSignals(candidate = {}) {
  return safeList(safeObject(candidate.document_signals).measured_features)
    .map((feature) => ({
      feature_id: feature.feature_id || null,
      requirement_ref: feature.requirement_ref || null,
      drawing_ref: feature.drawing_ref || null,
      nominal_value: typeof feature.nominal_value === 'number' ? feature.nominal_value : null,
      units: feature.units || null,
    }));
}

function matchCandidateFeatures(candidate, profile) {
  const matched = [];
  const unmatched = [];
  const coveredRequiredTokens = new Set();
  const coveredFeatureTokens = new Set();

  for (const feature of candidateFeatureSignals(candidate)) {
    const signals = [];
    const candidateFeatureToken = normalizeMatchToken(feature.feature_id);
    const requirementToken = normalizeMatchToken(feature.requirement_ref);
    const drawingToken = normalizeMatchToken(feature.drawing_ref);
    const featureMatch = candidateFeatureToken ? profile.feature_tokens.get(candidateFeatureToken) : null;
    const requirementMatch = requirementToken ? profile.required_tokens.get(requirementToken) : null;
    let dimensionMatch = null;

    if (featureMatch) {
      signals.push('feature_id');
      coveredFeatureTokens.add(candidateFeatureToken);
    }
    if (requirementMatch) {
      signals.push('requirement_ref');
      coveredRequiredTokens.add(requirementToken);
      for (const featureId of requirementMatch.feature_ids) {
        coveredFeatureTokens.add(normalizeMatchToken(featureId));
      }
    }
    if (!requirementMatch && drawingToken && profile.required_tokens.has(drawingToken)) {
      dimensionMatch = profile.required_tokens.get(drawingToken);
      signals.push('drawing_ref');
      coveredRequiredTokens.add(drawingToken);
      for (const featureId of dimensionMatch.feature_ids) {
        coveredFeatureTokens.add(normalizeMatchToken(featureId));
      }
    }
    if (!featureMatch && !requirementMatch && !dimensionMatch && typeof feature.nominal_value === 'number') {
      const valueMatches = profile.required_dimensions.filter((dimension) => (
        typeof dimension.value_mm === 'number'
        && Math.abs(dimension.value_mm - feature.nominal_value) < 0.000001
      ));
      if (valueMatches.length === 1) {
        dimensionMatch = valueMatches[0];
        signals.push('dimension_value');
        if (dimensionMatch.id) coveredRequiredTokens.add(normalizeMatchToken(dimensionMatch.id));
        for (const featureId of dimensionMatch.feature_ids) {
          coveredFeatureTokens.add(normalizeMatchToken(featureId));
        }
      }
    }

    if (signals.length > 0) {
      matched.push({
        candidate_feature_id: feature.feature_id,
        candidate_requirement_ref: feature.requirement_ref,
        canonical_feature_id: featureMatch?.id || dimensionMatch?.feature_ids?.[0] || requirementMatch?.feature_ids?.[0] || null,
        canonical_requirement_id: requirementMatch?.id || dimensionMatch?.id || null,
        match_signals: signals,
      });
    } else {
      unmatched.push({
        candidate_feature_id: feature.feature_id,
        candidate_requirement_ref: feature.requirement_ref,
        reason_code: 'no_canonical_feature_or_requirement_match',
      });
    }
  }

  const missingRequired = profile.required_dimensions
    .filter((dimension) => {
      const requirementCovered = dimension.id && coveredRequiredTokens.has(normalizeMatchToken(dimension.id));
      const featureCovered = dimension.feature_ids.some((featureId) => coveredFeatureTokens.has(normalizeMatchToken(featureId)));
      return !(requirementCovered || featureCovered);
    })
    .map((dimension) => ({
      canonical_requirement_id: dimension.id,
      canonical_feature_ids: dimension.feature_ids,
      label: dimension.label,
      dimension_type: dimension.dimension_type,
      value_mm: dimension.value_mm,
    }));

  return {
    matched_features: uniqueObjects(matched, (entry) => [
      entry.candidate_feature_id,
      entry.candidate_requirement_ref,
      entry.canonical_feature_id,
      entry.canonical_requirement_id,
      entry.match_signals.join(','),
    ].join('|')),
    unmatched_features: unmatched,
    missing_required_features: missingRequired,
  };
}

function evaluateCandidatePackageMatch(candidate, profile) {
  const signals = safeObject(candidate.document_signals);
  const rawSignals = candidateRawSignals(candidate);
  const packageToken = normalizeMatchToken(profile.slug);
  let score = 0;
  const matchSignals = [];
  let strongPackageSignal = false;

  if (normalizeMatchToken(signals.package_id) === packageToken) {
    score += 100;
    strongPackageSignal = true;
    matchSignals.push('explicit_package_id');
  }
  if (normalizeMatchToken(signals.inspected_part) === packageToken) {
    score += 90;
    strongPackageSignal = true;
    matchSignals.push('explicit_inspected_part');
  }
  if (isPackageInspectionPath(candidate.path, profile.slug)) {
    score += 95;
    strongPackageSignal = true;
    matchSignals.push('source_path_package_inspection_dir');
  }
  if (isPackageInspectionPath(signals.source_ref, profile.slug) || isPackageInspectionPath(candidate.normalized_source_ref, profile.slug)) {
    score += 90;
    strongPackageSignal = true;
    matchSignals.push('source_ref_package_inspection_dir');
  }
  if (rawSignals.some((value) => normalizedTextContains([value], profile.slug))) {
    score += 45;
    matchSignals.push('source_text_contains_package_slug');
  }
  if (profile.model_and_drawing_signals.some((token) => normalizedTextContains(rawSignals, token))) {
    score += 45;
    strongPackageSignal = true;
    matchSignals.push('model_or_drawing_name');
  }

  const featureSupport = matchCandidateFeatures(candidate, profile);
  const featureIdMatches = featureSupport.matched_features
    .filter((feature) => feature.match_signals.includes('feature_id')).length;
  const requirementMatches = featureSupport.matched_features
    .filter((feature) => feature.match_signals.includes('requirement_ref')).length;
  const dimensionMatches = featureSupport.matched_features
    .filter((feature) => feature.match_signals.includes('dimension_value')).length;
  if (featureIdMatches > 0) {
    score += Math.min(45, featureIdMatches * 20);
    matchSignals.push('feature_id_overlap');
  }
  if (requirementMatches > 0) {
    score += Math.min(45, requirementMatches * 25);
    matchSignals.push('requirement_ref_overlap');
  }
  if (dimensionMatches > 0) {
    score += Math.min(15, dimensionMatches * 5);
    matchSignals.push('dimension_value_overlap');
  }

  return {
    slug: profile.slug,
    canonical_model_path: profile.canonical_model_path || null,
    score,
    match_signals: uniqueStrings(matchSignals),
    strong_package_signal: strongPackageSignal,
    ...featureSupport,
  };
}

function noAttachmentPlan({
  matchConfidence = 'none',
  blockers = [],
  candidateMatches = [],
  note = null,
} = {}) {
  return {
    matched_package: null,
    match_confidence: matchConfidence,
    candidate_package_matches: candidateMatches,
    matched_features: [],
    unmatched_features: [],
    missing_required_features: [],
    attachment_ready: false,
    blockers: uniqueStrings(blockers),
    canonical_next_command: null,
    note,
  };
}

function planCandidateAttachment(candidate, profiles = []) {
  if (candidate.classification !== 'genuine_valid') {
    return noAttachmentPlan({
      blockers: ['candidate_not_genuine_valid'],
      note: 'Candidate did not pass the hard inspection-evidence gate and cannot be attached.',
    });
  }

  const evaluations = profiles
    .map((profile) => evaluateCandidatePackageMatch(candidate, profile))
    .filter((evaluation) => evaluation.score > 0)
    .sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug));
  const candidateMatches = evaluations.map((evaluation) => ({
    slug: evaluation.slug,
    score: evaluation.score,
    match_signals: evaluation.match_signals,
    matched_feature_count: evaluation.matched_features.length,
  }));

  if (evaluations.length === 0) {
    return noAttachmentPlan({
      blockers: ['no_package_match'],
      note: 'Validated evidence did not match any canonical package using safe package, path, lineage, model, drawing, feature, or dimension signals.',
    });
  }

  const best = evaluations[0];
  const second = evaluations[1] || null;
  const ambiguous = Boolean(
    second
    && second.score === best.score
    && !best.strong_package_signal
  );
  if (ambiguous) {
    return {
      ...noAttachmentPlan({
        matchConfidence: 'ambiguous',
        blockers: ['ambiguous_package_match'],
        candidateMatches,
        note: 'Validated evidence matched multiple packages with equal non-explicit signals; canonical readiness remains held.',
      }),
      matched_features: best.matched_features,
      unmatched_features: best.unmatched_features,
      missing_required_features: best.missing_required_features,
    };
  }

  const explicitProvenance = Boolean(
    candidate.normalized_source_ref
    || safeObject(candidate.document_signals).source_ref
    || safeObject(candidate.source_provenance).source_url
  );
  const matchConfidence = best.strong_package_signal && best.score >= 80
    ? 'high'
    : best.score >= 40
      ? 'medium'
      : 'low';
  const attachmentReady = matchConfidence === 'high' && explicitProvenance;
  const blockers = [];
  if (matchConfidence !== 'high') blockers.push('insufficient_package_match_confidence');
  if (!explicitProvenance) blockers.push('missing_explicit_provenance');

  return {
    matched_package: best.slug,
    match_confidence: matchConfidence,
    candidate_package_matches: candidateMatches,
    matched_features: best.matched_features,
    unmatched_features: best.unmatched_features,
    missing_required_features: best.missing_required_features,
    attachment_ready: attachmentReady,
    blockers,
    canonical_next_command: attachmentReady
      ? canonicalCommandPlan(best.slug, candidate, { modelPath: best.canonical_model_path }).review_context
      : null,
    note: attachmentReady
      ? 'High-confidence package match with explicit provenance; attach only through the canonical review-context chain.'
      : 'Validated evidence requires review before canonical attachment.',
  };
}

function packageHoldAttachmentPlan({
  slug,
  candidatePlans = [],
  reason = 'no_genuine_valid_candidate',
} = {}) {
  const relevantPlan = candidatePlans.find((candidate) => candidate.matched_package === slug)
    || candidatePlans.find((candidate) => safeList(candidate.candidate_package_matches).some((match) => match.slug === slug));
  if (relevantPlan) {
    return {
      matched_package: relevantPlan.matched_package,
      match_confidence: relevantPlan.match_confidence,
      candidate_package_matches: safeList(relevantPlan.candidate_package_matches),
      matched_features: safeList(relevantPlan.matched_features),
      unmatched_features: safeList(relevantPlan.unmatched_features),
      missing_required_features: safeList(relevantPlan.missing_required_features),
      attachment_ready: false,
      blockers: uniqueStrings([
        ...safeList(relevantPlan.blockers),
        relevantPlan.match_confidence === 'ambiguous' ? 'ambiguous_package_match' : 'attachment_not_ready',
      ]),
      canonical_next_command: null,
      note: relevantPlan.note || 'Candidate is not ready for canonical attachment.',
    };
  }
  return {
    matched_package: null,
    match_confidence: 'none',
    candidate_package_matches: [],
    matched_features: [],
    unmatched_features: [],
    missing_required_features: [],
    attachment_ready: false,
    blockers: [reason],
    canonical_next_command: null,
    note: 'No genuine completed inspection evidence was matched to this package; readiness must remain held.',
  };
}

function canonicalCommandPlan(slug, acceptedCandidate, { modelPath = null } = {}) {
  const packageRoot = `docs/examples/${slug}`;
  const candidatePath = acceptedCandidate.path;
  const attachmentPath = acceptedCandidate.source_format === 'json' && !isExternalCandidate(acceptedCandidate)
    ? candidatePath
    : `${packageRoot}/inspection/inspection_evidence.json`;
  const authorizationPath = `${packageRoot}/inspection/stage5b_attachment_authorization.json`;
  const safeModelPath = modelPath || `${packageRoot}/cad/canonical-model-file.step`;
  return {
    review_context: [
      'fcad',
      'review-context',
      '--model',
      safeModelPath,
      '--inspection-evidence',
      attachmentPath,
      '--attachment-authorization',
      authorizationPath,
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
  if (candidate.package_slug !== slug) return false;
  return isExternalCandidate(candidate) || isPackageInspectionPath(candidate.path, slug);
}

async function defaultGithubFetch(url) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable');
  }
  return fetch(url);
}

function sanitizeErrorMessage(error) {
  return String(error?.message || error || 'unknown error')
    .replace(URL_PATTERN, '[url]')
    .replace(WINDOWS_PATH_PATTERN, (match) => win32.basename(match))
    .replace(POSIX_PATH_PATTERN, (match) => basename(match))
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[redacted]')
    .slice(0, 300);
}

function urlHostLabel(rawUrl) {
  try {
    return new URL(String(rawUrl)).hostname;
  } catch {
    return null;
  }
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const isIpv6 = host.includes(':');
  return host === 'localhost'
    || host === '::1'
    || host.endsWith('.local')
    || (isIpv6 && (host.startsWith('fd') || host.startsWith('fc') || host.startsWith('fe80:')))
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    || /^169\.254\./.test(host);
}

function sanitizePublicUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim().replace(/[.,;!?]+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { ok: false, reason_code: 'unsupported_url_scheme', host: parsed.hostname || null };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason_code: 'url_userinfo_redacted', host: parsed.hostname || null };
    }
    if (isPrivateHostname(parsed.hostname)) {
      return { ok: false, reason_code: 'private_url_redacted', host: parsed.hostname || null };
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return {
      ok: true,
      url: parsed.toString(),
      host: parsed.hostname,
      extension: extname(parsed.pathname).toLowerCase(),
    };
  } catch {
    return { ok: false, reason_code: 'invalid_url', host: null };
  }
}

function responseHeader(response, name) {
  return typeof response?.headers?.get === 'function' ? response.headers.get(name) : null;
}

async function responseBuffer(response, maxBytes) {
  const contentLength = Number(responseHeader(response, 'content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      reason_code: 'download_too_large',
      size_bytes: contentLength,
    };
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      reason_code: 'download_too_large',
      size_bytes: buffer.length,
    };
  }
  return {
    ok: true,
    buffer,
    size_bytes: buffer.length,
  };
}

function allowedKindForUrl(url) {
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (GITHUB_ALLOWED_FILE_EXTENSIONS.has(extension)) return 'file';
  if (GITHUB_ALLOWED_ARCHIVE_EXTENSIONS.has(extension)) return 'zip';
  return null;
}

function extractCandidateLinks(text) {
  return uniqueStrings(String(text || '').match(URL_PATTERN) || [])
    .map((rawUrl) => sanitizePublicUrl(rawUrl))
    .filter((entry) => entry.ok && allowedKindForUrl(entry.url))
    .map((entry) => entry.url);
}

function githubCandidatePath(sourceUrl, innerPath = null) {
  const hash = createHash('sha256').update(`${sourceUrl}\n${innerPath || ''}`).digest('hex').slice(0, 16);
  if (innerPath) {
    return normalizeRepoPath(innerPath);
  }
  const name = basename(new URL(sourceUrl).pathname).replace(/[^A-Za-z0-9._-]/g, '_') || `candidate-${hash}`;
  return `github-downloads/${hash}/${name}`;
}

function safeSourcePageUrl(value) {
  if (!value) return null;
  const sanitized = sanitizePublicUrl(value);
  return sanitized.ok ? sanitized.url : null;
}

function githubSourceProvenance(ref, extra = {}) {
  return {
    source_url: ref.source_url,
    source_page_url: ref.source_page_url || null,
    source_label: ref.source_label || null,
    origin_kind: ref.origin_kind || null,
    ...extra,
  };
}

function safeZipEntryPath(entryName) {
  const raw = String(entryName || '');
  if (!raw || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  if (raw.split('/').includes('..')) return null;
  const normalized = posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  return normalized;
}

function inspectZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  let totalInnerBytes = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (entries.length >= GITHUB_MAX_ZIP_ENTRIES) {
      return { ok: false, reason_code: 'zip_entry_limit_exceeded' };
    }
    if ((flags & 0x08) !== 0 || dataEnd > buffer.length) {
      return { ok: false, reason_code: 'unsupported_zip_descriptor' };
    }

    const entryName = buffer.slice(nameStart, nameEnd).toString('utf8');
    const safePath = safeZipEntryPath(entryName);
    if (!safePath) {
      return { ok: false, reason_code: 'unsafe_zip_path', inner_path: entryName.replace(URL_PATTERN, '[url]').slice(0, 160) };
    }

    const isDirectory = safePath.endsWith('/');
    if (!isDirectory && GITHUB_ALLOWED_FILE_EXTENSIONS.has(extname(safePath).toLowerCase())) {
      if (uncompressedSize > GITHUB_MAX_ZIP_INNER_BYTES) {
        return { ok: false, reason_code: 'zip_inner_file_too_large', inner_path: safePath };
      }
      totalInnerBytes += uncompressedSize;
      if (totalInnerBytes > GITHUB_MAX_ZIP_TOTAL_INNER_BYTES) {
        return { ok: false, reason_code: 'zip_total_inner_bytes_exceeded' };
      }

      const compressed = buffer.slice(dataStart, dataEnd);
      let content;
      if (method === 0) {
        content = compressed;
      } else if (method === 8) {
        content = inflateRawSync(compressed);
      } else {
        return { ok: false, reason_code: 'unsupported_zip_compression', inner_path: safePath };
      }
      entries.push({
        inner_path: safePath,
        content,
        size_bytes: content.length,
      });
    }

    offset = dataEnd;
  }

  return { ok: true, entries };
}

function classificationCounts(candidates = []) {
  return candidates.reduce((counts, candidate) => {
    if (!candidate || candidate.classification === 'genuine_valid') return counts;
    const key = candidate.classification || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizeGithubEntries(kind, parsed) {
  if (kind === 'github_actions_artifacts') {
    const pages = Array.isArray(parsed) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page?.artifacts))
      .map((artifact) => ({
        name: artifact.name || null,
        expired: artifact.expired ?? null,
        sizeBytes: artifact.size_in_bytes ?? null,
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

  if (kind === 'github_release_records') {
    const pages = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];
    return pages
      .flatMap((page) => safeList(page))
      .map((release) => ({
        tagName: release.tag_name || release.tagName || null,
        name: release.name || null,
        body: release.body || null,
        url: release.html_url || release.url || null,
        publishedAt: release.published_at || release.publishedAt || null,
        assets: safeList(release.assets).map((asset) => ({
          name: asset.name || null,
          sizeBytes: asset.size ?? asset.size_in_bytes ?? null,
          url: asset.browser_download_url || null,
          contentType: asset.content_type || null,
        })),
      }));
  }

  return Array.isArray(parsed) ? parsed : [];
}

function candidateRefsFromEntries(kind, entries = [], skipped = [], rejected = []) {
  const refs = [];
  for (const entry of entries) {
    if (kind === 'github_actions_artifacts') {
      if (/inspection|cmm|caliper|gauge|first.article|supplier/i.test(JSON.stringify(entry))) {
        skipped.push({
          kind,
          status: 'skipped',
          reason_code: 'workflow_artifact_metadata_only',
          reason: 'Workflow artifact metadata alone is not inspection evidence; archive download is not attempted without a public allowlisted file URL.',
          source_page_url: safeSourcePageUrl(entry.workflowRun),
        });
        rejected.push({
          path: entry.workflowRun || entry.name || kind,
          source_kind: kind,
          source_format: 'github_metadata',
          adapter: 'github_metadata_scan',
          package_slug: null,
          source_provenance: {
            source_page_url: safeSourcePageUrl(entry.workflowRun),
            source_label: entry.name || null,
            origin_kind: kind,
          },
          classification: 'invalid_provenance',
          reasons: ['GitHub workflow artifact metadata is not an attached machine-readable completed inspection record'],
          validation_errors: [],
          contract_ok: false,
          evidence_type: null,
          source_type: null,
          measured_feature_count: null,
          normalized_source_ref: null,
        });
      }
      continue;
    }

    const entryRefs = [];
    for (const sourceUrl of extractCandidateLinks([entry.body, entry.title, entry.name].filter(Boolean).join('\n'))) {
      entryRefs.push({
        source_kind: 'github_linked_file',
        origin_kind: kind,
        source_url: sourceUrl,
        source_page_url: safeSourcePageUrl(entry.url),
        source_label: entry.title || entry.name || entry.tagName || null,
      });
    }

    if (kind === 'github_release_records') {
      for (const asset of safeList(entry.assets)) {
        const sanitized = sanitizePublicUrl(asset.url);
        if (!sanitized.ok || !allowedKindForUrl(sanitized.url)) continue;
        entryRefs.push({
          source_kind: 'github_release_asset',
          origin_kind: kind,
          source_url: sanitized.url,
          source_page_url: safeSourcePageUrl(entry.url),
          source_label: asset.name || entry.tagName || null,
          declared_size_bytes: asset.sizeBytes ?? null,
        });
      }
    }

    if (/inspection|cmm|caliper|gauge|first.article|supplier/i.test(JSON.stringify(entry)) && entryRefs.length === 0) {
      rejected.push({
        path: entry.url || entry.tagName || entry.name || kind,
        source_kind: kind,
        source_format: 'github_metadata',
        adapter: 'github_metadata_scan',
        package_slug: null,
        source_provenance: {
          source_page_url: safeSourcePageUrl(entry.url),
          source_label: entry.title || entry.name || entry.tagName || null,
          origin_kind: kind,
        },
        classification: 'invalid_provenance',
        reasons: ['GitHub metadata mention is not an attached machine-readable completed inspection record'],
        validation_errors: [],
        contract_ok: false,
        evidence_type: null,
        source_type: null,
        measured_feature_count: null,
        normalized_source_ref: null,
      });
    }
    refs.push(...entryRefs);
  }
  return refs;
}

async function repoDocCandidateRefs({ projectRoot, trackedPaths = [], sources = [], skipped = [] }) {
  const refs = [];
  const docPaths = trackedPaths
    .filter((pathValue) => /^(README\.md|docs\/).*\.(?:md|markdown|txt)$/i.test(pathValue))
    .slice(0, GITHUB_MAX_REPO_DOC_LINK_FILES);
  let scanned = 0;
  for (const relativePath of docPaths) {
    try {
      const raw = await readFile(resolve(projectRoot, relativePath), 'utf8');
      scanned += 1;
      for (const sourceUrl of extractCandidateLinks(raw)) {
        refs.push({
          source_kind: 'repo_doc_public_link',
          origin_kind: 'repo_doc_public_links',
          source_url: sourceUrl,
          source_page_url: null,
          source_label: relativePath,
        });
      }
    } catch (error) {
      skipped.push({
        kind: 'repo_doc_public_links',
        status: 'skipped',
        reason_code: 'repo_doc_read_failed',
        reason: sanitizeErrorMessage(error),
        path: relativePath,
      });
    }
  }
  sources.push({
    kind: 'repo_doc_public_links',
    status: 'searched',
    file_count: scanned,
    candidate_link_count: refs.length,
  });
  return refs;
}

async function writeAndClassifyGithubCandidate({
  tempRoot,
  relativePath,
  buffer,
  packageSlugs,
  sourceKind,
  sourceProvenance,
}) {
  const normalizedPath = normalizeRepoPath(relativePath);
  await mkdir(dirname(resolve(tempRoot, normalizedPath)), { recursive: true });
  await writeFile(resolve(tempRoot, normalizedPath), buffer);
  return classifyCandidate({
    projectRoot: tempRoot,
    relativePath: normalizedPath,
    packageSlugs,
    sourceKind,
    sourceProvenance,
  });
}

async function downloadGithubCandidate({
  ref,
  tempRoot,
  packageSlugs,
  githubFetch,
  skipped,
  downloadedCandidates,
}) {
  const kind = allowedKindForUrl(ref.source_url);
  const maxBytes = kind === 'zip' ? GITHUB_MAX_ZIP_BYTES : GITHUB_MAX_TEXT_BYTES;
  try {
    const response = await githubFetch(ref.source_url);
    if (!response?.ok) {
      skipped.push({
        kind: ref.source_kind,
        status: 'skipped',
        reason_code: 'download_failed',
        reason: `HTTP status ${response?.status ?? 'unknown'}`,
        source_url: ref.source_url,
        source_page_url: ref.source_page_url || null,
      });
      return [];
    }

    const downloaded = await responseBuffer(response, maxBytes);
    if (!downloaded.ok) {
      skipped.push({
        kind: ref.source_kind,
        status: 'skipped',
        reason_code: downloaded.reason_code,
        reason: 'GitHub candidate exceeded bounded download limits',
        source_url: ref.source_url,
        source_page_url: ref.source_page_url || null,
        size_bytes: downloaded.size_bytes ?? null,
      });
      return [];
    }

    if (kind === 'zip') {
      const zip = inspectZipEntries(downloaded.buffer);
      if (!zip.ok) {
        skipped.push({
          kind: ref.source_kind,
          status: 'skipped',
          reason_code: zip.reason_code,
          reason: 'ZIP candidate failed bounded safety inspection',
          source_url: ref.source_url,
          source_page_url: ref.source_page_url || null,
          inner_path: zip.inner_path || null,
        });
        return [];
      }

      const candidates = [];
      for (const entry of zip.entries) {
        const candidatePath = githubCandidatePath(ref.source_url, entry.inner_path);
        const provenance = githubSourceProvenance(ref, {
          archive_url: ref.source_url,
          inner_path: entry.inner_path,
        });
        downloadedCandidates.push({
          source_kind: 'github_zip_entry',
          source_url: ref.source_url,
          source_page_url: ref.source_page_url || null,
          candidate_path: candidatePath,
          inner_path: entry.inner_path,
          source_format: sourceFormatForPath(candidatePath),
          size_bytes: entry.size_bytes,
        });
        candidates.push(await writeAndClassifyGithubCandidate({
          tempRoot,
          relativePath: candidatePath,
          buffer: entry.content,
          packageSlugs,
          sourceKind: 'github_zip_entry',
          sourceProvenance: provenance,
        }));
      }
      return candidates;
    }

    const candidatePath = githubCandidatePath(ref.source_url);
    downloadedCandidates.push({
      source_kind: ref.source_kind,
      source_url: ref.source_url,
      source_page_url: ref.source_page_url || null,
      candidate_path: candidatePath,
      source_format: sourceFormatForPath(candidatePath),
      size_bytes: downloaded.size_bytes,
    });
    return [await writeAndClassifyGithubCandidate({
      tempRoot,
      relativePath: candidatePath,
      buffer: downloaded.buffer,
      packageSlugs,
      sourceKind: ref.source_kind,
      sourceProvenance: githubSourceProvenance(ref),
    })];
  } catch (error) {
    skipped.push({
      kind: ref.source_kind,
      status: 'skipped',
      reason_code: 'download_error',
      reason: sanitizeErrorMessage(error),
      source_url: ref.source_url,
      source_page_url: ref.source_page_url || null,
      host: urlHostLabel(ref.source_url),
    });
    return [];
  }
}

async function githubSearchResults({
  githubRepo,
  githubRunner = execFile,
  githubFetch = defaultGithubFetch,
  projectRoot,
  trackedPaths = [],
  packageSlugs = [],
}) {
  const sources = [];
  const skipped = [];
  const rejected = [];
  const candidates = [];
  const downloadedCandidates = [];
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
      args: ['api', `${repoApiPath}/releases`, '--paginate', '--slurp'],
    },
  ];

  const refs = [];
  refs.push(...await repoDocCandidateRefs({
    projectRoot,
    trackedPaths,
    sources,
    skipped,
  }));

  let githubCliAvailable = true;
  try {
    await githubRunner('gh', ['--version'], {
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    githubCliAvailable = false;
    skipped.push({
      kind: 'github_cli',
      status: 'skipped',
      reason_code: 'github_cli_unavailable',
      reason: sanitizeErrorMessage(error),
    });
  }

  if (githubCliAvailable) {
    for (const command of commands) {
      try {
        const { stdout } = await githubRunner('gh', command.args, {
          maxBuffer: 10 * 1024 * 1024,
        });
        const parsed = JSON.parse(stdout || '[]');
        const entries = normalizeGithubEntries(command.kind, parsed);
        const commandRefs = candidateRefsFromEntries(command.kind, entries, skipped, rejected);
        sources.push({
          kind: command.kind,
          status: 'searched',
          entry_count: entries.length,
          candidate_link_count: commandRefs.length,
        });
        refs.push(...commandRefs);
      } catch (error) {
        skipped.push({
          kind: command.kind,
          status: 'skipped',
          reason_code: 'github_command_failed',
          reason: sanitizeErrorMessage(error),
        });
      }
    }
  }

  const uniqueRefs = [];
  const seen = new Set();
  for (const ref of refs) {
    const key = ref.source_url;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRefs.push(ref);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'fcad-github-intake-'));
  try {
    for (const ref of uniqueRefs.slice(0, GITHUB_MAX_DOWNLOADS)) {
      candidates.push(...await downloadGithubCandidate({
        ref,
        tempRoot,
        packageSlugs,
        githubFetch,
        skipped,
        downloadedCandidates,
      }));
    }
    if (uniqueRefs.length > GITHUB_MAX_DOWNLOADS) {
      skipped.push({
        kind: 'github_candidate_links',
        status: 'skipped',
        reason_code: 'download_count_limit_exceeded',
        reason: 'GitHub discovery stopped at the bounded candidate download limit',
        skipped_count: uniqueRefs.length - GITHUB_MAX_DOWNLOADS,
      });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  return {
    sources,
    skipped,
    downloaded_candidates: downloadedCandidates,
    candidates,
    rejected,
  };
}

export async function discoverInspectionEvidenceIntake({
  projectRoot,
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  trackedPaths = null,
  includeGitHub = false,
  githubRepo = 'dooosp/freecad-automation',
  githubRunner = execFile,
  githubFetch = defaultGithubFetch,
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
    ? await githubSearchResults({
        githubRepo,
        githubRunner,
        githubFetch,
        projectRoot: resolvedRoot,
        trackedPaths: tracked,
        packageSlugs: normalizedSlugs,
      })
    : {
        sources: [{
          kind: 'github_public_metadata',
          status: 'not_requested',
          reason: 'Use --include-github in connected environments; hosted tests keep network disabled.',
        }],
        skipped: [],
        downloaded_candidates: [],
        candidates: [],
        rejected: [],
      };

  const githubCandidates = [...safeList(github.candidates), ...safeList(github.rejected)];
  const packageProfiles = await readPackageProfiles(resolvedRoot, normalizedSlugs);
  const allCandidates = [...localCandidates, ...githubCandidates].map((candidate) => {
    const attachmentPlan = planCandidateAttachment(candidate, packageProfiles);
    return {
      ...candidate,
      package_slug: attachmentPlan.matched_package || candidate.package_slug,
      matched_package: attachmentPlan.matched_package,
      match_confidence: attachmentPlan.match_confidence,
      candidate_package_matches: attachmentPlan.candidate_package_matches,
      matched_features: attachmentPlan.matched_features,
      unmatched_features: attachmentPlan.unmatched_features,
      missing_required_features: attachmentPlan.missing_required_features,
      attachment_ready: attachmentPlan.attachment_ready,
      blockers: attachmentPlan.blockers,
      canonical_next_command: attachmentPlan.canonical_next_command,
      attachment_plan: attachmentPlan,
    };
  });
  const acceptedCandidates = allCandidates.filter((candidate) => candidate.classification === 'genuine_valid');
  const attachmentReadyCandidates = acceptedCandidates.filter((candidate) => candidate.attachment_ready === true);
  const rejectedCandidates = allCandidates
    .filter((candidate) => candidate.classification !== 'genuine_valid')
    .map((candidate) => ({
      ...candidate,
      package_candidate: candidate.package_slug
        ? isPackageCandidate(candidate, candidate.package_slug)
        : false,
    }));

  const packages = [];
  const packageProfileBySlug = new Map(packageProfiles.map((profile) => [profile.slug, profile]));
  for (const slug of normalizedSlugs) {
    const packageAccepted = attachmentReadyCandidates.filter((candidate) => candidate.matched_package === slug);
    const packageRejected = rejectedCandidates.filter((candidate) => candidate.package_slug === slug);
    const packageCandidatePlans = acceptedCandidates.filter((candidate) => (
      candidate.matched_package === slug
      || safeList(candidate.candidate_package_matches).some((match) => match.slug === slug)
    ));
    const readiness = await readReadinessState(resolvedRoot, slug);
    const classification = packageClassification({
      acceptedCandidates: packageAccepted,
      packageRejectedCandidates: packageRejected,
    });
    const readyPlan = packageAccepted[0]?.attachment_plan || null;
    const commandPlan = packageAccepted.length > 0
      ? canonicalCommandPlan(slug, packageAccepted[0], { modelPath: packageProfileBySlug.get(slug)?.canonical_model_path })
      : null;
    const attachmentPlan = readyPlan || packageHoldAttachmentPlan({
      slug,
      candidatePlans: packageCandidatePlans,
      reason: packageCandidatePlans.length > 0 ? 'attachment_not_ready' : 'no_genuine_valid_candidate',
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
        ...safeList(github.skipped),
      ],
      accepted_candidates: packageAccepted,
      rejected_candidates: packageRejected,
      attachment_plan: attachmentPlan,
      candidate_attachment_plans: packageCandidatePlans.map((candidate) => candidate.attachment_plan),
      intake_action: packageAccepted.length > 0
        ? {
            status: 'ready_for_canonical_attachment',
            mode: 'canonical_review_context_chain_required',
            candidate_path: packageAccepted[0].path,
            candidate_format: packageAccepted[0].source_format,
            normalization_required: packageAccepted[0].source_format !== 'json' || isExternalCandidate(packageAccepted[0]),
            normalized_contract_target: packageAccepted[0].source_format === 'json' && !isExternalCandidate(packageAccepted[0])
              ? packageAccepted[0].path
              : `docs/examples/${slug}/inspection/inspection_evidence.json`,
            canonical_commands: commandPlan,
            canonical_next_command: readyPlan?.canonical_next_command || commandPlan.review_context,
            matched_package: readyPlan?.matched_package || slug,
            match_confidence: readyPlan?.match_confidence || 'high',
            matched_features: readyPlan?.matched_features || [],
            unmatched_features: readyPlan?.unmatched_features || [],
            missing_required_features: readyPlan?.missing_required_features || [],
            attachment_ready: true,
            blockers: [],
            note: isExternalCandidate(packageAccepted[0])
              ? 'GitHub discovery found a contract-valid external candidate; review and serialize it under the canonical package inspection path before review-context attachment. Do not hand-enter measurements.'
              : packageAccepted[0].source_format === 'json'
              ? 'Attach only through review-context, then regenerate readiness, standard-doc, and release artifacts.'
              : 'Adapter validated explicit table rows; serialize the normalized inspection-evidence JSON contract before review-context attachment. Do not hand-enter measurements.',
          }
        : {
            status: 'hold_for_evidence_completion',
            mode: 'no_human_measurement_entry_requested',
            matched_package: attachmentPlan.matched_package,
            match_confidence: attachmentPlan.match_confidence,
            matched_features: attachmentPlan.matched_features,
            unmatched_features: attachmentPlan.unmatched_features,
            missing_required_features: attachmentPlan.missing_required_features,
            attachment_ready: false,
            blockers: attachmentPlan.blockers,
            canonical_next_command: null,
            note: packageCandidatePlans.length > 0
              ? 'A genuine candidate was found, but the attachment plan is not ready for this package; readiness must remain held.'
              : 'No genuine completed inspection evidence was found; readiness must remain held.',
          },
    });
  }

  const report = {
    artifact_type: 'inspection_evidence_intake_report',
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: nowIso(generatedAt),
    source_boundary: {
      allowed_sources: [
        'tracked repo files',
        'docs/examples/tests/fixtures inside the checkout',
        'existing non-secret local files in the checkout',
        'public GitHub issues, PR comments, release metadata/assets, workflow artifact metadata, and allowlisted public links when --include-github is used',
      ],
      adapter_coverage: [
        'JSON inspection evidence contract files',
        'CSV/TSV/Markdown/TXT tables with explicit inspection evidence columns',
        'bounded ZIP inspection for allowlisted inner JSON/CSV/TSV/Markdown/TXT files',
      ],
      hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
      rejected_as_final_evidence: [
        'generated CAD/drawing/quality/DFM/readiness/review/standard-doc/release artifacts',
        'intake reports',
        'promotion dry-run manifests',
        'audit manifests',
        'authorization records',
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
      ...safeList(github.skipped),
    ],
    github_discovery: {
      enabled: includeGitHub === true,
      repo: githubRepo,
      searched_sources: safeList(github.sources),
      skipped_sources: safeList(github.skipped),
      downloaded_candidates: safeList(github.downloaded_candidates),
      accepted_candidate_count: githubCandidates.filter((candidate) => candidate.classification === 'genuine_valid').length,
      rejected_candidate_count: githubCandidates.filter((candidate) => candidate.classification !== 'genuine_valid').length,
      rejection_classes: classificationCounts(githubCandidates),
    },
    packages,
    accepted_candidates: acceptedCandidates,
    rejected_candidates: rejectedCandidates,
    summary: {
      package_count: packages.length,
      candidate_count: allCandidates.length,
      accepted_candidate_count: acceptedCandidates.length,
      attachment_ready_candidate_count: attachmentReadyCandidates.length,
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
  assertValidStage5bIntakeReport(report, {
    label: 'inspection evidence intake report',
    projectRoot: resolvedRoot,
  });
  return report;
}

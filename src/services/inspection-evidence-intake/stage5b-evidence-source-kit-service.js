import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';

const execFile = promisify(execFileCallback);

export const STAGE5B_EVIDENCE_SOURCE_KIT_ARTIFACT_TYPE = 'stage5b_evidence_source_kit';
export const STAGE5B_EVIDENCE_SOURCE_PREFLIGHT_ARTIFACT_TYPE = 'stage5b_evidence_source_preflight';
export const STAGE5B_EVIDENCE_SOURCE_SCHEMA_VERSION = '1.0';

const INBOX_BASE = 'local/stage5b-candidate-evidence-inbox';
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const ACQUISITION_ONLY_NOTE = 'Stage 5B evidence source acquisition/preflight only: this helper never attaches evidence, never regenerates readiness, and never marks canonical packages ready.';

const ACCEPTED_SOURCE_TYPES = new Set([
  'cmm_report',
  'manual_caliper_check',
  'go_no_go_gauge',
  'first_article_inspection',
  'supplier_inspection_report',
  'other_inspection_source',
]);

const PHYSICAL_ORIGIN_VALUES = new Set([
  'physical',
  'supplier',
  'lab',
  'qa',
  'quality',
  'quality_assurance',
]);

const COMPLETED_STATUS_VALUES = new Set([
  'complete',
  'completed',
  'closed',
  'final',
  'released',
  'approved',
]);

const OVERALL_RESULTS = new Set(['pass', 'fail', 'partial']);
const FEATURE_RESULTS = new Set(['pass', 'fail', 'partial']);

const HEADER_ALIASES = Object.freeze({
  package_id: ['package_id', 'package', 'package_slug'],
  inspected_part: ['inspected_part', 'part', 'part_id', 'part_number', 'part_name'],
  revision: ['part_revision', 'revision', 'drawing_revision', 'package_revision', 'inspected_revision'],
  inspection_date: ['inspection_date', 'inspected_at', 'date', 'completed_at'],
  source_type: ['source_type', 'inspection_source_type', 'inspection_type', 'report_type'],
  origin_category: ['origin_category', 'inspection_origin', 'source_origin'],
  inspection_status: ['inspection_status', 'status', 'completion_status', 'record_status'],
  inspector: ['inspector', 'inspection_author', 'author'],
  reviewed_by: ['reviewed_by', 'reviewer', 'qa_reviewer', 'approved_by', 'quality_reviewer'],
  units: ['units', 'unit'],
  overall_result: ['overall_result', 'overall_status', 'overall_disposition', 'inspection_result'],
  feature_id: ['feature_id', 'feature', 'feature_name', 'characteristic', 'characteristic_id', 'dimension_id'],
  measured_value: ['measured_value', 'measurement', 'measured', 'actual', 'actual_value', 'observed_value'],
  tolerance_upper: ['tolerance_upper', 'upper_tolerance', 'upper_tol', 'tol_plus', 'plus_tolerance'],
  tolerance_lower: ['tolerance_lower', 'lower_tolerance', 'lower_tol', 'tol_minus', 'minus_tolerance'],
  result: ['result', 'feature_result', 'disposition'],
  measurement_method: ['measurement_method', 'method', 'inspection_method', 'instrument', 'gauge'],
});

const NON_EVIDENCE_PATH_RULES = Object.freeze([
  ['screenshot_not_evidence', /\.(?:png|jpe?g|gif|webp|heic|tiff?)$/i],
  ['cad_or_generated_values_not_evidence', /\.(?:step|stp|stl|brep|fcstd|dxf)$/i],
  ['cad_or_generated_values_not_evidence', /(^|\/)[^/]*(?:_create_quality|_drawing_quality|_drawing_qa|_drawing_intent|_feature_catalog|_extracted_drawing_semantics|_dfm_report)\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['readiness_artifact_not_evidence', /(^|\/)(?:readiness_report|readiness-report)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i],
  ['review_artifact_not_evidence', /(^|\/)(?:review_pack|review-pack)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i],
  ['release_bundle_not_evidence', /(^|\/)release_bundle(?:\.zip|_manifest\.json|_log\.json|_checksums\.sha256)$/i],
  ['release_bundle_not_evidence', /(^|\/)release-bundle(?:\.zip|-manifest\.json|-log\.json|-checksums\.sha256)$/i],
  ['manifest_artifact_not_evidence', /(^|\/)(?:artifact-manifest|output-manifest|standard_docs_manifest)\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['surrogate_artifact_not_evidence', /(^|\/)[^/]*surrogate[^/]*\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['fixture_not_evidence', /^tests\/fixtures\//i],
  ['schema_not_evidence', /^schemas\//i],
  ['ci_artifact_not_evidence', /^\.github\//i],
  ['ci_artifact_not_evidence', /(^|\/)(?:github|ci|check-run|workflow|actions?)[-_]?(?:metadata|summary|run|comment|pr-body|pull-request-body|artifact)\.(?:json|md|txt|yml|yaml)$/i],
  ['template_not_evidence', /(^|\/)(?:template|templates|sample|example)[^/]*\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['docs_example_artifact_not_raw_source', /^docs\/examples\//i],
  ['docs_or_collection_guide_not_evidence', /^docs\/inspection-evidence-collection\//i],
]);

const GENERATED_ARTIFACT_TYPES = new Set([
  'artifact_manifest',
  'audit_manifest',
  'cad_generated_measurement',
  'canonical_package',
  'ci_metadata',
  'create_quality',
  'create_quality_report',
  'dfm_report',
  'diagnostics',
  'docs_manifest',
  'drawing_intent',
  'drawing_qa',
  'drawing_quality',
  'feature_catalog',
  'inspection_evidence_intake_report',
  'inspection_evidence_promotion_dry_run_manifest',
  'output_manifest',
  'readiness_report',
  'release_bundle',
  'release_bundle_manifest',
  'review_pack',
  'schema',
  'screenshot',
  'stage5b_attachment_authorization_record',
  'stage5b_evidence_audit_manifest',
  'stage5b_validation_diagnostics',
  'standard_docs_manifest',
  'surrogate_inspection_validation',
  'synthetic_stage5b_pipeline_fixture',
  'template',
]);

const NON_GENUINE_TEXT_PATTERN = /synthetic|surrogate|fixture|template only|template_only|example only|collection guide|generated|simulated|inferred|cad-generated|non[-_/ ]?evidence|not readiness evidence|not package readiness evidence/i;
const CAD_GENERATED_TEXT_PATTERN = /freecad|cad[-_ ]?generated|model probe|geometry probe|drawing extraction|techdraw|simulated|synthetic|inferred/i;

const SAFETY_PATTERNS = Object.freeze([
  Object.freeze({
    code: 'token_or_secret',
    severity: 'error',
    pattern: /authorization\s*[:=]|bearer\s+[a-z0-9._-]+|github_pat_[a-z0-9_]+|gh[opsu]_[a-z0-9_]+|access_token=|token=|secret=|api[_-]?key=|aws_secret_access_key/i,
    message: 'Source text appears to contain a token, secret, API key, or authorization header.',
    redaction_guidance: 'Remove credentials and replace them with a neutral provenance note before any review output is shared.',
  }),
  Object.freeze({
    code: 'private_url',
    severity: 'error',
    pattern: /https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])|[^/\s"'`<>]+\.local|[^/\s"'`<>]*intranet[^/\s"'`<>]*)[^\s"'`<>]*/i,
    message: 'Source text appears to contain a private or internal URL.',
    redaction_guidance: 'Replace private URLs with a sanitized source label or a safe repo-relative reviewed reference.',
  }),
  Object.freeze({
    code: 'absolute_local_path',
    severity: 'error',
    pattern: /(?:\/Users\/|\/private\/|\/home\/|\/var\/folders\/|[A-Za-z]:\\|\\\\[^\s"'`<>|]+\\)/i,
    message: 'Source text appears to contain an absolute local or network path.',
    redaction_guidance: 'Remove machine-local paths and use safe repo-relative reviewed references only.',
  }),
  Object.freeze({
    code: 'potential_pii',
    severity: 'error',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{3}-\d{2}-\d{4}\b/i,
    message: 'Source text appears to contain email or government-ID-like PII.',
    redaction_guidance: 'Remove unnecessary direct identifiers; keep only role-based traceability such as supplier QA reviewer or maintainer approver.',
  }),
  Object.freeze({
    code: 'supplier_private_original',
    severity: 'warning',
    pattern: /supplier[-_ ]?private|confidential|proprietary|nda|do not distribute|restricted distribution/i,
    message: 'Source text appears to be a supplier-private or restricted original.',
    redaction_guidance: 'Keep raw originals in the ignored inbox or outside the repo; use a reviewed/redacted derivative for later attachment review.',
  }),
]);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(value = null) {
  return value || new Date().toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function safeSlug(value) {
  const slug = normalizeRepoPath(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`Invalid package slug: ${value}`);
  }
  return slug;
}

function sanitizeSubdir(value) {
  if (!value) return null;
  const normalized = normalizeRepoPath(value);
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.startsWith('~')
    || normalized.includes('\0')
    || normalized.split('/').includes('..')
    || isWindowsAbsolutePath(normalized)
  ) {
    throw new Error(`Invalid inbox subdir: ${value}`);
  }
  return normalized;
}

function inboxPathForPackage(slug, inboxSubdir = null) {
  const base = `${INBOX_BASE}/${safeSlug(slug)}`;
  const subdir = sanitizeSubdir(inboxSubdir);
  return subdir ? `${base}/${subdir}` : base;
}

function packageSlugsOrDefault(packageSlugs = null) {
  const slugs = safeList(packageSlugs).length > 0 ? packageSlugs : CANONICAL_PACKAGE_SLUGS;
  return slugs.map(safeSlug);
}

function relativePathFor(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return {
      raw: pathValue || null,
      absolute: null,
      relative: null,
      inside_project: false,
      absolute_argument: false,
      path_basename: null,
    };
  }

  const root = resolve(projectRoot);
  const raw = pathValue.trim();
  const absoluteArgument = isAbsolute(raw) || isWindowsAbsolutePath(raw);
  const absolute = absoluteArgument ? resolve(raw) : resolve(root, raw);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  const inside = Boolean(rel && !rel.startsWith('..') && !isAbsolute(rel));
  return {
    raw,
    absolute,
    relative: inside ? rel : null,
    inside_project: inside,
    absolute_argument: absoluteArgument,
    path_basename: basename(raw.replaceAll('\\', '/')),
  };
}

async function runGit(projectRoot, args = []) {
  try {
    const { stdout } = await execFile('git', args, {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, status: 0, stdout: stdout || '' };
  } catch (error) {
    return {
      ok: false,
      status: typeof error?.code === 'number' ? error.code : 1,
      stdout: error?.stdout || '',
      stderr: error?.stderr || error?.message || '',
    };
  }
}

async function isGitIgnored(projectRoot, relativePath) {
  if (!relativePath) return null;
  const result = await runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

async function isGitTracked(projectRoot, relativePath) {
  if (!relativePath) return null;
  const result = await runGit(projectRoot, ['ls-files', '--error-unmatch', '--', relativePath]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

function addFinding(findings, {
  code,
  severity = 'error',
  message,
  field = null,
  redaction_guidance = null,
  value_summary = null,
} = {}) {
  const key = `${code}|${field || ''}|${message || ''}`;
  if (findings.some((finding) => `${finding.code}|${finding.field || ''}|${finding.message || ''}` === key)) return;
  findings.push({
    code,
    severity,
    field,
    message,
    redaction_guidance,
    value_summary,
  });
}

function pathFindingCodes(relativePath = '') {
  const normalized = normalizeRepoPath(relativePath);
  return [...new Set(NON_EVIDENCE_PATH_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([code]) => code))];
}

function sourceFormatForPath(relativePath = '') {
  const ext = extname(normalizeRepoPath(relativePath)).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.csv') return 'csv';
  if (ext === '.tsv') return 'tsv';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.txt') return 'txt';
  if (ext) return ext.slice(1);
  return 'unknown';
}

function templateJson(slug) {
  return {
    template_status: 'TEMPLATE_ONLY_NOT_EVIDENCE',
    acquisition_preflight_only: true,
    package_id: slug,
    inspected_part: '<part-number-or-name>',
    part_revision: '<revision>',
    inspection_date: '<YYYY-MM-DD>',
    source_type: '<cmm_report|manual_caliper_check|go_no_go_gauge|first_article_inspection|supplier_inspection_report|other_inspection_source>',
    origin_category: '<physical|supplier|lab|qa>',
    inspection_status: '<completed|final|approved>',
    inspector: '<role-or-redacted-trace>',
    reviewed_by: '<reviewer-or-approver-trace>',
    units: 'mm',
    overall_result: '<pass|fail|partial>',
    measured_features: [
      {
        feature_id: '<drawing-feature-id>',
        measured_value: '<observed-value>',
        tolerance_upper: '<upper-tolerance-number>',
        tolerance_lower: '<lower-tolerance-number>',
        units: 'mm',
        result: '<pass|fail|partial>',
        measurement_method: '<cmm|caliper|gauge|supplier-report-method>',
      },
    ],
    notes: 'Replace placeholders with a genuine completed physical/supplier/lab/QA inspection record before preflight. Do not commit raw private records.',
  };
}

function templateCsv(slug) {
  return [
    'template_status,package_id,inspected_part,part_revision,inspection_date,source_type,origin_category,inspection_status,inspector,reviewed_by,units,overall_result,feature_id,measured_value,tolerance_upper,tolerance_lower,result,measurement_method',
    `TEMPLATE_ONLY_NOT_EVIDENCE,${slug},<part-number-or-name>,<revision>,<YYYY-MM-DD>,supplier_inspection_report,supplier,completed,<role-or-redacted-trace>,<reviewer-or-approver-trace>,mm,pass,<drawing-feature-id>,<observed-value>,<upper-tolerance-number>,<lower-tolerance-number>,pass,<inspection-method>`,
    '',
  ].join('\n');
}

function inboxReadme(slug) {
  return [
    `# Stage 5B Evidence Source Inbox - ${slug}`,
    '',
    ACQUISITION_ONLY_NOTE,
    '',
    'Place only genuine completed physical, supplier, lab, or QA inspection records here for local preflight.',
    'This ignored inbox is not canonical package evidence, and files here are not attached by the kit or preflight command.',
    '',
    'Required source fields:',
    '',
    '- package and part plus revision mapping',
    '- inspection date',
    '- physical/supplier/lab/QA origin type',
    '- completed/final/approved inspection status',
    '- feature IDs, units, measured values, tolerances, and per-feature pass/fail/partial result',
    '- overall pass/fail/partial result',
    '- reviewer or approver traceability',
    '',
    'Before later attachment review, remove or summarize PII, private URLs, absolute local paths, tokens, secrets, and supplier-private originals.',
    'Do not use screenshots, CI artifacts, docs examples, templates, fixtures, CAD/generated values, readiness reports, review packs, release bundles, or surrogate artifacts as real evidence.',
    '',
    'Run:',
    '',
    '```bash',
    `fcad stage5b-evidence-source-preflight --package ${slug} --source ${INBOX_BASE}/${slug}/<received-record.json-or.csv> --out ${INBOX_BASE}/${slug}/source-preflight-report.json`,
    '```',
    '',
    'A ready preflight report only means ready for later Stage 5B review. It does not attach evidence or change readiness.',
    '',
  ].join('\n');
}

async function writeTextFile(pathValue, text) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, text, 'utf8');
}

async function statIfExists(pathValue) {
  try {
    return await stat(pathValue);
  } catch {
    return null;
  }
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

function matrixToObjects(matrix = []) {
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeHeader);
  return matrix.slice(1).map((cells) => headers.reduce((row, header, index) => {
    if (header) row[header] = String(cells[index] ?? '').trim();
    return row;
  }, {})).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

function rowValue(row, aliases = []) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstRowValue(rows = [], aliases = []) {
  for (const row of rows) {
    const value = rowValue(row, aliases);
    if (value !== null) return value;
  }
  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMeasuredValue(value) {
  const number = parseNumber(value);
  if (number !== undefined) return number;
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  return String(value).trim();
}

function setIfPresent(target, key, value) {
  if (value !== null && value !== undefined && value !== '') {
    target[key] = value;
  }
}

function normalizeTableDocument(rows = []) {
  const document = {};
  setIfPresent(document, 'package_id', firstRowValue(rows, HEADER_ALIASES.package_id));
  setIfPresent(document, 'inspected_part', firstRowValue(rows, HEADER_ALIASES.inspected_part));
  setIfPresent(document, 'part_revision', firstRowValue(rows, HEADER_ALIASES.revision));
  setIfPresent(document, 'inspection_date', firstRowValue(rows, HEADER_ALIASES.inspection_date));
  setIfPresent(document, 'source_type', normalizeToken(firstRowValue(rows, HEADER_ALIASES.source_type)));
  setIfPresent(document, 'origin_category', normalizeToken(firstRowValue(rows, HEADER_ALIASES.origin_category)));
  setIfPresent(document, 'inspection_status', firstRowValue(rows, HEADER_ALIASES.inspection_status));
  setIfPresent(document, 'inspector', firstRowValue(rows, HEADER_ALIASES.inspector));
  setIfPresent(document, 'reviewed_by', firstRowValue(rows, HEADER_ALIASES.reviewed_by));
  setIfPresent(document, 'units', firstRowValue(rows, HEADER_ALIASES.units));
  setIfPresent(document, 'overall_result', normalizeToken(firstRowValue(rows, HEADER_ALIASES.overall_result)));

  document.measured_features = rows.map((row) => {
    const feature = {};
    setIfPresent(feature, 'feature_id', rowValue(row, HEADER_ALIASES.feature_id));
    setIfPresent(feature, 'measured_value', parseMeasuredValue(rowValue(row, HEADER_ALIASES.measured_value)));
    setIfPresent(feature, 'tolerance_upper', parseNumber(rowValue(row, HEADER_ALIASES.tolerance_upper)));
    setIfPresent(feature, 'tolerance_lower', parseNumber(rowValue(row, HEADER_ALIASES.tolerance_lower)));
    setIfPresent(feature, 'units', rowValue(row, HEADER_ALIASES.units) || document.units);
    setIfPresent(feature, 'result', normalizeToken(rowValue(row, HEADER_ALIASES.result)));
    setIfPresent(feature, 'measurement_method', rowValue(row, HEADER_ALIASES.measurement_method));
    return feature;
  }).filter((feature) => Object.keys(feature).length > 0);

  return document;
}

async function parseSource(source) {
  if (!source.exists) {
    return {
      raw_text: '',
      document: null,
      parse_ok: false,
      parse_errors: [],
    };
  }

  const raw = await readFile(source.absolute_path, 'utf8');
  const format = source.source_format;
  if (format === 'json') {
    try {
      return {
        raw_text: raw,
        document: JSON.parse(raw),
        parse_ok: true,
        parse_errors: [],
      };
    } catch (error) {
      return {
        raw_text: raw,
        document: null,
        parse_ok: false,
        parse_errors: [`JSON source could not be parsed: ${error.message}`],
      };
    }
  }

  if (format === 'csv' || format === 'tsv') {
    const rows = matrixToObjects(parseDelimitedRows(raw, format === 'csv' ? ',' : '\t'));
    if (rows.length === 0) {
      return {
        raw_text: raw,
        document: null,
        parse_ok: false,
        parse_errors: ['table source has no machine-readable header/data rows'],
      };
    }
    return {
      raw_text: raw,
      document: normalizeTableDocument(rows),
      parse_ok: true,
      parse_errors: [],
    };
  }

  return {
    raw_text: raw,
    document: null,
    parse_ok: false,
    parse_errors: [`unsupported source format: ${format}`],
  };
}

function firstString(document, fields = []) {
  for (const field of fields) {
    const value = document?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function hasRevision(document = {}) {
  return Boolean(firstString(document, [
    'part_revision',
    'revision',
    'drawing_revision',
    'package_revision',
    'inspected_revision',
  ]));
}

function hasReviewerTrace(document = {}) {
  return Boolean(firstString(document, [
    'reviewed_by',
    'approved_by',
    'qa_reviewer',
    'reviewer',
    'quality_reviewer',
  ])) || safeList(document.reviewer_traceability).length > 0 || safeList(document.traceability_refs).length > 0;
}

function measuredFeatures(document = {}) {
  return safeList(document.measured_features).filter((feature) => feature && typeof feature === 'object' && !Array.isArray(feature));
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function checkItem(id, label, passed, message) {
  return {
    id,
    label,
    status: passed ? 'pass' : 'fail',
    message: passed ? 'ok' : message,
  };
}

function buildRequiredFieldChecks(document = {}) {
  const features = measuredFeatures(document);
  const sourceType = normalizeToken(document.source_type);
  const completionStatus = normalizeToken(firstString(document, ['inspection_status', 'status', 'completion_status', 'record_status']));
  const originCategory = normalizeToken(firstString(document, ['origin_category', 'inspection_origin', 'source_origin']));
  const overallResult = normalizeToken(document.overall_result);

  return [
    checkItem(
      'package_part_revision',
      'Package, part, and revision mapping',
      Boolean(firstString(document, ['package_id', 'package', 'package_slug']))
        && Boolean(firstString(document, ['inspected_part', 'part', 'part_id']))
        && hasRevision(document),
      'source must include package, inspected part, and revision mapping'
    ),
    checkItem(
      'inspection_date',
      'Inspection date',
      Boolean(firstString(document, ['inspection_date', 'inspected_at', 'date', 'completed_at'])),
      'source must include inspection_date or inspected_at'
    ),
    checkItem(
      'origin_type',
      'Physical/supplier/lab/QA origin type',
      ACCEPTED_SOURCE_TYPES.has(sourceType)
        && (sourceType !== 'other_inspection_source' || PHYSICAL_ORIGIN_VALUES.has(originCategory)),
      'source_type must be a physical/supplier/lab/QA inspection origin; other_inspection_source needs origin_category'
    ),
    checkItem(
      'completed_status',
      'Completed inspection status',
      COMPLETED_STATUS_VALUES.has(completionStatus),
      'inspection status must be completed, final, approved, closed, or released'
    ),
    checkItem(
      'feature_ids',
      'Measured feature IDs',
      features.length > 0 && features.every((feature) => hasValue(feature.feature_id)),
      'each measured feature must include feature_id'
    ),
    checkItem(
      'units',
      'Units',
      Boolean(firstString(document, ['units']))
        || (features.length > 0 && features.every((feature) => hasValue(feature.units))),
      'record or each measured feature must include units'
    ),
    checkItem(
      'measured_values',
      'Measured values',
      features.length > 0 && features.every((feature) => hasValue(feature.measured_value)),
      'each measured feature must include measured_value'
    ),
    checkItem(
      'tolerances',
      'Tolerances',
      features.length > 0 && features.every((feature) => hasValue(feature.tolerance_upper) && hasValue(feature.tolerance_lower)),
      'each measured feature must include tolerance_upper and tolerance_lower'
    ),
    checkItem(
      'feature_results',
      'Per-feature result',
      features.length > 0 && features.every((feature) => FEATURE_RESULTS.has(normalizeToken(feature.result))),
      'each measured feature must include pass, fail, or partial result'
    ),
    checkItem(
      'overall_result',
      'Overall result',
      OVERALL_RESULTS.has(overallResult),
      'overall_result must be pass, fail, or partial'
    ),
    checkItem(
      'reviewer_approver_traceability',
      'Reviewer/approver traceability',
      hasReviewerTrace(document),
      'source must include reviewer, approver, QA reviewer, or equivalent traceability'
    ),
  ];
}

function scanRawSafety(rawText = '', document = {}) {
  const text = [
    rawText,
    JSON.stringify(safeObject(document)),
  ].filter(Boolean).join('\n');
  const findings = [];
  for (const rule of SAFETY_PATTERNS) {
    if (rule.pattern.test(text)) {
      addFinding(findings, rule);
    }
  }
  return findings;
}

function scanDocumentBoundary(document = {}, sourceFindings = []) {
  const artifactType = normalizeToken(document.artifact_type || document.type || document.artifact_kind || document.record_type);
  if (GENERATED_ARTIFACT_TYPES.has(artifactType)) {
    addFinding(sourceFindings, {
      code: artifactType.includes('surrogate') ? 'surrogate_artifact_not_evidence' : 'generated_control_artifact_not_evidence',
      severity: 'error',
      field: 'artifact_type',
      message: `${artifactType} is a generated/control artifact type, not a raw completed inspection source.`,
      redaction_guidance: 'Provide the original completed physical/supplier/lab/QA inspection record instead of generated control artifacts.',
    });
  }

  const documentText = [
    document.notes,
    document.description,
    document.summary,
    document.source_description,
    document.template_status,
    document.inspection_status,
  ].filter((value) => typeof value === 'string').join('\n');
  if (NON_GENUINE_TEXT_PATTERN.test(documentText)) {
    addFinding(sourceFindings, {
      code: /surrogate/i.test(documentText) ? 'surrogate_artifact_not_evidence' : 'synthetic_or_generated_not_evidence',
      severity: 'error',
      field: 'notes',
      message: 'Source text labels itself as synthetic, surrogate, fixture, template, generated, simulated, inferred, or non-evidence.',
      redaction_guidance: 'Replace templates/surrogates/generated records with a genuine completed inspection source.',
    });
  }

  measuredFeatures(document).forEach((feature, index) => {
    const methodText = [
      feature.measurement_method,
      feature.measurement_source,
      feature.value_origin,
      feature.source,
    ].filter((value) => typeof value === 'string').join('\n');
    if (CAD_GENERATED_TEXT_PATTERN.test(methodText)) {
      addFinding(sourceFindings, {
        code: 'cad_or_generated_values_not_evidence',
        severity: 'error',
        field: `measured_features/${index}/measurement_method`,
        message: 'Measured values appear to come from CAD, FreeCAD, drawing extraction, simulation, synthetic, or inferred sources.',
        redaction_guidance: 'Use measurements from physical/supplier/lab/QA inspection instruments or reports only.',
      });
    }
  });
}

async function readReadinessState(projectRoot, slug) {
  const path = `docs/examples/${slug}/readiness/readiness_report.json`;
  try {
    const document = JSON.parse(await readFile(resolve(projectRoot, path), 'utf8'));
    const summary = safeObject(document.readiness_summary || document.summary);
    return {
      status: summary.status || null,
      score: typeof summary.score === 'number' ? summary.score : null,
      gate_decision: summary.gate_decision || null,
      missing_inputs: safeList(summary.missing_inputs),
      source_of_truth_path: path,
    };
  } catch {
    return {
      status: 'needs_more_evidence',
      score: null,
      gate_decision: 'hold_for_evidence_completion',
      missing_inputs: ['inspection_evidence'],
      source_of_truth_path: path,
    };
  }
}

function summarizeDocument(document = {}) {
  return {
    package_id: firstString(document, ['package_id', 'package', 'package_slug']),
    inspected_part: firstString(document, ['inspected_part', 'part', 'part_id']),
    revision: firstString(document, ['part_revision', 'revision', 'drawing_revision', 'package_revision', 'inspected_revision']),
    inspection_date: firstString(document, ['inspection_date', 'inspected_at', 'date', 'completed_at']),
    source_type: firstString(document, ['source_type']),
    inspection_status: firstString(document, ['inspection_status', 'status', 'completion_status', 'record_status']),
    overall_result: firstString(document, ['overall_result']),
    measured_feature_count: measuredFeatures(document).length,
    measured_feature_ids: uniqueStrings(measuredFeatures(document).map((feature) => String(feature.feature_id || ''))),
  };
}

function buildBoundary() {
  return {
    hard_evidence_rule: HARD_EVIDENCE_RULE,
    acquisition_preflight_only: true,
    does_not_attach_evidence: true,
    does_not_promote_evidence: true,
    does_not_regenerate_readiness: true,
    does_not_mark_canonical_packages_ready: true,
    does_not_mutate_canonical_artifacts: true,
    later_attachment_flow_required: true,
    rejected_as_real_evidence_sources: [
      'surrogate or synthetic artifacts',
      'generated CAD/drawing/readiness/review/release/control artifacts',
      'screenshots',
      'CI/GitHub metadata',
      'docs examples',
      'templates',
      'fixtures',
      'CAD/generated values',
      'readiness reports',
    ],
  };
}

function classifyPreflight({ source, requiredFieldChecks, sourceFindings, safetyFindings }) {
  if (!source?.path_supplied || source.exists === false) {
    return {
      classification: 'needs_more_source_detail',
      source_status: 'READY_FOR_SOURCE',
      ready_for_later_attachment_flow: false,
      message: 'Place a genuine completed inspection record in the ignored local inbox, then rerun source preflight.',
    };
  }

  const hasError = [...sourceFindings, ...safetyFindings].some((finding) => finding.severity === 'error');
  if (hasError) {
    return {
      classification: 'unsafe_or_not_evidence',
      source_status: 'SOURCE_REJECTED_OR_UNSAFE',
      ready_for_later_attachment_flow: false,
      message: 'Source is unsafe or belongs to a non-evidence/generated/control source class.',
    };
  }

  const requiredFieldsPass = requiredFieldChecks.every((check) => check.status === 'pass');
  if (!requiredFieldsPass) {
    return {
      classification: 'needs_more_source_detail',
      source_status: 'NEEDS_MORE_SOURCE_DETAIL',
      ready_for_later_attachment_flow: false,
      message: 'Source exists in the ignored inbox, but required completed-inspection fields need more detail.',
    };
  }

  return {
    classification: 'ready_for_stage5b_review',
    source_status: 'SOURCE_PREFLIGHT_READY',
    ready_for_later_attachment_flow: true,
    message: 'Source is ready for later Stage 5B review only; no evidence has been attached.',
  };
}

export async function buildStage5bEvidenceSourceKit({
  projectRoot = process.cwd(),
  packageSlugs = null,
  inboxSubdir = null,
  generatedAt = null,
} = {}) {
  const root = resolve(projectRoot);
  const generated = nowIso(generatedAt);
  const slugs = packageSlugsOrDefault(packageSlugs);
  const inboxes = [];

  for (const slug of slugs) {
    const inboxRelativePath = inboxPathForPackage(slug, inboxSubdir);
    const inboxAbsolutePath = resolve(root, inboxRelativePath);
    const files = [
      {
        kind: 'readme',
        path: `${inboxRelativePath}/README.md`,
        body: inboxReadme(slug),
      },
      {
        kind: 'json_template',
        path: `${inboxRelativePath}/inspection-evidence-template.json`,
        body: `${JSON.stringify(templateJson(slug), null, 2)}\n`,
      },
      {
        kind: 'csv_template',
        path: `${inboxRelativePath}/inspection-evidence-template.csv`,
        body: templateCsv(slug),
      },
    ];

    await mkdir(inboxAbsolutePath, { recursive: true });
    for (const file of files) {
      await writeTextFile(resolve(root, file.path), file.body);
    }

    const ignored = await isGitIgnored(root, `${inboxRelativePath}/README.md`);
    const tracked = await isGitTracked(root, `${inboxRelativePath}/README.md`);
    inboxes.push({
      package_slug: slug,
      path: inboxRelativePath,
      ignored_by_git: ignored === true,
      tracked_by_git: tracked === true,
      checklist_path: files[0].path,
      json_template_path: files[1].path,
      csv_template_path: files[2].path,
      files_written: files.map((file) => ({
        kind: file.kind,
        path: file.path,
      })),
    });
  }

  return {
    artifact_type: STAGE5B_EVIDENCE_SOURCE_KIT_ARTIFACT_TYPE,
    schema_version: STAGE5B_EVIDENCE_SOURCE_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: true,
    acquisition_preflight_only: true,
    requested_package_slugs: slugs,
    summary: {
      inbox_count: inboxes.length,
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      message: ACQUISITION_ONLY_NOTE,
    },
    inboxes,
    evidence_boundary: buildBoundary(),
  };
}

export async function preflightStage5bEvidenceSource({
  projectRoot = process.cwd(),
  packageSlug = null,
  sourcePath = null,
  inboxSubdir = null,
  generatedAt = null,
} = {}) {
  const root = resolve(projectRoot);
  const generated = nowIso(generatedAt);
  const slug = safeSlug(packageSlug || CANONICAL_PACKAGE_SLUGS[0]);
  const kit = await buildStage5bEvidenceSourceKit({
    projectRoot: root,
    packageSlugs: [slug],
    inboxSubdir,
    generatedAt: generated,
  });
  const readinessBefore = await readReadinessState(root, slug);
  const sourceFindings = [];
  let safetyFindings = [];
  let document = {};
  let rawText = '';
  let parseOk = false;
  let parseErrors = [];

  const sourceRef = relativePathFor(root, sourcePath);
  const source = {
    path_supplied: Boolean(sourcePath),
    path: sourceRef.relative || (sourcePath ? sourceRef.path_basename : null),
    absolute_path: sourceRef.relative ? sourceRef.absolute : null,
    source_format: sourceRef.relative ? sourceFormatForPath(sourceRef.relative) : null,
    exists: false,
    ignored_by_git: null,
    tracked_by_git: null,
    inside_project: sourceRef.inside_project,
    size_bytes: null,
  };

  if (!sourcePath) {
    addFinding(sourceFindings, {
      code: 'source_path_not_supplied',
      severity: 'info',
      field: 'source',
      message: 'No raw source path was supplied.',
      redaction_guidance: 'Place a genuine completed inspection source in the ignored inbox and rerun with --source.',
    });
  } else if (!sourceRef.inside_project) {
    addFinding(sourceFindings, {
      code: 'source_path_outside_repo',
      severity: 'error',
      field: 'source',
      message: 'Source path must stay inside this repository for local preflight.',
      redaction_guidance: 'Copy a reviewed/redacted source into the ignored local inbox before preflight.',
      value_summary: sourceRef.path_basename,
    });
  } else {
    const sourceStats = await statIfExists(sourceRef.absolute);
    source.exists = Boolean(sourceStats?.isFile());
    source.size_bytes = sourceStats?.isFile() ? sourceStats.size : null;
    source.ignored_by_git = await isGitIgnored(root, sourceRef.relative);
    source.tracked_by_git = await isGitTracked(root, sourceRef.relative);

    if (sourceRef.absolute_argument) {
      addFinding(sourceFindings, {
        code: 'absolute_source_argument',
        severity: 'error',
        field: 'source',
        message: 'Source path was supplied as an absolute path.',
        redaction_guidance: 'Use the repo-relative ignored inbox path so reports do not expose machine-local paths.',
        value_summary: sourceRef.path_basename,
      });
    }
    if (!source.exists) {
      addFinding(sourceFindings, {
        code: 'source_path_not_found',
        severity: 'warning',
        field: 'source',
        message: 'Source path was supplied but no file exists there.',
        redaction_guidance: 'Place the real completed source file at the ignored inbox path before rerunning preflight.',
      });
    } else {
      if (source.ignored_by_git !== true) {
        addFinding(sourceFindings, {
          code: 'source_file_not_ignored',
          severity: 'error',
          field: 'source',
          message: 'Raw source file is not ignored by git.',
          redaction_guidance: 'Move raw source material under local/stage5b-candidate-evidence-inbox/<package>/ or update ignore rules before review.',
        });
      }
      if (source.tracked_by_git === true) {
        addFinding(sourceFindings, {
          code: 'tracked_source_file',
          severity: 'error',
          field: 'source',
          message: 'Raw source file is already tracked by git and cannot be treated as private acquisition source.',
          redaction_guidance: 'Use an ignored local inbox source; do not commit raw private inspection records.',
        });
      }
      for (const code of pathFindingCodes(sourceRef.relative)) {
        addFinding(sourceFindings, {
          code,
          severity: 'error',
          field: 'source',
          message: 'Source path belongs to a screenshot, CI, docs, template, fixture, CAD/generated, readiness, review, release, surrogate, or generated-control artifact class.',
          redaction_guidance: 'Provide a genuine completed physical/supplier/lab/QA inspection record from the ignored inbox instead.',
        });
      }
      if (!['json', 'csv', 'tsv'].includes(source.source_format)) {
        addFinding(sourceFindings, {
          code: 'unsupported_source_format',
          severity: 'error',
          field: 'source',
          message: 'Source preflight currently accepts JSON, CSV, and TSV machine-readable records.',
          redaction_guidance: 'Convert a reviewed/redacted completed inspection record into JSON or CSV before later attachment review.',
        });
      }

      const parsed = await parseSource(source);
      rawText = parsed.raw_text;
      document = safeObject(parsed.document);
      parseOk = parsed.parse_ok;
      parseErrors = parsed.parse_errors;
      for (const error of parseErrors) {
        addFinding(sourceFindings, {
          code: 'source_parse_failed',
          severity: 'error',
          field: 'source',
          message: error,
          redaction_guidance: 'Use a machine-readable JSON or CSV/TSV source with explicit inspection headers.',
        });
      }
      safetyFindings = scanRawSafety(rawText, document);
      scanDocumentBoundary(document, sourceFindings);
    }
  }

  const requiredFieldChecks = parseOk ? buildRequiredFieldChecks(document) : buildRequiredFieldChecks({});
  const classification = classifyPreflight({
    source,
    requiredFieldChecks,
    sourceFindings,
    safetyFindings,
  });
  const readinessAfter = await readReadinessState(root, slug);
  const readinessUnchanged = JSON.stringify(readinessBefore) === JSON.stringify(readinessAfter);

  return {
    artifact_type: STAGE5B_EVIDENCE_SOURCE_PREFLIGHT_ARTIFACT_TYPE,
    schema_version: STAGE5B_EVIDENCE_SOURCE_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: true,
    acquisition_preflight_only: true,
    package_slug: slug,
    classification: classification.classification,
    summary: {
      source_status: classification.source_status,
      message: classification.message,
      required_fields_pass: requiredFieldChecks.every((check) => check.status === 'pass'),
      safety_error_count: safetyFindings.filter((finding) => finding.severity === 'error').length,
      source_error_count: sourceFindings.filter((finding) => finding.severity === 'error').length,
      ready_for_later_attachment_flow: classification.ready_for_later_attachment_flow,
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      acquisition_preflight_only: true,
    },
    source: {
      path: source.path,
      exists: source.exists,
      ignored_by_git: source.ignored_by_git,
      tracked_by_git: source.tracked_by_git,
      inside_project: source.inside_project,
      source_format: source.source_format,
      size_bytes: source.size_bytes,
      parse_ok: parseOk,
      parse_errors: parseErrors,
    },
    kit_inbox: kit.inboxes[0],
    parsed_source_summary: parseOk ? summarizeDocument(document) : null,
    required_field_checks: requiredFieldChecks,
    source_findings: sourceFindings,
    safety_findings: safetyFindings,
    readiness_unchanged: {
      unchanged: readinessUnchanged,
      canonical_artifacts_mutated: false,
      evidence_attached: false,
      readiness_regenerated: false,
      before: readinessBefore,
      after: readinessAfter,
      truth: 'canonical packages remain needs_more_evidence / hold_for_evidence_completion until a later explicitly authorized attachment task validates, reviews, attaches genuine evidence, and refreshes package artifacts',
    },
    evidence_boundary: buildBoundary(),
  };
}

import { constants as fsConstants } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { promisify } from 'node:util';

import { parse as parseTOML } from 'smol-toml';

import { assertValidCArtifact } from '../../../lib/c-artifact-schema.js';
import { withCanonicalPackageMutationLock } from '../../../lib/canonical-package-mutation-lock.js';

import {
  InspectionEvidenceOnboardingError,
  appendInspectionEvidenceTransition,
  assertInspectionEvidenceValidation,
  buildAttachedInspectionEvidenceEnvelope,
  decodeInspectionEvidenceUtf8,
  findNonGenuineStringMarkers,
  isValidInspectionEvidenceIdentityRef,
  isSha256,
  isParseableTimestamp,
  parseInspectionEvidenceJsonBytes,
  serializeCanonicalJson,
  sha256Bytes,
  sha256Json,
  summarizeInspectionEvidenceResults,
  validateInspectionEvidenceAttachmentRecordSchema,
  validateInspectionEvidenceAuthorizationBinding,
  validateCanonicalInspectionEvidenceChain,
  validateJsonDocumentBounds,
  validateInspectionEvidenceEnvelopeSchema,
  validateInspectionEvidenceEnvelopeSemantics,
  validateInspectionEvidenceOnboardingRecordSchema,
  validateInspectionEvidenceReadinessAuthorizationSchema,
  validateInspectionEvidenceStateHistory,
  validateInspectionEvidenceControlMaterial,
} from '../../../lib/inspection-evidence-onboarding.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';
import { buildReadinessReportFromReviewPack } from '../../workflows/canonical-readiness-builders.js';

export const INSPECTION_EVIDENCE_QUARANTINE_ROOT = 'local/inspection-evidence-quarantine';
export const INSPECTION_EVIDENCE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const INSPECTION_EVIDENCE_MAX_ENVELOPE_BYTES = 512 * 1024;

const SUPPORTED_MEDIA_TYPES = Object.freeze({
  '.json': 'application/json',
  '.csv': 'text/csv',
});

const execFileAsync = promisify(execFile);

const GENERATED_EXTENSIONS = new Set([
  '.step', '.stp', '.stl', '.brep', '.fcstd', '.dxf', '.dwg', '.svg',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.tif', '.tiff', '.zip',
  '.log', '.xml',
]);

const GENERATED_PATH_PATTERN = /(?:^|\/)(?:\.github|output|tmp\/codex|tests\/fixtures|configs\/examples|schemas|cad|drawing|quality|readiness|review|release|runtime|standard-docs(?:-korea)?)(?:\/|$)/i;
const GENERATED_CONTENT_PATTERN = /(?:QIFLiteInspection|evidence_class=["']generated_or_control["']|trusted_inspection_evidence=["']false["']|artifact_type["']?\s*[:=]\s*["']?(?:readiness_report|review_pack|evidence_graph|feature_catalog|extracted_drawing_semantics|docs_manifest|runtime_fingerprint|release_bundle_manifest|create_quality|drawing_quality|drawing_qa|drawing_intent|release_bundle|output_manifest|artifact_manifest|runtime_smoke|surrogate_inspection_validation|engineering_context|geometry_intelligence|inspection_linkage|inspection_outliers|quality_linkage|quality_hotspots|review_priorities|process_plan|quality_risk|dfm_report)|["']generated["']\s*:\s*true|["']command["']\s*:\s*["'](?:create|draw|report|pack)["']|["']agent["']\s*:\s*["']product_review["']|["']comparison_type["']\s*:\s*["']cross_site_stabilization_example["']|["']workflow["']\s*:\s*["']standard_docs_generation["']|["']file["']\s*:\s*["'][^"']+\.svg["']|["']required_views["']\s*:|["']bundle_output_path["']\s*:|github[._ -]?actions|workflow_run|check_run|ISO-10303-21|<\s*svg\b|FreeCAD|TechDraw|solid\s+[A-Za-z0-9_.-]+\s*(?:\r?\n|facet\s+normal))/i;
const GENERATED_STANDARD_DOC_CSV_PATTERN = /^(?:\uFEFF)?(?:checkpoint,target,tolerance,method,sample_size,judgement_rule,remarks|process_step,failure_mode,effect,likely_cause,current_control,recommended_action,follow_up_role|process_step,station_id,characteristic,spec_or_target,control_method,frequency,reaction_plan,owner)(?:\r?\n|$)/i;
const SYNTHETIC_CONTENT_PATTERN = /(?:^|[^A-Za-z0-9])(?:synthetic|fixture|surrogate|simulated|test[-_ ]?only|non[-_ /]?evidence|example[-_ ]?only|template)(?:[^A-Za-z0-9]|$)|["'](?:synthetic|fixture|surrogate)["']\s*:\s*true/i;
function nowIso(explicitValue = null) {
  return typeof explicitValue === 'string' && explicitValue.trim()
    ? explicitValue.trim()
    : new Date().toISOString();
}

function normalizePathText(value) {
  return typeof value === 'string' ? value.trim().replaceAll('\\', '/') : '';
}

function repoRelative(root, absolutePath) {
  return relative(root, absolutePath).replaceAll('\\', '/');
}

function isInside(root, target) {
  const rel = repoRelative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function ensureRealChildDirectory(parentReal, childName, label) {
  const target = join(parentReal, childName);
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new InspectionEvidenceOnboardingError('unsafe_directory_boundary', `${label} must be a real directory, not a symlink or file`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(target, { mode: 0o700 });
  }
  const targetReal = await realpath(target);
  if (targetReal !== target || !isInside(parentReal, targetReal)) {
    throw new InspectionEvidenceOnboardingError('directory_escape', `${label} escaped its required parent directory`);
  }
  return targetReal;
}

async function ensureSafeQuarantineDirectory(projectRoot, packageSlug, recordKey) {
  const rootReal = await realpath(resolve(projectRoot));
  const localReal = await ensureRealChildDirectory(rootReal, 'local', 'Local private-data directory');
  const quarantineReal = await ensureRealChildDirectory(localReal, 'inspection-evidence-quarantine', 'Inspection evidence quarantine');
  const packageReal = await ensureRealChildDirectory(quarantineReal, packageSlug, 'Package quarantine directory');
  const recordReal = await ensureRealChildDirectory(packageReal, recordKey, 'Content-addressed quarantine record');
  return { rootReal, quarantineReal, recordReal };
}

function assertSafeInputPathText(pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw new InspectionEvidenceOnboardingError('path_required', `${label} path is required`);
  }
  const raw = pathValue.trim();
  const normalized = raw.replaceAll('\\', '/');
  if (
    raw.includes('\0')
    || raw.includes('\\')
    || raw.startsWith('~')
    || normalized.split('/').includes('..')
  ) {
    throw new InspectionEvidenceOnboardingError('unsafe_path', `${label} path contains traversal, NUL, backslash, or home expansion syntax`);
  }
}

async function readRegularFileNoFollow(pathValue, {
  label,
  maxBytes,
} = {}) {
  assertSafeInputPathText(pathValue, label);
  const absolute = resolve(pathValue);
  const linkInfo = await lstat(absolute);
  if (linkInfo.isSymbolicLink()) {
    throw new InspectionEvidenceOnboardingError('symlink_forbidden', `${label} must not be a symlink`);
  }
  if (!linkInfo.isFile()) {
    throw new InspectionEvidenceOnboardingError('regular_file_required', `${label} must be a regular file`);
  }
  if (linkInfo.size <= 0 || linkInfo.size > maxBytes) {
    throw new InspectionEvidenceOnboardingError('file_size_out_of_bounds', `${label} must be between 1 and ${maxBytes} bytes`);
  }

  const handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const handleStat = await handle.stat();
    if (!handleStat.isFile() || handleStat.size !== linkInfo.size) {
      throw new InspectionEvidenceOnboardingError('file_changed_during_read', `${label} changed while it was being received`);
    }
    const bytes = await handle.readFile();
    const afterStat = await handle.stat();
    if (afterStat.size !== handleStat.size || afterStat.mtimeMs !== handleStat.mtimeMs) {
      throw new InspectionEvidenceOnboardingError('file_changed_during_read', `${label} changed while it was being received`);
    }
    return {
      absolute,
      real: await realpath(absolute),
      bytes,
      sizeBytes: bytes.byteLength,
      sha256: sha256Bytes(bytes),
      filename: basename(absolute),
    };
  } finally {
    await handle.close();
  }
}

async function assertSafeQuarantineRecordPath(projectRoot, pathValue) {
  assertSafeInputPathText(pathValue, 'onboarding record');
  const rootReal = await realpath(resolve(projectRoot));
  const quarantineRoot = resolve(rootReal, INSPECTION_EVIDENCE_QUARANTINE_ROOT);
  const quarantineInfo = await lstat(quarantineRoot);
  if (quarantineInfo.isSymbolicLink() || !quarantineInfo.isDirectory()) {
    throw new InspectionEvidenceOnboardingError('unsafe_quarantine_root', 'Inspection evidence quarantine root must be a real directory');
  }
  const quarantineReal = await realpath(quarantineRoot);
  if (quarantineReal !== quarantineRoot || !isInside(rootReal, quarantineReal)) {
    throw new InspectionEvidenceOnboardingError('quarantine_escape', 'Inspection evidence quarantine must remain a real directory inside the repository');
  }
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(rootReal, pathValue);
  if (basename(absolute) !== 'onboarding-record.json') {
    throw new InspectionEvidenceOnboardingError('live_onboarding_record_required', 'Operations must use the mutable onboarding-record.json ledger; immutable authorized snapshots are verification inputs only');
  }
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new InspectionEvidenceOnboardingError('unsafe_onboarding_record', 'Onboarding record must be a regular non-symlink file');
  }
  const fileReal = await realpath(absolute);
  if (!isInside(quarantineReal, fileReal)) {
    throw new InspectionEvidenceOnboardingError('quarantine_escape', 'Onboarding record must remain inside the ignored inspection evidence quarantine');
  }
  return {
    absolute: fileReal,
    relative: repoRelative(rootReal, fileReal),
    rootReal,
    quarantineReal,
  };
}

async function atomicWrite(pathValue, content, { replace = false } = {}) {
  const target = resolve(pathValue);
  await mkdir(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    if (replace) {
      await rename(temp, target);
    } else {
      try {
        await link(temp, target);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new InspectionEvidenceOnboardingError('immutable_target_exists', `Refusing to overwrite existing immutable file ${basename(target)}`);
        }
        throw error;
      }
      await unlink(temp);
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(pathValue, label) {
  let raw;
  try {
    raw = await readFile(pathValue);
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('file_read_failed', `${label} could not be read`, { cause: error.message });
  }
  try {
    return { document: parseInspectionEvidenceJsonBytes(raw), raw };
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('malformed_json', `${label} is malformed JSON`, { cause: error.message });
  }
}

export function classifyInspectionEvidenceCandidate({ filename, sourcePathText, bytes }) {
  const extension = extname(filename).toLowerCase();
  const mediaType = SUPPORTED_MEDIA_TYPES[extension] || (
    extension === '.xml' ? 'application/xml' : 'application/octet-stream'
  );
  const pathText = normalizePathText(sourcePathText);
  const sample = bytes.toString('utf8');
  const reasons = [];
  let classification = 'candidate';

  if (
    GENERATED_EXTENSIONS.has(extension)
    || GENERATED_PATH_PATTERN.test(pathText)
    || GENERATED_CONTENT_PATTERN.test(sample)
    || GENERATED_STANDARD_DOC_CSV_PATTERN.test(sample)
  ) {
    classification = 'generated_or_control';
    reasons.push(extension === '.xml' && /QIFLiteInspection/i.test(sample)
      ? 'generated_qif_lite_control_xml'
      : 'generated_cad_drawing_ci_or_control_artifact');
  }
  if (SYNTHETIC_CONTENT_PATTERN.test(sample)) {
    classification = 'synthetic_fixture';
    reasons.push('synthetic_fixture_content_marker');
  }
  if (!Object.hasOwn(SUPPORTED_MEDIA_TYPES, extension) && classification === 'candidate') {
    classification = 'unsupported_format';
    reasons.push(extension === '.xml' ? 'xml_and_full_qif_unsupported' : 'unsupported_source_container');
  }
  return { classification, reasons: [...new Set(reasons)], mediaType, extension };
}

async function matchesRepositoryControlledFile(projectRoot, candidate) {
  const root = await realpath(resolve(projectRoot));
  const localInbox = join(root, 'local', 'stage5b-candidate-evidence-inbox');
  const localQuarantine = join(root, ...INSPECTION_EVIDENCE_QUARANTINE_ROOT.split('/'));
  if (
    isInside(root, candidate.real)
    && !isInside(localInbox, candidate.real)
    && !isInside(localQuarantine, candidate.real)
  ) return true;
  let trackedOutput;
  try {
    ({ stdout: trackedOutput } = await execFileAsync('git', ['-C', root, 'ls-files', '-z'], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    }));
  } catch (error) {
    throw new InspectionEvidenceOnboardingError(
      'repository_fingerprint_unavailable',
      'Tracked repository artifact fingerprints could not be established; intake fails closed',
      { cause: error.message }
    );
  }
  const trackedPaths = trackedOutput.toString('utf8').split('\0').filter(Boolean);
  for (const relativePath of trackedPaths) {
    const absolute = resolve(root, relativePath);
    if (!isInside(root, absolute)) continue;
    let info;
    try {
      info = await lstat(absolute);
    } catch {
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size !== candidate.sizeBytes || info.size <= 0) continue;
    try {
      if (sha256Bytes(await readFile(absolute)) === candidate.sha256) return true;
    } catch {
      // A tracked file that changes during the scan will be re-evaluated on the next intake attempt.
    }
  }
  return false;
}

function strictCsvValidation(bytes) {
  let text;
  try {
    text = decodeInspectionEvidenceUtf8(bytes);
  } catch {
    return ['malformed_source_csv_encoding'];
  }
  if (text.includes('\0')) return ['csv_contains_nul'];
  if (/\r(?!\n)/.test(text)) return ['csv_stray_carriage_return'];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let justClosedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        justClosedQuote = true;
      } else {
        field += char;
      }
      continue;
    }
    if (justClosedQuote) {
      if (char === ',') {
        row.push(field);
        field = '';
        justClosedQuote = false;
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        justClosedQuote = false;
        if (rows.length > 10001) return ['csv_row_limit_exceeded'];
      } else if (char === '\r' && text[index + 1] === '\n') {
        // Preserve the closed-quote state; the following LF terminates the row.
      } else {
        return ['csv_characters_after_closing_quote'];
      }
      continue;
    }
    if (char === '"') {
      if (field.length > 0) return ['csv_quote_inside_unquoted_field'];
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
      if (rows.length > 10001) return ['csv_row_limit_exceeded'];
    } else {
      field += char;
    }
  }
  if (quoted) return ['csv_unterminated_quote'];
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim()));
  if (nonEmpty.length < 2) return ['csv_requires_header_and_data'];
  const header = nonEmpty[0].map((value) => value.trim());
  if (header.some((value) => !value)) return ['csv_header_empty'];
  if (new Set(header.map((value) => value.toLowerCase())).size !== header.length) return ['csv_header_duplicate'];
  if (nonEmpty.some((entry) => entry.length !== header.length)) return ['csv_inconsistent_row_width'];
  return [];
}

function sourceContainerErrors(mediaType, bytes) {
  if (mediaType === 'application/json') {
    try {
      const document = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
      if (!document || typeof document !== 'object' || Array.isArray(document)) return ['source_json_must_be_object'];
      const bounds = validateJsonDocumentBounds(document);
      if (!bounds.ok) return bounds.errors.map((error) => `source_${error.code}`);
      return [];
    } catch {
      return ['malformed_source_json'];
    }
  }
  if (mediaType === 'text/csv') return strictCsvValidation(bytes);
  return ['unsupported_source_format'];
}

export function validateInspectionEvidenceSourceContainer(mediaType, bytes) {
  const errors = sourceContainerErrors(mediaType, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return { ok: errors.length === 0, errors };
}

function ensureCanonicalPackageSlug(slug) {
  if (!CANONICAL_PACKAGE_SLUGS.includes(slug)) {
    throw new InspectionEvidenceOnboardingError('unknown_canonical_package', `Unknown canonical package slug: ${slug}`);
  }
}

function ensurePortablePackageRevision(revision) {
  if (typeof revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(revision.trim())) {
    throw new InspectionEvidenceOnboardingError(
      'package_revision_invalid',
      'Package revision must be a single portable token containing only letters, digits, dot, underscore, or hyphen'
    );
  }
  return revision.trim();
}

export async function readAuthoritativeCanonicalPackageIdentity(projectRoot, packageSlug) {
  ensureCanonicalPackageSlug(packageSlug);
  const root = await realpath(resolve(projectRoot));
  const configPath = resolve(root, 'docs', 'examples', packageSlug, 'config.toml');
  const input = await readRegularFileNoFollow(configPath, {
    label: 'canonical package config',
    maxBytes: 1024 * 1024,
  });
  if (input.absolute !== input.real || !isInside(root, input.real)) {
    throw new InspectionEvidenceOnboardingError('canonical_config_escape', 'Canonical package config must be a real non-symlink file inside the repository');
  }
  const config = parseTOML(input.bytes.toString('utf8'));
  const revision = config?.product?.revision;
  const subjectIdentifier = config?.name;
  return {
    revision: typeof revision === 'string' && revision.trim() ? revision.trim() : null,
    subjectIdentifier: typeof subjectIdentifier === 'string' && subjectIdentifier.trim() ? subjectIdentifier.trim() : null,
  };
}

export async function readAuthoritativeCanonicalPackageRevision(projectRoot, packageSlug) {
  return (await readAuthoritativeCanonicalPackageIdentity(projectRoot, packageSlug)).revision;
}

function initialTransitions(timestamp, actorRef, candidateSha256) {
  return [
    {
      from: null,
      to: 'discovered',
      at: timestamp,
      actor_ref: actorRef,
      reason_code: 'candidate_received',
      candidate_sha256: candidateSha256,
    },
    {
      from: 'discovered',
      to: 'quarantined',
      at: timestamp,
      actor_ref: actorRef,
      reason_code: 'content_addressed_quarantine_created',
      candidate_sha256: candidateSha256,
    },
  ];
}

export async function quarantineInspectionEvidenceCandidate({
  projectRoot,
  candidatePath,
  envelopePath,
  packageSlug,
  packageRevision,
  actorRef,
  timestamp = null,
} = {}) {
  ensureCanonicalPackageSlug(packageSlug);
  const normalizedRevision = ensurePortablePackageRevision(packageRevision);
  if (!isValidInspectionEvidenceIdentityRef(actorRef)) {
    throw new InspectionEvidenceOnboardingError('actor_ref_required', 'Quarantine requires a non-placeholder actor reference');
  }
  const candidate = await readRegularFileNoFollow(candidatePath, {
    label: 'inspection source candidate',
    maxBytes: INSPECTION_EVIDENCE_MAX_SOURCE_BYTES,
  });
  const envelope = await readRegularFileNoFollow(envelopePath, {
    label: 'inspection evidence envelope',
    maxBytes: INSPECTION_EVIDENCE_MAX_ENVELOPE_BYTES,
  });
  let classification = classifyInspectionEvidenceCandidate({
    filename: candidate.filename,
    sourcePathText: candidatePath,
    bytes: candidate.bytes,
  });
  if (classification.classification === 'candidate' && await matchesRepositoryControlledFile(projectRoot, candidate)) {
    classification = {
      ...classification,
      classification: 'generated_or_control',
      reasons: [...new Set([...classification.reasons, 'repository_controlled_bytes'])],
    };
  }
  const createdAt = nowIso(timestamp);
  const revisionKey = sha256Bytes(normalizedRevision).slice(0, 12);
  const recordKey = `${revisionKey}-${candidate.sha256.slice(0, 20)}-${envelope.sha256.slice(0, 20)}`;
  const quarantineBoundary = await ensureSafeQuarantineDirectory(projectRoot, packageSlug, recordKey);
  const root = quarantineBoundary.rootReal;
  const quarantineDir = quarantineBoundary.recordReal;
  const sourceName = `source${classification.extension || '.bin'}`;
  const sourcePath = join(quarantineDir, sourceName);
  const envelopeTarget = join(quarantineDir, 'candidate-envelope.json');
  const recordPath = join(quarantineDir, 'onboarding-record.json');
  for (const [target, bytes, expectedHash] of [
    [sourcePath, candidate.bytes, candidate.sha256],
    [envelopeTarget, envelope.bytes, envelope.sha256],
  ]) {
    try {
      const existing = await readFile(target);
      if (sha256Bytes(existing) !== expectedHash) {
        throw new InspectionEvidenceOnboardingError('quarantine_content_conflict', `Quarantine target ${basename(target)} already exists with different bytes`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') await atomicWrite(target, bytes);
      else if (error instanceof InspectionEvidenceOnboardingError) throw error;
      else if (error?.code) throw error;
    }
  }

  const sourceRef = repoRelative(root, sourcePath);
  const envelopeRef = repoRelative(root, envelopeTarget);
  let record = {
    artifact_type: 'inspection_evidence_onboarding_record',
    schema_version: '1.0',
    record_id: `ieo:${packageSlug}:${normalizedRevision}:${recordKey}`,
    state: 'quarantined',
    package_slug: packageSlug,
    package_revision: normalizedRevision,
    created_at: createdAt,
    updated_at: createdAt,
    candidate: {
      original_filename: candidate.filename,
      quarantine_ref: sourceRef,
      media_type: classification.mediaType,
      size_bytes: candidate.sizeBytes,
      sha256: candidate.sha256,
      classification: classification.classification,
      classification_reasons: classification.reasons,
    },
    envelope: {
      quarantine_ref: envelopeRef,
      sha256: envelope.sha256,
      structurally_valid: false,
      semantically_valid: false,
      evidence_id: null,
    },
    authorization: {
      record_ref: null,
      record_sha256: null,
      authorization_id: null,
      validated_record_sha256: null,
    },
    attachment: {
      record_ref: null,
      record_sha256: null,
      attached_at: null,
    },
    transitions: initialTransitions(createdAt, actorRef.trim(), candidate.sha256),
  };

  if (classification.classification !== 'candidate') {
    record = appendInspectionEvidenceTransition(record, {
      to: 'rejected',
      at: createdAt,
      actorRef: actorRef.trim(),
      reasonCode: classification.reasons[0] || 'candidate_class_rejected',
    });
  }
  assertInspectionEvidenceValidation(validateInspectionEvidenceOnboardingRecordSchema(record));
  assertInspectionEvidenceValidation(validateInspectionEvidenceStateHistory(record));

  try {
    const existing = await readJson(recordPath, 'existing onboarding record');
    if (
      existing.document.package_slug !== packageSlug
      || existing.document.package_revision !== normalizedRevision
      || existing.document.candidate?.sha256 !== candidate.sha256
      || existing.document.envelope?.sha256 !== envelope.sha256
    ) {
      throw new InspectionEvidenceOnboardingError('quarantine_record_conflict', 'Existing quarantine record is bound to a different package, revision, source, or envelope');
    }
    return {
      record: existing.document,
      recordPath,
      recordRef: repoRelative(root, recordPath),
      idempotent: true,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'file_read_failed') throw error;
  }
  await atomicWrite(recordPath, serializeCanonicalJson(record));
  return {
    record,
    recordPath,
    recordRef: repoRelative(root, recordPath),
    idempotent: false,
  };
}

async function loadAndVerifyQuarantineRecord(projectRoot, recordPathValue) {
  const boundary = await assertSafeQuarantineRecordPath(projectRoot, recordPathValue);
  const { document: record } = await readJson(boundary.absolute, 'inspection evidence onboarding record');
  assertInspectionEvidenceValidation(validateInspectionEvidenceOnboardingRecordSchema(record), 'onboarding_record_schema_invalid');
  assertInspectionEvidenceValidation(validateInspectionEvidenceStateHistory(record), 'onboarding_state_history_invalid');
  const sourcePath = resolve(boundary.rootReal, record.candidate.quarantine_ref);
  const envelopePath = resolve(boundary.rootReal, record.envelope.quarantine_ref);
  const recordDirectory = dirname(boundary.absolute);
  for (const [pathValue, expectedHash, label] of [
    [sourcePath, record.candidate.sha256, 'quarantined source'],
    [envelopePath, record.envelope.sha256, 'quarantined envelope'],
  ]) {
    const pathReal = await realpath(pathValue);
    if (!isInside(boundary.quarantineReal, pathReal) || dirname(pathReal) !== recordDirectory) {
      throw new InspectionEvidenceOnboardingError('quarantine_escape', `${label} escaped the quarantine root`);
    }
    const info = await lstat(pathValue);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new InspectionEvidenceOnboardingError('quarantine_symlink_forbidden', `${label} must be a regular non-symlink file`);
    }
    const bytes = await readFile(pathValue);
    if (sha256Bytes(bytes) !== expectedHash) {
      throw new InspectionEvidenceOnboardingError('quarantine_checksum_changed', `${label} checksum changed after quarantine`);
    }
  }
  const sourceBytes = await readFile(sourcePath);
  let classification = classifyInspectionEvidenceCandidate({
    filename: record.candidate.original_filename,
    sourcePathText: record.candidate.original_filename,
    bytes: sourceBytes,
  });
  if (classification.classification === 'candidate' && await matchesRepositoryControlledFile(boundary.rootReal, {
    real: sourcePath,
    sizeBytes: sourceBytes.length,
    sha256: sha256Bytes(sourceBytes),
  })) {
    classification = {
      ...classification,
      classification: 'generated_or_control',
      reasons: [...new Set([...classification.reasons, 'repository_controlled_bytes'])],
    };
  }
  if (
    classification.classification !== record.candidate.classification
    || classification.mediaType !== record.candidate.media_type
    || JSON.stringify(classification.reasons) !== JSON.stringify(record.candidate.classification_reasons)
  ) {
    throw new InspectionEvidenceOnboardingError('candidate_classification_changed', 'Stored candidate classification does not match the quarantined source bytes');
  }
  return {
    boundary,
    record,
    sourcePath,
    envelopePath,
    sourceBytes,
    envelopeBytes: await readFile(envelopePath),
  };
}

async function replaceOnboardingRecord(boundary, record) {
  assertInspectionEvidenceValidation(validateInspectionEvidenceOnboardingRecordSchema(record));
  assertInspectionEvidenceValidation(validateInspectionEvidenceStateHistory(record));
  await atomicWrite(boundary.absolute, serializeCanonicalJson(record), { replace: true });
}

async function ensureAuthorizedOnboardingSnapshot(boundary, record) {
  if (record.state !== 'authorized') {
    throw new InspectionEvidenceOnboardingError('authorized_snapshot_state_invalid', 'Authorized onboarding snapshot requires authorized state');
  }
  const snapshotPath = join(dirname(boundary.absolute), 'authorized-onboarding-record.json');
  const snapshotBytes = Buffer.from(serializeCanonicalJson(record));
  const snapshotSha256 = sha256Bytes(snapshotBytes);
  try {
    const existing = await readFile(snapshotPath);
    if (sha256Bytes(existing) !== snapshotSha256) {
      throw new InspectionEvidenceOnboardingError('authorized_snapshot_conflict', 'Immutable authorized onboarding snapshot already exists with different bytes');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') await atomicWrite(snapshotPath, snapshotBytes);
    else if (error instanceof InspectionEvidenceOnboardingError) throw error;
    else throw error;
  }
  return {
    path: snapshotPath,
    ref: repoRelative(boundary.rootReal, snapshotPath),
    sha256: snapshotSha256,
  };
}

async function ensureAttachmentPlan(boundary, {
  record,
  authorization,
  authorizedSnapshotSha256,
  actorRef,
  requestedAttachedAt,
  readinessBeforeSha256,
  readinessMarkdownBeforeSha256,
  timestampWasExplicit,
}) {
  const planPath = join(dirname(boundary.absolute), 'attachment-plan.json');
  let existing = null;
  try {
    const input = await readRegularFileNoFollow(planPath, {
      label: 'local attachment recovery plan',
      maxBytes: 128 * 1024,
    });
    existing = parseInspectionEvidenceJsonBytes(input.bytes);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        throw new InspectionEvidenceOnboardingError('attachment_plan_malformed', 'Local attachment recovery plan is malformed JSON');
      }
      throw error;
    }
  }

  const attachedAt = existing?.attached_at || requestedAttachedAt;
  const expected = {
    artifact_type: 'inspection_evidence_local_attachment_plan',
    schema_version: '1.0',
    immutable: true,
    package_slug: record.package_slug,
    package_revision: record.package_revision,
    evidence_id: record.envelope.evidence_id,
    source_document_sha256: record.candidate.sha256,
    candidate_envelope_sha256: record.envelope.sha256,
    authorization_id: authorization.authorization_id,
    authorization_record_sha256: record.authorization.record_sha256,
    authorized_onboarding_record_sha256: authorizedSnapshotSha256,
    actor_ref: actorRef,
    attached_at: attachedAt,
    readiness_before_sha256: existing?.readiness_before_sha256 || readinessBeforeSha256,
    readiness_markdown_before_sha256: existing?.readiness_markdown_before_sha256 || readinessMarkdownBeforeSha256,
  };
  if (
    !isParseableTimestamp(attachedAt)
    || !isSha256(expected.readiness_before_sha256)
    || !isSha256(expected.readiness_markdown_before_sha256)
  ) {
    throw new InspectionEvidenceOnboardingError('attachment_plan_invalid', 'Local attachment recovery plan contains invalid time or checksum data');
  }
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(expected)) {
      throw new InspectionEvidenceOnboardingError('attachment_plan_conflict', 'Local attachment recovery plan does not match the authorized immutable inputs');
    }
    if (timestampWasExplicit && requestedAttachedAt !== existing.attached_at) {
      throw new InspectionEvidenceOnboardingError('attachment_plan_timestamp_conflict', 'Explicit attachment timestamp conflicts with an existing recovery plan');
    }
    return { ...expected, path: planPath, idempotent: true };
  }
  await atomicWrite(planPath, serializeCanonicalJson(expected));
  return { ...expected, path: planPath, idempotent: false };
}

async function ensureImmutableCanonicalFile(pathValue, bytes, label) {
  try {
    await atomicWrite(pathValue, bytes);
    return true;
  } catch (error) {
    if (error?.code !== 'immutable_target_exists') throw error;
    const existing = await readRegularFileNoFollow(pathValue, {
      label,
      maxBytes: Math.max(bytes.length, 1),
    });
    if (existing.sha256 !== sha256Bytes(bytes)) {
      throw new InspectionEvidenceOnboardingError('immutable_target_conflict', `${label} already exists with different bytes`);
    }
    return false;
  }
}

async function readBoundQuarantineFile(boundary, relativeRef, label, maxBytes) {
  const absolute = resolve(boundary.rootReal, relativeRef || '');
  const input = await readRegularFileNoFollow(absolute, { label, maxBytes });
  if (
    input.absolute !== input.real
    || !isInside(boundary.quarantineReal, input.real)
    || dirname(input.real) !== dirname(boundary.absolute)
  ) {
    throw new InspectionEvidenceOnboardingError('quarantine_reference_escape', `${label} must remain in the same content-addressed quarantine record`);
  }
  return input;
}

async function rejectRecord(loaded, { actorRef, timestamp, code, errors = [] }) {
  if (!['quarantined', 'structurally_valid', 'semantically_valid', 'awaiting_authorization', 'authorized'].includes(loaded.record.state)) {
    return loaded.record;
  }
  const rejected = appendInspectionEvidenceTransition(loaded.record, {
    to: 'rejected',
    at: timestamp,
    actorRef,
    reasonCode: code,
  });
  await replaceOnboardingRecord(loaded.boundary, rejected);
  throw new InspectionEvidenceOnboardingError(code, errors.map((error) => error.message || error).join(' | ') || code, { errors });
}

export async function validateQuarantinedInspectionEvidence({
  projectRoot,
  recordPath,
  actorRef,
  timestamp = null,
} = {}) {
  const loaded = await loadAndVerifyQuarantineRecord(projectRoot, recordPath);
  let at = nowIso(timestamp);
  if (loaded.record.state === 'rejected') {
    throw new InspectionEvidenceOnboardingError('candidate_already_rejected', 'Rejected inspection evidence cannot re-enter validation; create a new quarantine record');
  }
  if (loaded.record.state !== 'quarantined') {
    if (loaded.record.state === 'awaiting_authorization') {
      return { record: loaded.record, validatedRecordSha256: sha256Json(loaded.record), idempotent: true };
    }
    throw new InspectionEvidenceOnboardingError('validation_state_invalid', `Validation requires quarantined state, not ${loaded.record.state}`);
  }
  if (loaded.record.candidate.classification !== 'candidate') {
    return rejectRecord(loaded, {
      actorRef,
      timestamp: at,
      code: 'candidate_class_rejected',
      errors: loaded.record.candidate.classification_reasons,
    });
  }
  const containerErrors = sourceContainerErrors(loaded.record.candidate.media_type, loaded.sourceBytes);
  if (containerErrors.length > 0) {
    return rejectRecord(loaded, {
      actorRef,
      timestamp: at,
      code: containerErrors[0],
      errors: containerErrors,
    });
  }

  let envelope;
  try {
    envelope = parseInspectionEvidenceJsonBytes(loaded.envelopeBytes);
  } catch (error) {
    return rejectRecord(loaded, {
      actorRef,
      timestamp: at,
      code: 'malformed_envelope_json',
      errors: [error.message],
    });
  }
  const structural = validateInspectionEvidenceEnvelopeSchema(envelope);
  if (!structural.ok) {
    return rejectRecord(loaded, {
      actorRef,
      timestamp: at,
      code: 'envelope_structurally_invalid',
      errors: structural.errors,
    });
  }
  let record = appendInspectionEvidenceTransition(loaded.record, {
    to: 'structurally_valid',
    at,
    actorRef,
    reasonCode: 'envelope_schema_valid',
  });
  record.envelope.structurally_valid = true;
  record.envelope.evidence_id = envelope.evidence_id;
  loaded.record = record;

  const authoritativePackage = await readAuthoritativeCanonicalPackageIdentity(projectRoot, record.package_slug);
  const semantic = validateInspectionEvidenceEnvelopeSemantics(envelope, {
    candidateSha256: record.candidate.sha256,
    candidateSizeBytes: record.candidate.size_bytes,
    candidateFilename: record.candidate.original_filename,
    candidateMediaType: record.candidate.media_type,
    packageSlug: record.package_slug,
    packageRevision: record.package_revision,
    authoritativePackageRevision: authoritativePackage.revision,
    authoritativeSubjectIdentifier: authoritativePackage.subjectIdentifier,
  });
  if (actorRef !== envelope.review.reviewer_identity_ref) {
    semantic.errors.push({
      code: 'validation_reviewer_mismatch',
      path: '/review/reviewer_identity_ref',
      message: 'Validation actor must match the evidence envelope reviewer identity reference',
    });
    semantic.ok = false;
  }
  if (!semantic.ok) {
    return rejectRecord(loaded, {
      actorRef,
      timestamp: at,
      code: semantic.errors[0]?.code || 'envelope_semantically_invalid',
      errors: semantic.errors,
    });
  }
  record = appendInspectionEvidenceTransition(record, {
    to: 'semantically_valid',
    at,
    actorRef,
    reasonCode: 'authoritative_semantics_valid',
  });
  record.envelope.semantically_valid = true;
  record = appendInspectionEvidenceTransition(record, {
    to: 'awaiting_authorization',
    at,
    actorRef,
    reasonCode: 'explicit_attachment_authorization_required',
  });
  await replaceOnboardingRecord(loaded.boundary, record);
  return {
    record,
    validatedRecordSha256: sha256Json(record),
    idempotent: false,
  };
}

export async function authorizeQuarantinedInspectionEvidence({
  projectRoot,
  recordPath,
  authorizationPath,
  actorRef,
  timestamp = null,
} = {}) {
  const loaded = await loadAndVerifyQuarantineRecord(projectRoot, recordPath);
  if (loaded.record.state === 'authorized') {
    const repeatedAuthorization = await readRegularFileNoFollow(authorizationPath, {
      label: 'inspection evidence attachment authorization',
      maxBytes: 256 * 1024,
    });
    if (repeatedAuthorization.sha256 !== loaded.record.authorization.record_sha256) {
      throw new InspectionEvidenceOnboardingError('authorization_record_conflict', 'A different authorization was supplied for an already authorized onboarding record');
    }
    let repeatedAuthorizationDocument;
    try {
      repeatedAuthorizationDocument = parseInspectionEvidenceJsonBytes(repeatedAuthorization.bytes);
    } catch (error) {
      throw new InspectionEvidenceOnboardingError('malformed_authorization', 'Repeated authorization input must remain valid JSON', { cause: error.message });
    }
    if (actorRef !== repeatedAuthorizationDocument.authorizer?.identity_ref) {
      throw new InspectionEvidenceOnboardingError('authorization_actor_mismatch', 'Idempotent authorization actor must match the authorization record authorizer identity');
    }
    const authorizedSnapshot = await ensureAuthorizedOnboardingSnapshot(loaded.boundary, loaded.record);
    return { record: loaded.record, authorizedSnapshot, idempotent: true };
  }
  if (loaded.record.state !== 'awaiting_authorization') {
    throw new InspectionEvidenceOnboardingError('authorization_state_invalid', `Authorization requires awaiting_authorization state, not ${loaded.record.state}`);
  }
  const authorizationInput = await readRegularFileNoFollow(authorizationPath, {
    label: 'inspection evidence attachment authorization',
    maxBytes: 256 * 1024,
  });
  let authorization;
  let envelope;
  try {
    authorization = parseInspectionEvidenceJsonBytes(authorizationInput.bytes);
    envelope = parseInspectionEvidenceJsonBytes(loaded.envelopeBytes);
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('malformed_authorization_or_envelope', 'Authorization and envelope must be valid JSON', { cause: error.message });
  }
  const validatedRecordSha256 = sha256Json(loaded.record);
  assertInspectionEvidenceValidation(validateInspectionEvidenceAuthorizationBinding(
    authorization,
    loaded.record,
    envelope,
    { validatedRecordSha256 }
  ), 'attachment_authorization_invalid');
  if (actorRef !== authorization.authorizer.identity_ref) {
    throw new InspectionEvidenceOnboardingError('authorization_actor_mismatch', 'Authorization transition actor must match the authorization record authorizer identity');
  }

  const at = nowIso(timestamp);
  if (!isParseableTimestamp(at) || Date.parse(at) < Date.parse(authorization.authorized_at)) {
    throw new InspectionEvidenceOnboardingError('authorization_transition_time_invalid', 'Authorization transition timestamp must be valid and must not precede the signed authorization timestamp');
  }

  const authTarget = resolve(dirname(loaded.boundary.absolute), 'attachment-authorization.json');
  try {
    const existing = await readFile(authTarget);
    if (sha256Bytes(existing) !== authorizationInput.sha256) {
      throw new InspectionEvidenceOnboardingError('authorization_record_conflict', 'Quarantined authorization record already exists with different bytes');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') await atomicWrite(authTarget, authorizationInput.bytes);
    else if (error instanceof InspectionEvidenceOnboardingError) throw error;
    else if (error?.code) throw error;
  }

  let record = appendInspectionEvidenceTransition(loaded.record, {
    to: 'authorized',
    at,
    actorRef,
    reasonCode: 'checksum_bound_human_authorization_verified',
  });
  record.authorization = {
    record_ref: repoRelative(loaded.boundary.rootReal, authTarget),
    record_sha256: authorizationInput.sha256,
    authorization_id: authorization.authorization_id,
    validated_record_sha256: validatedRecordSha256,
  };
  await replaceOnboardingRecord(loaded.boundary, record);
  const authorizedSnapshot = await ensureAuthorizedOnboardingSnapshot(loaded.boundary, record);
  return { record, authorizedSnapshot, idempotent: false };
}

function canonicalAttachmentPaths(projectRoot, packageSlug) {
  const inspectionDir = resolve(projectRoot, 'docs', 'examples', packageSlug, 'inspection');
  return {
    inspectionDir,
    candidateEnvelope: join(inspectionDir, 'inspection_evidence_candidate_authorized.json'),
    envelope: join(inspectionDir, 'inspection_evidence.json'),
    authorization: join(inspectionDir, 'inspection_evidence_authorization.json'),
    onboarding: join(inspectionDir, 'inspection_evidence_onboarding.json'),
    attachment: join(inspectionDir, 'inspection_evidence_attachment.json'),
    readiness: resolve(projectRoot, 'docs', 'examples', packageSlug, 'readiness', 'readiness_report.json'),
    readinessMarkdown: resolve(projectRoot, 'docs', 'examples', packageSlug, 'readiness', 'readiness_report.md'),
  };
}

async function assertRealDirectory(pathValue, expectedParent, label) {
  const info = await lstat(pathValue);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new InspectionEvidenceOnboardingError('unsafe_canonical_directory', `${label} must be a real directory`);
  }
  const real = await realpath(pathValue);
  if (real !== pathValue || dirname(real) !== expectedParent) {
    throw new InspectionEvidenceOnboardingError('canonical_directory_escape', `${label} escaped its canonical parent`);
  }
  return real;
}

async function ensureCanonicalAttachmentBoundary(projectRoot, packageSlug, { createInspectionDirectory = false } = {}) {
  ensureCanonicalPackageSlug(packageSlug);
  const root = await realpath(resolve(projectRoot));
  const docs = await assertRealDirectory(join(root, 'docs'), root, 'Canonical docs directory');
  const examples = await assertRealDirectory(join(docs, 'examples'), docs, 'Canonical examples directory');
  const packageRoot = await assertRealDirectory(join(examples, packageSlug), examples, 'Canonical package directory');
  let inspection;
  try {
    inspection = await assertRealDirectory(join(packageRoot, 'inspection'), packageRoot, 'Canonical inspection directory');
  } catch (error) {
    if (error?.code !== 'ENOENT' || !createInspectionDirectory) throw error;
    inspection = await ensureRealChildDirectory(packageRoot, 'inspection', 'Canonical inspection directory');
  }
  const readinessDir = await assertRealDirectory(join(packageRoot, 'readiness'), packageRoot, 'Canonical readiness directory');
  const readinessPath = join(readinessDir, 'readiness_report.json');
  const readinessMarkdownPath = join(readinessDir, 'readiness_report.md');
  for (const [pathValue, label] of [[readinessPath, 'JSON'], [readinessMarkdownPath, 'Markdown']]) {
    const readinessInfo = await lstat(pathValue);
    if (readinessInfo.isSymbolicLink() || !readinessInfo.isFile() || await realpath(pathValue) !== pathValue) {
      throw new InspectionEvidenceOnboardingError('unsafe_readiness_target', `Canonical readiness ${label} must be a real non-symlink file`);
    }
  }
  return {
    root,
    packageRoot,
    inspection,
    paths: {
      inspectionDir: inspection,
      candidateEnvelope: join(inspection, 'inspection_evidence_candidate_authorized.json'),
      envelope: join(inspection, 'inspection_evidence.json'),
      authorization: join(inspection, 'inspection_evidence_authorization.json'),
      onboarding: join(inspection, 'inspection_evidence_onboarding.json'),
      attachment: join(inspection, 'inspection_evidence_attachment.json'),
      readiness: readinessPath,
      readinessMarkdown: readinessMarkdownPath,
    },
  };
}

async function readCanonicalRegularFile(root, pathValue, label, maxBytes = INSPECTION_EVIDENCE_MAX_SOURCE_BYTES) {
  const input = await readRegularFileNoFollow(pathValue, { label, maxBytes });
  if (input.absolute !== input.real || !isInside(root, input.real)) {
    throw new InspectionEvidenceOnboardingError('canonical_file_escape', `${label} must be a real file inside the repository`);
  }
  return input;
}

async function hashFile(pathValue) {
  return sha256Bytes(await readFile(pathValue));
}

export function assertInspectionEvidenceAttachmentIdentity(receipt, {
  expectedSourceSha256,
  expectedEvidenceId,
  expectedPackageRevision,
  expectedCandidateEnvelopeSha256,
  expectedAuthorizationId,
} = {}) {
  const expectedBindings = [
    [expectedSourceSha256, receipt?.source_document_sha256, 'source checksum'],
    [expectedEvidenceId, receipt?.evidence_id, 'evidence id'],
    [expectedPackageRevision, receipt?.package_revision, 'package revision'],
    [expectedCandidateEnvelopeSha256, receipt?.candidate_envelope_sha256, 'candidate envelope checksum'],
    [expectedAuthorizationId, receipt?.authorization?.authorization_id, 'authorization id'],
  ];
  for (const [expected, actual, label] of expectedBindings) {
    if (expected && expected !== actual) {
      throw new InspectionEvidenceOnboardingError('duplicate_attachment_conflict', `A different ${label} is already attached for this package`);
    }
  }
  return true;
}

export function assertInspectionEvidenceResultBinding(inspectionRecord, envelope) {
  const expectedInspectionResult = summarizeInspectionEvidenceResults(envelope);
  if (JSON.stringify(inspectionRecord?.inspection_result) !== JSON.stringify(expectedInspectionResult)) {
    throw new InspectionEvidenceOnboardingError('review_pack_inspection_result_mismatch', 'Review-pack inspection result summary must exactly match the verified attached evidence envelope');
  }
  return true;
}

export function assertInspectionEvidenceReadinessAuthorizationTiming({
  authorizedAt,
  attachedAt,
  now = new Date().toISOString(),
  maxClockSkewMs = 5 * 60 * 1000,
} = {}) {
  if (!isParseableTimestamp(authorizedAt) || !isParseableTimestamp(attachedAt) || !isParseableTimestamp(now)) {
    throw new InspectionEvidenceOnboardingError('invalid_readiness_authorization_timestamp', 'Readiness authorization timing requires valid RFC 3339-compatible timestamps');
  }
  if (Date.parse(authorizedAt) < Date.parse(attachedAt)) {
    throw new InspectionEvidenceOnboardingError('readiness_authorized_before_attachment', 'Readiness regeneration authorization must be issued after attachment');
  }
  if (Date.parse(authorizedAt) > Date.parse(now) + maxClockSkewMs) {
    throw new InspectionEvidenceOnboardingError('readiness_authorization_from_future', 'Readiness regeneration authorization is too far in the future');
  }
  return true;
}

export async function inspectExistingInspectionEvidenceAttachment(projectRoot, packageSlug, {
  expectedSourceSha256,
  expectedEvidenceId,
  expectedPackageRevision,
  expectedCandidateEnvelopeSha256,
  expectedAuthorizationId,
} = {}) {
  let boundary;
  try {
    boundary = await ensureCanonicalAttachmentBoundary(projectRoot, packageSlug);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, receipt: null, receiptSha256: null, paths: canonicalAttachmentPaths(resolve(projectRoot), packageSlug) };
    }
    throw error;
  }
  const { paths } = boundary;
  try {
    await lstat(paths.attachment);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { exists: false, receipt: null, receiptSha256: null, paths };
  }

  const verified = await verifyCanonicalInspectionEvidenceAttachment(projectRoot, paths.attachment);
  assertInspectionEvidenceAttachmentIdentity(verified.receipt, {
    expectedSourceSha256,
    expectedEvidenceId,
    expectedPackageRevision,
    expectedCandidateEnvelopeSha256,
    expectedAuthorizationId,
  });
  return { exists: true, ...verified, paths };
}

export async function attachAuthorizedInspectionEvidence({
  projectRoot,
  recordPath,
  actorRef,
  timestamp = null,
} = {}) {
  const loaded = await loadAndVerifyQuarantineRecord(projectRoot, recordPath);
  if (!['authorized', 'attached'].includes(loaded.record.state)) {
    throw new InspectionEvidenceOnboardingError('attachment_state_invalid', `Attachment requires authorized state, not ${loaded.record.state}`);
  }
  const envelope = parseInspectionEvidenceJsonBytes(loaded.envelopeBytes);
  const authoritativePackage = await readAuthoritativeCanonicalPackageIdentity(projectRoot, loaded.record.package_slug);
  const authoritativeRevision = authoritativePackage.revision;
  if (!authoritativeRevision || authoritativeRevision !== loaded.record.package_revision) {
    throw new InspectionEvidenceOnboardingError('authoritative_revision_mismatch', 'Attachment requires a matching authoritative configured package revision');
  }
  const mutationBoundary = await ensureCanonicalAttachmentBoundary(projectRoot, loaded.record.package_slug, { createInspectionDirectory: true });
  return withCanonicalPackageMutationLock(mutationBoundary.inspection, async () => {
  const existing = await inspectExistingInspectionEvidenceAttachment(projectRoot, loaded.record.package_slug, {
    expectedSourceSha256: loaded.record.candidate.sha256,
    expectedEvidenceId: envelope.evidence_id,
    expectedPackageRevision: loaded.record.package_revision,
    expectedCandidateEnvelopeSha256: loaded.record.envelope.sha256,
    expectedAuthorizationId: loaded.record.authorization.authorization_id,
  });
  if (existing.exists) {
    if (actorRef !== existing.receipt.authorization.authorized_by_ref) {
      throw new InspectionEvidenceOnboardingError('attachment_actor_mismatch', 'Idempotent attachment actor must match the checksum-bound authorization authorizer identity');
    }
    if (loaded.record.state !== 'attached') {
      let recovered = appendInspectionEvidenceTransition(loaded.record, {
        to: 'attached',
        at: existing.receipt.attached_at,
        actorRef,
        reasonCode: 'existing_immutable_attachment_reconciled',
      });
      recovered.attachment = {
        record_ref: repoRelative(loaded.boundary.rootReal, existing.paths.attachment),
        record_sha256: existing.receiptSha256,
        attached_at: existing.receipt.attached_at,
      };
      await replaceOnboardingRecord(loaded.boundary, recovered);
    }
    return { receipt: existing.receipt, receiptPath: existing.paths.attachment, idempotent: true };
  }

  if (loaded.record.state !== 'authorized') {
    throw new InspectionEvidenceOnboardingError('attached_receipt_missing', 'Attached onboarding state requires its existing immutable canonical receipt');
  }
  const authorizedSnapshot = await ensureAuthorizedOnboardingSnapshot(loaded.boundary, loaded.record);
  const authInput = await readBoundQuarantineFile(
    loaded.boundary,
    loaded.record.authorization.record_ref,
    'quarantined attachment authorization',
    256 * 1024
  );
  const authBytes = authInput.bytes;
  if (authInput.sha256 !== loaded.record.authorization.record_sha256) {
    throw new InspectionEvidenceOnboardingError('authorization_checksum_changed', 'Authorization record changed after authorization');
  }
  const authorization = parseInspectionEvidenceJsonBytes(authBytes);
  assertInspectionEvidenceValidation(validateInspectionEvidenceAuthorizationBinding(
    authorization,
    { ...loaded.record, state: 'awaiting_authorization', authorization: { record_ref: null, record_sha256: null, authorization_id: null, validated_record_sha256: null } },
    envelope,
    { validatedRecordSha256: loaded.record.authorization.validated_record_sha256 }
  ), 'attachment_authorization_invalid');
  if (actorRef !== authorization.authorizer.identity_ref) {
    throw new InspectionEvidenceOnboardingError('attachment_actor_mismatch', 'Attachment actor must match the checksum-bound authorization authorizer identity');
  }

  const at = nowIso(timestamp);
  if (!isParseableTimestamp(at)) {
    throw new InspectionEvidenceOnboardingError('invalid_attachment_timestamp', 'Attachment timestamp must be a valid RFC 3339-compatible timestamp');
  }
  if (Date.parse(at) < Date.parse(authorization.authorized_at)) {
    throw new InspectionEvidenceOnboardingError('attachment_before_authorization', 'Attachment timestamp must not precede authorization');
  }
  const authorizationTransition = loaded.record.transitions.find((transition) => transition.to === 'authorized');
  if (!authorizationTransition || Date.parse(at) < Date.parse(authorizationTransition.at)) {
    throw new InspectionEvidenceOnboardingError('attachment_before_authorization_transition', 'Attachment timestamp must not precede the authorized onboarding transition');
  }
  if (Date.parse(at) > Date.now() + (5 * 60 * 1000)) {
    throw new InspectionEvidenceOnboardingError('attachment_timestamp_from_future', 'Attachment timestamp is too far in the future');
  }
  const paths = existing.paths;
  const currentReadinessSha256 = await hashFile(paths.readiness);
  const currentReadinessMarkdownSha256 = await hashFile(paths.readinessMarkdown);
  const attachmentPlan = await ensureAttachmentPlan(loaded.boundary, {
    record: loaded.record,
    authorization,
    authorizedSnapshotSha256: authorizedSnapshot.sha256,
    actorRef,
    requestedAttachedAt: at,
    readinessBeforeSha256: currentReadinessSha256,
    readinessMarkdownBeforeSha256: currentReadinessMarkdownSha256,
    timestampWasExplicit: typeof timestamp === 'string' && timestamp.trim().length > 0,
  });
  at = attachmentPlan.attached_at;
  const readinessBefore = attachmentPlan.readiness_before_sha256;
  const readinessMarkdownBefore = attachmentPlan.readiness_markdown_before_sha256;
  if (
    currentReadinessSha256 !== readinessBefore
    || currentReadinessMarkdownSha256 !== readinessMarkdownBefore
  ) {
    throw new InspectionEvidenceOnboardingError('readiness_changed_since_attachment_plan', 'Readiness changed after the immutable local attachment plan was created');
  }
  if (
    Date.parse(at) < Date.parse(authorization.authorized_at)
    || Date.parse(at) < Date.parse(authorizationTransition.at)
    || Date.parse(at) > Date.now() + (5 * 60 * 1000)
  ) {
    throw new InspectionEvidenceOnboardingError('attachment_plan_timestamp_invalid', 'Attachment recovery plan timestamp is outside the authorized chronology');
  }
  const canonicalAuthorizationRef = repoRelative(loaded.boundary.rootReal, paths.authorization);
  const canonicalEnvelopeRef = repoRelative(loaded.boundary.rootReal, paths.envelope);
  const canonicalAuthBytes = Buffer.from(serializeCanonicalJson(authorization));
  const canonicalAuthSha = sha256Bytes(canonicalAuthBytes);
  const quarantineTransition = loaded.record.transitions.find((transition) => transition.to === 'quarantined');
  const finalEnvelope = buildAttachedInspectionEvidenceEnvelope({
    candidateEnvelope: envelope,
    authorization,
    authorizationRef: canonicalAuthorizationRef,
    authorizationSha256: canonicalAuthSha,
    attachedAt: at,
    sourceSha256: loaded.record.candidate.sha256,
    quarantineTransition,
  });
  assertInspectionEvidenceValidation(validateInspectionEvidenceEnvelopeSemantics(finalEnvelope, {
    candidateSha256: loaded.record.candidate.sha256,
    candidateSizeBytes: loaded.record.candidate.size_bytes,
    candidateFilename: loaded.record.candidate.original_filename,
    candidateMediaType: loaded.record.candidate.media_type,
    packageSlug: loaded.record.package_slug,
    packageRevision: loaded.record.package_revision,
    authoritativePackageRevision: authoritativeRevision,
    authoritativeSubjectIdentifier: authoritativePackage.subjectIdentifier,
    requireAuthorized: true,
    requireAttached: true,
  }), 'final_attachment_envelope_invalid');

  const finalEnvelopeBytes = Buffer.from(serializeCanonicalJson(finalEnvelope));
  const envelopeSha = sha256Bytes(finalEnvelopeBytes);
  const receipt = {
    artifact_type: 'inspection_evidence_attachment_record',
    schema_version: '1.0',
    immutable: true,
    attachment_id: `iea:${loaded.record.package_slug}:${loaded.record.package_revision}:${loaded.record.candidate.sha256.slice(0, 24)}`,
    evidence_id: envelope.evidence_id,
    attached_at: at,
    package_slug: loaded.record.package_slug,
    package_revision: loaded.record.package_revision,
    source_document_sha256: loaded.record.candidate.sha256,
    candidate_envelope_sha256: loaded.record.envelope.sha256,
    authorized_onboarding_record_sha256: authorizedSnapshot.sha256,
    authorization: {
      authorization_id: authorization.authorization_id,
      record_ref: canonicalAuthorizationRef,
      record_sha256: canonicalAuthSha,
      source_record_sha256: loaded.record.authorization.record_sha256,
      validated_record_sha256: loaded.record.authorization.validated_record_sha256,
      authorized_by_ref: authorization.authorizer.identity_ref,
      authorized_at: authorization.authorized_at,
    },
    resulting_canonical_artifacts: [
      { role: 'authorized_candidate_envelope', path: repoRelative(loaded.boundary.rootReal, paths.candidateEnvelope), sha256: loaded.record.envelope.sha256 },
      { role: 'evidence_envelope', path: canonicalEnvelopeRef, sha256: envelopeSha },
      { role: 'attachment_authorization', path: canonicalAuthorizationRef, sha256: canonicalAuthSha },
      {
        role: 'authorized_onboarding_record',
        path: repoRelative(loaded.boundary.rootReal, paths.onboarding),
        sha256: authorizedSnapshot.sha256,
      },
    ],
    readiness: {
      regenerated: false,
      before_sha256: readinessBefore,
      after_sha256: readinessBefore,
      before_markdown_sha256: readinessMarkdownBefore,
      after_markdown_sha256: readinessMarkdownBefore,
    },
    supersedes_attachment_id: null,
  };
  assertInspectionEvidenceValidation(validateInspectionEvidenceAttachmentRecordSchema(receipt));
  assertInspectionEvidenceValidation(validateCanonicalInspectionEvidenceChain({
    candidateEnvelope: envelope,
    envelope: finalEnvelope,
    authorization,
    receipt,
    authorizedOnboardingRecord: loaded.record,
    authoritativePackageRevision: authoritativeRevision,
    authoritativeSubjectIdentifier: authoritativePackage.subjectIdentifier,
    candidateEnvelopeSha256: loaded.record.envelope.sha256,
    envelopeSha256: envelopeSha,
    authorizationSha256: canonicalAuthSha,
    authorizedOnboardingRecordSha256: authorizedSnapshot.sha256,
  }), 'canonical_attachment_chain_invalid');

  const written = [];
  let verifiedAttachment;
  try {
    if (await ensureImmutableCanonicalFile(paths.onboarding, await readFile(authorizedSnapshot.path), 'canonical authorized onboarding snapshot')) {
      written.push(paths.onboarding);
    }
    if (await ensureImmutableCanonicalFile(paths.candidateEnvelope, loaded.envelopeBytes, 'canonical authorization-bound candidate envelope')) {
      written.push(paths.candidateEnvelope);
    }
    if (await ensureImmutableCanonicalFile(paths.envelope, finalEnvelopeBytes, 'canonical inspection evidence envelope')) {
      written.push(paths.envelope);
    }
    if (await ensureImmutableCanonicalFile(paths.authorization, canonicalAuthBytes, 'canonical inspection evidence authorization')) {
      written.push(paths.authorization);
    }
    if (
      await hashFile(paths.readiness) !== readinessBefore
      || await hashFile(paths.readinessMarkdown) !== readinessMarkdownBefore
    ) {
      throw new InspectionEvidenceOnboardingError('readiness_changed_during_attachment', 'Readiness changed during attachment; attachment and regeneration must remain separate');
    }
    if (await ensureImmutableCanonicalFile(paths.attachment, serializeCanonicalJson(receipt), 'canonical inspection evidence attachment receipt')) {
      written.push(paths.attachment);
    }
    verifiedAttachment = await verifyCanonicalInspectionEvidenceAttachment(projectRoot, paths.attachment);
  } catch (error) {
    for (const pathValue of written.reverse()) await unlink(pathValue).catch(() => {});
    throw error;
  }

  const receiptSha256 = verifiedAttachment.receiptSha256;
  let record = appendInspectionEvidenceTransition(loaded.record, {
    to: 'attached',
    at,
    actorRef,
    reasonCode: 'immutable_attachment_record_created',
  });
  record.attachment = {
    record_ref: repoRelative(loaded.boundary.rootReal, paths.attachment),
    record_sha256: receiptSha256,
    attached_at: at,
  };
  await replaceOnboardingRecord(loaded.boundary, record);
  return { receipt, receiptPath: paths.attachment, idempotent: false };
  });
}

export async function verifyCanonicalInspectionEvidenceAttachment(projectRoot, attachmentRecordPath) {
  assertSafeInputPathText(attachmentRecordPath, 'attachment record');
  const root = await realpath(resolve(projectRoot));
  const absolute = isAbsolute(attachmentRecordPath) ? resolve(attachmentRecordPath) : resolve(root, attachmentRecordPath);
  const receiptInput = await readCanonicalRegularFile(root, absolute, 'attachment record', 512 * 1024);
  let receipt;
  try {
    receipt = parseInspectionEvidenceJsonBytes(receiptInput.bytes);
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('malformed_json', 'Attachment record is malformed JSON', { cause: error.message });
  }
  assertInspectionEvidenceValidation(validateInspectionEvidenceAttachmentRecordSchema(receipt), 'attachment_record_schema_invalid');
  const boundary = await ensureCanonicalAttachmentBoundary(root, receipt.package_slug);
  if (receiptInput.real !== boundary.paths.attachment) {
    throw new InspectionEvidenceOnboardingError('attachment_record_noncanonical', 'Attachment record must use the canonical package inspection path');
  }
  const candidateEnvelopeInput = await readCanonicalRegularFile(root, boundary.paths.candidateEnvelope, 'authorization-bound candidate evidence envelope', INSPECTION_EVIDENCE_MAX_ENVELOPE_BYTES);
  const envelopeInput = await readCanonicalRegularFile(root, boundary.paths.envelope, 'attached evidence envelope', INSPECTION_EVIDENCE_MAX_ENVELOPE_BYTES);
  const authorizationInput = await readCanonicalRegularFile(root, boundary.paths.authorization, 'attachment authorization', 256 * 1024);
  const onboardingInput = await readCanonicalRegularFile(root, boundary.paths.onboarding, 'authorized onboarding snapshot', 512 * 1024);
  let candidateEnvelope;
  let envelope;
  let authorization;
  let authorizedOnboardingRecord;
  try {
    candidateEnvelope = parseInspectionEvidenceJsonBytes(candidateEnvelopeInput.bytes);
    envelope = parseInspectionEvidenceJsonBytes(envelopeInput.bytes);
    authorization = parseInspectionEvidenceJsonBytes(authorizationInput.bytes);
    authorizedOnboardingRecord = parseInspectionEvidenceJsonBytes(onboardingInput.bytes);
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('malformed_canonical_attachment_json', 'Canonical evidence envelope and authorization must be valid JSON', { cause: error.message });
  }
  const authoritativePackage = await readAuthoritativeCanonicalPackageIdentity(root, receipt.package_slug);
  const authoritativeRevision = authoritativePackage.revision;
  const envelopeSha256 = sha256Bytes(envelopeInput.bytes);
  const authorizationSha256 = sha256Bytes(authorizationInput.bytes);
  assertInspectionEvidenceValidation(validateCanonicalInspectionEvidenceChain({
    candidateEnvelope,
    envelope,
    authorization,
    receipt,
    authorizedOnboardingRecord,
    authoritativePackageRevision: authoritativeRevision,
    authoritativeSubjectIdentifier: authoritativePackage.subjectIdentifier,
    candidateEnvelopeSha256: sha256Bytes(candidateEnvelopeInput.bytes),
    envelopeSha256,
    authorizationSha256,
    authorizedOnboardingRecordSha256: sha256Bytes(onboardingInput.bytes),
  }), 'canonical_attachment_chain_invalid');
  const envelopeArtifact = receipt.resulting_canonical_artifacts.find((artifact) => artifact.role === 'evidence_envelope');
  const candidateEnvelopeArtifact = receipt.resulting_canonical_artifacts.find((artifact) => artifact.role === 'authorized_candidate_envelope');
  const authArtifact = receipt.resulting_canonical_artifacts.find((artifact) => artifact.role === 'attachment_authorization');
  const onboardingArtifact = receipt.resulting_canonical_artifacts.find((artifact) => artifact.role === 'authorized_onboarding_record');
  return {
    receipt,
    receiptPath: receiptInput.real,
    receiptRef: repoRelative(root, receiptInput.real),
    receiptSha256: sha256Bytes(receiptInput.bytes),
    envelope,
    candidateEnvelope,
    authorization,
    authorizedOnboardingRecord,
    envelopeArtifact,
    candidateEnvelopeArtifact,
    authorizationArtifact: authArtifact,
    onboardingArtifact,
  };
}

export function reviewPackClaimsInspectionEvidence(reviewPack) {
  return (reviewPack?.evidence_ledger?.records || []).some((record) => (
    record?.inspection_evidence === true
    || record?.type === 'inspection_evidence'
    || record?.artifact_type === 'inspection_evidence'
  ));
}

export function assertRegularReadinessPackHasNoInspectionEvidenceClaim(reviewPack) {
  if (reviewPackClaimsInspectionEvidence(reviewPack)) {
    throw new InspectionEvidenceOnboardingError(
      'separate_readiness_regeneration_required',
      'review-pack claims inspection_evidence; use the separately authorized inspection-evidence readiness regeneration command with a verified attachment record'
    );
  }
}

export async function verifyInspectionEvidenceReadinessAuthorization({
  projectRoot,
  attachmentRecordPath,
  readinessAuthorizationPath,
  reviewPackPath,
  readinessOutputPath,
} = {}) {
  const attachment = await verifyCanonicalInspectionEvidenceAttachment(projectRoot, attachmentRecordPath);
  const canonicalBoundary = await ensureCanonicalAttachmentBoundary(projectRoot, attachment.receipt.package_slug);
  const authorizationInput = await readRegularFileNoFollow(readinessAuthorizationPath, {
    label: 'inspection evidence readiness authorization',
    maxBytes: 256 * 1024,
  });
  const reviewDirectory = await assertRealDirectory(
    join(canonicalBoundary.packageRoot, 'review'),
    canonicalBoundary.packageRoot,
    'Canonical review directory'
  );
  const expectedReviewPackPath = join(reviewDirectory, 'review_pack.json');
  if (resolve(reviewPackPath) !== expectedReviewPackPath) {
    throw new InspectionEvidenceOnboardingError('review_pack_noncanonical', `Readiness regeneration requires canonical review pack ${repoRelative(canonicalBoundary.root, expectedReviewPackPath)}`);
  }
  const reviewPackInput = await readCanonicalRegularFile(
    canonicalBoundary.root,
    expectedReviewPackPath,
    'review pack for readiness regeneration',
    10 * 1024 * 1024
  );
  let authorization;
  let reviewPack;
  try {
    authorization = parseInspectionEvidenceJsonBytes(authorizationInput.bytes);
    reviewPack = parseInspectionEvidenceJsonBytes(reviewPackInput.bytes);
  } catch (error) {
    throw new InspectionEvidenceOnboardingError('readiness_input_malformed', 'Readiness authorization and review pack must be valid JSON', { cause: error.message });
  }
  assertInspectionEvidenceValidation(validateInspectionEvidenceReadinessAuthorizationSchema(authorization), 'readiness_authorization_schema_invalid');
  if (findNonGenuineStringMarkers(authorization).length > 0) {
    throw new InspectionEvidenceOnboardingError('synthetic_readiness_authorization_forbidden', 'Synthetic, fixture, surrogate, or test-only authorization cannot regenerate production readiness');
  }
  if (!validateInspectionEvidenceControlMaterial(authorization).ok) {
    throw new InspectionEvidenceOnboardingError('unsafe_readiness_authorization', 'Readiness authorization must not expose secrets or private machine paths');
  }
  const expectedReviewPackRef = `docs/examples/${attachment.receipt.package_slug}/review/review_pack.json`;
  const actualReviewPackRef = repoRelative(canonicalBoundary.root, reviewPackInput.real);
  const expectedReadinessOutputRef = `docs/examples/${attachment.receipt.package_slug}/readiness/readiness_report.json`;
  const actualReadinessOutputRef = readinessOutputPath ? repoRelative(canonicalBoundary.root, resolve(readinessOutputPath)) : null;
  if (actualReviewPackRef !== expectedReviewPackRef) {
    throw new InspectionEvidenceOnboardingError('review_pack_noncanonical', `Readiness regeneration requires canonical review pack ${expectedReviewPackRef}`);
  }
  if (actualReadinessOutputRef !== expectedReadinessOutputRef) {
    throw new InspectionEvidenceOnboardingError('readiness_output_noncanonical', `Readiness regeneration output must be ${expectedReadinessOutputRef}`);
  }
  if (resolve(readinessOutputPath) !== canonicalBoundary.paths.readiness) {
    throw new InspectionEvidenceOnboardingError('unsafe_readiness_target', 'Readiness regeneration output must be the real canonical non-symlink readiness report');
  }
  const readinessMarkdownInfo = await lstat(canonicalBoundary.paths.readinessMarkdown);
  if (
    readinessMarkdownInfo.isSymbolicLink()
    || !readinessMarkdownInfo.isFile()
    || await realpath(canonicalBoundary.paths.readinessMarkdown) !== canonicalBoundary.paths.readinessMarkdown
  ) {
    throw new InspectionEvidenceOnboardingError('unsafe_readiness_markdown_target', 'Canonical readiness Markdown must be a real non-symlink file');
  }
  const currentReadinessSha256 = await hashFile(canonicalBoundary.paths.readiness);
  const currentReadinessMarkdownSha256 = await hashFile(canonicalBoundary.paths.readinessMarkdown);
  const expected = {
    package_slug: attachment.receipt.package_slug,
    package_revision: attachment.receipt.package_revision,
    attachment_record_ref: attachment.receiptRef,
    attachment_record_sha256: attachment.receiptSha256,
    review_pack_sha256: reviewPackInput.sha256,
    current_readiness_sha256: currentReadinessSha256,
    current_readiness_markdown_sha256: currentReadinessMarkdownSha256,
    readiness_output_ref: expectedReadinessOutputRef,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (authorization[key] !== value) {
      throw new InspectionEvidenceOnboardingError('readiness_authorization_binding_mismatch', `${key} does not match the attached evidence/readiness input`);
    }
  }
  if (!isValidInspectionEvidenceIdentityRef(authorization.authorized_by_ref)) {
    throw new InspectionEvidenceOnboardingError('invalid_readiness_authorizer', 'Readiness authorization requires an explicit portable authorizer identity reference');
  }
  assertInspectionEvidenceReadinessAuthorizationTiming({
    authorizedAt: authorization.authorized_at,
    attachedAt: attachment.receipt.attached_at,
  });
  const inspectionRecords = (reviewPack?.evidence_ledger?.records || []).filter((record) => record?.type === 'inspection_evidence');
  if (inspectionRecords.length !== 1) {
    throw new InspectionEvidenceOnboardingError('review_pack_attachment_record_missing', 'Readiness review pack must contain exactly one verified inspection_evidence record');
  }
  const inspectionRecord = inspectionRecords[0];
  if (
    inspectionRecord.sha256 !== attachment.envelopeArtifact.sha256
    || inspectionRecord.source_ref !== attachment.envelopeArtifact.path
    || inspectionRecord.attachment_record?.source_ref !== attachment.receiptRef
    || inspectionRecord.attachment_record?.sha256 !== attachment.receiptSha256
    || inspectionRecord.attachment_record?.package_revision !== attachment.receipt.package_revision
  ) {
    throw new InspectionEvidenceOnboardingError('review_pack_attachment_binding_mismatch', 'Review-pack evidence record does not match the immutable attachment receipt');
  }
  assertInspectionEvidenceResultBinding(inspectionRecord, attachment.envelope);
  const reviewPackRevision = reviewPack.revision ?? reviewPack.part?.revision ?? null;
  if (reviewPackRevision !== attachment.receipt.package_revision) {
    throw new InspectionEvidenceOnboardingError('review_pack_revision_mismatch', 'Canonical review pack revision must match the attached evidence package revision');
  }
  const reviewPackPartId = reviewPack.part_id ?? reviewPack.part?.part_id ?? null;
  if (reviewPackPartId !== attachment.envelope.subject.identifier) {
    throw new InspectionEvidenceOnboardingError('review_pack_subject_mismatch', 'Canonical review pack part identifier must match the inspected evidence subject');
  }
  return {
    attachment,
    authorization,
    reviewPack,
    reviewPackSha256: reviewPackInput.sha256,
    currentReadinessSha256,
    currentReadinessMarkdownSha256,
  };
}

export async function regenerateAuthorizedInspectionEvidenceReadiness({
  projectRoot,
  attachmentRecordPath,
  readinessAuthorizationPath,
  reviewPackPath,
  readinessOutputPath,
} = {}) {
  const initial = await verifyInspectionEvidenceReadinessAuthorization({
    projectRoot,
    attachmentRecordPath,
    readinessAuthorizationPath,
    reviewPackPath,
    readinessOutputPath,
  });
  const boundary = await ensureCanonicalAttachmentBoundary(projectRoot, initial.attachment.receipt.package_slug);
  return withCanonicalPackageMutationLock(boundary.inspection, async () => {
    const verified = await verifyInspectionEvidenceReadinessAuthorization({
      projectRoot,
      attachmentRecordPath,
      readinessAuthorizationPath,
      reviewPackPath,
      readinessOutputPath,
    });
    const report = buildReadinessReportFromReviewPack({
      reviewPack: verified.reviewPack,
      reviewPackPath: repoRelative(boundary.root, resolve(reviewPackPath)),
    });
    assertValidCArtifact('readiness_report', report, {
      command: 'readiness-report',
      path: boundary.paths.readiness,
    });
    if (
      await hashFile(boundary.paths.readiness) !== verified.currentReadinessSha256
      || await hashFile(boundary.paths.readinessMarkdown) !== verified.currentReadinessMarkdownSha256
    ) {
      throw new InspectionEvidenceOnboardingError('readiness_changed_before_regeneration', 'Readiness changed after authorization verification and before mutation');
    }

    const originalJson = await readFile(boundary.paths.readiness);
    const originalMarkdown = await readFile(boundary.paths.readinessMarkdown);
    try {
      await atomicWrite(boundary.paths.readiness, serializeCanonicalJson(report), { replace: true });
      await atomicWrite(boundary.paths.readinessMarkdown, `${String(report.markdown || '').trim()}\n`, { replace: true });
    } catch (error) {
      await atomicWrite(boundary.paths.readiness, originalJson, { replace: true }).catch(() => {});
      await atomicWrite(boundary.paths.readinessMarkdown, originalMarkdown, { replace: true }).catch(() => {});
      throw error;
    }
    return {
      ...verified,
      report,
      artifacts: {
        json: boundary.paths.readiness,
        markdown: boundary.paths.readinessMarkdown,
      },
    };
  });
}

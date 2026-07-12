import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import {
  AfExecutionContractError,
  buildAfArtifactContractFromDocument,
  buildAfExecutionStateDescriptor,
  validateDocsManifestAgainstReadiness,
} from '../../../lib/af-execution-contract.js';
import { buildArtifactManifest } from '../../../lib/artifact-manifest.js';
import { deepMerge } from '../../../lib/config-loader.js';
import { loadConfigWithDiagnostics, serializeConfig, validateConfigDocument } from '../../../lib/config-schema.js';
import { assertValidCArtifact } from '../../../lib/c-artifact-schema.js';
import {
  readJsonFile,
  runPythonJsonScript,
} from '../../../lib/context-loader.js';
import {
  D_ANALYSIS_VERSION,
  D_ARTIFACT_SCHEMA_VERSION,
  assertValidDArtifact,
} from '../../../lib/d-artifact-schema.js';
import { isWindowsAbsolutePath, normalizeLocalPath } from '../../../lib/paths.js';
import { runScript } from '../../../lib/runner.js';
import { createDfmService } from '../../api/analysis.js';
import { createDrawingService, runDrawPipeline } from '../../api/drawing.js';
import { analyzeStep, createModel, inspectModel } from '../../api/model.js';
import { createReportService } from '../../api/report.js';
import { runReviewContextPipeline } from '../../orchestration/review-context-pipeline.js';
import { runReleaseBundleWorkflow } from '../../workflows/release-bundle-workflow.js';
import { runStandardDocsWorkflow } from '../../workflows/standard-docs-workflow.js';
import {
  buildReadinessReportFromReviewPack,
  buildStabilizationReviewFromReadinessReports,
  writeCanonicalReadinessArtifacts,
} from '../../workflows/canonical-readiness-builders.js';
import { writeEvidenceReadinessAudit } from '../evidence-readiness-audit/evidence-readiness-audit-service.js';
import { discoverInspectionEvidenceIntake } from '../inspection-evidence-intake/inspection-evidence-intake-service.js';
import { assertRegularReadinessPackHasNoInspectionEvidenceClaim } from '../inspection-evidence-intake/inspection-evidence-onboarding-service.js';
import {
  createInspectionPlanFromPaths,
  writeInspectionPlanOutputs,
} from '../inspection-plan/inspection-plan-service.js';
import { buildInspectionEvidencePromotionDryRunManifest } from '../inspection-evidence-intake/promotion-dry-run-service.js';
import {
  createRevisionImpactReportFromPaths,
  preflightRevisionImpactArtifactTargets,
  writeRevisionImpactArtifacts,
} from '../revision-impact/revision-impact-service.js';
import { writeStage5bEvidenceAuditBundle } from '../inspection-evidence-intake/stage5b-evidence-audit-service.js';
import {
  assertValidEvidenceGraph,
  buildEvidenceGraph,
} from '../evidence-graph/evidence-graph-service.js';
import {
  assertValidStage5bIntakeReport,
  assertValidStage5bPromotionDryRunManifest,
} from '../inspection-evidence-intake/stage5b-runtime-validation.js';
import {
  resolveBundleBackedCanonicalPath,
  resolveBundleBackedConfigPath,
  resolveBundleBackedDocsManifestPath,
  summarizeBundleImports,
} from './af-reentry.js';
import { loadRuleProfile, summarizeRuleProfile } from '../config/rule-profile-service.js';
import { validateLocalApiJobRequest } from '../../server/local-api-schemas.js';
import { JOB_EXECUTOR_COMMANDS } from '../../shared/command-manifest.js';
import { applyArtifactPublicationBoundary } from '../../shared/artifact-surface.js';
import { executeJobByType } from './execution/handler-registry.js';
import {
  buildGenericAfMetadata,
  buildReleaseBundleManifestMetadata,
  buildReleaseBundleMetadata,
} from './execution/metadata-builders.js';
import { writeTrackedStage5bValidationDiagnostics } from './execution/stage5b-handlers.js';
import {
  isLocalStage5bCandidateEvidenceInboxPath,
  normalizeRepoRelativePathText,
} from '../../shared/stage5b-path-boundary.js';

export {
  applyArtifactPublicationBoundary,
  collectReportManifestArtifacts,
} from '../../shared/artifact-surface.js';

const JOB_TYPES = new Set(JOB_EXECUTOR_COMMANDS);
const INLINE_CONFIG_RELATIVE_PATH = 'inputs/inline-config.json';
const EFFECTIVE_CONFIG_RELATIVE_PATH = 'inputs/effective-config.json';
const MAX_TRACKED_ID_LENGTH = 128;
const INSPECTABLE_MODEL_EXTENSIONS = new Set(['.brep', '.brp', '.fcstd', '.step', '.stl', '.stp']);
const DIRECT_JOB_PATH_FIELDS = Object.freeze({
  create: ['config_path'],
  draw: ['config_path'],
  report: ['config_path'],
  'review-context': [
    'context_path',
    'model_path',
    'bom_path',
    'inspection_path',
    'quality_path',
    'create_quality_path',
    'drawing_quality_path',
    'drawing_qa_path',
    'drawing_intent_path',
    'feature_catalog_path',
    'dfm_report_path',
    'compare_to_path',
  ],
  'compare-rev': [
    'baseline_path',
    'candidate_path',
    'baseline_readiness_path',
    'candidate_readiness_path',
    'baseline_config_path',
    'candidate_config_path',
    'baseline_evidence_envelope_path',
    'candidate_evidence_envelope_path',
    'baseline_evidence_receipt_path',
    'candidate_evidence_receipt_path',
  ],
  'readiness-pack': ['review_pack_path', 'process_plan_path', 'quality_risk_path'],
  'evidence-graph': ['review_pack_path', 'readiness_report_path'],
  'stabilization-review': ['baseline_path', 'candidate_path'],
  'generate-standard-docs': ['config_path', 'readiness_report_path'],
  'inspection-plan': ['review_pack_path', 'revision_impact_path', 'readiness_report_path', 'config_path', 'requirements_path'],
  pack: ['readiness_report_path', 'docs_manifest_path'],
  'inspection-evidence-promotion-dry-run': ['intake_report_path'],
});

function resolveMaybe(projectRoot, value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = normalizeLocalPath(value);
  if (!normalized) return null;
  if (normalized.startsWith('/') || isWindowsAbsolutePath(normalized)) {
    return normalized;
  }
  return resolve(projectRoot, normalized);
}

function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const next = structuredClone(result);
  delete next.svgContent;
  delete next.pdfBase64;
  return next;
}

async function pathExists(path) {
  if (!path) return false;
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function buildSeededReportArtifactPaths(configName) {
  const stem = String(configName || '').trim();
  if (!stem) return {};
  return {
    create_quality: `${stem}_create_quality.json`,
    drawing_quality: `${stem}_drawing_quality.json`,
    extracted_drawing_semantics: `${stem}_extracted_drawing_semantics.json`,
    create_manifest: `${stem}_manifest.json`,
    drawing_manifest: `${stem}_drawing_manifest.json`,
    drawing_svg: `${stem}_drawing.svg`,
    model_step: `${stem}.step`,
    model_stl: `${stem}.stl`,
  };
}

async function seedTrackedReportArtifacts({
  projectRoot,
  resolvedConfig,
  outputDir,
}) {
  const configName = resolvedConfig?.config?.name || null;
  const fileNames = buildSeededReportArtifactPaths(configName);
  if (Object.keys(fileNames).length === 0) {
    return {};
  }

  const sourceDir = resolve(
    projectRoot,
    resolvedConfig?.config?.export?.directory || 'output'
  );
  if (!isPathInsideProject(projectRoot, sourceDir)) {
    return {};
  }
  const seededArtifacts = {};

  for (const [key, fileName] of Object.entries(fileNames)) {
    const sourcePath = join(sourceDir, fileName);
    if (!(await pathExists(sourcePath))) continue;
    const targetPath = join(outputDir, fileName);
    if (resolve(sourcePath) !== resolve(targetPath)) {
      await copyFile(sourcePath, targetPath);
    }
    seededArtifacts[key] = targetPath;
  }

  return seededArtifacts;
}

export async function prepareTrackedReportAnalysisResults({
  projectRoot,
  resolvedConfig,
  requestOptions = {},
  createDfmServiceFn = createDfmService,
} = {}) {
  const explicitAnalysisResults = requestOptions?.analysis_results || null;
  if (explicitAnalysisResults?.dfm) {
    return explicitAnalysisResults;
  }

  if (requestOptions?.include_dfm !== true) {
    return explicitAnalysisResults;
  }

  const runDfm = createDfmServiceFn();
  const dfm = await runDfm({
    freecadRoot: projectRoot,
    configPath: resolvedConfig?.configPath || null,
    config: resolvedConfig?.config || null,
  });

  return {
    ...(explicitAnalysisResults || {}),
    dfm,
  };
}

function collectInspectManifestArtifacts(resolvedConfig) {
  return resolvedConfig?.filePath
    ? [{
        type: 'input.model',
        path: resolvedConfig.filePath,
        label: 'Input model',
        scope: 'internal',
        stability: 'internal',
      }]
    : [];
}

function buildJobArtifactPath(jobStore, jobId, fileName) {
  return join(jobStore.getJobDir(jobId), 'artifacts', fileName);
}

async function ensureJobArtifactDir(jobStore, jobId) {
  const directory = join(jobStore.getJobDir(jobId), 'artifacts');
  await mkdir(directory, { recursive: true });
  return directory;
}

function isPathInsideProject(projectRoot, pathValue) {
  return isPathWithinRoot(projectRoot, pathValue) && resolve(projectRoot) !== resolve(pathValue);
}

function isPathWithinRoot(rootDir, pathValue) {
  const root = resolve(rootDir);
  const target = resolve(pathValue);
  const rel = relative(root, target).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function withTrackedExportDirectory(config = {}, outputDir, { ensureExport = false } = {}) {
  const next = structuredClone(config || {});
  if (next.export || ensureExport) {
    next.export = {
      ...(next.export || {}),
      directory: outputDir,
    };
  }
  return next;
}

function isInspectableModelArtifactRecord(artifact = {}) {
  const fields = [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
    artifact.path,
  ].filter(Boolean).join(' ');
  return isInspectableModelPath(artifact.path || artifact.file_name)
    || /\bmodel\.(?:brep|brp|fcstd|step|stl|stp)\b/i.test(fields);
}

function assertUserFacingArtifactRef(artifact = {}) {
  if (artifact.scope === 'internal') {
    throw new Error('artifact_ref points to an internal tracked artifact; use a user-facing tracked artifact.');
  }
}

function buildBundleImportManifestArtifacts(importRecords = []) {
  const bundleEntries = [];
  const extractedEntries = [];
  const seenBundles = new Set();
  const kindToType = {
    review_pack: 'input.bundle.review-pack',
    readiness_report: 'input.bundle.readiness-report',
    docs_manifest: 'input.bundle.docs-manifest',
    config: 'input.bundle.config',
  };
  const kindToLabel = {
    review_pack: 'Imported review pack JSON',
    readiness_report: 'Imported readiness report JSON',
    docs_manifest: 'Imported standard docs manifest JSON',
    config: 'Imported config input',
  };

  for (const record of importRecords) {
    if (!record?.bundle_path || !record?.entry_name || !record?.extracted_path) continue;
    if (!seenBundles.has(record.bundle_path)) {
      seenBundles.add(record.bundle_path);
      bundleEntries.push({
        type: 'input.release-bundle',
        path: record.bundle_path,
        label: 'Source release bundle ZIP',
        scope: 'internal',
        stability: 'stable',
      });
    }
    extractedEntries.push({
      type: kindToType[record.kind] || 'input.bundle.artifact',
      path: record.extracted_path,
      label: kindToLabel[record.kind] || 'Imported bundle artifact',
      scope: 'internal',
      stability: record.auto_detected ? 'best-effort' : 'stable',
    });
  }

  return [...bundleEntries, ...extractedEntries];
}

function formatBundleImportLog(record) {
  const kindLabel = record?.kind ? String(record.kind).replace(/_/g, ' ') : 'artifact';
  const entryName = record?.entry_name || 'unknown-entry';
  const bundleName = record?.bundle_path ? basename(record.bundle_path) : 'bundle.zip';
  const suffix = record?.auto_detected ? ' (auto-detected)' : '';
  return `Imported ${kindLabel} from ${bundleName}:${entryName}${suffix}`;
}

function findSourceArtifactRef(document = {}, artifactType) {
  return Array.isArray(document?.source_artifact_refs)
    ? document.source_artifact_refs.find((ref) => ref?.artifact_type === artifactType && typeof ref.path === 'string' && ref.path.trim())
    : null;
}

function buildReadinessRehydratedConfig(readinessReport = {}) {
  const part = readinessReport?.part && typeof readinessReport.part === 'object' ? readinessReport.part : {};
  const cadModelRef = findSourceArtifactRef(readinessReport, 'cad_model');
  const name = part.name || part.part_id || 'derived_part';
  const config = {
    config_version: 1,
    name,
    export: {
      formats: ['step'],
      directory: 'output',
    },
  };

  if (part.part_id || part.revision) {
    config.product = {};
    if (part.part_id) config.product.part_id = part.part_id;
    if (part.revision) config.product.revision = part.revision;
  }

  if (part.material || part.process) {
    config.manufacturing = {};
    if (part.material) config.manufacturing.material = part.material;
    if (part.process) config.manufacturing.process = part.process;
  }

  if (cadModelRef?.path) {
    config.import = {
      source_step: cadModelRef.path,
    };
  }

  if (readinessReport?.rule_profile?.id) {
    config.standards = {
      profile: readinessReport.rule_profile.id,
    };
  }

  return config;
}

async function loadReviewPackHandoff(pathValue, { command }) {
  const artifact = await readJsonFile(pathValue);
  assertReviewPackHandoff(artifact, pathValue, { command });
  return artifact;
}

function assertReviewPackHandoff(artifact, pathValue, { command }) {
  buildAfArtifactContractFromDocument({
    jobType: command,
    target: 'review_pack',
    document: artifact,
    path: pathValue,
    strictReentry: true,
  });
  return artifact;
}

function buildReviewPackSnapshotMetadata(side) {
  const source = side?.sources?.review_pack;
  if (!Buffer.isBuffer(source?.bytes) || !/^[a-f0-9]{64}$/.test(source?.sha256 || '')) {
    throw new Error('Revision-impact review-pack snapshot metadata is unavailable');
  }
  return {
    exists: true,
    size_bytes: source.bytes.length,
    sha256: source.sha256,
  };
}

async function loadReadinessReportHandoff(pathValue, { command }) {
  const artifact = await readJsonFile(pathValue);
  buildAfArtifactContractFromDocument({
    jobType: command,
    target: 'readiness_report',
    document: artifact,
    path: pathValue,
    strictReentry: true,
  });
  return artifact;
}

async function loadDocsManifestHandoff(pathValue, { readinessReport, readinessPath, allowBundledPair = false }) {
  const artifact = await readJsonFile(pathValue);
  assertValidCArtifact('docs_manifest', artifact, { command: 'pack', path: pathValue });
  validateDocsManifestAgainstReadiness({
    readinessReport,
    readinessPath,
    docsManifest: artifact,
    docsManifestPath: pathValue,
    allowBundledPair,
  });
  return artifact;
}

async function loadCanonicalSupportArtifact(kind, pathValue, command) {
  const artifact = await readJsonFile(pathValue);
  assertValidCArtifact(kind, artifact, { command, path: pathValue });
  return artifact;
}

function validateOptionsObject(value, fieldName, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${fieldName} must be an object when provided.`);
  }
}

function normalizeIntakePackageSlugs(options = {}) {
  const value = options.package_slugs ?? null;
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  return undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRepoRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const raw = value.trim();
  const normalized = normalizeLocalPath(raw);
  if (typeof normalized !== 'string' || !normalized.trim()) return false;
  const path = normalizeRepoRelativePathText(normalized);
  if (raw.includes('\\')) return false;
  if (path.includes('\0')) return false;
  if (path.startsWith('/') || path.startsWith('~') || isWindowsAbsolutePath(path)) return false;
  if (path.includes('<') || path.includes('>')) return false;
  if (path.split('/').includes('..')) return false;
  if (isLocalStage5bCandidateEvidenceInboxPath(path)) return false;
  return true;
}

function isSafeTrackedId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const lower = raw.toLowerCase();
  return Boolean(raw)
    && raw.length <= MAX_TRACKED_ID_LENGTH
    && raw !== '.'
    && raw !== '..'
    && !raw.includes('/')
    && !raw.includes('\\')
    && !lower.includes('%2f')
    && !lower.includes('%5c')
    && !raw.includes('\0')
    && !raw.startsWith('~');
}

function isInspectableModelPath(value) {
  return INSPECTABLE_MODEL_EXTENSIONS.has(extname(String(value || '')).toLowerCase());
}

function isSafeRepoRelativeJsonPath(value) {
  return isSafeRepoRelativePath(value) && /\.json$/i.test(String(value || '').trim());
}

function isPathInsideTrustedRoot(value, trustedPathRoots = []) {
  if (typeof value !== 'string' || !isAbsolute(value)) return false;
  const target = resolve(value);
  return trustedPathRoots.some((rootValue) => {
    if (typeof rootValue !== 'string' || !rootValue.trim()) return false;
    const root = resolve(rootValue);
    const rel = relative(root, target).replace(/\\/g, '/');
    return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
  });
}

function validateDirectJobPathFields(request, errors, { trustedPathRoots = [] } = {}) {
  const fields = DIRECT_JOB_PATH_FIELDS[request.type] || [];
  for (const field of fields) {
    const value = request[field];
    if (value === undefined || value === null || value === '') continue;
    if (!isSafeRepoRelativePath(value) && !isPathInsideTrustedRoot(value, trustedPathRoots)) {
      errors.push(`${request.type} ${field} must be a safe repo-relative path; use Studio artifact_ref re-entry for tracked artifacts.`);
    }
  }
}

function validateInspectRequest(request, errors) {
  if (request.type !== 'inspect') return;
  const hasFilePath = typeof request.file_path === 'string' && request.file_path.trim().length > 0;
  const hasArtifactRef = isPlainObject(request.artifact_ref);

  if (hasFilePath && !isSafeRepoRelativePath(request.file_path)) {
    errors.push('inspect file_path must be a safe repo-relative model path; use artifact_ref for tracked Studio re-entry.');
  }
  if (hasFilePath && !isInspectableModelPath(request.file_path)) {
    errors.push('inspect file_path must use a supported model extension: .brep, .brp, .fcstd, .step, .stl, or .stp.');
  }
  if (!hasFilePath && !hasArtifactRef) {
    errors.push('inspect requires file_path or artifact_ref.');
  }
  if (hasFilePath && hasArtifactRef) {
    errors.push('inspect accepts only one model source: file_path or artifact_ref.');
  }
}

function validateArtifactRefSafety(request, errors) {
  [
    ['artifact_ref', request.artifact_ref],
    ['intake_report_artifact_ref', request.intake_report_artifact_ref],
  ].forEach(([fieldName, ref]) => {
    if (!isPlainObject(ref)) return;
    if (!isSafeTrackedId(ref.job_id)) {
      errors.push(`${fieldName}.job_id must be a safe tracked id.`);
    }
    if (!isSafeTrackedId(ref.artifact_id)) {
      errors.push(`${fieldName}.artifact_id must be a safe tracked id.`);
    }
  });
}

function validatePromotionDryRunRequest(request, errors) {
  if (request.type !== 'inspection-evidence-promotion-dry-run') return;

  const hasPath = typeof request.intake_report_path === 'string' && request.intake_report_path.trim().length > 0;
  const hasArtifactRef = isPlainObject(request.intake_report_artifact_ref);

  if (hasPath && !isSafeRepoRelativeJsonPath(request.intake_report_path)) {
    errors.push('inspection-evidence-promotion-dry-run intake_report_path must be a safe repo-relative JSON path.');
  }

  if (!hasPath && !hasArtifactRef) {
    errors.push('inspection-evidence-promotion-dry-run requires intake_report_path or intake_report_artifact_ref.');
  }

  if (hasPath && hasArtifactRef) {
    errors.push('inspection-evidence-promotion-dry-run accepts only one intake report source.');
  }
}

function validateEvidenceGraphRequest(request, errors) {
  if (request.type !== 'evidence-graph') return;

  const packageId = typeof request.package_id === 'string' ? request.package_id.trim() : '';
  if (!packageId) {
    errors.push('evidence-graph package_id must be a non-empty string.');
  } else if (
    packageId === '.'
    || packageId === '..'
    || packageId.includes('/')
    || packageId.includes('\\')
    || packageId.includes('\0')
    || packageId.startsWith('~')
  ) {
    errors.push('evidence-graph package_id must be a safe package slug.');
  }

  [
    ['review_pack_path', request.review_pack_path],
    ['readiness_report_path', request.readiness_report_path],
  ].forEach(([fieldName, value]) => {
    if (typeof value !== 'string' || value.trim().length === 0) return;
    if (!isSafeRepoRelativeJsonPath(value)) {
      errors.push(`evidence-graph ${fieldName} must be a safe repo-relative JSON path.`);
    }
  });
}

function validateInspectionPlanRequest(request, errors) {
  if (request.type !== 'inspection-plan') return;
  if (request.scope === 'delta' && !request.revision_impact_path) {
    errors.push('inspection-plan delta scope requires revision_impact_path.');
  }
}

function validateInspectionEvidenceIntakeRequest(request, errors) {
  if (request.type !== 'inspection-evidence-intake') return;
  if (request.options !== undefined && !isPlainObject(request.options)) return;

  const options = request.options || {};
  const optionKeys = Object.keys(options);
  const unsupportedOptions = optionKeys.filter((key) => !['include_github', 'package_slugs'].includes(key));
  if (unsupportedOptions.length > 0) {
    errors.push(`inspection-evidence-intake options only accepts include_github and package_slugs; unsupported option(s): ${unsupportedOptions.join(', ')}.`);
  }
  if (
    Object.hasOwn(options, 'include_github')
    && typeof options.include_github !== 'boolean'
  ) {
    errors.push('inspection-evidence-intake options.include_github must be a boolean when provided.');
  }
  if (
    Object.hasOwn(options, 'package_slugs')
    && (!Array.isArray(options.package_slugs)
      || options.package_slugs.some((slug) => typeof slug !== 'string' || slug.trim().length === 0))
  ) {
    errors.push('inspection-evidence-intake options.package_slugs must be an array of non-empty strings when provided.');
  }
}

function validateStage5bAuditRequest(request, errors) {
  if (request.type !== 'stage5b-evidence-audit') return;
  if (request.options !== undefined && !isPlainObject(request.options)) return;

  const options = request.options || {};
  const optionKeys = Object.keys(options);
  const unsupportedOptions = optionKeys.filter((key) => key !== 'include_github');
  if (unsupportedOptions.length > 0) {
    errors.push(`stage5b-evidence-audit options only accepts include_github; unsupported option(s): ${unsupportedOptions.join(', ')}.`);
  }
  if (
    Object.hasOwn(options, 'include_github')
    && typeof options.include_github !== 'boolean'
  ) {
    errors.push('stage5b-evidence-audit options.include_github must be a boolean when provided.');
  }
}

function validateEvidenceReadinessAuditRequest(request, errors) {
  if (request.type !== 'evidence-readiness-audit') return;
  if (request.options !== undefined && !isPlainObject(request.options)) return;

  const options = request.options || {};
  const optionKeys = Object.keys(options);
  const unsupportedOptions = optionKeys.filter((key) => !['package_slugs', 'generated_at'].includes(key));
  if (unsupportedOptions.length > 0) {
    errors.push(`evidence-readiness-audit options only accepts package_slugs and generated_at; unsupported option(s): ${unsupportedOptions.join(', ')}.`);
  }
  if (
    Object.hasOwn(options, 'package_slugs')
    && (!Array.isArray(options.package_slugs)
      || options.package_slugs.some((slug) => typeof slug !== 'string' || slug.trim().length === 0))
  ) {
    errors.push('evidence-readiness-audit options.package_slugs must be an array of non-empty strings when provided.');
  }
  if (
    Object.hasOwn(options, 'generated_at')
    && (typeof options.generated_at !== 'string' || Number.isNaN(Date.parse(options.generated_at)))
  ) {
    errors.push('evidence-readiness-audit options.generated_at must be an ISO timestamp string when provided.');
  }
}

function isInspectionEvidenceIntakeArtifactRecord(artifact = {}) {
  const search = [
    artifact.type,
    artifact.key,
    artifact.file_name,
    artifact.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return search.includes('inspection-evidence.intake-report')
    || search.includes('inspection-evidence-intake-report')
    || search.includes('intake-report');
}

export function validateJobRequest(body, { trustedPathRoots = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['Request body must be a JSON object.'] };
  }

  const request = structuredClone(body);
  const schemaValidation = validateLocalApiJobRequest(request);
  const errors = [...schemaValidation.errors];

  if (typeof request.type === 'string' && JOB_TYPES.has(request.type)) {
    validateOptionsObject(request.options, 'options', errors);
    if (Object.hasOwn(request, 'config') && request.config !== undefined) {
      validateOptionsObject(request.config, 'config', errors);
    }
    validateInspectRequest(request, errors);
    validateArtifactRefSafety(request, errors);
    validateDirectJobPathFields(request, errors, { trustedPathRoots });
    validateInspectionEvidenceIntakeRequest(request, errors);
    validatePromotionDryRunRequest(request, errors);
    validateEvidenceGraphRequest(request, errors);
    validateInspectionPlanRequest(request, errors);
    validateStage5bAuditRequest(request, errors);
    validateEvidenceReadinessAuditRequest(request, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    request,
  };
}

export function createJobExecutor({
  projectRoot,
  jobStore,
  generateDrawing = createDrawingService(),
  generateReport = createReportService(),
}) {
  function appendLog(jobId, message) {
    return jobStore.appendLog(jobId, message).catch(() => {});
  }

  function createLoggedRunner(jobId) {
    return (script, input, options = {}) => runScript(script, input, {
      ...options,
      onStderr: (text) => {
        appendLog(jobId, `[${script}] ${text.trimEnd()}`);
        if (typeof options.onStderr === 'function') options.onStderr(text);
      },
    });
  }

  async function persistValidatedConfig(job, {
    config,
    summary,
    rawRelativePath = INLINE_CONFIG_RELATIVE_PATH,
  }) {
    const rawInputPath = await jobStore.writeJobFile(job.id, rawRelativePath, `${JSON.stringify(config, null, 2)}\n`);
    const effectiveConfigPath = await jobStore.writeJobFile(
      job.id,
      EFFECTIVE_CONFIG_RELATIVE_PATH,
      serializeConfig(config, 'json')
    );

    return {
      config,
      configPath: effectiveConfigPath,
      rawConfigPath: rawInputPath,
      summary,
      diagnostics: {
        config_warnings: summary.warnings,
        config_changed_fields: summary.changed_fields,
        config_deprecated_fields: summary.deprecated_fields,
      },
    };
  }

  async function resolveGenerateStandardDocsConfigFromReadiness(job) {
    const readinessReportPath = resolveMaybe(projectRoot, job.request.readiness_report_path);
    const readinessReport = await loadReadinessReportHandoff(readinessReportPath, { command: 'generate-standard-docs' });
    const sourceConfigRef = findSourceArtifactRef(readinessReport, 'config');
    if (sourceConfigRef?.path) {
      try {
        const sourceConfigPath = resolveMaybe(projectRoot, sourceConfigRef.path) || sourceConfigRef.path;
        const loaded = await loadConfigWithDiagnostics(sourceConfigPath);
        return persistValidatedConfig(job, {
          config: loaded.config,
          summary: loaded.summary,
          rawRelativePath: 'inputs/rehydrated-config.json',
        });
      } catch {
        // Fall through to a synthetic config when the referenced config is unavailable.
      }
    }

    const derivedValidation = validateConfigDocument(
      buildReadinessRehydratedConfig(readinessReport),
      { filepath: `${job.id}:rehydrated-readiness-config` }
    );
    if (!derivedValidation.valid) {
      throw new Error(derivedValidation.summary.errors.join(' | '));
    }

    return persistValidatedConfig(job, {
      config: derivedValidation.config,
      summary: derivedValidation.summary,
      rawRelativePath: 'inputs/rehydrated-config.json',
    });
  }

  async function resolveConfigInput(job) {
    if (job.request.type === 'inspect') {
      if (job.request.artifact_ref) {
        const ref = {
          job_id: String(job.request.artifact_ref.job_id || '').trim(),
          artifact_id: String(job.request.artifact_ref.artifact_id || '').trim(),
        };
        const artifact = await jobStore.getArtifact(ref.job_id, ref.artifact_id);
        if (!artifact) {
          throw new Error(`No artifact ${ref.artifact_id} found for job ${ref.job_id}.`);
        }
        if (!artifact.exists) {
          throw new Error(`Artifact ${artifact.file_name} is registered for job ${ref.job_id}, but the file is missing.`);
        }
        assertUserFacingArtifactRef(artifact);
        if (!isInspectableModelArtifactRecord(artifact)) {
          throw new Error('inspect artifact_ref must point to a supported tracked model artifact.');
        }
        return {
          filePath: artifact.path,
          diagnostics: {
            input_artifact_ref: ref,
          },
        };
      }
      return { filePath: resolveMaybe(projectRoot, job.request.file_path), diagnostics: {} };
    }

    if (
      job.request.type === 'generate-standard-docs'
      && job.request.options?.studio?.config_rehydration === 'readiness_report'
    ) {
      return resolveGenerateStandardDocsConfigFromReadiness(job);
    }

    if (job.request.config_path) {
      const configPath = resolveMaybe(projectRoot, job.request.config_path);
      const loaded = await loadConfigWithDiagnostics(configPath);
      return {
        config: loaded.config,
        configPath,
        summary: loaded.summary,
        diagnostics: {
          config_warnings: loaded.summary.warnings,
          config_changed_fields: loaded.summary.changed_fields,
          config_deprecated_fields: loaded.summary.deprecated_fields,
        },
      };
    }

    const validation = validateConfigDocument(job.request.config, { filepath: `${job.id}:inline-config` });
    if (!validation.valid) {
      throw new Error(validation.summary.errors.join(' | '));
    }

    return persistValidatedConfig(job, {
      config: validation.config,
      summary: validation.summary,
      rawRelativePath: INLINE_CONFIG_RELATIVE_PATH,
    });
  }

  async function executeCreate(job, resolvedConfig) {
    const outputDir = await ensureJobArtifactDir(jobStore, job.id);
    return createModel({
      freecadRoot: projectRoot,
      runScript: createLoggedRunner(job.id),
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
      configPath: resolvedConfig.configPath,
      config: withTrackedExportDirectory(resolvedConfig.config, outputDir),
    });
  }

  async function executeDraw(job, resolvedConfig) {
    const outputDir = await ensureJobArtifactDir(jobStore, job.id);
    const resolvedConfigPath = resolveMaybe(projectRoot, resolvedConfig.configPath);
    return runDrawPipeline({
      projectRoot,
      configPath: resolvedConfig.configPath,
      flags: [
        ...(job.request.options?.raw === true ? ['--raw'] : []),
        ...(job.request.options?.qa === false ? ['--no-score'] : []),
      ],
      overridePath: job.request.options?.override_path || null,
      failUnderValue: job.request.options?.fail_under ?? null,
      weightsPresetValue: job.request.options?.weights_preset ?? null,
      loadConfig: async (filepath) => {
        const loaded = (await loadConfigWithDiagnostics(filepath)).config;
        if (resolveMaybe(projectRoot, filepath) !== resolvedConfigPath) {
          return loaded;
        }
        return withTrackedExportDirectory(loaded, outputDir, { ensureExport: true });
      },
      deepMerge,
      generateDrawing,
      runScript: createLoggedRunner(job.id),
      onInfo: (message) => appendLog(job.id, message),
      onError: (message) => appendLog(job.id, message),
    });
  }

  async function executeInspect(job, resolvedConfig) {
    return inspectModel({
      runScript: createLoggedRunner(job.id),
      filePath: resolvedConfig.filePath,
    });
  }

  async function executeReport(job, resolvedConfig) {
    const outputDir = await ensureJobArtifactDir(jobStore, job.id);
    const seededArtifacts = await seedTrackedReportArtifacts({
      projectRoot,
      resolvedConfig,
      outputDir,
    });
    const analysisResults = await prepareTrackedReportAnalysisResults({
      projectRoot,
      resolvedConfig,
      requestOptions: job.request.options || {},
    });
    const result = await generateReport({
      freecadRoot: projectRoot,
      runScript: createLoggedRunner(job.id),
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
      configPath: resolvedConfig.configPath,
      config: resolvedConfig.config,
      outputDir,
      includeDrawing: job.request.options?.include_drawing === true,
      includeDfm: job.request.options?.include_dfm === true,
      includeTolerance: job.request.options?.include_tolerance !== false,
      includeCost: job.request.options?.include_cost === true,
      analysisResults,
      templateName: job.request.options?.template_name || null,
      metadata: job.request.options?.metadata || null,
      sections: job.request.options?.sections || null,
      options: job.request.options?.report_options || null,
      profileName: job.request.options?.profile_name || null,
    });
    return {
      ...result,
      seeded_artifacts: seededArtifacts,
    };
  }

  async function executeReviewContext(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const result = await runReviewContextPipeline({
      projectRoot,
      contextPath: resolveMaybe(projectRoot, job.request.context_path),
      modelPath: resolveMaybe(projectRoot, job.request.model_path),
      bomPath: resolveMaybe(projectRoot, job.request.bom_path),
      inspectionPath: resolveMaybe(projectRoot, job.request.inspection_path),
      qualityPath: resolveMaybe(projectRoot, job.request.quality_path),
      createQualityPath: resolveMaybe(projectRoot, job.request.create_quality_path),
      drawingQualityPath: resolveMaybe(projectRoot, job.request.drawing_quality_path),
      drawingQaPath: resolveMaybe(projectRoot, job.request.drawing_qa_path),
      drawingIntentPath: resolveMaybe(projectRoot, job.request.drawing_intent_path),
      featureCatalogPath: resolveMaybe(projectRoot, job.request.feature_catalog_path),
      dfmReportPath: resolveMaybe(projectRoot, job.request.dfm_report_path),
      compareToPath: resolveMaybe(projectRoot, job.request.compare_to_path),
      outputPath: buildJobArtifactPath(jobStore, job.id, 'review_pack.json'),
      outDir: join(jobStore.getJobDir(job.id), 'artifacts'),
      partName: job.request.options?.part_name || null,
      partId: job.request.options?.part_id || null,
      revision: job.request.options?.revision || null,
      material: job.request.options?.material || null,
      manufacturingProcess: job.request.options?.process || null,
      facility: job.request.options?.facility || null,
      supplier: job.request.options?.supplier || null,
      manufacturingNotes: job.request.options?.manufacturing_notes || null,
      bootstrap: job.request.options?.bootstrap || null,
      runPythonJsonScript,
      inspectModelIfAvailable: async (filePath) => inspectModel({
        runScript: createLoggedRunner(job.id),
        filePath,
      }),
      detectStepFeaturesIfAvailable: async (filePath) => analyzeStep(projectRoot, createLoggedRunner(job.id), filePath),
    });

    const reviewPackDocument = await readJsonFile(result.artifacts.reviewPackJson);
    return {
      ...result,
      reviewPackDocument,
    };
  }

  async function executeCompareRev(job) {
    const baselineImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: resolveMaybe(projectRoot, job.request.baseline_path),
      target: 'review_pack',
      outputFileName: 'baseline_review_pack.json',
    });
    const candidateImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: resolveMaybe(projectRoot, job.request.candidate_path),
      target: 'review_pack',
      outputFileName: 'candidate_review_pack.json',
    });
    const baselinePath = baselineImport.path;
    const candidatePath = candidateImport.path;
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'revision_comparison.json');
    const impactJsonPath = buildJobArtifactPath(jobStore, job.id, 'revision_impact_report.json');
    const impactMarkdownPath = buildJobArtifactPath(jobStore, job.id, 'revision_impact_report.md');
    const executionGeneratedAt = new Date().toISOString();
    const requestedGeneratedAt = typeof job.request.options?.generated_at === 'string'
      ? job.request.options.generated_at.trim()
      : '';
    const impactAnalysis = await createRevisionImpactReportFromPaths({
      projectRoot,
      trustedInputRoots: [jobStore.jobsDir],
      baselineReviewPackPath: baselinePath,
      candidateReviewPackPath: candidatePath,
      baselineReadinessPath: resolveMaybe(projectRoot, job.request.baseline_readiness_path),
      candidateReadinessPath: resolveMaybe(projectRoot, job.request.candidate_readiness_path),
      baselineConfigPath: resolveMaybe(projectRoot, job.request.baseline_config_path),
      candidateConfigPath: resolveMaybe(projectRoot, job.request.candidate_config_path),
      baselineEvidenceEnvelopePath: resolveMaybe(projectRoot, job.request.baseline_evidence_envelope_path),
      candidateEvidenceEnvelopePath: resolveMaybe(projectRoot, job.request.candidate_evidence_envelope_path),
      baselineEvidenceReceiptPath: resolveMaybe(projectRoot, job.request.baseline_evidence_receipt_path),
      candidateEvidenceReceiptPath: resolveMaybe(projectRoot, job.request.candidate_evidence_receipt_path),
      generatedAt: requestedGeneratedAt || executionGeneratedAt,
    });
    const baseline = assertReviewPackHandoff(
      impactAnalysis.baseline.reviewPack,
      baselinePath,
      { command: 'compare-rev' }
    );
    const candidate = assertReviewPackHandoff(
      impactAnalysis.candidate.reviewPack,
      candidatePath,
      { command: 'compare-rev' }
    );
    const result = await runPythonJsonScript(projectRoot, 'scripts/reporting/revision_diff.py', {
      baseline,
      candidate,
      baseline_path: baselinePath,
      candidate_path: candidatePath,
    }, {
      onStderr: (text) => appendLog(job.id, `[revision_diff.py] ${text.trimEnd()}`),
    });
    const comparison = {
      artifact_type: 'revision_comparison',
      schema_version: D_ARTIFACT_SCHEMA_VERSION,
      analysis_version: D_ANALYSIS_VERSION,
      generated_at: executionGeneratedAt,
      part_id: baseline?.part?.part_id && baseline?.part?.part_id === candidate?.part?.part_id
        ? baseline.part.part_id
        : null,
      warnings: [],
      coverage: {
        source_artifact_count: 2,
        source_file_count: 2,
        review_priority_count: (baseline?.review_priorities || []).length + (candidate?.review_priorities || []).length,
      },
      confidence: {
        level: 'heuristic',
        score: 0.58,
        rationale: 'Revision comparison is derived from canonical review-pack evidence and summary deltas.',
      },
      source_artifact_refs: [
        {
          artifact_type: 'review_pack',
          path: baselinePath,
          role: 'comparison_baseline',
          label: 'Baseline review pack JSON',
        },
        {
          artifact_type: 'review_pack',
          path: candidatePath,
          role: 'comparison_candidate',
          label: 'Candidate review pack JSON',
        },
      ],
      ...result.comparison,
    };
    const impactArtifactPlan = await preflightRevisionImpactArtifactTargets({
      projectRoot,
      report: impactAnalysis.report,
      jsonPath: impactJsonPath,
      markdownPath: impactMarkdownPath,
      allowedOutputRoots: [dirname(impactJsonPath)],
      trustedOutputRoots: [jobStore.jobsDir],
      companionArtifacts: [{
        path: outputPath,
        extension: '.json',
        label: 'revision comparison JSON',
        content: `${JSON.stringify(comparison, null, 2)}\n`,
      }],
    });
    assertValidDArtifact('revision_comparison', comparison, { command: 'compare-rev', path: outputPath });
    const impactArtifacts = await writeRevisionImpactArtifacts({
      preparedPlan: impactArtifactPlan,
    });
    return {
      comparison,
      impactReport: impactAnalysis.report,
      outputPath,
      impactJsonPath: impactArtifacts.jsonPath,
      impactMarkdownPath: impactArtifacts.markdownPath,
      baselinePath,
      candidatePath,
      inputSnapshotMetadata: {
        baseline: buildReviewPackSnapshotMetadata(impactAnalysis.baseline),
        candidate: buildReviewPackSnapshotMetadata(impactAnalysis.candidate),
      },
      bundleImports: summarizeBundleImports([baselineImport.importRecord, candidateImport.importRecord]),
    };
  }

  async function executeReadinessPack(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const reviewPackImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: resolveMaybe(projectRoot, job.request.review_pack_path),
      target: 'review_pack',
      outputFileName: 'review_pack.json',
    });
    const reviewPackPath = reviewPackImport.path;
    const processPlanPath = resolveMaybe(projectRoot, job.request.process_plan_path);
    const qualityRiskPath = resolveMaybe(projectRoot, job.request.quality_risk_path);
    const reviewPack = await loadReviewPackHandoff(reviewPackPath, { command: 'readiness-pack' });
    assertRegularReadinessPackHasNoInspectionEvidenceClaim(reviewPack);
    const processPlan = processPlanPath ? await loadCanonicalSupportArtifact('process_plan', processPlanPath, 'readiness-pack') : null;
    const qualityRisk = qualityRiskPath ? await loadCanonicalSupportArtifact('quality_risk', qualityRiskPath, 'readiness-pack') : null;
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'readiness_report.json');
    const report = buildReadinessReportFromReviewPack({
      reviewPack,
      reviewPackPath,
      processPlan,
      qualityRisk,
    });
    const artifacts = await writeCanonicalReadinessArtifacts(outputPath, report, { projectRoot });
    const reportDocument = await readJsonFile(artifacts.json);
    return {
      report: reportDocument,
      artifacts,
      reviewPackPath,
      processPlanPath,
      qualityRiskPath,
      bundleImports: summarizeBundleImports([reviewPackImport.importRecord]),
    };
  }

  async function executeEvidenceGraph(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const reviewPackPath = resolveMaybe(projectRoot, job.request.review_pack_path);
    const readinessReportPath = resolveMaybe(projectRoot, job.request.readiness_report_path);
    const reviewPack = await readJsonFile(reviewPackPath);
    const readinessReport = await readJsonFile(readinessReportPath);
    const graph = assertValidEvidenceGraph(buildEvidenceGraph({
      packageId: job.request.package_id,
      reviewPack,
      readinessReport,
      reviewPackPath: job.request.review_pack_path,
      readinessReportPath: job.request.readiness_report_path,
    }));
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'evidence_graph.json');
    await jobStore.writeJobFile(job.id, 'artifacts/evidence_graph.json', `${JSON.stringify(graph, null, 2)}\n`);
    return {
      graph,
      outputPath,
      reviewPackPath,
      readinessReportPath,
    };
  }

  async function executeStabilizationReview(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const baselineImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: resolveMaybe(projectRoot, job.request.baseline_path),
      target: 'readiness_report',
      outputFileName: 'baseline_readiness_report.json',
    });
    const candidateImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: resolveMaybe(projectRoot, job.request.candidate_path),
      target: 'readiness_report',
      outputFileName: 'candidate_readiness_report.json',
    });
    const baselinePath = baselineImport.path;
    const candidatePath = candidateImport.path;
    const baselineReport = await loadReadinessReportHandoff(baselinePath, { command: 'stabilization-review' });
    const candidateReport = await loadReadinessReportHandoff(candidatePath, { command: 'stabilization-review' });
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'stabilization_review.json');
    const review = buildStabilizationReviewFromReadinessReports({
      baselineReport,
      candidateReport,
      baselinePath,
      candidatePath,
    });
    await jobStore.writeJobFile(job.id, 'artifacts/stabilization_review.json', `${JSON.stringify(review, null, 2)}\n`);
    return {
      review,
      outputPath,
      baselinePath,
      candidatePath,
      bundleImports: summarizeBundleImports([baselineImport.importRecord, candidateImport.importRecord]),
    };
  }

  async function executeGenerateStandardDocs(job, resolvedConfig = null) {
    const outDir = buildJobArtifactPath(jobStore, job.id, 'standard-docs');
    await mkdir(outDir, { recursive: true });
    const readinessImport = job.request.readiness_report_path
      ? await resolveBundleBackedCanonicalPath({
          jobStore,
          jobId: job.id,
          inputPath: resolveMaybe(projectRoot, job.request.readiness_report_path),
          target: 'readiness_report',
          outputFileName: 'readiness_report.json',
        })
      : { path: null, importRecord: null };
    const readinessReportPath = readinessImport.path;
    const readinessReport = await loadReadinessReportHandoff(readinessReportPath, { command: 'generate-standard-docs' });
    const configImport = resolvedConfig
      ? { path: resolvedConfig.configPath, importRecord: null }
      : await resolveBundleBackedConfigPath({
          jobStore,
          jobId: job.id,
          inputPath: resolveMaybe(projectRoot, job.request.config_path),
        });
    const configPath = configImport.path;
    const loaded = resolvedConfig || await loadConfigWithDiagnostics(configPath);

    const result = await runStandardDocsWorkflow({
      freecadRoot: projectRoot,
      runScript: createLoggedRunner(job.id),
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
      configPath,
      config: loaded.config,
      options: {
        profileName: job.request.options?.profile_name || null,
        runtimeData: job.request.options?.runtime_data || null,
        outDir,
        report: readinessReport,
        reportPath: readinessReportPath,
      },
    });

    return {
      ...result,
      configPath,
      readinessReportPath,
      bundleImports: summarizeBundleImports([
        configImport.importRecord,
        readinessImport.importRecord,
      ]),
    };
  }

  async function executeInspectionPlan(job) {
    const artifactDir = await ensureJobArtifactDir(jobStore, job.id);
    const scope = job.request.scope || job.request.options?.scope || 'full';
    const generatedAt = job.request.options?.generated_at || job.created_at || new Date().toISOString();
    const plan = await createInspectionPlanFromPaths({
      projectRoot,
      reviewPackPath: resolveMaybe(projectRoot, job.request.review_pack_path),
      revisionImpactPath: resolveMaybe(projectRoot, job.request.revision_impact_path),
      readinessPath: resolveMaybe(projectRoot, job.request.readiness_report_path),
      configPath: resolveMaybe(projectRoot, job.request.config_path),
      requirementsPath: resolveMaybe(projectRoot, job.request.requirements_path),
      trustedInputRoots: [jobStore.jobsDir],
      scope,
      generatedAt,
    });
    const outputs = await writeInspectionPlanOutputs({
      projectRoot,
      plan,
      outputPath: join(artifactDir, 'inspection_plan.json'),
      checksheetPath: join(artifactDir, 'inspection_checksheet.csv'),
      requestPath: join(artifactDir, 'supplier_inspection_request.md'),
      resultTemplatePath: join(artifactDir, 'inspection_result_template.csv'),
      trustedOutputRoots: [artifactDir],
    });
    return { plan, outputs };
  }

  async function executePack(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const rawReadinessPath = resolveMaybe(projectRoot, job.request.readiness_report_path);
    const readinessImport = await resolveBundleBackedCanonicalPath({
      jobStore,
      jobId: job.id,
      inputPath: rawReadinessPath,
      target: 'readiness_report',
      outputFileName: 'readiness_report.json',
    });
    const docsManifestImport = await resolveBundleBackedDocsManifestPath({
      jobStore,
      jobId: job.id,
      explicitPath: resolveMaybe(projectRoot, job.request.docs_manifest_path),
      fallbackBundlePath: rawReadinessPath,
    });
    const readinessPath = readinessImport.path;
    const docsManifestPath = docsManifestImport.path;
    const readinessReport = await loadReadinessReportHandoff(readinessPath, { command: 'pack' });
    const docsManifest = docsManifestPath
      ? await loadDocsManifestHandoff(docsManifestPath, {
          readinessReport,
          readinessPath,
          allowBundledPair: Boolean(
            readinessImport.importRecord?.bundle_path
            && readinessImport.importRecord?.bundle_path === docsManifestImport.importRecord?.bundle_path
          ),
        })
      : null;
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'release_bundle.zip');
    const result = await runReleaseBundleWorkflow({
      projectRoot,
      readinessPath,
      readinessReport,
      outputPath,
      docsManifestPath,
      docsManifest,
      trustedSourceRoots: [jobStore.jobsDir],
      allowBundledDocsManifestPair: Boolean(
        readinessImport.importRecord?.bundle_path
        && readinessImport.importRecord?.bundle_path === docsManifestImport.importRecord?.bundle_path
      ),
    });
    return {
      ...result,
      readinessPath,
      docsManifestPath,
      readinessReport,
      bundleImports: summarizeBundleImports([readinessImport.importRecord, docsManifestImport.importRecord]),
    };
  }

  async function executeInspectionEvidenceIntake(job) {
    const options = job.request.options || {};
    const report = await discoverInspectionEvidenceIntake({
      projectRoot,
      packageSlugs: normalizeIntakePackageSlugs(options),
      includeGitHub: options.include_github === true,
      githubRepo: 'dooosp/freecad-automation',
    });
    const reportPath = await jobStore.writeJobFile(
      job.id,
      'artifacts/inspection-evidence-intake-report.json',
      `${JSON.stringify(report, null, 2)}\n`
    );

    return {
      report,
      reportPath,
    };
  }

  async function loadPromotionDryRunIntakeReport(job) {
    if (job.request.intake_report_artifact_ref) {
      const ref = {
        job_id: String(job.request.intake_report_artifact_ref.job_id || '').trim(),
        artifact_id: String(job.request.intake_report_artifact_ref.artifact_id || '').trim(),
      };
      const artifact = await jobStore.getArtifact(ref.job_id, ref.artifact_id);
      if (!artifact) {
        throw new Error(`No artifact ${ref.artifact_id} found for job ${ref.job_id}.`);
      }
      if (!artifact.exists) {
        throw new Error(`Artifact ${artifact.file_name} is registered for job ${ref.job_id}, but the file is missing.`);
      }
      assertUserFacingArtifactRef(artifact);
      if (!isInspectionEvidenceIntakeArtifactRecord(artifact)) {
        throw new Error('inspection-evidence-promotion-dry-run requires a registered inspection-evidence intake report artifact.');
      }
      const report = await readJsonFile(artifact.path);
      if (report?.artifact_type !== 'inspection_evidence_intake_report') {
        throw new Error('inspection-evidence-promotion-dry-run input artifact is not an inspection_evidence_intake_report.');
      }
      return {
        report,
        artifactRef: ref,
        intakeReportPathForManifest: null,
        intakeReportPathForDiagnostics: artifact.path,
      };
    }

    const relativePath = String(job.request.intake_report_path || '').trim();
    if (!isSafeRepoRelativeJsonPath(relativePath)) {
      throw new Error('inspection-evidence-promotion-dry-run intake_report_path must be a safe repo-relative JSON path.');
    }
    const reportPath = resolve(projectRoot, relativePath);
    const report = await readJsonFile(reportPath);
    if (report?.artifact_type !== 'inspection_evidence_intake_report') {
      throw new Error('inspection-evidence-promotion-dry-run input path is not an inspection_evidence_intake_report.');
    }
    return {
      report,
      artifactRef: null,
      intakeReportPathForManifest: relativePath,
      intakeReportPathForDiagnostics: relativePath,
    };
  }

  async function executeInspectionEvidencePromotionDryRun(job) {
    const source = await loadPromotionDryRunIntakeReport(job);
    assertValidStage5bIntakeReport(source.report, {
      label: 'source intake report',
      artifactPath: source.intakeReportPathForDiagnostics,
      projectRoot,
    });
    const manifest = buildInspectionEvidencePromotionDryRunManifest({
      projectRoot,
      intakeReport: source.report,
      intakeReportPath: source.intakeReportPathForManifest,
    });

    if (source.artifactRef) {
      manifest.source_intake_report = {
        ...manifest.source_intake_report,
        path: null,
        artifact_ref: source.artifactRef,
      };
    }
    assertValidStage5bPromotionDryRunManifest(manifest, {
      label: 'promotion dry-run manifest',
      artifactPath: 'artifacts/promotion_dry_run_manifest.json',
      projectRoot,
    });

    const manifestPath = await jobStore.writeJobFile(
      job.id,
      'artifacts/promotion_dry_run_manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    return {
      manifest,
      manifestPath,
    };
  }

  async function executeStage5bEvidenceAudit(job) {
    const defaultArtifactDir = await ensureJobArtifactDir(jobStore, job.id);
    const outputDir = isPathInsideProject(projectRoot, defaultArtifactDir)
      ? defaultArtifactDir
      : resolve(projectRoot, 'tmp', 'codex', 'stage5b-evidence-audit-jobs', job.id);
    await mkdir(outputDir, { recursive: true });

    const options = job.request.options || {};
    return writeStage5bEvidenceAuditBundle({
      projectRoot,
      outDir: outputDir,
      includeGitHub: options.include_github === true,
    });
  }

  async function executeEvidenceReadinessAudit(job) {
    const outputDir = await ensureJobArtifactDir(jobStore, job.id);
    const options = job.request.options || {};
    return writeEvidenceReadinessAudit({
      projectRoot,
      outDir: outputDir,
      packageSlugs: Array.isArray(options.package_slugs)
        ? options.package_slugs.map((slug) => slug.trim()).filter(Boolean)
        : undefined,
      generatedAt: typeof options.generated_at === 'string' ? options.generated_at : null,
      clean: false,
    });
  }

  return {
    async execute(jobId) {
      const claim = await jobStore.claimJobForExecution(jobId, 'executor_started');
      if (!claim.ok) {
        if (claim.reason === 'cancelled_before_start') {
          await appendLog(jobId, 'Job execution skipped because the queued job was cancelled before start.');
        }
        return;
      }

      const job = claim.job;
      await appendLog(jobId, `Job ${job.type} started`);

      let artifacts = {};
      let diagnostics = {};
      let manifest = null;
      let manifestArtifacts = [];
      let manifestConfigPath = null;
      let manifestConfigSummary = null;
      let manifestRuleProfile = null;
      const handlerContext = {
        projectRoot,
        jobStore,
        appendLog,
        createLoggedRunner,
        joinPath: join,
        collectInspectManifestArtifacts,
        executeCreate,
        executeDraw,
        executeInspect,
        executeReport,
        executeReviewContext,
        executeCompareRev,
        executeReadinessPack,
        executeEvidenceGraph,
        executeStabilizationReview,
        executeGenerateStandardDocs,
        executeInspectionPlan,
        executePack,
        executeInspectionEvidenceIntake,
        executeInspectionEvidencePromotionDryRun,
        executeStage5bEvidenceAudit,
        executeEvidenceReadinessAudit,
        buildAfArtifactContractFromDocument,
        buildGenericAfMetadata,
        buildReleaseBundleMetadata,
        buildReleaseBundleManifestMetadata,
      };
      try {
        let result;
        let resolvedConfig = null;
        if (job.type === 'create' || job.type === 'draw' || job.type === 'inspect' || job.type === 'report' || job.type === 'generate-standard-docs') {
          resolvedConfig = await resolveConfigInput(job);
          handlerContext.resolvedConfig = resolvedConfig;
          diagnostics = resolvedConfig.diagnostics || {};
          const configSummary = resolvedConfig.summary || null;
          manifestConfigPath = resolvedConfig.configPath || null;
          manifestConfigSummary = configSummary;

          for (const warning of diagnostics.config_warnings || []) {
            await appendLog(jobId, `Config warning: ${warning}`);
          }
        }

        const handlerOutcome = await executeJobByType(job, handlerContext);
        result = handlerOutcome.result;
        artifacts = {
          ...artifacts,
          ...(handlerOutcome.artifacts || {}),
        };
        manifestArtifacts.push(...(handlerOutcome.manifestArtifacts || []));
        if (handlerOutcome.diagnostics) {
          diagnostics = {
            ...diagnostics,
            ...handlerOutcome.diagnostics,
          };
        }

        if (resolvedConfig?.rawConfigPath) {
          artifacts.input_config = resolvedConfig.rawConfigPath;
          manifestArtifacts.push({
            type: 'config.input',
            path: resolvedConfig.rawConfigPath,
            label: 'Input config copy',
            scope: 'internal',
            stability: 'stable',
          });
        }
        if (resolvedConfig?.configPath) {
          artifacts.effective_config = resolvedConfig.configPath;
          manifestArtifacts.push({
            type: 'config.effective',
            path: resolvedConfig.configPath,
            label: 'Effective config copy',
            scope: 'internal',
            stability: 'stable',
          });
        }

        if (Array.isArray(result?.bundleImports) && result.bundleImports.length > 0) {
          for (const importRecord of result.bundleImports) {
            await appendLog(jobId, formatBundleImportLog(importRecord));
          }
          manifestArtifacts.push(...buildBundleImportManifestArtifacts(result.bundleImports));
        }

        const ruleProfile = resolvedConfig?.config
          ? await loadRuleProfile(projectRoot, resolvedConfig.config, {
              profileName: job.request.options?.profile_name || null,
              silent: true,
            })
          : null;
        manifestRuleProfile = summarizeRuleProfile(ruleProfile);
        manifest = await buildArtifactManifest({
          projectRoot,
          interface: 'api',
          command: job.type,
          jobType: job.type,
          status: 'succeeded',
          requestId: job.id,
          configPath: manifestConfigPath,
          configSummary: manifestConfigSummary,
          selectedProfile: job.request.options?.profile_name || null,
          ruleProfile: manifestRuleProfile,
          artifacts: applyArtifactPublicationBoundary({
            projectRoot,
            jobDir: jobStore.getJobDir(job.id),
            artifacts: manifestArtifacts,
          }),
          timestamps: {
            created_at: job.created_at,
            started_at: job.started_at,
            finished_at: new Date().toISOString(),
          },
          details: {
            request: job.request,
            diagnostics,
          },
        });

        await appendLog(jobId, `Job ${job.type} finished successfully`);
        await jobStore.completeJob(jobId, sanitizeResult(result), artifacts, diagnostics, manifest);
      } catch (error) {
        if (error instanceof AfExecutionContractError) {
          diagnostics = {
            ...diagnostics,
            contract_errors: error.details,
            execution_state: buildAfExecutionStateDescriptor('failed'),
          };
        }
        diagnostics = await writeTrackedStage5bValidationDiagnostics(job, error, handlerContext, {
          artifacts,
          manifestArtifacts,
          diagnostics,
        });
        await appendLog(jobId, `Job failed: ${error instanceof Error ? error.message : String(error)}`);
        manifest = await buildArtifactManifest({
          projectRoot,
          interface: 'api',
          command: job.type,
          jobType: job.type,
          status: 'failed',
          requestId: job.id,
          configPath: manifestConfigPath,
          configSummary: manifestConfigSummary,
          selectedProfile: job.request.options?.profile_name || null,
          ruleProfile: manifestRuleProfile,
          artifacts: applyArtifactPublicationBoundary({
            projectRoot,
            jobDir: jobStore.getJobDir(job.id),
            artifacts: manifestArtifacts,
          }),
          warnings: diagnostics.config_warnings || [],
          deprecations: diagnostics.config_deprecated_fields || [],
          timestamps: {
            created_at: job.created_at,
            started_at: job.started_at,
            finished_at: new Date().toISOString(),
          },
          details: {
            request: job.request,
            diagnostics,
            error: error instanceof Error ? error.message : String(error),
            error_code: error instanceof AfExecutionContractError ? error.code : null,
          },
        });
        await jobStore.failJob(jobId, error, artifacts, diagnostics, manifest);
      }
    },
  };
}

import { basename, dirname, extname, join, parse, resolve } from 'node:path';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import {
  AfExecutionContractError,
  buildAfArtifactContractFromDocument,
  buildAfArtifactContractMetadata,
  buildAfExecutionStateDescriptor,
  buildCompatibilityMarkers,
  createAfArtifactIdentityRecord,
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
import { D_ANALYSIS_VERSION, D_ARTIFACT_SCHEMA_VERSION } from '../../../lib/d-artifact-schema.js';
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
import {
  resolveBundleBackedCanonicalPath,
  resolveBundleBackedConfigPath,
  resolveBundleBackedDocsManifestPath,
  summarizeBundleImports,
} from './af-reentry.js';
import { loadRuleProfile, summarizeRuleProfile } from '../config/rule-profile-service.js';
import { validateLocalApiJobRequest } from '../../server/local-api-schemas.js';
import { JOB_EXECUTOR_COMMANDS } from '../../shared/command-manifest.js';

const JOB_TYPES = new Set(JOB_EXECUTOR_COMMANDS);
const INLINE_CONFIG_RELATIVE_PATH = 'inputs/inline-config.json';
const EFFECTIVE_CONFIG_RELATIVE_PATH = 'inputs/effective-config.json';

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

function inferDrawArtifacts(result) {
  const svgPath = result?.drawing_paths?.find((entry) => entry.format === 'svg')?.path
    || result?.svg_path
    || result?.drawing_path;
  if (!svgPath) return {};
  const normalizedPath = svgPath.replace(/\\/g, '/');
  const stem = parse(normalizedPath).name.replace(/_drawing$/i, '');
  const dir = dirname(normalizedPath);
  return {
    drawing: normalizedPath,
    qa: normalizedPath.replace(/\.svg$/i, '_qa.json'),
    qa_issues: normalizedPath.replace(/\.svg$/i, '_qa_issues.json'),
    drawing_quality: normalizedPath.replace(/\.svg$/i, '_quality.json'),
    extracted_drawing_semantics: join(dir, `${stem}_extracted_drawing_semantics.json`),
    drawing_planner: join(dir, `${stem}_drawing_planner.json`),
    repair_report: normalizedPath.replace(/\.svg$/i, '_repair_report.json'),
    run_log: join(dir, `${stem}_run_log.json`),
    effective_config: join(dir, `${stem}_effective_config.json`),
    plan_toml: join(dir, `${stem}_plan.toml`),
    plan_json: join(dir, `${stem}_plan.json`),
    traceability: join(dir, `${stem}_traceability.json`),
    layout_report: join(dir, `${stem}_layout_report.json`),
    dimension_map: join(dir, `${stem}_dimension_map.json`),
    dim_conflicts: join(dir, `${stem}_dim_conflicts.json`),
    dedupe_diagnostics: join(dir, `${stem}_dedupe_diagnostics.json`),
  };
}

function inferCreateArtifacts(result) {
  return {
    exports: (result?.exports || []).map((entry) => entry.path).filter(Boolean),
  };
}

function inferReportArtifacts(result) {
  return {
    pdf: result?.pdf_path || result?.path || null,
    ...(result?.drawing_intent_json ? { drawing_intent: result.drawing_intent_json } : {}),
    ...(result?.feature_catalog_json ? { feature_catalog: result.feature_catalog_json } : {}),
  };
}

function collectCreateManifestArtifacts(result) {
  return (result?.exports || [])
    .filter((entry) => entry?.path && entry?.format)
    .map((entry) => ({
      type: `model.${String(entry.format).toLowerCase()}`,
      path: entry.path,
      label: entry.format.toUpperCase(),
      scope: 'user-facing',
      stability: 'stable',
    }));
}

function collectDrawManifestArtifacts(result) {
  const paths = inferDrawArtifacts(result);
  const mapping = [
    ['drawing', 'drawing.svg', 'stable', 'user-facing'],
    ['qa', 'drawing.qa-report', 'best-effort', 'user-facing'],
    ['qa_issues', 'drawing.qa-issues', 'best-effort', 'user-facing'],
    ['drawing_quality', 'drawing.quality-summary', 'stable', 'user-facing'],
    ['extracted_drawing_semantics', 'drawing.extracted-semantics', 'best-effort', 'user-facing'],
    ['drawing_planner', 'drawing.planner', 'best-effort', 'user-facing'],
    ['repair_report', 'drawing.repair-report', 'best-effort', 'user-facing'],
    ['run_log', 'draw.run-log', 'internal', 'internal'],
    ['effective_config', 'config.effective', 'internal', 'internal'],
    ['plan_toml', 'draw.plan.toml', 'best-effort', 'user-facing'],
    ['plan_json', 'draw.plan.json', 'best-effort', 'user-facing'],
    ['traceability', 'draw.traceability', 'best-effort', 'user-facing'],
    ['layout_report', 'draw.layout-report', 'best-effort', 'user-facing'],
    ['dimension_map', 'draw.dimension-map', 'internal', 'internal'],
    ['dim_conflicts', 'draw.dimension-conflicts', 'internal', 'internal'],
    ['dedupe_diagnostics', 'draw.dedupe-diagnostics', 'internal', 'internal'],
  ];

  return mapping
    .filter(([key]) => paths[key])
    .map(([key, type, stability, scope]) => ({
      type,
      path: paths[key],
      label: key,
      scope,
      stability,
    }));
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

export function collectReportManifestArtifacts(result) {
  const pdfPath = result?.pdf_path || result?.path;
  const drawingIntent = result?.report_summary?.drawing_intent || result?.decision_summary?.drawing_intent || null;
  const drawingIntentMetadata = drawingIntent && typeof drawingIntent === 'object'
    ? {
        includes_drawing_intent: true,
        missing_semantics_policy: drawingIntent.missing_semantics_policy || 'advisory',
      }
    : null;
  const artifacts = pdfPath
    ? [{
        type: 'report.pdf',
        path: pdfPath,
        label: 'PDF report',
        scope: 'user-facing',
        stability: 'stable',
      }]
    : [];

  if (result?.summary_json) {
    artifacts.push({
      type: 'report.summary-json',
      path: result.summary_json,
      label: 'Report summary JSON',
      scope: 'user-facing',
      stability: 'stable',
      ...(drawingIntentMetadata ? { metadata: drawingIntentMetadata } : {}),
    });
  }

  if (result?.drawing_intent_json) {
    artifacts.push({
      type: 'drawing-intent.json',
      path: result.drawing_intent_json,
      label: 'Drawing intent JSON',
      scope: 'user-facing',
      stability: 'stable',
    });
  }

  if (result?.feature_catalog_json) {
    artifacts.push({
      type: 'feature-catalog.json',
      path: result.feature_catalog_json,
      label: 'Conservative feature catalog JSON',
      scope: 'user-facing',
      stability: 'best-effort',
    });
  }
  if (result?.extracted_drawing_semantics_json) {
    artifacts.push({
      type: 'drawing.extracted-semantics',
      path: result.extracted_drawing_semantics_json,
      label: 'Extracted drawing semantics JSON',
      scope: 'user-facing',
      stability: 'best-effort',
    });
  }

  const seededArtifacts = result?.seeded_artifacts || {};
  const seededMapping = [
    ['create_quality', 'model.quality-summary', 'Create quality JSON'],
    ['drawing_quality', 'drawing.quality-summary', 'Drawing quality JSON'],
    ['extracted_drawing_semantics', 'drawing.extracted-semantics', 'Extracted drawing semantics JSON'],
    ['drawing_planner', 'drawing.planner', 'Drawing planner advisory JSON'],
    ['create_manifest', 'output.manifest.json', 'Create manifest JSON'],
    ['drawing_manifest', 'drawing.output-manifest.json', 'Drawing manifest JSON'],
    ['drawing_svg', 'drawing.svg', 'Drawing SVG'],
    ['model_step', 'model.step', 'STEP model'],
    ['model_stl', 'model.stl', 'STL model'],
  ];

  for (const [key, type, label] of seededMapping) {
    if (!seededArtifacts[key]) continue;
    artifacts.push({
      type,
      path: seededArtifacts[key],
      label,
      scope: 'user-facing',
      stability: 'stable',
    });
  }

  return artifacts;
}

function collectInspectManifestArtifacts(resolvedConfig) {
  return resolvedConfig?.filePath
    ? [{
        type: 'input.model',
        path: resolvedConfig.filePath,
        label: 'Input model',
        scope: 'user-facing',
        stability: 'stable',
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

function buildLineageIdentity(document = {}) {
  const part = document?.part && typeof document.part === 'object' ? document.part : {};
  return {
    part_id: part.part_id || document.part_id || null,
    name: part.name || null,
    revision: part.revision || document.revision || null,
  };
}

function buildReleaseBundleMetadata({
  readinessReport,
  releaseBundleManifest,
}) {
  const lineage = buildLineageIdentity(readinessReport);
  return buildAfArtifactContractMetadata({
    jobType: 'pack',
    target: 'release_bundle',
    artifactIdentity: createAfArtifactIdentityRecord({
      artifactType: 'release_bundle',
      schemaVersion: releaseBundleManifest?.schema_version || '1.0',
      sourceArtifactRefs: releaseBundleManifest?.source_artifact_refs || [],
      warnings: releaseBundleManifest?.warnings || [],
      coverage: releaseBundleManifest?.coverage || {},
      confidence: releaseBundleManifest?.confidence || {
        level: 'heuristic',
        score: 0.5,
        rationale: 'Release bundle metadata was derived from the release bundle manifest.',
      },
      lineage,
      compatibility: {
        mode: 'canonical',
        canonical_review_pack_backed: null,
        markers: ['derived_transport_artifact', ...(buildCompatibilityMarkers(releaseBundleManifest).markers || [])],
      },
    }),
    executionNotes: [
      'release_bundle.zip is a derived transport artifact backed by canonical packaging metadata.',
    ],
  });
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

function buildReleaseBundleManifestMetadata({
  readinessReport,
  releaseBundleManifest,
}) {
  const lineage = buildLineageIdentity(readinessReport);
  return buildAfArtifactContractMetadata({
    jobType: 'pack',
    artifactIdentity: createAfArtifactIdentityRecord({
      artifactType: releaseBundleManifest?.artifact_type || 'release_bundle_manifest',
      schemaVersion: releaseBundleManifest?.schema_version || '1.0',
      sourceArtifactRefs: releaseBundleManifest?.source_artifact_refs || [],
      warnings: releaseBundleManifest?.warnings || [],
      coverage: releaseBundleManifest?.coverage || {},
      confidence: releaseBundleManifest?.confidence || {
        level: 'heuristic',
        score: 0.5,
        rationale: 'Release bundle manifest metadata was derived from the release bundle manifest.',
      },
      lineage,
      compatibility: buildCompatibilityMarkers(releaseBundleManifest),
    }),
    executionNotes: [
      'Release bundle manifest preserves readiness lineage for reopenable packaging metadata.',
    ],
  });
}

async function loadReviewPackHandoff(pathValue, { command }) {
  const artifact = await readJsonFile(pathValue);
  buildAfArtifactContractFromDocument({
    jobType: command,
    target: 'review_pack',
    document: artifact,
    path: pathValue,
    strictReentry: true,
  });
  return artifact;
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

export function validateJobRequest(body) {
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
    return createModel({
      freecadRoot: projectRoot,
      runScript: createLoggedRunner(job.id),
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
      configPath: resolvedConfig.configPath,
      config: resolvedConfig.config,
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
        if (resolveMaybe(projectRoot, filepath) !== resolvedConfigPath || loaded.export?.directory) {
          return loaded;
        }
        return {
          ...loaded,
          export: {
            ...(loaded.export || {}),
            directory: outputDir,
          },
        };
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
    await ensureJobArtifactDir(jobStore, job.id);
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
    const baseline = await loadReviewPackHandoff(baselinePath, { command: 'compare-rev' });
    const candidate = await loadReviewPackHandoff(candidatePath, { command: 'compare-rev' });
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'revision_comparison.json');
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
      generated_at: new Date().toISOString(),
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
    await jobStore.writeJobFile(job.id, 'artifacts/revision_comparison.json', `${JSON.stringify(comparison, null, 2)}\n`);
    return {
      comparison,
      outputPath,
      baselinePath,
      candidatePath,
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
    const processPlan = processPlanPath ? await loadCanonicalSupportArtifact('process_plan', processPlanPath, 'readiness-pack') : null;
    const qualityRisk = qualityRiskPath ? await loadCanonicalSupportArtifact('quality_risk', qualityRiskPath, 'readiness-pack') : null;
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'readiness_report.json');
    const report = buildReadinessReportFromReviewPack({
      reviewPack,
      reviewPackPath,
      processPlan,
      qualityRisk,
    });
    const artifacts = await writeCanonicalReadinessArtifacts(outputPath, report);
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

  function buildGenericAfMetadata(jobType, document, executionNotes = []) {
    return buildAfArtifactContractMetadata({
      jobType,
      artifactIdentity: createAfArtifactIdentityRecord({
        artifactType: document?.artifact_type || jobType,
        schemaVersion: document?.schema_version || '1.0',
        sourceArtifactRefs: document?.source_artifact_refs || [],
        warnings: document?.warnings || [],
        coverage: document?.coverage || {},
        confidence: document?.confidence || {
          level: 'heuristic',
          score: 0.5,
          rationale: `${jobType} artifact metadata was derived from the canonical JSON output.`,
        },
        lineage: buildLineageIdentity(document),
        compatibility: buildCompatibilityMarkers(document),
      }),
      executionNotes,
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
      try {
        let result;
        let resolvedConfig = null;
        if (job.type === 'create' || job.type === 'draw' || job.type === 'inspect' || job.type === 'report' || job.type === 'generate-standard-docs') {
          resolvedConfig = await resolveConfigInput(job);
          diagnostics = resolvedConfig.diagnostics || {};
          const configSummary = resolvedConfig.summary || null;
          manifestConfigPath = resolvedConfig.configPath || null;
          manifestConfigSummary = configSummary;

          for (const warning of diagnostics.config_warnings || []) {
            await appendLog(jobId, `Config warning: ${warning}`);
          }
        }

        if (job.type === 'create') {
          result = await executeCreate(job, resolvedConfig);
          artifacts = {
            ...artifacts,
            ...inferCreateArtifacts(result),
          };
          manifestArtifacts.push(...collectCreateManifestArtifacts(result));
        } else if (job.type === 'draw') {
          result = await executeDraw(job, resolvedConfig);
          artifacts = {
            ...artifacts,
            ...inferDrawArtifacts(result),
          };
          manifestArtifacts.push(...collectDrawManifestArtifacts(result));
        } else if (job.type === 'inspect') {
          result = await executeInspect(job, resolvedConfig);
          artifacts = {
            input_model: resolvedConfig.filePath,
          };
          manifestArtifacts.push(...collectInspectManifestArtifacts(resolvedConfig));
        } else if (job.type === 'report') {
          result = await executeReport(job, resolvedConfig);
          artifacts = {
            ...artifacts,
            ...inferReportArtifacts(result),
          };
          manifestArtifacts.push(...collectReportManifestArtifacts(result));
        } else if (job.type === 'review-context') {
          result = await executeReviewContext(job);
          artifacts = {
            context: result.artifacts.context,
            engineering_context: result.artifacts.engineeringContext || result.artifacts.context,
            ingest_log: result.artifacts.ingestLog,
            import_diagnostics: result.artifacts.importDiagnostics,
            bootstrap_summary: result.artifacts.bootstrapSummary,
            bootstrap_warnings: result.artifacts.bootstrapWarnings,
            confidence_map: result.artifacts.confidenceMap,
            ...(result.artifacts.draftConfig ? { draft_config: result.artifacts.draftConfig } : {}),
            geometry: result.artifacts.geometry,
            hotspots: result.artifacts.hotspots,
            inspection_linkage: result.artifacts.inspectionLinkage,
            inspection_outliers: result.artifacts.inspectionOutliers,
            quality_linkage: result.artifacts.qualityLinkage,
            quality_hotspots: result.artifacts.qualityHotspots,
            review_priorities: result.artifacts.reviewPriorities,
            review_pack_json: result.artifacts.reviewPackJson,
            review_pack_markdown: result.artifacts.reviewPackMarkdown,
            review_pack_pdf: result.artifacts.reviewPackPdf,
            ...(result.artifacts.revisionComparison ? { revision_comparison: result.artifacts.revisionComparison } : {}),
          };
          manifestArtifacts.push(
            { type: 'engineering_context.json', path: result.artifacts.engineeringContext || result.artifacts.context, label: 'Engineering context JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'ingest.log.json', path: result.artifacts.ingestLog, label: 'Ingest log JSON', scope: 'internal', stability: 'stable' },
            { type: 'import_diagnostics.json', path: result.artifacts.importDiagnostics, label: 'Import diagnostics JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'bootstrap_summary.json', path: result.artifacts.bootstrapSummary, label: 'Bootstrap summary JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'bootstrap_warnings.json', path: result.artifacts.bootstrapWarnings, label: 'Bootstrap warnings JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'confidence_map.json', path: result.artifacts.confidenceMap, label: 'Confidence map JSON', scope: 'user-facing', stability: 'stable' },
            ...(result.artifacts.draftConfig ? [{ type: 'config.bootstrap-draft', path: result.artifacts.draftConfig, label: 'Draft config TOML', scope: 'user-facing', stability: 'best-effort' }] : []),
            { type: 'geometry_intelligence.json', path: result.artifacts.geometry, label: 'Geometry intelligence JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'manufacturing_hotspots.json', path: result.artifacts.hotspots, label: 'Manufacturing hotspots JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'quality-link.inspection-linkage.json', path: result.artifacts.inspectionLinkage, label: 'Inspection linkage JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'quality-link.inspection-outliers.json', path: result.artifacts.inspectionOutliers, label: 'Inspection outliers JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'quality-link.quality-linkage.json', path: result.artifacts.qualityLinkage, label: 'Quality linkage JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'quality-link.quality-hotspots.json', path: result.artifacts.qualityHotspots, label: 'Quality hotspots JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'quality-link.review-priorities.json', path: result.artifacts.reviewPriorities, label: 'Review priorities JSON', scope: 'user-facing', stability: 'stable' },
            {
              type: 'review-pack.json',
              path: result.artifacts.reviewPackJson,
              label: 'Review pack JSON',
              scope: 'user-facing',
              stability: 'stable',
              metadata: buildAfArtifactContractFromDocument({
                jobType: 'review-context',
                target: 'review_pack',
                document: result.reviewPackDocument,
                path: result.artifacts.reviewPackJson,
              }),
            },
            { type: 'review-pack.markdown', path: result.artifacts.reviewPackMarkdown, label: 'Review pack Markdown', scope: 'user-facing', stability: 'stable' },
            { type: 'review-pack.pdf', path: result.artifacts.reviewPackPdf, label: 'Review pack PDF', scope: 'user-facing', stability: 'stable' },
            ...(result.artifacts.revisionComparison ? [{
              type: 'revision-comparison.json',
              path: result.artifacts.revisionComparison,
              label: 'Revision comparison JSON',
              scope: 'user-facing',
              stability: 'stable',
            }] : []),
          );
        } else if (job.type === 'compare-rev') {
          result = await executeCompareRev(job);
          artifacts = {
            revision_comparison: result.outputPath,
          };
          manifestArtifacts.push({
            type: 'revision-comparison.json',
            path: result.outputPath,
            label: 'Revision comparison JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: buildGenericAfMetadata('compare-rev', result.comparison, [
              'compare-rev compares canonical review-pack artifacts and preserves their lineage.',
            ]),
          });
        } else if (job.type === 'readiness-pack') {
          result = await executeReadinessPack(job);
          artifacts = {
            readiness_report: result.artifacts.json,
            readiness_markdown: result.artifacts.markdown,
          };
          manifestArtifacts.push(
            {
              type: 'readiness-report.json',
              path: result.artifacts.json,
              label: 'Readiness report JSON',
              scope: 'user-facing',
              stability: 'stable',
              metadata: buildAfArtifactContractFromDocument({
                jobType: 'readiness-pack',
                target: 'readiness_report',
                document: result.report,
                path: result.artifacts.json,
              }),
            },
            { type: 'readiness-report.markdown', path: result.artifacts.markdown, label: 'Readiness report Markdown', scope: 'user-facing', stability: 'stable' },
            { type: 'input.review-pack', path: result.reviewPackPath, label: 'Review pack JSON', scope: 'internal', stability: 'stable' },
            ...(result.processPlanPath ? [{ type: 'input.process-plan', path: result.processPlanPath, label: 'Process plan JSON', scope: 'internal', stability: 'stable' }] : []),
            ...(result.qualityRiskPath ? [{ type: 'input.quality-risk', path: result.qualityRiskPath, label: 'Quality risk JSON', scope: 'internal', stability: 'stable' }] : []),
          );
        } else if (job.type === 'stabilization-review') {
          result = await executeStabilizationReview(job);
          artifacts = {
            stabilization_review: result.outputPath,
          };
          manifestArtifacts.push(
            {
              type: 'review.stabilization.json',
              path: result.outputPath,
              label: 'Stabilization review JSON',
              scope: 'user-facing',
              stability: 'stable',
              metadata: buildGenericAfMetadata('stabilization-review', result.review, [
                'stabilization-review compares canonical readiness artifacts and preserves their lineage.',
              ]),
            },
            { type: 'input.readiness.baseline', path: result.baselinePath, label: 'Baseline readiness report JSON', scope: 'internal', stability: 'stable' },
            { type: 'input.readiness.candidate', path: result.candidatePath, label: 'Candidate readiness report JSON', scope: 'internal', stability: 'stable' },
          );
        } else if (job.type === 'generate-standard-docs') {
          result = await executeGenerateStandardDocs(job, resolvedConfig);
          artifacts = {
            out_dir: result.out_dir,
            docs_manifest: result.artifacts.manifest,
            ...(result.readiness_report_path ? { readiness_report: result.readiness_report_path } : {}),
          };
          manifestArtifacts.push(
            ...Object.entries(result.artifacts).map(([filename, filePath]) => ({
              type: filename === 'manifest' ? 'standard-docs.summary' : `standard-docs.${filename}`,
              path: filePath,
              label: filename,
              scope: 'user-facing',
              stability: filename === 'manifest' ? 'best-effort' : 'stable',
              ...(filename === 'manifest'
                ? {
                    metadata: buildGenericAfMetadata('generate-standard-docs', result.manifest, [
                      'generate-standard-docs consumes canonical readiness input and emits document drafts plus a manifest.',
                    ]),
                  }
                : {}),
            })),
            ...(result.readiness_report_path ? [{
              type: 'readiness-report.json',
              path: result.readiness_report_path,
              label: 'Canonical readiness report JSON',
              scope: 'internal',
              stability: 'stable',
              metadata: buildAfArtifactContractFromDocument({
                jobType: 'generate-standard-docs',
                target: 'readiness_report',
                document: result.report,
                path: result.readiness_report_path,
                strictReentry: true,
              }),
            }] : []),
          );
        } else if (job.type === 'pack') {
          result = await executePack(job);
          artifacts = {
            release_bundle: result.bundle_zip_path,
            release_bundle_manifest: result.manifest_path,
            release_bundle_checksums: result.checksums_path,
            release_bundle_log: result.log_path,
          };
          manifestArtifacts.push(
            {
              type: 'release-bundle.zip',
              path: result.bundle_zip_path,
              label: 'Release bundle ZIP',
              scope: 'user-facing',
              stability: 'stable',
              metadata: buildReleaseBundleMetadata({
                readinessReport: result.readinessReport,
                releaseBundleManifest: result.manifest,
              }),
            },
            {
              type: 'release-bundle.manifest.json',
              path: result.manifest_path,
              label: 'Release bundle manifest JSON',
              scope: 'user-facing',
              stability: 'stable',
              metadata: buildReleaseBundleManifestMetadata({
                readinessReport: result.readinessReport,
                releaseBundleManifest: result.manifest,
              }),
            },
            { type: 'release-bundle.checksums', path: result.checksums_path, label: 'Release bundle checksums', scope: 'user-facing', stability: 'stable' },
            { type: 'release-bundle.log.json', path: result.log_path, label: 'Release bundle log JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'input.readiness-report', path: result.readinessPath, label: 'Canonical readiness report JSON', scope: 'internal', stability: 'stable' },
            ...(result.docsManifestPath ? [{ type: 'input.docs-manifest', path: result.docsManifestPath, label: 'Standard docs manifest JSON', scope: 'internal', stability: 'stable' }] : []),
          );
        } else {
          throw new Error(`Unsupported job type: ${job.type}`);
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
          artifacts: manifestArtifacts,
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
          artifacts: manifestArtifacts,
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

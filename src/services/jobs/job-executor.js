import { basename, dirname, extname, join, parse, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
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
import { createDrawingService, runDrawPipeline } from '../../api/drawing.js';
import { createModel, inspectModel } from '../../api/model.js';
import { createReportService } from '../../api/report.js';
import { runReviewContextPipeline } from '../../orchestration/review-context-pipeline.js';
import { runReleaseBundleWorkflow } from '../../workflows/release-bundle-workflow.js';
import { runStandardDocsWorkflow } from '../../workflows/standard-docs-workflow.js';
import {
  buildReadinessReportFromReviewPack,
  buildStabilizationReviewFromReadinessReports,
  writeCanonicalReadinessArtifacts,
} from '../../workflows/canonical-readiness-builders.js';
import { loadRuleProfile, summarizeRuleProfile } from '../config/rule-profile-service.js';
import { validateLocalApiJobRequest } from '../../server/local-api-schemas.js';

const JOB_TYPES = new Set([
  'create',
  'draw',
  'inspect',
  'report',
  'review-context',
  'compare-rev',
  'readiness-pack',
  'stabilization-review',
  'generate-standard-docs',
  'pack',
]);
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

function collectReportManifestArtifacts(result) {
  const pdfPath = result?.pdf_path || result?.path;
  return pdfPath
    ? [{
        type: 'report.pdf',
        path: pdfPath,
        label: 'PDF report',
        scope: 'user-facing',
        stability: 'stable',
      }]
    : [];
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

async function loadDocsManifestHandoff(pathValue, { readinessReport, readinessPath }) {
  const artifact = await readJsonFile(pathValue);
  assertValidCArtifact('docs_manifest', artifact, { command: 'pack', path: pathValue });
  validateDocsManifestAgainstReadiness({
    readinessReport,
    readinessPath,
    docsManifest: artifact,
    docsManifestPath: pathValue,
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

  async function resolveConfigInput(job) {
    if (job.request.type === 'inspect') {
      return { filePath: resolveMaybe(projectRoot, job.request.file_path), diagnostics: {} };
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

    const rawInputPath = await jobStore.writeJobFile(job.id, INLINE_CONFIG_RELATIVE_PATH, `${JSON.stringify(job.request.config, null, 2)}\n`);
    const effectiveConfigPath = await jobStore.writeJobFile(
      job.id,
      EFFECTIVE_CONFIG_RELATIVE_PATH,
      serializeConfig(validation.config, 'json')
    );

    return {
      config: validation.config,
      configPath: effectiveConfigPath,
      rawConfigPath: rawInputPath,
      summary: validation.summary,
      diagnostics: {
        config_warnings: validation.summary.warnings,
        config_changed_fields: validation.summary.changed_fields,
        config_deprecated_fields: validation.summary.deprecated_fields,
      },
    };
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
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
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
    return generateReport({
      freecadRoot: projectRoot,
      runScript: createLoggedRunner(job.id),
      loadConfig: async (filepath) => (await loadConfigWithDiagnostics(filepath)).config,
      configPath: resolvedConfig.configPath,
      config: resolvedConfig.config,
      includeDrawing: job.request.options?.include_drawing === true,
      includeDfm: job.request.options?.include_dfm === true,
      includeTolerance: job.request.options?.include_tolerance !== false,
      includeCost: job.request.options?.include_cost === true,
      analysisResults: job.request.options?.analysis_results || null,
      templateName: job.request.options?.template_name || null,
      metadata: job.request.options?.metadata || null,
      sections: job.request.options?.sections || null,
      options: job.request.options?.report_options || null,
      profileName: job.request.options?.profile_name || null,
    });
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
      runPythonJsonScript,
      inspectModelIfAvailable: async (filePath) => inspectModel({
        runScript: createLoggedRunner(job.id),
        filePath,
      }),
      detectStepFeaturesIfAvailable: null,
    });

    const reviewPackDocument = await readJsonFile(result.artifacts.reviewPackJson);
    return {
      ...result,
      reviewPackDocument,
    };
  }

  async function executeCompareRev(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const baselinePath = resolveMaybe(projectRoot, job.request.baseline_path);
    const candidatePath = resolveMaybe(projectRoot, job.request.candidate_path);
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
    };
  }

  async function executeReadinessPack(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const reviewPackPath = resolveMaybe(projectRoot, job.request.review_pack_path);
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
    };
  }

  async function executeStabilizationReview(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const baselinePath = resolveMaybe(projectRoot, job.request.baseline_path);
    const candidatePath = resolveMaybe(projectRoot, job.request.candidate_path);
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
    };
  }

  async function executeGenerateStandardDocs(job) {
    const outDir = buildJobArtifactPath(jobStore, job.id, 'standard-docs');
    await mkdir(outDir, { recursive: true });
    const configPath = resolveMaybe(projectRoot, job.request.config_path);
    const loaded = await loadConfigWithDiagnostics(configPath);
    const readinessReportPath = resolveMaybe(projectRoot, job.request.readiness_report_path);
    const reviewPackPath = resolveMaybe(projectRoot, job.request.review_pack_path);
    const processPlanPath = resolveMaybe(projectRoot, job.request.process_plan_path);
    const qualityRiskPath = resolveMaybe(projectRoot, job.request.quality_risk_path);

    let readinessReport = null;
    if (readinessReportPath) {
      readinessReport = await loadReadinessReportHandoff(readinessReportPath, { command: 'generate-standard-docs' });
    } else {
      const reviewPack = await loadReviewPackHandoff(reviewPackPath, { command: 'generate-standard-docs' });
      readinessReport = buildReadinessReportFromReviewPack({
        reviewPack,
        reviewPackPath,
        processPlan: processPlanPath ? await loadCanonicalSupportArtifact('process_plan', processPlanPath, 'generate-standard-docs') : null,
        qualityRisk: qualityRiskPath ? await loadCanonicalSupportArtifact('quality_risk', qualityRiskPath, 'generate-standard-docs') : null,
      });
    }

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
      reviewPackPath,
      readinessReportPath,
      processPlanPath,
      qualityRiskPath,
    };
  }

  async function executePack(job) {
    await ensureJobArtifactDir(jobStore, job.id);
    const readinessPath = resolveMaybe(projectRoot, job.request.readiness_report_path);
    const docsManifestPath = resolveMaybe(projectRoot, job.request.docs_manifest_path);
    const readinessReport = await loadReadinessReportHandoff(readinessPath, { command: 'pack' });
    const docsManifest = docsManifestPath
      ? await loadDocsManifestHandoff(docsManifestPath, { readinessReport, readinessPath })
      : null;
    const outputPath = buildJobArtifactPath(jobStore, job.id, 'release_bundle.zip');
    const result = await runReleaseBundleWorkflow({
      projectRoot,
      readinessPath,
      readinessReport,
      outputPath,
      docsManifestPath,
      docsManifest,
    });
    return {
      ...result,
      readinessPath,
      docsManifestPath,
      readinessReport,
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
            ingest_log: result.artifacts.ingestLog,
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
            { type: 'context.json', path: result.artifacts.context, label: 'Engineering context JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'ingest.log.json', path: result.artifacts.ingestLog, label: 'Ingest log JSON', scope: 'internal', stability: 'stable' },
            { type: 'analysis.geometry.json', path: result.artifacts.geometry, label: 'Geometry intelligence JSON', scope: 'user-facing', stability: 'stable' },
            { type: 'analysis.hotspots.json', path: result.artifacts.hotspots, label: 'Manufacturing hotspots JSON', scope: 'user-facing', stability: 'stable' },
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
          result = await executeGenerateStandardDocs(job);
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
            ...(result.reviewPackPath ? [{ type: 'input.review-pack', path: result.reviewPackPath, label: 'Review pack JSON', scope: 'internal', stability: 'stable' }] : []),
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

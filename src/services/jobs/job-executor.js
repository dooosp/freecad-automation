import { basename, dirname, extname, join, parse, resolve } from 'node:path';
import { buildArtifactManifest } from '../../../lib/artifact-manifest.js';
import { deepMerge } from '../../../lib/config-loader.js';
import { loadConfigWithDiagnostics, serializeConfig, validateConfigDocument } from '../../../lib/config-schema.js';
import { isWindowsAbsolutePath, normalizeLocalPath } from '../../../lib/paths.js';
import { runScript } from '../../../lib/runner.js';
import { createDrawingService, runDrawPipeline } from '../../api/drawing.js';
import { createModel, inspectModel } from '../../api/model.js';
import { createReportService } from '../../api/report.js';
import { loadRuleProfile, summarizeRuleProfile } from '../config/rule-profile-service.js';
import { validateLocalApiJobRequest } from '../../server/local-api-schemas.js';

const JOB_TYPES = new Set(['create', 'draw', 'inspect', 'report']);
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
        const resolvedConfig = await resolveConfigInput(job);
        diagnostics = resolvedConfig.diagnostics || {};
        const configSummary = resolvedConfig.summary || null;
        manifestConfigPath = resolvedConfig.configPath || null;
        manifestConfigSummary = configSummary;

        for (const warning of diagnostics.config_warnings || []) {
          await appendLog(jobId, `Config warning: ${warning}`);
        }

        let result;
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
        } else {
          throw new Error(`Unsupported job type: ${job.type}`);
        }

        if (resolvedConfig.rawConfigPath) {
          artifacts.input_config = resolvedConfig.rawConfigPath;
          manifestArtifacts.push({
            type: 'config.input',
            path: resolvedConfig.rawConfigPath,
            label: 'Input config copy',
            scope: 'internal',
            stability: 'stable',
          });
        }
        if (resolvedConfig.configPath) {
          artifacts.effective_config = resolvedConfig.configPath;
          manifestArtifacts.push({
            type: 'config.effective',
            path: resolvedConfig.configPath,
            label: 'Effective config copy',
            scope: 'internal',
            stability: 'stable',
          });
        }

        const ruleProfile = resolvedConfig.config
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
          configSummary,
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
          },
        });
        await jobStore.failJob(jobId, error, artifacts, diagnostics, manifest);
      }
    },
  };
}

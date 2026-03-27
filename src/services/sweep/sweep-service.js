import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import {
  buildArtifactManifest,
  writeArtifactManifest,
} from '../../../lib/artifact-manifest.js';
import { deriveArtifactStem, writeJsonFile } from '../../../lib/context-loader.js';
import { loadConfigWithDiagnostics, readRawConfigFile, serializeConfig, validateConfigDocument } from '../../../lib/config-schema.js';
import {
  buildSweepCsv,
  buildSweepSummary,
  expandSweepVariants,
  normalizeSweepSpec,
} from '../../../lib/sweep.js';
import { runScript } from '../../../lib/runner.js';
import { runFem } from '../analysis/fem-service.js';
import { loadRuleProfile, summarizeRuleProfile } from '../config/rule-profile-service.js';
import { runCost } from '../cost/cost-service.js';
import { createModel } from '../model/create-service.js';
import { createReportService } from '../report/report-service.js';

const generateReport = createReportService();

function slugify(value) {
  return String(value || 'parameter_sweep')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'parameter_sweep';
}

function createRunScript(onStderr) {
  return (script, input, opts = {}) => runScript(script, input, {
    ...opts,
    onStderr: (text) => {
      if (typeof onStderr === 'function') onStderr(text);
    },
  });
}

function durationMs(startTime) {
  return Date.now() - startTime;
}

function flattenExports(exports = [], prefix) {
  const result = {};
  for (const artifact of exports) {
    if (!artifact?.format || !artifact?.path) continue;
    result[`${prefix}_${String(artifact.format).toLowerCase()}`] = artifact.path;
  }
  return result;
}

function collectExportArtifacts(exports = [], prefix, scope = 'user-facing', stability = 'stable') {
  return (exports || [])
    .filter((artifact) => artifact?.format && artifact?.path)
    .map((artifact) => ({
      type: `${prefix}.${String(artifact.format).toLowerCase()}`,
      path: artifact.path,
      label: artifact.format.toUpperCase(),
      scope,
      stability,
    }));
}

function extractMetrics({ costResult, createResult, femResult, stressThreshold }) {
  const metrics = {};

  const model = createResult?.model || createResult?.result?.model || null;
  if (Number.isFinite(model?.volume)) {
    metrics.model_volume_mm3 = model.volume;
  }
  if (Array.isArray(model?.bounding_box?.size)) {
    metrics.bounding_box_mm = model.bounding_box.size;
  }

  if (Number.isFinite(costResult?.details?.mass_kg)) {
    metrics.estimated_mass_kg = costResult.details.mass_kg;
  }
  if (Number.isFinite(costResult?.unit_cost)) {
    metrics.unit_cost = costResult.unit_cost;
  }

  const femPayload = femResult?.fem || femResult || null;
  const femResults = femPayload?.results || femResult?.results || {};
  if (Number.isFinite(femResults?.von_mises?.max)) {
    metrics.max_von_mises_mpa = femResults.von_mises.max;
  }
  if (Number.isFinite(femResults?.safety_factor)) {
    metrics.safety_factor = femResults.safety_factor;
  }

  if (Number.isFinite(stressThreshold) && Number.isFinite(metrics.max_von_mises_mpa)) {
    metrics.stress_threshold_pass = metrics.max_von_mises_mpa <= stressThreshold;
  }

  return metrics;
}

function toErrorRecord(job, error) {
  return {
    job,
    message: error instanceof Error ? error.message : String(error),
  };
}

function buildDefaultOutputDir(projectRoot, sweepName, explicitOutputDir) {
  if (explicitOutputDir) return resolve(explicitOutputDir);
  const runTag = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(projectRoot, 'output', 'sweeps', `${slugify(sweepName)}_${runTag}`);
}

export async function runSweep({
  projectRoot,
  configPath,
  matrixPath,
  outputDir = null,
  loadConfig,
  onInfo = () => {},
  onStderr = null,
}) {
  const resolvedConfigPath = resolve(configPath);
  const resolvedMatrixPath = resolve(matrixPath);
  const loadedConfigDocument = await loadConfigWithDiagnostics(resolvedConfigPath);
  const baseConfigDocument = await readRawConfigFile(resolvedConfigPath);
  const matrixDocument = await readRawConfigFile(resolvedMatrixPath);
  const sweepSpec = normalizeSweepSpec(matrixDocument.parsed);
  const baseConfig = loadedConfigDocument.config ?? await loadConfig(resolvedConfigPath);
  const variants = expandSweepVariants(baseConfig, sweepSpec);
  const resolvedOutputDir = buildDefaultOutputDir(projectRoot, sweepSpec.name || deriveArtifactStem(resolvedConfigPath, 'parameter_sweep'), outputDir);
  const runScriptWithCli = createRunScript(onStderr);
  const stressThreshold = sweepSpec.objectives?.stress_threshold_mpa;
  const copiedMatrixPath = join(resolvedOutputDir, `matrix${extname(resolvedMatrixPath) || '.json'}`);
  const selectedProfile = sweepSpec.execution.profile || null;
  const ruleProfile = await loadRuleProfile(projectRoot, baseConfig, {
    profileName: selectedProfile,
    silent: true,
  });
  const ruleProfileSummary = summarizeRuleProfile(ruleProfile);

  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFile(copiedMatrixPath, matrixDocument.text, 'utf8');

  const variantResults = [];
  const variantManifestRecords = [];
  for (const variant of variants) {
    const variantDir = join(resolvedOutputDir, variant.variant_id);
    const effectiveConfig = structuredClone(variant.config);
    effectiveConfig.export = {
      ...(effectiveConfig.export || {}),
      directory: variantDir,
    };

    await mkdir(variantDir, { recursive: true });
    const effectiveConfigPath = join(variantDir, `effective-config.${baseConfigDocument.format === 'json' ? 'json' : 'toml'}`);
    await writeFile(effectiveConfigPath, serializeConfig(effectiveConfig, baseConfigDocument.format), 'utf8');
    const effectiveConfigValidation = validateConfigDocument(effectiveConfig, {
      filepath: effectiveConfigPath,
    });

    onInfo(`Running ${variant.variant_id} with overrides ${JSON.stringify(variant.overrides)}`);

    const timings = {};
    const errors = [];
    let createResult = null;
    let costResult = null;
    let femResult = null;
    let reportResult = null;
    const startedAt = Date.now();

    const runJob = async (jobName, task) => {
      if (errors.length > 0) return;
      try {
        const start = Date.now();
        const value = await task();
        timings[jobName] = durationMs(start);
        return value;
      } catch (error) {
        errors.push(toErrorRecord(jobName, error));
        return null;
      }
    };

    if (sweepSpec.jobs.includes('create')) {
      createResult = await runJob('create', () => createModel({
        freecadRoot: projectRoot,
        runScript: runScriptWithCli,
        loadConfig,
        configPath: effectiveConfigPath,
        config: effectiveConfig,
      }));
    }

    if (sweepSpec.jobs.includes('cost')) {
      costResult = await runJob('cost', () => runCost({
        freecadRoot: projectRoot,
        runScript: runScriptWithCli,
        loadConfig,
        configPath: effectiveConfigPath,
        config: effectiveConfig,
        process: sweepSpec.execution.process || effectiveConfig.manufacturing?.process || effectiveConfig.process || 'machining',
        material: sweepSpec.execution.material || effectiveConfig.manufacturing?.material || effectiveConfig.material || 'SS304',
        batchSize: sweepSpec.execution.batch_size ?? 1,
        profileName: sweepSpec.execution.profile || null,
        standard: effectiveConfig.standard,
      }));
    }

    if (sweepSpec.jobs.includes('fem')) {
      femResult = await runJob('fem', () => runFem({
        freecadRoot: projectRoot,
        runScript: runScriptWithCli,
        loadConfig,
        configPath: effectiveConfigPath,
        config: effectiveConfig,
        fem: effectiveConfig.fem || {},
      }));
    }

    if (sweepSpec.jobs.includes('report')) {
      reportResult = await runJob('report', () => {
        const analysisResults = {};
        if (createResult) analysisResults.model = createResult.model || null;
        if (costResult) analysisResults.cost = costResult;
        if (femResult) analysisResults.fem = femResult.fem || femResult;

        return generateReport({
          freecadRoot: projectRoot,
          runScript: runScriptWithCli,
          loadConfig,
          configPath: effectiveConfigPath,
          config: effectiveConfig,
          includeDrawing: false,
          includeDfm: false,
          includeTolerance: false,
          includeCost: Boolean(costResult),
          analysisResults,
          profileName: sweepSpec.execution.profile || null,
        });
      });
    }

    const artifacts = {
      config: effectiveConfigPath,
      ...flattenExports(createResult?.exports, 'create'),
      ...flattenExports(femResult?.exports, 'fem'),
    };
    if (reportResult?.pdf_path || reportResult?.path) {
      artifacts.report_pdf = reportResult.pdf_path || reportResult.path;
    }

    const metrics = extractMetrics({
      costResult,
      createResult,
      femResult,
      stressThreshold,
    });

    const variantResult = {
      variant_id: variant.variant_id,
      ordinal: variant.ordinal,
      success: errors.length === 0,
      jobs: sweepSpec.jobs,
      overrides: variant.overrides,
      runtime_ms: {
        ...timings,
        total: durationMs(startedAt),
      },
      metrics,
      artifacts,
      errors,
      result_path: null,
      manifest_path: null,
    };

    const resultPath = join(variantDir, 'result.json');
    variantResult.result_path = await writeJsonFile(resultPath, variantResult);
    const variantManifest = await buildArtifactManifest({
      projectRoot,
      interface: 'sweep',
      command: 'sweep',
      jobType: 'sweep_variant',
      status: errors.length === 0 ? 'succeeded' : 'failed',
      configPath: effectiveConfigPath,
      configSummary: effectiveConfigValidation.summary,
      selectedProfile,
      ruleProfile: ruleProfileSummary,
      artifacts: [
        {
          type: 'config.effective',
          path: effectiveConfigPath,
          label: 'Effective config',
          scope: 'user-facing',
          stability: 'stable',
        },
        {
          type: 'sweep.variant.result',
          path: resultPath,
          label: 'Variant result',
          scope: 'user-facing',
          stability: 'stable',
        },
        ...collectExportArtifacts(createResult?.exports, 'model'),
        ...collectExportArtifacts(femResult?.exports, 'fem'),
        ...(reportResult?.pdf_path || reportResult?.path
          ? [{
              type: 'report.pdf',
              path: reportResult.pdf_path || reportResult.path,
              label: 'PDF report',
              scope: 'user-facing',
              stability: 'stable',
            }]
          : []),
      ],
      warnings: errors.map((error) => `${error.job}: ${error.message}`),
      timestamps: {
        created_at: new Date(startedAt).toISOString(),
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
      },
      details: {
        variant_id: variant.variant_id,
        ordinal: variant.ordinal,
        overrides: variant.overrides,
        jobs: sweepSpec.jobs,
        metrics,
      },
      related: {
        aggregate_manifest_path: join(resolvedOutputDir, 'artifact-manifest.json'),
      },
    });
    const variantManifestPath = await writeArtifactManifest(
      join(variantDir, 'artifact-manifest.json'),
      variantManifest
    );
    variantResult.manifest_path = variantManifestPath;
    await writeJsonFile(resultPath, variantResult);
    variantManifestRecords.push({
      variant_id: variant.variant_id,
      path: variantManifestPath,
      status: errors.length === 0 ? 'succeeded' : 'failed',
    });
    variantResults.push(variantResult);
  }

  const summaryDocument = buildSweepSummary({
    name: sweepSpec.name,
    description: sweepSpec.description,
    baseConfigPath: resolvedConfigPath,
    matrixPath: resolvedMatrixPath,
    outputDir: resolvedOutputDir,
    jobs: sweepSpec.jobs,
    parameters: sweepSpec.parameters,
    objectives: sweepSpec.objectives,
    variants: variantResults,
  });

  const summaryJsonPath = await writeJsonFile(join(resolvedOutputDir, 'summary.json'), summaryDocument);
  const summaryCsvPath = join(resolvedOutputDir, 'summary.csv');
  await writeFile(summaryCsvPath, buildSweepCsv(summaryDocument), 'utf8');
  const aggregateManifest = await buildArtifactManifest({
    projectRoot,
    interface: 'sweep',
    command: 'sweep',
    jobType: 'sweep',
    status: summaryDocument.summary.failed_variants > 0 ? 'partial' : 'succeeded',
    configPath: resolvedConfigPath,
    configSummary: loadedConfigDocument.summary,
    selectedProfile,
    ruleProfile: ruleProfileSummary,
    artifacts: [
      {
        type: 'config.input',
        path: resolvedConfigPath,
        label: 'Base config',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'sweep.matrix',
        path: copiedMatrixPath,
        label: 'Matrix copy',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'sweep.summary.json',
        path: summaryJsonPath,
        label: 'Sweep summary JSON',
        scope: 'user-facing',
        stability: 'stable',
      },
      {
        type: 'sweep.summary.csv',
        path: summaryCsvPath,
        label: 'Sweep summary CSV',
        scope: 'user-facing',
        stability: 'stable',
      },
      ...variantManifestRecords.map((entry) => ({
        type: 'sweep.variant.manifest',
        path: entry.path,
        label: entry.variant_id,
        scope: 'user-facing',
        stability: 'stable',
        metadata: {
          variant_id: entry.variant_id,
          status: entry.status,
        },
      })),
    ],
    timestamps: {
      created_at: summaryDocument.generated_at,
      started_at: summaryDocument.generated_at,
      finished_at: new Date().toISOString(),
    },
    details: {
      name: sweepSpec.name,
      description: sweepSpec.description,
      jobs: sweepSpec.jobs,
      parameters: sweepSpec.parameters,
      objectives: sweepSpec.objectives,
      summary: summaryDocument.summary,
      variants: variantManifestRecords,
    },
  });
  const aggregateManifestPath = await writeArtifactManifest(
    join(resolvedOutputDir, 'artifact-manifest.json'),
    aggregateManifest
  );
  summaryDocument.manifest_path = aggregateManifestPath;
  await writeJsonFile(summaryJsonPath, summaryDocument);

  return {
    output_dir: resolvedOutputDir,
    summary_json: summaryJsonPath,
    summary_csv: summaryCsvPath,
    manifest_path: aggregateManifestPath,
    summary: summaryDocument.summary,
    variants: variantResults,
  };
}

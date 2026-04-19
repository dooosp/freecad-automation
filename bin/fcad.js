#!/usr/bin/env node

import { resolve, join, dirname, extname, parse, sep, isAbsolute } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildArtifactManifest,
  createManifestPath,
  writeArtifactManifest,
} from '../lib/artifact-manifest.js';
import { deepMerge } from '../lib/config-loader.js';
import {
  loadConfigWithDiagnostics,
  migrateConfigDocument,
  readRawConfigFile,
  serializeConfig,
  validateConfigDocument,
} from '../lib/config-schema.js';
import {
  C_ARTIFACT_SCHEMA_VERSION,
  assertValidCArtifact,
  getCCommandContract,
} from '../lib/c-artifact-schema.js';
import {
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  readJsonIfExists,
  runPythonJsonScript,
  writeValidatedCArtifact,
  writeValidatedJsonArtifact,
  writeJsonFile,
} from '../lib/context-loader.js';
import {
  buildAfArtifactContractFromDocument,
  validateDocsManifestAgainstReadiness,
} from '../lib/af-execution-contract.js';
import {
  ArtifactSchemaValidationError,
  assertValidDArtifact,
  buildSourceArtifactRef,
  D_ANALYSIS_VERSION,
  D_ARTIFACT_SCHEMA_VERSION,
} from '../lib/d-artifact-schema.js';
import { resolveModelAnalysisInputs } from '../lib/model-analysis.js';
import {
  buildOutputManifest,
  collectRepoContext,
  createOutputManifestPath,
  writeOutputManifest,
} from '../lib/output-manifest.js';
import { runScript } from '../lib/runner.js';
import { hasFreeCADRuntime, isWindowsAbsolutePath, normalizeLocalPath } from '../lib/paths.js';
import {
  buildModelRuntimeDiagnostic,
  defaultMetadataFallbackHint,
  runtimeDiagnosticsToWarnings,
} from '../lib/runtime-diagnostics.js';
import { printRuntimeDiagnostics } from '../scripts/check-runtime.js';
import {
  createDfmService,
  createCostService,
  runFem as runFemService,
  runTolerance as runToleranceService,
} from '../src/api/analysis.js';
import { runDesignTask } from '../src/api/design.js';
import { createDrawingService, runDrawPipeline } from '../src/api/drawing.js';
import {
  runReadinessReportWorkflow,
  runReleaseBundleWorkflow,
  runStandardDocsWorkflow,
  writeReadinessArtifacts,
} from '../src/api/manufacturing.js';
import { createModel, inspectModel } from '../src/api/model.js';
import { createReportService } from '../src/api/report.js';
import { runReviewContextPipeline } from '../src/orchestration/review-context-pipeline.js';
import { runSweep } from '../src/services/sweep/sweep-service.js';
import { loadRuleProfile, summarizeRuleProfile } from '../src/services/config/rule-profile-service.js';
import {
  buildProcessPlanFromReviewPack,
  buildQualityRiskFromReviewPack,
  buildReadinessReportFromReviewPack,
  buildStabilizationReviewFromReadinessReports,
  writeCanonicalReadinessArtifacts,
} from '../src/workflows/canonical-readiness-builders.js';
import {
  GENERATE_STANDARD_DOCS_INPUT_MESSAGE,
  LEGACY_READINESS_REPORT_MESSAGE,
  renderCliUsage,
  renderServeUsage,
} from '../src/shared/command-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const VALID_DFM_PROCESSES = new Set(['machining', 'casting', 'sheet_metal', '3d_printing']);
const VALIDATE_TIMEOUT_MS = 30_000;

function runWithCliStderr(script, input, opts = {}) {
  return runScript(script, input, {
    ...opts,
    onStderr: (text) => process.stderr.write(text),
  });
}

const runDfm = createDfmService();
const runCost = createCostService();
const generateDrawing = createDrawingService();
const generateReport = createReportService();

const USAGE = renderCliUsage();
const SERVE_USAGE = renderServeUsage();

function parseCliArgs(rawArgs = []) {
  const positional = [];
  const options = {};

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    if (withoutPrefix.includes('=')) {
      const [key, value] = withoutPrefix.split(/=(.*)/s, 2);
      options[key] = value;
      continue;
    }

    const nextArg = rawArgs[i + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[withoutPrefix] = nextArg;
      i += 1;
    } else {
      options[withoutPrefix] = true;
    }
  }

  return { positional, options };
}

function ensureNumericOption(optionName, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return undefined;
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    console.error(`Error: ${optionName} must be a finite number`);
    process.exit(1);
  }
  return numericValue;
}

function requireOptionValue(optionName, value, usageHint = null) {
  if (typeof value === 'string' && value && !value.startsWith('--')) {
    return value;
  }
  console.error(`Error: ${optionName} requires a value`);
  if (usageHint) console.error(`  ${usageHint}`);
  process.exit(1);
}

function requireExistingInputFile(label, filePath) {
  if (!filePath) return;
  if (!existsSync(filePath)) {
    console.error(`Error: ${label} file not found: ${filePath}`);
    process.exit(1);
  }
}

function resolveMaybe(value) {
  if (!value) return null;
  const normalized = normalizeLocalPath(value);
  if (typeof normalized !== 'string' || !normalized.trim()) return null;
  if (isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) {
    return normalized;
  }
  return resolve(normalized);
}

function stemFromContext(context, fallback = 'artifact') {
  return context?.part?.name || context?.part?.part_id || fallback;
}

function buildDefaultOutputDir(preferredPath) {
  if (!preferredPath) return resolve(PROJECT_ROOT, 'output');
  const resolved = resolveMaybe(preferredPath);
  return resolved.endsWith('.json') ? dirname(resolved) : resolved;
}

function nowIso() {
  return new Date().toISOString();
}

function createArtifactPaths(basePathOrDir, stem, suffixes) {
  const result = {};
  for (const [key, suffix] of Object.entries(suffixes)) {
    result[key] = artifactPathFor(basePathOrDir, stem, suffix);
  }
  return result;
}

function normalizeJsonOutputPath(pathValue) {
  if (!pathValue) return null;
  const absPath = resolveMaybe(pathValue);
  return absPath.toLowerCase().endsWith('.json') ? absPath : `${absPath}.json`;
}

function siblingArtifactPath(primaryJsonPath, suffix) {
  const parsed = parse(primaryJsonPath);
  const stem = deriveArtifactStem(parsed.name, parsed.name);
  return resolve(parsed.dir, `${stem}${suffix}`);
}

async function inspectModelIfAvailable(modelPath) {
  if (!modelPath || !hasFreeCADRuntime()) return null;
  try {
    return await inspectModel({
      runScript: runWithCliStderr,
      filePath: modelPath,
    });
  } catch (error) {
    return {
      success: false,
      diagnostic: buildModelRuntimeDiagnostic({
        stage: 'model-inspection',
        modelPath,
        message: `Runtime-backed model inspection failed: ${error.message}`,
        actionableHint: defaultMetadataFallbackHint(),
        fallbackMode: 'metadata-only',
        details: error.stack || error.message,
      }),
    };
  }
}

async function detectStepFeaturesIfAvailable(modelPath) {
  if (!modelPath || !hasFreeCADRuntime()) return null;
  const ext = modelPath.toLowerCase().split('.').pop();
  if (!['step', 'stp'].includes(ext)) return null;
  try {
    return await runWithCliStderr('step_feature_detector.py', { file: modelPath });
  } catch (error) {
    return {
      success: false,
      diagnostic: buildModelRuntimeDiagnostic({
        stage: 'step-feature-detection',
        modelPath,
        message: `STEP feature detection failed: ${error.message}`,
        actionableHint: 'Repair the STEP/shape if you need STEP-derived feature hints.',
        fallbackMode: 'no-step-features',
        details: error.stack || error.message,
      }),
    };
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'check-runtime') {
    const { positional, options } = parseCliArgs(args);
    if (positional.length > 0) {
      console.error('Error: check-runtime does not accept positional arguments');
      process.exit(1);
    }
    process.exit(printRuntimeDiagnostics({
      format: options.json ? 'json' : 'text',
    }));
  } else if (command === 'create') {
    await cmdCreate(args[0]);
  } else if (command === 'review') {
    await cmdProductionReview(args);
  } else if (command === 'process-plan') {
    await cmdProcessPlan(args);
  } else if (command === 'line-plan') {
    await cmdLinePlan(args);
  } else if (command === 'quality-risk') {
    await cmdQualityRisk(args);
  } else if (command === 'investment-review') {
    await cmdInvestmentReview(args);
  } else if (command === 'readiness-pack') {
    await cmdReadinessPack(args);
  } else if (command === 'readiness-report') {
    await cmdReadinessReport(args);
  } else if (command === 'pack') {
    await cmdPack(args);
  } else if (command === 'stabilization-review') {
    await cmdStabilizationReview(args);
  } else if (command === 'generate-standard-docs') {
    await cmdGenerateStandardDocs(args);
  } else if (command === 'ingest') {
    await cmdIngest(args);
  } else if (command === 'analyze-part') {
    await cmdAnalyzePart(args);
  } else if (command === 'quality-link') {
    await cmdQualityLink(args);
  } else if (command === 'review-pack') {
    await cmdReviewPack(args);
  } else if (command === 'review-context') {
    await cmdReviewContext(args);
  } else if (command === 'compare-rev') {
    await cmdCompareRev(args);
  } else if (command === 'design') {
    await cmdDesign(args.join(' '));
  } else if (command === 'sweep') {
    await cmdSweep(args);
  } else if (command === 'draw') {
    await cmdDraw(args);
  } else if (command === 'fem') {
    await cmdFem(args);
  } else if (command === 'tolerance') {
    await cmdTolerance(args);
  } else if (command === 'report') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdReport(configArg, flags);
  } else if (command === 'validate') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdValidate(configArg, flags);
  } else if (command === 'validate-config') {
    await cmdValidateConfig(args);
  } else if (command === 'migrate-config') {
    await cmdMigrateConfig(args);
  } else if (command === 'dfm') {
    await cmdDfm(args);
  } else if (command === 'inspect') {
    await cmdInspect(args);
  } else if (command === 'serve') {
    await cmdServe(args);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}

function resolveConfigCommandInput(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = resolveMaybe(positional[0]);
  const outputPath = normalizeJsonOutputPath(options.out);
  const outDir = buildDefaultOutputDir(outputPath || options['out-dir']);
  const stem = deriveArtifactStem(outputPath || configPath || 'manufacturing_output', 'manufacturing_output');
  return { configPath, options, outputPath, outDir, stem };
}

function resolveReadinessBuilderInput(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = resolveMaybe(positional[0]);
  const reviewPackPath = resolveMaybe(options['review-pack']);
  const outputPath = normalizeJsonOutputPath(options.out);
  const outDir = buildDefaultOutputDir(outputPath || options['out-dir']);
  const stem = deriveArtifactStem(outputPath || reviewPackPath || configPath || 'readiness_output', 'readiness_output');
  return { positional, options, configPath, reviewPackPath, outputPath, outDir, stem };
}

function resolvePackInput(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const readinessPath = resolveMaybe(options.readiness || positional[0]);
  const outputPath = options.out ? resolveMaybe(requireOptionValue('--out', options.out)) : null;
  const outDir = buildDefaultOutputDir(outputPath || options['out-dir']);
  const stem = deriveArtifactStem(outputPath || readinessPath || 'release_bundle', 'release_bundle');
  return { positional, options, readinessPath, outputPath, outDir, stem };
}

async function loadCanonicalReviewPackInput(rawArgs = [], command) {
  const input = resolveReadinessBuilderInput(rawArgs);
  if (!input.reviewPackPath) return null;

  requireExistingInputFile('review-pack', input.reviewPackPath);
  const reviewPack = await readJsonFile(input.reviewPackPath);
  buildAfArtifactContractFromDocument({
    jobType: command,
    target: 'review_pack',
    document: reviewPack,
    path: input.reviewPackPath,
    strictReentry: true,
  });
  return { ...input, reviewPack };
}

async function loadCanonicalReadinessReportInput(filePath, command, label = 'readiness report') {
  requireExistingInputFile(label, filePath);
  const readinessReport = await readJsonFile(filePath);
  buildAfArtifactContractFromDocument({
    jobType: command,
    target: 'readiness_report',
    document: readinessReport,
    path: filePath,
    strictReentry: true,
  });
  return readinessReport;
}

async function loadCanonicalReadinessSupportArtifacts(options = {}, command) {
  const processPlanPath = resolveMaybe(options['process-plan']);
  const qualityRiskPath = resolveMaybe(options['quality-risk']);
  const processPlan = processPlanPath
    ? await loadCanonicalCArtifact('process_plan', processPlanPath, command, 'process-plan')
    : null;
  const qualityRisk = qualityRiskPath
    ? await loadCanonicalCArtifact('quality_risk', qualityRiskPath, command, 'quality-risk')
    : null;
  return {
    processPlanPath,
    qualityRiskPath,
    processPlan,
    qualityRisk,
  };
}

async function loadCanonicalCArtifact(kind, filePath, command, label) {
  requireExistingInputFile(label, filePath);
  const artifact = await readJsonFile(filePath);
  assertValidCArtifact(kind, artifact, {
    command,
    path: filePath,
  });
  return artifact;
}

async function resolveOptionalDocsManifest({ explicitPath = null, readinessPath = null } = {}) {
  const warnings = [];
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        join(dirname(readinessPath), 'standard_docs_manifest.json'),
        join(dirname(readinessPath), 'standard-docs', 'standard_docs_manifest.json'),
        join(dirname(readinessPath), 'standard_docs', 'standard_docs_manifest.json'),
      ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const manifest = await loadCanonicalCArtifact(
        'docs_manifest',
        candidate,
        'pack',
        explicitPath ? 'docs-manifest' : 'auto-discovered docs-manifest'
      );
      return {
        docsManifestPath: candidate,
        docsManifest: manifest,
        warnings,
      };
    } catch (error) {
      if (explicitPath) throw error;
      warnings.push(`Skipped auto-discovered docs manifest at ${candidate}: ${error.message}`);
    }
  }

  return {
    docsManifestPath: null,
    docsManifest: null,
    warnings,
  };
}

function emitConfigWarnings(summary) {
  for (const warning of summary?.warnings || []) {
    console.warn(`Warning: ${warning}`);
  }
}

async function loadConfigDocumentForCli(filepath) {
  const result = await loadConfigWithDiagnostics(filepath);
  emitConfigWarnings(result.summary);
  return result;
}

async function loadConfigForCli(filepath) {
  const result = await loadConfigDocumentForCli(filepath);
  return result.config;
}

async function writeCliManifest({
  command,
  status = 'succeeded',
  configPath = null,
  configSummary = null,
  config = null,
  profileName = null,
  artifacts = [],
  primaryOutputPath = null,
  outputDir = null,
  warnings = [],
  deprecations = [],
  details = undefined,
  related = undefined,
  timestamps = null,
  manifestPath = null,
}) {
  const ruleProfile = config
    ? await loadRuleProfile(PROJECT_ROOT, config, {
        profileName,
        silent: true,
      })
    : null;

  const manifest = await buildArtifactManifest({
    projectRoot: PROJECT_ROOT,
    interface: 'cli',
    command,
    jobType: command,
    status,
    configPath,
    configSummary,
    selectedProfile: profileName,
    ruleProfile: summarizeRuleProfile(ruleProfile),
    artifacts,
    warnings,
    deprecations,
    timestamps: timestamps || {
      created_at: nowIso(),
      started_at: nowIso(),
      finished_at: nowIso(),
    },
    details,
    related,
  });
  const resolvedManifestPath = manifestPath || createManifestPath({
    primaryOutputPath,
    outputDir,
  });
  return writeArtifactManifest(resolvedManifestPath, manifest);
}

function createExportArtifactEntries(exports = [], prefix = 'model') {
  return (exports || [])
    .filter((entry) => entry?.format && entry?.path)
    .map((entry) => ({
      type: `${prefix}.${String(entry.format).toLowerCase()}`,
      path: entry.path,
      label: entry.format.toUpperCase(),
      scope: 'user-facing',
      stability: 'stable',
    }));
}

function createArtifactEntry(type, path, {
  label = null,
  scope = 'user-facing',
  stability = 'stable',
  metadata = undefined,
} = {}) {
  return {
    type,
    path,
    label,
    scope,
    stability,
    ...(metadata ? { metadata } : {}),
  };
}

function safeFilenameComponent(value, defaultValue = 'unnamed') {
  const text = String(value || '').trim().replaceAll('\\', '/').replaceAll('\0', '');
  const leaf = text.split('/').pop();
  if (!leaf || leaf === '.' || leaf === '..') return defaultValue;
  return leaf;
}

function createOutputEntry(kind, path) {
  if (!kind || !path) return null;
  return { kind, path };
}

function createOutputEntriesFromExports(exports = [], prefix = 'model') {
  return (exports || [])
    .filter((entry) => entry?.format && entry?.path)
    .map((entry) => createOutputEntry(`${prefix}.${String(entry.format).toLowerCase()}`, entry.path))
    .filter(Boolean);
}

function buildExpectedModelOutputs(config = {}) {
  const exportConfig = config.export || {};
  const formats = Array.isArray(exportConfig.formats) ? exportConfig.formats : [];
  if (formats.length === 0) return [];
  const outputDir = buildDefaultOutputDir(exportConfig.directory);
  const stem = safeFilenameComponent(config.name, 'unnamed');
  return formats.map((format) => createOutputEntry(`model.${String(format).toLowerCase()}`, join(outputDir, `${stem}.${format}`)));
}

function buildExpectedFemOutputs(config = {}) {
  const outputDir = buildDefaultOutputDir(config.export?.directory);
  const stem = safeFilenameComponent(config.name, 'unnamed');
  return [
    createOutputEntry('analysis.fem.fcstd', join(outputDir, `${stem}.FCStd`)),
    ...buildExpectedModelOutputs(config).map((entry) => ({
      ...entry,
      kind: entry.kind.replace(/^model\./, 'analysis.fem.'),
    })),
  ].filter(Boolean);
}

function buildExpectedToleranceOutputs(config = {}) {
  if (!config?.tolerance?.csv) return [];
  const outputDir = buildDefaultOutputDir(config.export?.directory);
  const stem = safeFilenameComponent(config.name, 'unnamed');
  return [
    createOutputEntry('analysis.tolerance.csv', join(outputDir, `${stem}_tolerance.csv`)),
  ];
}

function buildExpectedReportOutputs(config = {}) {
  const outputDir = config._report_output_dir
    ? buildDefaultOutputDir(config._report_output_dir)
    : resolve(PROJECT_ROOT, 'output');
  const stem = safeFilenameComponent(config.name, 'unnamed');
  return [
    createOutputEntry('report.pdf', join(outputDir, `${stem}_report.pdf`)),
  ];
}

function buildExpectedDrawArtifacts(config = {}) {
  const outputDir = buildDefaultOutputDir(config.export?.directory);
  const stem = safeFilenameComponent(config.name, 'unnamed');
  const svgPath = join(outputDir, `${stem}_drawing.svg`);
  return {
    primaryOutputPath: svgPath,
    outputs: [
      createOutputEntry('drawing.svg', svgPath),
      config?.drawing?.dxf ? createOutputEntry('drawing.dxf', join(outputDir, `${stem}_front.dxf`)) : null,
      config?.drawing?.bom_csv ? createOutputEntry('drawing.csv', join(outputDir, `${stem}_bom.csv`)) : null,
    ].filter(Boolean),
    linkedArtifacts: {
      qa_json: svgPath.replace(/\.svg$/i, '_qa.json'),
      run_log_json: join(outputDir, `${stem}_run_log.json`),
      traceability_json: join(outputDir, `${stem}_traceability.json`),
      quality_json: svgPath.replace(/\.svg$/i, '_qa_issues.json'),
    },
  };
}

function buildDrawLinkedArtifactsFromSvg(svgPath) {
  if (!svgPath) return {};
  const normalizedPath = svgPath.replace(/\\/g, '/');
  const stem = parse(normalizedPath).name.replace(/_drawing$/i, '');
  const dir = dirname(normalizedPath);
  return {
    qa_json: normalizedPath.replace(/\.svg$/i, '_qa.json'),
    run_log_json: join(dir, `${stem}_run_log.json`),
    traceability_json: join(dir, `${stem}_traceability.json`),
    quality_json: normalizedPath.replace(/\.svg$/i, '_qa_issues.json'),
  };
}

function resolveOutputManifestStatus({ warnings = [], errors = [] } = {}) {
  if (errors.length > 0) return 'fail';
  if (warnings.length > 0) return 'warning';
  return 'pass';
}

async function emitOutputManifestSafe({
  command,
  commandArgs = [],
  repoContext,
  startedAt,
  inputPath = null,
  primaryOutputPath = null,
  outputDir = null,
  baseName = null,
  outputs = [],
  linkedArtifacts = {},
  warnings = [],
  errors = [],
  status = undefined,
}) {
  try {
    const finishedAt = nowIso();
    const manifest = await buildOutputManifest({
      projectRoot: PROJECT_ROOT,
      repoContext,
      command,
      commandArgs,
      inputPath,
      outputs,
      linkedArtifacts,
      warnings,
      errors,
      status: status || resolveOutputManifestStatus({ warnings, errors }),
      timings: {
        startedAt,
        finishedAt,
      },
    });
    const manifestPath = createOutputManifestPath({
      primaryOutputPath,
      outputDir,
      inputPath,
      baseName,
      command,
    });
    return await writeOutputManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Output manifest warning: ${error.message}`);
    return null;
  }
}

function resolveManifestOutputPath(options = {}) {
  const rawPath = options['manifest-out'];
  if (rawPath === undefined) return null;
  return resolveMaybe(requireOptionValue('--manifest-out', rawPath));
}

function createInputArtifactEntries({ configPath = null, inputPath = null, inputType = null, inputLabel = null } = {}) {
  const artifacts = [];
  if (configPath) {
    artifacts.push(createArtifactEntry('config.input', configPath, {
      label: 'Input config',
      scope: 'internal',
      stability: 'stable',
    }));
  }
  if (inputPath && inputType) {
    artifacts.push(createArtifactEntry(inputType, inputPath, {
      label: inputLabel,
      scope: 'internal',
      stability: 'stable',
    }));
  }
  return artifacts;
}

function createAnalysisExportEntries(result, prefix) {
  return createExportArtifactEntries(result?.exports || [], prefix);
}

async function writeStdoutCommandManifest({
  manifestPath = null,
  command,
  status = 'succeeded',
  configPath = null,
  configSummary = null,
  config = null,
  inputPath = null,
  inputType = null,
  inputLabel = null,
  artifacts = [],
  details = undefined,
}) {
  if (!manifestPath) return null;

  return writeCliManifest({
    command,
    status,
    configPath,
    configSummary,
    config,
    manifestPath,
    artifacts: [
      ...createInputArtifactEntries({ configPath, inputPath, inputType, inputLabel }),
      ...artifacts,
    ],
    details,
  });
}

function collectDrawManifestArtifacts(result) {
  const svgPath = result?.drawing_paths?.find((entry) => entry.format === 'svg')?.path
    || result?.svg_path
    || result?.drawing_path;
  if (!svgPath) return [];

  const normalizedPath = svgPath.replace(/\\/g, '/');
  const stem = parse(normalizedPath).name.replace(/_drawing$/i, '');
  const dir = dirname(normalizedPath);
  const candidates = [
    createArtifactEntry('drawing.svg', normalizedPath, { label: 'SVG drawing' }),
    createArtifactEntry('drawing.qa-report', normalizedPath.replace(/\.svg$/i, '_qa.json'), {
      label: 'Drawing QA',
      stability: 'best-effort',
    }),
    createArtifactEntry('drawing.qa-issues', normalizedPath.replace(/\.svg$/i, '_qa_issues.json'), {
      label: 'Drawing QA issues',
      stability: 'best-effort',
    }),
    createArtifactEntry('drawing.repair-report', normalizedPath.replace(/\.svg$/i, '_repair_report.json'), {
      label: 'Repair report',
      stability: 'best-effort',
    }),
    createArtifactEntry('draw.run-log', join(dir, `${stem}_run_log.json`), {
      label: 'Draw run log',
      scope: 'internal',
      stability: 'internal',
    }),
    createArtifactEntry('config.effective', join(dir, `${stem}_effective_config.json`), {
      label: 'Effective config',
      scope: 'internal',
      stability: 'internal',
    }),
    createArtifactEntry('draw.plan.toml', join(dir, `${stem}_plan.toml`), {
      label: 'Drawing plan TOML',
      stability: 'best-effort',
    }),
    createArtifactEntry('draw.plan.json', join(dir, `${stem}_plan.json`), {
      label: 'Drawing plan JSON',
      stability: 'best-effort',
    }),
    createArtifactEntry('draw.traceability', join(dir, `${stem}_traceability.json`), {
      label: 'Traceability map',
      stability: 'best-effort',
    }),
    createArtifactEntry('draw.layout-report', join(dir, `${stem}_layout_report.json`), {
      label: 'Layout report',
      stability: 'best-effort',
    }),
    createArtifactEntry('draw.dimension-map', join(dir, `${stem}_dimension_map.json`), {
      label: 'Dimension map',
      scope: 'internal',
      stability: 'internal',
    }),
    createArtifactEntry('draw.dimension-conflicts', join(dir, `${stem}_dim_conflicts.json`), {
      label: 'Dimension conflicts',
      scope: 'internal',
      stability: 'internal',
    }),
    createArtifactEntry('draw.dedupe-diagnostics', join(dir, `${stem}_dedupe_diagnostics.json`), {
      label: 'Dedupe diagnostics',
      scope: 'internal',
      stability: 'internal',
    }),
  ];
  return candidates;
}

function defaultMigratedConfigPath(configPath, format) {
  const parsed = parse(configPath);
  return resolve(parsed.dir, `${parsed.name}.migrated.${format === 'json' ? 'json' : 'toml'}`);
}

function summarizeConfigValidation(label, validation, { strict = false } = {}) {
  const { summary } = validation;
  const effectiveValid = validation.valid && (!strict || summary.warnings.length === 0);
  console.log(`${effectiveValid ? 'VALID' : 'INVALID'}: ${label}`);
  console.log(`  Errors: ${summary.errors.length}`);
  console.log(`  Warnings: ${summary.warnings.length}${strict ? ' (strict mode)' : ''}`);
  console.log(`  Config version: ${summary.input_version ?? 'legacy'} -> ${summary.target_version}`);

  if (summary.changed_fields.length > 0) {
    console.log('  Changed fields:');
    for (const entry of summary.changed_fields) console.log(`    - ${entry}`);
  }
  if (summary.deprecated_fields.length > 0) {
    console.log('  Deprecated fields:');
    for (const entry of summary.deprecated_fields) console.log(`    - ${entry}`);
  }
  if (summary.errors.length > 0) {
    console.log('  Errors:');
    for (const entry of summary.errors) console.log(`    - ${entry}`);
  }
  if (summary.manual_follow_up.length > 0) {
    console.log('  Manual follow-up:');
    for (const entry of summary.manual_follow_up) console.log(`    - ${entry}`);
  }

  return effectiveValid;
}

async function loadRuntimeData(options = {}) {
  const runtimePath = resolveMaybe(options.runtime);
  if (!runtimePath) return null;
  return readJsonFile(runtimePath);
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function mergeSourceArtifactRefs(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const ref of [...primary, ...secondary]) {
    if (!ref?.artifact_type || !ref?.role) continue;
    const key = `${ref.artifact_type}|${ref.path || ''}|${ref.role}|${ref.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      artifact_type: ref.artifact_type,
      path: ref.path || null,
      role: ref.role,
      label: ref.label || null,
    });
  }
  return merged;
}

function buildCSourceArtifactRefs({ configPath = null, runtimePath = null } = {}) {
  return [
    configPath ? buildSourceArtifactRef('config', configPath, 'input', 'Input config') : null,
    runtimePath ? buildSourceArtifactRef('runtime', runtimePath, 'input', 'Runtime JSON') : null,
  ].filter(Boolean);
}

function buildCanonicalArtifactDescriptor(kind, contract = null) {
  return {
    json_is_source_of_truth: true,
    artifact_type: kind,
    artifact_filename: contract?.primary_output || `${kind}.json`,
    derived_outputs: contract?.derived_outputs || [],
    rationale: kind === 'readiness_report'
      ? 'readiness_report.json is the canonical C artifact; downstream docs and bundles derive from it.'
      : 'This JSON artifact is the canonical machine-readable source for the downstream C output.',
  };
}

function buildProcessPlanCoverage(processPlan = {}, sourceArtifactCount = 0) {
  return {
    process_step_count: (processPlan.process_flow || []).length,
    key_inspection_point_count: (processPlan.key_inspection_points || []).length,
    automation_candidate_count: (processPlan.automation_candidates || []).length,
    source_artifact_count: sourceArtifactCount,
  };
}

function buildQualityRiskCoverage(qualityRisk = {}, sourceArtifactCount = 0) {
  return {
    critical_dimension_count: (qualityRisk.critical_dimensions || []).length,
    quality_risk_count: (qualityRisk.quality_risks || []).length,
    quality_gate_count: (qualityRisk.quality_gates || []).length,
    source_artifact_count: sourceArtifactCount,
  };
}

function buildStabilizationCoverage(stabilizationReview = {}, sourceArtifactCount = 0) {
  const runtimeSummary = stabilizationReview.analysis_basis?.runtime_summary || {};
  return {
    station_runtime_review_count: (stabilizationReview.station_runtime_review || []).length,
    runtime_station_count: runtimeSummary.runtime_station_count || 0,
    stations_over_target_count: (runtimeSummary.stations_over_target || []).length,
    runtime_informed: Boolean(runtimeSummary.runtime_informed),
    source_artifact_count: sourceArtifactCount,
  };
}

function buildReadinessCoverage(report = {}, sourceArtifactCount = 0) {
  return {
    required_section_count: 7,
    available_section_count: [
      report.product_review,
      report.process_plan,
      report.line_plan,
      report.quality_risk,
      report.investment_review,
      report.summary,
      report.decision_summary,
    ].filter(Boolean).length,
    optional_stabilization_review: Boolean(report.stabilization_review),
    process_step_count: (report.process_plan?.process_flow || []).length,
    quality_gate_count: (report.quality_risk?.quality_gates || []).length,
    source_artifact_count: sourceArtifactCount,
  };
}

function withCArtifactEnvelope(payload, {
  kind,
  command,
  generatedAt,
  warnings = [],
  coverage = {},
  confidence,
  sourceArtifactRefs = [],
}) {
  const contract = getCCommandContract(command);
  return {
    ...payload,
    schema_version: C_ARTIFACT_SCHEMA_VERSION,
    artifact_type: kind,
    generated_at: payload.generated_at || generatedAt,
    warnings: uniqueStrings([...(payload.warnings || []), ...warnings]),
    coverage: payload.coverage || coverage,
    confidence: payload.confidence || confidence,
    source_artifact_refs: mergeSourceArtifactRefs(payload.source_artifact_refs || [], sourceArtifactRefs),
    canonical_artifact: payload.canonical_artifact || buildCanonicalArtifactDescriptor(kind, contract),
    contract: payload.contract || contract,
  };
}

function annotateReadinessArtifacts(report, {
  configPath = null,
  runtimePath = null,
  configWarnings = [],
} = {}) {
  const sourceArtifactRefs = buildCSourceArtifactRefs({ configPath, runtimePath });
  const generatedAt = report.generated_at || nowIso();
  const sharedWarnings = uniqueStrings(configWarnings);
  const sourceArtifactCount = sourceArtifactRefs.length;

  report.process_plan = withCArtifactEnvelope(report.process_plan, {
    kind: 'process_plan',
    command: 'process-plan',
    generatedAt,
    warnings: sharedWarnings,
    coverage: buildProcessPlanCoverage(report.process_plan, sourceArtifactCount),
    confidence: {
      level: 'heuristic',
      score: 0.56,
      rationale: 'Process plan is derived from config, DFM, and heuristics and still requires site-specific engineering validation.',
    },
    sourceArtifactRefs,
  });

  report.quality_risk = withCArtifactEnvelope(report.quality_risk, {
    kind: 'quality_risk',
    command: 'quality-risk',
    generatedAt,
    warnings: sharedWarnings,
    coverage: buildQualityRiskCoverage(report.quality_risk, sourceArtifactCount),
    confidence: {
      level: 'heuristic',
      score: 0.58,
      rationale: 'Quality-risk output packages rule-based readiness signals and should be validated against plant quality systems.',
    },
    sourceArtifactRefs,
  });

  if (report.stabilization_review) {
    const runtimeInformed = Boolean(report.stabilization_review.analysis_basis?.runtime_summary?.runtime_informed);
    report.stabilization_review = withCArtifactEnvelope(report.stabilization_review, {
      kind: 'stabilization_review',
      command: 'stabilization-review',
      generatedAt,
      warnings: sharedWarnings,
      coverage: buildStabilizationCoverage(report.stabilization_review, sourceArtifactCount),
      confidence: {
        level: runtimeInformed ? 'medium' : 'heuristic',
        score: runtimeInformed ? 0.7 : 0.46,
        rationale: runtimeInformed
          ? 'Stabilization review combines supplied runtime data with heuristic bottleneck interpretation.'
          : 'Without runtime data, stabilization review remains a heuristic-only readiness aid.',
      },
      sourceArtifactRefs,
    });
  }

  return withCArtifactEnvelope(report, {
    kind: 'readiness_report',
    command: 'readiness-report',
    generatedAt,
    warnings: uniqueStrings([
      ...sharedWarnings,
      ...(report.process_plan?.warnings || []),
      ...(report.quality_risk?.warnings || []),
      ...(report.stabilization_review?.warnings || []),
    ]),
    coverage: buildReadinessCoverage(report, sourceArtifactCount),
    confidence: {
      level: report.stabilization_review?.analysis_basis?.runtime_summary?.runtime_informed ? 'medium' : 'heuristic',
      score: report.stabilization_review?.analysis_basis?.runtime_summary?.runtime_informed ? 0.68 : 0.52,
      rationale: report.stabilization_review?.analysis_basis?.runtime_summary?.runtime_informed
        ? 'Readiness report packages heuristic planning outputs with supplied runtime-informed stabilization signals.'
        : 'Readiness report is derived from heuristic planning agents and should be refined with runtime evidence and plant review.',
    },
    sourceArtifactRefs,
  });
}

function markLegacyCompatibilityReadiness(report) {
  return {
    ...report,
    warnings: uniqueStrings([...(report.warnings || []), LEGACY_READINESS_REPORT_MESSAGE]),
    compatibility_mode: {
      type: 'legacy_config_compatibility',
      canonical_review_pack_backed: false,
      guidance: 'Use readiness-pack --review-pack or readiness-report --review-pack for canonical C output.',
    },
  };
}

async function runProductionReadiness(rawArgs = [], { persistArtifacts = true } = {}) {
  const { configPath, options, outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const configDocument = await loadConfigDocumentForCli(configPath);
  const config = configDocument.config;
  const runtimeData = await loadRuntimeData(options);
  let report = await runReadinessReportWorkflow({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig: loadConfigForCli,
    configPath,
    config,
    options: {
      batchSize: ensureNumericOption('--batch', options.batch),
      profileName: options.profile || null,
      process: options.process || config.manufacturing?.process || config.process || null,
      material: options.material || config.manufacturing?.material || config.material || null,
      site: options.site || null,
      runtimeData,
      onStderr: (text) => process.stderr.write(text),
    },
  });
  report = annotateReadinessArtifacts(report, {
    configPath,
    runtimePath: resolveMaybe(options.runtime),
    configWarnings: configDocument.summary?.warnings || [],
  });

  const resolvedOutputPath = outputPath || artifactPathFor(outDir, stem, '_readiness_report.json');
  const artifacts = persistArtifacts
    ? await writeReadinessArtifacts(resolvedOutputPath, report)
    : null;
  return {
    report,
    artifacts,
    config,
    configPath,
    configSummary: configDocument.summary,
    profileName: options.profile || null,
    outputPath,
    outDir,
    stem,
  };
}

async function writeAgentArtifact(outputPath, fallbackDir, stem, suffix, payload) {
  const targetPath = outputPath || artifactPathFor(fallbackDir, stem, suffix);
  const kind = payload?.artifact_type || null;
  const jsonPath = kind
    ? await writeValidatedCArtifact(targetPath, kind, payload, { command: payload.contract?.command || undefined })
    : await writeJsonFile(targetPath, payload);
  return { json: jsonPath };
}

async function cmdProductionReview(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_product_review.json', report.product_review);
  const manifestPath = await writeCliManifest({
    command: 'review',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.product.json', artifacts.json, { label: 'Product review JSON' }),
    ],
  });
  console.log(`Product review: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Part type: ${report.product_review.summary.part_type}`);
  console.log(`  DFM score: ${report.product_review.summary.dfm_score ?? 'n/a'}`);
}

async function cmdProcessPlan(rawArgs = []) {
  const reviewPackInput = await loadCanonicalReviewPackInput(rawArgs, 'process-plan');
  if (reviewPackInput) {
    const payload = buildProcessPlanFromReviewPack({
      reviewPack: reviewPackInput.reviewPack,
      reviewPackPath: reviewPackInput.reviewPackPath,
    });
    const artifacts = await writeAgentArtifact(
      reviewPackInput.outputPath,
      reviewPackInput.outDir,
      reviewPackInput.stem,
      '_process_plan.json',
      payload
    );
    const manifestPath = await writeCliManifest({
      command: 'process-plan',
      primaryOutputPath: artifacts.json,
      artifacts: [
        createArtifactEntry('review.process-plan.json', artifacts.json, { label: 'Process plan JSON' }),
        createArtifactEntry('input.review-pack', reviewPackInput.reviewPackPath, {
          label: 'Review pack JSON',
          scope: 'internal',
        }),
      ],
    });
    console.log(`Process plan: ${artifacts.json}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`  Steps: ${payload.process_flow.length}`);
    console.log(`  Source: ${reviewPackInput.reviewPackPath}`);
    return;
  }

  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_process_plan.json', report.process_plan);
  const manifestPath = await writeCliManifest({
    command: 'process-plan',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.process-plan.json', artifacts.json, { label: 'Process plan JSON' }),
    ],
  });
  console.log(`Process plan: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Steps: ${report.process_plan.process_flow.length}`);
}

async function cmdLinePlan(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_line_plan.json', report.line_plan);
  const manifestPath = await writeCliManifest({
    command: 'line-plan',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.line-plan.json', artifacts.json, { label: 'Line plan JSON' }),
    ],
  });
  console.log(`Line layout support: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Stations: ${report.line_plan.station_concept.length}`);
}

async function cmdQualityRisk(rawArgs = []) {
  const reviewPackInput = await loadCanonicalReviewPackInput(rawArgs, 'quality-risk');
  if (reviewPackInput) {
    const payload = buildQualityRiskFromReviewPack({
      reviewPack: reviewPackInput.reviewPack,
      reviewPackPath: reviewPackInput.reviewPackPath,
    });
    const artifacts = await writeAgentArtifact(
      reviewPackInput.outputPath,
      reviewPackInput.outDir,
      reviewPackInput.stem,
      '_quality_risk.json',
      payload
    );
    const manifestPath = await writeCliManifest({
      command: 'quality-risk',
      primaryOutputPath: artifacts.json,
      artifacts: [
        createArtifactEntry('review.quality-risk.json', artifacts.json, { label: 'Quality risk JSON' }),
        createArtifactEntry('input.review-pack', reviewPackInput.reviewPackPath, {
          label: 'Review pack JSON',
          scope: 'internal',
        }),
      ],
    });
    console.log(`Quality / traceability pack: ${artifacts.json}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`  Critical dimensions: ${payload.critical_dimensions.length}`);
    console.log(`  Source: ${reviewPackInput.reviewPackPath}`);
    return;
  }

  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_quality_risk.json', report.quality_risk);
  const manifestPath = await writeCliManifest({
    command: 'quality-risk',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.quality-risk.json', artifacts.json, { label: 'Quality risk JSON' }),
    ],
  });
  console.log(`Quality / traceability pack: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Critical dimensions: ${report.quality_risk.critical_dimensions.length}`);
}

async function cmdInvestmentReview(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_investment_review.json', report.investment_review);
  const manifestPath = await writeCliManifest({
    command: 'investment-review',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.investment-review.json', artifacts.json, { label: 'Investment review JSON' }),
    ],
  });
  console.log(`Cost / investment review: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Unit cost: ${report.investment_review.cost_breakdown.unit_cost ?? 'n/a'}`);
}

async function cmdReadinessPack(rawArgs = [], {
  manifestCommand = 'readiness-pack',
  optionalReviewPack = false,
  outputLabel = 'Readiness pack',
} = {}) {
  const reviewPackInput = await loadCanonicalReviewPackInput(rawArgs, manifestCommand);
  if (!reviewPackInput) {
    if (optionalReviewPack) return false;
    console.error('Error: readiness-pack requires --review-pack <review_pack.json>');
    process.exit(1);
  }

  const {
    processPlanPath,
    qualityRiskPath,
    processPlan,
    qualityRisk,
  } = await loadCanonicalReadinessSupportArtifacts(reviewPackInput.options, manifestCommand);

  const report = buildReadinessReportFromReviewPack({
    reviewPack: reviewPackInput.reviewPack,
    reviewPackPath: reviewPackInput.reviewPackPath,
    processPlan,
    qualityRisk,
  });
  const outputPath = reviewPackInput.outputPath || artifactPathFor(
    reviewPackInput.outDir,
    reviewPackInput.stem,
    '_readiness_report.json'
  );
  const artifacts = await writeCanonicalReadinessArtifacts(outputPath, report);
  const manifestPath = await writeCliManifest({
    command: manifestCommand,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.readiness.json', artifacts.json, { label: 'Readiness report JSON' }),
      createArtifactEntry('review.readiness.markdown', artifacts.markdown, { label: 'Readiness report Markdown' }),
      createArtifactEntry('input.review-pack', reviewPackInput.reviewPackPath, {
        label: 'Review pack JSON',
        scope: 'internal',
      }),
      ...(processPlanPath ? [createArtifactEntry('input.process-plan', processPlanPath, {
        label: 'Process plan JSON',
        scope: 'internal',
      })] : []),
      ...(qualityRiskPath ? [createArtifactEntry('input.quality-risk', qualityRiskPath, {
        label: 'Quality risk JSON',
        scope: 'internal',
      })] : []),
    ],
  });
  console.log(`${outputLabel} JSON: ${artifacts.json}`);
  console.log(`${outputLabel} Markdown: ${artifacts.markdown}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Status: ${report.readiness_summary.status}`);
  console.log(`  Score: ${report.readiness_summary.score}`);
  console.log(`  Source: ${reviewPackInput.reviewPackPath}`);
  return true;
}

async function cmdReadinessReport(rawArgs = []) {
  if (await cmdReadinessPack(rawArgs, {
    manifestCommand: 'readiness-report',
    optionalReviewPack: true,
    outputLabel: 'Readiness report',
  })) {
    return;
  }

  const {
    report,
    artifacts,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs);
  const legacyReport = markLegacyCompatibilityReadiness(report);
  const manifestPath = await writeCliManifest({
    command: 'readiness-report',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.readiness.json', artifacts.json, { label: 'Readiness report JSON' }),
      createArtifactEntry('review.readiness.markdown', artifacts.markdown, { label: 'Readiness report Markdown' }),
    ],
    warnings: legacyReport.warnings || [],
    deprecations: [LEGACY_READINESS_REPORT_MESSAGE],
    details: {
      readiness_contract_mode: 'legacy_config_compatibility',
      canonical_review_pack_backed: false,
    },
  });
  await writeReadinessArtifacts(artifacts.json, legacyReport);
  console.warn(`Warning: ${LEGACY_READINESS_REPORT_MESSAGE}`);
  console.log(`Legacy readiness report JSON: ${artifacts.json}`);
  console.log(`Legacy readiness report Markdown: ${artifacts.markdown}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Status: ${legacyReport.readiness_summary.status}`);
  console.log(`  Score: ${legacyReport.readiness_summary.score}`);
}

async function cmdPack(rawArgs = []) {
  const { readinessPath, options, outputPath, outDir, stem } = resolvePackInput(rawArgs);
  if (!readinessPath) {
    console.error('Error: pack requires --readiness <readiness_report.json>');
    process.exit(1);
  }

  const readinessReport = await loadCanonicalReadinessReportInput(readinessPath, 'pack', 'readiness report');
  const docsInput = await resolveOptionalDocsManifest({
    explicitPath: resolveMaybe(options['docs-manifest']),
    readinessPath,
  });
  if (docsInput.docsManifestPath && docsInput.docsManifest) {
    validateDocsManifestAgainstReadiness({
      readinessReport,
      readinessPath,
      docsManifest: docsInput.docsManifest,
      docsManifestPath: docsInput.docsManifestPath,
    });
  }
  const resolvedOutputPath = outputPath || artifactPathFor(outDir, stem, '_release_bundle.zip');
  const result = await runReleaseBundleWorkflow({
    projectRoot: PROJECT_ROOT,
    readinessPath,
    readinessReport,
    outputPath: resolvedOutputPath,
    docsManifestPath: docsInput.docsManifestPath,
    docsManifest: docsInput.docsManifest,
    additionalWarnings: docsInput.warnings,
  });

  const manifestPath = await writeCliManifest({
    command: 'pack',
    primaryOutputPath: result.bundle_zip_path,
    artifacts: [
      createArtifactEntry('release-bundle.zip', result.bundle_zip_path, { label: 'Release bundle ZIP' }),
      createArtifactEntry('release-bundle.manifest.json', result.manifest_path, { label: 'Release bundle manifest JSON' }),
      createArtifactEntry('release-bundle.checksums', result.checksums_path, { label: 'Release bundle checksums' }),
      createArtifactEntry('release-bundle.log.json', result.log_path, { label: 'Release bundle log JSON' }),
      createArtifactEntry('input.readiness-report', readinessPath, {
        label: 'Canonical readiness report JSON',
        scope: 'internal',
      }),
      ...(docsInput.docsManifestPath ? [createArtifactEntry('input.docs-manifest', docsInput.docsManifestPath, {
        label: 'Standard docs manifest JSON',
        scope: 'internal',
      })] : []),
    ],
    warnings: result.manifest.warnings || [],
    related: {
      release_bundle_manifest: result.manifest_path,
    },
  });

  console.log(`Release bundle ZIP: ${result.bundle_zip_path}`);
  console.log(`Release bundle manifest: ${result.manifest_path}`);
  console.log(`Release bundle checksums: ${result.checksums_path}`);
  console.log(`Release bundle log: ${result.log_path}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Bundled artifacts: ${result.bundle_artifacts.length}`);
  console.log(`  Docs included: ${Boolean(docsInput.docsManifestPath)}`);
}

async function cmdStabilizationReview(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  if (!options.runtime) {
    const baselinePath = resolveMaybe(options.baseline || positional[0]);
    const candidatePath = resolveMaybe(options.candidate || positional[1]);
    if (!baselinePath || !candidatePath) {
      console.error('Error: stabilization-review requires either --runtime <runtime.json> with a config input or two readiness-report JSON inputs.');
      process.exit(1);
    }

    const baselineReport = await loadCanonicalReadinessReportInput(
      baselinePath,
      'stabilization-review',
      'baseline readiness report'
    );
    const candidateReport = await loadCanonicalReadinessReportInput(
      candidatePath,
      'stabilization-review',
      'candidate readiness report'
    );
    const outputPath = normalizeJsonOutputPath(options.out);
    const outDir = buildDefaultOutputDir(outputPath || options['out-dir']);
    const stem = deriveArtifactStem(outputPath || candidatePath || baselinePath || 'stabilization_review', 'stabilization_review');
    const payload = buildStabilizationReviewFromReadinessReports({
      baselineReport,
      candidateReport,
      baselinePath,
      candidatePath,
    });
    const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_stabilization_review.json', payload);
    const manifestPath = await writeCliManifest({
      command: 'stabilization-review',
      primaryOutputPath: artifacts.json,
      artifacts: [
        createArtifactEntry('review.stabilization.json', artifacts.json, { label: 'Stabilization review JSON' }),
        createArtifactEntry('input.readiness.baseline', baselinePath, {
          label: 'Baseline readiness report JSON',
          scope: 'internal',
        }),
        createArtifactEntry('input.readiness.candidate', candidatePath, {
          label: 'Candidate readiness report JSON',
          scope: 'internal',
        }),
      ],
    });
    console.log(`Stabilization review: ${artifacts.json}`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`  Status change: ${payload.summary.status_change}`);
    console.log(`  Score delta: ${payload.summary.readiness_score_delta}`);
    return;
  }

  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);

  const {
    report,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  if (!report.stabilization_review) {
    console.error('Error: stabilization review was not generated from the supplied inputs.');
    process.exit(1);
  }

  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_stabilization_review.json', report.stabilization_review);
  const manifestPath = await writeCliManifest({
    command: 'stabilization-review',
    configPath,
    configSummary,
    config,
    profileName,
    primaryOutputPath: artifacts.json,
    artifacts: [
      createArtifactEntry('review.stabilization.json', artifacts.json, { label: 'Stabilization review JSON' }),
      createArtifactEntry('input.runtime', resolveMaybe(options.runtime), {
        label: 'Runtime JSON',
      }),
    ],
  });
  console.log(`Stabilization review: ${artifacts.json}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Runtime basis: ${report.stabilization_review.summary.runtime_basis}`);
  console.log(`  Top bottlenecks: ${(report.stabilization_review.summary.top_bottlenecks || []).length}`);
}

async function cmdGenerateStandardDocs(rawArgs = []) {
  const { configPath, options } = resolveConfigCommandInput(rawArgs);
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const configDocument = await loadConfigDocumentForCli(configPath);
  const config = configDocument.config;
  const runtimeData = await loadRuntimeData(options);
  const readinessReportPath = resolveMaybe(options['readiness-report']);
  if (options['review-pack'] !== undefined) {
    console.error('Error: generate-standard-docs no longer accepts --review-pack; provide --readiness-report <readiness_report.json> instead.');
    process.exit(1);
  }
  if (!readinessReportPath) {
    console.error(`Error: ${GENERATE_STANDARD_DOCS_INPUT_MESSAGE}`);
    process.exit(1);
  }
  const readinessReport = await loadCanonicalReadinessReportInput(
    readinessReportPath,
    'generate-standard-docs',
    'readiness-report'
  );
  const result = await runStandardDocsWorkflow({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig: loadConfigForCli,
    configPath,
    config,
    options: {
      batchSize: ensureNumericOption('--batch', options.batch),
      profileName: options.profile || null,
      process: options.process || config.manufacturing?.process || config.process || null,
      material: options.material || config.manufacturing?.material || config.material || null,
      site: options.site || null,
      runtimeData,
      outDir: resolveMaybe(options['out-dir']),
      report: readinessReport,
      reportPath: readinessReportPath,
      onStderr: (text) => process.stderr.write(text),
    },
  });

  console.log(`Standard docs output: ${result.out_dir}`);
  if (readinessReportPath) {
    console.log(`Canonical readiness source: ${readinessReportPath}`);
  }
  console.log(`  Process flow: ${result.artifacts['process_flow.md']}`);
  console.log(`  Control plan: ${result.artifacts['control_plan_draft.csv']}`);
  console.log(`  Work instruction: ${result.artifacts['work_instruction_draft.md']}`);
  const manifestPath = await writeCliManifest({
    command: 'generate-standard-docs',
    configPath,
    configSummary: configDocument.summary,
    config,
    profileName: options.profile || null,
    outputDir: result.out_dir,
    artifacts: [
      ...Object.entries(result.artifacts).map(([filename, filePath]) => createArtifactEntry(
        filename === 'manifest' ? 'standard-docs.summary' : `standard-docs.${filename}`,
        filePath,
        {
          label: filename,
          stability: filename === 'manifest' ? 'best-effort' : 'stable',
        }
      )),
      ...(result.readiness_report_path ? [createArtifactEntry(
        'input.readiness-report',
        result.readiness_report_path,
        {
          label: 'Canonical readiness report JSON',
          scope: 'internal',
        }
      )] : []),
    ],
    details: {
      readiness_contract_mode: 'explicit_readiness_report',
      canonical_review_pack_backed: true,
    },
  });
  console.log(`Manifest: ${manifestPath}`);
}

async function cmdIngest(rawArgs = []) {
  const { options } = parseCliArgs(rawArgs);
  const modelPath = resolveMaybe(options.model);
  const bomPath = resolveMaybe(options.bom);
  const inspectionPath = resolveMaybe(options.inspection);
  const qualityPath = resolveMaybe(options.quality);

  if (!modelPath && !bomPath && !inspectionPath && !qualityPath) {
    console.error('Error: ingest requires at least one engineering input');
    console.error('  fcad ingest --model part.step --inspection inspection.csv --out output/part_context.json');
    process.exit(1);
  }

  requireExistingInputFile('model', modelPath);
  requireExistingInputFile('bom', bomPath);
  requireExistingInputFile('inspection', inspectionPath);
  requireExistingInputFile('quality', qualityPath);

  const baseStem = deriveArtifactStem(options.out || modelPath || bomPath || inspectionPath || qualityPath, 'engineering_part');
  const outputPath = normalizeJsonOutputPath(options.out) || resolve(join(PROJECT_ROOT, 'output', `${baseStem}_context.json`));
  const paths = createArtifactPaths(outputPath, deriveArtifactStem(outputPath, baseStem), {
    context: '',
    ingestLog: '_ingest_log.json',
  });
  if (!paths.context.endsWith('.json')) {
    paths.context = `${paths.context}.json`;
  }

  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/ingest_context.py', {
    model: modelPath,
    bom: bomPath,
    inspection: inspectionPath,
    quality: qualityPath,
    part_name: options['part-name'],
    part_id: options['part-id'],
    revision: options.revision,
    material: options.material,
    process: options.process,
    facility: options.facility,
    supplier: options.supplier,
    manufacturing_notes: options['manufacturing-notes'],
  }, {
    onStderr: (text) => process.stderr.write(text),
  });

  await writeJsonFile(paths.context, result.context);
  await writeJsonFile(paths.ingestLog, result.ingest_log);
  const manifestPath = await writeCliManifest({
    command: 'ingest',
    primaryOutputPath: paths.context,
    artifacts: [
      createArtifactEntry('context.json', paths.context, { label: 'Engineering context JSON' }),
      createArtifactEntry('ingest.log.json', paths.ingestLog, { label: 'Ingest log JSON' }),
      ...(modelPath ? [createArtifactEntry('input.model', modelPath, { label: 'Input model' })] : []),
      ...(bomPath ? [createArtifactEntry('input.bom', bomPath, { label: 'Input BOM CSV' })] : []),
      ...(inspectionPath ? [createArtifactEntry('input.inspection', inspectionPath, { label: 'Input inspection CSV' })] : []),
      ...(qualityPath ? [createArtifactEntry('input.quality', qualityPath, { label: 'Input quality CSV' })] : []),
    ],
  });

  console.log(`Context JSON: ${paths.context}`);
  console.log(`Ingest log:   ${paths.ingestLog}`);
  console.log(`Manifest:     ${manifestPath}`);
  console.log(`  BOM entries: ${result.ingest_log.summary?.bom_entries || 0}`);
  console.log(`  Inspection results: ${result.ingest_log.summary?.inspection_results || 0}`);
  console.log(`  Quality issues: ${result.ingest_log.summary?.quality_issues || 0}`);
}

async function cmdAnalyzePart(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const firstPositional = typeof positional[0] === 'string' ? positional[0] : null;
  const contextPath = resolveMaybe(options.context || (firstPositional?.toLowerCase()?.endsWith('.json') ? firstPositional : null));
  const directModelPath = resolveMaybe(options.model || (!contextPath ? firstPositional : null));
  const context = contextPath ? await readJsonFile(contextPath) : null;
  const modelPath = directModelPath || resolveMaybe(context?.geometry_source?.path);
  const analysisInputs = await resolveModelAnalysisInputs({
    modelPath,
    modelMetadata: context?.geometry_source?.model_metadata || null,
    featureHints: context?.geometry_source?.feature_hints || null,
    inspectModelIfAvailable,
    detectStepFeaturesIfAvailable,
  });

  let modelMetadata = analysisInputs.modelMetadata;
  let featureHints = analysisInputs.featureHints;
  for (const warning of analysisInputs.warningMessages) {
    console.warn(`Warning: ${warning}`);
  }

  if (!modelMetadata) {
    console.error('Error: analyze-part requires either a context with geometry_source.model_metadata or an inspectable CAD model path.');
    process.exit(1);
  }

  const primaryOutputPath = normalizeJsonOutputPath(options.out);
  const generatedAt = nowIso();
  const sourceArtifactRefs = [
    contextPath ? buildSourceArtifactRef('engineering_context', contextPath, 'input', 'Input context JSON') : null,
    modelPath ? buildSourceArtifactRef('cad_model', modelPath, 'input', 'Input model') : null,
  ].filter(Boolean);
  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/analyze_part.py', {
    context,
    model_metadata: modelMetadata,
    feature_hints: featureHints,
    geometry_source: {
      ...(context?.geometry_source || (modelPath ? { path: modelPath } : {})),
      ...(analysisInputs.geometrySourcePatch || {}),
    },
    part: context?.part || { name: deriveArtifactStem(modelPath || contextPath, 'part') },
    generated_at: generatedAt,
    source_artifact_refs: sourceArtifactRefs,
    warnings: analysisInputs.warningMessages,
    runtime_diagnostics: analysisInputs.runtimeDiagnostics,
    allow_metadata_only_fallback: true,
    used_metadata_only_fallback: analysisInputs.usedMetadataOnlyFallback,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });

  const stem = deriveArtifactStem(primaryOutputPath || contextPath || modelPath || stemFromContext(context, 'part'));
  const outputBase = primaryOutputPath || buildDefaultOutputDir(options['out-dir']);
  const paths = createArtifactPaths(outputBase, stem, {
    geometry: '_geometry_intelligence.json',
    hotspots: '_manufacturing_hotspots.json',
  });
  if (primaryOutputPath) {
    paths.geometry = primaryOutputPath;
  }

  await writeValidatedJsonArtifact(paths.geometry, 'geometry_intelligence', result.geometry_intelligence, {
    command: 'analyze-part',
  });
  await writeValidatedJsonArtifact(paths.hotspots, 'manufacturing_hotspots', result.manufacturing_hotspots, {
    command: 'analyze-part',
  });
  const manifestPath = await writeCliManifest({
    command: 'analyze-part',
    primaryOutputPath: paths.geometry,
    artifacts: [
      createArtifactEntry('analysis.geometry.json', paths.geometry, { label: 'Geometry intelligence JSON' }),
      createArtifactEntry('analysis.hotspots.json', paths.hotspots, { label: 'Manufacturing hotspots JSON' }),
      ...(contextPath ? [createArtifactEntry('input.context', contextPath, { label: 'Input context JSON' })] : []),
      ...(modelPath ? [createArtifactEntry('input.model', modelPath, { label: 'Input model' })] : []),
    ],
  });

  console.log(`Geometry intelligence: ${paths.geometry}`);
  console.log(`Manufacturing hotspots: ${paths.hotspots}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Complexity score: ${result.geometry_intelligence.features?.complexity_score ?? 'n/a'}`);
  console.log(`  Hotspots: ${result.manufacturing_hotspots.hotspots?.length || 0}`);
}

async function cmdQualityLink(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const contextPath = resolveMaybe(options.context || positional[0]);
  const geometryPath = resolveMaybe(options.geometry);

  if (!contextPath || !geometryPath) {
    console.error('Error: quality-link requires --context and --geometry');
    console.error('  fcad quality-link --context output/part_context.json --geometry output/part_geometry_intelligence.json');
    process.exit(1);
  }

  const context = await readJsonFile(contextPath);
  const geometryIntelligence = await readJsonFile(geometryPath);
  const primaryOutputPath = normalizeJsonOutputPath(options.out);
  const stem = deriveArtifactStem(primaryOutputPath || contextPath || geometryPath, stemFromContext(context, 'part'));
  const geometryStem = deriveArtifactStem(geometryPath, stemFromContext(context, 'part'));
  const hotspotsPath = resolveMaybe(options.hotspots) || artifactPathFor(dirname(geometryPath), geometryStem, '_manufacturing_hotspots.json');
  const manufacturingHotspots = await readJsonIfExists(hotspotsPath) || { hotspots: [] };
  const generatedAt = nowIso();
  const sourceArtifactRefs = [
    buildSourceArtifactRef('engineering_context', contextPath, 'input', 'Input context JSON'),
    buildSourceArtifactRef('geometry_intelligence', geometryPath, 'input', 'Input geometry JSON'),
    hotspotsPath ? buildSourceArtifactRef('manufacturing_hotspots', hotspotsPath, 'input', 'Input hotspots JSON') : null,
  ].filter(Boolean);

  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/quality_link.py', {
    context,
    geometry_intelligence: geometryIntelligence,
    manufacturing_hotspots: manufacturingHotspots,
    generated_at: generatedAt,
    source_artifact_refs: sourceArtifactRefs,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });

  const outputBase = primaryOutputPath || buildDefaultOutputDir(options['out-dir'] || dirname(geometryPath));
  const paths = createArtifactPaths(outputBase, stem, {
    inspectionLinkage: '_inspection_linkage.json',
    inspectionOutliers: '_inspection_outliers.json',
    qualityLinkage: '_quality_linkage.json',
    qualityHotspots: '_quality_hotspots.json',
    reviewPriorities: '_review_priorities.json',
  });
  if (primaryOutputPath) {
    paths.reviewPriorities = primaryOutputPath;
  }

  await writeValidatedJsonArtifact(paths.inspectionLinkage, 'inspection_linkage', result.inspection_linkage, {
    command: 'quality-link',
  });
  await writeJsonFile(paths.inspectionOutliers, result.inspection_outliers);
  await writeValidatedJsonArtifact(paths.qualityLinkage, 'quality_linkage', result.quality_linkage, {
    command: 'quality-link',
  });
  await writeJsonFile(paths.qualityHotspots, result.quality_hotspots);
  await writeValidatedJsonArtifact(paths.reviewPriorities, 'review_priorities', result.review_priorities, {
    command: 'quality-link',
  });
  const manifestPath = await writeCliManifest({
    command: 'quality-link',
    primaryOutputPath: paths.reviewPriorities,
    artifacts: [
      createArtifactEntry('quality-link.inspection-linkage.json', paths.inspectionLinkage, { label: 'Inspection linkage JSON' }),
      createArtifactEntry('quality-link.inspection-outliers.json', paths.inspectionOutliers, { label: 'Inspection outliers JSON' }),
      createArtifactEntry('quality-link.quality-linkage.json', paths.qualityLinkage, { label: 'Quality linkage JSON' }),
      createArtifactEntry('quality-link.quality-hotspots.json', paths.qualityHotspots, { label: 'Quality hotspots JSON' }),
      createArtifactEntry('quality-link.review-priorities.json', paths.reviewPriorities, { label: 'Review priorities JSON' }),
      createArtifactEntry('input.context', contextPath, { label: 'Input context JSON' }),
      createArtifactEntry('input.geometry', geometryPath, { label: 'Input geometry JSON' }),
    ],
  });

  console.log(`Inspection linkage: ${paths.inspectionLinkage}`);
  console.log(`Inspection outliers: ${paths.inspectionOutliers}`);
  console.log(`Quality linkage: ${paths.qualityLinkage}`);
  console.log(`Quality hotspots: ${paths.qualityHotspots}`);
  console.log(`Review priorities: ${paths.reviewPriorities}`);
  console.log(`Manifest: ${manifestPath}`);
}

async function cmdReviewPack(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const contextPath = resolveMaybe(options.context || positional[0]);
  const geometryPath = resolveMaybe(options.geometry);
  const reviewPath = resolveMaybe(options.review);

  if (!contextPath || !geometryPath) {
    console.error('Error: review-pack requires --context and --geometry');
    process.exit(1);
  }

  const context = await readJsonFile(contextPath);
  const geometryIntelligence = await readJsonFile(geometryPath);
  const primaryOutputPath = normalizeJsonOutputPath(options.out);
  const stem = deriveArtifactStem(primaryOutputPath || contextPath || geometryPath, stemFromContext(context, 'part'));
  const outputDir = buildDefaultOutputDir(primaryOutputPath || options['out-dir'] || dirname(geometryPath));
  const geometryStem = deriveArtifactStem(geometryPath, stemFromContext(context, 'part'));
  const reviewStem = deriveArtifactStem(reviewPath || geometryPath, geometryStem);
  const sourceDir = dirname(reviewPath || geometryPath);

  const hotspotsPath = resolveMaybe(options.hotspots) || artifactPathFor(sourceDir, geometryStem, '_manufacturing_hotspots.json');
  const inspectionLinkagePath = resolveMaybe(options['inspection-linkage']) || artifactPathFor(sourceDir, reviewStem, '_inspection_linkage.json');
  const inspectionOutliersPath = resolveMaybe(options['inspection-outliers']) || artifactPathFor(sourceDir, reviewStem, '_inspection_outliers.json');
  const qualityLinkagePath = resolveMaybe(options['quality-linkage']) || artifactPathFor(sourceDir, reviewStem, '_quality_linkage.json');
  const qualityHotspotsPath = resolveMaybe(options['quality-hotspots']) || artifactPathFor(sourceDir, reviewStem, '_quality_hotspots.json');
  const reviewPrioritiesPath = reviewPath || artifactPathFor(sourceDir, reviewStem, '_review_priorities.json');

  const manufacturingHotspots = await readJsonIfExists(hotspotsPath) || { hotspots: [] };
  const inspectionLinkage = await readJsonIfExists(inspectionLinkagePath) || { records: [] };
  const inspectionOutliers = await readJsonIfExists(inspectionOutliersPath) || { records: [] };
  const qualityLinkage = await readJsonIfExists(qualityLinkagePath) || { records: [] };
  const qualityHotspots = await readJsonIfExists(qualityHotspotsPath) || { records: [] };
  const reviewPriorities = await readJsonIfExists(reviewPrioritiesPath) || { records: [], recommended_actions: [] };

  const outputJsonPath = primaryOutputPath || artifactPathFor(outputDir, stem, '_review_pack.json');
  const outputStem = deriveArtifactStem(outputJsonPath, stem);
  const outputMarkdownPath = siblingArtifactPath(outputJsonPath, '_review_pack.md');
  const outputPdfPath = siblingArtifactPath(outputJsonPath, '_review_pack.pdf');
  const generatedAt = nowIso();
  const sourceArtifactRefs = [
    buildSourceArtifactRef('engineering_context', contextPath, 'input', 'Input context JSON'),
    buildSourceArtifactRef('geometry_intelligence', geometryPath, 'input', 'Input geometry JSON'),
    hotspotsPath ? buildSourceArtifactRef('manufacturing_hotspots', hotspotsPath, 'input', 'Input hotspots JSON') : null,
    inspectionLinkagePath ? buildSourceArtifactRef('inspection_linkage', inspectionLinkagePath, 'intermediate', 'Inspection linkage JSON') : null,
    inspectionOutliersPath ? buildSourceArtifactRef('inspection_outliers', inspectionOutliersPath, 'intermediate', 'Inspection outliers JSON') : null,
    qualityLinkagePath ? buildSourceArtifactRef('quality_linkage', qualityLinkagePath, 'intermediate', 'Quality linkage JSON') : null,
    qualityHotspotsPath ? buildSourceArtifactRef('quality_hotspots', qualityHotspotsPath, 'intermediate', 'Quality hotspots JSON') : null,
    reviewPrioritiesPath ? buildSourceArtifactRef('review_priorities', reviewPrioritiesPath, 'input', 'Review priorities JSON') : null,
  ].filter(Boolean);

  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/reporting/review_pack.py', {
    context,
    geometry_intelligence: geometryIntelligence,
    manufacturing_hotspots: manufacturingHotspots,
    inspection_linkage: inspectionLinkage,
    inspection_outliers: inspectionOutliers,
    quality_linkage: qualityLinkage,
    quality_hotspots: qualityHotspots,
    review_priorities: reviewPriorities,
    output_dir: outputDir,
    output_stem: outputStem,
    output_json_path: outputJsonPath,
    output_markdown_path: outputMarkdownPath,
    output_pdf_path: outputPdfPath,
    generated_at: generatedAt,
    source_artifact_refs: sourceArtifactRefs,
  }, {
    timeout: 180_000,
    onStderr: (text) => process.stderr.write(text),
  });

  await writeValidatedJsonArtifact(outputJsonPath, 'review_pack', result.summary, {
    command: 'review-pack',
  });

  console.log(`Review pack JSON: ${result.artifacts.json}`);
  console.log(`Review pack Markdown: ${result.artifacts.markdown}`);
  console.log(`Review pack PDF: ${result.artifacts.pdf}`);
  const manifestPath = await writeCliManifest({
    command: 'review-pack',
    primaryOutputPath: result.artifacts.json,
    artifacts: [
      createArtifactEntry('review-pack.json', result.artifacts.json, { label: 'Review pack JSON' }),
      createArtifactEntry('review-pack.markdown', result.artifacts.markdown, { label: 'Review pack Markdown' }),
      createArtifactEntry('review-pack.pdf', result.artifacts.pdf, { label: 'Review pack PDF' }),
      createArtifactEntry('input.context', contextPath, { label: 'Input context JSON' }),
      createArtifactEntry('input.geometry', geometryPath, { label: 'Input geometry JSON' }),
    ],
  });
  console.log(`Manifest: ${manifestPath}`);
}

async function cmdReviewContext(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const contextPath = resolveMaybe(options.context);
  const modelPath = resolveMaybe(options.model || (!contextPath ? positional[0] : null));
  const bomPath = resolveMaybe(options.bom);
  const inspectionPath = resolveMaybe(options.inspection);
  const qualityPath = resolveMaybe(options.quality);
  const compareToPath = resolveMaybe(options['compare-to']);

  if (!modelPath && !contextPath) {
    console.error('Error: review-context requires --model <file> or --context <context.json>');
    console.error('  fcad review-context --model part.step [--bom bom.csv] [--inspection insp.csv] [--quality ncr.csv] --out output/review_pack.json');
    process.exit(1);
  }

  requireExistingInputFile('context', contextPath);
  requireExistingInputFile('model', modelPath);
  requireExistingInputFile('bom', bomPath);
  requireExistingInputFile('inspection', inspectionPath);
  requireExistingInputFile('quality', qualityPath);
  requireExistingInputFile('compare-to', compareToPath);

  const result = await runReviewContextPipeline({
    projectRoot: PROJECT_ROOT,
    contextPath,
    modelPath,
    bomPath,
    inspectionPath,
    qualityPath,
    compareToPath,
    outputPath: options.out || null,
    outDir: resolveMaybe(options['out-dir']) || null,
    partName: options['part-name'] || null,
    partId: options['part-id'] || null,
    revision: options.revision || null,
    material: options.material || null,
    manufacturingProcess: options.process || null,
    facility: options.facility || null,
    supplier: options.supplier || null,
    manufacturingNotes: options['manufacturing-notes'] || null,
    runPythonJsonScript,
    inspectModelIfAvailable,
    detectStepFeaturesIfAvailable,
  });

  for (const warning of runtimeDiagnosticsToWarnings(result.context?.metadata?.runtime_diagnostics || [])) {
    console.warn(`Warning: ${warning}`);
  }

  console.log(`Context JSON: ${result.artifacts.context}`);
  console.log(`Geometry intelligence: ${result.artifacts.geometry}`);
  console.log(`Review priorities: ${result.artifacts.reviewPriorities}`);
  console.log(`Review pack JSON: ${result.artifacts.reviewPackJson}`);
  console.log(`Review pack Markdown: ${result.artifacts.reviewPackMarkdown}`);
  console.log(`Review pack PDF: ${result.artifacts.reviewPackPdf}`);
  if (result.artifacts.revisionComparison) {
    console.log(`Revision comparison: ${result.artifacts.revisionComparison}`);
  }

  const manifestPath = await writeCliManifest({
    command: 'review-context',
    primaryOutputPath: result.artifacts.reviewPackJson,
    artifacts: [
      createArtifactEntry('context.json', result.artifacts.context, { label: 'Engineering context JSON' }),
      createArtifactEntry('ingest.log.json', result.artifacts.ingestLog, { label: 'Ingest log JSON' }),
      createArtifactEntry('analysis.geometry.json', result.artifacts.geometry, { label: 'Geometry intelligence JSON' }),
      createArtifactEntry('analysis.hotspots.json', result.artifacts.hotspots, { label: 'Manufacturing hotspots JSON' }),
      createArtifactEntry('quality-link.inspection-linkage.json', result.artifacts.inspectionLinkage, { label: 'Inspection linkage JSON' }),
      createArtifactEntry('quality-link.inspection-outliers.json', result.artifacts.inspectionOutliers, { label: 'Inspection outliers JSON' }),
      createArtifactEntry('quality-link.quality-linkage.json', result.artifacts.qualityLinkage, { label: 'Quality linkage JSON' }),
      createArtifactEntry('quality-link.quality-hotspots.json', result.artifacts.qualityHotspots, { label: 'Quality hotspots JSON' }),
      createArtifactEntry('quality-link.review-priorities.json', result.artifacts.reviewPriorities, { label: 'Review priorities JSON' }),
      createArtifactEntry('review-pack.json', result.artifacts.reviewPackJson, { label: 'Review pack JSON' }),
      createArtifactEntry('review-pack.markdown', result.artifacts.reviewPackMarkdown, { label: 'Review pack Markdown' }),
      createArtifactEntry('review-pack.pdf', result.artifacts.reviewPackPdf, { label: 'Review pack PDF' }),
      ...(result.artifacts.revisionComparison ? [createArtifactEntry('revision-comparison.json', result.artifacts.revisionComparison, { label: 'Revision comparison JSON' })] : []),
      ...(contextPath ? [createArtifactEntry('input.context', contextPath, { label: 'Input context JSON' })] : []),
      ...(modelPath ? [createArtifactEntry('input.model', modelPath, { label: 'Input model' })] : []),
      ...(bomPath ? [createArtifactEntry('input.bom', bomPath, { label: 'Input BOM CSV' })] : []),
      ...(inspectionPath ? [createArtifactEntry('input.inspection', inspectionPath, { label: 'Input inspection CSV' })] : []),
      ...(qualityPath ? [createArtifactEntry('input.quality', qualityPath, { label: 'Input quality CSV' })] : []),
      ...(compareToPath ? [createArtifactEntry('input.baseline', compareToPath, { label: 'Baseline review-pack JSON' })] : []),
    ],
    details: {
      workflow: [contextPath ? 'context-input' : 'ingest', 'analyze-part', 'quality-link', 'review-pack', ...(compareToPath ? ['compare-rev'] : [])],
    },
  });
  console.log(`Manifest: ${manifestPath}`);
}

async function cmdCompareRev(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const baselinePath = resolveMaybe(positional[0]);
  const candidatePath = resolveMaybe(positional[1]);

  if (!baselinePath || !candidatePath) {
    console.error('Error: compare-rev requires two JSON artifacts');
    console.error('  fcad compare-rev output/rev_a_review_pack.json output/rev_b_review_pack.json');
    process.exit(1);
  }

  const baseline = await loadCanonicalReviewPackInput([
    '--review-pack',
    baselinePath,
  ], 'compare-rev').then((input) => input.reviewPack);
  const candidate = await loadCanonicalReviewPackInput([
    '--review-pack',
    candidatePath,
  ], 'compare-rev').then((input) => input.reviewPack);
  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/reporting/revision_diff.py', {
    baseline,
    candidate,
    baseline_path: baselinePath,
    candidate_path: candidatePath,
  }, {
    onStderr: (text) => process.stderr.write(text),
  });
  const diff = result.comparison;
  const comparison = {
    artifact_type: 'revision_comparison',
    schema_version: D_ARTIFACT_SCHEMA_VERSION,
    analysis_version: D_ANALYSIS_VERSION,
    generated_at: nowIso(),
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
      buildSourceArtifactRef('review_pack', baselinePath, 'comparison_baseline', 'Baseline review pack JSON'),
      buildSourceArtifactRef('review_pack', candidatePath, 'comparison_candidate', 'Candidate review pack JSON'),
    ],
    ...diff,
  };

  const outputPath = normalizeJsonOutputPath(options.out)
    || artifactPathFor(buildDefaultOutputDir(options['out-dir']), deriveArtifactStem(candidatePath, 'revision'), '_revision_comparison.json');
  await writeValidatedJsonArtifact(outputPath, 'revision_comparison', comparison, {
    command: 'compare-rev',
  });
  const manifestPath = await writeCliManifest({
    command: 'compare-rev',
    primaryOutputPath: outputPath,
    artifacts: [
      createArtifactEntry('revision-comparison.json', outputPath, { label: 'Revision comparison JSON' }),
      createArtifactEntry('input.baseline', baselinePath, { label: 'Baseline JSON' }),
      createArtifactEntry('input.candidate', candidatePath, { label: 'Candidate JSON' }),
    ],
  });
  console.log(`Revision comparison: ${outputPath}`);
  console.log(`Manifest: ${manifestPath}`);
}

async function cmdValidate(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad validate configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  const config = await loadConfigForCli(absPath);
  const plan = config.drawing_plan;

  if (!plan || typeof plan !== 'object' || Object.keys(plan).length === 0) {
    console.error('Error: no drawing_plan found in config');
    console.error('Hint: validate expects a plan file (output/*_plan.toml), not a raw config.');
    console.error('  Generate one first: fcad draw configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const { spawn } = await import('node:child_process');

  const pyArgs = [
    join(PROJECT_ROOT, 'scripts', 'plan_validator.py'),
    '-',
    '--json',
  ];
  if (flags.includes('--strict')) pyArgs.push('--strict');

  const proc = spawn('python3', pyArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  let stdout = '';
  let stderr = '';
  let timeoutError = null;
  let hardKillTimer = null;
  proc.stdout.on('data', (c) => { stdout += c; });
  proc.stderr.on('data', (c) => { stderr += c; });

  const timer = setTimeout(() => {
    timeoutError = new Error(`plan_validator.py timed out after ${VALIDATE_TIMEOUT_MS}ms`);
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore kill race; close/error handlers will finalize.
    }
    hardKillTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process already exited.
        }
      }
    }, 5000);
    hardKillTimer.unref?.();
  }, VALIDATE_TIMEOUT_MS);

  proc.stdin.write(JSON.stringify({ drawing_plan: plan }));
  proc.stdin.end();

  let code;
  try {
    code = await new Promise((resolveCode, rejectCode) => {
      proc.on('close', resolveCode);
      proc.on('error', rejectCode);
    });
  } catch (error) {
    clearTimeout(timer);
    if (hardKillTimer) clearTimeout(hardKillTimer);
    console.error(`Failed to start validator: ${error.message}`);
    process.exit(1);
  }

  clearTimeout(timer);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  if (timeoutError) {
    console.error(timeoutError.message);
    process.exit(1);
  }

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    console.error('Failed to parse validator output:', stdout);
    if (stderr) console.error(stderr);
    process.exit(1);
  }

  // Pretty output
  if (result.valid) {
    console.log(`VALID (0 errors, ${result.warnings.length} warning(s))`);
  } else {
    console.log(`INVALID (${result.errors.length} error(s), ${result.warnings.length} warning(s))`);
  }
  for (const e of result.errors) {
    console.log(`  ERROR: ${e}`);
  }
  for (const w of result.warnings) {
    console.log(`  WARN:  ${w}`);
  }

  process.exit(Number.isInteger(code) ? code : 1);
}

async function cmdValidateConfig(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = resolveMaybe(positional[0]);

  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad validate-config configs/examples/ks_bracket.toml');
    process.exit(1);
  }

  const { parsed } = await readRawConfigFile(configPath);
  const validation = validateConfigDocument(parsed, { filepath: configPath });
  const strict = options.strict === true;
  const effectiveValid = validation.valid && (!strict || validation.summary.warnings.length === 0);

  if (options.json === true) {
    console.log(JSON.stringify({
      valid: effectiveValid,
      strict,
      counts: {
        errors: validation.summary.errors.length,
        warnings: validation.summary.warnings.length,
        changed_fields: validation.summary.changed_fields.length,
        deprecated_fields: validation.summary.deprecated_fields.length,
        manual_follow_up: validation.summary.manual_follow_up.length,
      },
      ...validation.summary,
    }, null, 2));
  } else {
    summarizeConfigValidation(configPath, validation, { strict });
  }

  process.exit(effectiveValid ? 0 : 1);
}

async function cmdMigrateConfig(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = resolveMaybe(positional[0]);

  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad migrate-config configs/examples/ks_bracket.toml --out output/ks_bracket.migrated.toml');
    process.exit(1);
  }

  const { parsed, format } = await readRawConfigFile(configPath);
  const migration = migrateConfigDocument(parsed, { filepath: configPath });
  if (migration.summary.errors.length > 0) {
    summarizeConfigValidation(configPath, { valid: false, summary: migration.summary });
    process.exit(1);
  }

  const outputPath = resolveMaybe(options.out) || defaultMigratedConfigPath(configPath, format);
  const outputFormat = extname(outputPath).toLowerCase() === '.json' ? 'json' : 'toml';
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serializeConfig(migration.config, outputFormat), 'utf8');

  console.log(`Migrated config written to: ${outputPath}`);
  summarizeConfigValidation(configPath, { valid: true, summary: migration.summary });
}

async function cmdServe(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const requestedPort = positional[0];

  if (requestedPort === 'help' || options.help === true || options.h === true) {
    console.log(SERVE_USAGE);
    return;
  }

  if (positional.length > 1) {
    console.error(`Error: unexpected extra positional arguments for serve: ${positional.slice(1).join(' ')}`);
    console.error(SERVE_USAGE);
    process.exit(1);
  }

  if (requestedPort !== undefined && !/^\d+$/.test(requestedPort)) {
    console.error(`Error: serve port must be a positive integer, received "${requestedPort}"`);
    console.error(SERVE_USAGE);
    process.exit(1);
  }

  const port = Number.parseInt(requestedPort || '3000', 10);

  if (options.legacy === true || options['legacy-viewer'] === true) {
    console.warn('Warning: fcad serve --legacy-viewer starts the legacy viewer shell.');
    const { startServer } = await import('../server.js');
    startServer(port);
    return;
  }

  const jobsDir = resolveMaybe(options['jobs-dir']) || resolve(PROJECT_ROOT, 'output', 'jobs');
  const { startLocalApiServer } = await import('../src/server/local-api-server.js');
  await startLocalApiServer({
    port,
    jobsDir,
    projectRoot: PROJECT_ROOT,
  });
}

async function cmdDesign(description) {
  if (!description || !description.trim()) {
    console.error('Error: description string required');
    console.error('  fcad design "shaft with two bearings"');
    process.exit(1);
  }

  console.log(`Generating design from: "${description}"`);
  const result = await runDesignTask({
    freecadRoot: PROJECT_ROOT,
    runScript,
    loadConfig: loadConfigForCli,
    mode: 'design',
    description: description.trim(),
  });

  if (!result.toml) {
    console.error('Error: Failed to generate valid TOML');
    process.exit(1);
  }

  // Derive filename from mechanism_type or description
  const rawName = result.report?.mechanism_type || description;
  const fileName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
  const safeFileName = fileName || 'generated_design';

  // Save to configs/generated/
  const generatedDir = resolve(import.meta.dirname, '..', 'configs', 'generated');
  mkdirSync(generatedDir, { recursive: true });
  const tomlPath = resolve(generatedDir, `${safeFileName}.toml`);
  if (!tomlPath.startsWith(`${generatedDir}${sep}`)) {
    console.error('Error: invalid output path');
    process.exit(1);
  }
  writeFileSync(tomlPath, result.toml, 'utf8');
  console.log(`TOML saved: ${tomlPath}`);

  if (result.report) {
    console.log(`\nDesign: ${result.report.mechanism_type || 'unknown'}`);
    console.log(`  DOF: ${result.report.dof || '?'}`);
    if (result.report.motion_chain) {
      console.log(`  Chain: ${result.report.motion_chain.join(' → ')}`);
    }
  }

  // Build the generated TOML
  console.log('\nBuilding model...');
  await cmdCreate(tomlPath);
  console.log('\nLegacy viewer: fcad serve --legacy-viewer → http://localhost:3000');
}

async function cmdDraw(rawArgs = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  // Parse: fcad draw <config> [--override <path>] [--flags...]
  const flags = [];
  const positional = [];
  let overridePath = null;
  let failUnderValue = null;
  let weightsPresetValue = null;
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--override') {
      overridePath = requireOptionValue('--override', rawArgs[i + 1], 'fcad draw <config> --override <path>');
      i += 1;
    } else if (arg === '--fail-under') {
      failUnderValue = requireOptionValue('--fail-under', rawArgs[i + 1], 'fcad draw <config> --fail-under <number>');
      i += 1;
      flags.push('--fail-under');
    } else if (arg.startsWith('--fail-under=')) {
      failUnderValue = requireOptionValue('--fail-under', arg.split('=')[1], 'fcad draw <config> --fail-under <number>');
      flags.push('--fail-under');
    } else if (arg === '--weights-preset') {
      weightsPresetValue = requireOptionValue('--weights-preset', rawArgs[i + 1], 'fcad draw <config> --weights-preset <preset>');
      i += 1;
      flags.push('--weights-preset');
    } else if (arg.startsWith('--weights-preset=')) {
      weightsPresetValue = requireOptionValue('--weights-preset', arg.split('=')[1], 'fcad draw <config> --weights-preset <preset>');
      flags.push('--weights-preset');
    } else if (arg.startsWith('--')) {
      flags.push(arg);
    } else {
      positional.push(arg);
    }
  }
  const configPath = positional[0];

  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad draw configs/examples/ks_flange.toml');
    process.exit(1);
  }
  const absPath = resolveMaybe(configPath);
  let configDocument = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    const result = await runDrawPipeline({
      projectRoot: PROJECT_ROOT,
      configPath: absPath,
      flags,
      overridePath,
      failUnderValue,
      weightsPresetValue,
      loadConfig: loadConfigForCli,
      deepMerge,
      generateDrawing,
      runScript: runWithCliStderr,
      onInfo: (message) => console.log(message),
      onError: (message) => console.error(message),
    });
    const svgPath = result?.drawing_paths?.find((entry) => entry.format === 'svg')?.path
      || result?.svg_path
      || result?.drawing_path
      || configDocument.config.export?.directory
      || null;
    const manifestPath = await writeCliManifest({
      command: 'draw',
      configPath: absPath,
      configSummary: configDocument.summary,
      config: configDocument.config,
      primaryOutputPath: svgPath,
      outputDir: configDocument.config.export?.directory || null,
      artifacts: collectDrawManifestArtifacts(result),
    });
    await emitOutputManifestSafe({
      command: 'draw',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: svgPath,
      outputDir: configDocument.config.export?.directory || null,
      outputs: (result.drawing_paths || [])
        .map((entry) => createOutputEntry(`drawing.${String(entry.format).toLowerCase()}`, entry.path))
        .filter(Boolean),
      linkedArtifacts: buildDrawLinkedArtifactsFromSvg(svgPath),
      warnings: configDocument.summary?.warnings || [],
    });
    console.log(`Manifest: ${manifestPath}`);
    return result;
  } catch (error) {
    const predicted = buildExpectedDrawArtifacts(configDocument?.config || {});
    await emitOutputManifestSafe({
      command: 'draw',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: predicted.primaryOutputPath,
      outputDir: configDocument?.config?.export?.directory || null,
      outputs: predicted.outputs,
      linkedArtifacts: predicted.linkedArtifacts,
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    throw error;
  }
}

async function cmdSweep(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = resolveMaybe(positional[0]);
  const matrixPath = resolveMaybe(options.matrix);
  const outputDir = resolveMaybe(options['out-dir']);

  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad sweep configs/examples/ks_bracket.toml --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml');
    process.exit(1);
  }

  if (!matrixPath) {
    console.error('Error: sweep requires --matrix <file>');
    console.error('  fcad sweep configs/examples/ks_bracket.toml --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml');
    process.exit(1);
  }

  requireExistingInputFile('config', configPath);
  requireExistingInputFile('matrix', matrixPath);

  const result = await runSweep({
    projectRoot: PROJECT_ROOT,
    configPath,
    matrixPath,
    outputDir,
    loadConfig: loadConfigForCli,
    onInfo: (message) => console.log(message),
    onStderr: (text) => process.stderr.write(text),
  });

  console.log(`Sweep output directory: ${result.output_dir}`);
  console.log(`Sweep summary JSON: ${result.summary_json}`);
  console.log(`Sweep summary CSV: ${result.summary_csv}`);
  console.log(`Sweep manifest: ${result.manifest_path}`);
  console.log(`  Successful variants: ${result.summary.successful_variants}`);
  console.log(`  Failed variants: ${result.summary.failed_variants}`);
  if (result.summary.best_by_min_mass) {
    console.log(`  Min mass: ${result.summary.best_by_min_mass.variant_id} (${result.summary.best_by_min_mass.value} kg)`);
  }
  if (result.summary.best_by_min_cost) {
    console.log(`  Min cost: ${result.summary.best_by_min_cost.variant_id} (${result.summary.best_by_min_cost.value})`);
  }
  if (result.summary.stress_threshold) {
    console.log(
      `  Stress threshold ${result.summary.stress_threshold.threshold_mpa} MPa: `
      + `${result.summary.stress_threshold.pass_count} pass / ${result.summary.stress_threshold.fail_count} fail`
    );
  }
}

async function cmdCreate(configPath) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  console.log(`Loading config: ${absPath}`);

  let configDocument = null;
  let config = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    config = configDocument.config;
    console.log(`Creating model: ${config.name || 'unnamed'}`);
    console.log(`  Shapes: ${config.shapes?.length || 0}`);
    console.log(`  Operations: ${config.operations?.length || 0}`);

    const result = await createModel({
      freecadRoot: PROJECT_ROOT,
      runScript: (script, input, opts = {}) => runScript(script, input, {
        ...opts,
        onStderr: (text) => process.stderr.write(text),
      }),
      loadConfig: loadConfigForCli,
      config,
    });

    if (!result.success) {
      throw new Error(result.error || 'Model creation failed');
    }

    const firstExportPath = result.exports?.[0]?.path || config.export?.directory || null;
    const manifestPath = await writeCliManifest({
      command: 'create',
      configPath: absPath,
      configSummary: configDocument.summary,
      config,
      primaryOutputPath: firstExportPath,
      outputDir: config.export?.directory || null,
      artifacts: createExportArtifactEntries(result.exports, 'model'),
    });
    await emitOutputManifestSafe({
      command: 'create',
      commandArgs: [configPath],
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: result.exports?.[0]?.path || null,
      outputDir: config.export?.directory || null,
      outputs: createOutputEntriesFromExports(result.exports, 'model'),
      warnings: configDocument.summary?.warnings || [],
      status: resolveOutputManifestStatus({
        warnings: configDocument.summary?.warnings || [],
        errors: [],
      }),
    });
    console.log('\nModel created successfully!');
    console.log(`  Volume: ${result.model.volume} mm³`);
    console.log(`  Faces: ${result.model.faces}, Edges: ${result.model.edges}`);
    const bb = result.model.bounding_box;
    console.log(`  Bounding box: ${bb.size[0]} × ${bb.size[1]} × ${bb.size[2]} mm`);
    if (result.assembly) {
      console.log(`  Assembly: ${result.assembly.part_count} parts`);
      for (const [name, meta] of Object.entries(result.assembly.parts)) {
        console.log(`    ${name}: vol=${meta.volume} mm³, faces=${meta.faces}`);
      }
    }
    if (result.exports?.length > 0) {
      console.log('  Exports:');
      for (const exp of result.exports) {
        console.log(`    ${exp.format}: ${exp.path} (${exp.size_bytes} bytes)`);
      }
    }
    console.log(`  Manifest: ${manifestPath}`);
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'create',
      commandArgs: [configPath],
      repoContext,
      startedAt,
      inputPath: absPath,
      outputDir: config?.export?.directory || null,
      outputs: buildExpectedModelOutputs(config),
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

async function cmdFem(rawArgs = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = positional[0];
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Loading config: ${absPath}`);

  let configDocument = null;
  let config = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    config = configDocument.config;
    const analysisType = config.fem?.analysis_type || 'static';
    console.log(`FEM Analysis: ${config.name || 'unnamed'} (${analysisType})`);
    console.log(`  Shapes: ${config.shapes?.length || 0}`);
    console.log(`  Constraints: ${config.fem?.constraints?.length || 0}`);

    const result = await runFemService({
      freecadRoot: PROJECT_ROOT,
      runScript: runWithCliStderr,
      loadConfig: loadConfigForCli,
      configPath: absPath,
      config,
      fem: config.fem || {},
    });

    if (!result.success) {
      throw new Error(result.error || 'FEM analysis failed');
    }

    const fem = result.fem;
    const mat = fem.material;
    console.log(`\nFEM Analysis: ${result.model.name} (${fem.analysis_type})`);
    console.log(`  Material: ${mat.name} (E=${mat.youngs_modulus} MPa)`);
    console.log(`  Mesh: ${fem.mesh.nodes.toLocaleString()} nodes, ${fem.mesh.elements.toLocaleString()} elements (${fem.mesh.element_type})`);
    console.log('');
    console.log('  Results:');
    console.log(`    Max displacement: ${fem.results.displacement.max.toFixed(4)} mm (Node ${fem.results.displacement.max_node})`);
    console.log(`    Max von Mises stress: ${fem.results.von_mises.max.toFixed(2)} MPa (Node ${fem.results.von_mises.max_node})`);
    console.log(`    Min von Mises stress: ${fem.results.von_mises.min.toFixed(2)} MPa`);
    console.log(`    Safety factor: ${fem.results.safety_factor} (yield=${mat.yield_strength} MPa)`);

    if (result.exports?.length > 0) {
      console.log('  Exports:');
      for (const exp of result.exports) {
        console.log(`    ${exp.format}: ${exp.path} (${exp.size_bytes} bytes)`);
      }
    }

    const emittedManifestPath = await writeStdoutCommandManifest({
      manifestPath,
      command: 'fem',
      configPath: absPath,
      configSummary: configDocument.summary,
      config,
      artifacts: createAnalysisExportEntries(result, 'analysis.fem'),
      details: {
        analysis_type: fem.analysis_type || null,
        export_count: result.exports?.length || 0,
        safety_factor: fem.results?.safety_factor ?? null,
      },
    });
    await emitOutputManifestSafe({
      command: 'fem',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: result.document_path || result.exports?.[0]?.path || null,
      outputDir: config.export?.directory || null,
      outputs: [
        ...(result.document_path ? [createOutputEntry('analysis.fem.fcstd', result.document_path)] : []),
        ...createOutputEntriesFromExports(result.exports, 'analysis.fem'),
      ],
      warnings: configDocument.summary?.warnings || [],
    });
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'fem',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputDir: config?.export?.directory || null,
      outputs: buildExpectedFemOutputs(config),
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

async function cmdTolerance(rawArgs = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = positional[0];
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad tolerance configs/examples/ptu_assembly_mates.toml');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Loading config: ${absPath}`);

  let configDocument = null;
  let config = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    config = configDocument.config;

    config.tolerance = config.tolerance || {};
    if (options.recommend) config.tolerance.recommend = true;
    if (options.csv) config.tolerance.csv = true;
    if (options['monte-carlo']) config.tolerance.monte_carlo = true;

    const modelName = config.name || 'unnamed';
    console.log(`Tolerance Analysis: ${modelName}`);

    const result = await runToleranceService({
      freecadRoot: PROJECT_ROOT,
      runScript: runWithCliStderr,
      loadConfig: loadConfigForCli,
      config,
      standard: config.standard,
      monteCarlo: options['monte-carlo'] ? true : undefined,
    });

    if (!result.success) {
      throw new Error(result.error || 'Tolerance analysis failed');
    }

    const pairs = result.pairs || [];
    const stack = result.stack_up || {};

    if (pairs.length === 0) {
      console.log('\nNo tolerance pairs found. Add coaxial mates or [tolerance_pairs] to config.');
    } else {
      console.log(`\n=== Tolerance Analysis Report ===\n`);
      for (const pr of pairs) {
        console.log(`Pair: ${pr.shaft_part} (${pr.shaft_spec}) ↔ ${pr.bore_part} (${pr.hole_spec})`);
        console.log(`  Nominal Ø${pr.nominal_d} mm, Spec: ${pr.spec}`);
        console.log(`  Bore:  ${pr.bore_range}`);
        console.log(`  Shaft: ${pr.shaft_range}`);
        console.log(`  Fit: ${pr.fit_type}, Clearance: ${pr.clearance_min.toFixed(3)} ~ ${pr.clearance_max.toFixed(3)} mm`);
        console.log(`  Status: ${pr.status}`);
        console.log('');
      }

      if (stack.chain_length > 0) {
        console.log(`--- Stack-up Analysis (${stack.chain_length} pairs) ---`);
        console.log(`  Worst case: ±${(stack.worst_case_mm / 2).toFixed(4)} mm`);
        console.log(`  RSS (3σ):   ±${(stack.rss_3sigma_mm / 2).toFixed(4)} mm`);
        console.log(`  Mean gap:   ${stack.mean_gap_mm.toFixed(4)} mm`);
        console.log(`  Assembly success rate: ${stack.success_rate_pct}%`);
      }

      const mc = result.monte_carlo;
      if (mc) {
        console.log(`\n--- Monte Carlo Simulation (N=${mc.num_samples}, ${mc.distribution}) ---`);
        console.log(`  Mean gap:   ${mc.mean_mm.toFixed(4)} mm  (σ=${mc.std_mm.toFixed(4)})`);
        console.log(`  Cpk:        ${mc.cpk}`);
        console.log(`  Fail rate:  ${mc.fail_rate_pct}%`);
        const p = mc.percentiles;
        console.log(`  Percentiles: P0.1=${p.p0_1.toFixed(4)} | P1=${p.p1.toFixed(4)} | P50=${p.p50.toFixed(4)} | P99=${p.p99.toFixed(4)} | P99.9=${p.p99_9.toFixed(4)}`);
        const hist = mc.histogram;
        const maxCount = Math.max(...hist.counts);
        console.log(`  Histogram (gap mm):`);
        for (let i = 0; i < hist.counts.length; i++) {
          const lo = hist.edges[i].toFixed(3);
          const barLen = Math.round((hist.counts[i] / maxCount) * 30);
          const bar = '█'.repeat(barLen);
          console.log(`    ${lo.padStart(7)} |${bar} ${hist.counts[i]}`);
        }
      }
    }

    if (result.exports?.length > 0) {
      console.log('\nExports:');
      for (const exp of result.exports) {
        console.log(`  ${exp.format.toUpperCase()}: ${exp.path} (${exp.size_bytes} bytes)`);
      }
    }

    const emittedManifestPath = await writeStdoutCommandManifest({
      manifestPath,
      command: 'tolerance',
      configPath: absPath,
      configSummary: configDocument.summary,
      config,
      artifacts: createAnalysisExportEntries(result, 'analysis.tolerance'),
      details: {
        pair_count: result.pairs?.length || 0,
        stack_up_pairs: result.stack_up?.chain_length ?? 0,
        includes_monte_carlo: Boolean(result.monte_carlo),
        export_count: result.exports?.length || 0,
      },
    });
    await emitOutputManifestSafe({
      command: 'tolerance',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: result.exports?.[0]?.path || null,
      outputDir: config.export?.directory || null,
      outputs: createOutputEntriesFromExports(result.exports, 'analysis.tolerance'),
      warnings: configDocument.summary?.warnings || [],
    });
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'tolerance',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputDir: config?.export?.directory || null,
      outputs: buildExpectedToleranceOutputs(config),
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

async function cmdDfm(rawArgs = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  const { positional, options } = parseCliArgs(rawArgs);
  let processValue = options.process === true
    ? requireOptionValue('--process', options.process, 'Allowed: machining|casting|sheet_metal|3d_printing')
    : (options.process || null);
  const configPath = positional[0];
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad dfm configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Loading config: ${absPath}`);

  let configDocument = null;
  let config = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    config = configDocument.config;

    config.manufacturing = config.manufacturing || {};
    if (processValue) {
      if (!VALID_DFM_PROCESSES.has(processValue)) {
        console.error(`Error: invalid --process '${processValue}'`);
        console.error('  Allowed: machining|casting|sheet_metal|3d_printing');
        process.exit(1);
      }
      config.manufacturing.process = processValue;
    }

    const strict = Boolean(options.strict);
    const modelName = config.name || 'unnamed';
    console.log(`DFM Analysis: ${modelName} (process: ${config.manufacturing.process || 'machining'})\n`);

    const result = await runDfm({
      freecadRoot: PROJECT_ROOT,
      runScript: runWithCliStderr,
      loadConfig: loadConfigForCli,
      config,
      process: config.manufacturing.process || 'machining',
      standard: config.standard,
    });

    if (!result.success) {
      throw new Error(result.error || 'DFM analysis failed');
    }

    const { checks, summary, score } = result;

    console.log(`=== DFM Report (${result.process}) ===\n`);

    if (checks.length === 0) {
      console.log('  No issues found — design is manufacturing-ready.\n');
    } else {
      for (const c of checks) {
        const icon = c.severity === 'error' ? '\x1b[31mERROR\x1b[0m'
          : c.severity === 'warning' ? '\x1b[33mWARN \x1b[0m'
          : '\x1b[36mINFO \x1b[0m';
        console.log(`  [${icon}] ${c.code}: ${c.message}`);
        if (c.recommendation) {
          console.log(`         → ${c.recommendation}`);
        }
      }
      console.log('');
    }

    console.log(`Summary: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`);
    console.log(`DFM Score: ${score}/100`);

    const emittedManifestPath = await writeStdoutCommandManifest({
      manifestPath,
      command: 'dfm',
      status: strict && summary.warnings > 0
        ? 'failed'
        : summary.errors > 0
          ? 'failed'
          : 'succeeded',
      configPath: absPath,
      configSummary: configDocument.summary,
      config,
      details: {
        process: result.process,
        score,
        summary,
        check_count: checks.length,
        strict_mode: strict,
      },
    });
    const outputWarnings = [
      ...(configDocument.summary?.warnings || []),
      ...(summary.warnings > 0 ? [`DFM produced ${summary.warnings} warning(s).`] : []),
    ];
    const outputErrors = [];
    let outputStatus = 'pass';
    if (strict && summary.warnings > 0) {
      outputStatus = 'fail';
      outputErrors.push('--strict: warnings treated as errors');
    } else if (summary.errors > 0) {
      outputStatus = 'fail';
      outputErrors.push(`DFM reported ${summary.errors} error(s).`);
    } else if (outputWarnings.length > 0) {
      outputStatus = 'warning';
    }
    await emitOutputManifestSafe({
      command: 'dfm',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputs: [],
      warnings: outputWarnings,
      errors: outputErrors,
      status: outputStatus,
    });
    if (emittedManifestPath) {
      console.log(`Manifest: ${emittedManifestPath}`);
    }

    if (strict && summary.warnings > 0) {
      console.error('\n--strict: warnings treated as errors');
      process.exit(1);
    }
    if (summary.errors > 0) {
      process.exit(1);
    }
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'dfm',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputs: [],
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

async function cmdReport(configPath, flags = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad report configs/examples/ptu_assembly_mates.toml');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  console.log(`Loading config: ${absPath}`);
  let configDocument = null;
  let config = null;
  try {
    configDocument = await loadConfigDocumentForCli(absPath);
    config = configDocument.config;
    const includeTolerance = !flags.includes('--no-tolerance');
    const includeFem = flags.includes('--fem');
    const includeMC = flags.includes('--monte-carlo');
    const includeDfm = flags.includes('--dfm');
    const analysisResults = {};

    if (includeTolerance && config.assembly) {
      console.log('Running tolerance analysis...');
      config.tolerance = config.tolerance || {};
      if (includeMC) config.tolerance.monte_carlo = true;

      const tolResult = await runToleranceService({
        freecadRoot: PROJECT_ROOT,
        runScript: runWithCliStderr,
        loadConfig: loadConfigForCli,
        config,
        standard: config.standard,
        monteCarlo: includeMC ? true : undefined,
      });
      if (tolResult.success) {
        analysisResults.tolerance = tolResult;
        console.log(`  ${tolResult.pairs?.length || 0} tolerance pair(s) analyzed`);
      }
    }

    if (includeDfm) {
      console.log('Running DFM analysis...');
      const dfmResult = await runDfm({
        freecadRoot: PROJECT_ROOT,
        runScript: runWithCliStderr,
        loadConfig: loadConfigForCli,
        config,
        process: config.manufacturing?.process || 'machining',
        standard: config.standard,
      });
      if (dfmResult.success) {
        analysisResults.dfm = dfmResult;
        console.log(`  DFM score: ${dfmResult.score}/100 (${dfmResult.summary?.errors || 0} errors, ${dfmResult.summary?.warnings || 0} warnings)`);
      }
    }

    if (includeFem) {
      console.log('Running FEM analysis...');
      const femResult = await runFemService({
        freecadRoot: PROJECT_ROOT,
        runScript: runWithCliStderr,
        loadConfig: loadConfigForCli,
        configPath: absPath,
        config,
        fem: config.fem || {},
      });
      if (femResult.success) {
        analysisResults.fem = femResult;
        console.log(`  FEM complete: safety factor = ${femResult.results?.safety_factor || '?'}`);
      }
    }

    console.log('Generating PDF report...');
    const result = await generateReport({
      freecadRoot: PROJECT_ROOT,
      runScript: runWithCliStderr,
      loadConfig: loadConfigForCli,
      configPath: absPath,
      config,
      includeDrawing: false,
      includeDfm,
      includeTolerance,
      includeCost: false,
      analysisResults,
    });

    if (!result.success) {
      throw new Error(result.error || 'Engineering report generation failed');
    }

    const manifestPath = await writeCliManifest({
      command: 'report',
      configPath: absPath,
      configSummary: configDocument.summary,
      config,
      primaryOutputPath: result.path,
      artifacts: [
        createArtifactEntry('report.pdf', result.path, { label: 'Engineering report PDF' }),
      ],
      details: {
        include_tolerance: includeTolerance,
        include_fem: includeFem,
        include_dfm: includeDfm,
        include_monte_carlo: includeMC,
      },
    });
    await emitOutputManifestSafe({
      command: 'report',
      commandArgs: [configPath, ...flags],
      repoContext,
      startedAt,
      inputPath: absPath,
      primaryOutputPath: result.path,
      outputs: [
        createOutputEntry('report.pdf', result.path),
      ],
      linkedArtifacts: {
        report_pdf: result.path,
      },
      warnings: configDocument.summary?.warnings || [],
    });
    console.log(`\n=== Engineering Report Generated ===`);
    console.log(`  PDF: ${result.path} (${result.size_bytes} bytes)`);
    console.log(`  Manifest: ${manifestPath}`);
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'report',
      commandArgs: [configPath, ...flags],
      repoContext,
      startedAt,
      inputPath: absPath,
      outputs: buildExpectedReportOutputs(config || {}),
      linkedArtifacts: {
        report_pdf: buildExpectedReportOutputs(config || {})[0]?.path || null,
      },
      warnings: configDocument?.summary?.warnings || [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

async function cmdInspect(rawArgs = []) {
  const repoContext = collectRepoContext(PROJECT_ROOT);
  const startedAt = nowIso();
  const { positional, options } = parseCliArgs(rawArgs);
  const filePath = positional[0];
  if (!filePath) {
    console.error('Error: model file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(filePath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Inspecting: ${absPath}`);

  try {
    const result = await inspectModel({
      runScript: (script, input, opts = {}) => runScript(script, input, {
        ...opts,
        onStderr: (text) => process.stderr.write(text),
      }),
      filePath: absPath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Model inspection failed');
    }

    console.log('\nModel metadata:');
    const m = result.model;
    console.log(`  Format: ${result.format}`);
    if (m.volume !== undefined) console.log(`  Volume: ${m.volume} mm³`);
    if (m.area !== undefined) console.log(`  Area: ${m.area} mm²`);
    if (m.faces !== undefined) console.log(`  Faces: ${m.faces}, Edges: ${m.edges}, Vertices: ${m.vertices}`);
    if (m.bounding_box) {
      const bb = m.bounding_box;
      console.log(`  Bounding box: ${JSON.stringify(bb.min)} → ${JSON.stringify(bb.max)}`);
    }

    const emittedManifestPath = await writeStdoutCommandManifest({
      manifestPath,
      command: 'inspect',
      inputPath: absPath,
      inputType: 'model.input',
      inputLabel: 'Inspected model input',
      details: {
        format: result.format || null,
        model: {
          volume: m.volume ?? null,
          area: m.area ?? null,
          faces: m.faces ?? null,
          edges: m.edges ?? null,
          vertices: m.vertices ?? null,
          bounding_box: m.bounding_box ?? null,
        },
      },
    });
    await emitOutputManifestSafe({
      command: 'inspect',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputs: [],
      warnings: [],
      status: 'pass',
    });
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
    return result;
  } catch (error) {
    await emitOutputManifestSafe({
      command: 'inspect',
      commandArgs: rawArgs,
      repoContext,
      startedAt,
      inputPath: absPath,
      outputs: [],
      errors: [error.message],
      status: 'fail',
    });
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof ArtifactSchemaValidationError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

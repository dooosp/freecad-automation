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
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  readJsonIfExists,
  runPythonJsonScript,
  writeValidatedJsonArtifact,
  writeJsonFile,
} from '../lib/context-loader.js';
import {
  ArtifactSchemaValidationError,
  buildSourceArtifactRef,
  D_ANALYSIS_VERSION,
  D_ARTIFACT_SCHEMA_VERSION,
} from '../lib/d-artifact-schema.js';
import { runScript } from '../lib/runner.js';
import { hasFreeCADRuntime, isWindowsAbsolutePath, normalizeLocalPath } from '../lib/paths.js';
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
  runStandardDocsWorkflow,
  writeReadinessArtifacts,
} from '../src/api/manufacturing.js';
import { createModel, inspectModel } from '../src/api/model.js';
import { createReportService } from '../src/api/report.js';
import { runSweep } from '../src/services/sweep/sweep-service.js';
import { loadRuleProfile, summarizeRuleProfile } from '../src/services/config/rule-profile-service.js';

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

const USAGE = `
fcad | mfg-agent - FreeCAD-backed automation pipeline

FreeCAD-backed CLI for CAD, TechDraw, inspection, FEM, tolerance, and reporting,
plus a plain-Python/Node manufacturing-review layer.

Run this first on a new machine or before troubleshooting runtime-backed commands:
  fcad check-runtime

Usage:
  Diagnostics:
    fcad check-runtime [--json]    Show searched paths, selected runtime, detected versions, command coverage, and remediation

  FreeCAD-backed commands:
    fcad create <config.toml|json>                              Generate parametric model output
    fcad draw <config.toml|json>                                Generate TechDraw SVG output
    fcad inspect <model.step|fcstd> [--manifest-out <path>]     Inspect model metadata
    fcad fem <config.toml|json> [--manifest-out <path>]         Run FEM structural analysis
    fcad tolerance <config.toml> [--manifest-out <path>]        Tolerance analysis for assembly configs
    fcad report <config.toml>                                   Generate engineering PDF report

  Plain-Python / non-FreeCAD commands:
    fcad dfm <config.toml|json> [--manifest-out <path>]  Run DFM manufacturability analysis
    fcad review <config.toml|json>
    fcad process-plan <config.toml|json>
    fcad line-plan <config.toml|json>
    fcad quality-risk <config.toml|json>
    fcad investment-review <config.toml|json>
    fcad readiness-report <config.toml|json>
    fcad stabilization-review <config.toml|json> --runtime <runtime.json>
    fcad generate-standard-docs <config.toml|json> [--out-dir <dir>]
    fcad ingest --model <file> [--bom bom.csv] [--inspection insp.csv] [--quality ncr.csv] --out <context.json>
    fcad quality-link --context <context.json> --geometry <geometry.json>
    fcad review-pack --context <context.json> --geometry <geometry.json>
    fcad compare-rev <baseline.json> <candidate.json>
    fcad validate <plan.toml|json>   Validate drawing_plan artifacts
    fcad validate-config <config.toml|json>
    fcad migrate-config <config.toml|json> [--out <file>]
    fcad serve [port] [--jobs-dir <dir>] [--legacy-viewer]

  Mixed / conditional commands:
    fcad analyze-part <context.json|model.step>
    fcad design "description"
    fcad sweep <config.toml|json> --matrix <file> [--out-dir <dir>]
    fcad help

Options:
  Shared workflow options:
    --profile <name>             Shop profile under configs/profiles
    --runtime <path>             Runtime JSON for line stabilization / launch review
    --batch <n>                  Batch size assumption for cost/readiness workflow
    --site <name>                Site label override for summaries
    --process <name>             Override manufacturing process when supported, including dfm
    --material <name>            Override material for cost/readiness workflow
    --context <path>             Engineering context JSON
    --geometry <path>            Geometry intelligence JSON
    --hotspots <path>            Manufacturing hotspot JSON
    --out <path>                 Primary output JSON path; sibling artifacts share its stem
    --out-dir <dir>              Output directory when using default artifact names

  Workflow-specific options:
    --matrix <path>              Sweep definition TOML/JSON for fcad sweep
    --override <path>            Merge override TOML/JSON on top of base config (with draw)
    --bom                        Export BOM as separate CSV file (with draw)
    --raw                        Skip SVG post-processing (with draw)
    --no-score                   Skip QA scoring (with draw)
    --fail-under N               Fail if QA score < N (with draw)
    --weights-preset P           QA weight profile: default|auto|flange|shaft|...
    --strict                     Treat warnings as errors (with validate/dfm)
    --manifest-out <path>        Write a provenance manifest for stdout-oriented commands such as inspect/fem/tolerance/dfm
    --recommend                  Auto-recommend fit specs (with tolerance)
    --csv                        Export tolerance report as CSV (with tolerance)
    --monte-carlo                Include Monte Carlo simulation (with tolerance/report)
    --dfm                        Include DFM analysis in report
    --fem                        Include FEM analysis in report
    --no-tolerance               Skip tolerance analysis in report
    --tolerance                  Include tolerance analysis in report (default)

Examples:
  fcad check-runtime
  fcad check-runtime --json
  fcad create configs/examples/ks_bracket.toml
  fcad draw configs/examples/ks_bracket.toml --bom
  fcad inspect output/ks_bracket.step --manifest-out output/ks_bracket_inspect_manifest.json
  fcad review configs/examples/infotainment_display_bracket.toml
  fcad readiness-report configs/examples/pcb_mount_plate.toml --out output/pcb_mount_plate_readiness.json
  fcad stabilization-review configs/examples/infotainment_display_bracket.toml --runtime data/runtime_examples/display_bracket_runtime.json --profile configs/profiles/site_korea_ulsan.toml
  fcad generate-standard-docs configs/examples/controller_housing_eol.toml --out-dir output/controller_housing_standard_docs
  fcad sweep configs/examples/ks_bracket.toml --matrix configs/examples/sweeps/ks_bracket_geometry_sweep.toml

  Notes:
  check-runtime is the central installation and troubleshooting entrypoint for runtime-backed commands.
  analyze-part can run without FreeCAD when the supplied context already includes model metadata.
  sweep stays within the existing create/cost/fem/report service wrappers; it does not perform optimization.
  report remains FreeCAD-backed today, even when macOS falls back from freecadcmd to the bundled FreeCAD Python.
  Windows native, WSL -> Windows FreeCAD, and Linux runtime execution are compatibility paths, not equal-maturity claims.
`.trim();

const SERVE_USAGE = `
fcad serve - local API, studio shell, and legacy viewer entrypoint

Usage:
  fcad serve [port] [--jobs-dir <dir>]
  fcad serve [port] --legacy-viewer
  fcad serve --help

Modes:
  default            Starts the local HTTP API for /health and /jobs and serves the studio shell at / and /studio
  --legacy-viewer    Starts the older browser demo shell from server.js

Notes:
  Browser requests to http://127.0.0.1:<port>/ land in the future-facing studio shell.
  Open http://127.0.0.1:<port>/api for the local API info page.
  Open http://127.0.0.1:<port>/studio for the direct studio route.
  Open http://127.0.0.1:<port>/health to verify the API.
  Use fcad serve --legacy-viewer or npm run serve:legacy for the browser demo.
`.trim();

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
    console.warn(`Warning: model inspection skipped: ${error.message}`);
    return null;
  }
}

async function detectStepFeaturesIfAvailable(modelPath) {
  if (!modelPath || !hasFreeCADRuntime()) return null;
  const ext = modelPath.toLowerCase().split('.').pop();
  if (!['step', 'stp'].includes(ext)) return null;
  try {
    return await runWithCliStderr('step_feature_detector.py', { file: modelPath });
  } catch (error) {
    console.warn(`Warning: STEP feature detection skipped: ${error.message}`);
    return null;
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
  } else if (command === 'readiness-report') {
    await cmdReadinessReport(args);
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

async function runProductionReadiness(rawArgs = [], { persistArtifacts = true } = {}) {
  const { configPath, options, outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const configDocument = await loadConfigDocumentForCli(configPath);
  const config = configDocument.config;
  const runtimeData = await loadRuntimeData(options);
  const report = await runReadinessReportWorkflow({
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
  const jsonPath = await writeJsonFile(targetPath, payload);
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

async function cmdReadinessReport(rawArgs = []) {
  const {
    report,
    artifacts,
    config,
    configPath,
    configSummary,
    profileName,
  } = await runProductionReadiness(rawArgs);
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
  });
  console.log(`Readiness report JSON: ${artifacts.json}`);
  console.log(`Readiness report Markdown: ${artifacts.markdown}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`  Status: ${report.readiness_summary.status}`);
  console.log(`  Score: ${report.readiness_summary.score}`);
}

async function cmdStabilizationReview(rawArgs = []) {
  const { options, outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  if (!options.runtime) {
    console.error('Error: stabilization-review requires --runtime <runtime.json>');
    process.exit(1);
  }

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
      onStderr: (text) => process.stderr.write(text),
    },
  });

  console.log(`Standard docs output: ${result.out_dir}`);
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
    artifacts: Object.entries(result.artifacts).map(([filename, filePath]) => createArtifactEntry(
      filename === 'manifest' ? 'standard-docs.summary' : `standard-docs.${filename}`,
      filePath,
      {
        label: filename,
        stability: filename === 'manifest' ? 'best-effort' : 'stable',
      }
    )),
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

  let modelMetadata = context?.geometry_source?.model_metadata || null;
  let featureHints = context?.geometry_source?.feature_hints || null;

  const inspectionResult = await inspectModelIfAvailable(modelPath);
  if (inspectionResult?.success) modelMetadata = inspectionResult.model;

  const stepFeatures = await detectStepFeaturesIfAvailable(modelPath);
  if (stepFeatures?.success) featureHints = stepFeatures.features;

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
    geometry_source: context?.geometry_source || (modelPath ? { path: modelPath } : {}),
    part: context?.part || { name: deriveArtifactStem(modelPath || contextPath, 'part') },
    generated_at: generatedAt,
    source_artifact_refs: sourceArtifactRefs,
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
  const hotspotsPath = resolveMaybe(options.hotspots) || artifactPathFor(buildDefaultOutputDir(options['out-dir'] || dirname(geometryPath)), stem, '_manufacturing_hotspots.json');
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

function diffNumbers(before, after) {
  if (typeof before !== 'number' || typeof after !== 'number') return null;
  return {
    before,
    after,
    delta: Number((after - before).toFixed(6)),
  };
}

function extractCategories(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item?.category || item?.linked_hotspot_category || null)
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function extractReviewDocumentData(document) {
  const summary = document.summary || document;
  const geometrySummary = summary.geometry_summary || document.geometry_summary || document.metrics || document.geometry_intelligence?.metrics || document.geometry_source?.model_metadata || {};
  const reviewPriorities = summary.review_priorities || document.review_priorities?.records || document.records || [];
  const geometryHotspots = summary.geometry_hotspots || document.manufacturing_hotspots?.hotspots || document.hotspots || [];
  const qualityHotspots = summary.quality_hotspots || document.quality_hotspots?.records || [];
  const evidence = summary.evidence_appendix || document.evidence_appendix || {};

  return {
    part: summary.part || document.part || {},
    geometrySummary,
    reviewPriorities,
    geometryHotspots,
    qualityHotspots,
    evidence,
  };
}

function compareCategorySets(baselineValues, candidateValues) {
  const baseline = uniqueSorted(baselineValues);
  const candidate = uniqueSorted(candidateValues);
  return {
    baseline,
    candidate,
    added: candidate.filter((value) => !baseline.includes(value)),
    removed: baseline.filter((value) => !candidate.includes(value)),
  };
}

async function cmdCompareRev(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const baselinePath = resolveMaybe(positional[0]);
  const candidatePath = resolveMaybe(positional[1]);

  if (!baselinePath || !candidatePath) {
    console.error('Error: compare-rev requires two JSON artifacts');
    console.error('  fcad compare-rev output/rev_a_context.json output/rev_b_context.json');
    process.exit(1);
  }

  const baseline = await readJsonFile(baselinePath);
  const candidate = await readJsonFile(candidatePath);
  const baselineData = extractReviewDocumentData(baseline);
  const candidateData = extractReviewDocumentData(candidate);
  const baselineMetrics = baselineData.geometrySummary;
  const candidateMetrics = candidateData.geometrySummary;
  const hotspotCategories = compareCategorySets(
    extractCategories(baselineData.geometryHotspots).concat(extractCategories(baselineData.qualityHotspots)),
    extractCategories(candidateData.geometryHotspots).concat(extractCategories(candidateData.qualityHotspots)),
  );
  const priorityCategories = compareCategorySets(
    extractCategories(baselineData.reviewPriorities),
    extractCategories(candidateData.reviewPriorities),
  );

  const comparison = {
    artifact_type: 'revision_comparison',
    schema_version: D_ARTIFACT_SCHEMA_VERSION,
    analysis_version: D_ANALYSIS_VERSION,
    generated_at: nowIso(),
    part_id: baselineData.part?.part_id && baselineData.part?.part_id === candidateData.part?.part_id
      ? baselineData.part.part_id
      : null,
    warnings: [],
    coverage: {
      source_artifact_count: 2,
      source_file_count: (baselineData.evidence?.source_files || []).length + (candidateData.evidence?.source_files || []).length,
      review_priority_count: baselineData.reviewPriorities.length + candidateData.reviewPriorities.length,
    },
    confidence: {
      level: 'heuristic',
      score: 0.55,
      rationale: 'Comparison is derived from canonical artifact content rather than exact CAD feature differencing.',
    },
    source_artifact_refs: [
      buildSourceArtifactRef('review_pack', baselinePath, 'comparison_baseline', 'Baseline review pack JSON'),
      buildSourceArtifactRef('review_pack', candidatePath, 'comparison_candidate', 'Candidate review pack JSON'),
    ],
    baseline: baselinePath,
    candidate: candidatePath,
    part: {
      baseline: baselineData.part?.name || deriveArtifactStem(baselinePath),
      candidate: candidateData.part?.name || deriveArtifactStem(candidatePath),
    },
    revision: {
      baseline: baselineData.part?.revision || null,
      candidate: candidateData.part?.revision || null,
    },
    comparison_type: "heuristic_artifact_diff",
    metrics: {
      volume_mm3: diffNumbers(baselineMetrics.volume_mm3 || baselineMetrics.volume, candidateMetrics.volume_mm3 || candidateMetrics.volume),
      face_count: diffNumbers(baselineMetrics.face_count || baselineMetrics.faces, candidateMetrics.face_count || candidateMetrics.faces),
      edge_count: diffNumbers(baselineMetrics.edge_count || baselineMetrics.edges, candidateMetrics.edge_count || candidateMetrics.edges),
    },
    risk_signals: {
      hotspot_categories: hotspotCategories,
      review_priority_categories: priorityCategories,
    },
    evidence_summary: {
      baseline_sources: baselineData.evidence?.source_files || [],
      candidate_sources: candidateData.evidence?.source_files || [],
      baseline_priority_count: baselineData.reviewPriorities.length,
      candidate_priority_count: candidateData.reviewPriorities.length,
      note: "Heuristic diff based on available artifact content; not exact CAD feature differencing.",
    },
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
  const configDocument = await loadConfigDocumentForCli(absPath);
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
  console.log(`Manifest: ${manifestPath}`);
  return result;
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
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  console.log(`Loading config: ${absPath}`);

  const configDocument = await loadConfigDocumentForCli(absPath);
  const config = configDocument.config;
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

  if (result.success) {
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdFem(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = positional[0];
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Loading config: ${absPath}`);

  const configDocument = await loadConfigDocumentForCli(absPath);
  const config = configDocument.config;
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

  if (result.success) {
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
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdTolerance(rawArgs = []) {
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

  const configDocument = await loadConfigDocumentForCli(absPath);
  const config = configDocument.config;

  // Inject flags into tolerance config
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

  if (result.success) {
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

      // Monte Carlo results
      const mc = result.monte_carlo;
      if (mc) {
        console.log(`\n--- Monte Carlo Simulation (N=${mc.num_samples}, ${mc.distribution}) ---`);
        console.log(`  Mean gap:   ${mc.mean_mm.toFixed(4)} mm  (σ=${mc.std_mm.toFixed(4)})`);
        console.log(`  Cpk:        ${mc.cpk}`);
        console.log(`  Fail rate:  ${mc.fail_rate_pct}%`);
        const p = mc.percentiles;
        console.log(`  Percentiles: P0.1=${p.p0_1.toFixed(4)} | P1=${p.p1.toFixed(4)} | P50=${p.p50.toFixed(4)} | P99=${p.p99.toFixed(4)} | P99.9=${p.p99_9.toFixed(4)}`);
        // ASCII histogram
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
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdDfm(rawArgs = []) {
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

  const configDocument = await loadConfigDocumentForCli(absPath);
  const config = configDocument.config;

  // Inject flags into manufacturing config
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

  if (result.success) {
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdReport(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad report configs/examples/ptu_assembly_mates.toml');
    process.exit(1);
  }

  const absPath = resolveMaybe(configPath);
  console.log(`Loading config: ${absPath}`);
  const configDocument = await loadConfigDocumentForCli(absPath);
  const config = configDocument.config;
  const includeTolerance = !flags.includes('--no-tolerance');
  const includeFem = flags.includes('--fem');
  const includeMC = flags.includes('--monte-carlo');
  const includeDfm = flags.includes('--dfm');
  const analysisResults = {};

  // Step 1: Run tolerance analysis if needed
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

  // Step 1.5: Run DFM analysis if requested
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

  // Step 2: Run FEM analysis if requested
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

  // Step 3: Generate PDF report
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

  if (result.success) {
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
    console.log(`\n=== Engineering Report Generated ===`);
    console.log(`  PDF: ${result.path} (${result.size_bytes} bytes)`);
    console.log(`  Manifest: ${manifestPath}`);
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdInspect(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const filePath = positional[0];
  if (!filePath) {
    console.error('Error: model file path required');
    process.exit(1);
  }

  const absPath = resolveMaybe(filePath);
  const manifestPath = resolveManifestOutputPath(options);
  console.log(`Inspecting: ${absPath}`);

  const result = await inspectModel({
    runScript: (script, input, opts = {}) => runScript(script, input, {
      ...opts,
      onStderr: (text) => process.stderr.write(text),
    }),
    filePath: absPath,
  });

  if (result.success) {
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
    if (emittedManifestPath) {
      console.log(`  Manifest: ${emittedManifestPath}`);
    }
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

main().catch((err) => {
  if (err instanceof ArtifactSchemaValidationError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

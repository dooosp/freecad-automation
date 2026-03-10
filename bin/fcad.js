#!/usr/bin/env node

import { resolve, join, dirname, parse, sep } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, deepMerge } from '../lib/config-loader.js';
import {
  artifactPathFor,
  deriveArtifactStem,
  readJsonFile,
  readJsonIfExists,
  runPythonJsonScript,
  writeJsonFile,
} from '../lib/context-loader.js';
import { runScript } from '../lib/runner.js';
import { hasFreeCADRuntime } from '../lib/paths.js';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const VALID_DFM_PROCESSES = new Set(['machining', 'casting', 'sheet_metal', '3d_printing']);

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
fcad | mfg-agent - Manufacturing engineering decision-support CLI

Usage:
  Production-readiness workflows:
    fcad review <config.toml|json>
    fcad process-plan <config.toml|json>
    fcad line-plan <config.toml|json>
    fcad quality-risk <config.toml|json>
    fcad investment-review <config.toml|json>
    fcad readiness-report <config.toml|json>
    fcad stabilization-review <config.toml|json> --runtime <runtime.json>
    fcad generate-standard-docs <config.toml|json> [--out-dir <dir>]

  Review-pack workflows:
    fcad ingest --model <file> [--bom bom.csv] [--inspection insp.csv] [--quality ncr.csv] --out <context.json>
    fcad analyze-part <context.json|model.step>
    fcad quality-link --context <context.json> --geometry <geometry.json>
    fcad review-pack --context <context.json> --geometry <geometry.json>
    fcad compare-rev <baseline.json> <candidate.json>

  Legacy / specialized workflows:
    fcad create <config.toml|json>    Legacy model creation from config
    fcad design "description"         Experimental NL-to-TOML generation
    fcad draw <config.toml|json>      Generate engineering drawing (4-view SVG + BOM)
    fcad fem <config.toml|json>       Run FEM structural analysis
    fcad tolerance <config.toml>      Tolerance analysis (fit + stack-up)
    fcad report <config.toml>         Generate engineering PDF report
    fcad inspect <model.step|fcstd>   Inspect model metadata
    fcad validate <config.toml|json>  Validate drawing plan schema
    fcad dfm <config.toml|json>       Run DFM manufacturability analysis
    fcad serve [port]                 Start legacy 3D viewer/dev server
    fcad help                         Show this help

Options:
  Shared new-workflow options:
    --profile <name>             Shop profile under configs/profiles
    --runtime <path>             Runtime JSON for line stabilization / launch review
    --batch <n>                  Batch size assumption for cost/readiness workflow
    --site <name>                Site label override for summaries
    --process <name>             Override manufacturing process when supported
    --material <name>            Override material for cost/readiness workflow
    --context <path>              Engineering context JSON
    --geometry <path>             Geometry intelligence JSON
    --hotspots <path>             Manufacturing hotspot JSON
    --out <path>                  Primary output JSON path; sibling artifacts share its stem
    --out-dir <dir>               Output directory when using default artifact names

  Legacy options:
    --override <path>             Merge override TOML/JSON on top of base config (with draw)
    --bom                         Export BOM as separate CSV file (with draw)
    --raw                         Skip SVG post-processing (with draw)
    --no-score                    Skip QA scoring (with draw)
    --fail-under N                Fail if QA score < N (with draw)
    --weights-preset P            QA weight profile: default|auto|flange|shaft|...
    --strict                      Treat warnings as errors (with validate/dfm)
    --process P                   Override manufacturing process (with dfm)
    --recommend                   Auto-recommend fit specs (with tolerance)
    --csv                         Export tolerance report as CSV (with tolerance)
    --monte-carlo                 Include Monte Carlo simulation (with tolerance/report)
    --fem                         Include FEM analysis in report
    --tolerance                   Include tolerance analysis in report (default)

Examples:
  fcad review configs/examples/infotainment_display_bracket.toml
  fcad process-plan configs/examples/controller_housing.toml
  fcad readiness-report configs/examples/pcb_mount_plate.toml --out output/pcb_mount_plate_readiness.json
  fcad stabilization-review configs/examples/infotainment_display_bracket.toml --runtime data/runtime_examples/display_bracket_runtime.json --profile configs/profiles/site_korea_ulsan.toml
  fcad generate-standard-docs configs/examples/controller_housing_eol.toml --out-dir output/controller_housing_standard_docs
  fcad ingest --model fixtures/part.step --inspection fixtures/inspection.csv --out output/part_context.json
  fcad analyze-part output/part_context.json
  fcad quality-link --context output/part_context.json --geometry output/part_geometry_intelligence.json
  fcad review-pack --context output/part_context.json --geometry output/part_geometry_intelligence.json
  fcad create configs/examples/ks_bracket.toml
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

function resolveMaybe(value) {
  return value ? resolve(value) : null;
}

function stemFromContext(context, fallback = 'artifact') {
  return context?.part?.name || context?.part?.part_id || fallback;
}

function buildDefaultOutputDir(preferredPath) {
  if (!preferredPath) return resolve(PROJECT_ROOT, 'output');
  const resolved = resolve(preferredPath);
  return resolved.endsWith('.json') ? dirname(resolved) : resolved;
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
  const absPath = resolve(pathValue);
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

  if (command === 'create') {
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
  } else if (command === 'draw') {
    await cmdDraw(args);
  } else if (command === 'fem') {
    await cmdFem(args[0]);
  } else if (command === 'tolerance') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdTolerance(configArg, flags);
  } else if (command === 'report') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdReport(configArg, flags);
  } else if (command === 'validate') {
    const flags = args.filter(a => a.startsWith('--'));
    const configArg = args.find(a => !a.startsWith('--'));
    await cmdValidate(configArg, flags);
  } else if (command === 'dfm') {
    await cmdDfm(args);
  } else if (command === 'inspect') {
    await cmdInspect(args[0]);
  } else if (command === 'serve') {
    await cmdServe(args[0]);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}

function resolveConfigCommandInput(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const configPath = positional[0] ? resolve(positional[0]) : null;
  const outputPath = normalizeJsonOutputPath(options.out);
  const outDir = buildDefaultOutputDir(outputPath || options['out-dir']);
  const stem = deriveArtifactStem(outputPath || configPath || 'manufacturing_output', 'manufacturing_output');
  return { configPath, options, outputPath, outDir, stem };
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

  const config = await loadConfig(configPath);
  const runtimeData = await loadRuntimeData(options);
  const report = await runReadinessReportWorkflow({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig,
    configPath,
    config,
    options: {
      batchSize: options.batch ? Number(options.batch) : undefined,
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
  return { report, artifacts };
}

async function writeAgentArtifact(outputPath, fallbackDir, stem, suffix, payload) {
  const targetPath = outputPath || artifactPathFor(fallbackDir, stem, suffix);
  const jsonPath = await writeJsonFile(targetPath, payload);
  return { json: jsonPath };
}

async function cmdProductionReview(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_product_review.json', report.product_review);
  console.log(`Product review: ${artifacts.json}`);
  console.log(`  Part type: ${report.product_review.summary.part_type}`);
  console.log(`  DFM score: ${report.product_review.summary.dfm_score ?? 'n/a'}`);
}

async function cmdProcessPlan(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_process_plan.json', report.process_plan);
  console.log(`Process plan: ${artifacts.json}`);
  console.log(`  Steps: ${report.process_plan.process_flow.length}`);
}

async function cmdLinePlan(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_line_plan.json', report.line_plan);
  console.log(`Line layout support: ${artifacts.json}`);
  console.log(`  Stations: ${report.line_plan.station_concept.length}`);
}

async function cmdQualityRisk(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_quality_risk.json', report.quality_risk);
  console.log(`Quality / traceability pack: ${artifacts.json}`);
  console.log(`  Critical dimensions: ${report.quality_risk.critical_dimensions.length}`);
}

async function cmdInvestmentReview(rawArgs = []) {
  const { outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_investment_review.json', report.investment_review);
  console.log(`Cost / investment review: ${artifacts.json}`);
  console.log(`  Unit cost: ${report.investment_review.cost_breakdown.unit_cost ?? 'n/a'}`);
}

async function cmdReadinessReport(rawArgs = []) {
  const { report, artifacts } = await runProductionReadiness(rawArgs);
  console.log(`Readiness report JSON: ${artifacts.json}`);
  console.log(`Readiness report Markdown: ${artifacts.markdown}`);
  console.log(`  Status: ${report.readiness_summary.status}`);
  console.log(`  Score: ${report.readiness_summary.score}`);
}

async function cmdStabilizationReview(rawArgs = []) {
  const { options, outputPath, outDir, stem } = resolveConfigCommandInput(rawArgs);
  if (!options.runtime) {
    console.error('Error: stabilization-review requires --runtime <runtime.json>');
    process.exit(1);
  }

  const { report } = await runProductionReadiness(rawArgs, { persistArtifacts: false });
  if (!report.stabilization_review) {
    console.error('Error: stabilization review was not generated from the supplied inputs.');
    process.exit(1);
  }

  const artifacts = await writeAgentArtifact(outputPath, outDir, stem, '_stabilization_review.json', report.stabilization_review);
  console.log(`Stabilization review: ${artifacts.json}`);
  console.log(`  Runtime basis: ${report.stabilization_review.summary.runtime_basis}`);
  console.log(`  Top bottlenecks: ${(report.stabilization_review.summary.top_bottlenecks || []).length}`);
}

async function cmdGenerateStandardDocs(rawArgs = []) {
  const { configPath, options } = resolveConfigCommandInput(rawArgs);
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const runtimeData = await loadRuntimeData(options);
  const result = await runStandardDocsWorkflow({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig,
    configPath,
    config,
    options: {
      batchSize: options.batch ? Number(options.batch) : undefined,
      profileName: options.profile || null,
      process: options.process || config.manufacturing?.process || config.process || null,
      material: options.material || config.manufacturing?.material || config.material || null,
      site: options.site || null,
      runtimeData,
      outDir: options['out-dir'] ? resolve(options['out-dir']) : null,
      onStderr: (text) => process.stderr.write(text),
    },
  });

  console.log(`Standard docs output: ${result.out_dir}`);
  console.log(`  Process flow: ${result.artifacts['process_flow.md']}`);
  console.log(`  Control plan: ${result.artifacts['control_plan_draft.csv']}`);
  console.log(`  Work instruction: ${result.artifacts['work_instruction_draft.md']}`);
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

  if (modelPath && !existsSync(modelPath)) {
    console.error(`Error: model file not found: ${modelPath}`);
    process.exit(1);
  }

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

  console.log(`Context JSON: ${paths.context}`);
  console.log(`Ingest log:   ${paths.ingestLog}`);
  console.log(`  BOM entries: ${result.ingest_log.summary?.bom_entries || 0}`);
  console.log(`  Inspection results: ${result.ingest_log.summary?.inspection_results || 0}`);
  console.log(`  Quality issues: ${result.ingest_log.summary?.quality_issues || 0}`);
}

async function cmdAnalyzePart(rawArgs = []) {
  const { positional, options } = parseCliArgs(rawArgs);
  const contextPath = resolveMaybe(options.context || (positional[0]?.toLowerCase().endsWith('.json') ? positional[0] : null));
  const directModelPath = resolveMaybe(options.model || (!contextPath ? positional[0] : null));
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
  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/analyze_part.py', {
    context,
    model_metadata: modelMetadata,
    feature_hints: featureHints,
    geometry_source: context?.geometry_source || (modelPath ? { path: modelPath } : {}),
    part: context?.part || { name: deriveArtifactStem(modelPath || contextPath, 'part') },
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

  await writeJsonFile(paths.geometry, result.geometry_intelligence);
  await writeJsonFile(paths.hotspots, result.manufacturing_hotspots);

  console.log(`Geometry intelligence: ${paths.geometry}`);
  console.log(`Manufacturing hotspots: ${paths.hotspots}`);
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

  const result = await runPythonJsonScript(PROJECT_ROOT, 'scripts/quality_link.py', {
    context,
    geometry_intelligence: geometryIntelligence,
    manufacturing_hotspots: manufacturingHotspots,
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

  await writeJsonFile(paths.inspectionLinkage, result.inspection_linkage);
  await writeJsonFile(paths.inspectionOutliers, result.inspection_outliers);
  await writeJsonFile(paths.qualityLinkage, result.quality_linkage);
  await writeJsonFile(paths.qualityHotspots, result.quality_hotspots);
  await writeJsonFile(paths.reviewPriorities, result.review_priorities);

  console.log(`Inspection linkage: ${paths.inspectionLinkage}`);
  console.log(`Inspection outliers: ${paths.inspectionOutliers}`);
  console.log(`Quality linkage: ${paths.qualityLinkage}`);
  console.log(`Quality hotspots: ${paths.qualityHotspots}`);
  console.log(`Review priorities: ${paths.reviewPriorities}`);
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

  const manufacturingHotspots = await readJsonIfExists(resolveMaybe(options.hotspots) || artifactPathFor(sourceDir, geometryStem, '_manufacturing_hotspots.json')) || { hotspots: [] };
  const inspectionLinkage = await readJsonIfExists(resolveMaybe(options['inspection-linkage']) || artifactPathFor(sourceDir, reviewStem, '_inspection_linkage.json')) || { records: [] };
  const inspectionOutliers = await readJsonIfExists(resolveMaybe(options['inspection-outliers']) || artifactPathFor(sourceDir, reviewStem, '_inspection_outliers.json')) || { records: [] };
  const qualityLinkage = await readJsonIfExists(resolveMaybe(options['quality-linkage']) || artifactPathFor(sourceDir, reviewStem, '_quality_linkage.json')) || { records: [] };
  const qualityHotspots = await readJsonIfExists(resolveMaybe(options['quality-hotspots']) || artifactPathFor(sourceDir, reviewStem, '_quality_hotspots.json')) || { records: [] };
  const reviewPriorities = await readJsonIfExists(reviewPath || artifactPathFor(sourceDir, reviewStem, '_review_priorities.json')) || { records: [], recommended_actions: [] };

  const outputJsonPath = primaryOutputPath || artifactPathFor(outputDir, stem, '_review_pack.json');
  const outputStem = deriveArtifactStem(outputJsonPath, stem);
  const outputMarkdownPath = siblingArtifactPath(outputJsonPath, '_review_pack.md');
  const outputPdfPath = siblingArtifactPath(outputJsonPath, '_review_pack.pdf');

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
  }, {
    timeout: 180_000,
    onStderr: (text) => process.stderr.write(text),
  });

  console.log(`Review pack JSON: ${result.artifacts.json}`);
  console.log(`Review pack Markdown: ${result.artifacts.markdown}`);
  console.log(`Review pack PDF: ${result.artifacts.pdf}`);
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

  const outputPath = resolve(options.out || artifactPathFor(buildDefaultOutputDir(options['out-dir']), deriveArtifactStem(candidatePath, 'revision'), '_revision_comparison.json'));
  await writeJsonFile(outputPath, comparison);
  console.log(`Revision comparison: ${outputPath}`);
}

async function cmdValidate(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad validate configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  const config = await loadConfig(absPath);
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

  const proc = spawn('python3', pyArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (c) => { stdout += c; });
  proc.stderr.on('data', (c) => { stderr += c; });

  proc.stdin.write(JSON.stringify({ drawing_plan: plan }));
  proc.stdin.end();

  const code = await new Promise((res) => proc.on('close', res));

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

  process.exit(code);
}

async function cmdServe(portArg) {
  const port = parseInt(portArg, 10) || 3000;
  console.warn('Warning: fcad serve starts the legacy viewer/dev server. Prefer desktop or MCP automation flows for maintained workflows.');
  const { startServer } = await import('../server.js');
  startServer(port);
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
    loadConfig,
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
  console.log(`\nView: fcad serve → http://localhost:3000 → select ${fileName}`);
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
    if (arg === '--override' && rawArgs[i + 1]) {
      overridePath = rawArgs[++i];
    } else if (arg === '--fail-under' && rawArgs[i + 1]) {
      failUnderValue = rawArgs[++i];
      flags.push('--fail-under');
    } else if (arg.startsWith('--fail-under=')) {
      failUnderValue = arg.split('=')[1];
      flags.push('--fail-under');
    } else if (arg === '--weights-preset' && rawArgs[i + 1]) {
      weightsPresetValue = rawArgs[++i];
      flags.push('--weights-preset');
    } else if (arg.startsWith('--weights-preset=')) {
      weightsPresetValue = arg.split('=')[1];
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
  return runDrawPipeline({
    projectRoot: PROJECT_ROOT,
    configPath,
    flags,
    overridePath,
    failUnderValue,
    weightsPresetValue,
    loadConfig,
    deepMerge,
    generateDrawing,
    runScript: runWithCliStderr,
    onInfo: (message) => console.log(message),
    onError: (message) => console.error(message),
  });
}

async function cmdCreate(configPath) {
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);
  console.log(`Creating model: ${config.name || 'unnamed'}`);
  console.log(`  Shapes: ${config.shapes?.length || 0}`);
  console.log(`  Operations: ${config.operations?.length || 0}`);

  const result = await createModel({
    freecadRoot: PROJECT_ROOT,
    runScript: (script, input, opts = {}) => runScript(script, input, {
      ...opts,
      onStderr: (text) => process.stderr.write(text),
    }),
    loadConfig,
    config,
  });

  if (result.success) {
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdFem(configPath) {
  if (!configPath) {
    console.error('Error: config file path required');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);
  const analysisType = config.fem?.analysis_type || 'static';
  console.log(`FEM Analysis: ${config.name || 'unnamed'} (${analysisType})`);
  console.log(`  Shapes: ${config.shapes?.length || 0}`);
  console.log(`  Constraints: ${config.fem?.constraints?.length || 0}`);

  const result = await runFemService({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig,
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdTolerance(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad tolerance configs/examples/ptu_assembly_mates.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);

  // Inject flags into tolerance config
  config.tolerance = config.tolerance || {};
  if (flags.includes('--recommend')) config.tolerance.recommend = true;
  if (flags.includes('--csv')) config.tolerance.csv = true;
  if (flags.includes('--monte-carlo')) config.tolerance.monte_carlo = true;

  const modelName = config.name || 'unnamed';
  console.log(`Tolerance Analysis: ${modelName}`);

  const result = await runToleranceService({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig,
    config,
    standard: config.standard || 'KS',
    monteCarlo: flags.includes('--monte-carlo') ? true : undefined,
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdDfm(rawArgs = []) {
  const flags = [];
  const positional = [];
  let processValue = null;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--process') {
      const val = rawArgs[i + 1];
      if (!val || val.startsWith('--')) {
        console.error('Error: --process requires a value');
        console.error('  Allowed: machining|casting|sheet_metal|3d_printing');
        process.exit(1);
      }
      processValue = val;
      i++;
    } else if (arg.startsWith('--process=')) {
      processValue = arg.split('=')[1];
    } else if (arg.startsWith('--')) {
      flags.push(arg);
    } else {
      positional.push(arg);
    }
  }

  const configPath = positional[0];
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad dfm configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const config = await loadConfig(absPath);

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

  const strict = flags.includes('--strict');
  const modelName = config.name || 'unnamed';
  console.log(`DFM Analysis: ${modelName} (process: ${config.manufacturing.process || 'machining'})\n`);

  const result = await runDfm({
    freecadRoot: PROJECT_ROOT,
    runScript: runWithCliStderr,
    loadConfig,
    config,
    process: config.manufacturing.process || 'machining',
    standard: config.standard || 'KS',
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

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);
  const config = await loadConfig(absPath);
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
      loadConfig,
      config,
      standard: config.standard || 'KS',
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
      loadConfig,
      config,
      process: config.manufacturing?.process || 'machining',
      standard: config.standard || 'KS',
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
      loadConfig,
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
    loadConfig,
    configPath: absPath,
    config,
    includeDrawing: false,
    includeDfm,
    includeTolerance,
    includeCost: false,
    analysisResults,
  });

  if (result.success) {
    console.log(`\n=== Engineering Report Generated ===`);
    console.log(`  PDF: ${result.path} (${result.size_bytes} bytes)`);
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

async function cmdInspect(filePath) {
  if (!filePath) {
    console.error('Error: model file path required');
    process.exit(1);
  }

  const absPath = resolve(filePath);
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
  } else {
    console.error(`\nError: ${result.error}`);
    process.exit(1);
  }

  return result;
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});

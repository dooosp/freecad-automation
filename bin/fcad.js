#!/usr/bin/env node

import { resolve, join, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stringify as tomlStringify } from 'smol-toml';
import { loadConfig, deepMerge } from '../lib/config-loader.js';
import { runScript } from '../lib/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const USAGE = `
fcad - FreeCAD automation CLI

Usage:
  fcad create <config.toml|json>  Create model from config
  fcad design "description"       AI-generate TOML from natural language, then build
  fcad draw <config.toml|json>    Generate engineering drawing (4-view SVG + BOM)
  fcad fem <config.toml|json>     Run FEM structural analysis
  fcad tolerance <config.toml>    Tolerance analysis (fit + stack-up)
  fcad report <config.toml>      Generate engineering PDF report
  fcad inspect <model.step|fcstd> Inspect model metadata
  fcad serve [port]               Start 3D viewer server (default: 3000)
  fcad help                       Show this help

Options:
  --override <path>               Merge override TOML/JSON on top of base config (with draw)
  --bom                           Export BOM as separate CSV file (with draw)
  --raw                           Skip SVG post-processing (with draw)
  --no-score                      Skip QA scoring (with draw)
  --fail-under N                  Fail if QA score < N (with draw)
  --recommend                     Auto-recommend fit specs (with tolerance)
  --csv                           Export tolerance report as CSV (with tolerance)
  --monte-carlo                   Include Monte Carlo simulation (with tolerance/report)
  --fem                           Include FEM analysis in report
  --tolerance                     Include tolerance analysis in report (default)

Examples:
  fcad create configs/examples/ks_bracket.toml
  fcad draw configs/examples/ks_flange.toml
  fcad draw configs/examples/ks_bracket.toml --bom
  fcad fem configs/examples/bracket_fem.toml
  fcad inspect output/ks_bracket.step
  fcad serve 8080
`.trim();

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'create') {
    await cmdCreate(args[0]);
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

async function cmdServe(portArg) {
  const port = parseInt(portArg) || 3000;
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
  const { designFromText } = await import('../scripts/design-reviewer.js');
  const result = await designFromText(description.trim());

  if (!result.toml) {
    console.error('Error: Failed to generate valid TOML');
    process.exit(1);
  }

  // Derive filename from mechanism_type or description
  const rawName = result.report?.mechanism_type || description;
  const fileName = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

  // Save to configs/generated/
  const generatedDir = resolve(import.meta.dirname, '..', 'configs', 'generated');
  mkdirSync(generatedDir, { recursive: true });
  const tomlPath = join(generatedDir, `${fileName}.toml`);
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

function nowIso() {
  return new Date().toISOString();
}

function initRunLog(command, configPath, modelName = 'unnamed') {
  return {
    schema_version: '0.1',
    command,
    config_path: configPath,
    model_name: modelName,
    started_at: nowIso(),
    started_ms: Date.now(),
    finished_at: null,
    duration_ms: null,
    status: 'running',
    stages: [],
    artifacts: {},
  };
}

function beginStage(runLog, name, meta = {}) {
  const stage = {
    name,
    status: 'running',
    started_at: nowIso(),
    started_ms: Date.now(),
    ...meta,
  };
  runLog.stages.push(stage);
  return stage;
}

function endStage(stage, status = 'ok', meta = {}) {
  if (!stage) return;
  stage.status = status;
  stage.finished_at = nowIso();
  stage.duration_ms = Math.max(0, Date.now() - (stage.started_ms || Date.now()));
  delete stage.started_ms;
  Object.assign(stage, meta);
}

function addSkippedStage(runLog, name, reason) {
  runLog.stages.push({
    name,
    status: 'skipped',
    reason,
    started_at: nowIso(),
    finished_at: nowIso(),
    duration_ms: 0,
  });
}

function finalizeRunLog(runLog) {
  for (const stage of runLog.stages || []) {
    if (typeof stage.started_ms === 'number') {
      stage.finished_at = stage.finished_at || nowIso();
      stage.duration_ms = stage.duration_ms ?? Math.max(0, Date.now() - stage.started_ms);
      delete stage.started_ms;
      if (stage.status === 'running') {
        stage.status = runLog.status === 'failed' ? 'failed' : 'aborted';
      }
    }
  }
  runLog.finished_at = runLog.finished_at || nowIso();
  runLog.duration_ms = runLog.duration_ms ?? Math.max(0, Date.now() - (runLog.started_ms || Date.now()));
  delete runLog.started_ms;
}

function writeJson(filepath, payload) {
  writeFileSync(filepath, JSON.stringify(payload, null, 2));
}

function resolveArtifactStem(config, result) {
  const svgPath = (result?.drawing_paths || []).find(dp => dp.format === 'svg')?.path;
  if (svgPath) {
    const normalized = svgPath.replace(/\\/g, '/');
    const name = normalized.split('/').pop() || '';
    return name.replace(/_drawing\.svg$/i, '').replace(/\.svg$/i, '') || (config.name || 'unnamed');
  }
  return config.name || 'unnamed';
}

function resolveArtifactDir(config, result) {
  const svgPath = (result?.drawing_paths || []).find(dp => dp.format === 'svg')?.path;
  if (svgPath) {
    const normalized = svgPath.replace(/\\/g, '/');
    return resolve(dirname(normalized));
  }
  return resolve(config?.export?.directory || join(PROJECT_ROOT, 'output'));
}

function ensureDrawSchema(config) {
  config.drawing = config.drawing || {};
  config.drawing.units = config.drawing.units || 'mm';
  config.drawing.meta = config.drawing.meta || {};
  const meta = config.drawing.meta;
  meta.part_name = meta.part_name || config.name || 'unnamed';
  meta.material = meta.material || config.material || 'UNKNOWN';
  meta.units = meta.units || config.drawing.units;
  meta.tolerance_grade = meta.tolerance_grade || meta.tolerance || '';
  meta.surface_roughness_default = meta.surface_roughness_default
    || config.drawing.surface_finish?.default
    || '';
  config.drawing.datums = config.drawing.datums || [];
  config.drawing.key_dims = config.drawing.key_dims || [];
  config.drawing.thread_specs = config.drawing.thread_specs || config.drawing.threads || [];
  if (!config.exceptions || typeof config.exceptions !== 'object') {
    config.exceptions = { rules: [] };
  } else if (!Array.isArray(config.exceptions.rules)) {
    config.exceptions.rules = [];
  }
}

function buildTraceabilityFallback(config) {
  const intents = config?.drawing_plan?.dim_intents || [];
  const dimensions = intents.map((di) => ({
    dim_id: di.id || '',
    source: 'plan',
    view: di.view || null,
    feature: di.feature || null,
    status: di.value_mm == null ? 'missing_value' : 'planned',
    rendered: false,
    value_mm: di.value_mm ?? null,
    drawing_object_id: null,
  }));
  const links = dimensions
    .filter(d => d.feature)
    .map(d => ({
      dim_id: d.dim_id,
      feature_key: d.feature,
      feature_id: null,
      status: d.status,
      rendered: d.rendered,
    }));
  return {
    schema_version: '0.1',
    model_name: config?.name || 'unnamed',
    features: [],
    dimensions,
    links,
    summary: {
      feature_count: 0,
      dimension_count: dimensions.length,
      linked_dimensions: 0,
      unresolved_dimensions: links.map(l => l.dim_id),
    },
  };
}

function normalizeSeverity(raw) {
  const sev = (raw || '').toLowerCase();
  if (sev === 'error' || sev === 'high') return 'high';
  if (sev === 'warning' || sev === 'medium') return 'medium';
  return 'low';
}

function buildQaIssueReport(qaReport = {}, repairReport = null) {
  const metrics = qaReport.metrics || {};
  const details = qaReport.details || {};
  const issues = [];
  let seq = 1;

  const pushIssue = ({
    category,
    severity = 'medium',
    rule_id,
    suggestion,
    location = {},
    related_dim_ids = [],
    evidence = {},
  }) => {
    issues.push({
      id: `ISSUE_${String(seq++).padStart(3, '0')}`,
      category,
      severity,
      location,
      related_dim_ids,
      rule_id,
      suggestion,
      evidence,
    });
  };

  for (const ov of details.overflows || []) {
    pushIssue({
      category: 'layout',
      severity: 'medium',
      rule_id: 'layout_overflow',
      suggestion: 'Reduce scale or trigger layout/overflow repair.',
      location: { view: ov.view || 'unknown' },
      evidence: ov,
    });
  }

  for (const ol of details.text_overlaps || []) {
    pushIssue({
      category: 'readability',
      severity: 'medium',
      rule_id: 'text_overlap',
      suggestion: 'Move dimension text/notes or reroute leaders.',
      location: { view: ol.view || 'unknown' },
      evidence: ol,
    });
  }

  const missingIds = details.required_presence_missing_ids || [];
  if (missingIds.length > 0) {
    pushIssue({
      category: 'completeness',
      severity: 'high',
      rule_id: 'required_dim_missing',
      suggestion: 'Add missing required dimensions from drawing_plan.',
      location: { view: 'page' },
      related_dim_ids: missingIds,
      evidence: { missing_count: missingIds.length },
    });
  }

  if (metrics.virtual_pcd_present === false) {
    pushIssue({
      category: 'standards',
      severity: 'medium',
      rule_id: 'virtual_pcd_missing',
      suggestion: 'Inject virtual PCD circle or add explicit PCD callout.',
      location: { view: 'front' },
    });
  }

  if (typeof metrics.note_semantic_mismatch === 'number' && metrics.note_semantic_mismatch > 0) {
    pushIssue({
      category: 'standards',
      severity: 'medium',
      rule_id: 'note_semantic_mismatch',
      suggestion: 'Align note text with dimensional intent/part type.',
      location: { view: 'notes' },
      evidence: { mismatch_count: metrics.note_semantic_mismatch },
    });
  }

  for (const risk of repairReport?.risks || []) {
    pushIssue({
      category: 'repair',
      severity: normalizeSeverity(risk.severity),
      rule_id: risk.code || 'repair_risk',
      suggestion: 'Review residual risk after auto-repair pass.',
      location: { view: risk.view || 'page' },
      evidence: risk,
    });
  }

  const byCategory = {};
  const bySeverity = {};
  for (const it of issues) {
    byCategory[it.category] = (byCategory[it.category] || 0) + 1;
    bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
  }

  return {
    schema_version: '0.1',
    file: qaReport.file || null,
    score: qaReport.score ?? null,
    generated_at: nowIso(),
    issues,
    summary: {
      count: issues.length,
      by_category: byCategory,
      by_severity: bySeverity,
    },
  };
}

async function cmdDraw(rawArgs = []) {
  // Parse: fcad draw <config> [--override <path>] [--flags...]
  const flags = [];
  const positional = [];
  let overridePath = null;
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--override' && rawArgs[i + 1]) {
      overridePath = rawArgs[++i];
    } else if (rawArgs[i].startsWith('--')) {
      flags.push(rawArgs[i]);
    } else {
      positional.push(rawArgs[i]);
    }
  }
  const configPath = positional[0];

  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad draw configs/examples/ks_flange.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);

  const runLog = initRunLog('draw', absPath);
  let artifactDir = join(PROJECT_ROOT, 'output');
  let artifactStem = 'unnamed';

  try {
    const loadStage = beginStage(runLog, 'load_config');
    const config = await loadConfig(absPath);
    ensureDrawSchema(config);
    artifactStem = config.name || artifactStem;
    endStage(loadStage, 'ok', { model_name: artifactStem });

    // --override <path>: merge override TOML/JSON on top of base config
    if (overridePath) {
      const overrideStage = beginStage(runLog, 'apply_override', { path: resolve(overridePath) });
      const absOvPath = resolve(overridePath);
      const overrideCfg = await loadConfig(absOvPath);
      deepMerge(config, overrideCfg);
      console.log(`  Override: ${absOvPath}`);
      endStage(overrideStage, 'ok');
    }

    // Inject --bom flag into drawing config
    if (flags.includes('--bom')) {
      config.drawing.bom_csv = true;
    }

    // Ensure drawing section exists with defaults
    if (!config.drawing.views) {
      config.drawing.views = ['front', 'top', 'right', 'iso'];
    }

    // Intent Plan (Phase 19) — enrich config with drawing_plan
    if (!flags.includes('--no-plan')) {
      const planStage = beginStage(runLog, 'intent_compile');
      const compilerScript = join(PROJECT_ROOT, 'scripts', 'intent_compiler.py');
      try {
        const enriched = execSync(
          `python3 "${compilerScript}"`,
          { input: JSON.stringify(config), encoding: 'utf-8', timeout: 15_000 }
        );
        const enrichedConfig = JSON.parse(enriched);
        Object.assign(config, enrichedConfig);
        console.log(`  Plan: ${config.drawing_plan?.part_type || 'unknown'} template applied`);

        // Sync plan views → drawing.views (plan is authoritative after compilation)
        const planViews = config.drawing_plan?.views?.enabled;
        if (planViews && planViews.length > 0) {
          config.drawing.views = planViews;
        }
        endStage(planStage, 'ok', { part_type: config.drawing_plan?.part_type || 'unknown' });
      } catch (e) {
        const msg = e.stderr ? e.stderr.toString().trim() : e.message;
        console.error(`  Plan warning: ${msg} (falling back to default)`);
        endStage(planStage, 'warning', { warning: msg });
      }
    } else {
      addSkippedStage(runLog, 'intent_compile', '--no-plan');
    }

    const modelName = config.name || 'unnamed';
    artifactStem = modelName;
    console.log(`Generating drawing: ${modelName}`);
    console.log(`  Views: ${config.drawing.views.join(', ')}`);

    const drawStage = beginStage(runLog, 'generate_drawing', { views: config.drawing.views });
    let result;
    try {
      result = await runScript('generate_drawing.py', config, {
        timeout: 180_000,
        onStderr: (text) => process.stderr.write(text),
      });
      endStage(drawStage, 'ok', {
        scale: result.scale,
        views_generated: result.views?.length || 0,
      });
    } catch (err) {
      endStage(drawStage, 'failed', { error: err.message });
      throw err;
    }

    if (!result.success) {
      throw new Error(result.error || 'generate_drawing.py returned success=false');
    }

    artifactDir = resolveArtifactDir(config, result);
    artifactStem = resolveArtifactStem(config, result);
    mkdirSync(artifactDir, { recursive: true });

    console.log(`\nDrawing generated!`);
    console.log(`  Scale: ${result.scale}`);
    console.log(`  Views: ${result.views.join(', ')}`);
    for (const dp of result.drawing_paths) {
      console.log(`  ${dp.format.toUpperCase()}: ${dp.path} (${dp.size_bytes} bytes)`);
    }
    if (result.bom?.length > 0) {
      console.log(`\n  BOM (${result.bom.length} items):`);
      for (const item of result.bom) {
        const joint = item.joint ? ` [${item.joint.type}: ${item.joint.id}]` : '';
        console.log(`    ${item.id}: ${item.material} ${item.dimensions}${joint}`);
      }
    }

    const persistStage = beginStage(runLog, 'persist_draw_artifacts');
    try {
      const traceability = result.traceability || buildTraceabilityFallback(config);
      const layoutReport = result.layout_report || { summary: { view_count: result.views?.length || 0 } };
      const dimensionMap = result.dimension_map || { auto_dimensions: [], plan_dimensions: [], summary: {} };
      const dimConflicts = result.dim_conflicts || { conflicts: [], summary: { count: 0 } };

      const traceabilityPath = join(artifactDir, `${artifactStem}_traceability.json`);
      const layoutPath = join(artifactDir, `${artifactStem}_layout_report.json`);
      const dimMapPath = join(artifactDir, `${artifactStem}_dimension_map.json`);
      const conflictPath = join(artifactDir, `${artifactStem}_dim_conflicts.json`);

      writeJson(traceabilityPath, traceability);
      writeJson(layoutPath, layoutReport);
      writeJson(dimMapPath, dimensionMap);
      writeJson(conflictPath, dimConflicts);

      runLog.artifacts.traceability = traceabilityPath;
      runLog.artifacts.layout_report = layoutPath;
      runLog.artifacts.dimension_map = dimMapPath;
      runLog.artifacts.dim_conflicts = conflictPath;
      endStage(persistStage, 'ok', { count: 4 });
    } catch (err) {
      endStage(persistStage, 'warning', { warning: err.message });
    }

    // Step 2-3: Post-process + QA (with before/after merge)
    const svgPaths = (result.drawing_paths || [])
      .filter(dp => dp.format === 'svg')
      .map(dp => dp.path.replace(/\\/g, '/'));
    const qaScript = join(PROJECT_ROOT, 'scripts', 'qa_scorer.py');
    const ppScript = join(PROJECT_ROOT, 'scripts', 'postprocess_svg.py');
    const failIdx = flags.indexOf('--fail-under');
    const failUnder = failIdx >= 0 && flags[failIdx + 1] ? ` --fail-under ${flags[failIdx + 1]}` : '';

    // Save plan as TOML for debugging/QA (project convention: TOML for configs)
    let planArg = '';
    if (config.drawing_plan) {
      const planStage = beginStage(runLog, 'save_plan');
      const planPath = join(artifactDir, `${artifactStem}_plan.toml`);
      try {
        writeFileSync(planPath, tomlStringify({ drawing_plan: config.drawing_plan }));
        planArg = ` --plan "${planPath}"`;
        runLog.artifacts.plan = planPath;
        endStage(planStage, 'ok');
      } catch (_) {
        const jsonPath = planPath.replace('.toml', '.json');
        writeJson(jsonPath, { drawing_plan: config.drawing_plan });
        planArg = ` --plan "${jsonPath}"`;
        runLog.artifacts.plan = jsonPath;
        endStage(planStage, 'ok', { format: 'json_fallback' });
      }
    } else {
      addSkippedStage(runLog, 'save_plan', 'no drawing_plan');
    }

    for (const svgPath of svgPaths) {
      const reportJson = svgPath.replace('.svg', '_repair_report.json');
      const qaJson = svgPath.replace('.svg', '_qa.json');
      const qaIssuesJson = svgPath.replace('.svg', '_qa_issues.json');

      // Step 2a: QA before (on raw SVG)
      let qaBefore = null;
      if (!flags.includes('--no-score') && !flags.includes('--raw')) {
        const qaBeforeStage = beginStage(runLog, 'qa_before', { svg: svgPath });
        try {
          const qaBeforeJson = svgPath.replace('.svg', '_qa_before.json');
          execSync(
            `python3 "${qaScript}" "${svgPath}" --json "${qaBeforeJson}"${planArg}`,
            { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }
          );
          qaBefore = JSON.parse(readFileSync(qaBeforeJson, 'utf-8'));
          endStage(qaBeforeStage, 'ok', { score: qaBefore.score ?? null });
        } catch (e) {
          console.error(`  QA before warning: ${e.message}`);
          endStage(qaBeforeStage, 'warning', { warning: e.message });
        }
      }

      // Step 2b: SVG Post-Processing
      if (!flags.includes('--raw')) {
        const postStage = beginStage(runLog, 'postprocess_svg', { svg: svgPath });
        console.log('\nPost-processing SVG...');
        try {
          const strokeProfile = (config.drawing_plan?.style?.stroke_profile) || 'ks';
          const ppOut = execSync(
            `python3 "${ppScript}" "${svgPath}" -o "${svgPath}" --report "${reportJson}" --profile ${strokeProfile}${planArg}`,
            { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }
          );
          if (ppOut.trim()) console.log(ppOut.trim());
          // S3a: Inject plan metadata into repair report
          try {
            const rr = JSON.parse(readFileSync(reportJson, 'utf-8'));
            rr.plan = config.drawing_plan
              ? { used: true, template: config.drawing_plan.part_type || 'unknown', part_type: config.drawing_plan.part_type || 'unknown' }
              : { used: false };
            writeJson(reportJson, rr);
          } catch (_) { /* report may not exist yet */ }
          endStage(postStage, 'ok');
        } catch (e) {
          console.error(`  Post-process warning: ${e.message}`);
          endStage(postStage, 'warning', { warning: e.message });
        }
      } else {
        addSkippedStage(runLog, 'postprocess_svg', '--raw');
      }

      // Step 3: QA after + merge into repair report
      if (!flags.includes('--no-score')) {
        const qaStage = beginStage(runLog, 'qa_after', { svg: svgPath });
        console.log('\nQA Scoring...');
        try {
          const qaOut = execSync(
            `python3 "${qaScript}" "${svgPath}" --json "${qaJson}"${planArg}${failUnder}`,
            { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }
          );
          if (qaOut.trim()) console.log(qaOut.trim());

          const qaAfter = JSON.parse(readFileSync(qaJson, 'utf-8'));
          let repairReport = null;
          if (existsSync(reportJson)) {
            repairReport = JSON.parse(readFileSync(reportJson, 'utf-8'));
          }

          // Merge qa_diff into repair report
          if (!flags.includes('--raw') && qaBefore && repairReport) {
            try {
              const beforeMetrics = qaBefore.metrics || {};
              const afterMetrics = qaAfter.metrics || {};
              const delta = {};
              for (const key of Object.keys(beforeMetrics)) {
                const bv = typeof beforeMetrics[key] === 'number' ? beforeMetrics[key] : 0;
                const av = typeof afterMetrics[key] === 'number' ? afterMetrics[key] : 0;
                delta[key] = av - bv;
              }
              repairReport.qa_diff = {
                before: { score: qaBefore.score, metrics: beforeMetrics },
                after: { score: qaAfter.score, metrics: afterMetrics },
                delta: { score: (qaAfter.score || 0) - (qaBefore.score || 0), metrics: delta },
                gate: {
                  fail_under: failUnder ? parseInt(flags[failIdx + 1]) : null,
                  passed: !failUnder || (qaAfter.score || 0) >= parseInt(flags[failIdx + 1]),
                },
              };
              writeJson(reportJson, repairReport);
              console.log(`  QA diff: ${qaBefore.score} → ${qaAfter.score} (${qaAfter.score - qaBefore.score >= 0 ? '+' : ''}${qaAfter.score - qaBefore.score})`);
              // Clean up temporary before file
              try { unlinkSync(svgPath.replace('.svg', '_qa_before.json')); } catch {}
            } catch (mergeErr) {
              console.error(`  QA merge warning: ${mergeErr.message}`);
            }
          }

          // Emit normalized issue model for QA findings
          try {
            const issueReport = buildQaIssueReport(qaAfter, repairReport);
            writeJson(qaIssuesJson, issueReport);
            runLog.artifacts.qa_issues = runLog.artifacts.qa_issues || [];
            runLog.artifacts.qa_issues.push(qaIssuesJson);
            console.log(`  QA issues: ${qaIssuesJson}`);
          } catch (issueErr) {
            console.error(`  QA issue report warning: ${issueErr.message}`);
          }

          endStage(qaStage, 'ok', { score: qaAfter.score ?? null });
        } catch (e) {
          if (e.status) {
            const msg = (e.stdout || e.message || '').toString().trim();
            console.error(msg);
            endStage(qaStage, 'failed', { error: msg });
            throw new Error(msg || 'QA scoring failed');
          }
          console.error(`  QA warning: ${e.message}`);
          endStage(qaStage, 'warning', { warning: e.message });
        }
      } else {
        addSkippedStage(runLog, 'qa_after', '--no-score');
      }
    }

    runLog.status = 'success';
    return result;
  } catch (err) {
    runLog.status = 'failed';
    runLog.error = err.message;
    throw err;
  } finally {
    try {
      mkdirSync(artifactDir, { recursive: true });
      const runLogPath = join(artifactDir, `${artifactStem}_run_log.json`);
      runLog.artifacts = runLog.artifacts || {};
      runLog.artifacts.run_log = runLogPath;
      finalizeRunLog(runLog);
      writeJson(runLogPath, runLog);
      console.log(`  Run log: ${runLogPath}`);
    } catch {
      // Keep draw outcome intact even if log write fails.
    }
  }
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

  const result = await runScript('create_model.py', config, {
    onStderr: (text) => process.stderr.write(text),
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

  const result = await runScript('fem_analysis.py', config, {
    timeout: 300_000,
    onStderr: (text) => process.stderr.write(text),
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
  if (flags.includes('--recommend')) {
    config.tolerance.recommend = true;
  }
  if (flags.includes('--csv')) {
    config.tolerance.csv = true;
  }
  if (flags.includes('--monte-carlo')) {
    config.tolerance.monte_carlo = true;
  }

  const modelName = config.name || 'unnamed';
  console.log(`Tolerance Analysis: ${modelName}`);

  const result = await runScript('tolerance_analysis.py', config, {
    timeout: 120_000,
    onStderr: (text) => process.stderr.write(text),
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

async function cmdReport(configPath, flags = []) {
  if (!configPath) {
    console.error('Error: config file path required');
    console.error('  fcad report configs/examples/ptu_assembly_mates.toml');
    process.exit(1);
  }

  const absPath = resolve(configPath);
  console.log(`Loading config: ${absPath}`);
  const config = await loadConfig(absPath);
  const modelName = config.name || 'unnamed';

  const includeTolerance = !flags.includes('--no-tolerance');
  const includeFem = flags.includes('--fem');
  const includeMC = flags.includes('--monte-carlo');

  const reportInput = { ...config };

  // Step 1: Run tolerance analysis if needed
  if (includeTolerance && config.assembly) {
    console.log('Running tolerance analysis...');
    config.tolerance = config.tolerance || {};
    if (includeMC) config.tolerance.monte_carlo = true;

    const tolResult = await runScript('tolerance_analysis.py', config, {
      timeout: 120_000,
      onStderr: (text) => process.stderr.write(text),
    });
    if (tolResult.success) {
      reportInput.tolerance_results = {
        pairs: tolResult.pairs,
        stack_up: tolResult.stack_up,
      };
      if (tolResult.monte_carlo) {
        reportInput.monte_carlo_results = tolResult.monte_carlo;
      }
      console.log(`  ${tolResult.pairs?.length || 0} tolerance pair(s) analyzed`);
    }
  }

  // Step 2: Run FEM analysis if requested
  if (includeFem) {
    console.log('Running FEM analysis...');
    const femResult = await runScript('fem_analysis.py', config, {
      timeout: 300_000,
      onStderr: (text) => process.stderr.write(text),
    });
    if (femResult.success) {
      reportInput.fem_results = femResult.results;
      console.log(`  FEM complete: safety factor = ${femResult.results?.safety_factor || '?'}`);
    }
  }

  // Step 3: Generate PDF report
  console.log('Generating PDF report...');
  const result = await runScript('engineering_report.py', reportInput, {
    timeout: 60_000,
    onStderr: (text) => process.stderr.write(text),
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

  const result = await runScript('inspect_model.py', { file: absPath }, {
    onStderr: (text) => process.stderr.write(text),
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

import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { stringify as tomlStringify } from 'smol-toml';
import {
  applyOverrideConfig,
  compileDrawingPlan,
  ensureDrawingViews,
  ensureDrawSchema,
} from './drawing-prep.js';
import {
  buildDrawingQualitySummary,
  parseBomCsv,
  resolveDrawingQualityPath,
  shouldFailDrawingQualityGate,
  writeDrawingQualitySummary,
} from '../services/drawing/drawing-quality-summary.js';
import {
  buildExtractedDrawingSemantics,
  resolveExtractedDrawingSemanticsPath,
  writeExtractedDrawingSemantics,
} from '../services/drawing/extracted-drawing-semantics.js';
import {
  buildDrawingPlanner,
  refineDrawingPlannerWithExtractedCoverage,
  writeDrawingPlanner,
} from '../services/drawing/drawing-planner.js';

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
  const svgPath = (result?.drawing_paths || []).find((dp) => dp.format === 'svg')?.path;
  if (svgPath) {
    const normalized = svgPath.replace(/\\/g, '/');
    const name = normalized.split('/').pop() || '';
    return name.replace(/_drawing\.svg$/i, '').replace(/\.svg$/i, '') || (config.name || 'unnamed');
  }
  return config.name || 'unnamed';
}

function resolveArtifactDir(config, result, projectRoot) {
  const svgPath = (result?.drawing_paths || []).find((dp) => dp.format === 'svg')?.path;
  if (svgPath) {
    const normalized = svgPath.replace(/\\/g, '/');
    return resolve(dirname(normalized));
  }
  return resolve(config?.export?.directory || join(projectRoot, 'output'));
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
    .filter((d) => d.feature)
    .map((d) => ({
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
      unresolved_dimensions: links.map((l) => l.dim_id),
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

function buildDedupeDiagnostics(dimensionMap = {}, dimConflicts = {}) {
  const autoDims = Array.isArray(dimensionMap.auto_dimensions) ? dimensionMap.auto_dimensions : [];
  const planDims = Array.isArray(dimensionMap.plan_dimensions) ? dimensionMap.plan_dimensions : [];
  const conflicts = Array.isArray(dimConflicts.conflicts) ? dimConflicts.conflicts : [];

  const skipped = planDims.filter((d) => d.status === 'skipped_duplicate');
  const rendered = planDims.filter((d) => d.rendered);
  const byReason = {};
  const byBucket = {};
  const byAutoCategory = {};
  for (const d of skipped) {
    const reason = d.reason || 'unknown';
    byReason[reason] = (byReason[reason] || 0) + 1;
    const bucket = d.dedupe_match?.bucket || 'unknown';
    byBucket[bucket] = (byBucket[bucket] || 0) + 1;
    const cat = d.dedupe_match?.auto_category || 'unknown';
    byAutoCategory[cat] = (byAutoCategory[cat] || 0) + 1;
  }

  const crossView = conflicts.filter((c) => c.reason === 'cross_view_redundant');
  const planVsAuto = conflicts.filter((c) => c.reason === 'plan_dim_skipped_due_to_auto_match');

  return {
    schema_version: '0.1',
    generated_at: nowIso(),
    summary: {
      auto_dimension_count: autoDims.length,
      plan_dimension_count: planDims.length,
      plan_rendered_count: rendered.length,
      plan_skipped_duplicate_count: skipped.length,
      cross_view_redundant_count: crossView.length,
      plan_vs_auto_duplicate_count: planVsAuto.length,
      by_reason: byReason,
      by_bucket: byBucket,
      by_auto_category: byAutoCategory,
    },
    plan_skipped_duplicates: skipped.map((d) => ({
      dim_id: d.dim_id,
      feature: d.feature || null,
      view: d.view || null,
      value_mm: d.value_mm ?? null,
      reason: d.reason || null,
      dedupe_match: d.dedupe_match || null,
    })),
    cross_view_redundant_conflicts: crossView,
    plan_vs_auto_conflicts: planVsAuto,
  };
}

export async function runDrawPipeline({
  projectRoot,
  configPath,
  flags = [],
  overridePath = null,
  failUnderValue = null,
  weightsPresetValue = null,
  strictQuality = false,
  loadConfig,
  deepMerge,
  generateDrawing,
  runScript,
  onInfo = () => {},
  onError = () => {},
}) {
  const absPath = resolve(configPath);
  onInfo(`Loading config: ${absPath}`);

  const runLog = initRunLog('draw', absPath);
  let artifactDir = join(projectRoot, 'output');
  let artifactStem = 'unnamed';

  try {
    const loadStage = beginStage(runLog, 'load_config');
    const config = await loadConfig(absPath);
    ensureDrawSchema(config);
    artifactStem = config.name || artifactStem;
    endStage(loadStage, 'ok', { model_name: artifactStem });

    if (overridePath) {
      const overrideStage = beginStage(runLog, 'apply_override', { path: resolve(overridePath) });
      const absOverridePath = await applyOverrideConfig({
        config,
        overridePath,
        loadConfig,
        deepMerge,
      });
      onInfo(`  Override: ${absOverridePath}`);
      endStage(overrideStage, 'ok');
    }

    if (flags.includes('--bom')) {
      config.drawing.bom_csv = true;
    }

    ensureDrawingViews(config);

    if (!flags.includes('--no-plan')) {
      const planStage = beginStage(runLog, 'intent_compile');
      try {
        const planResult = compileDrawingPlan({
          projectRoot,
          config,
        });
        onInfo(`  Plan: ${planResult.partType} template applied`);
        endStage(planStage, 'ok', { part_type: planResult.partType });
      } catch (error) {
        const message = error.stderr ? error.stderr.toString().trim() : error.message;
        onError(`  Plan warning: ${message} (falling back to default)`);
        endStage(planStage, 'warning', { warning: message });
      }
    } else {
      addSkippedStage(runLog, 'intent_compile', '--no-plan');
    }

    const modelName = config.name || 'unnamed';
    artifactStem = modelName;
    onInfo(`Generating drawing: ${modelName}`);
    onInfo(`  Views: ${config.drawing.views.join(', ')}`);

    const drawStage = beginStage(runLog, 'generate_drawing', { views: config.drawing.views });
    let result;
    try {
      result = await generateDrawing({
        freecadRoot: projectRoot,
        runScript,
        loadConfig,
        deepMerge,
        config,
        postprocess: false,
        qa: false,
      });
      endStage(drawStage, 'ok', {
        scale: result.scale,
        views_generated: result.views?.length || 0,
      });
    } catch (error) {
      endStage(drawStage, 'failed', { error: error.message });
      throw error;
    }

    if (!result.success) {
      throw new Error(result.error || 'generate_drawing.py returned success=false');
    }

    artifactDir = resolveArtifactDir(config, result, projectRoot);
    artifactStem = resolveArtifactStem(config, result);
    mkdirSync(artifactDir, { recursive: true });

    onInfo('\nDrawing generated!');
    onInfo(`  Scale: ${result.scale}`);
    onInfo(`  Views: ${result.views.join(', ')}`);
    for (const dp of result.drawing_paths) {
      onInfo(`  ${dp.format.toUpperCase()}: ${dp.path} (${dp.size_bytes} bytes)`);
    }
    if (result.bom?.length > 0) {
      onInfo(`\n  BOM (${result.bom.length} items):`);
      for (const item of result.bom) {
        const joint = item.joint ? ` [${item.joint.type}: ${item.joint.id}]` : '';
        onInfo(`    ${item.id}: ${item.material} ${item.dimensions}${joint}`);
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
      const dedupePath = join(artifactDir, `${artifactStem}_dedupe_diagnostics.json`);

      writeJson(traceabilityPath, traceability);
      writeJson(layoutPath, layoutReport);
      writeJson(dimMapPath, dimensionMap);
      writeJson(conflictPath, dimConflicts);
      writeJson(dedupePath, buildDedupeDiagnostics(dimensionMap, dimConflicts));

      runLog.artifacts.traceability = traceabilityPath;
      runLog.artifacts.layout_report = layoutPath;
      runLog.artifacts.dimension_map = dimMapPath;
      runLog.artifacts.dim_conflicts = conflictPath;
      runLog.artifacts.dedupe_diagnostics = dedupePath;
      endStage(persistStage, 'ok', { count: 5 });
    } catch (error) {
      endStage(persistStage, 'warning', { warning: error.message });
    }

    const svgPaths = (result.drawing_paths || [])
      .filter((dp) => dp.format === 'svg')
      .map((dp) => dp.path.replace(/\\/g, '/'));
    const qaScript = join(projectRoot, 'scripts', 'qa_scorer.py');
    const postprocessScript = join(projectRoot, 'scripts', 'postprocess_svg.py');
    const failUnder = failUnderValue ? ` --fail-under ${failUnderValue}` : '';
    const qaWeightPreset = weightsPresetValue || config.drawing_plan?.dimensioning?.qa_weight_preset || '';
    const qaWeightArg = qaWeightPreset ? ` --weights-preset ${qaWeightPreset}` : '';
    let configArg = '';
    let latestQaReport = null;
    let latestQaIssues = null;

    const configStage = beginStage(runLog, 'persist_effective_config');
    try {
      const effectiveConfigPath = join(artifactDir, `${artifactStem}_effective_config.json`);
      writeJson(effectiveConfigPath, config);
      runLog.artifacts.effective_config = effectiveConfigPath;
      configArg = ` --config "${effectiveConfigPath}"`;
      endStage(configStage, 'ok');
    } catch (error) {
      onError(`  Effective config artifact warning: ${error.message}`);
      endStage(configStage, 'warning', { warning: error.message });
    }

    let planArg = '';
    if (config.drawing_plan) {
      const planStage = beginStage(runLog, 'save_plan');
      const planPath = join(artifactDir, `${artifactStem}_plan.toml`);
      try {
        writeFileSync(planPath, tomlStringify({ drawing_plan: config.drawing_plan }));
        planArg = ` --plan "${planPath}"`;
        runLog.artifacts.plan = planPath;
        endStage(planStage, 'ok');
      } catch (tomlError) {
        onError(`  TOML stringify failed, falling back to JSON: ${tomlError.message}`);
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

      let qaBefore = null;
      if (!flags.includes('--no-score') && !flags.includes('--raw')) {
        const qaBeforeStage = beginStage(runLog, 'qa_before', { svg: svgPath });
        try {
          const qaBeforeJson = svgPath.replace('.svg', '_qa_before.json');
          execSync(
            `python3 "${qaScript}" "${svgPath}" --json "${qaBeforeJson}"${planArg}${configArg}`,
            { cwd: projectRoot, encoding: 'utf-8', timeout: 30_000 }
          );
          qaBefore = JSON.parse(readFileSync(qaBeforeJson, 'utf-8'));
          endStage(qaBeforeStage, 'ok', { score: qaBefore.score ?? null });
        } catch (error) {
          onError(`  QA before warning: ${error.message}`);
          endStage(qaBeforeStage, 'warning', { warning: error.message });
        }
      }

      if (!flags.includes('--raw')) {
        const postStage = beginStage(runLog, 'postprocess_svg', { svg: svgPath });
        onInfo('\nPost-processing SVG...');
        try {
          const strokeProfile = config.drawing_plan?.style?.stroke_profile || 'ks';
          const postprocessOutput = execSync(
            `python3 "${postprocessScript}" "${svgPath}" -o "${svgPath}" --report "${reportJson}" --profile ${strokeProfile}${planArg}`,
            { cwd: projectRoot, encoding: 'utf-8', timeout: 30_000 }
          );
          if (postprocessOutput.trim()) onInfo(postprocessOutput.trim());
          try {
            const repairReport = JSON.parse(readFileSync(reportJson, 'utf-8'));
            repairReport.plan = config.drawing_plan
              ? {
                used: true,
                template: config.drawing_plan.part_type || 'unknown',
                part_type: config.drawing_plan.part_type || 'unknown',
              }
              : { used: false };
            writeJson(reportJson, repairReport);
          } catch {
            // report may not exist yet
          }
          endStage(postStage, 'ok');
        } catch (error) {
          onError(`  Post-process warning: ${error.message}`);
          endStage(postStage, 'warning', { warning: error.message });
        }
      } else {
        addSkippedStage(runLog, 'postprocess_svg', '--raw');
      }

      if (!flags.includes('--no-score')) {
        const qaStage = beginStage(runLog, 'qa_after', { svg: svgPath });
        onInfo('\nQA Scoring...');
        try {
          const qaOutput = execSync(
            `python3 "${qaScript}" "${svgPath}" --json "${qaJson}"${planArg}${configArg}${qaWeightArg}${failUnder}`,
            { cwd: projectRoot, encoding: 'utf-8', timeout: 30_000 }
          );
          if (qaOutput.trim()) onInfo(qaOutput.trim());

          const qaAfter = JSON.parse(readFileSync(qaJson, 'utf-8'));
          latestQaReport = qaAfter;
          let repairReport = null;
          if (existsSync(reportJson)) {
            repairReport = JSON.parse(readFileSync(reportJson, 'utf-8'));
          }

          if (!flags.includes('--raw') && qaBefore && repairReport) {
            try {
              const beforeMetrics = qaBefore.metrics || {};
              const afterMetrics = qaAfter.metrics || {};
              const delta = {};
              for (const key of Object.keys(beforeMetrics)) {
                const beforeValue = typeof beforeMetrics[key] === 'number' ? beforeMetrics[key] : 0;
                const afterValue = typeof afterMetrics[key] === 'number' ? afterMetrics[key] : 0;
                delta[key] = afterValue - beforeValue;
              }
              repairReport.qa_diff = {
                before: { score: qaBefore.score, metrics: beforeMetrics },
                after: { score: qaAfter.score, metrics: afterMetrics },
                delta: {
                  score: (qaAfter.score || 0) - (qaBefore.score || 0),
                  metrics: delta,
                },
                gate: {
                  fail_under: failUnderValue ? parseInt(failUnderValue, 10) : null,
                  passed: !failUnderValue || (qaAfter.score || 0) >= parseInt(failUnderValue, 10),
                },
              };
              writeJson(reportJson, repairReport);
              onInfo(`  QA diff: ${qaBefore.score} → ${qaAfter.score} (${qaAfter.score - qaBefore.score >= 0 ? '+' : ''}${qaAfter.score - qaBefore.score})`);
              try {
                unlinkSync(svgPath.replace('.svg', '_qa_before.json'));
              } catch (cleanupError) {
                if (cleanupError?.code !== 'ENOENT') {
                  throw cleanupError;
                }
              }
            } catch (mergeError) {
              onError(`  QA merge warning: ${mergeError.message}`);
            }
          }

          try {
            const issueReport = buildQaIssueReport(qaAfter, repairReport);
            writeJson(qaIssuesJson, issueReport);
            latestQaIssues = issueReport;
            runLog.artifacts.qa_issues = runLog.artifacts.qa_issues || [];
            runLog.artifacts.qa_issues.push(qaIssuesJson);
            onInfo(`  QA issues: ${qaIssuesJson}`);
          } catch (issueError) {
            onError(`  QA issue report warning: ${issueError.message}`);
          }

          endStage(qaStage, 'ok', { score: qaAfter.score ?? null });
        } catch (error) {
          if (error.status) {
            const message = (error.stdout || error.message || '').toString().trim();
            onError(message);
            endStage(qaStage, 'failed', { error: message });
            throw new Error(message || 'QA scoring failed');
          }
          onError(`  QA warning: ${error.message}`);
          endStage(qaStage, 'warning', { warning: error.message });
        }
      } else {
        addSkippedStage(runLog, 'qa_after', '--no-score');
      }
    }

    const qualityStage = beginStage(runLog, 'drawing_quality_summary');
    try {
      const primarySvgPath = svgPaths[0] || null;
      const qaJsonPath = primarySvgPath ? primarySvgPath.replace('.svg', '_qa.json') : null;
      const qaIssuesJsonPath = primarySvgPath ? primarySvgPath.replace('.svg', '_qa_issues.json') : null;
      const traceabilityPath = runLog.artifacts.traceability || join(artifactDir, `${artifactStem}_traceability.json`);
      const layoutPath = runLog.artifacts.layout_report || join(artifactDir, `${artifactStem}_layout_report.json`);
      const dimMapPath = runLog.artifacts.dimension_map || join(artifactDir, `${artifactStem}_dimension_map.json`);
      const conflictPath = runLog.artifacts.dim_conflicts || join(artifactDir, `${artifactStem}_dim_conflicts.json`);
      const plannerPath = join(artifactDir, `${artifactStem}_drawing_planner.json`);
      const bomPath = result.drawing_paths?.find((entry) => entry.format === 'csv')?.path || null;

      const qaReport = latestQaReport || (qaJsonPath && existsSync(qaJsonPath)
        ? JSON.parse(readFileSync(qaJsonPath, 'utf8'))
        : null);
      const qaIssues = latestQaIssues || (qaIssuesJsonPath && existsSync(qaIssuesJsonPath)
        ? JSON.parse(readFileSync(qaIssuesJsonPath, 'utf8'))
        : null);
      const traceability = traceabilityPath && existsSync(traceabilityPath)
        ? JSON.parse(readFileSync(traceabilityPath, 'utf8'))
        : result.traceability || null;
      const layoutReport = layoutPath && existsSync(layoutPath)
        ? JSON.parse(readFileSync(layoutPath, 'utf8'))
        : result.layout_report || null;
      const dimensionMap = dimMapPath && existsSync(dimMapPath)
        ? JSON.parse(readFileSync(dimMapPath, 'utf8'))
        : result.dimension_map || null;
      const dimConflicts = conflictPath && existsSync(conflictPath)
        ? JSON.parse(readFileSync(conflictPath, 'utf8'))
        : result.dim_conflicts || null;
      const bomRows = bomPath && existsSync(bomPath)
        ? parseBomCsv(readFileSync(bomPath, 'utf8'))
        : [];
      const svgContent = primarySvgPath && existsSync(primarySvgPath)
        ? readFileSync(primarySvgPath, 'utf8')
        : result.svgContent || null;
      const drawingPlanner = buildDrawingPlanner({
        config,
        drawingIntent: config.drawing_intent || config.drawing_plan || null,
        traceability,
        dimensionMap,
        artifactRefs: {
          input_config: absPath,
          drawing_svg: primarySvgPath,
          plan: runLog.artifacts.plan || null,
          traceability: traceabilityPath,
          dimension_map: dimMapPath,
          dim_conflicts: conflictPath,
        },
      });
      await writeDrawingPlanner(plannerPath, drawingPlanner);
      runLog.artifacts.drawing_planner = plannerPath;
      result.drawing_planner = drawingPlanner;
      result.drawing_planner_path = plannerPath;
      const extractedDrawingSemanticsPath = primarySvgPath
        ? resolveExtractedDrawingSemanticsPath(primarySvgPath)
        : join(artifactDir, `${artifactStem}_extracted_drawing_semantics.json`);
      const extractedDrawingSemantics = buildExtractedDrawingSemantics({
        drawingSvgPath: primarySvgPath,
        svgContent,
        layoutReportPath: layoutPath,
        layoutReport,
        dimensionMapPath: dimMapPath,
        dimensionMap,
        traceabilityPath,
        traceability,
        drawingIntent: config.drawing_intent || null,
      });
      await writeExtractedDrawingSemantics(
        extractedDrawingSemanticsPath,
        extractedDrawingSemantics
      );
      runLog.artifacts.extracted_drawing_semantics = extractedDrawingSemanticsPath;
      result.extracted_drawing_semantics = extractedDrawingSemantics;
      result.extracted_drawing_semantics_path = extractedDrawingSemanticsPath;

      const drawingQuality = buildDrawingQualitySummary({
        inputConfigPath: absPath,
        drawingSvgPath: primarySvgPath,
        planPath: runLog.artifacts.plan || null,
        plan: config.drawing_plan || null,
        qaPath: qaJsonPath,
        qaReport,
        qaIssuesPath: qaIssuesJsonPath,
        qaIssues,
        traceabilityPath,
        traceability,
        layoutReportPath: layoutPath,
        layoutReport,
        plannerPath,
        planner: drawingPlanner,
        dimensionMapPath: dimMapPath,
        dimensionMap,
        dimConflictsPath: conflictPath,
        dimConflicts,
        drawingIntent: config.drawing_intent || null,
        featureCatalog: config.feature_catalog || null,
        bomPath,
        bomEntries: result.bom || [],
        bomRows,
        generatedViews: result.views || [],
        svgContent,
        extractedDrawingSemanticsPath,
        extractedDrawingSemantics,
      });
      const refinedDrawingPlanner = refineDrawingPlannerWithExtractedCoverage({
        planner: drawingPlanner,
        drawingIntent: config.drawing_intent || null,
        featureCatalog: config.feature_catalog || null,
        extractedEvidence: drawingQuality.semantic_quality?.extracted_evidence || null,
      });
      await writeDrawingPlanner(plannerPath, refinedDrawingPlanner);
      runLog.artifacts.drawing_planner = plannerPath;
      result.drawing_planner = refinedDrawingPlanner;
      result.drawing_planner_path = plannerPath;
      drawingQuality.drawing_planner = refinedDrawingPlanner;
      const drawingQualityPath = primarySvgPath ? resolveDrawingQualityPath(primarySvgPath) : join(artifactDir, `${artifactStem}_drawing_quality.json`);
      await writeDrawingQualitySummary(drawingQualityPath, drawingQuality);
      runLog.artifacts.drawing_quality = drawingQualityPath;
      result.drawing_quality = drawingQuality;
      result.drawing_quality_path = drawingQualityPath;
      onInfo(`  Drawing quality: ${drawingQualityPath}`);
      onInfo(`  Drawing quality status: ${drawingQuality.status} (score=${drawingQuality.score ?? 'n/a'})`);
      endStage(qualityStage, 'ok', {
        status: drawingQuality.status,
        score: drawingQuality.score ?? null,
      });

      if (shouldFailDrawingQualityGate(drawingQuality, { strictQuality })) {
        const reasons = drawingQuality.blocking_issues.map((issue) => issue.message).join(' | ');
        const gateError = new Error(`Strict drawing quality gate failed: ${reasons}`);
        gateError.result = result;
        throw gateError;
      }
    } catch (error) {
      endStage(qualityStage, strictQuality ? 'failed' : 'warning', { warning: error.message });
      if (strictQuality) {
        throw error;
      }
      onError(`  Drawing quality warning: ${error.message}`);
    }

    runLog.status = 'success';
    return result;
  } catch (error) {
    runLog.status = 'failed';
    runLog.error = error.message;
    throw error;
  } finally {
    try {
      mkdirSync(artifactDir, { recursive: true });
      const runLogPath = join(artifactDir, `${artifactStem}_run_log.json`);
      runLog.artifacts = runLog.artifacts || {};
      runLog.artifacts.run_log = runLogPath;
      finalizeRunLog(runLog);
      writeJson(runLogPath, runLog);
      onInfo(`  Run log: ${runLogPath}`);
    } catch {
      // Keep draw outcome intact even if log write fails.
    }
  }
}

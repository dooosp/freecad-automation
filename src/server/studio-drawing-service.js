import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseTOML } from 'smol-toml';

import { deepMerge } from '../../lib/config-loader.js';
import { validateConfigDocument } from '../../lib/config-schema.js';
import { updateDimIntent, readDimIntents } from '../../lib/toml-writer.js';
import { runScript } from '../../lib/runner.js';
import { createDrawingService } from '../api/drawing.js';
import {
  compileDrawingPlan,
  ensureDrawingViews,
  ensureDrawSchema,
  loadDrawingPlan,
  saveDrawingPlan,
} from '../orchestration/drawing-prep.js';
import {
  applyStudioDrawingSettings,
  DEFAULT_STUDIO_DRAWING_SCALE,
  normalizeStudioDrawingSettings,
} from './studio-drawing-config.js';

function readJsonIfExists(path) {
  if (!path) return Promise.resolve(null);
  return readFile(path, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
}

function asTextList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function buildConfigOverview(config = {}) {
  const partCount = Array.isArray(config.parts) ? config.parts.length : 0;
  const shapeCount = Array.isArray(config.shapes) ? config.shapes.length : 0;
  return {
    name: config.name || 'unnamed',
    part_count: partCount,
    shape_count: shapeCount,
    views: Array.isArray(config.drawing?.views) ? config.drawing.views : [],
    scale: config.drawing?.scale || DEFAULT_STUDIO_DRAWING_SCALE,
  };
}

function inferArtifactPaths(svgPath, planPath = '') {
  if (!svgPath) {
    return {
      drawing: null,
      qa: null,
      repair_report: null,
      run_log: null,
      effective_config: null,
      plan_toml: planPath || null,
      plan_json: null,
      traceability: null,
      layout_report: null,
      dimension_map: null,
      dim_conflicts: null,
    };
  }

  const normalized = resolve(String(svgPath));
  const dir = dirname(normalized);
  const stem = basename(normalized).replace(/_drawing\.svg$/i, '').replace(/\.svg$/i, '');
  return {
    drawing: normalized,
    qa: normalized.replace(/\.svg$/i, '_qa.json'),
    repair_report: normalized.replace(/\.svg$/i, '_repair_report.json'),
    run_log: join(dir, `${stem}_run_log.json`),
    effective_config: join(dir, `${stem}_effective_config.json`),
    plan_toml: planPath || join(dir, `${stem}_plan.toml`),
    plan_json: join(dir, `${stem}_plan.json`),
    traceability: join(dir, `${stem}_traceability.json`),
    layout_report: join(dir, `${stem}_layout_report.json`),
    dimension_map: join(dir, `${stem}_dimension_map.json`),
    dim_conflicts: join(dir, `${stem}_dim_conflicts.json`),
  };
}

function buildQaSummary({
  qa = null,
  dimensionMap = null,
  dimConflicts = null,
  dimensions = [],
}) {
  const summary = dimensionMap?.summary || {};
  const conflicts = Array.isArray(dimConflicts?.conflicts) ? dimConflicts.conflicts : [];
  return {
    score: qa?.score ?? null,
    weight_profile: qa?.weightProfile || null,
    planned_dimension_count: summary.plan_dimension_count ?? dimensions.length,
    rendered_dimension_count: summary.plan_rendered_count ?? null,
    auto_dimension_count: summary.auto_dimension_count ?? null,
    conflict_count: dimConflicts?.summary?.count ?? conflicts.length,
  };
}

function buildAnnotationSummary(config = {}) {
  const notes = [];
  const planNotes = config.drawing_plan?.notes || {};
  const drawingNotes = config.drawing?.notes || {};

  notes.push(...asTextList(planNotes.general));

  Object.entries(drawingNotes).forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    notes.push(`${key.replace(/_/g, ' ')}: ${normalized}`);
  });

  (config.drawing_plan?.dim_intents || [])
    .filter((intent) => intent?.style === 'note' || intent?.view === 'notes')
    .forEach((intent) => {
      const label = intent.label || intent.feature || intent.id;
      if (label) notes.push(String(label));
    });

  return [...new Set(notes)].slice(0, 8);
}

export function createStudioDrawingService({
  projectRoot,
  mkdtempFn = mkdtemp,
  rmFn = rm,
  generateDrawing = createDrawingService(),
  updateDimIntentFn = updateDimIntent,
  readDimIntentsFn = readDimIntents,
  compileDrawingPlanFn = compileDrawingPlan,
  saveDrawingPlanFn = saveDrawingPlan,
  loadDrawingPlanFn = loadDrawingPlan,
}) {
  const previews = new Map();

  async function cleanupPreview(id) {
    const preview = previews.get(id);
    if (!preview) return;
    previews.delete(id);
    await rmFn(preview.previewDir, { recursive: true, force: true }).catch(() => {});
  }

  async function trimPreviews(maxEntries = 6) {
    while (previews.size > maxEntries) {
      const [oldestId] = previews.keys();
      await cleanupPreview(oldestId);
    }
  }

  function parseAndValidateConfigToml(configToml) {
    const raw = parseTOML(configToml);
    const validation = validateConfigDocument(raw, { filepath: 'studio:drawing-preview' });
    return {
      config: validation.config,
      summary: validation.summary,
      valid: validation.valid,
      overview: buildConfigOverview(validation.config),
    };
  }

  function createLoggedRunner(logs) {
    return (script, input, options = {}) => runScript(script, input, {
      ...options,
      onStderr: (text) => {
        const trimmed = String(text || '').trim();
        if (trimmed) logs.push(trimmed);
        if (typeof options.onStderr === 'function') options.onStderr(text);
      },
    });
  }

  async function renderPreview({
    configToml,
    drawingSettings = {},
    previewId = randomUUID(),
    previewDir = null,
    planPath = '',
  }) {
    const source = String(configToml || '').trim();
    if (!source) {
      throw new Error('Config TOML is required.');
    }

    let parsed;
    try {
      parsed = parseAndValidateConfigToml(source);
    } catch (error) {
      throw new Error(`TOML parse error: ${error instanceof Error ? error.message : String(error)}`);
    }

    const { config, summary, overview, valid } = parsed;
    if (!valid) {
      throw new Error(summary.errors.join(' | '));
    }

    const nextPreviewDir = previewDir || await mkdtempFn(join(tmpdir(), 'fcad-studio-drawing-'));
    const logs = [];

    try {
      ensureDrawSchema(config);
      ensureDrawingViews(config);

      if (planPath) {
        await loadDrawingPlanFn({
          config,
          planPath,
        });
      } else if (!config.drawing_plan) {
        try {
          compileDrawingPlanFn({
            projectRoot,
            config,
          });
        } catch (error) {
          logs.push(`Drawing plan compiler warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const settings = normalizeStudioDrawingSettings(drawingSettings, config);
      applyStudioDrawingSettings(config, settings);

      const stablePlanPath = config.drawing_plan
        ? await saveDrawingPlanFn({
            drawingPlan: config.drawing_plan,
            outputDir: nextPreviewDir,
            planPath: planPath || join(nextPreviewDir, `${config.name || 'unnamed'}_plan.toml`),
            modelName: config.name || 'unnamed',
          })
        : '';

      config.export = {
        formats: [],
        directory: nextPreviewDir,
      };

      const result = await generateDrawing({
        freecadRoot: projectRoot,
        runScript: createLoggedRunner(logs),
        loadConfig: async () => config,
        deepMerge,
        config,
        postprocess: true,
        qa: true,
      });

      if (!result?.success) {
        throw new Error(result?.error || 'Drawing generation failed.');
      }

      const svgPath = result.svg_path
        || result.drawing_path
        || result.drawing_paths?.find((entry) => entry.format === 'svg')?.path
        || '';
      const artifactPaths = inferArtifactPaths(svgPath, stablePlanPath);
      const dimensions = stablePlanPath ? await readDimIntentsFn(stablePlanPath) : [];
      const dimensionMap = result.dimension_map || await readJsonIfExists(artifactPaths.dimension_map);
      const dimConflicts = result.dim_conflicts || await readJsonIfExists(artifactPaths.dim_conflicts);
      const layoutReport = result.layout_report || await readJsonIfExists(artifactPaths.layout_report);
      const traceability = result.traceability || await readJsonIfExists(artifactPaths.traceability);
      const repairReport = await readJsonIfExists(artifactPaths.repair_report);
      const runLog = await readJsonIfExists(artifactPaths.run_log);

      const preview = {
        id: previewId,
        drawn_at: new Date().toISOString(),
        settings,
        overview: {
          ...overview,
          views: result.views || settings.views,
          scale: result.scale || settings.scale,
        },
        validation: {
          warnings: summary.warnings,
          changed_fields: summary.changed_fields,
          deprecated_fields: summary.deprecated_fields,
        },
        logs,
        svg: result.svgContent || '',
        bom: Array.isArray(result.bom) ? result.bom : [],
        views: Array.isArray(result.views) ? result.views : settings.views,
        scale: result.scale || settings.scale,
        plan_path: stablePlanPath || '',
        qa_summary: buildQaSummary({
          qa: result.qa || null,
          dimensionMap,
          dimConflicts,
          dimensions,
        }),
        annotations: buildAnnotationSummary(config),
        dimensions,
        traceability,
        layout_report: layoutReport,
        repair_report: repairReport,
        dimension_map: dimensionMap,
        dim_conflicts: dimConflicts,
        run_log: runLog,
        artifacts: artifactPaths,
      };

      previews.set(previewId, {
        previewDir: nextPreviewDir,
        configToml: source,
        planPath: stablePlanPath,
        settings,
        preview,
      });
      await trimPreviews();

      return { preview };
    } catch (error) {
      if (!previewDir) {
        await rmFn(nextPreviewDir, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  return {
    async dispose() {
      await Promise.allSettled([...previews.keys()].map((id) => cleanupPreview(id)));
    },
    async buildPreview({ configToml, drawingSettings = {} }) {
      return renderPreview({
        configToml,
        drawingSettings,
      });
    },
    async updateDimension({
      previewId,
      dimId,
      valueMm,
      historyOp = 'edit',
    }) {
      const previewRecord = previews.get(previewId);
      if (!previewRecord) {
        throw new Error(`No drawing preview found for id ${previewId}.`);
      }
      if (!previewRecord.planPath) {
        throw new Error('This drawing preview has no editable plan path.');
      }

      const result = await updateDimIntentFn(previewRecord.planPath, dimId, valueMm);
      if (!result.ok) {
        throw new Error(result.error || `Could not update ${dimId}.`);
      }

      const rerendered = await renderPreview({
        configToml: previewRecord.configToml,
        drawingSettings: previewRecord.settings,
        previewId,
        previewDir: previewRecord.previewDir,
        planPath: previewRecord.planPath,
      });

      return {
        update: {
          dim_id: dimId,
          old_value: result.oldValue,
          new_value: valueMm,
          history_op: historyOp,
        },
        preview: rerendered.preview,
      };
    },
  };
}

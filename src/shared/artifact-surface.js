import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

const DRAW_CLI_ENTRIES = Object.freeze([
  Object.freeze({ key: 'drawing', type: 'drawing.svg', label: 'SVG drawing', scope: 'user-facing', stability: 'stable' }),
  Object.freeze({ key: 'qa', type: 'drawing.qa-report', label: 'Drawing QA', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'qa_issues', type: 'drawing.qa-issues', label: 'Drawing QA issues', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'drawing_quality', type: 'drawing.quality-summary', label: 'Drawing quality summary', scope: 'user-facing', stability: 'stable' }),
  Object.freeze({ key: 'drawing_planner', type: 'drawing.planner', label: 'Drawing planner advisory JSON', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'repair_report', type: 'drawing.repair-report', label: 'Repair report', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'run_log', type: 'draw.run-log', label: 'Draw run log', scope: 'internal', stability: 'internal' }),
  Object.freeze({ key: 'effective_config', type: 'config.effective', label: 'Effective config', scope: 'internal', stability: 'internal' }),
  Object.freeze({ key: 'plan_toml', type: 'draw.plan.toml', label: 'Drawing plan TOML', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'plan_json', type: 'draw.plan.json', label: 'Drawing plan JSON', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'traceability', type: 'draw.traceability', label: 'Traceability map', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'layout_report', type: 'draw.layout-report', label: 'Layout report', scope: 'user-facing', stability: 'best-effort' }),
  Object.freeze({ key: 'dimension_map', type: 'draw.dimension-map', label: 'Dimension map', scope: 'internal', stability: 'internal' }),
  Object.freeze({ key: 'dim_conflicts', type: 'draw.dimension-conflicts', label: 'Dimension conflicts', scope: 'internal', stability: 'internal' }),
  Object.freeze({ key: 'dedupe_diagnostics', type: 'draw.dedupe-diagnostics', label: 'Dedupe diagnostics', scope: 'internal', stability: 'internal' }),
]);

const DRAW_TRACKED_JOB_ENTRIES = Object.freeze([
  Object.freeze({ key: 'drawing', type: 'drawing.svg', stability: 'stable', scope: 'user-facing' }),
  Object.freeze({ key: 'qa', type: 'drawing.qa-report', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'qa_issues', type: 'drawing.qa-issues', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'drawing_quality', type: 'drawing.quality-summary', stability: 'stable', scope: 'user-facing' }),
  Object.freeze({ key: 'drawing_intent', type: 'drawing-intent.json', stability: 'stable', scope: 'user-facing' }),
  Object.freeze({ key: 'feature_catalog', type: 'feature-catalog.json', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'extracted_drawing_semantics', type: 'drawing.extracted-semantics', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'drawing_planner', type: 'drawing.planner', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'repair_report', type: 'drawing.repair-report', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'run_log', type: 'draw.run-log', stability: 'internal', scope: 'internal' }),
  Object.freeze({ key: 'effective_config', type: 'config.effective', stability: 'internal', scope: 'internal' }),
  Object.freeze({ key: 'plan_toml', type: 'draw.plan.toml', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'plan_json', type: 'draw.plan.json', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'traceability', type: 'draw.traceability', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'layout_report', type: 'draw.layout-report', stability: 'best-effort', scope: 'user-facing' }),
  Object.freeze({ key: 'dimension_map', type: 'draw.dimension-map', stability: 'internal', scope: 'internal' }),
  Object.freeze({ key: 'dim_conflicts', type: 'draw.dimension-conflicts', stability: 'internal', scope: 'internal' }),
  Object.freeze({ key: 'dedupe_diagnostics', type: 'draw.dedupe-diagnostics', stability: 'internal', scope: 'internal' }),
]);

const REPORT_TRACKED_SEEDED_ENTRIES = Object.freeze([
  Object.freeze({ key: 'create_quality', type: 'model.quality-summary', label: 'Create quality JSON' }),
  Object.freeze({ key: 'drawing_quality', type: 'drawing.quality-summary', label: 'Drawing quality JSON' }),
  Object.freeze({ key: 'extracted_drawing_semantics', type: 'drawing.extracted-semantics', label: 'Extracted drawing semantics JSON' }),
  Object.freeze({ key: 'drawing_planner', type: 'drawing.planner', label: 'Drawing planner advisory JSON' }),
  Object.freeze({ key: 'create_manifest', type: 'output.manifest.json', label: 'Create manifest JSON' }),
  Object.freeze({ key: 'drawing_manifest', type: 'drawing.output-manifest.json', label: 'Drawing manifest JSON' }),
  Object.freeze({ key: 'drawing_svg', type: 'drawing.svg', label: 'Drawing SVG' }),
  Object.freeze({ key: 'model_step', type: 'model.step', label: 'STEP model' }),
  Object.freeze({ key: 'model_stl', type: 'model.stl', label: 'STL model' }),
]);

function drawEntriesForSurface(surface) {
  if (surface === 'cli') return DRAW_CLI_ENTRIES;
  if (surface === 'tracked-job') return DRAW_TRACKED_JOB_ENTRIES;
  throw new Error(`Unsupported artifact surface: ${surface}`);
}

function isPathWithinRoot(rootDir, pathValue) {
  const root = resolve(rootDir);
  const target = resolve(pathValue);
  const rel = relative(root, target).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isPublishableArtifactPath({ projectRoot, jobDir, artifact }) {
  if (!artifact?.path) return false;
  return isPathWithinRoot(projectRoot, artifact.path) || isPathWithinRoot(jobDir, artifact.path);
}

export function createArtifactEntry(type, path, {
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

export function drawingIntentManifestMetadata(reportSummary = null) {
  const drawingIntent = reportSummary?.drawing_intent;
  if (!drawingIntent || typeof drawingIntent !== 'object') return undefined;
  return {
    includes_drawing_intent: true,
    missing_semantics_policy: drawingIntent.missing_semantics_policy || 'advisory',
  };
}

export function inferCreateArtifactPaths(result) {
  return {
    exports: (result?.exports || []).map((entry) => entry.path).filter(Boolean),
  };
}

export function createExportArtifactEntries(exports = [], prefix = 'model') {
  return (exports || [])
    .filter((entry) => entry?.format && entry?.path)
    .map((entry) => createArtifactEntry(`${prefix}.${String(entry.format).toLowerCase()}`, entry.path, {
      label: entry.format.toUpperCase(),
      scope: 'user-facing',
      stability: 'stable',
    }));
}

export function collectCreateManifestArtifacts(result, { prefix = 'model' } = {}) {
  return createExportArtifactEntries(result?.exports || [], prefix);
}

export function createPartFileArtifactEntries(partFiles = [], type = 'model.part-stl') {
  return (partFiles || [])
    .filter((entry) => entry?.path)
    .map((entry, index) => createArtifactEntry(type, entry.path, {
      label: entry.label || entry.ref || `Part STL ${index + 1}`,
      scope: 'user-facing',
      stability: 'stable',
    }))
    .filter(Boolean);
}

export function inferDrawArtifactPaths(result) {
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
    drawing_intent: join(dir, `${stem}_drawing_intent.json`),
    feature_catalog: join(dir, `${stem}_feature_catalog.json`),
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

export function collectDrawManifestArtifacts(result, { surface = 'tracked-job' } = {}) {
  const paths = inferDrawArtifactPaths(result);
  return drawEntriesForSurface(surface)
    .filter(({ key }) => paths[key])
    .map((entry) => createArtifactEntry(entry.type, paths[entry.key], {
      label: entry.label || entry.key,
      scope: entry.scope,
      stability: entry.stability,
    }));
}

export function inferReportArtifactPaths(result) {
  return {
    pdf: result?.pdf_path || result?.path || null,
    ...(result?.drawing_intent_json ? { drawing_intent: result.drawing_intent_json } : {}),
    ...(result?.feature_catalog_json ? { feature_catalog: result.feature_catalog_json } : {}),
  };
}

export function collectReportManifestArtifacts(result, { surface = 'tracked-job' } = {}) {
  const pdfPath = result?.pdf_path || result?.path;
  const drawingIntent = surface === 'cli'
    ? result?.report_summary?.drawing_intent || null
    : result?.report_summary?.drawing_intent || result?.decision_summary?.drawing_intent || null;
  const drawingIntentMetadata = drawingIntent && typeof drawingIntent === 'object'
    ? {
        includes_drawing_intent: true,
        missing_semantics_policy: drawingIntent.missing_semantics_policy || 'advisory',
      }
    : null;
  const artifacts = [];

  if (pdfPath) {
    artifacts.push(createArtifactEntry('report.pdf', pdfPath, {
      label: surface === 'cli' ? 'Engineering report PDF' : 'PDF report',
    }));
  }

  if (result?.summary_json) {
    artifacts.push(createArtifactEntry('report.summary-json', result.summary_json, {
      label: surface === 'cli' ? 'Engineering report summary JSON' : 'Report summary JSON',
      metadata: drawingIntentMetadata || undefined,
    }));
  }

  if (surface === 'tracked-job' && result?.drawing_intent_json) {
    artifacts.push(createArtifactEntry('drawing-intent.json', result.drawing_intent_json, {
      label: 'Drawing intent JSON',
    }));
  }

  if (result?.feature_catalog_json) {
    artifacts.push(createArtifactEntry('feature-catalog.json', result.feature_catalog_json, {
      label: 'Conservative feature catalog JSON',
      stability: 'best-effort',
    }));
  }

  if (result?.extracted_drawing_semantics_json) {
    artifacts.push(createArtifactEntry(
      surface === 'cli' ? 'drawing.extracted-semantics-json' : 'drawing.extracted-semantics',
      result.extracted_drawing_semantics_json,
      {
        label: 'Extracted drawing semantics JSON',
        stability: 'best-effort',
      }
    ));
  }

  if (surface !== 'tracked-job') return artifacts;

  const seededArtifacts = result?.seeded_artifacts || {};
  for (const entry of REPORT_TRACKED_SEEDED_ENTRIES) {
    if (!seededArtifacts[entry.key]) continue;
    artifacts.push(createArtifactEntry(entry.type, seededArtifacts[entry.key], {
      label: entry.label,
      scope: 'user-facing',
      stability: 'stable',
    }));
  }

  return artifacts;
}

export function applyArtifactPublicationBoundary({ projectRoot, jobDir, artifacts = [] }) {
  return artifacts.map((artifact) => {
    if (artifact?.scope !== 'user-facing') return artifact;
    if (isPublishableArtifactPath({ projectRoot, jobDir, artifact })) return artifact;
    return {
      ...artifact,
      scope: 'internal',
      stability: artifact.stability || 'internal',
      metadata: {
        ...(artifact.metadata || {}),
        publication_boundary: {
          downgraded_to_internal: true,
          reason: 'Artifact path is outside the project root and this tracked job storage root.',
        },
      },
    };
  });
}

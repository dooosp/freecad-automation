import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import Ajv2020 from 'ajv/dist/2020.js';

import { readRawConfigFile, validateConfigDocument } from '../lib/config-schema.js';
import { getDrawingIntent } from '../lib/drawing-intent.js';
import {
  buildFeatureCatalog,
  validateFeatureCatalog,
} from '../lib/feature-catalog.js';
import {
  buildOutputManifest,
  validateOutputManifest,
} from '../lib/output-manifest.js';
import { buildDrawingQualitySummary } from '../src/services/drawing/drawing-quality-summary.js';
import {
  buildExtractedDrawingSemantics,
  validateExtractedDrawingSemantics,
} from '../src/services/drawing/extracted-drawing-semantics.js';
import {
  buildDecisionReportSummary,
  validateDecisionReportSummary,
} from '../src/services/report/decision-report-summary.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(ROOT, 'tests', 'fixtures', 'drawing-semantics');
const DRAWING_INTENT_SCHEMA = JSON.parse(
  readFileSync(join(ROOT, 'schemas', 'drawing-intent.schema.json'), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateDrawingIntent = ajv.compile(DRAWING_INTENT_SCHEMA);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function expected(fixtureName, fileName) {
  return readJson(join(FIXTURE_ROOT, fixtureName, fileName));
}

function normalizeIntent(intent) {
  return {
    part_type: intent.part_type,
    material: intent.material,
    required_views: intent.required_views,
    critical_feature_ids: intent.critical_features.map((feature) => feature.id),
    required_dimension_ids: intent.required_dimensions.map((dimension) => dimension.id),
    missing_semantics_policy: intent.missing_semantics_policy,
  };
}

function normalizeCatalog(catalog) {
  return {
    summary: catalog.summary,
    features: catalog.features
      .map((feature) => ({
        feature_id: feature.feature_id,
        type: feature.type,
        critical: feature.critical,
        dimensions: feature.dimensions,
        evidence_kind: feature.evidence.kind,
      }))
      .sort((a, b) => a.feature_id.localeCompare(b.feature_id)),
  };
}

function normalizeDrawingQuality(summary, optionalMissingDimensionIds = []) {
  return {
    status: summary.status,
    views: summary.views,
    dimensions: summary.dimensions,
    traceability: summary.traceability,
    blocking_issue_codes: summary.blocking_issues.map((issue) => issue.code),
    optional_missing_dimension_ids: optionalMissingDimensionIds,
  };
}

function normalizeExtractedSemantics(semantics) {
  return {
    status: semantics.status,
    methods: semantics.methods,
    coverage: semantics.coverage,
    view_ids: semantics.views.map((entry) => entry.id).sort(),
    matched_dimension_ids: semantics.dimensions
      .map((entry) => entry.matched_intent_id)
      .filter(Boolean)
      .sort(),
    matched_note_ids: semantics.notes
      .map((entry) => entry.matched_intent_id)
      .filter(Boolean)
      .sort(),
    title_block: {
      material: semantics.title_block.material?.raw_text || null,
      tolerance: semantics.title_block.tolerance?.raw_text || null,
      drawing_number: semantics.title_block.drawing_number?.raw_text || null,
    },
    unknowns: semantics.unknowns,
  };
}

function under(path, parent) {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parent);
  return resolvedPath === resolvedParent || resolvedPath.startsWith(`${resolvedParent}${sep}`);
}

async function loadFixtureConfig(fixtureName) {
  const configPath = join(ROOT, 'configs', 'examples', `${fixtureName}.toml`);
  const { parsed } = await readRawConfigFile(configPath);
  const validation = validateConfigDocument(parsed, { filepath: configPath });
  assert.equal(validation.valid, true, `${fixtureName} config should validate: ${validation.summary.errors.join('\n')}`);
  return { configPath, config: validation.config };
}

function qualityPassArtifacts(jobDir) {
  const artifactDir = join(jobDir, 'artifacts');
  return {
    inputConfigPath: join(jobDir, 'inputs', 'quality_pass_bracket.toml'),
    drawingSvgPath: join(artifactDir, 'quality_pass_bracket_drawing.svg'),
    planPath: join(artifactDir, 'quality_pass_bracket_plan.toml'),
    plan: {
      views: { enabled: ['top', 'iso'] },
    },
    qaPath: join(artifactDir, 'quality_pass_bracket_drawing_qa.json'),
    qaReport: {
      score: 98,
      metrics: { overflow_count: 0 },
      details: { overflows: [] },
    },
    qaIssuesPath: join(artifactDir, 'quality_pass_bracket_drawing_qa_issues.json'),
    qaIssues: { issues: [] },
    traceabilityPath: join(artifactDir, 'quality_pass_bracket_traceability.json'),
    traceability: {
      summary: {
        unresolved_dimensions: [],
      },
      links: [
        { dim_id: 'HOLE_LEFT_DIA', feature_id: 'hole_left' },
        { dim_id: 'HOLE_RIGHT_DIA', feature_id: 'hole_right' },
      ],
    },
    layoutReportPath: join(artifactDir, 'quality_pass_bracket_layout_report.json'),
    layoutReport: {
      views: { top: {}, iso: {} },
      summary: { overflow_views: [] },
    },
    dimensionMapPath: join(artifactDir, 'quality_pass_bracket_dimension_map.json'),
    dimensionMap: {
      plan_dimensions: [
        { dim_id: 'HOLE_LEFT_DIA', required: true, rendered: true, status: 'rendered', feature: 'hole_left' },
        { dim_id: 'HOLE_RIGHT_DIA', required: true, rendered: true, status: 'rendered', feature: 'hole_right' },
        { dim_id: 'CHAMFER_SIZE', required: false, rendered: false, status: 'missing', feature: 'chamfer_3' },
      ],
      summary: { skipped_duplicate_count: 0 },
    },
    dimConflictsPath: join(artifactDir, 'quality_pass_bracket_dim_conflicts.json'),
    dimConflicts: { conflicts: [], summary: { count: 0 } },
    generatedViews: ['top', 'iso'],
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="10" y="10">6</text>',
      '  <text x="10" y="20">10</text>',
      '  <text x="10" y="30">Material: AL6061</text>',
      '</svg>',
    ].join('\n'),
  };
}

function ksBracketArtifacts(jobDir) {
  const artifactDir = join(jobDir, 'artifacts');
  return {
    inputConfigPath: join(jobDir, 'inputs', 'ks_bracket.toml'),
    drawingSvgPath: join(artifactDir, 'ks_bracket_drawing.svg'),
    planPath: join(artifactDir, 'ks_bracket_plan.toml'),
    plan: {
      views: { enabled: ['front', 'top', 'right', 'iso'] },
    },
    qaPath: join(artifactDir, 'ks_bracket_drawing_qa.json'),
    qaReport: {
      score: 82,
      metrics: { overflow_count: 0 },
      details: { overflows: [] },
    },
    qaIssuesPath: join(artifactDir, 'ks_bracket_drawing_qa_issues.json'),
    qaIssues: { issues: [] },
    traceabilityPath: join(artifactDir, 'ks_bracket_traceability.json'),
    traceability: {
      summary: {
        unresolved_dimensions: ['MOUNTING_HOLE_DIA'],
      },
      links: [
        { dim_id: 'MOUNTING_HOLE_DIA', feature_id: null },
        { dim_id: 'BASE_PLATE_ENVELOPE', feature_id: 'base_plate' },
        { dim_id: 'WEB_HEIGHT', feature_id: 'web' },
      ],
    },
    layoutReportPath: join(artifactDir, 'ks_bracket_layout_report.json'),
    layoutReport: {
      views: { front: {}, top: {}, right: {}, iso: {} },
      summary: { overflow_views: [] },
    },
    dimensionMapPath: join(artifactDir, 'ks_bracket_dimension_map.json'),
    dimensionMap: {
      plan_dimensions: [
        { dim_id: 'MOUNTING_HOLE_DIA', required: true, rendered: false, status: 'missing', feature: 'hole1,hole2,hole3,hole4' },
        { dim_id: 'BASE_PLATE_ENVELOPE', required: true, rendered: true, status: 'rendered', feature: 'base_plate' },
        { dim_id: 'WEB_HEIGHT', required: true, rendered: true, status: 'rendered', feature: 'web' },
        { dim_id: 'SURFACE_FINISH', required: false, rendered: false, status: 'missing', feature: 'notes' },
      ],
      summary: { skipped_duplicate_count: 0 },
    },
    dimConflictsPath: join(artifactDir, 'ks_bracket_dim_conflicts.json'),
    dimConflicts: { conflicts: [], summary: { count: 0 } },
    generatedViews: ['front', 'top', 'right', 'iso'],
    svgContent: [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '  <text x="10" y="10">60</text>',
      '  <text x="10" y="20">SS304</text>',
      '  <text x="10" y="30">Tolerance: KS B 0401 m</text>',
      '</svg>',
    ].join('\n'),
  };
}

function makeReportInput({
  fixtureName,
  config,
  drawingQuality,
  extractedSemantics,
  featureCatalog,
}) {
  return {
    configPath: `/tmp/${fixtureName}.toml`,
    config,
    reportPdfPath: `/tmp/output/${fixtureName}_report.pdf`,
    reportGeneratedAt: '2026-04-21T00:00:00.000Z',
    repoContext: {
      branch: 'test/drawing-semantic-regression',
      headSha: 'abc123',
    },
    runtimeInfo: {
      mode: 'semantic-fixture',
      available: false,
    },
    createQuality: {
      status: 'pass',
      geometry: { valid_shape: true },
      blocking_issues: [],
      warnings: [],
    },
    drawingQuality,
    extractedDrawingSemantics: extractedSemantics,
    featureCatalog,
    dfm: {
      score: 100,
      issues: [],
      summary: {
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: [],
      },
    },
    fem: null,
    tolerance: null,
  };
}

const TMP_DIR = mkdtempSync(join(tmpdir(), 'fcad-drawing-semantic-'));

try {
  const fixtureContexts = {};
  for (const fixtureName of ['quality_pass_bracket', 'ks_bracket']) {
    const { configPath, config } = await loadFixtureConfig(fixtureName);
    const drawingIntent = getDrawingIntent(config);
    assert.ok(drawingIntent, `${fixtureName} should expose drawing_intent`);
    assert.equal(validateDrawingIntent(drawingIntent), true, (validateDrawingIntent.errors || [])
      .map((error) => `${error.instancePath} ${error.message}`)
      .join('\n'));

    assert.deepEqual(
      { drawing_intent: normalizeIntent(drawingIntent) },
      expected(fixtureName, 'expected_drawing_semantics.json')
    );

    const featureCatalog = buildFeatureCatalog({
      config,
      configPath,
      relatedArtifact: join(TMP_DIR, fixtureName, 'artifacts', `${fixtureName}_report.pdf`),
      generatedAt: '2026-04-21T00:00:00.000Z',
    });
    const catalogValidation = validateFeatureCatalog(featureCatalog);
    assert.equal(catalogValidation.ok, true, catalogValidation.errors.join('\n'));
    assert.deepEqual(
      normalizeCatalog(featureCatalog),
      expected(fixtureName, 'expected_feature_catalog.json')
    );

    const jobDir = join(TMP_DIR, 'jobs', fixtureName);
    const qualityArtifacts = fixtureName === 'quality_pass_bracket'
      ? qualityPassArtifacts(jobDir)
      : ksBracketArtifacts(jobDir);
    const optionalMissingDimensionIds = expected(fixtureName, 'expected_drawing_quality.json').optional_missing_dimension_ids;
    const extractedSemantics = buildExtractedDrawingSemantics({
      drawingSvgPath: qualityArtifacts.drawingSvgPath,
      svgContent: qualityArtifacts.svgContent,
      layoutReportPath: qualityArtifacts.layoutReportPath,
      layoutReport: qualityArtifacts.layoutReport,
      dimensionMapPath: qualityArtifacts.dimensionMapPath,
      dimensionMap: qualityArtifacts.dimensionMap,
      traceabilityPath: qualityArtifacts.traceabilityPath,
      traceability: qualityArtifacts.traceability,
      drawingIntent,
    });
    const extractedValidation = validateExtractedDrawingSemantics(extractedSemantics);
    assert.equal(extractedValidation.ok, true, extractedValidation.errors.join('\n'));
    assert.deepEqual(
      normalizeExtractedSemantics(extractedSemantics),
      expected(fixtureName, 'expected_extracted_drawing_semantics.json')
    );
    const drawingQuality = buildDrawingQualitySummary(qualityArtifacts);
    assert.deepEqual(
      normalizeDrawingQuality(drawingQuality, optionalMissingDimensionIds),
      expected(fixtureName, 'expected_drawing_quality.json')
    );
    for (const pathKey of [
      'input_config',
      'drawing_svg',
      'plan_file',
      'qa_file',
      'qa_issues_file',
      'traceability_file',
      'layout_report_file',
      'dimension_map_file',
      'dim_conflicts_file',
    ]) {
      assert.equal(under(drawingQuality[pathKey], jobDir), true, `${fixtureName} ${pathKey} should remain job-scoped`);
    }

    fixtureContexts[fixtureName] = {
      config,
      drawingIntent,
      drawingQuality,
      extractedSemantics,
      featureCatalog,
      jobDir,
    };
  }

  const passContext = fixtureContexts.quality_pass_bracket;
  const passSummary = buildDecisionReportSummary(makeReportInput({
    fixtureName: 'quality_pass_bracket',
    ...passContext,
  }));
  const passValidation = validateDecisionReportSummary(passSummary);
  assert.equal(passValidation.ok, true, passValidation.errors.join('\n'));
  assert.equal(passSummary.overall_status, 'pass');
  assert.equal(passSummary.ready_for_manufacturing_review, true);
  assert.equal(passSummary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_intent')?.required, false);
  assert.equal(passSummary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.required, false);
  assert.equal(passSummary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.required, false);
  assert.equal(passSummary.surfaces.drawing_quality.missing_required_dimensions.length, 0);
  assert.equal(passSummary.feature_catalog.available, true);

  const ksContext = fixtureContexts.ks_bracket;
  const failSummary = buildDecisionReportSummary(makeReportInput({
    fixtureName: 'ks_bracket',
    ...ksContext,
  }));
  const failValidation = validateDecisionReportSummary(failSummary);
  assert.equal(failValidation.ok, true, failValidation.errors.join('\n'));
  assert.equal(failSummary.overall_status, 'fail');
  assert.equal(failSummary.ready_for_manufacturing_review, false);
  assert.deepEqual(failSummary.surfaces.drawing_quality.missing_required_dimensions, ['MOUNTING_HOLE_DIA']);
  assert(failSummary.top_risks.some((risk) => risk.includes('Missing required drawing dimensions: MOUNTING_HOLE_DIA')));
  assert(failSummary.recommended_actions.some((action) => action.includes('MOUNTING_HOLE_DIA')));

  const manifestDir = join(TMP_DIR, 'jobs', 'quality_pass_bracket', 'artifacts');
  mkdirSync(manifestDir, { recursive: true });
  const semanticPaths = {
    drawingQuality: join(manifestDir, 'quality_pass_bracket_drawing_quality.json'),
    extractedDrawingSemantics: join(manifestDir, 'quality_pass_bracket_extracted_drawing_semantics.json'),
    drawingIntent: join(manifestDir, 'quality_pass_bracket_drawing_intent.json'),
    featureCatalog: join(manifestDir, 'quality_pass_bracket_feature_catalog.json'),
    reportSummary: join(manifestDir, 'quality_pass_bracket_report_summary.json'),
  };
  writeFileSync(semanticPaths.drawingQuality, JSON.stringify(passContext.drawingQuality, null, 2), 'utf8');
  writeFileSync(semanticPaths.extractedDrawingSemantics, JSON.stringify(passContext.extractedSemantics, null, 2), 'utf8');
  writeFileSync(semanticPaths.drawingIntent, JSON.stringify(passContext.drawingIntent, null, 2), 'utf8');
  writeFileSync(semanticPaths.featureCatalog, JSON.stringify(passContext.featureCatalog, null, 2), 'utf8');
  writeFileSync(semanticPaths.reportSummary, JSON.stringify(passSummary, null, 2), 'utf8');

  const outputManifest = await buildOutputManifest({
    projectRoot: ROOT,
    repoContext: {
      root: ROOT,
      branch: 'test/drawing-semantic-regression',
      headSha: 'abc123',
      dirtyAtStart: false,
    },
    command: 'report',
    commandArgs: ['configs/examples/quality_pass_bracket.toml'],
    linkedArtifacts: {
      quality_json: semanticPaths.drawingQuality,
      extracted_drawing_semantics_json: semanticPaths.extractedDrawingSemantics,
      drawing_intent_json: semanticPaths.drawingIntent,
      feature_catalog_json: semanticPaths.featureCatalog,
      report_summary_json: semanticPaths.reportSummary,
    },
    timings: {
      startedAt: '2026-04-21T00:00:00.000Z',
      finishedAt: '2026-04-21T00:00:01.000Z',
    },
  });
  const manifestValidation = validateOutputManifest(outputManifest);
  assert.equal(manifestValidation.ok, true, manifestValidation.errors.join('\n'));
  assert.equal(outputManifest.linked_artifacts.quality_json, semanticPaths.drawingQuality);
  assert.equal(outputManifest.linked_artifacts.extracted_drawing_semantics_json, semanticPaths.extractedDrawingSemantics);
  assert.equal(outputManifest.linked_artifacts.drawing_intent_json, semanticPaths.drawingIntent);
  assert.equal(outputManifest.linked_artifacts.feature_catalog_json, semanticPaths.featureCatalog);
  assert.equal(outputManifest.linked_artifacts.report_summary_json, semanticPaths.reportSummary);
  for (const semanticPath of Object.values(semanticPaths)) {
    assert.equal(under(semanticPath, manifestDir), true, `${semanticPath} should stay under job artifacts`);
  }

  const pollutionPath = join(ROOT, 'configs', 'examples', 'hygiene_probe_extracted_drawing_semantics.json');
  const outputPath = join(ROOT, 'output', 'hygiene_probe_extracted_drawing_semantics.json');
  try {
    writeFileSync(pollutionPath, '{}\n', 'utf8');
    const dirtyResult = spawnSync('node', ['scripts/check-source-tree-hygiene.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(dirtyResult.status, 0, 'source hygiene should reject generated semantic artifacts outside output/');
    assert.match(`${dirtyResult.stdout}\n${dirtyResult.stderr}`, /hygiene_probe_extracted_drawing_semantics\.json/);
  } finally {
    rmSync(pollutionPath, { force: true });
  }

  mkdirSync(join(ROOT, 'output'), { recursive: true });
  try {
    writeFileSync(outputPath, '{}\n', 'utf8');
    const cleanResult = spawnSync('node', ['scripts/check-source-tree-hygiene.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(cleanResult.status, 0, cleanResult.stderr || cleanResult.stdout);
  } finally {
    rmSync(outputPath, { force: true });
  }
} finally {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

console.log('drawing-semantic-regression.test.js: ok');

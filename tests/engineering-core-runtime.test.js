// Real FreeCAD opt-in lane. Outputs are diagnostic runs, never inspection evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { validateOutputManifest } from '../lib/output-manifest.js';
import { validateArtifactManifest } from '../lib/artifact-manifest.js';
import { DEFAULT_CREATE_QUALITY_THRESHOLDS, validateCreateQualityReport } from '../lib/create-quality.js';
import { buildRuntimeSmokeBoundary } from '../lib/runtime-smoke-governance.js';
import { FIXTURES, prepareConfig } from './helpers/engineering-core-fixtures.js';

const ROOT = resolve(import.meta.dirname, '..');
const OBSERVATIONS = [
  ['generated_shape_geometry_check', 'generated_shape_geometry'],
  ['reimported_step_geometry_check', 'reimported_step_geometry'],
];
const HINGE_PINS = [
  { id: 'hinge_pin_left', center: [21, 27] },
  { id: 'hinge_pin_right', center: [69, 27] },
];
const runId = `runtime-${Date.now()}-${process.pid}`;
const out = resolve(ROOT, 'output/engineering-core-refocus', runId);
assert(!existsSync(out), 'fresh run directory required');
mkdirSync(out, { recursive: true });
assert(realpathSync(out).startsWith(realpathSync(ROOT) + sep + 'output' + sep));
assert.equal(spawnSync('git', ['check-ignore', '--quiet', relative(ROOT, out)], { cwd: ROOT }).status, 0);
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const result = {
  ...buildRuntimeSmokeBoundary(), run_id: runId,
  code_sha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
  runtime_driver_sha256: hash(import.meta.filename),
  dirty_at_start: !!spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
  environment: { os: `${platform()} ${release()}`, node: process.version },
  commands: [], cases: [], comparisons: [], injections: [], invariances: [], anchor_cases: [], errors: [],
  notes: ['CAD runtime observations only; no physical inspection, readiness change or manufacturing approval.', 'Ignored quality/drawing sidecars cannot become canonical review evidence; linkage remains unavailable.', 'Drawing existence and intent semantics checked; visual layout NOT_RUN.'],
};
const save = () => writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
function cli(args, dir = out) {
  const started = Date.now();
  const done = spawnSync(process.execPath, [join(ROOT, 'bin/fcad.js'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024 });
  const log = join(dir, `${String(result.commands.length + 1).padStart(2, '0')}-${args[0]}.log`);
  writeFileSync(log, (done.stdout || '') + (done.stderr || '') + (done.error ? String(done.error) : ''));
  result.commands.push({ args, exit_code: done.status, seconds: (Date.now() - started) / 1000, log: relative(ROOT, log) });
  save();
  assert.equal(done.status, 0, `fcad ${args[0]} failed; see ${log}`);
  return done;
}
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
}
function manifest(dir, command, kind, configPath) {
  const validator = kind === 'output' ? validateOutputManifest : validateArtifactManifest;
  const matches = files(dir).filter(p => p.endsWith('.json')).flatMap(p => {
    const value = read(p);
    return value.command === command && validator(value).ok && (!configPath || value.input?.path === configPath) ? [{ path: p, value }] : [];
  });
  assert.equal(matches.length, 1, `${command}: exactly one current ${kind} manifest required`);
  return matches[0];
}
function owned(path) {
  assert.equal(typeof path, 'string');
  const resolved = resolve(ROOT, path);
  assert(resolved.startsWith(out + sep), `artifact escaped isolated run: ${path}`);
  assert(existsSync(resolved), `missing artifact: ${path}`);
  assert(realpathSync(resolved).startsWith(realpathSync(out) + sep));
  return resolved;
}
function output(man, kind) {
  return owned(man.value.outputs.find(o => o.kind === kind)?.path);
}
function runtimeConfig(fixture, source, revision) {
  const config = prepareConfig(ROOT, runId, fixture, source, revision);
  // Add BREP only after the helper has moved the copy away from canonical outputs.
  assert(resolve(ROOT, config.export.directory).startsWith(out + sep));
  config.export.formats = [...new Set([...config.export.formats, 'brep'])];
  return config;
}
function writeConfig(config) {
  const dir = resolve(ROOT, config.export.directory);
  assert(dir.startsWith(out + sep));
  mkdirSync(dir, { recursive: true });
  owned(dir);
  assert.equal(spawnSync('git', ['check-ignore', '--quiet', relative(ROOT, dir)], { cwd: ROOT }).status, 0);
  const configPath = join(dir, 'config.toml');
  writeFileSync(configPath, stringify(config));
  assert.equal(resolve(ROOT, parse(readFileSync(configPath, 'utf8')).export.directory), dir);
  owned(configPath);
  return { dir, configPath };
}
function assertBrep(create, quality) {
  assert.equal(validateCreateQualityReport(quality).ok, true);
  const brep = output(create, 'model.brep');
  assert.equal(owned(quality.primary_outputs.brep), brep);
  const roundtrip = quality.brep_roundtrip;
  assert.equal(roundtrip.exported, true);
  assert.equal(roundtrip.reimport_attempted, true);
  assert.equal(roundtrip.reimport_valid, true);
  assert.equal(roundtrip.reimported_geometry?.valid_shape, true);
  assert(Number.isFinite(roundtrip.volume_delta_percent));
  assert(roundtrip.volume_delta_percent <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_step_volume_delta_percent);
  assert(Number.isFinite(roundtrip.bbox_delta?.max_abs_mm));
  assert(roundtrip.bbox_delta.max_abs_mm <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_bbox_delta_mm);
  return relative(ROOT, brep);
}
function observedRow(rows, featureId, kind, type) {
  const matches = rows.filter(r => r.feature_id === featureId && r.validation_kind === kind && r.measurement_type === type);
  assert.equal(matches.length, 1, `${featureId} ${kind} ${type}: one observed row required`);
  return matches[0];
}
function assertYRows(rows, pin, { diameter = 8, center = pin.center, failedType = null } = {}) {
  for (const [kind, source] of OBSERVATIONS) {
    for (const type of ['hole_diameter', 'hole_center']) {
      const row = observedRow(rows, pin.id, kind, type);
      assert.equal(row.status, type === failedType ? 'fail' : 'pass', `${pin.id} ${kind} ${type}`);
      assert.equal(row.source, source);
      assert.equal(row.hole_axis, 'y');
      assert.equal(row.center_plane, 'xz');
      assert.equal(row.expected_center_xy_mm, null);
      assert.equal(row.actual_center_xy_mm, null);
      assert.deepEqual(row.expected_center_xz_mm, pin.center);
      assert(Array.isArray(row.actual_center_xz_mm) && row.actual_center_xz_mm.length === 2);
      assert(row.actual_center_xz_mm.every(Number.isFinite));
      assert(Math.hypot(...row.actual_center_xz_mm.map((v, i) => v - center[i])) <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_engineering_center_delta_mm);
      if (type === 'hole_diameter') {
        assert.equal(row.expected_value_mm, 8);
        assert(Number.isFinite(row.actual_value_mm));
        assert(Math.abs(row.actual_value_mm - diameter) <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_engineering_dimension_delta_mm);
      }
    }
  }
}
function fixHingeCenterRequirements(config) {
  const dimensions = config.drawing_intent.required_dimensions;
  const index = dimensions.findIndex(d => d.id === 'HINGE_PIN_DIA');
  const group = dimensions[index];
  assert.equal(group?.value_mm, 8);
  assert.equal(group.feature, 'hinge_pin_left,hinge_pin_right');
  const pins = HINGE_PINS.map((pin, i) => {
    const shape = config.shapes.find(s => s.id === pin.id);
    assert.equal(shape?.radius, 4);
    assert.deepEqual(shape.position, [pin.center[0], 28, pin.center[1]]);
    assert.deepEqual(shape.direction, [0, 1, 0]);
    assert.equal(shape.height, 24);
    return { ...group, id: i === 0 ? group.id : 'HINGE_PIN_RIGHT_DIA', feature: pin.id, expected_center_xz_mm: [...pin.center] };
  });
  // Create-only probes need one independent XZ requirement for each feature.
  dimensions.splice(index, 1, ...pins);
}
function geometryDelta(baseline, candidate) {
  assert(baseline.valid_shape === true && candidate.valid_shape === true);
  assert(Number.isFinite(baseline.volume) && baseline.volume > 0);
  assert(Number.isFinite(candidate.volume) && candidate.volume > 0);
  const volumeDeltaPercent = Math.abs(candidate.volume - baseline.volume) / baseline.volume * 100;
  assert(volumeDeltaPercent <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_step_volume_delta_percent);
  const bboxDeltas = ['min', 'max', 'size'].flatMap(key => {
    assert(Array.isArray(baseline.bbox?.[key]) && baseline.bbox[key].length === 3);
    assert(Array.isArray(candidate.bbox?.[key]) && candidate.bbox[key].length === 3);
    assert(baseline.bbox[key].every(Number.isFinite) && candidate.bbox[key].every(Number.isFinite));
    return candidate.bbox[key].map((value, i) => Math.abs(value - baseline.bbox[key][i]));
  });
  const bboxMaxDeltaMm = Math.max(...bboxDeltas);
  assert(bboxMaxDeltaMm <= DEFAULT_CREATE_QUALITY_THRESHOLDS.max_bbox_delta_mm);
  return { volume_delta_percent: volumeDeltaPercent, bbox_max_delta_mm: bboxMaxDeltaMm };
}
let hingeBaselineA = null;
try {
  const runtime = cli(['check-runtime']);
  result.runtime_probe = runtime.stdout;
  for (const fixture of FIXTURES) {
    const sides = {};
    for (const revision of ['A', 'B']) {
      const record = { part: fixture.id, revision, status: 'NOT_RUN' };
      result.cases.push(record);
      try {
        const sourcePath = resolve(ROOT, fixture.source);
        const source = parse(readFileSync(sourcePath, 'utf8'));
        const config = runtimeConfig(fixture, source, revision);
        const { dir, configPath } = writeConfig(config);
        record.source = { path: fixture.source, sha256: hash(sourcePath) };
        record.config = { path: relative(ROOT, configPath), sha256: hash(configPath), synthetic_identity_fields: ['package_slug', 'part_id', 'revision'].filter(k => source.product?.[k] === undefined) };
        cli(['create', configPath], dir);
        const create = manifest(dir, 'create', 'output', configPath);
        record.create_manifest = relative(ROOT, create.path);
        record.runtime = create.value.runtime;
        const qualityPath = owned(create.value.linked_artifacts.quality_json);
        const quality = read(qualityPath);
        record.brep_path = assertBrep(create, quality);
        record.create_quality = quality.status;
        record.valid_shape = quality.geometry.valid_shape;
        record.step_roundtrip = quality.step_roundtrip;
        record.brep_roundtrip = quality.brep_roundtrip;
        record.stl_quality = quality.stl_quality;
        assert.equal(quality.geometry.valid_shape, true);
        assert.equal(quality.step_roundtrip.reimport_attempted, true);
        assert.equal(quality.step_roundtrip.reimport_valid, true);
        const rows = quality.engineering_quality.measurements;
        record.measurements = rows;
        record.measurement_counts = Object.fromEntries(['pass', 'fail', 'missing', 'unavailable'].map(s => [s, rows.filter(r => r.status === s).length]));
        for (const [index, id] of fixture.holes.entries()) {
          for (const kind of ['generated_shape_geometry_check', 'reimported_step_geometry_check']) {
            const diameter = rows.find(r => r.feature_id === id && r.validation_kind === kind && r.measurement_type === 'hole_diameter');
            assert(diameter, `${id} ${kind}: required observed row`);
            assert.equal(diameter.status, 'pass', `${id} ${kind}: supported Z hole must pass`);
            assert.equal(diameter.source, kind === 'generated_shape_geometry_check' ? 'generated_shape_geometry' : 'reimported_step_geometry');
            assert(Math.abs(diameter.actual_value_mm - (revision === 'A' ? fixture.a : fixture.b)) <= 0.05);
            const center = rows.find(r => r.feature_id === id && r.validation_kind === kind && r.measurement_type === 'hole_center');
            assert(center);
            assert.equal(center.status, 'pass');
            assert.equal(center.source, diameter.source);
            assert(Math.hypot(...center.actual_center_xy_mm.map((v, i) => v - fixture.centers[index][i])) <= 0.2);
          }
        }
        assert.equal(quality.status, 'pass', `${fixture.id}/${revision}: all required quality checks must pass`);
        if (fixture.id === 'hinge-block') {
          for (const pin of HINGE_PINS) assertYRows(rows, pin);
          assert.equal(rows.length, 16);
          assert(rows.every(row => row.status === 'pass'));
          if (revision === 'A') hingeBaselineA = { quality, qualityPath };
        }
        cli(['draw', configPath], dir);
        const draw = manifest(dir, 'draw', 'output', configPath);
        record.draw_manifest = relative(ROOT, draw.path);
        const svg = output(draw, 'drawing.svg');
        assert(readFileSync(svg, 'utf8').includes('<svg'));
        record.drawing_svg_path = relative(ROOT, svg);
        const drawingQuality = output(draw, 'drawing.quality-json');
        const intentPath = output(draw, 'drawing.intent-json');
        const catalog = output(draw, 'drawing.feature-catalog-json');
        const drawingReport = read(drawingQuality);
        record.drawing_quality = drawingReport.status;
        assert.equal(record.drawing_quality, 'pass', `${fixture.id}/${revision}: drawing quality must pass`);
        const qa = read(owned(drawingReport.qa_file));
        assert.equal(qa.metrics.notes_overflow, false, 'declared footer notes must remain inside their region');
        const layout = drawingReport.layout_readability;
        assert.equal(layout.advisory_only, true);
        assert.notEqual(layout.completeness_state, 'complete', 'curved boundaries cannot yield complete bounded annotation evidence');
        assert.equal(layout.score, null, 'incomplete annotation inspection has no full layout score');
        record.drawing_semantics = {
          decision: drawingReport.semantic_quality.decision,
          advisory_decision: drawingReport.semantic_quality.advisory_decision,
          required_dimensions_present: drawingReport.semantic_quality.required_dimensions_present,
          required_dimensions_total: drawingReport.semantic_quality.required_dimensions_total,
          required_blockers: drawingReport.semantic_quality.required_blockers,
        };
        record.layout = {
          status: layout.status, score: layout.score, completeness: layout.completeness_state,
          findings: layout.findings.map(f => ({ type: f.type, view_ids: f.view_ids, labels: f.labels })),
          notes_overflow: qa.metrics.notes_overflow,
        };
        if (fixture.id === 'plate-with-holes') {
          const map = read(owned(drawingReport.dimension_map_file));
          for (const id of ['CONNECTOR_SLOT_POSITION']) {
            const dimension = map.plan_dimensions.find(d => d.dim_id === id);
            assert.equal(dimension?.status, 'skipped_no_anchor', `${id}: an unsupported feature span cannot become an overall dimension`);
            assert.equal(dimension.rendered, false);
          }
          for (const id of ['CONNECTOR_SLOT_POSITION']) {
            const requirement = config.drawing_intent.required_dimensions.find(d => d.id === id);
            assert(drawingReport.semantic_quality.missing_required_dimensions.includes(requirement.label || id), `${id}: cannot count as present`);
          }
          for (const [id, value, count] of [['THK',4,1], ['STANDOFF_HEIGHT',8,4]]) {
            const row = map.plan_dimensions.find(d => d.dim_id === id);
            assert.equal(row?.status, 'rendered', `${id}: named final geometry must be anchored`);
            assert.equal(row.observation.source, 'freecad_final_topology');
            assert.equal(row.observation.value_mm, value);
            assert.equal(row.observation.members.length, count);
            assert(row.observation.members.every(m => Math.abs(m.value_mm - value) < 1e-6));
          }
          assert.equal(record.drawing_semantics.required_dimensions_present, 5);
          assert.equal(record.drawing_semantics.advisory_decision, 'needs_attention');
        }
        const intent = read(intentPath);
        assert.equal(intent.required_dimensions.find(d => d.id === fixture.requirement).value_mm, revision === 'A' ? fixture.a : fixture.b);
        const model = output(create, 'model.step');
        cli(['review-context', '--model', model, '--part-id', config.product.part_id, '--revision', revision, '--material', 'AL6061', '--process', 'machining', '--create-quality', qualityPath, '--drawing-quality', drawingQuality, '--drawing-intent', intentPath, '--feature-catalog', catalog, '--out', join(dir, 'review_pack.json')], dir);
        const reviewManifest = manifest(dir, 'review-context', 'artifact');
        const reviewPath = owned(reviewManifest.value.artifacts.find(a => a.type === 'review-pack.json')?.path);
        const review = read(reviewPath);
        assert(!(review.source_artifact_refs || []).some(r => ['create_quality_report', 'drawing_quality_report'].includes(r.artifact_type)));
        record.evidence_linkage = 'UNAVAILABLE: ignored outputs excluded by existing portableRepoPath policy';
        record.status = quality.status === 'pass' && record.drawing_quality === 'pass' ? 'PASS' : 'QUALITY_NON_PASS';
        sides[revision] = { configPath, reviewPath, model, qualityPath, drawingQuality, config };
      } catch (error) {
        record.status = 'FAIL'; record.error = String(error); result.errors.push(`${fixture.id}/${revision}: ${error}`);
      }
      console.log(`${fixture.id}/${revision}: ${record.status}; create=${record.create_quality}; drawing=${record.drawing_quality}`);
      save();
    }
    if (sides.A && sides.B) {
      try {
        const dir = join(out, fixture.id, 'comparison'); mkdirSync(dir, { recursive: true });
        const impactPath = join(dir, 'revision_impact_report.json');
        const mdPath = join(dir, 'revision_impact_report.md');
        const args = ['compare-rev', sides.A.reviewPath, sides.B.reviewPath, '--baseline-config', sides.A.configPath, '--candidate-config', sides.B.configPath, '--out', join(dir, 'revision_comparison.json'), '--impact-out', impactPath, '--impact-md-out', mdPath, '--generated-at', '2026-09-06T00:00:00Z'];
        cli(args, dir);
        const first = [hash(owned(impactPath)), hash(owned(mdPath))];
        const report = read(impactPath);
        assert.equal(report.summary.unable_to_determine_count, 0, 'positive A/B fixture identities and requirements must agree');
        assert(report.changes.some(c => c.change_type === 'nominal_dimension_change' && c.affected_entity_id === fixture.requirement && c.before_value === fixture.a && c.after_value === fixture.b));
        for (const id of fixture.holes) assert(report.changes.some(c => c.change_type === 'geometry_feature_modified' && c.affected_entity_id === id && c.before_value.dimensions.radius === fixture.a / 2 && c.after_value.dimensions.radius === fixture.b / 2));
        cli(args, dir);
        assert.deepEqual([hash(impactPath), hash(mdPath)], first);
        result.comparisons.push({ part: fixture.id, status: 'PASS', decision: report.summary.decision, deterministic_json_and_markdown: true, impact_path: relative(ROOT, impactPath) });
        const staleDir = join(out, fixture.id, 'stale-A-sidecars-B-model'); mkdirSync(staleDir);
        cli(['review-context', '--model', sides.B.model, '--part-id', sides.B.config.product.part_id, '--revision', 'B', '--create-quality', sides.A.qualityPath, '--drawing-quality', sides.A.drawingQuality, '--out', join(staleDir, 'review_pack.json')], staleDir);
        const staleManifest = manifest(staleDir, 'review-context', 'artifact');
        const stale = read(owned(staleManifest.value.artifacts.find(a => a.type === 'review-pack.json')?.path));
        assert(!(stale.source_artifact_refs || []).some(r => ['create_quality_report', 'drawing_quality_report'].includes(r.artifact_type)));
        result.comparisons.at(-1).actual_stale_linkage = 'UNAVAILABLE: A sidecars supplied with B model excluded by ignored-path policy; not a checksum-validation claim';
      } catch (error) { result.errors.push(`${fixture.id}/comparison: ${error}`); }
    }
  }
  // Actual geometry errors: keep A requirements and change only the cutter.
  const plate = FIXTURES.find(f => f.id === 'plate-with-holes');
  for (const scenario of ['thickness-B', 'height-B', 'height-mismatch', 'nominal-only', 'removed-boss', 'duplicate-id', 'translation', 'wrong-view']) {
    try {
      const config = runtimeConfig(plate, parse(readFileSync(resolve(ROOT, plate.source),'utf8')), 'A');
      config.export.directory = `output/engineering-core-refocus/${runId}/anchor-${scenario}`;
      const plan = config.drawing_plan.dim_intents;
      const requirements = config.drawing_intent.required_dimensions;
      if (scenario === 'thickness-B') {
        config.shapes.find(s => s.id === 'plate').height = 5;
        for (const s of config.shapes.filter(s => s.id.startsWith('standoff'))) s.position[2] = 5;
        plan.find(d => d.id === 'THK').value_mm = 5;
        requirements.find(d => d.id === 'PLATE_THICKNESS').value_mm = 5;
      } else if (scenario === 'height-B') {
        for (const s of config.shapes.filter(s => s.id.startsWith('standoff'))) s.height = 10;
        plan.find(d => d.id === 'STANDOFF_HEIGHT').value_mm = 10;
        requirements.find(d => d.id === 'STANDOFF_HEIGHT').value_mm = 10;
      } else if (scenario === 'height-mismatch') config.shapes.find(s => s.id === 'standoff1').height = 9;
      else if (scenario === 'nominal-only') {
        plan.find(d => d.id === 'THK').value_mm = 6;
        requirements.find(d => d.id === 'PLATE_THICKNESS').value_mm = 6;
      } else if (scenario === 'removed-boss') config.operations = config.operations.filter(op => op.tool !== 'standoff2');
      else if (scenario === 'duplicate-id') plan.push({ ...plan.find(d => d.id === 'THK'), feature: 'standoff1', value_mm: 8 });
      else if (scenario === 'translation') {
        for (const s of config.shapes) s.position = (s.position || [0,0,0]).map((v,i) => v + [10,20,30][i]);
      } else if (scenario === 'wrong-view') plan.find(d => d.id === 'THK').view = 'top';
      const {dir,configPath} = writeConfig(config);
      cli(['draw',configPath],dir);
      const draw = manifest(dir,'draw','output',configPath);
      const quality = read(output(draw,'drawing.quality-json'));
      const map = read(owned(quality.dimension_map_file));
      const target = ['height-B','height-mismatch','removed-boss'].includes(scenario) ? 'STANDOFF_HEIGHT' : 'THK';
      const rows = map.plan_dimensions.filter(d => d.dim_id === target);
      assert(rows.length > 0);
      if (['thickness-B','height-B','translation'].includes(scenario)) {
        const expected = scenario === 'thickness-B' ? 5 : scenario === 'height-B' ? 10 : 4;
        assert.equal(rows[0].status,'rendered');
        assert(rows[0].observation.members.every(m => Math.abs(m.value_mm-expected) < 1e-6));
        assert.equal(rows[0].observation.value_mm,expected);
        if (scenario === 'translation') assert.deepEqual(rows[0].observation.bounds_uv,[10,30,10,34]);
      } else {
        assert(rows.every(r => r.status === 'skipped_no_anchor' && r.rendered === false));
        if (scenario === 'nominal-only') assert.equal(rows[0].observation.value_mm,4);
        if (scenario === 'duplicate-id') assert.equal(rows.length,2);
      }
      result.anchor_cases.push({ scenario, status:'PASS', rows, drawing_quality:quality.status,
        manifest:relative(ROOT,draw.path), input_sha256:hash(configPath) });
    } catch(error) { result.errors.push(`anchor/${scenario}: ${error}`); }
    save();
  }
  const fixture = FIXTURES[0];
  for (const injection of ['diameter', 'center']) {
    try {
      const source = parse(readFileSync(resolve(ROOT, fixture.source), 'utf8'));
      const config = runtimeConfig(fixture, source, 'A');
      config.export.directory = `output/engineering-core-refocus/${runId}/error-${injection}`;
      const hole = config.shapes.find(s => s.id === 'hole_left');
      if (injection === 'diameter') hole.radius = 4;
      else {
        hole.position[0] = 32;
        config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement).expected_center_xy_mm = [30, 30];
      }
      const { dir, configPath } = writeConfig(config);
      cli(['create', configPath], dir);
      const create = manifest(dir, 'create', 'output', configPath);
      const quality = read(owned(create.value.linked_artifacts.quality_json));
      const brep = assertBrep(create, quality);
      assert.notEqual(quality.status, 'pass');
      const row = quality.engineering_quality.measurements.find(r => r.feature_id === 'hole_left' && r.validation_kind === 'reimported_step_geometry_check' && r.measurement_type === `hole_${injection}`);
      assert.equal(row?.status, 'fail');
      if (injection === 'diameter') { assert.equal(row.actual_value_mm, 8); assert.equal(row.expected_value_mm, 6); }
      else { assert.deepEqual(row.actual_center_xy_mm, [32, 30]); assert.deepEqual(row.expected_center_xy_mm, [30, 30]); }
      result.injections.push({ injection, status: 'DETECTED', manifest: relative(ROOT, create.path), input_sha256: hash(configPath), measurement: row, brep_path: brep, brep_roundtrip: quality.brep_roundtrip, default_exit_code: 0 });
    } catch (error) { result.errors.push(`injection/${injection}: ${error}`); }
  }
  const hinge = FIXTURES.find(f => f.id === 'hinge-block');
  for (const injection of ['y-diameter', 'y-center-x', 'y-center-z']) {
    try {
      const source = parse(readFileSync(resolve(ROOT, hinge.source), 'utf8'));
      const config = runtimeConfig(hinge, source, 'A');
      config.export.directory = `output/engineering-core-refocus/${runId}/error-${injection}`;
      fixHingeCenterRequirements(config);
      const hole = config.shapes.find(s => s.id === 'hinge_pin_left');
      if (injection === 'y-diameter') hole.radius = 5;
      else hole.position[injection === 'y-center-x' ? 0 : 2] += 1;
      const { dir, configPath } = writeConfig(config);
      cli(['create', configPath], dir);
      const create = manifest(dir, 'create', 'output', configPath);
      const quality = read(owned(create.value.linked_artifacts.quality_json));
      const brep = assertBrep(create, quality);
      assert.equal(quality.status, 'fail');
      const rows = quality.engineering_quality.measurements;
      const failedType = injection === 'y-diameter' ? 'hole_diameter' : 'hole_center';
      assertYRows(rows, HINGE_PINS[0], {
        diameter: injection === 'y-diameter' ? 10 : 8,
        center: injection === 'y-center-x' ? [22, 27] : injection === 'y-center-z' ? [21, 28] : [21, 27],
        failedType,
      });
      assertYRows(rows, HINGE_PINS[1]);
      assert.equal(rows.filter(row => row.status === 'fail').length, 2);
      assert(rows.filter(row => row.feature_id !== 'hinge_pin_left').every(row => row.status === 'pass'));
      const measurements = OBSERVATIONS.map(([kind]) => observedRow(rows, 'hinge_pin_left', kind, failedType));
      for (const row of measurements) {
        if (failedType === 'hole_center') assert(row.expected_source_field.endsWith('.expected_center_xz_mm'));
      }
      result.injections.push({ injection, status: 'DETECTED', manifest: relative(ROOT, create.path), input_sha256: hash(configPath), measurements, brep_path: brep, brep_roundtrip: quality.brep_roundtrip, default_exit_code: 0 });
    } catch (error) { result.errors.push(`injection/${injection}: ${error}`); }
  }
  try {
    assert(hingeBaselineA, 'successful hinge A observations required for axial invariance');
    const source = parse(readFileSync(resolve(ROOT, hinge.source), 'utf8'));
    const config = runtimeConfig(hinge, source, 'A');
    config.export.directory = `output/engineering-core-refocus/${runId}/y-origin-shift`;
    fixHingeCenterRequirements(config);
    config.shapes.find(s => s.id === 'hinge_pin_left').position[1] = 29;
    const { dir, configPath } = writeConfig(config);
    cli(['create', configPath], dir);
    const create = manifest(dir, 'create', 'output', configPath);
    const quality = read(owned(create.value.linked_artifacts.quality_json));
    const brep = assertBrep(create, quality);
    assert.equal(quality.status, 'pass');
    const rows = quality.engineering_quality.measurements;
    for (const pin of HINGE_PINS) assertYRows(rows, pin);
    assert.equal(rows.length, 16);
    assert(rows.every(row => row.status === 'pass'));
    const baseline = hingeBaselineA.quality;
    const deltas = {
      generated: geometryDelta(baseline.geometry, quality.geometry),
      step: geometryDelta(baseline.step_roundtrip.reimported_geometry, quality.step_roundtrip.reimported_geometry),
      brep: geometryDelta(baseline.brep_roundtrip.reimported_geometry, quality.brep_roundtrip.reimported_geometry),
    };
    result.invariances.push({ change: 'hinge_pin_left axial origin Y 28 -> 29 mm; fixed XZ [21,27]', status: 'PASS', baseline_quality_path: relative(ROOT, hingeBaselineA.qualityPath), manifest: relative(ROOT, create.path), input_sha256: hash(configPath), geometry_deltas: deltas, measurements: rows, brep_path: brep, brep_roundtrip: quality.brep_roundtrip });
  } catch (error) { result.errors.push(`invariance/y-origin-shift: ${error}`); }
} catch (error) { result.errors.push(String(error)); }
save();
console.log(`Runtime results: ${relative(ROOT, join(out, 'results.json'))}`);
assert.equal(result.errors.length, 0, result.errors.join('\n'));
assert.equal(result.cases.length, 6);
assert.equal(result.comparisons.length, 3);
assert.equal(result.injections.length, 5);
assert.equal(result.invariances.length, 1);
assert.equal(result.anchor_cases.length, 8);

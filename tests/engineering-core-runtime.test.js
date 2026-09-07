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
import { validateCreateQualityReport } from '../lib/create-quality.js';
import { buildRuntimeSmokeBoundary } from '../lib/runtime-smoke-governance.js';
import { FIXTURES, prepareConfig } from './helpers/engineering-core-fixtures.js';

const ROOT = resolve(import.meta.dirname, '..');
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
  dirty_at_start: !!spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
  environment: { os: `${platform()} ${release()}`, node: process.version },
  commands: [], cases: [], comparisons: [], injections: [], errors: [],
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
        const config = prepareConfig(ROOT, runId, fixture, source, revision);
        const dir = resolve(ROOT, config.export.directory);
        mkdirSync(dir, { recursive: true });
        const configPath = join(dir, 'config.toml');
        writeFileSync(configPath, stringify(config));
        assert.equal(resolve(ROOT, parse(readFileSync(configPath, 'utf8')).export.directory), dir);
        owned(configPath); // Check resolved/symlink path before launching anything.
        record.source = { path: fixture.source, sha256: hash(sourcePath) };
        record.config = { path: relative(ROOT, configPath), sha256: hash(configPath), synthetic_identity_fields: ['package_slug', 'part_id', 'revision'].filter(k => source.product?.[k] === undefined) };
        cli(['create', configPath], dir);
        const create = manifest(dir, 'create', 'output', configPath);
        record.create_manifest = relative(ROOT, create.path);
        record.runtime = create.value.runtime;
        const qualityPath = owned(create.value.linked_artifacts.quality_json);
        const quality = read(qualityPath);
        assert.equal(validateCreateQualityReport(quality).ok, true);
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
        if (fixture.id === 'quality-pass-bracket') assert.equal(quality.status, 'pass');
        if (fixture.id === 'hinge-block') {
          assert.notEqual(quality.status, 'pass');
          for (const id of ['hinge_pin_left', 'hinge_pin_right']) {
            for (const kind of ['generated_shape_geometry_check', 'reimported_step_geometry_check']) {
              for (const type of ['hole_diameter', 'hole_center']) {
                assert.equal(rows.find(r => r.feature_id === id && r.validation_kind === kind && r.measurement_type === type)?.status, 'unavailable');
              }
            }
          }
        }
        cli(['draw', configPath], dir);
        const draw = manifest(dir, 'draw', 'output', configPath);
        record.draw_manifest = relative(ROOT, draw.path);
        const svg = output(draw, 'drawing.svg');
        assert(readFileSync(svg, 'utf8').includes('<svg'));
        const drawingQuality = output(draw, 'drawing.quality-json');
        const intentPath = output(draw, 'drawing.intent-json');
        const catalog = output(draw, 'drawing.feature-catalog-json');
        record.drawing_quality = read(drawingQuality).status;
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
  const fixture = FIXTURES[0];
  for (const injection of ['diameter', 'center']) {
    try {
      const source = parse(readFileSync(resolve(ROOT, fixture.source), 'utf8'));
      const config = prepareConfig(ROOT, runId, fixture, source, 'A');
      config.export.directory = `output/engineering-core-refocus/${runId}/error-${injection}`;
      const dir = resolve(ROOT, config.export.directory); mkdirSync(dir);
      const hole = config.shapes.find(s => s.id === 'hole_left');
      if (injection === 'diameter') hole.radius = 4;
      else {
        hole.position[0] = 32;
        config.drawing_intent.required_dimensions.find(d => d.id === fixture.requirement).expected_center_xy_mm = [30, 30];
      }
      const configPath = join(dir, 'config.toml'); writeFileSync(configPath, stringify(config)); owned(configPath);
      cli(['create', configPath], dir);
      const create = manifest(dir, 'create', 'output', configPath);
      const quality = read(owned(create.value.linked_artifacts.quality_json));
      assert.notEqual(quality.status, 'pass');
      const row = quality.engineering_quality.measurements.find(r => r.feature_id === 'hole_left' && r.validation_kind === 'reimported_step_geometry_check' && r.measurement_type === `hole_${injection}`);
      assert.equal(row?.status, 'fail');
      if (injection === 'diameter') { assert.equal(row.actual_value_mm, 8); assert.equal(row.expected_value_mm, 6); }
      else { assert.deepEqual(row.actual_center_xy_mm, [32, 30]); assert.deepEqual(row.expected_center_xy_mm, [30, 30]); }
      result.injections.push({ injection, status: 'DETECTED', manifest: relative(ROOT, create.path), input_sha256: hash(configPath), measurement: row, default_exit_code: 0 });
    } catch (error) { result.errors.push(`injection/${injection}: ${error}`); }
  }
} catch (error) { result.errors.push(String(error)); }
save();
console.log(`Runtime results: ${relative(ROOT, join(out, 'results.json'))}`);
assert.equal(result.errors.length, 0, result.errors.join('\n'));
assert.equal(result.cases.length, 6);
assert.equal(result.comparisons.length, 3);
assert.equal(result.injections.length, 2);

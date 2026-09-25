// Downstream review of this fixed synthetic case. Never edits its source run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { getFreeCADInvocation } from '../../../lib/paths.js';
import { validateDecisionReportSummary } from '../../../src/services/report/decision-report-summary.js';

const caseDir = import.meta.dirname;
const repo = resolve(caseDir, '../../..');
if (process.argv.length !== 3 || process.argv[2] === '--help') {
  console.log('Usage: node docs/portfolio/usb-hub-plate-change/engineering-review.mjs output/usb-hub-portfolio-<run>');
  process.exit(process.argv[2] === '--help' ? 0 : 1);
}
const sourceRoot = resolve(repo, process.argv[2]);
const sourceRelative = relative(join(repo, 'output'), sourceRoot);
assert.ok(sourceRelative && !sourceRelative.startsWith('..') && !isAbsolute(sourceRelative), 'Source run must be inside output/.');
const local = (path) => relative(repo, path).split('\\').join('/');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), 'Case evidence must not contain symbolic links.');
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }).sort();
}
const originalPaths = [...filesIn(sourceRoot), ...filesIn(join(caseDir, 'inputs'))];
const originals = originalPaths.map((path) => ({ path: local(path), sha256: sha256(path) }));
assert.equal(readJson(join(sourceRoot, 'case-result.json')).pass, true);
const out = mkdtempSync(join(repo, 'output/usb-hub-engineering-review-'));
const ledger = [];
console.log(`Output: ${local(out)}`);
function run(label, command, args, input) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: repo, input, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  writeFileSync(join(out, `${label}.log`), `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx' });
  ledger.push({ label, command, args, started_at: startedAt, finished_at: new Date().toISOString(),
    exit_code: result.status, signal: result.signal, error: result.error?.message || null, log: `${label}.log` });
  writeFileSync(join(out, 'commands.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${label}: see ${local(out)}/${label}.log`);
  console.log(`${label}: exit 0`);
  return result.stdout;
}
const cli = (label, args) => run(label, process.execPath, ['bin/fcad.js', ...args]);

try {
  const referenceDir = join(out, 'source-measurement');
  for (const rev of ['A', 'B']) {
    const folder = `rev-${rev.toLowerCase()}`;
    mkdirSync(join(referenceDir, folder), { recursive: true });
    for (const suffix of ['.step', '_drawing.svg']) {
      const name = `usb_hub_surrogate_${rev}${suffix}`;
      copyFileSync(join(sourceRoot, folder, name), join(referenceDir, folder, name));
    }
  }
  const measurement = getFreeCADInvocation(relative(join(repo, 'scripts'), join(caseDir, 'measure.py')));
  assert.notEqual(measurement.runtime.mode, 'wsl-windows', 'This fixed-case helper requires native Node and FreeCAD.');
  run('remeasure-source-step-svg', measurement.command, measurement.args, JSON.stringify({ root: referenceDir }));
  const measured = readJson(join(referenceDir, 'measurements.json'));
  assert.equal(measured.pass, true);

  const freshB = join(out, 'rev-b');
  mkdirSync(freshB);
  const config = parse(readFileSync(join(caseDir, 'inputs/rev-b.toml'), 'utf8'));
  config.export.directory = local(freshB);
  const configPath = join(freshB, 'config.toml');
  writeFileSync(configPath, stringify(config), { flag: 'wx' });
  cli('create-b', ['create', local(configPath), '--strict-quality']);
  cli('draw-b', ['draw', local(configPath), '--strict-quality']);
  const dfmCode = `
import { loadConfigWithDiagnostics } from './lib/config-schema.js';
import { runDfm } from './src/services/analysis/dfm-service.js';
const { config } = await loadConfigWithDiagnostics(process.argv[1]);
const result = await runDfm({ freecadRoot: process.cwd(), config, process: config.manufacturing?.process || 'machining' });
console.log(JSON.stringify(result));
if (!result.success) process.exitCode = 1;
`;
  const dfm = JSON.parse(run('capture-dfm', process.execPath, ['--input-type=module', '-e', dfmCode, local(configPath)]));
  writeJson(join(freshB, 'dfm.json'), dfm);
  cli('report-b-with-dfm', ['report', local(configPath), '--dfm', '--out-dir', local(freshB)]);
  const report = readJson(join(freshB, 'usb_hub_surrogate_B_report_summary.json'));
  assert.equal(validateDecisionReportSummary(report).ok, true);
  assert.equal(report.surfaces.dfm.available, true);
  assert.equal(report.surfaces.fem.available, false);

  const reviewDir = join(sourceRoot, 'revision-review');
  const impact = readJson(join(reviewDir, 'revision-impact.json'));
  const fullPlan = readJson(join(reviewDir, 'inspection-full.json'));
  const deltaPlan = readJson(join(reviewDir, 'inspection-delta.json'));
  const patterns = {};
  const geometry = {};
  for (const rev of ['A', 'B']) {
    const observed = measured.revisions[rev];
    const geo = readJson(join(reviewDir, `rev-${rev.toLowerCase()}`, 'review-pack_geometry_intelligence.json'));
    const patternRecords = geo.derived_features.filter((entry) => entry.feature_type === 'hole_pattern');
    assert.equal(patternRecords.length, 1);
    const pattern = geo.entity_index.bolt_circles[0];
    assert.equal(geo.entity_index.bolt_circles.length, 1);
    const holes = [...observed.holes].sort((a, b) => a.x - b.x || a.y - b.y);
    const indexedHoles = geo.entity_index.cylinders.filter((entry) => entry.is_hole)
      .sort((a, b) => a.center[0] - b.center[0] || a.center[1] - b.center[1]);
    assert.equal(indexedHoles.length, holes.length);
    holes.forEach((hole, index) => {
      assert.ok(Math.abs(hole.x - indexedHoles[index].center[0]) < 1e-5);
      assert.ok(Math.abs(hole.y - indexedHoles[index].center[1]) < 1e-5);
      assert.ok(Math.abs(hole.diameter - indexedHoles[index].diameter_mm) < 1e-5);
    });
    const pitchX = holes[2].x - holes[0].x;
    const pitchY = holes[1].y - holes[0].y;
    const diameter = holes[0].diameter;
    const circumdiameter = Math.hypot(pitchX, pitchY);
    const center = [(holes[0].x + holes[2].x) / 2, (holes[0].y + holes[1].y) / 2];
    assert.equal(pattern.hole_count, 4);
    assert.equal(pattern.hole_diameter_mm, diameter);
    assert.deepEqual(pattern.center, center);
    assert.ok(Math.abs(pattern.pcd_mm - circumdiameter) <= 0.0005, 'Pattern PCD must equal rounded rectangle circumdiameter.');
    const [length, width, thickness] = observed.bbox_mm;
    const inertia = width * thickness ** 3 / 12;
    geometry[rev] = {
      holes_by_role: Object.fromEntries(['D1', 'D2', 'H1', 'H2'].map((role, i) => [role, holes[i]])),
      bbox_mm: observed.bbox_mm, volume_mm3: observed.volume_mm3,
      horizontal_pitch_mm: pitchX, vertical_pitch_mm: pitchY,
      horizontal_clear_ligament_mm: pitchX - diameter, vertical_clear_ligament_mm: pitchY - diameter,
      left_edge_ligament_mm: holes[0].x - diameter / 2,
      right_edge_ligament_mm: length - holes[2].x - diameter / 2,
      bottom_edge_ligament_mm: holes[0].y - diameter / 2,
      top_edge_ligament_mm: width - holes[1].y - diameter / 2,
      gross_section_area_mm2: width * thickness,
      section_area_through_two_holes_mm2: (width - 2 * diameter) * thickness,
      assumed_cantilever_length_mm: pitchX, gross_I_mm4: inertia,
      gross_bending_stress_per_unit_load_MPa_per_N: pitchX * thickness / (2 * inertia),
      E_times_tip_compliance_per_mm: pitchX ** 3 / (3 * inertia),
    };
    patterns[rev] = { derived_feature: patternRecords[0], entity: pattern,
      rectangle_circumdiameter_mm: circumdiameter, center_mm: center,
      member_entity_refs: indexedHoles.map((hole) => hole.entity_ref) };
  }
  const unresolved = deltaPlan.items.filter((item) => item.characteristic_id === patterns.B.derived_feature.feature_id);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].nominal_value, null);
  assert.equal(fullPlan.items.length, 17);
  assert.equal(deltaPlan.items.length, 9);
  const sourceUnchanged = originals.every((record) => sha256(join(repo, record.path)) === record.sha256);
  assert.equal(sourceUnchanged, true);
  writeJson(join(out, 'source-hashes.json'), originals);
  const result = {
    record_type: 'downstream_synthetic_engineering_review', generated_at: new Date().toISOString(),
    source_run: local(sourceRoot), source_head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
    source_files_unchanged: sourceUnchanged, production_trust: false,
    report: { file: local(join(freshB, 'usb_hub_surrogate_B_report_summary.json')),
      overall_status: report.overall_status, overall_score: report.overall_score,
      ready_for_manufacturing_review: report.ready_for_manufacturing_review,
      blocking_issues: report.blocking_issues, warnings: report.warnings, surfaces: report.surfaces },
    dfm: { file: local(join(freshB, 'dfm.json')), process: dfm.process, score: dfm.score, summary: dfm.summary, issues: dfm.issues },
    pattern_reconciliation: { status: 'geometry_correspondence_demonstrated_pending_human_review', patterns,
      canonical_changes: impact.changes.filter((change) => change.affected_entity_id.startsWith('feature:hole_pattern:')),
      canonical_delta_item: unresolved[0], canonical_full_item_count: fullPlan.items.length,
      canonical_delta_item_count: deltaPlan.items.length, canonical_plan_status: deltaPlan.status,
      canonical_plans_modified: false, description: 'One summary of the same four hole roles with changed rectangular span; not a fifth physical hole or an independently released inspection requirement.' },
    geometry, sensitivity: {
      length_ratio_B_over_A: geometry.B.horizontal_pitch_mm / geometry.A.horizontal_pitch_mm,
      bending_stress_ratio_B_over_A_same_load: geometry.B.horizontal_pitch_mm / geometry.A.horizontal_pitch_mm,
      tip_deflection_ratio_B_over_A_same_load_E_and_gross_section: (geometry.B.horizontal_pitch_mm / geometry.A.horizontal_pitch_mm) ** 3,
      assumed_model: 'Uniform gross rectangular beam, full-width clamp at the D-hole centerline and centered transverse resultant at the H-hole line; small-deflection linear elasticity. Actual two-bolt support, holes, contact, local bearing, torsion and plate action are not modeled.',
      E_MPa: null, load_N: null, material: null, safety_factor: null,
    },
    physical_inspection_performed: false, FEA_performed: false, human_release: false,
  };
  writeJson(join(out, 'engineering-review.json'), result);
  const portable = {
    ...result,
    report: {
      ...result.report,
      surfaces: Object.fromEntries(Object.entries(report.surfaces).map(([name, surface]) => [name, {
        available: surface.available, status: surface.status, score: surface.score,
        ...(surface.severity_counts ? { severity_counts: surface.severity_counts } : {}),
      }])),
    },
  };
  writeJson(join(out, 'engineering-review-portable.json'), portable);
  writeJson(join(out, 'output-hashes.json'), filesIn(out).map((path) => ({ path: local(path), size_bytes: statSync(path).size, sha256: sha256(path) })));
  console.log(JSON.stringify({ output: local(out), overall_status: report.overall_status, dfm_score: dfm.score,
    pattern_reconciliation: result.pattern_reconciliation.status, source_files_unchanged: sourceUnchanged }, null, 2));
} catch (error) {
  console.error(`Engineering review incomplete: ${error.message}\nRetained evidence: ${local(out)}`);
  process.exitCode = 1;
}

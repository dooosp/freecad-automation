// Reproduce this fixed synthetic portfolio case with existing fcad commands.
// Generated files go to a new ignored directory on every invocation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { getFreeCADInvocation } from '../../../lib/paths.js';
import { reproduceRevisionCase } from './revision-case.mjs';

const caseDir = import.meta.dirname;
const repo = resolve(caseDir, '../../..');
if (process.argv.length > 2) {
  console.log('From the repository: node docs/portfolio/usb-hub-plate-change/reproduce.mjs');
  process.exit(process.argv[2] === '--help' && process.argv.length === 3 ? 0 : 1);
}
assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'))).name, 'freecad-automation');
const measurement = getFreeCADInvocation(relative(join(repo, 'scripts'), join(caseDir, 'measure.py')));
// This case helper has only been exercised with a native runtime. WSL path
// translation remains the responsibility of the existing CLI, not this helper.
assert.notEqual(measurement.runtime.mode, 'wsl-windows', 'Run this case helper with native Node and FreeCAD.');
mkdirSync(join(repo, 'output'), { recursive: true });
const out = mkdtempSync(join(repo, 'output/usb-hub-portfolio-'));
const local = (path) => relative(repo, path).split('\\').join('/');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const ledger = [];

function run(label, command, args, expectedExit = 0, input) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: repo, input, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const log = `${label}.log`;
  writeFileSync(join(out, log), `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx' });
  ledger.push({ label, command, args, started_at: startedAt, finished_at: new Date().toISOString(),
    exit_code: result.status, expected_exit: expectedExit, signal: result.signal,
    error: result.error?.message || null, log });
  // This file belongs to this newly allocated run; persist partial failures too.
  writeFileSync(join(out, 'commands.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}; see ${log}`);
  assert.equal(result.status, expectedExit, `${label}: unexpected exit; see ${log}`);
  console.log(`${label}: exit ${result.status}${expectedExit ? ' (expected rejection)' : ''}`);
}

const cli = (label, args, expectedExit = 0) => run(label, process.execPath, ['bin/fcad.js', ...args], expectedExit);
const quality = (dir, rev, kind) => json(join(out, dir, `usb_hub_surrogate_${rev}_${kind}_quality.json`));
const states = {};
const inputs = {};
console.log(`Output: ${local(out)}`);
try {
  for (const rev of ['A', 'B']) {
    const dir = `rev-${rev.toLowerCase()}`;
    const source = join(caseDir, 'inputs', `${dir}.toml`);
    const config = parse(readFileSync(source, 'utf8'));
    inputs[rev] = { path: local(source), sha256: sha256(source) };
    const outputDir = join(out, dir);
    mkdirSync(outputDir);
    config.export.directory = local(outputDir);
    const configPath = join(outputDir, 'config.toml');
    writeFileSync(configPath, stringify(config), { flag: 'wx' });
    cli(`${dir}-create`, ['create', local(configPath), '--strict-quality']);
    cli(`${dir}-draw`, ['draw', local(configPath), '--strict-quality']);
    const create = quality(dir, rev, 'create');
    const draw = quality(dir, rev, 'drawing');
    assert.equal(create.status, 'pass');
    assert.equal(draw.status, 'pass');
    assert.equal(draw.traceability.coverage_percent, 100);
    states[rev] = { create_status: create.status, drawing_status: draw.status,
      qa_score: draw.score, traceability_percent: draw.traceability.coverage_percent };
  }

  // Reuse B's actual effective drawing plan, changing its WIDTH annotation only.
  // Default and strict commands use separate directories, retaining both runs.
  for (const strict of [false, true]) {
    const dir = strict ? 'annotation-strict' : 'annotation-warning';
    const config = json(join(out, 'rev-b/usb_hub_surrogate_B_effective_config.json'));
    const beforeShapes = JSON.stringify(config.shapes);
    const widths = config.drawing_plan.dim_intents.filter((d) => d.id === 'WIDTH');
    assert.equal(widths.length, 1);
    assert.equal(widths[0].value_mm, 142);
    widths[0].value_mm = 150;
    assert.equal(JSON.stringify(config.shapes), beforeShapes);
    const outputDir = join(out, dir);
    mkdirSync(outputDir);
    config.export.directory = local(outputDir);
    const configPath = join(outputDir, 'config.json');
    writeJson(configPath, config);
    cli(dir, ['draw', local(configPath), ...(strict ? ['--strict-quality'] : [])], strict ? 1 : 0);
    const draw = quality(dir, 'B', 'drawing');
    assert.equal(draw.status, 'fail');
    assert.equal(draw.score, states.B.qa_score);
    assert.equal(draw.traceability.coverage_percent, 80);
    assert.ok(draw.traceability.unmapped_required_entities.includes('WIDTH'));
    states[dir] = { exit_code: strict ? 1 : 0, drawing_status: draw.status,
      qa_score: draw.score, traceability_percent: draw.traceability.coverage_percent,
      unmapped_required_entities: draw.traceability.unmapped_required_entities };
  }

  run('measure', measurement.command, measurement.args, 0, JSON.stringify({ root: out }));
  const measured = json(join(out, 'measurements.json'));
  assert.equal(measured.pass, true, 'Saved STEP/SVG measurements failed.');
  const revisionReview = reproduceRevisionCase({ repo, out, caseDir, cli });
  for (const entry of Object.values(inputs)) assert.equal(sha256(join(repo, entry.path)), entry.sha256);
  writeJson(join(out, 'case-result.json'), {
    kind: 'synthetic CAD software demonstration; not physical inspection or manufacturing approval',
    completed_at: new Date().toISOString(),
    source_head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(),
    node: process.version, inputs, states, measurements: 'measurements.json',
    commands: 'commands.json', revision_review: revisionReview, pass: true,
  });
  console.log(`PASS: ${local(join(out, 'case-result.json'))}`);
} catch (error) {
  console.error(`Case incomplete: ${error.message}\nRetained evidence: ${local(out)}`);
  process.exitCode = 1;
}

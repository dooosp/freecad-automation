import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { buildDecisionReportSummary } from '../src/services/report/decision-report-summary.js';
import { createReportEvidenceFixture } from './helpers/report-evidence-fixture.js';

const cases = [
  ['fresh producer evidence', async () => {}, 'pass', null],
  ['warning producer remains applicable when output evidence passes', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest);
    manifest.status = 'warning'; manifest.warnings = ['Optional export was not requested.'];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'pass', null],
  ['failed producer cannot attest passing quality files', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.status = 'fail';
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'fail', 'producer-failed'],
  ['producer errors prevent readiness despite a passing manifest status', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); manifest.errors = ['Drawing producer failed after export.'];
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'fail', 'producer-failed'],
  ['unknown producer outcome cannot attest readiness', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.status = 'unknown';
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'producer-status-unverified'],
  ['same path edited after production', async (f) => {
    const changed = structuredClone(f.rawConfig); changed.shapes[0].height = 10;
    await f.writeJson(f.configPath, changed); f.config.shapes[0].height = 10;
  }, 'fail', 'input-content-mismatch'],
  ['same basename different input', async (f) => {
    const other = join(f.directory, 'other'); await mkdir(other);
    const changed = structuredClone(f.rawConfig); changed.shapes[0].height = 10;
    f.configPath = join(other, 'part.json'); await f.writeJson(f.configPath, changed);
    f.config.shapes[0].height = 10;
  }, 'fail', 'input-content-mismatch'],
  ['in-memory configuration differs from current input', async (f) => { f.config.shapes[0].height = 10; }, 'fail', 'report-config-mismatch'],
  ['routing directory alone may differ', async (f) => { f.config.export.directory = join(f.directory, 'relocated'); }, 'pass', null],
  ['legacy missing manifest', async (f) => { await rm(f.paths.createManifest); }, 'incomplete', 'manifest-missing'],
  ['legacy untracked create quality', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.outputs = [];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'output-record-missing'],
  ['missing producer input hash', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.input.sha256 = null;
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'input-proof-missing'],
  ['missing quality output hash', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.outputs[0].sha256 = null;
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'output-proof-missing'],
  ['missing drawing SVG proof', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest);
    manifest.outputs = manifest.outputs.filter((record) => record.kind !== 'drawing.svg');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'output-record-missing'],
  ['changed output size contradicts producer', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.outputs[0].size_bytes += 1;
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'fail', 'output-content-mismatch'],
  ['same-size quality tampering still fails SHA verification', async (f) => {
    const original = await readFile(f.paths.drawing, 'utf8');
    await writeFile(f.paths.drawing, original.replace('96', '99'));
  }, 'fail', 'output-content-mismatch'],
  ['wrong producer command', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.command = 'inspect';
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'fail', 'producer-command-mismatch'],
  ['unsupported manifest version', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.schema_version = '99';
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'manifest-schema-unsupported'],
  ['malformed manifest arguments remain readable unknown evidence', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.command_args = [null];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'manifest-invalid'],
  ['empty positional input cannot attest producer arguments', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.command_args = [''];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'producer-arguments-unverified'],
  ['whitespace positional input cannot attest producer arguments', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.command_args = ['   '];
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'producer-arguments-unverified'],
  ['duplicate typed quality records', async (f) => {
    const manifest = await f.readJson(f.paths.createManifest); manifest.outputs.push(manifest.outputs[0]);
    await f.writeJson(f.paths.createManifest, manifest);
  }, 'incomplete', 'output-record-ambiguous'],
  ['quality JSON tampering', async (f) => {
    const quality = await f.readJson(f.paths.drawing); quality.score = 100;
    await f.writeJson(f.paths.drawing, quality);
  }, 'fail', 'output-content-mismatch'],
  ['drawing SVG tampering', async (f) => { await writeFile(f.paths.svg, '<svg><text>10</text></svg>'); }, 'fail', 'output-content-mismatch'],
  ['extracted semantics tampering', async (f) => { await f.writeJson(f.paths.semantics, { status: 'changed' }); }, 'fail', 'output-content-mismatch'],
  ['override arguments cannot attest effective input', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); manifest.command_args.push('--override', 'override.json');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'producer-arguments-unverified'],
  ['plan arguments cannot attest side input', async (f) => {
    const manifest = await f.readJson(f.paths.drawingManifest); manifest.command_args.push('--plan=plan.json');
    await f.writeJson(f.paths.drawingManifest, manifest);
  }, 'incomplete', 'producer-arguments-unverified'],
  ['copied producer records may retain original paths', async (f) => {
    for (const key of ['createManifest', 'drawingManifest']) {
      const manifest = await f.readJson(f.paths[key]);
      for (const record of manifest.outputs) record.path = join(f.directory, 'original', record.kind);
      await f.writeJson(f.paths[key], manifest);
    }
  }, 'pass', null],
  ['tampered copy must not use intact original bytes', async (f) => {
    const original = join(f.directory, 'original.json'); await copyFile(f.paths.create, original);
    const manifest = await f.readJson(f.paths.createManifest); manifest.outputs[0].path = original;
    await f.writeJson(f.paths.createManifest, manifest);
    await f.writeJson(f.paths.create, { status: 'pass', geometry: { valid_shape: true }, forged: true });
  }, 'fail', 'output-content-mismatch'],
];

for (const [name, mutate, status, reason] of cases) {
  test(name, async () => {
    const fixture = await createReportEvidenceFixture();
    try {
      await mutate(fixture);
      const { result, summary, pdfSummary } = await fixture.report({ configPath: fixture.configPath });
      assert.equal(result.success, true, 'unverified quality must still allow report generation');
      assert.equal(summary.overall_status, status);
      assert.equal(summary.ready_for_manufacturing_review, status === 'pass');
      assert.equal(summary.overall_score, status === 'pass' ? 96 : null);
      assert.equal(pdfSummary.overall_status, summary.overall_status);
      assert.equal(pdfSummary.ready_for_manufacturing_review, summary.ready_for_manufacturing_review);
      if (reason) {
        const proof = [summary.surfaces.create_quality.evidence_provenance, summary.surfaces.drawing_quality.evidence_provenance];
        assert(proof.some((entry) => entry?.reason_codes.includes(reason)), reason);
        assert([...pdfSummary.blocking_issues, ...pdfSummary.warnings].some((entry) => entry.includes(reason)), 'PDF input must explain provenance failure');
      }
    } finally { await fixture.cleanup(); }
  });
}

test('quality and manifest replacements during rendering cannot change the final decision snapshot', async () => {
  const fixture = await createReportEvidenceFixture();
  try {
    const { summary, pdfSummary } = await fixture.report({ duringRender: async () => {
      await fixture.writeJson(fixture.paths.drawing, { status: 'fail', score: 0, blocking_issues: ['Replacement after snapshot'] });
      await rm(fixture.paths.createManifest);
    } });
    assert.equal(summary.overall_status, 'pass');
    assert.deepEqual(summary.surfaces, pdfSummary.surfaces);
    assert.equal(summary.generated_at, pdfSummary.generated_at);
    assert.equal(summary.surfaces.drawing_quality.evidence_provenance.status, 'pass');
  } finally { await fixture.cleanup(); }
});

test('a bare quality JSON cannot attest current-input readiness in the pure summary', () => {
  const summary = buildDecisionReportSummary({
    config: { name: 'unbound' }, createQuality: { status: 'pass', geometry: { valid_shape: true } },
    drawingQuality: { status: 'pass', score: 100 }, dfm: { score: 100, issues: [] },
  });
  assert.equal(summary.overall_status, 'incomplete');
  assert.equal(summary.ready_for_manufacturing_review, false);
  assert.equal(summary.overall_score, null);
  assert.equal(summary.surfaces.create_quality.evidence_provenance.status, 'unknown');
});

test('unverified evidence preserves genuine shape and drawing failure reasons', async () => {
  const fixture = await createReportEvidenceFixture();
  try {
    await fixture.writeJson(fixture.paths.create, { status: 'fail', geometry: { valid_shape: false }, blocking_issues: ['Generated model shape is invalid.'] });
    await fixture.writeJson(fixture.paths.drawing, { status: 'fail', score: 12, dimensions: { missing_required_intents: ['HOLE_DIA'], conflict_count: 1 }, blocking_issues: ['HOLE_DIA missing', 'Dimension conflict'] });
    await rm(fixture.paths.createManifest); await rm(fixture.paths.drawingManifest);
    const { summary, pdfSummary } = await fixture.report();
    assert.equal(summary.overall_status, 'fail');
    assert.equal(summary.ready_for_manufacturing_review, false);
    for (const reason of ['Generated model shape is invalid.', 'HOLE_DIA missing', 'Dimension conflict']) {
      assert(summary.blocking_issues.includes(reason));
      assert(pdfSummary.blocking_issues.includes(reason));
    }
  } finally { await fixture.cleanup(); }
});

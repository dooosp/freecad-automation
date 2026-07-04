import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function loadEvidenceGraphService() {
  try {
    return await import('../src/services/evidence-graph/evidence-graph-service.js');
  } catch (error) {
    assert.fail(`evidence graph service should be importable: ${error.message}`);
  }
}

const reviewPack = {
  artifact_type: 'review_pack',
  package_id: 'quality-pass-bracket',
  evidence_ledger: {
    records: [
      {
        id: 'drawing-quality-report',
        type: 'drawing_quality_report',
        artifact_type: 'drawing_quality_report',
        path: 'docs/examples/quality-pass-bracket/quality/drawing_quality.json',
      },
      {
        id: 'supplier-inspection-record',
        type: 'inspection_evidence',
        artifact_type: 'inspection_evidence',
        path: 'docs/examples/quality-pass-bracket/inspection/inspection_evidence.json',
        inspection_evidence: true,
      },
    ],
  },
};

const readinessReport = {
  status: 'needs_more_evidence',
  gate_decision: 'hold_for_evidence_completion',
  missing_inputs: ['inspection_evidence'],
};

const {
  assertEvidenceGraphInputIdentity,
  buildEvidenceGraph,
  validateEvidenceGraph,
} = await loadEvidenceGraphService();
const graph = buildEvidenceGraph({
  packageId: 'quality-pass-bracket',
  reviewPack,
  readinessReport,
});

assert.equal(graph.schema_version, '1.0');
assert.equal(graph.package_id, 'quality-pass-bracket');
assert.equal(graph.nodes.length, 3);
assert.equal(graph.summary.node_count, 3);
assert.equal(graph.summary.inspection_evidence_record_count, 1);
assert.equal(graph.summary.generated_artifact_count, 1);
assert.equal(graph.summary.readiness_gate_decision, 'hold_for_evidence_completion');
assert.equal(graph.summary.readiness_status, 'needs_more_evidence');
assert.equal(
  graph.nodes.filter((node) => node.kind === 'inspection_evidence').length,
  1,
  'inspection evidence must stay distinct from generated artifacts'
);
assert.equal(
  graph.nodes.filter((node) => node.kind === 'generated_artifact').length,
  1,
  'drawing quality report must count as generated artifact, not inspection evidence'
);
const serviceValidation = validateEvidenceGraph(graph);
assert.equal(
  serviceValidation.ok,
  true,
  `service graph should satisfy schemas/evidence-graph.schema.json: ${serviceValidation.errors.join('\n')}`
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack: { ...reviewPack, package_id: 'different-package' },
    readinessReport,
  }),
  /review-pack package identity.*different-package.*does not match.*quality-pass-bracket/i
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack,
    readinessReport: {
      ...readinessReport,
      readiness_summary: { package_id: 'different-package' },
    },
  }),
  /readiness report package identity.*different-package.*does not match.*quality-pass-bracket/i
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack: { artifact_type: 'drawing_quality_report', package_id: 'quality-pass-bracket' },
    readinessReport,
  }),
  /review-pack input is not a review_pack/i
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack: { readiness_summary: { package_id: 'quality-pass-bracket' } },
    readinessReport,
  }),
  /review-pack input is not a review_pack/i
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack,
    readinessReport: { artifact_type: 'review_pack', package_id: 'quality-pass-bracket' },
  }),
  /readiness input is not a readiness report/i
);

assert.throws(
  () => assertEvidenceGraphInputIdentity({
    packageId: 'quality-pass-bracket',
    reviewPack,
    readinessReport: { package_id: 'quality-pass-bracket', evidence_ledger: { records: [] } },
  }),
  /readiness input is not a readiness report/i
);

const invalidGraphValidation = validateEvidenceGraph({ ...graph, nodes: [{ id: 'node:missing-label' }] });
assert.equal(invalidGraphValidation.ok, false);
assert.match(invalidGraphValidation.errors.join('\n'), /label|required/i);

const tempParent = join(ROOT, 'tmp/codex');
mkdirSync(tempParent, { recursive: true });
const tempRoot = mkdtempSync(join(tempParent, 'evidence-graph-'));

try {
  const reviewPackPath = join(tempRoot, 'review_pack.json');
  const readinessPath = join(tempRoot, 'readiness_report.json');
  const outPath = join(tempRoot, 'evidence_graph.json');
  writeJson(reviewPackPath, reviewPack);
  writeJson(readinessPath, readinessReport);

  const run = spawnSync('node', [
    CLI,
    'evidence-graph',
    '--package',
    'quality-pass-bracket',
    '--review-pack',
    reviewPackPath,
    '--readiness',
    readinessPath,
    '--out',
    outPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, `evidence-graph CLI failed:\n${run.stdout}\n${run.stderr}`);
  assert.equal(existsSync(outPath), true, 'CLI should write only the explicit evidence graph output file');

  const cliGraph = readJson(outPath);
  assert.equal(cliGraph.schema_version, '1.0');
  assert.equal(cliGraph.summary.inspection_evidence_record_count, 1);
  assert.equal(cliGraph.summary.generated_artifact_count, 1);
  assert.equal(cliGraph.summary.readiness_gate_decision, 'hold_for_evidence_completion');
  const cliValidation = validateEvidenceGraph(cliGraph);
  assert.equal(
    cliValidation.ok,
    true,
    `CLI graph should satisfy schemas/evidence-graph.schema.json: ${cliValidation.errors.join('\n')}`
  );

  const mismatchOutPath = join(tempRoot, 'mismatch_evidence_graph.json');
  writeJson(readinessPath, {
    ...readinessReport,
    readiness_summary: {
      package_id: 'wrong-package',
      status: 'needs_more_evidence',
      gate_decision: 'hold_for_evidence_completion',
    },
  });

  const mismatchRun = spawnSync('node', [
    CLI,
    'evidence-graph',
    '--package',
    'quality-pass-bracket',
    '--review-pack',
    reviewPackPath,
    '--readiness',
    readinessPath,
    '--out',
    mismatchOutPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(mismatchRun.status, 0, 'mismatched readiness identity should fail');
  assert.match(mismatchRun.stderr, /readiness report package identity.*wrong-package.*does not match.*quality-pass-bracket/i);
  assert.equal(existsSync(mismatchOutPath), false, 'CLI must reject mismatched identity before writing output');

  const fixtureMismatchOutPath = join(tempRoot, 'fixture_mismatch_evidence_graph.json');
  const fixtureMismatchRun = spawnSync('node', [
    CLI,
    'evidence-graph',
    '--package',
    'controller-housing-eol',
    '--review-pack',
    join(ROOT, 'docs/examples/hinge-block/review/review_pack.json'),
    '--readiness',
    join(ROOT, 'docs/examples/quality-pass-bracket/readiness/readiness_report.json'),
    '--out',
    fixtureMismatchOutPath,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(fixtureMismatchRun.status, 0, 'mixed canonical fixture identities should fail');
  assert.match(
    fixtureMismatchRun.stderr,
    /package identity.*(hinge_block|quality_pass_bracket).*does not match.*controller-housing-eol/i
  );
  assert.equal(existsSync(fixtureMismatchOutPath), false, 'CLI must reject fixture identity mismatch before writing output');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('evidence-graph.test.js: ok');

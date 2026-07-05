import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  materializePr170EvidenceArtifacts,
} from '../src/services/evidence-readiness-audit/pr170-artifact-materializer.js';

const ROOT = resolve(import.meta.dirname, '..');
const outDir = join(ROOT, `output/test-evidence-artifacts-materialize-${process.pid}`);
const fixedNow = '2026-07-05T00:00:00.000Z';

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

async function writeFixturePackage(slug) {
  const packageRoot = join(outDir, 'docs/examples', slug);
  await mkdir(join(packageRoot, 'review'), { recursive: true });
  await mkdir(join(packageRoot, 'readiness'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'review/review_pack.json'),
    `${JSON.stringify({
      artifact_type: 'review_pack',
      schema_version: '1.0',
      generated_at: '2026-06-01T00:00:00.000Z',
      part: {
        part_id: 'quality_pass_bracket',
        material: 'AL6061',
        process: 'machining',
      },
      evidence_ledger: {
        records: [
          {
            evidence_id: 'geometry:wall_thickness:thin-wall_candidate',
            type: 'geometry_hotspot',
            title: 'Thin-wall candidate',
            inspection_evidence: false,
          },
          {
            evidence_id: 'package:create_quality_report:quality.json',
            type: 'create_quality_report',
            artifact_type: 'create_quality_report',
            source_ref: 'docs/examples/quality-pass-bracket/quality/quality.json',
            inspection_evidence: false,
          },
        ],
      },
      source_artifact_refs: [
        {
          artifact_type: 'create_quality_report',
          path: 'docs/examples/quality-pass-bracket/quality/quality.json',
          role: 'evidence',
          label: 'Create quality report',
        },
      ],
      coverage: {
        source_artifact_count: 1,
        inspection_record_count: 0,
      },
    }, null, 2)}\n`,
    'utf8'
  );
  writeFileSync(
    join(packageRoot, 'readiness/readiness_report.json'),
    `${JSON.stringify({
      artifact_type: 'readiness_report',
      schema_version: '1.0',
      generated_at: '2026-06-02T00:00:00.000Z',
      part: {
        part_id: 'quality_pass_bracket',
        material: 'AL6061',
        process: 'machining',
      },
      readiness_summary: {
        score: 61,
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      summary: {
        top_issues: ['Missing evidence: inspection_evidence'],
        recommended_actions: ['Collect or validate: inspection_evidence'],
      },
    }, null, 2)}\n`,
    'utf8'
  );
  return packageRoot;
}

try {
  const slug = 'quality-pass-bracket';
  await writeFixturePackage(slug);

  const result = await materializePr170EvidenceArtifacts({
    projectRoot: outDir,
    packageSlugs: [slug],
    generatedAt: fixedNow,
    runtimeDiagnosticsFactory: () => ({
      runtime_available: true,
      selected: {
        freecadcmd: '/Users/example/FreeCADCmd',
      },
      selected_runtime: {
        summary: 'macOS FreeCAD runtime (/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd)',
        executable: '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
      },
      versions: {
        freecad: '1.1.1',
        python: '3.12.0',
      },
    }),
  });

  assert.equal(result.artifact_type, 'pr170_evidence_artifact_materialization');
  assert.equal(result.generated_at, fixedNow);
  assert.equal(result.summary.package_count, 1);
  assert.equal(result.summary.written_artifact_count, 3);
  assert.equal(result.summary.generated_control_only, true);
  assert.equal(result.boundary.inspection_evidence_attached, false);
  assert.equal(result.boundary.readiness_regenerated, false);
  assert.equal(result.boundary.canonical_readiness_mutated, false);

  const packageResult = result.packages[0];
  assert.equal(packageResult.slug, slug);
  assert.equal(packageResult.artifacts.length, 3);
  assert.equal(packageResult.trusted_inspection_evidence, false);
  assert.equal(packageResult.generated_control_only, true);
  assert.equal(packageResult.readiness.gate_decision, 'hold_for_evidence_completion');

  const graphPath = join(outDir, 'docs/examples/quality-pass-bracket/evidence/evidence_graph.json');
  const fingerprintPath = join(outDir, 'docs/examples/quality-pass-bracket/runtime/runtime_fingerprint.json');
  const qifPath = join(outDir, 'docs/examples/quality-pass-bracket/inspection/qif_lite_focused_checks.xml');
  assert.equal(existsSync(graphPath), true);
  assert.equal(existsSync(fingerprintPath), true);
  assert.equal(existsSync(qifPath), true);

  const graph = readJson(graphPath);
  assert.equal(graph.artifact_type, 'evidence_graph');
  assert.equal(graph.package_slug, slug);
  assert.equal(graph.boundary.generated_control_only, true);
  assert.equal(graph.boundary.inspection_evidence_attached, false);
  assert.equal(graph.summary.trusted_inspection_evidence_node_count, 0);
  assert.equal(graph.nodes.some((node) => node.kind === 'qif_lite_inspection_xml'), true);
  assert.equal(graph.edges.some((edge) => edge.kind === 'readiness_gated_by'), true);
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  assert.deepEqual(
    graph.edges.filter((edge) => !graphNodeIds.has(edge.from) || !graphNodeIds.has(edge.to)),
    []
  );

  const fingerprint = readJson(fingerprintPath);
  assert.equal(fingerprint.artifact_type, 'runtime_fingerprint');
  assert.equal(fingerprint.package_slug, slug);
  assert.equal(fingerprint.boundary.generated_control_only, true);
  assert.equal(JSON.stringify(fingerprint).includes('/Users/example'), false);
  assert.equal(JSON.stringify(fingerprint).includes('/Applications/FreeCAD.app'), false);
  assert.equal(fingerprint.runtime_context.versions.freecad, '1.1.1');
  assert.equal(fingerprint.input_artifacts.review_pack.sha256.length, 64);

  const qif = readFileSync(qifPath, 'utf8');
  assert.match(qif, /<QIFLiteInspection/);
  assert.match(qif, /package_slug="quality-pass-bracket"/);
  assert.match(qif, /inspection_evidence_attached="false"/);
  assert.match(qif, /<FocusedCheck id="inspection_evidence"/);
  assert.match(qif, /status="held_missing"/);
  assert.doesNotMatch(qif, /trusted_inspection_evidence="true"/);

  const dryRun = await materializePr170EvidenceArtifacts({
    projectRoot: outDir,
    packageSlugs: [slug],
    generatedAt: fixedNow,
    dryRun: true,
  });
  assert.equal(dryRun.summary.written_artifact_count, 0);
  assert.equal(dryRun.summary.planned_artifact_count, 3);
  assert.equal(dryRun.boundary.dry_run, true);

  console.log('evidence-artifacts-materialize.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

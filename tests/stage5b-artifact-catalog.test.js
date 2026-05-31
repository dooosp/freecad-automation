import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getStage5bArtifactSchemaCatalog,
  renderStage5bArtifactSchemaCatalogMarkdown,
} from '../lib/stage5b-artifact-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');
const CATALOG_DOC = resolve(ROOT, 'docs', 'stage-5b-artifact-schema-catalog.md');
const HARD_EVIDENCE_RULE = /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy `?inspection_evidence`?/;

const EXPECTED_IDS = Object.freeze([
  'stage5b_evidence_request_packet',
  'stage5b_candidate_gate_report',
  'inspection_evidence_intake_report',
  'inspection_evidence_promotion_dry_run_manifest',
  'stage5b_evidence_audit_manifest',
  'stage5b_evidence_audit_summary',
  'stage5b_validation_diagnostics',
]);

function readText(path) {
  return readFileSync(path, 'utf8');
}

function extractGeneratedBlock(markdown, blockName) {
  const pattern = new RegExp(`<!-- GENERATED:${blockName}:start -->\\n([\\s\\S]*?)\\n<!-- GENERATED:${blockName}:end -->`);
  const match = markdown.match(pattern);
  assert(match, `Missing generated block ${blockName}`);
  return match[1].trim();
}

const catalog = getStage5bArtifactSchemaCatalog();
const catalogDoc = readText(CATALOG_DOC);

assert.deepEqual(catalog.map((entry) => entry.id), EXPECTED_IDS, 'catalog should cover the required Stage 5B surfaces in stable order');
assert.equal(new Set(catalog.map((entry) => entry.id)).size, EXPECTED_IDS.length, 'catalog ids should be unique');
assert.equal(
  extractGeneratedBlock(catalogDoc, 'stage5b-artifact-catalog'),
  renderStage5bArtifactSchemaCatalogMarkdown(),
  'catalog document table should stay generated from the shared helper'
);
assert.match(catalogDoc, HARD_EVIDENCE_RULE, 'catalog doc should preserve the hard evidence rule');
assert.match(catalogDoc, /needs_more_evidence/, 'catalog doc should preserve current readiness status');
assert.match(catalogDoc, /hold_for_evidence_completion/, 'catalog doc should preserve current gate decision');

for (const entry of catalog) {
  for (const field of [
    'surface',
    'producer',
    'schema_or_contract',
    'location_pattern',
    'preview_boundary',
    'control_private_status',
    'inspection_evidence_status',
    'readiness_effect',
  ]) {
    assert.equal(typeof entry[field], 'string', `${entry.id}.${field} should be a string`);
    assert(entry[field].trim().length > 0, `${entry.id}.${field} should not be empty`);
  }
  assert.match(entry.inspection_evidence_status, /Not inspection_evidence/i, `${entry.id} should not be evidence`);
  assert.match(
    entry.readiness_effect,
    /No readiness change|Non-mutating|readiness remains|does not attach evidence|must not claim production readiness/i,
    `${entry.id} should state the readiness effect`
  );
  assert.doesNotMatch(entry.readiness_effect, /ready for production|production-ready/i, `${entry.id} must not overclaim readiness`);
  if (entry.schema_path) {
    assert.equal(existsSync(resolve(ROOT, entry.schema_path)), true, `${entry.id} schema path should exist`);
    assert(catalogDoc.includes(entry.schema_path), `${entry.id} schema path should be discoverable in docs`);
  }
  assert(catalogDoc.includes(entry.surface), `${entry.id} surface should appear in docs`);
}

const candidateGate = catalog.find((entry) => entry.id === 'stage5b_candidate_gate_report');
assert.equal(candidateGate.schema_path, 'schemas/stage5b-candidate-gate-report.schema.json');
assert.match(candidateGate.schema_or_contract, /validateStage5bCandidateGateReport/);
assert.match(candidateGate.preview_boundary, /Local review only/i);
assert.match(candidateGate.inspection_evidence_status, /eligible for later Stage 5B intake review only/i);
assert.match(candidateGate.readiness_effect, /does not attach evidence, promote evidence, satisfy readiness, or mutate canonical artifacts/i);

const trackedPreviewRows = catalog.filter((entry) => /Studio\/API preview/.test(entry.preview_boundary));
assert.equal(trackedPreviewRows.length, 5, 'tracked audit/intake/dry-run/diagnostic outputs should document preview boundaries');
for (const entry of trackedPreviewRows) {
  assert.match(entry.preview_boundary, /registered .*artifact|registered tracked artifacts/i, `${entry.id} preview should be registered-artifact only`);
}

console.log('stage5b-artifact-catalog.test.js: ok');

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runLocalFirstV1Acceptance } from '../scripts/local-first-v1-acceptance.js';

const ROOT = resolve(import.meta.dirname, '..');
const first = await runLocalFirstV1Acceptance({ projectRoot: ROOT });
const firstReportBytes = await readFile(first.reportPath);
const firstArtifactHashes = first.report.artifacts.map((entry) => [entry.path, entry.sha256]);

assert.equal(first.report.status, 'pass');
assert.equal(first.report.software_path_only, true);
assert.equal(first.report.runtime.artifact_driven_acceptance, 'pass');
assert.equal(first.report.runtime.live_freecad_smoke, 'not_run_optional');
assert.equal(first.report.fixture_declaration.synthetic, true);
assert.equal(first.report.fixture_declaration.non_production, true);
assert.equal(first.report.fixture_declaration.production_evidence, false);
assert.equal(first.report.workflows.review.readiness_status, 'needs_more_evidence');
assert.equal(first.report.workflows.revision_and_inspection_planning.plan_is_evidence, false);
assert.equal(first.report.workflows.revision_and_inspection_planning.human_release_required, true);
assert.equal(first.report.workflows.revision_and_inspection_planning.measured_fields_blank, true);
assert.equal(first.report.workflows.result_handoff.normalization_status, 'ready_for_quarantine_review');
assert.equal(first.report.workflows.result_handoff.exact_hashes_match, true);
assert.equal(first.report.workflows.result_handoff.reported_and_computed_results_separate, true);
assert.equal(first.report.workflows.result_handoff.evidence_envelope_emitted, false);
assert.equal(first.report.workflows.result_handoff.evidence_authorization_created, false);
assert.equal(first.report.workflows.result_handoff.evidence_attachment_created, false);
assert.equal(first.report.workflows.result_handoff.readiness_operation_ran, false);
assert.equal(first.report.canonical_immutability.equal, true);
assert.deepEqual(first.report.canonical_immutability.docs_examples_diff, []);
assert.equal(first.report.boundaries.inspection_evidence_created, false);
assert.equal(first.report.boundaries.readiness_regenerated, false);
assert.equal(first.report.boundaries.release_published, false);

const second = await runLocalFirstV1Acceptance({ projectRoot: ROOT });
const secondReportBytes = await readFile(second.reportPath);
assert.deepEqual(second.report.artifacts.map((entry) => [entry.path, entry.sha256]), firstArtifactHashes, 'all acceptance artifact hashes must be deterministic');
assert.deepEqual(secondReportBytes, firstReportBytes, 'fixed-time acceptance report must be byte-identical');

console.log('local-first-v1-acceptance.test.js: ok');

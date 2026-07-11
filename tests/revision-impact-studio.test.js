import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildReviewCards } from '../public/js/studio/artifact-insights.js';

const ROOT = resolve(import.meta.dirname, '..');
const artifact = {
  id: 'revision-impact-json',
  type: 'revision-impact.report-json',
  key: 'revision_impact_report',
  file_name: 'revision_impact_report.json',
  extension: '.json',
  exists: true,
  scope: 'user-facing',
};
const report = {
  artifact_type: 'revision_impact_report',
  schema_version: '1.0',
  generated_at: '2026-07-11T00:00:00Z',
  baseline: { package_slug: 'fixture-bracket', revision: 'A', artifact_refs: [], source_hashes: {} },
  candidate: { package_slug: 'fixture-bracket', revision: 'B', artifact_refs: [], source_hashes: {} },
  summary: {
    decision: 'reinspection_required',
    material_change_count: 1,
    review_required_count: 0,
    reinspection_required_count: 1,
    unable_to_determine_count: 0,
    readiness_review_required: true,
  },
  evidence_applicability: {
    assessments: [],
    authoritative_evidence_state_changed: false,
  },
};

const cards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'compare-rev',
      warnings: [],
    },
  },
  artifacts: [artifact],
  sourceMap: {
    revisionImpact: report,
    revisionImpactRaw: `${JSON.stringify(report, null, 2)}\n`,
  },
});
const card = cards.find((entry) => entry.id === 'revision-impact');

assert.ok(card, 'Review must expose the revision-impact report as a guided card');
assert.equal(card.status, 'reinspection_required');
assert.match(card.summary, /1 material changes; 1 reinspection requirements/);
assert.equal(card.artifact, artifact);
for (const boundary of [
  'No inspection evidence was attached.',
  'Existing evidence was not mutated.',
  'No evidence was superseded.',
  'Readiness was not regenerated.',
  'A reinspection plan is not completed inspection evidence.',
  'Human review is required before any evidence or readiness action.',
]) {
  assert.equal(card.provenance.includes(boundary), true, `missing visible boundary: ${boundary}`);
}

const reviewWorkspaceSource = readFileSync(resolve(ROOT, 'public/js/studio/review-workspace.js'), 'utf8');
assert.match(reviewWorkspaceSource, /revision-impact\.report-json/);
assert.match(reviewWorkspaceSource, /revision_impact_report/);

console.log('revision-impact-studio.test.js: ok');

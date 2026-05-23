import assert from 'node:assert/strict';

import {
  buildInspectionEvidenceIntakeCard,
  buildReviewCards,
} from '../public/js/studio/artifact-insights.js';
import { renderReviewWorkspace } from '../public/js/studio/review-workspace.js';

const intakeReport = {
  artifact_type: 'inspection_evidence_intake_report',
  schema_version: '1.0',
  generated_at: '2026-05-23T00:00:00.000Z',
  source_boundary: {
    hard_evidence_rule: 'Only real completed physical/supplier/lab/QA inspection records with measured feature records, result semantics, and provenance can be accepted.',
    rejected_as_final_evidence: [
      'generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts',
      'fixtures',
      'templates',
      'collection guides',
    ],
  },
  searched_sources: [
    { kind: 'tracked_repo_files', status: 'searched', candidate_path_count: 4 },
    { kind: 'github_public_metadata', status: 'not_requested' },
  ],
  packages: [
    {
      slug: 'quality-pass-bracket',
      classification: 'invalid_generated',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      intake_action: {
        status: 'hold_for_evidence_completion',
        mode: 'no_human_measurement_entry_requested',
        note: 'No genuine completed inspection evidence was found; readiness must remain held.',
      },
    },
    {
      slug: 'hinge-block',
      classification: 'no_candidate',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
        missing_inputs: ['inspection_evidence'],
      },
      intake_action: {
        status: 'hold_for_evidence_completion',
        mode: 'no_human_measurement_entry_requested',
        note: 'No genuine completed inspection evidence was found; readiness must remain held.',
      },
    },
  ],
  accepted_candidates: [],
  rejected_candidates: [
    { classification: 'invalid_generated', source_kind: 'tracked_repo_file' },
    { classification: 'invalid_schema', source_kind: 'tracked_repo_file' },
    { classification: 'invalid_provenance', source_kind: 'github_issue_comments' },
  ],
  summary: {
    package_count: 2,
    candidate_count: 3,
    accepted_candidate_count: 0,
    rejected_candidate_count: 3,
    genuine_inspection_evidence_found: false,
    packages_with_genuine_evidence: [],
    packages_without_genuine_evidence: ['quality-pass-bracket', 'hinge-block'],
    requires_human_measurement_entry: false,
    readiness_truth: 'readiness remains needs_more_evidence / hold_for_evidence_completion',
  },
};

const intakeArtifact = {
  id: 'inspection-evidence-intake-report-0',
  key: 'Stage 5B intake report',
  type: 'inspection-evidence.intake-report',
  file_name: 'inspection-evidence-intake-report.json',
  extension: '.json',
  content_type: 'application/json; charset=utf-8',
  exists: true,
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/jobs/job-1/artifacts/inspection-evidence-intake-report-0/content',
    download: '/jobs/job-1/artifacts/inspection-evidence-intake-report-0/content?download=1',
  },
};

const raw = JSON.stringify(intakeReport, null, 2);
const card = buildInspectionEvidenceIntakeCard({
  report: intakeReport,
  artifact: intakeArtifact,
  raw,
  manifest: {
    command: 'inspection-evidence-intake',
  },
});

assert.equal(card.id, 'inspection-intake');
assert.equal(card.title, 'Stage 5B inspection evidence intake');
assert.equal(card.status, 'No genuine inspection evidence');
assert.equal(card.score, 0);
assert.equal(card.tone, 'warn');
assert.match(card.summary, /readiness remains needs_more_evidence \/ hold_for_evidence_completion/);
assert.match(card.summary, /No human-entered measurements requested/);
assert.equal(card.artifact, intakeArtifact);
assert.equal(card.raw, raw);

const normalized = Object.fromEntries(card.normalized);
assert.equal(normalized['Searched source classes'], 'tracked_repo_files • github_public_metadata');
assert.equal(normalized['Accepted candidates'], '0');
assert.equal(normalized['Rejected candidates'], '3');
assert.equal(normalized['Rejection classes'], 'invalid_generated • invalid_schema • invalid_provenance');
assert.equal(normalized['Package readiness'], 'quality-pass-bracket: needs_more_evidence / hold_for_evidence_completion • hinge-block: needs_more_evidence / hold_for_evidence_completion');
assert.equal(normalized['Readiness explanation'], 'readiness remains needs_more_evidence / hold_for_evidence_completion');
assert.equal(normalized['Evidence boundary'], 'Generated CAD/drawing/quality/readiness/review/standard-doc/release artifacts, fixtures, templates, and collection guides are not inspection evidence.');

const cards = buildReviewCards({
  activeJob: {
    manifest: {
      command: 'inspection-evidence-intake',
    },
  },
  artifacts: [intakeArtifact],
  sourceMap: {
    inspectionIntake: intakeReport,
    inspectionIntakeRaw: raw,
  },
});
assert.equal(cards[0].id, 'inspection-intake');
assert.equal(cards[0].empty, false);

globalThis.document = {
  createElement(tagName) {
    return {
      tagName: String(tagName).toUpperCase(),
      className: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      attributes: {},
      children: [],
      append(...children) {
        this.children.push(...children);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
    };
  },
};

const reviewTree = renderReviewWorkspace({
  data: {
    review: {},
    activeJob: {
      status: 'idle',
      summary: null,
      artifacts: [],
      manifest: null,
    },
    recentJobs: {
      items: [],
    },
  },
});
const renderedText = JSON.stringify(reviewTree);
assert.match(renderedText, /Stage 5B intake/);
assert.match(renderedText, /Run intake/);
assert.match(renderedText, /No human-entered measurements/);

console.log('studio-inspection-evidence-intake-ux.test.js: ok');

import assert from 'node:assert/strict';

import {
  buildReviewSummary,
  isAdvancedReviewArtifact,
  sanitizeReviewSummaryText,
} from '../public/js/studio/review-summary.js';

const activeJob = {
  status: 'idle',
  summary: {
    id: 'job-review-summary-123456',
    type: 'review-context',
    status: 'succeeded',
  },
  artifacts: [
    {
      id: 'report',
      type: 'report.sample',
      label: 'Browser smoke artifact',
      file_name: 'report_summary.json',
      exists: true,
      capabilities: { can_open: true, can_download: true },
      links: { open: '/artifacts/job-review-summary-123456/report_summary.json' },
    },
    {
      id: 'readiness',
      type: 'review.readiness',
      label: 'Readiness evidence manifest',
      file_name: 'readiness_report.json',
      exists: true,
      capabilities: { can_open: true, can_download: true },
      links: { open: '/artifacts/job-review-summary-123456/readiness_report.json' },
    },
  ],
};

const cards = [
  {
    id: 'dfm',
    title: 'DFM risk',
    tone: 'warn',
    status: 'Medium',
    summary: 'Wall thickness needs review before tracked release.',
    normalized: [['Recommended action', 'Increase the thin wall, then run the gate again.']],
  },
  {
    id: 'readiness',
    title: 'Readiness summary',
    tone: 'warn',
    status: 'hold_for_evidence_completion',
    summary: 'Stage 5B evidence gate is held.',
    normalized: [['Gate', 'hold_for_evidence_completion']],
  },
];

const summary = buildReviewSummary({
  activeJob,
  reviewStatus: 'ready',
  cards,
});

assert.equal(summary.decision, 'needs_attention');
assert.equal(summary.tone, 'warn');
assert.deepEqual(summary.issues, ['Wall thickness needs review before recorded release.']);
assert.equal(summary.nextStep, 'Increase the thin wall, then run the check again.');
assert.equal(summary.supportingFiles.length, 1);
assert.equal(summary.supportingFiles[0].label, 'Browser smoke result file');
assert.equal(summary.supportingFiles[0].href, '/artifacts/job-review-summary-123456/report_summary.json');
assert.equal(summary.supportingFiles.some((file) => file.id === 'readiness'), false);

const visibleSummaryText = JSON.stringify({
  issues: summary.issues,
  nextStep: summary.nextStep,
  supportingFiles: summary.supportingFiles.map((file) => file.label),
});
for (const term of ['tracked', 'artifact', 'manifest', 'Stage 5B', 'readiness', 'evidence', 'gate']) {
  assert.equal(visibleSummaryText.toLowerCase().includes(term.toLowerCase()), false, `default review summary leaked ${term}`);
}

assert.equal(isAdvancedReviewArtifact(activeJob.artifacts[0]), false);
assert.equal(isAdvancedReviewArtifact(activeJob.artifacts[1]), true);
assert.equal(
  sanitizeReviewSummaryText('Tracked artifact manifest, Stage 5B readiness evidence gate'),
  'Recorded result file file information, Detailed inspection preparation inspection information check',
);

const expertOnlySummary = buildReviewSummary({
  activeJob: { ...activeJob, artifacts: [] },
  reviewStatus: 'ready',
  cards: [cards[1]],
});
assert.equal(expertOnlySummary.decision, 'needs_attention');
assert.deepEqual(expertOnlySummary.issues, []);
assert.equal(expertOnlySummary.hasAdvancedIssues, true);
assert.equal(expertOnlySummary.nextStep, '');

assert.deepEqual(buildReviewSummary({ activeJob: null, reviewStatus: 'idle', cards: [] }), {
  decision: 'choose_run',
  tone: 'info',
  issues: [],
  hasAdvancedIssues: false,
  nextStep: '',
  supportingFiles: [],
});

const loadingSummary = buildReviewSummary({
  activeJob: { ...activeJob, status: 'loading', artifacts: [] },
  reviewStatus: 'ready',
  cards,
});
assert.equal(loadingSummary.decision, 'preparing');
assert.deepEqual(loadingSummary.issues, []);
assert.equal(loadingSummary.hasAdvancedIssues, false);

console.log('review-summary.test.js: ok');

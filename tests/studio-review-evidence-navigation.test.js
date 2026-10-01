import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReviewSummary } from '../public/js/studio/review-summary.js';
import { mountReviewWorkspace, renderReviewWorkspace } from '../public/js/studio/review-workspace.js';
import { createStudioShellState } from '../public/js/studio/studio-shell-store.js';
import { setLocale } from '../public/js/i18n/index.js';
import { installDrawingTestDom } from './helpers/drawing-test-dom.js';

const reviewCard = {
  id: 'review-outputs', title: 'Design review outputs', tone: 'warn', empty: false,
  summary: 'Review High complexity review • Review Thin-wall candidate',
  normalized: [['Missing inputs', 'inspection_evidence'], ['Recommendation', 'Prioritize a manufacturability review for the linked high-complexity hotspot before the next release.']],
  raw: '{"hotspot_id":"wall-7","location":null}', provenance: [],
};

test('attention issues retain their own evidence card without including empty or passing cards', () => {
  const result = buildReviewSummary({
    activeJob: { summary: { id: 'review-job' } }, reviewStatus: 'ready',
    cards: [
      { id: 'dfm', tone: 'ok', summary: 'Passed' },
      { id: 'quality', tone: 'warn', empty: true, summary: 'Missing' },
      reviewCard,
    ],
  });
  assert.deepEqual(result.issueDetails, [{ cardId: 'review-outputs', text: reviewCard.summary }]);
  assert.equal(result.decision, 'needs_attention');
});

test('opening issue evidence reveals the matching card, retains the selected run, and moves focus to its details', (t) => {
  t.after(installDrawingTestDom());
  setLocale('en', { persist: false });
  const state = createStudioShellState();
  state.data.activeJob = { summary: { id: 'review-job', type: 'review-context', status: 'succeeded', updated_at: 'now' }, artifacts: [] };
  const cards = [{ ...reviewCard, id: 'dfm', tone: 'ok', summary: 'DFM passed', normalized: [['Score', '100']] }, reviewCard];
  state.data.review = { status: 'ready', cards, selectedCardId: 'dfm', cache: { 'review-job:now': cards } };
  const root = renderReviewWorkspace(state);
  const controller = mountReviewWorkspace({ root, state, addLog() {} });
  t.after(() => controller.destroy());
  const action = root.querySelector('[data-action="review-open-issue"]');
  assert.ok(action, 'Each visible attention issue needs a path to its evidence');
  root.dispatch('click', { target: action });
  assert.equal(state.data.activeJob.summary.id, 'review-job');
  assert.equal(state.data.review.selectedCardId, 'review-outputs');
  assert.equal(state.data.review.activeTab, 'summary');
  assert.equal(root.querySelector('[data-hook="review-advanced-tools"]').open, true);
  const details = root.querySelector('[data-hook="review-detail-summary"]');
  assert.equal(document.activeElement, details);
  assert.match(details.textContent, /inspection_evidence/);
  assert.match(root.querySelector('[data-hook="review-detail-raw"]').textContent, /"location":null/);
});

test('Korean summaries explain recognized heuristic labels while retaining unfamiliar source evidence unchanged', (t) => {
  t.after(installDrawingTestDom());
  t.after(() => setLocale('en', { persist: false }));
  setLocale('ko', { persist: false });
  const state = createStudioShellState();
  state.data.activeJob = { summary: { id: 'review-job', type: 'review-context', status: 'succeeded' }, artifacts: [] };
  state.data.review = { status: 'ready', cards: [reviewCard, { ...reviewCard, id: 'quality', summary: 'Measured clearance 3.5 mm at custom-feature-9' }] };
  const root = renderReviewWorkspace(state);
  const issues = root.querySelector('[data-hook="review-issues"]').textContent;
  assert.match(issues, /형상 복잡도/);
  assert.match(issues, /얇은 벽/);
  assert.match(issues, /Measured clearance 3.5 mm at custom-feature-9/);
  assert.doesNotMatch(issues, /Review High complexity review/);
  assert.match(root.querySelector('[data-hook="review-next-step"]').textContent, /근거/);
  assert.equal(reviewCard.raw, '{"hotspot_id":"wall-7","location":null}');
});

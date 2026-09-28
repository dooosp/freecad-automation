import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { buildReviewCards, fetchArtifactText, parseArtifactPayload } from '../public/js/studio/artifact-insights.js';
import { buildReviewSummary } from '../public/js/studio/review-summary.js';

test('a large canonical review JSON produces actionable summary without losing evidence limits', async (t) => {
  const payload = {
    artifact_type: 'review_pack',
    executive_summary: { headline: 'Bracket has one open geometry issue.' },
    prioritized_hotspots: [{ title: 'Mounting wall needs review', recommended_action: 'Review wall thickness.' }],
    recommended_actions: [{ recommended_action: 'Check the mounting wall against the drawing before release.' }],
    uncertainty_coverage_report: { partial_evidence: true, missing_inputs: ['inspection_evidence'] },
    source_notes: 'Measurement provenance remains available. '.repeat(1000),
  };
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const artifact = { id: 'review', type: 'review-pack.json', file_name: 'review_pack.json', extension: '.json',
    content_type: 'application/json', exists: true, capabilities: { can_open: true },
    links: { open: `http://127.0.0.1:${server.address().port}/review` } };
  const raw = await fetchArtifactText(artifact);
  const parsed = parseArtifactPayload(artifact, raw);
  assert.equal(parsed?.executive_summary?.headline, payload.executive_summary.headline);
  const activeJob = { summary: { id: 'job', type: 'review-context', status: 'succeeded' }, artifacts: [artifact] };
  const cards = buildReviewCards({ activeJob, artifacts: [artifact], sourceMap: { reviewPack: parsed, reviewPackRaw: raw } });
  const summary = buildReviewSummary({ activeJob, reviewStatus: 'ready', cards });
  assert.equal(summary.decision, 'needs_attention');
  assert.match(summary.issues.join(' '), /Mounting wall needs review/);
  assert.match(summary.nextStep, /Check the mounting wall/);
  assert.ok(cards.find((card) => card.id === 'review-outputs').normalized.some(([label, value]) => label === 'Missing inputs' && value.includes('inspection_evidence')));
});

test('plain text previews remain bounded', async (t) => {
  const server = createServer((_req, res) => res.end('x'.repeat(20000)));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const raw = await fetchArtifactText({ content_type: 'text/plain', capabilities: { can_open: true }, links: { open: `http://127.0.0.1:${server.address().port}/text` } });
  assert.ok(raw.length < 17000);
  assert.match(raw, /truncated/);
});

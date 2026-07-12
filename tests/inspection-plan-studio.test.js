import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildArtifactViewer } from '../public/js/studio/artifact-insights.js';
import { translateText } from '../public/js/i18n/index.js';
import { translateStudioJobSubmission } from '../src/server/studio-job-bridge.js';
import { createInspectionPlanFromPaths } from '../src/services/inspection-plan/inspection-plan-service.js';

const reviewArtifact = { id: 'review-pack', type: 'review-pack.json', file_name: 'review_pack.json', path: '/tmp/tracked/review_pack.json', scope: 'user-facing', metadata: { af_contract: { reentry_target: 'review_pack' } } };
const impactArtifact = { id: 'revision-impact', type: 'revision-impact.report-json', file_name: 'revision_impact_report.json', path: '/tmp/tracked/revision_impact_report.json', scope: 'user-facing' };
const resolver = async () => ({ jobId: 'job-1', artifact: reviewArtifact, jobArtifacts: [reviewArtifact, impactArtifact] });

const full = await translateStudioJobSubmission({ type: 'inspection-plan', artifact_ref: { job_id: 'job-1', artifact_id: 'review-pack' }, options: { scope: 'full' } }, { resolveArtifactRef: resolver });
assert.equal(full.ok, true, full.errors?.join('\n')); assert.equal(full.request.scope, 'full'); assert.equal(full.request.review_pack_path, reviewArtifact.path);
const delta = await translateStudioJobSubmission({ type: 'inspection-plan', artifact_ref: { job_id: 'job-1', artifact_id: 'review-pack' }, options: { scope: 'delta' } }, { resolveArtifactRef: resolver });
assert.equal(delta.ok, true, delta.errors?.join('\n')); assert.equal(delta.request.revision_impact_path, impactArtifact.path);

const plan = await createInspectionPlanFromPaths({ projectRoot: resolve(import.meta.dirname, '..'), reviewPackPath: resolve(import.meta.dirname, 'fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json'), scope: 'full', generatedAt: '2026-07-12T00:00:00Z' });
const viewer = buildArtifactViewer({ artifact: { type: 'inspection-plan.json', file_name: 'inspection_plan.json', extension: '.json' }, parsedPayload: plan });
assert.equal(viewer.kind, 'inspection_plan'); assert.match(viewer.summary, /human release/i); assert.equal(viewer.sections.some((section) => section.title === 'Safety boundary'), true);
assert.equal(translateText('Inspection plan viewer', 'ko'), '검사 계획 뷰어');

const source = `${await readFile(resolve(import.meta.dirname, '../public/js/studio/artifact-insights.js'), 'utf8')}\n${await readFile(resolve(import.meta.dirname, '../public/js/studio/review-workspace.js'), 'utf8')}`;
for (const forbidden of ['Approve inspection plan', 'Release inspection plan', 'Attach inspection plan', 'Mark inspection plan ready']) assert.equal(source.includes(forbidden), false);

console.log('inspection-plan-studio.test.js: ok');

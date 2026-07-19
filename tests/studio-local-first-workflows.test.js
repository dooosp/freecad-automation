import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { translateText } from '../public/js/i18n/index.js';
import { deriveLocalFirstWorkflowGuidance } from '../public/js/studio/local-first-workflows.js';
import { getStudioSurfaceMetadata } from '../public/js/studio/studio-surfaces.js';

const ROOT = resolve(import.meta.dirname, '..');
const workflowSource = readFileSync(resolve(ROOT, 'public/js/studio/local-first-workflows.js'), 'utf8');
const workspaceSource = readFileSync(resolve(ROOT, 'public/js/studio/workspaces.js'), 'utf8');

const empty = deriveLocalFirstWorkflowGuidance({
  connectionState: 'shell-only',
  data: { health: { available: false }, recentJobs: { status: 'empty', items: [] } },
});
assert.equal(empty.length, 3);
assert.deepEqual(empty.map((workflow) => workflow.id), ['review', 'compare-plan', 'receive-results']);
assert.deepEqual(empty.map((workflow) => workflow.title), [
  'Create or Import & Review',
  'Compare Revisions & Plan Inspection',
  'Receive Results & Continue Onboarding',
]);
assert.match(empty[0].nextSafeAction, /fcad serve/);
assert.match(empty[1].nextSafeAction, /baseline and candidate review packs/);
assert.match(empty[2].nextSafeAction, /external human release/);
assert.match(empty[2].command, /^fcad inspection-result-normalize /);
assert.match(empty[2].safetyBoundary, /CLI-only raw bytes/);
assert.equal(empty[2].action, null);

const progressed = deriveLocalFirstWorkflowGuidance({
  connectionState: 'connected',
  data: {
    health: { available: true },
    recentJobs: {
      status: 'ready',
      items: [
        { type: 'review-context' },
        { type: 'readiness-pack' },
        { type: 'pack' },
        { type: 'compare-rev' },
        { type: 'inspection-plan' },
      ],
    },
  },
});
assert.match(progressed[0].nextSafeAction, /Reopen the latest tracked review or package/);
assert.match(progressed[1].nextSafeAction, /do not release the plan automatically/);
assert.equal(progressed[2].action, 'go-artifacts');
assert(progressed.every((workflow) => [null, 'go-artifacts', 'go-model'].includes(workflow.action)), 'workflow actions must remain navigation-only');

assert.match(workspaceSource, /data.*hook.*local-first-workflows/s);
assert.match(workspaceSource, /Expected starting artifact/);
assert.match(workspaceSource, /Current available artifacts/);
assert.match(workspaceSource, /Next safe action/);
assert.match(workspaceSource, /Runtime requirement/);
assert.match(workspaceSource, /Generated outputs/);
assert.match(workspaceSource, /Safety boundary/);
assert.doesNotMatch(workflowSource, /type:\s*['"]file['"]/);
assert.doesNotMatch(workflowSource, /inspection-evidence-(authorize|attach|regenerate-readiness)|mark-package-ready|publish-release/);
assert.deepEqual(
  getStudioSurfaceMetadata().map((surface) => surface.route),
  ['start', 'history', 'artifacts', 'console', 'model', 'drawing', 'review'],
  'beginner navigation should add only Home history and the advanced console compatibility surface'
);

assert.equal(translateText('Create or Import & Review', 'ko'), '생성 또는 가져오기 및 검토');
assert.equal(translateText('Compare Revisions & Plan Inspection', 'ko'), '리비전 비교 및 검사 계획');
assert.equal(translateText('Receive Results & Continue Onboarding', 'ko'), '결과 수신 및 온보딩 계속');
assert.equal(translateText('Next safe action', 'ko'), '다음 안전 작업');
assert.equal(
  translateText('CLI-only raw bytes; no upload, evidence approval, attachment, readiness regeneration, or release publication.', 'ko'),
  '원시 바이트는 CLI 전용입니다. 업로드, 근거 승인, 첨부, 준비 상태 재생성 또는 릴리스 게시를 수행하지 않습니다.'
);

console.log('studio-local-first-workflows.test.js: ok');

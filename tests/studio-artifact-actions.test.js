import assert from 'node:assert/strict';

import {
  buildStudioArtifactRef,
  findPreferredConfigArtifact,
  isConfigLikeArtifact,
  isInspectableModelArtifact,
} from '../public/js/studio/artifact-actions.js';

assert.deepEqual(buildStudioArtifactRef('job-1', 'artifact-2'), {
  job_id: 'job-1',
  artifact_id: 'artifact-2',
});

assert.equal(isConfigLikeArtifact({
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
}), true);

assert.equal(isConfigLikeArtifact({
  type: 'report.sample',
  file_name: 'review.json',
  extension: '.json',
}), false);

assert.equal(isInspectableModelArtifact({
  type: 'model.step',
  file_name: 'part.step',
  extension: '.step',
  exists: true,
}), true);

assert.equal(isInspectableModelArtifact({
  type: 'report.pdf',
  file_name: 'report.pdf',
  extension: '.pdf',
  exists: true,
}), false);

const preferredConfig = findPreferredConfigArtifact([
  {
    id: 'input',
    type: 'config.input',
    file_name: 'input-config.json',
    extension: '.json',
    exists: true,
  },
  {
    id: 'effective',
    type: 'config.effective',
    file_name: 'effective-config.json',
    extension: '.json',
    exists: true,
  },
]);

assert.equal(preferredConfig?.id, 'effective');

console.log('studio-artifact-actions.test.js: ok');

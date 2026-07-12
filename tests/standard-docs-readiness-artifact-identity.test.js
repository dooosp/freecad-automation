import assert from 'node:assert/strict';

import { createCanonicalArtifactHandlers } from '../src/services/jobs/execution/canonical-artifact-handlers.js';
import { createCanonicalReadinessArtifactEntry } from '../src/shared/artifact-surface.js';

const path = '/tmp/readiness_report.json';
const metadata = {
  af_contract: {
    job_type: 'generate-standard-docs',
    reentry_target: 'readiness_report',
    reentry_ready: true,
  },
};

const sharedEntry = createCanonicalReadinessArtifactEntry(path, metadata);
const handler = createCanonicalArtifactHandlers()['generate-standard-docs'];
const tracked = await handler({}, {
  resolvedConfig: {},
  executeGenerateStandardDocs: async () => ({
    out_dir: '/tmp/docs',
    artifacts: { manifest: '/tmp/docs/standard_docs_manifest.json' },
    readiness_report_path: path,
    report: {},
    manifest: {},
  }),
  buildGenericAfMetadata: () => ({}),
  buildAfArtifactContractFromDocument: () => metadata,
});
const trackedEntry = tracked.manifestArtifacts.find((entry) => entry.path === path);

assert.deepEqual(trackedEntry, sharedEntry);
assert.equal(sharedEntry.type, 'readiness-report.json');
assert.equal(sharedEntry.metadata.af_contract.reentry_target, 'readiness_report');

console.log('standard-docs-readiness-artifact-identity.test.js: ok');

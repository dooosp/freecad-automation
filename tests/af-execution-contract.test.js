import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AfExecutionContractError,
  buildAfArtifactContractFromDocument,
  buildAfExecutionStateDescriptor,
  validateDocsManifestAgainstReadiness,
} from '../lib/af-execution-contract.js';

const ROOT = resolve(import.meta.dirname, '..');
const reviewPack = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json'), 'utf8')
);
const readinessReport = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json'), 'utf8')
);

const reviewContract = buildAfArtifactContractFromDocument({
  jobType: 'review-context',
  target: 'review_pack',
  document: reviewPack,
  path: 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json',
});
assert.equal(reviewContract.af_contract.reentry_target, 'review_pack');
assert.equal(reviewContract.af_contract.canonical_file_name, 'review_pack.json');

const readinessContract = buildAfArtifactContractFromDocument({
  jobType: 'readiness-pack',
  target: 'readiness_report',
  document: readinessReport,
  path: 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json',
});
assert.equal(readinessContract.af_contract.reentry_target, 'readiness_report');
assert.equal(readinessContract.af_contract.reentry_ready, true);

const readinessCliBridgeContract = buildAfArtifactContractFromDocument({
  jobType: 'readiness-report',
  target: 'readiness_report',
  document: readinessReport,
  path: 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json',
});
assert.equal(readinessCliBridgeContract.af_contract.reentry_target, 'readiness_report');
assert.equal(readinessCliBridgeContract.af_contract.job_type, 'readiness-report');

assert.deepEqual(buildAfExecutionStateDescriptor('cancelled'), {
  contract_version: 'af1',
  lifecycle_state: 'canceled',
  raw_state: 'cancelled',
  compatible: true,
  legacy_aliases: ['cancelled'],
});

let legacyError = null;
try {
  buildAfArtifactContractFromDocument({
    jobType: 'pack',
    target: 'readiness_report',
    document: {
      ...readinessReport,
      compatibility_mode: {
        type: 'legacy_config_compatibility',
        canonical_review_pack_backed: false,
      },
      source_artifact_refs: [],
    },
    path: '/tmp/legacy_readiness_report.json',
  });
} catch (error) {
  legacyError = error;
}
assert.equal(legacyError instanceof AfExecutionContractError, true);
assert.equal(legacyError.code, 'invalid_artifact_handoff');

let docsError = null;
try {
  validateDocsManifestAgainstReadiness({
    readinessReport,
    readinessPath: '/tmp/readiness_report.json',
    docsManifest: {
      ...JSON.parse(
        readFileSync(resolve(ROOT, 'docs/examples/controller-housing-eol/standard-docs/standard_docs_manifest.json'), 'utf8')
      ),
      source_artifact_refs: [],
    },
    docsManifestPath: '/tmp/standard_docs_manifest.json',
  });
} catch (error) {
  docsError = error;
}
assert.equal(docsError instanceof AfExecutionContractError, true);
assert.equal(docsError.code, 'invalid_docs_manifest_handoff');

console.log('af-execution-contract.test.js: ok');

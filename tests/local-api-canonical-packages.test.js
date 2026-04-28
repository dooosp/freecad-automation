import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLocalApiServer } from '../src/server/local-api-server.js';
import { validateLocalApiResponse } from '../src/server/local-api-schemas.js';

const ROOT = resolve(import.meta.dirname, '..');
const EXPECTED_SLUGS = [
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
];
const BLOCKED_PATH_PATTERNS = [
  /^\/|^[A-Za-z]:[\\/]/,
  /^~/,
  /^tmp\//,
  /^\/tmp\//,
  /^var\/folders\//,
  /^output\//,
];

const tmpRoot = mkdtempSync(join(tmpdir(), 'fcad-canonical-packages-api-'));
const { server } = createLocalApiServer({
  projectRoot: ROOT,
  jobsDir: join(tmpRoot, 'jobs'),
});

async function listen() {
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

function collectStringValues(value, results = []) {
  if (typeof value === 'string') {
    results.push(value);
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStringValues(entry, results));
    return results;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((entry) => collectStringValues(entry, results));
  }
  return results;
}

function assertPathSafe(value) {
  assert.equal(value.includes('\\'), false, `${value} should use portable slash separators`);
  assert.equal(value.includes('..'), false, `${value} should not include traversal segments`);
  assert.equal(value.includes(ROOT), false, `${value} should not include the repo absolute path`);
  assert.equal(value.includes(tmpRoot), false, `${value} should not include temp paths`);
  assert.equal(value.includes('/Users/'), false, `${value} should not include home-directory paths`);
  assert.equal(value.includes('job_id'), false, `${value} should not expose job identifiers`);
  for (const pattern of BLOCKED_PATH_PATTERNS) {
    assert.equal(pattern.test(value), false, `${value} should be repo-relative and path-safe`);
  }
}

try {
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}`;

  const response = await fetch(`${baseUrl}/api/canonical-packages`, {
    headers: { accept: 'application/json' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(validateLocalApiResponse('canonical_packages', payload).ok, true);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.packages.map((entry) => entry.slug), EXPECTED_SLUGS);
  assert.equal(payload.packages.length, 4);

  for (const pkg of payload.packages) {
    assert.equal(typeof pkg.name, 'string');
    assert.equal(pkg.name.length > 0, true);
    assert.equal(pkg.package_path, `docs/examples/${pkg.slug}`);
    assert.equal(pkg.readme_path, `docs/examples/${pkg.slug}/README.md`);
    assert.equal(pkg.readiness.status, 'needs_more_evidence');
    assert.equal(typeof pkg.readiness.score, 'number');
    assert.equal(pkg.readiness.gate_decision, 'hold_for_evidence_completion');
    assert.deepEqual(pkg.readiness.missing_inputs, ['inspection_evidence']);
    assert.equal(pkg.readiness.inspection_evidence_missing, true);
    assert.equal(pkg.readiness.source_of_truth_path, `docs/examples/${pkg.slug}/readiness/readiness_report.json`);
    assert.equal(pkg.artifacts.review_pack_path, `docs/examples/${pkg.slug}/review/review_pack.json`);
    assert.equal(pkg.artifacts.readiness_report_path, `docs/examples/${pkg.slug}/readiness/readiness_report.json`);
    assert.equal(pkg.artifacts.standard_docs_manifest_path, `docs/examples/${pkg.slug}/standard-docs/standard_docs_manifest.json`);
    assert.equal(pkg.artifacts.release_manifest_path, `docs/examples/${pkg.slug}/release/release_bundle_manifest.json`);
    assert.equal(pkg.artifacts.release_checksums_path, `docs/examples/${pkg.slug}/release/release_bundle_checksums.sha256`);
    assert.equal(pkg.artifacts.release_bundle_path, `docs/examples/${pkg.slug}/release/release_bundle.zip`);
    assert.equal(pkg.artifacts.reopen_notes_path, `docs/examples/${pkg.slug}/reopen-notes.md`);
    assert.equal(pkg.inspection_evidence_path, null);
    assert.equal(pkg.collection_guide_path, `docs/inspection-evidence-collection/${pkg.slug}.md`);
    assert.match(
      pkg.evidence_boundary.release_bundle_presence_does_not_mean_production_ready,
      /does not mean production-ready/
    );
    assert.match(
      pkg.evidence_boundary.quality_drawing_evidence_does_not_satisfy_inspection_evidence,
      /does not satisfy inspection_evidence/
    );
    assert.match(
      pkg.evidence_boundary.packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached,
      /remain needs_more_evidence/
    );
    assert.match(
      pkg.studio_boundary.checked_in_canonical_packages_are_read_only_docs_packages,
      /read-only docs packages/
    );
    assert.match(
      pkg.studio_boundary.tracked_job_artifact_reopen_remains_separate,
      /tracked job\/artifact/
    );
  }

  collectStringValues(payload)
    .filter((value) => value.includes('/') || value.includes('\\') || value.includes('docs/') || value.includes('output'))
    .forEach(assertPathSafe);

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('inspection_evidence.json'), false);
  assert.equal(serialized.includes('output/'), false);
  assert.equal(serialized.includes('source_job_id'), false);
  assert.equal(serialized.includes('artifact_ref'), false);

  const examplesResponse = await fetch(`${baseUrl}/api/examples`, {
    headers: { accept: 'application/json' },
  });
  assert.equal(examplesResponse.status, 200);
  const examples = await examplesResponse.json();
  assert.equal(Array.isArray(examples), true);
  assert.equal(examples.length > 0, true);
  assert.equal(examples.every((entry) => entry.name.endsWith('.toml')), true);
  assert.equal(examples.some((entry) => EXPECTED_SLUGS.includes(entry.id)), false);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tmpRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { validateRevisionImpactReport } from '../lib/revision-impact-contract.js';
import {
  createRevisionImpactReportFromPaths,
  preflightRevisionImpactArtifactTargets,
  writeRevisionImpactArtifacts,
} from '../src/services/revision-impact/revision-impact-service.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const REVIEW_TEMPLATE = JSON.parse(readFileSync(
  join(REPOSITORY_ROOT, 'docs/examples/quality-pass-bracket/review/review_pack.json'),
  'utf8'
));
const GENERATED_AT = '2026-07-27T00:00:00Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configText({ packageSlug, partId, revision }) {
  return [
    'config_version = 1',
    `name = ${JSON.stringify(partId)}`,
    '',
    '[product]',
    `package_slug = ${JSON.stringify(packageSlug)}`,
    `part_id = ${JSON.stringify(partId)}`,
    `revision = ${JSON.stringify(revision)}`,
    '',
  ].join('\n');
}

function makeSide(root, label, identity) {
  const packageDirectory = `fixtures/${label}/${identity.packageSlug}`;
  const configPath = `configs/${label}.toml`;
  const reviewPackPath = `${packageDirectory}/review/review_pack.json`;
  const configBytes = Buffer.from(configText(identity), 'utf8');
  mkdirSync(dirname(join(root, configPath)), { recursive: true });
  mkdirSync(dirname(join(root, reviewPackPath)), { recursive: true });
  writeFileSync(join(root, configPath), configBytes);

  const configSha256 = sha256(configBytes);
  const configParent = {
    artifact_type: 'config',
    role: 'authoritative_config',
    path: configPath,
    sha256: configSha256,
    size_bytes: configBytes.length,
  };
  const reviewPack = clone(REVIEW_TEMPLATE);
  reviewPack.generated_at = GENERATED_AT;
  reviewPack.part_id = identity.partId;
  reviewPack.revision = identity.revision;
  reviewPack.part.part_id = identity.partId;
  reviewPack.part.name = identity.partId;
  reviewPack.part.revision = identity.revision;
  reviewPack.source_artifact_refs = [{
    artifact_type: 'config',
    path: configPath,
    role: 'input',
    label: 'Authoritative proof-lineage config',
    sha256: configSha256,
    size_bytes: configBytes.length,
  }];
  reviewPack.revision_lineage = {
    schema_version: '1.0',
    mode: 'proof',
    identity: {
      package_slug: identity.packageSlug,
      part_id: identity.partId,
      revision: identity.revision,
      config_sha256: configSha256,
    },
    parents: [configParent],
  };
  writeFileSync(join(root, reviewPackPath), `${JSON.stringify(reviewPack, null, 2)}\n`, 'utf8');

  return {
    configPath,
    reviewPackPath,
    selection: {
      package_directory: packageDirectory,
      package_slug: identity.packageSlug,
      part_id: identity.partId,
      revision: identity.revision,
      authoritative_config_path: configPath,
      generated_config_descendants: [`${packageDirectory}/config.toml`],
    },
  };
}

function makeFixture({
  baselineIdentity = { packageSlug: 'proof-package', partId: 'proof_part', revision: 'A' },
  candidateIdentity = { packageSlug: 'proof-package', partId: 'proof_part', revision: 'B' },
} = {}) {
  const root = realpathSync(mkdtempSync(join(REPOSITORY_ROOT, 'tests/revision-impact-lineage-work-')));
  const baseline = makeSide(root, 'baseline', baselineIdentity);
  const candidate = makeSide(root, 'candidate', candidateIdentity);
  const options = {
    projectRoot: root,
    baselineReviewPackPath: baseline.reviewPackPath,
    candidateReviewPackPath: candidate.reviewPackPath,
    baselineConfigPath: baseline.configPath,
    candidateConfigPath: candidate.configPath,
    baselineLineageSelection: baseline.selection,
    candidateLineageSelection: candidate.selection,
    requireAuthoritativeLineage: true,
    generatedAt: GENERATED_AT,
  };
  return { root, baseline, candidate, options };
}

function rewriteJson(root, pathValue, mutate) {
  const absolute = join(root, pathValue);
  const document = JSON.parse(readFileSync(absolute, 'utf8'));
  mutate(document);
  writeFileSync(absolute, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

async function assertRejectsCode(callback, code) {
  await assert.rejects(callback, (error) => {
    assert.equal(error?.code, code, error?.stack || error?.message);
    return true;
  });
}

function cleanupFixture(t, fixture) {
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
}

test('proof revision impact binds the candidate subject to four exact two-sided parents and publishes it', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report, baseline, candidate } = await createRevisionImpactReportFromPaths(fixture.options);

  assert.equal(Object.isFrozen(baseline), true);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(baseline.reviewPack), true);
  assert.equal(Object.isFrozen(candidate.reviewPack), true);

  assert.deepEqual(report.revision_lineage.identity, {
    package_slug: 'proof-package',
    part_id: 'proof_part',
    revision: 'B',
    config_sha256: report.candidate.source_hashes.config,
  });
  assert.equal(report.baseline.package_slug, 'proof-package');
  assert.equal(report.baseline.part_id, 'proof_part');
  assert.equal(report.baseline.revision, 'A');
  assert.equal(report.candidate.package_slug, 'proof-package');
  assert.equal(report.candidate.part_id, 'proof_part');
  assert.equal(report.candidate.revision, 'B');

  const parents = Object.fromEntries(report.revision_lineage.parents.map((parent) => [parent.role, parent]));
  assert.deepEqual(Object.keys(parents).sort(), [
    'authoritative_config',
    'baseline_config',
    'baseline_review_pack',
    'candidate_review_pack',
  ]);
  assert.deepEqual(
    [parents.baseline_config.path, parents.baseline_config.sha256],
    [fixture.baseline.configPath, report.baseline.source_hashes.config]
  );
  assert.deepEqual(
    [parents.baseline_review_pack.path, parents.baseline_review_pack.sha256],
    [fixture.baseline.reviewPackPath, report.baseline.source_hashes.review_pack]
  );
  assert.deepEqual(
    [parents.authoritative_config.path, parents.authoritative_config.sha256],
    [fixture.candidate.configPath, report.candidate.source_hashes.config]
  );
  assert.deepEqual(
    [parents.candidate_review_pack.path, parents.candidate_review_pack.sha256],
    [fixture.candidate.reviewPackPath, report.candidate.source_hashes.review_pack]
  );
  assert.ok(report.revision_lineage.parents.every((parent) => Number.isSafeInteger(parent.size_bytes)));

  const result = await writeRevisionImpactArtifacts({
    projectRoot: fixture.root,
    report,
    jsonPath: 'output/revision-impact.json',
    markdownPath: 'output/revision-impact.md',
  });
  const jsonBytes = readFileSync(result.jsonPath);
  assert.equal(result.jsonSha256, sha256(jsonBytes));
  assert.deepEqual(JSON.parse(jsonBytes), report);
  assert.equal(existsSync(result.markdownPath), true);
});

test('proof-looking inputs remain legacy unless requireAuthoritativeLineage is explicitly true', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report } = await createRevisionImpactReportFromPaths({
    ...fixture.options,
    requireAuthoritativeLineage: false,
  });
  assert.equal(Object.hasOwn(report, 'revision_lineage'), false);
  assert.equal(report.candidate.package_slug, 'proof-package');
  assert.equal(report.candidate.part_id, 'proof_part');
  assert.equal(report.candidate.revision, 'B');
});

test('proof revision impact requires explicit two-sided selections and independent source locators', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  await assertRejectsCode(
    () => createRevisionImpactReportFromPaths({
      ...fixture.options,
      baselineLineageSelection: null,
    }),
    'missing_identity'
  );
  await assertRejectsCode(
    () => createRevisionImpactReportFromPaths({
      ...fixture.options,
      candidateReviewPackPath: fixture.baseline.reviewPackPath,
      candidateConfigPath: fixture.baseline.configPath,
      candidateLineageSelection: fixture.baseline.selection,
    }),
    'conflicting_identity'
  );
  assert.equal(existsSync(join(fixture.root, 'output')), false);
});

test('proof revision impact rejects cross-revision package or part identity conflicts', async (t) => {
  await t.test('package_slug conflict', async (subtest) => {
    const fixture = makeFixture({
      candidateIdentity: { packageSlug: 'other-package', partId: 'proof_part', revision: 'B' },
    });
    cleanupFixture(subtest, fixture);
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'conflicting_identity'
    );
  });
  await t.test('part_id conflict', async (subtest) => {
    const fixture = makeFixture({
      candidateIdentity: { packageSlug: 'proof-package', partId: 'other_part', revision: 'B' },
    });
    cleanupFixture(subtest, fixture);
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'conflicting_identity'
    );
  });
});

test('proof review aliases distinguish missing identity from conflicting identity', async (t) => {
  await t.test('missing alias', async (subtest) => {
    const fixture = makeFixture();
    cleanupFixture(subtest, fixture);
    rewriteJson(fixture.root, fixture.baseline.reviewPackPath, (reviewPack) => {
      delete reviewPack.part_id;
    });
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'missing_identity'
    );
  });
  await t.test('conflicting alias', async (subtest) => {
    const fixture = makeFixture();
    cleanupFixture(subtest, fixture);
    rewriteJson(fixture.root, fixture.baseline.reviewPackPath, (reviewPack) => {
      reviewPack.part_id = 'other_part';
    });
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'conflicting_identity'
    );
  });
});

test('proof review lineage rejects missing and digest-mismatched authoritative parents before output', async (t) => {
  await t.test('missing review lineage', async (subtest) => {
    const fixture = makeFixture();
    cleanupFixture(subtest, fixture);
    rewriteJson(fixture.root, fixture.baseline.reviewPackPath, (reviewPack) => {
      delete reviewPack.revision_lineage;
    });
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'unsupported_legacy'
    );
    assert.equal(existsSync(join(fixture.root, 'output')), false);
  });
  await t.test('digest-mismatched config parent', async (subtest) => {
    const fixture = makeFixture();
    cleanupFixture(subtest, fixture);
    rewriteJson(fixture.root, fixture.baseline.reviewPackPath, (reviewPack) => {
      reviewPack.revision_lineage.parents[0].sha256 = '0'.repeat(64);
    });
    await assertRejectsCode(
      () => createRevisionImpactReportFromPaths(fixture.options),
      'digest_mismatch'
    );
    assert.equal(existsSync(join(fixture.root, 'output')), false);
  });
});

test('stale proof parents fail before preflight creates output state', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report } = await createRevisionImpactReportFromPaths(fixture.options);
  appendFileSync(join(fixture.root, fixture.baseline.configPath), '# stale after report creation\n', 'utf8');

  await assertRejectsCode(
    () => preflightRevisionImpactArtifactTargets({
      projectRoot: fixture.root,
      report,
      jsonPath: 'output/revision-impact.json',
    }),
    'stale_parent'
  );
  assert.equal(existsSync(join(fixture.root, 'output')), false);
});

test('a trusted proof report cannot be downgraded to legacy before publication', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report } = await createRevisionImpactReportFromPaths(fixture.options);
  delete report.revision_lineage;

  await assertRejectsCode(
    () => preflightRevisionImpactArtifactTargets({
      projectRoot: fixture.root,
      report,
      jsonPath: 'output/revision-impact.json',
    }),
    'missing_parent'
  );
  assert.equal(existsSync(join(fixture.root, 'output')), false);
});

test('commit-time stale proof detection preserves existing outputs atomically', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report } = await createRevisionImpactReportFromPaths(fixture.options);
  const outputDirectory = join(fixture.root, 'output');
  mkdirSync(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, 'revision-impact.json');
  const markdownPath = join(outputDirectory, 'revision-impact.md');
  writeFileSync(jsonPath, 'old-json\n', 'utf8');
  writeFileSync(markdownPath, 'old-markdown\n', 'utf8');
  const preparedPlan = await preflightRevisionImpactArtifactTargets({
    projectRoot: fixture.root,
    report,
    jsonPath: 'output/revision-impact.json',
    markdownPath: 'output/revision-impact.md',
  });

  await assertRejectsCode(
    () => writeRevisionImpactArtifacts({
      preparedPlan,
      __testBeforeProofCommit: async () => {
        appendFileSync(join(fixture.root, fixture.candidate.reviewPackPath), '\n', 'utf8');
      },
    }),
    'stale_parent'
  );
  assert.equal(readFileSync(jsonPath, 'utf8'), 'old-json\n');
  assert.equal(readFileSync(markdownPath, 'utf8'), 'old-markdown\n');
  assert.deepEqual(readdirSync(outputDirectory).sort(), ['revision-impact.json', 'revision-impact.md']);
});

test('revision-impact contract rejects candidate identity and parent digest tampering', async (t) => {
  const fixture = makeFixture();
  cleanupFixture(t, fixture);
  const { report } = await createRevisionImpactReportFromPaths(fixture.options);

  const identityTamper = clone(report);
  identityTamper.revision_lineage.identity.revision = 'C';
  const identityValidation = validateRevisionImpactReport(identityTamper);
  assert.equal(identityValidation.ok, false);
  assert.ok(identityValidation.errors.some((error) => error.code === 'conflicting_identity'));

  const missingIdentity = clone(report);
  delete missingIdentity.revision_lineage.identity.part_id;
  const missingIdentityValidation = validateRevisionImpactReport(missingIdentity);
  assert.equal(missingIdentityValidation.ok, false);
  assert.ok(missingIdentityValidation.errors.some((error) => error.code === 'missing_identity'));

  const digestTamper = clone(report);
  digestTamper.revision_lineage.parents.find(
    (parent) => parent.role === 'baseline_config'
  ).sha256 = '0'.repeat(64);
  const digestValidation = validateRevisionImpactReport(digestTamper);
  assert.equal(digestValidation.ok, false);
  assert.ok(digestValidation.errors.some((error) => error.code === 'digest_mismatch'));

  const extraParent = clone(report);
  extraParent.revision_lineage.parents.push({
    artifact_type: 'review_pack',
    role: 'unexpected_parent',
    path: fixture.baseline.reviewPackPath,
    sha256: report.baseline.source_hashes.review_pack,
  });
  const extraValidation = validateRevisionImpactReport(extraParent);
  assert.equal(extraValidation.ok, false);
  assert.ok(extraValidation.errors.some((error) => error.code === 'conflicting_identity'));
});

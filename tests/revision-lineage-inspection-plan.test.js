import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import {
  buildRevisionLineage,
  buildRevisionLineageParent,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
} from '../lib/revision-lineage-contract.js';
import { createInspectionPlanFromPaths } from '../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED_AT = '2026-07-27T00:00:00Z';
const portable = (path) => relative(ROOT, path).replaceAll('\\', '/');

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(resolve(ROOT, 'tmp/codex/revision-lineage-plan-'));
try {
  const packageDirectory = join(temp, 'fixture-bracket');
  const configPath = join(packageDirectory, 'source-config.toml');
  const reviewPath = join(packageDirectory, 'review_pack.json');
  const readinessPath = join(packageDirectory, 'readiness_report.json');
  const requirementsPath = join(packageDirectory, 'inspection_requirements.json');
  await mkdir(packageDirectory, { recursive: true });

  const selection = {
    package_directory: portable(packageDirectory),
    package_slug: 'fixture-bracket',
    part_id: 'FIXTURE-BRACKET-100',
    revision: 'B',
    authoritative_config_path: portable(configPath),
    generated_config_descendants: [portable(join(packageDirectory, 'config.toml'))],
  };
  const template = await readFile(resolve(ROOT, 'configs/examples/hinge_block.toml'), 'utf8');
  const proofConfig = template
    .replace(/^name = "hinge_block"$/m, 'name = "FIXTURE-BRACKET-100"')
    .replace(/^package_slug = "hinge-block"$/m, 'package_slug = "fixture-bracket"')
    .replace(/^part_id = "hinge_block"$/m, 'part_id = "FIXTURE-BRACKET-100"')
    .replace(/^revision = "A"$/m, 'revision = "B"');
  await writeFile(configPath, proofConfig, 'utf8');

  const configSnapshot = await readAuthoritativeConfigSnapshot({
    projectRoot: ROOT,
    configPath: portable(configPath),
    selection,
  });
  const configParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot: configSnapshot,
  });

  const review = JSON.parse(await readFile(
    resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json'),
    'utf8'
  ));
  review.revision_lineage = buildRevisionLineage({
    identity: configSnapshot.identity,
    parents: [configParent],
  });
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  const reviewSnapshot = await readRevisionLineageFileSnapshot({ projectRoot: ROOT, path: portable(reviewPath) });
  const reviewParent = buildRevisionLineageParent({
    artifactType: 'review_pack',
    role: 'review_pack',
    path: 'run/review_pack.json',
    sha256: reviewSnapshot.sha256,
    sizeBytes: reviewSnapshot.size_bytes,
  });

  const readiness = {
    artifact_type: 'readiness_report',
    package_slug: 'fixture-bracket',
    revision: 'B',
    part: { package_slug: 'fixture-bracket', part_id: 'FIXTURE-BRACKET-100', revision: 'B' },
    revision_lineage: buildRevisionLineage({
      identity: configSnapshot.identity,
      parents: [configParent, reviewParent],
    }),
  };
  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  const requirements = {
    artifact_type: 'inspection_requirements',
    schema_version: '1.0',
    revision_lineage: buildRevisionLineage({ identity: configSnapshot.identity, parents: [configParent] }),
    items: [],
  };
  await writeFile(requirementsPath, `${JSON.stringify(requirements, null, 2)}\n`, 'utf8');

  const plan = await createInspectionPlanFromPaths({
    projectRoot: ROOT,
    reviewPackPath: portable(reviewPath),
    readinessPath: portable(readinessPath),
    configPath: portable(configPath),
    requirementsPath: portable(requirementsPath),
    scope: 'full',
    generatedAt: GENERATED_AT,
    requireAuthoritativeLineage: true,
    lineageSelection: selection,
  });
  assert.deepEqual(plan.revision_lineage.identity, configSnapshot.identity);
  assert.deepEqual(
    plan.revision_lineage.parents.map((parent) => parent.role).sort(),
    ['authoritative_config', 'inspection_requirements', 'readiness_report', 'review_pack']
  );
  assert.equal(plan.package.part_identifier, 'FIXTURE-BRACKET-100');
  assert.equal(Object.values(plan.source_snapshot).every((entry) => Number.isInteger(entry.size_bytes)), true);
  assert.equal(plan.source_snapshot.review_pack.path, 'run/review_pack.json');
  assert.equal(plan.source_snapshot.readiness.path, 'run/readiness_report.json');
  assert.equal(plan.source_snapshot.requirements.path, 'run/inspection_requirements.json');

  const staleReadiness = structuredClone(readiness);
  staleReadiness.revision_lineage.parents = staleReadiness.revision_lineage.parents.map((parent) => (
    parent.role === 'review_pack' ? { ...parent, sha256: '0'.repeat(64) } : parent
  ));
  await writeFile(readinessPath, `${JSON.stringify(staleReadiness, null, 2)}\n`, 'utf8');
  await assert.rejects(
    createInspectionPlanFromPaths({
      projectRoot: ROOT,
      reviewPackPath: portable(reviewPath),
      readinessPath: portable(readinessPath),
      configPath: portable(configPath),
      scope: 'full',
      generatedAt: GENERATED_AT,
      requireAuthoritativeLineage: true,
      lineageSelection: selection,
    }),
    (error) => error?.code === 'digest_mismatch'
  );

  await writeFile(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  await assert.rejects(
    createInspectionPlanFromPaths({
      projectRoot: ROOT,
      reviewPackPath: portable(reviewPath),
      readinessPath: portable(readinessPath),
      configPath: portable(configPath),
      scope: 'full',
      generatedAt: GENERATED_AT,
      requireAuthoritativeLineage: true,
      lineageSelection: selection,
      afterSnapshot: async () => {
        await writeFile(reviewPath, `${JSON.stringify({ ...review, generated_at: '2026-07-27T00:00:01Z' }, null, 2)}\n`, 'utf8');
      },
    }),
    (error) => error?.code === 'stale_parent'
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('revision-lineage-inspection-plan.test.js: ok');

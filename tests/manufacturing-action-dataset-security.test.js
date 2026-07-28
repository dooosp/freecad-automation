import assert from 'node:assert/strict';
import {
  access,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';

import {
  MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES,
  generateManufacturingActionDataset,
} from '../src/services/manufacturing-action-dataset/manufacturing-action-dataset-service.js';
import { INSPECTION_PLAN_PUBLICATION_FILES } from '../lib/atomic-output-publication.js';
import { createManufacturingActionDatasetFixture } from './helpers/manufacturing-action-dataset-fixture.js';

const ROOT = resolve(import.meta.dirname, '..');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertRejectsCode(callback, code) {
  await assert.rejects(callback, (error) => {
    assert.equal(error?.code, code, error?.stack || error?.message);
    return true;
  });
}

test('explicit proof activation and strict repository-relative paths fail closed', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const base = fixture.outputOptions('path-output');

  await assertRejectsCode(
    () => generateManufacturingActionDataset({ ...base, proofLineage: false }),
    'proof_lineage_required'
  );
  for (const outDir of [
    resolve(ROOT, 'output/absolute-forbidden'),
    'tmp/codex/../escape',
    'tmp\\codex\\escape',
    'output',
    'output/%2e%2e/escape',
  ]) {
    await assertRejectsCode(
      () => generateManufacturingActionDataset({ ...base, outDir }),
      outDir === 'output' ? 'unsafe_output_path' : 'unsafe_path'
    );
  }
  await assertRejectsCode(
    () => generateManufacturingActionDataset({ ...base, reviewPackPath: fixture.reviewPath }),
    'unsafe_path'
  );
  for (const generatedAt of ['2026-02-31T00:00:00Z', '2026-07-28T00:00:00.1Z']) {
    await assertRejectsCode(
      () => generateManufacturingActionDataset({ ...base, generatedAt }),
      'invalid_generated_at'
    );
  }
});

test('duplicate JSON, BOM, boundary overrides, and stale lineage are rejected before publication', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const task = JSON.parse(await readFile(resolve(ROOT, fixture.baseOptions.taskPlanPath), 'utf8'));

  const duplicateTaskPath = join(fixture.inputDirectory, 'duplicate-task.json');
  await writeFile(duplicateTaskPath, '{"artifact_type":"manufacturing_task_plan","artifact_type":"manufacturing_task_plan"}\n');
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('duplicate-output'),
      taskPlanPath: fixture.portable(duplicateTaskPath),
    }),
    'duplicate_json_key'
  );

  const bomTaskPath = join(fixture.inputDirectory, 'bom-task.json');
  await writeFile(bomTaskPath, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(`${JSON.stringify(task, null, 2)}\n`),
  ]));
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('bom-output'),
      taskPlanPath: fixture.portable(bomTaskPath),
    }),
    'bom_forbidden'
  );

  const overridden = structuredClone(task);
  overridden.boundaries.real_shop_floor_data = true;
  const overriddenTask = await fixture.writeJson('overridden-task.json', overridden);
  await assert.rejects(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('boundary-output'),
      taskPlanPath: overriddenTask.locator,
    }),
    (error) => /boundary|const/i.test(`${error?.code} ${error?.message}`)
  );

  const unsafeKeyTask = structuredClone(task);
  Object.defineProperty(unsafeKeyTask, 'constructor', {
    value: { polluted: true },
    enumerable: true,
  });
  const unsafeKeyFile = await fixture.writeJson('unsafe-key-task.json', unsafeKeyTask);
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('unsafe-key-output'),
      taskPlanPath: unsafeKeyFile.locator,
    }),
    'unsafe_control_key'
  );

  const staleReview = structuredClone(fixture.reviewPack);
  staleReview.revision_lineage.parents[0].sha256 = '0'.repeat(64);
  const staleReviewFile = await fixture.writeJson('stale-review.json', staleReview);
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('stale-lineage-output'),
      reviewPackPath: staleReviewFile.locator,
    }),
    'digest_mismatch'
  );
});

test('symlink and hardlink source aliases are rejected', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());

  const symlinkPath = join(fixture.inputDirectory, 'review-symlink.json');
  await symlink(fixture.reviewPath, symlinkPath);
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('source-symlink-output'),
      reviewPackPath: fixture.portable(symlinkPath),
    }),
    'symlink_forbidden'
  );

  const hardlinkPath = join(fixture.inputDirectory, 'review-hardlink.json');
  await link(fixture.reviewPath, hardlinkPath);
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.outputOptions('source-hardlink-output'),
      reviewPackPath: fixture.portable(hardlinkPath),
    }),
    'hardlink_forbidden'
  );
  await unlink(hardlinkPath);
});

test('safe output preparation rejects a symlink ancestor without creating an outside child', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const outside = join(fixture.tempRoot, 'outside-output-target');
  await mkdir(outside);
  const aliasName = `manufacturing-action-alias-${basename(fixture.tempRoot)}`;
  const alias = resolve(ROOT, 'output', aliasName);
  await mkdir(resolve(ROOT, 'output'), { recursive: true });
  await symlink(outside, alias);
  t.after(() => unlink(alias).catch(() => {}));

  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...fixture.baseOptions,
      outDir: `output/${aliasName}/dataset`,
    }),
    'unsafe_output_path'
  );
  assert.equal(await exists(join(outside, 'dataset')), false);
});

test('unsafe output targets and mid-publication interruption preserve the prior complete set', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());

  const symlinkOutput = fixture.outputOptions('target-symlink-output');
  const symlinkDirectory = resolve(ROOT, symlinkOutput.outDir);
  await mkdir(symlinkDirectory, { recursive: true });
  const outsideFile = join(fixture.tempRoot, 'outside-file.json');
  await writeFile(outsideFile, 'outside\n');
  await symlink(outsideFile, resolve(symlinkDirectory, 'manufacturing_action_dictionary.json'));
  await assertRejectsCode(
    () => generateManufacturingActionDataset(symlinkOutput),
    'atomic_publication_failed'
  );
  assert.equal(await readFile(outsideFile, 'utf8'), 'outside\n');

  const unexpectedOutput = fixture.outputOptions('unexpected-entry-output');
  const unexpectedDirectory = resolve(ROOT, unexpectedOutput.outDir);
  await mkdir(unexpectedDirectory, { recursive: true });
  await writeFile(resolve(unexpectedDirectory, 'unrelated.txt'), 'preserve me\n');
  await assertRejectsCode(
    () => generateManufacturingActionDataset(unexpectedOutput),
    'unexpected_output_entry'
  );
  assert.equal(await readFile(resolve(unexpectedDirectory, 'unrelated.txt'), 'utf8'), 'preserve me\n');

  const orphanOutput = fixture.outputOptions('orphan-transaction-output');
  const orphanDirectory = resolve(ROOT, orphanOutput.outDir);
  await mkdir(orphanDirectory, { recursive: true });
  const orphanName = '.manufacturing_action_dictionary.json.orphan.tmp';
  await writeFile(resolve(orphanDirectory, orphanName), 'orphan\n');
  await assertRejectsCode(
    () => generateManufacturingActionDataset(orphanOutput),
    'unexpected_output_entry'
  );
  assert.deepEqual(await readdir(orphanDirectory), [orphanName]);

  const rollbackOptions = fixture.outputOptions('rollback-output');
  const first = await generateManufacturingActionDataset(rollbackOptions);
  const before = Object.fromEntries(await Promise.all(
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).map(async (name) => [
      name,
      await readFile(resolve(first.output_dir, name)),
    ])
  ));
  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...rollbackOptions,
      publicationHooks: {
        afterCommit: async ({ index }) => {
          if (index === 3) throw new Error('injected publication interruption');
        },
      },
    }),
    'atomic_publication_failed'
  );
  assert.deepEqual(
    (await readdir(first.output_dir)).sort(),
    Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).sort()
  );
  for (const [name, bytes] of Object.entries(before)) {
    assert.deepEqual(await readFile(resolve(first.output_dir, name)), bytes);
  }
});

test('the next run recovers only strict publisher-owned pre-journal debris', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const stalePid = 2_000_000_000;
  const token = `${stalePid}.00000000-0000-4000-8000-000000000001`;
  const { journal, lock } = INSPECTION_PLAN_PUBLICATION_FILES;
  const cases = [
    {
      name: 'lock-only',
      debrisName: lock,
      content: `${JSON.stringify({ pid: stalePid, token })}\n`,
    },
    {
      name: 'owner-only',
      debrisName: `.${lock}.${token}.owner`,
      content: `${JSON.stringify({ pid: stalePid, token })}\n`,
    },
    {
      name: 'output-temp-only',
      debrisName: `.manufacturing_action_dictionary.json.${token}.tmp`,
      content: 'interrupted output\n',
    },
    {
      name: 'journal-temp-only',
      debrisName: `.${journal}.${token}.tmp`,
      content: 'interrupted journal\n',
    },
  ];

  for (const recoveryCase of cases) {
    const options = fixture.outputOptions(`recover-${recoveryCase.name}`);
    const directory = resolve(ROOT, options.outDir);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, recoveryCase.debrisName), recoveryCase.content);

    const result = await generateManufacturingActionDataset(options);
    assert.equal(result.output_dir, directory);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      Object.values(MANUFACTURING_ACTION_DATASET_OUTPUT_FILENAMES).sort()
    );
  }
});

test('source mutation after preparation is detected before a complete output becomes visible', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const options = fixture.outputOptions('source-race-output');
  const originalReviewBytes = await readFile(fixture.reviewPath);

  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...options,
      publicationHooks: {
        beforeCommit: async ({ index }) => {
          if (index === 0) {
            await writeFile(
              fixture.reviewPath,
              `${JSON.stringify({ ...fixture.reviewPack, generated_at: '2026-07-28T00:00:01Z' }, null, 2)}\n`
            );
          }
        },
      },
    }),
    'stale_parent'
  );
  const outputDirectory = resolve(ROOT, options.outDir);
  assert.deepEqual(await readdir(outputDirectory), []);
  await writeFile(fixture.reviewPath, originalReviewBytes);
});

test('same-byte inode replacement after verification is rejected', async (t) => {
  const fixture = await createManufacturingActionDatasetFixture({ projectRoot: ROOT });
  t.after(() => fixture.cleanup());
  const options = fixture.outputOptions('same-byte-race-output');
  const reviewBytes = await readFile(fixture.reviewPath);
  const replacement = join(fixture.inputDirectory, 'review-replacement.json');

  await assertRejectsCode(
    () => generateManufacturingActionDataset({
      ...options,
      publicationHooks: {
        beforeCommit: async ({ index }) => {
          if (index === 0) {
            await writeFile(replacement, reviewBytes);
            await rename(replacement, fixture.reviewPath);
          }
        },
      },
    }),
    'stale_parent'
  );
  assert.deepEqual(await readdir(resolve(ROOT, options.outDir)), []);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';

import {
  RevisionImpactServiceError,
  createRevisionImpactReportFromPaths,
  preflightRevisionImpactArtifactTargets,
  writeRevisionImpactArtifacts,
} from '../src/services/revision-impact/revision-impact-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/revision-impact/unchanged-review-pack.json');
const GENERATED_AT = '2026-07-11T00:00:00Z';
const TMP_ROOT = resolve(ROOT, 'tmp/codex');

await mkdir(TMP_ROOT, { recursive: true });

const { report: REPORT } = await createRevisionImpactReportFromPaths({
  projectRoot: ROOT,
  baselineReviewPackPath: FIXTURE,
  candidateReviewPackPath: FIXTURE,
  generatedAt: GENERATED_AT,
});

function isRevisionImpactServiceError(error) {
  return error instanceof RevisionImpactServiceError;
}

async function createSandbox(t) {
  const sandbox = await mkdtemp(join(TMP_ROOT, 'revision-impact-output-safety-'));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  return sandbox;
}

test('preflight rejects a tracked in-repo JSON target even when the caller declares the repo root allowed', async () => {
  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: resolve(ROOT, 'package-lock.json'),
      allowedOutputRoots: [ROOT],
    }),
    isRevisionImpactServiceError
  );
});

test('preflight rejects a tracked in-repo Markdown target even when the caller declares the repo root allowed', async (t) => {
  const sandbox = await createSandbox(t);
  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: join(sandbox, 'revision_impact_report.json'),
      markdownPath: resolve(ROOT, 'README.md'),
      allowedOutputRoots: [ROOT],
    }),
    isRevisionImpactServiceError
  );
});

test('preflight rejects canonical docs/examples JSON and Markdown targets', async (t) => {
  const sandbox = await createSandbox(t);
  const canonicalRoot = resolve(ROOT, 'docs/examples/quality-pass-bracket');

  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: join(canonicalRoot, 'revision_impact_report.json'),
      allowedOutputRoots: [ROOT],
    }),
    isRevisionImpactServiceError
  );

  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: join(sandbox, 'revision_impact_report.json'),
      markdownPath: join(canonicalRoot, 'revision_impact_report.md'),
      allowedOutputRoots: [ROOT],
    }),
    isRevisionImpactServiceError
  );
});

test('preflight rejects a JSON and Markdown path collision without creating the target', async (t) => {
  const sandbox = await createSandbox(t);
  const collidingPath = join(sandbox, 'revision_impact_report.json');

  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: collidingPath,
      markdownPath: collidingPath,
      allowedOutputRoots: [sandbox],
    }),
    isRevisionImpactServiceError
  );
  await assert.rejects(lstat(collidingPath), (error) => error?.code === 'ENOENT');
});

test('preflight rejects backslash path tricks', async (t) => {
  const sandbox = await createSandbox(t);
  await assert.rejects(
    preflightRevisionImpactArtifactTargets({
      projectRoot: ROOT,
      report: REPORT,
      jsonPath: `${sandbox}\\escaped.json`,
      allowedOutputRoots: [sandbox],
    }),
    (error) => error instanceof RevisionImpactServiceError && error.code === 'unsafe_path'
  );
});

test('preflight validates prospective output paths without creating either directory', async (t) => {
  const sandbox = await createSandbox(t);
  const outputDirectory = join(sandbox, 'missing-output', 'nested');

  const plan = await preflightRevisionImpactArtifactTargets({
    projectRoot: ROOT,
    report: REPORT,
    jsonPath: join(outputDirectory, 'revision_impact_report.json'),
    markdownPath: join(outputDirectory, 'revision_impact_report.md'),
    allowedOutputRoots: [sandbox],
  });

  assert.equal(plan.entries.length, 2);
  await assert.rejects(lstat(outputDirectory), (error) => error?.code === 'ENOENT');
});

test('writer rolls back both existing finals after a catchable mid-publication interruption', async (t) => {
  const sandbox = await createSandbox(t);
  const jsonPath = join(sandbox, 'revision_impact_report.json');
  const markdownPath = join(sandbox, 'revision_impact_report.md');
  const originalJson = Buffer.from('json sentinel\n');
  const originalMarkdown = Buffer.from('markdown sentinel\n');
  await writeFile(jsonPath, originalJson);
  await writeFile(markdownPath, originalMarkdown);
  const plan = await preflightRevisionImpactArtifactTargets({
    projectRoot: ROOT,
    report: REPORT,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [sandbox],
  });

  await assert.rejects(
    writeRevisionImpactArtifacts({ preparedPlan: plan, __testFailAfterCommitCount: 1 }),
    (error) => error instanceof RevisionImpactServiceError && error.code === 'simulated_output_interruption'
  );
  assert.deepEqual(await readFile(jsonPath), originalJson);
  assert.deepEqual(await readFile(markdownPath), originalMarkdown);
  const leftovers = (await readdir(sandbox)).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak'));
  assert.deepEqual(leftovers, []);
});

test('writer rejects a target inode replacement without modifying the other final', async (t) => {
  const sandbox = await createSandbox(t);
  const jsonPath = join(sandbox, 'revision_impact_report.json');
  const markdownPath = join(sandbox, 'revision_impact_report.md');
  const replacementPath = join(sandbox, 'replacement.md');
  const originalJson = Buffer.from('json sentinel\n');
  const originalMarkdown = Buffer.from('markdown sentinel\n');
  const replacementMarkdown = Buffer.from('replacement sentinel\n');

  await writeFile(jsonPath, originalJson);
  await writeFile(markdownPath, originalMarkdown);
  const before = await lstat(markdownPath);
  const plan = await preflightRevisionImpactArtifactTargets({
    projectRoot: ROOT,
    report: REPORT,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [sandbox],
  });

  await writeFile(replacementPath, replacementMarkdown);
  await rename(replacementPath, markdownPath);
  const after = await lstat(markdownPath);
  assert.notDeepEqual(
    { device: after.dev, inode: after.ino },
    { device: before.dev, inode: before.ino },
    'test setup must replace the Markdown inode'
  );

  await assert.rejects(
    writeRevisionImpactArtifacts({ preparedPlan: plan }),
    (error) => error instanceof RevisionImpactServiceError && error.code === 'output_target_changed'
  );
  assert.deepEqual(await readFile(jsonPath), originalJson);
  assert.deepEqual(await readFile(markdownPath), replacementMarkdown);

  const leftovers = (await readdir(dirname(jsonPath)))
    .filter((name) => name.endsWith('.tmp') || name.endsWith('.bak'));
  assert.deepEqual(leftovers, []);
});

test('concurrent prepared writers cannot delete or mix the winning final pair', async (t) => {
  const sandbox = await createSandbox(t);
  for (let index = 0; index < 20; index += 1) {
    const directory = join(sandbox, `concurrent-${index}`);
    await mkdir(directory);
    const jsonPath = join(directory, 'revision_impact_report.json');
    const markdownPath = join(directory, 'revision_impact_report.md');
    const leftReport = structuredClone(REPORT);
    const rightReport = structuredClone(REPORT);
    leftReport.generated_at = '2026-07-11T00:00:01Z';
    rightReport.generated_at = '2026-07-11T00:00:02Z';
    const [leftPlan, rightPlan] = await Promise.all([leftReport, rightReport].map((report) => (
      preflightRevisionImpactArtifactTargets({
        projectRoot: ROOT,
        report,
        jsonPath,
        markdownPath,
        allowedOutputRoots: [directory],
      })
    )));

    const results = await Promise.allSettled([
      writeRevisionImpactArtifacts({ preparedPlan: leftPlan }),
      writeRevisionImpactArtifacts({ preparedPlan: rightPlan }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(['2026-07-11T00:00:01Z', '2026-07-11T00:00:02Z'].includes(
      JSON.parse(await readFile(jsonPath, 'utf8')).generated_at
    ), true);
    assert.equal((await readFile(markdownPath, 'utf8')).startsWith('# Revision Impact Report'), true);
    const leftovers = (await readdir(directory)).filter((name) => (
      name.endsWith('.tmp') || name.endsWith('.bak') || name.includes('output.lock') || name.includes('transaction')
    ));
    assert.deepEqual(leftovers, []);
  }
});

test('a hard process interruption is journal-recovered before the next publication', async (t) => {
  const sandbox = await createSandbox(t);
  const jsonPath = join(sandbox, 'revision_impact_report.json');
  const markdownPath = join(sandbox, 'revision_impact_report.md');
  const legacyPath = join(sandbox, 'revision_comparison.json');
  const originalJson = Buffer.from('original json sentinel\n');
  const originalMarkdown = Buffer.from('original markdown sentinel\n');
  const originalLegacy = Buffer.from('original legacy sentinel\n');
  await writeFile(jsonPath, originalJson);
  await writeFile(markdownPath, originalMarkdown);
  await writeFile(legacyPath, originalLegacy);

  const interrupted = spawnSync(
    process.execPath,
    [resolve(ROOT, 'tests/helpers/revision-impact-kill-writer.mjs'), sandbox],
    { cwd: ROOT, encoding: 'utf8', timeout: 15_000 }
  );
  assert.equal(interrupted.signal, 'SIGKILL', `${interrupted.stdout}\n${interrupted.stderr}`);

  const plan = await preflightRevisionImpactArtifactTargets({
    projectRoot: ROOT,
    report: REPORT,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [sandbox],
    companionArtifacts: [{
      path: legacyPath,
      extension: '.json',
      label: 'revision comparison JSON',
      content: 'recovered legacy output\n',
    }],
  });
  assert.deepEqual(await readFile(jsonPath), originalJson, 'preflight recovery restores original JSON');
  assert.deepEqual(await readFile(markdownPath), originalMarkdown, 'preflight recovery restores original Markdown');
  assert.deepEqual(await readFile(legacyPath), originalLegacy, 'preflight recovery restores original companion');

  await writeRevisionImpactArtifacts({ preparedPlan: plan });
  assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).artifact_type, 'revision_impact_report');
  assert.equal((await readFile(markdownPath, 'utf8')).startsWith('# Revision Impact Report'), true);
  assert.equal(await readFile(legacyPath, 'utf8'), 'recovered legacy output\n');
  const leftovers = (await readdir(sandbox)).filter((name) => (
    name.endsWith('.tmp') || name.endsWith('.bak') || name.includes('output.lock') || name.includes('transaction')
  ));
  assert.deepEqual(leftovers, []);
});

test('an interrupted initial journal write is never exposed as the final recovery journal', async (t) => {
  const sandbox = await createSandbox(t);
  const jsonPath = join(sandbox, 'revision_impact_report.json');
  const markdownPath = join(sandbox, 'revision_impact_report.md');
  const legacyPath = join(sandbox, 'revision_comparison.json');
  const originalJson = Buffer.from('initial-journal json sentinel\n');
  const originalMarkdown = Buffer.from('initial-journal markdown sentinel\n');
  const originalLegacy = Buffer.from('initial-journal legacy sentinel\n');
  await writeFile(jsonPath, originalJson);
  await writeFile(markdownPath, originalMarkdown);
  await writeFile(legacyPath, originalLegacy);

  const interrupted = spawnSync(
    process.execPath,
    [resolve(ROOT, 'tests/helpers/revision-impact-kill-writer.mjs'), sandbox, 'initial-journal'],
    { cwd: ROOT, encoding: 'utf8', timeout: 15_000 }
  );
  assert.equal(interrupted.signal, 'SIGKILL', `${interrupted.stdout}\n${interrupted.stderr}`);
  assert.deepEqual(await readFile(jsonPath), originalJson);
  assert.deepEqual(await readFile(markdownPath), originalMarkdown);
  assert.deepEqual(await readFile(legacyPath), originalLegacy);
  assert.equal(
    (await readdir(sandbox)).includes('.fcad-revision-impact-output.transaction.json'),
    false,
    'the final journal name must appear only after an atomic rename'
  );

  const plan = await preflightRevisionImpactArtifactTargets({
    projectRoot: ROOT,
    report: REPORT,
    jsonPath,
    markdownPath,
    allowedOutputRoots: [sandbox],
    companionArtifacts: [{
      path: legacyPath,
      extension: '.json',
      label: 'revision comparison JSON',
      content: 'post-initial-journal output\n',
    }],
  });
  await writeRevisionImpactArtifacts({ preparedPlan: plan });
  assert.equal(JSON.parse(await readFile(jsonPath, 'utf8')).artifact_type, 'revision_impact_report');
  assert.equal(await readFile(legacyPath, 'utf8'), 'post-initial-journal output\n');
  const leftovers = (await readdir(sandbox)).filter((name) => (
    name.endsWith('.tmp') || name.endsWith('.bak') || name.includes('output.lock') || name.includes('transaction')
  ));
  assert.deepEqual(leftovers, []);
});

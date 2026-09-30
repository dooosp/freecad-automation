import assert from 'node:assert/strict';
import { test } from 'node:test';
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prepareBenchmarkPaths, writeBenchmarkReport } from '../scripts/studio-preview-benchmark.js';

async function fixture(t) {
  const temporaryRoot = resolve(import.meta.dirname, '../tmp/codex');
  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(join(temporaryRoot, 'preview-benchmark-paths-'));
  const root = join(directory, 'repo');
  const outside = join(directory, 'outside-repo');
  await mkdir(root); await mkdir(outside);
  const source = join(root, 'model.step');
  await writeFile(source, 'original CAD bytes');
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { root, outside, source };
}

for (const alias of ['symlink', 'hardlink']) {
  test(`benchmark rejects an output ${alias} alias to its input before any work`, async (t) => {
    const f = await fixture(t);
    const output = join(f.root, 'report.json');
    await (alias === 'symlink' ? symlink(f.source, output) : link(f.source, output));
    await assert.rejects(prepareBenchmarkPaths(f.root, output, f.source), /input|same file/i);
    assert.equal(await readFile(f.source, 'utf8'), 'original CAD bytes');
  });
}

test('benchmark rejects a new report below a parent symlink escaping its root', async (t) => {
  const f = await fixture(t);
  await symlink(f.outside, join(f.root, 'results'));
  await assert.rejects(prepareBenchmarkPaths(f.root, join(f.root, 'results/new/report.json'), f.source), /inside|outside|repository/i);
  assert.deepEqual(await readdir(f.outside), []);
});

test('benchmark rejects an existing output or input symlink outside its root', async (t) => {
  const f = await fixture(t);
  const outsideSource = join(f.outside, 'model.step');
  await writeFile(outsideSource, 'outside bytes');
  const output = join(f.root, 'report.json');
  await symlink(outsideSource, output);
  await assert.rejects(prepareBenchmarkPaths(f.root, output, f.source), /inside|outside|repository/i);
  await assert.rejects(prepareBenchmarkPaths(f.root, join(f.root, 'safe.json'), output), /inside|outside|repository/i);
  assert.equal(await readFile(outsideSource, 'utf8'), 'outside bytes');
});

test('a final output alias inserted during the benchmark cannot overwrite its input', async (t) => {
  const f = await fixture(t);
  const output = join(f.root, 'report.json');
  const prepared = await prepareBenchmarkPaths(f.root, output, f.source);
  await symlink(f.source, output);
  await assert.rejects(writeBenchmarkReport(prepared, { measured: true }), /input|changed|alias/i);
  assert.equal(await readFile(f.source, 'utf8'), 'original CAD bytes');
});

test('a replaced output directory aborts saving without writing through its new symlink', async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, 'results');
  await mkdir(directory);
  const prepared = await prepareBenchmarkPaths(f.root, join(directory, 'report.json'), f.source);
  await rename(directory, join(f.root, 'previous-results'));
  await symlink(f.outside, directory);
  await assert.rejects(writeBenchmarkReport(prepared, { measured: true }), /inside|outside|changed|directory/i);
  assert.deepEqual(await readdir(f.outside), []);
});

test('safe reports can create nested output directories and replace an earlier JSON report', async (t) => {
  const f = await fixture(t);
  const output = join(f.root, 'results/new/report.json');
  const prepared = await prepareBenchmarkPaths(f.root, output, f.source);
  await writeBenchmarkReport(prepared, { measured: true });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { measured: true });
  const repeated = await prepareBenchmarkPaths(f.root, output, f.source);
  await writeBenchmarkReport(repeated, { measured: false });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { measured: false });
  assert.equal(await readFile(f.source, 'utf8'), 'original CAD bytes');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createInspectionPlanFromPaths, writeInspectionPlanOutputs } from '../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json');
const plan = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: FIXTURE, scope: 'full', generatedAt: '2026-07-12T00:00:00Z' });

async function sandbox(t) { const dir = await mkdtemp(join(resolve(ROOT, 'tmp/codex'), 'inspection-output-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function options(dir, hooks = {}) { return { projectRoot: ROOT, plan, outputPath: relative(ROOT, join(dir, 'inspection_plan.json')), checksheetPath: relative(ROOT, join(dir, 'inspection_checksheet.csv')), requestPath: relative(ROOT, join(dir, 'supplier_inspection_request.md')), resultTemplatePath: relative(ROOT, join(dir, 'inspection_result_template.csv')), publicationHooks: hooks }; }

await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });

test('rejects symlink output directory', async (t) => {
  const parent = await sandbox(t); const real = join(parent, 'real'); const alias = join(parent, 'alias'); await mkdir(real); await symlink(real, alias);
  await assert.rejects(writeInspectionPlanOutputs(options(alias)), /symlink/i);
});

test('rejects traversal, NUL, backslash, and output collisions before publication', async () => {
  await assert.rejects(writeInspectionPlanOutputs({ ...options(resolve(ROOT, 'tmp/codex')), outputPath: 'tmp/codex/a/../inspection_plan.json' }), /traversal/);
  await assert.rejects(writeInspectionPlanOutputs({ ...options(resolve(ROOT, 'tmp/codex')), outputPath: 'tmp/codex/bad\0inspection_plan.json' }), /NUL/);
  await assert.rejects(writeInspectionPlanOutputs({ ...options(resolve(ROOT, 'tmp/codex')), outputPath: 'tmp\\codex\\inspection_plan.json' }), /backslash/);
  await assert.rejects(writeInspectionPlanOutputs({ ...options(resolve(ROOT, 'tmp/codex')), checksheetPath: 'tmp/codex/inspection_plan.json' }), /unique/);
});

test('rejects hardlink output alias', async (t) => {
  const dir = await sandbox(t); const outside = join(dir, 'outside.json'); await writeFile(outside, 'sentinel'); await link(outside, join(dir, 'inspection_plan.json'));
  await assert.rejects(writeInspectionPlanOutputs(options(dir)), /hardlink/i);
  assert.equal(await readFile(outside, 'utf8'), 'sentinel');
});

test('rolls back all files after a mid-publication failure', async (t) => {
  const dir = await sandbox(t); const names = ['inspection_plan.json', 'inspection_checksheet.csv', 'supplier_inspection_request.md', 'inspection_result_template.csv'];
  for (const name of names) await writeFile(join(dir, name), `old:${name}\n`);
  await assert.rejects(writeInspectionPlanOutputs(options(dir, { afterCommit: ({ index }) => { if (index === 0) throw new Error('simulated interruption'); } })), /simulated interruption/);
  for (const name of names) assert.equal(await readFile(join(dir, name), 'utf8'), `old:${name}\n`);
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('.tmp') || name.includes('.bak') || name.includes('transaction') || name.includes('.lock')), []);
});

test('rejects output target replacement after preflight', async (t) => {
  const dir = await sandbox(t); const target = join(dir, 'inspection_plan.json'); await writeFile(target, 'old');
  await assert.rejects(writeInspectionPlanOutputs(options(dir, { beforeCommit: async ({ index }) => { if (index === 0) { await rm(target); await writeFile(target, 'replacement'); } } })), /changed after preflight/);
  assert.equal(await readFile(target, 'utf8'), 'replacement');
});

test('concurrent publication has one winner and no mixed bytes', async (t) => {
  const dir = await sandbox(t);
  const results = await Promise.allSettled([writeInspectionPlanOutputs(options(dir, { beforeCommit: async () => new Promise((done) => setTimeout(done, 30)) })), writeInspectionPlanOutputs(options(dir))]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(JSON.parse(await readFile(join(dir, 'inspection_plan.json'), 'utf8')).plan_id, plan.plan_id);
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('.tmp') || name.includes('.bak') || name.includes('transaction') || name.includes('.lock')), []);
});

test('recovers a hard-interrupted publication before the next write', async (t) => {
  const dir = await sandbox(t); const names = ['inspection_plan.json', 'inspection_checksheet.csv', 'supplier_inspection_request.md', 'inspection_result_template.csv'];
  for (const name of names) await writeFile(join(dir, name), `old:${name}\n`);
  const child = spawnSync(process.execPath, [resolve(ROOT, 'tests/helpers/inspection-plan-kill-writer.mjs'), dir], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.signal, 'SIGKILL', `${child.stdout}\n${child.stderr}`);
  await writeInspectionPlanOutputs(options(dir));
  assert.equal(JSON.parse(await readFile(join(dir, 'inspection_plan.json'), 'utf8')).plan_id, plan.plan_id);
  assert.deepEqual((await readdir(dir)).filter((name) => name.includes('.tmp') || name.includes('.bak') || name.includes('transaction') || name.includes('.lock')), []);
});

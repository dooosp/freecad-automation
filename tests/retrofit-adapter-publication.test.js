import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeRetrofitReport } from '../src/cli/retrofit-check.js';

test('publish the reviewed STEP with its digest and preserve any existing destination', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'retrofit-publication-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = join(dir, 'review.json');
  const step = join(dir, 'review.adapter.step');
  const contents = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
  const produce = async (_script, input) => {
    assert.equal(input.adapter_candidate_id, 'B');
    await writeFile(input.adapter_step_path, contents);
    return {
      success: true,
      verified_step_sha256: createHash('sha256').update(contents).digest('hex'),
      candidates: [{ id: 'B', status: 'adapter_candidate', adapter: {} }],
    };
  };
  await writeRetrofitReport('case.json', report, produce, 'B');
  const saved = JSON.parse(await readFile(report));
  assert.equal(Object.hasOwn(saved, 'verified_step_sha256'), false);
  assert.deepEqual(saved.candidates[0].adapter.review_step, {
    file: 'review.adapter.step', sha256: createHash('sha256').update(contents).digest('hex'),
  });
  assert.equal(await readFile(step, 'utf8'), contents);
  await rm(report);
  await assert.rejects(writeRetrofitReport('case.json', report, produce, 'B'), /already exists/);
  assert.deepEqual(await readdir(dir), ['review.adapter.step']);
  assert.equal(await readFile(step, 'utf8'), contents);
});

test('export and publication failures leave no new completed output', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'retrofit-abort-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = join(dir, 'review.json');
  const candidate = { id: 'B', status: 'adapter_candidate', adapter: {} };
  const run = (runner) => writeRetrofitReport('case.json', report, runner, 'B');
  await assert.rejects(run(async (_script, input) => {
    await writeFile(input.adapter_step_path, 'partial');
    throw new Error('writer failed');
  }), /writer failed/);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(run(async (_script, input) => {
    await writeFile(input.adapter_step_path, '');
    return { success: true, candidates: [candidate] };
  }), /empty/i);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(run(async (_script, input) => {
    const partial = 'ISO-10303-21;\ntruncated';
    await writeFile(input.adapter_step_path, partial);
    return {
      success: true,
      verified_step_sha256: createHash('sha256').update(partial).digest('hex'),
      candidates: [candidate],
    };
  }), /verified|incomplete/i);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(run(async (_script, input) => {
    const contents = 'ISO-10303-21;\nEND-ISO-10303-21;';
    await writeFile(input.adapter_step_path, contents);
    await writeFile(report, 'existing', { flag: 'wx' });
    return {
      success: true,
      verified_step_sha256: createHash('sha256').update(contents).digest('hex'),
      candidates: [candidate],
    };
  }), /already exists/);
  assert.deepEqual(await readdir(dir), ['review.json']);
  assert.equal(await readFile(report, 'utf8'), 'existing');
});

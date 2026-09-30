#!/usr/bin/env node
// Bounded saved-preview probes. Synthetic STEP bytes measure service I/O, not CAD geometry.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, platform, release } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createArtifactModelPreviewService } from '../src/server/artifact-model-preview-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const MIB = 1024 * 1024;
const SIZES_MIB = [0.5, 5, 20];
const CYCLES = 10;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((done) => { resolvePromise = done; });
  return { promise, resolve: resolvePromise };
};
const round = (value) => Math.round(value * 1000) / 1000;

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, median_ms: round(sorted[Math.ceil(sorted.length / 2) - 1]),
    p95_ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]), samples_ms: samples.map(round) };
}

function memoryProbe() {
  const before = process.memoryUsage();
  const peak = { ...before };
  function sample() {
    const current = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]);
    return current;
  }
  const timer = setInterval(sample, 5);
  return { sample, finish() { const after = sample(); clearInterval(timer); return { before, after, sampled_peak: peak }; } };
}

async function collectGarbage() {
  global.gc?.(); await pause(10); global.gc?.();
}

async function until(predicate) {
  const deadline = performance.now() + 10_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Probe did not reach its expected state within 10 seconds');
    await pause(5);
  }
}

async function writeSyntheticSource(path, sizeBytes) {
  const file = await open(path, 'w');
  const chunk = Buffer.alloc(64 * 1024, 0x41);
  try {
    for (let offset = 0; offset < sizeBytes; offset += chunk.length) {
      await file.write(chunk, 0, Math.min(chunk.length, sizeBytes - offset));
    }
  } finally { await file.close(); }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function meshFixture() {
  const mesh = Buffer.alloc(134);
  mesh.writeUInt32LE(1, 80);
  mesh.writeFloatLE(1, 108);
  mesh.writeFloatLE(1, 124);
  return mesh;
}

async function fixtureCycles(directory, sizeMiB) {
  const sourcePath = join(directory, 'synthetic.step');
  await writeSyntheticSource(sourcePath, sizeMiB * MIB);
  let conversions = 0;
  const service = createArtifactModelPreviewService({ async runScript(_script, input) {
    conversions += 1; memory.sample();
    await writeFile(input.output_path, meshFixture());
    return { success: true };
  } });
  await collectGarbage();
  const memory = memoryProbe();
  const misses = [], hits = [];
  try {
    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      const request = { sourcePath, jobId: 'fixture', artifactId: `cycle-${cycle}` };
      for (const times of [misses, hits]) {
        const start = performance.now();
        const bytes = await service.readMesh(request);
        times.push(performance.now() - start);
        assert.equal(bytes.length, 134);
        memory.sample();
      }
    }
    assert.equal(conversions, CYCLES);
    await service.dispose(); await collectGarbage();
    return { scenario: 'synthetic_service_cycles', source_mib: sizeMiB, requests: CYCLES * 2,
      conversions, miss: summarize(misses), hit: summarize(hits), memory_bytes: memory.finish() };
  } finally { await service.dispose(); memory.finish(); }
}

async function queueProbe(directory) {
  const sourcePath = join(directory, 'queue.step');
  await writeSyntheticSource(sourcePath, 20 * MIB);
  const gate = deferred();
  let started = 0, active = 0, peakActive = 0;
  let failFirst = true;
  const service = createArtifactModelPreviewService({ maxConcurrent: 1, maxQueued: 2,
    async runScript(_script, input) {
      started += 1; active += 1; peakActive = Math.max(peakActive, active);
      try {
        await gate.promise;
        if (failFirst) { failFirst = false; throw new Error('synthetic converter failure'); }
        await writeFile(input.output_path, meshFixture());
        return { success: true };
      } finally { active -= 1; }
    },
  });
  const outcomes = [];
  const requests = [];
  const track = (artifactId) => {
    const start = performance.now();
    const promise = service.readMesh({ sourcePath, jobId: 'queue', artifactId }).then(
      (bytes) => ({ artifactId, status: 200, bytes: bytes.length }),
      (error) => ({ artifactId, status: error.status || 500, message: error.message }),
    ).then((value) => { const result = { ...value, elapsed_ms: round(performance.now() - start) }; outcomes.push(result); return result; });
    requests.push(promise); return promise;
  };
  await collectGarbage(); const memory = memoryProbe();
  try {
    track('active'); await until(() => started === 1);
    await collectGarbage(); const activeMemory = memory.sample();
    track('queued-a'); track('queued-b'); track('overflow');
    await until(() => outcomes.length === 1);
    assert.equal(outcomes[0].status, 503);
    await collectGarbage(); const queuedMemory = memory.sample();
    const queuedId = ['queued-a', 'queued-b', 'overflow'].find((id) => id !== outcomes[0].artifactId);
    track(queuedId); // A duplicate shares admitted work even while the queue is full.
    await pause(80);
    assert.equal(started, 1);
    const released = performance.now(); gate.resolve();
    await Promise.all(requests);
    const drainMs = performance.now() - released;
    const recovery = await track('active');
    assert.equal(recovery.status, 200);
    assert.equal(peakActive, 1);
    assert.equal(started, 4, 'three admitted conversions and one failed-source retry; duplicate shares work');
    await service.dispose(); await collectGarbage();
    return { scenario: 'synthetic_queue_failure_recovery', source_mib: 20,
      limits: { concurrent: 1, queued: 2 }, requests: requests.length, conversions: started,
      peak_conversions: peakActive, queue_drain_ms: round(drainMs), outcomes,
      active_held_memory_bytes: activeMemory, queued_held_memory_bytes: queuedMemory,
      memory_bytes: memory.finish() };
  } finally { gate.resolve(); await service.dispose(); await Promise.all(requests); memory.finish(); }
}

async function cancellationProbe(directory) {
  const { createLocalApiServer } = await import('../src/server/local-api-server.js');
  const { buildArtifactManifest } = await import('../lib/artifact-manifest.js');
  let gate = deferred(), entered = 0, conversions = 0;
  const service = createArtifactModelPreviewService({ maxConcurrent: 1, maxQueued: 0,
    async runScript(_script, input) {
      conversions += 1; await gate.promise;
      await writeFile(input.output_path, meshFixture()); return { success: true };
    },
  });
  const { server, jobStore } = createLocalApiServer({ projectRoot: ROOT, jobsDir: join(directory, 'jobs'),
    artifactModelPreviewServiceFactory: () => ({
      readMesh(request) { entered += 1; return service.readMesh(request); }, dispose: () => service.dispose(),
    }),
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function register(name) {
    const job = await jobStore.createJob({ type: 'create' });
    const sourcePath = await jobStore.writeJobFile(job.id, `artifacts/${name}.step`, 'synthetic');
    await writeSyntheticSource(sourcePath, 0.5 * MIB);
    const manifest = await buildArtifactManifest({ projectRoot: ROOT, interface: 'api', command: 'create', status: 'succeeded',
      artifacts: [{ type: 'model.step', path: sourcePath, scope: 'user-facing', stability: 'stable' }] });
    await jobStore.completeJob(job.id, { success: true }, { exports: [sourcePath] }, {}, manifest);
    const response = await fetch(`${base}/jobs/${job.id}/artifacts`);
    return base + (await response.json()).artifacts[0].links.model_preview;
  }
  const outcomes = [];
  const request = (url, controller) => {
    const start = performance.now();
    return fetch(url, { method: 'POST', signal: controller?.signal }).then(async (response) => (
      { status: response.status, bytes: (await response.arrayBuffer()).byteLength }
    ), (error) => ({ error: error.name })).then((result) => {
      const measured = { ...result, elapsed_ms: round(performance.now() - start) }; outcomes.push(measured); return measured;
    });
  };
  try {
    const firstUrl = await register('first'), secondUrl = await register('second');
    const a = new AbortController(), b = new AbortController();
    const first = request(firstUrl, a), second = request(firstUrl, b);
    await until(() => entered === 2 && conversions === 1);
    assert.equal((await request(secondUrl)).status, 503);
    const abortStart = performance.now(); a.abort();
    assert.equal((await first).error, 'AbortError');
    const oneAbortMs = performance.now() - abortStart;
    gate.resolve(); assert.equal((await second).status, 200);
    gate = deferred();
    const c = new AbortController(), d = new AbortController();
    const third = request(secondUrl, c), fourth = request(secondUrl, d);
    await until(() => entered === 5 && conversions === 2);
    c.abort(); d.abort();
    assert.equal((await third).error, 'AbortError'); assert.equal((await fourth).error, 'AbortError');
    const thirdUrl = await register('third');
    assert.equal((await request(thirdUrl)).status, 503, 'all-client disconnect does not release shared work early');
    gate.resolve();
    assert.equal((await request(secondUrl)).status, 200);
    assert.equal(conversions, 2);
    return { scenario: 'synthetic_http_cancellation', source_mib: 0.5, one_client_abort_ms: round(oneAbortMs),
      conversions, outcomes, all_client_disconnect_policy: 'admitted shared work completes; its slot remains occupied until cleanup' };
  } finally {
    gate.resolve(); await service.dispose(); await new Promise((done) => server.close(done));
  }
}

async function runtimeProbe(sourcePath) {
  const { runScript } = await import('../lib/runner.js');
  const info = await stat(sourcePath);
  assert(info.size <= 64 * MIB, 'Benchmark inputs are bounded to 64 MiB');
  const beforeHash = await hashFile(sourcePath);
  let conversions = 0;
  const service = createArtifactModelPreviewService({ runScript(script, input, options) {
    conversions += 1; return runScript(script, input, { ...options, timeout: 20_000 });
  } });
  await collectGarbage(); const memory = memoryProbe(); const misses = [], hits = [];
  let meshBytes = 0, triangles = null;
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (const times of [misses, hits]) {
        const start = performance.now();
        const bytes = await service.readMesh({ sourcePath, jobId: 'native', artifactId: String(cycle) });
        times.push(performance.now() - start); meshBytes = bytes.length;
        triangles = bytes.length >= 84 && bytes.length === 84 + 50 * bytes.readUInt32LE(80) ? bytes.readUInt32LE(80) : null;
        memory.sample();
      }
    }
    assert.equal(conversions, 3);
    assert.equal(await hashFile(sourcePath), beforeHash, 'runtime benchmark must preserve source bytes');
    await service.dispose(); await collectGarbage();
    return { scenario: 'real_freecad_service', source: relative(ROOT, sourcePath), source_bytes: info.size,
      source_sha256: beforeHash, requests: 6, conversions, mesh_bytes: meshBytes, triangles,
      converter_timeout_ms: 20_000, miss: summarize(misses), hit: summarize(hits), memory_bytes: memory.finish() };
  } finally { await service.dispose(); memory.finish(); }
}

async function nativeScaleProbe(directory) {
  const { runScript } = await import('../lib/runner.js');
  const generated = await runScript('preview_benchmark_fixture.py', { output_directory: directory }, { timeout: 20_000 });
  assert.equal(generated.success, true);
  assert.deepEqual(generated.fixtures.map((fixture) => fixture.solids), [1, 64, 256]);
  assert(generated.total_source_bytes <= 64 * MIB);
  const measurements = [];
  for (const fixture of generated.fixtures) {
    const result = await runtimeProbe(fixture.step_path);
    measurements.push({ ...result, source: `generated/boxes_${fixture.solids}.step`, solids: fixture.solids, faces: fixture.faces });
  }
  return { scenario: 'real_freecad_solid_scale', freecad_version: generated.freecad_version,
    fixture: 'disjoint 8 x 6 x 4 mm boxes in a regular grid; synthetic nonmanufacturing workload',
    total_source_bytes: generated.total_source_bytes, sequential: true, measurements };
}

async function worker(spec) {
  await mkdir(join(ROOT, 'tmp/codex'), { recursive: true });
  const directory = await mkdtemp(join(ROOT, 'tmp/codex/preview-probe-'));
  try {
    if (spec.kind === 'cycles') return await fixtureCycles(directory, spec.sizeMiB);
    if (spec.kind === 'queue') return await queueProbe(directory);
    if (spec.kind === 'cancellation') return await cancellationProbe(directory);
    if (spec.kind === 'runtime') return await runtimeProbe(spec.sourcePath);
    if (spec.kind === 'native-scale') return await nativeScaleProbe(directory);
    throw new Error('Unknown benchmark scenario');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function runWorker(spec) {
  return new Promise((done, reject) => {
    const processChild = spawn(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', JSON.stringify(spec)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: spec.kind === 'native-scale' ? 240_000 : 45_000 });
    let stdout = '', stderr = '';
    processChild.stdout.on('data', (chunk) => { stdout += chunk; });
    processChild.stderr.on('data', (chunk) => { stderr += chunk; });
    processChild.on('error', reject);
    processChild.on('close', (code) => {
      if (code !== 0) { reject(new Error(`Benchmark ${spec.kind} exited ${code}: ${stderr.slice(-4000)}`)); return; }
      try { done(JSON.parse(stdout)); } catch (error) { reject(new Error(`Invalid benchmark output: ${error.message}`)); }
    });
  });
}

function requireInside(root, path) {
  const rel = relative(root, path);
  assert(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), 'Benchmark paths must stay inside this repository');
}

async function optionalStat(path) {
  try { return await stat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function canonicalOutput(path) {
  try { return await realpath(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const entry = await lstat(path).catch((failure) => { if (failure.code === 'ENOENT') return null; throw failure; });
    assert(!entry?.isSymbolicLink(), 'Benchmark output contains an unresolved symlink alias');
    const parent = dirname(path);
    assert(parent !== path, 'Benchmark output has no existing parent directory');
    return join(await canonicalOutput(parent), basename(path));
  }
}

const sameFile = (left, right) => Boolean(left && right && left.dev === right.dev && left.ino === right.ino);

async function checkBenchmarkDestination(paths) {
  assert(await realpath(paths.anchor) === paths.anchor && sameFile(await stat(paths.anchor), paths.anchorIdentity),
    'Benchmark output directory changed during the run');
  const output = await canonicalOutput(paths.requestedOutput);
  requireInside(paths.projectRoot, output);
  assert(output === paths.output, 'Benchmark output alias changed during the run');
  const outputIdentity = await optionalStat(output);
  if (paths.sourcePath) {
    const source = await realpath(paths.requestedSource);
    requireInside(paths.projectRoot, source);
    assert(source === paths.sourcePath, 'Benchmark input alias changed during the run');
    assert(output !== source && !sameFile(outputIdentity, await stat(source)), 'Benchmark output must not replace its input or a same file alias');
  }
  assert((!outputIdentity && !paths.outputIdentity) || (sameFile(outputIdentity, paths.outputIdentity)
    && outputIdentity.size === paths.outputIdentity.size && outputIdentity.mtimeMs === paths.outputIdentity.mtimeMs),
  'Benchmark output changed during the run');
}

export async function prepareBenchmarkPaths(projectRoot, output, sourcePath = '') {
  const root = await realpath(projectRoot);
  const requestedOutput = resolve(projectRoot, output);
  const requestedSource = sourcePath ? resolve(projectRoot, sourcePath) : '';
  const destination = await canonicalOutput(requestedOutput);
  requireInside(root, destination);
  const source = requestedSource ? await realpath(requestedSource) : '';
  if (source) requireInside(root, source);
  const outputIdentity = await optionalStat(destination);
  if (source) assert(destination !== source && !sameFile(outputIdentity, await stat(source)),
    'Benchmark output must not replace its input or a same file alias');
  let anchor = dirname(destination);
  while (!await optionalStat(anchor)) anchor = dirname(anchor);
  const anchorIdentity = await stat(anchor);
  assert(anchorIdentity.isDirectory(), 'Benchmark output parent must be a directory');
  return { projectRoot: root, output: destination, sourcePath: source, requestedOutput, requestedSource, anchor, anchorIdentity, outputIdentity };
}

export async function writeBenchmarkReport(paths, report) {
  await checkBenchmarkDestination(paths);
  const directory = dirname(paths.output);
  await mkdir(directory, { recursive: true });
  assert(await realpath(directory) === directory, 'Benchmark output directory changed during the run');
  const directoryIdentity = await stat(directory);
  const temporary = await mkdtemp(join(directory, '.preview-report-'));
  try {
    const staged = join(temporary, 'report.json');
    await writeFile(staged, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    await checkBenchmarkDestination(paths);
    assert(await realpath(directory) === directory && sameFile(await stat(directory), directoryIdentity),
      'Benchmark output directory changed during the run');
    // Rename replaces the directory entry; it never follows a late leaf symlink.
    await rename(staged, paths.output);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function main(args) {
  if (args[0] === '--worker') {
    const spec = JSON.parse(args[1]);
    if (spec.kind === 'cycles') assert(SIZES_MIB.includes(spec.sizeMiB));
    process.stdout.write(`${JSON.stringify(await worker(spec))}\n`); return;
  }
  if (args.includes('--help')) {
    console.log('Usage: node scripts/studio-preview-benchmark.js [--out tmp/codex/preview.json] [--native-scale] [--runtime-input <repo-owned STEP/BREP>]');
    return;
  }
  let output = resolve(ROOT, 'tmp/codex/studio-preview-envelope.json'), sourcePath = '', nativeScale = false;
  for (let i = 0; i < args.length; i += 1) {
    const option = args[i];
    if (option === '--native-scale') { nativeScale = true; continue; }
    if (!args[i + 1]) throw new Error(`Missing value for ${option}`);
    if (option === '--out') output = resolve(ROOT, args[++i]);
    else if (option === '--runtime-input') sourcePath = resolve(ROOT, args[++i]);
    else throw new Error(`Unknown argument: ${option}`);
  }
  const paths = await prepareBenchmarkPaths(ROOT, output, sourcePath);
  const scenarios = SIZES_MIB.map((sizeMiB) => ({ kind: 'cycles', sizeMiB }));
  scenarios.push({ kind: 'queue' }, { kind: 'cancellation' });
  if (paths.sourcePath) scenarios.push({ kind: 'runtime', sourcePath: paths.sourcePath });
  if (nativeScale) scenarios.push({ kind: 'native-scale' });
  const results = [];
  for (const spec of scenarios) {
    const result = await runWorker(spec); results.push(result);
    console.log(`${result.scenario}${spec.sizeMiB ? ` ${spec.sizeMiB} MiB` : ''}: complete`);
  }
  const report = { schema_version: 1, recorded_at: new Date().toISOString(), host: hostname(),
    platform: `${platform()} ${release()}`, node: process.version,
    method: { fresh_child_per_scenario: true, explicit_gc: true, memory_sample_ms: 5, worker_timeout_ms: 45_000, native_scale_timeout_ms: 240_000,
      fixture_geometry_validated: false, source_sizes_mib: SIZES_MIB, cycles_per_size: CYCLES,
      not_measured: ['GPU memory', 'FreeCAD subprocess RSS', 'browser rendering', 'OS-cache-cold I/O', 'production tail percentiles', 'long soak', 'cross-platform behavior'] },
    results };
  await writeBenchmarkReport(paths, report);
  console.log(`Saved ${relative(ROOT, output)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}

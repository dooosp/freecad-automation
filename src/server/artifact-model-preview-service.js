import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { runScript as defaultRunner } from '../../lib/runner.js';

const MODEL_EXTENSIONS = new Set(['.step', '.stp', '.brep', '.brp', '.stl']);
const failure = (message, status) => Object.assign(new Error(message), { status });
const changedSource = () => failure('The source artifact changed during preview generation. Open the result again.', 409);

async function sourceHash(sourcePath, snapshotPath = '') {
  const hash = createHash('sha256');
  const source = createReadStream(sourcePath);
  if (snapshotPath) {
    await pipeline(source, new Transform({
      transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); },
    }), createWriteStream(snapshotPath, { flags: 'wx' }));
  } else {
    for await (const chunk of source) hash.update(chunk);
  }
  return hash.digest('hex');
}

// The route resolves job authority before every call, even on a cache hit.
// Only derived meshes are cached. Original CAD and quality evidence stay untouched.
export function createArtifactModelPreviewService({
  runScript = defaultRunner,
  maxPreviewBytes = 32 * 1024 * 1024,
  maxEntries = 6,
  maxConcurrent = 2,
  maxQueued = 8,
} = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1
    || !Number.isSafeInteger(maxQueued) || maxQueued < 0) {
    throw new RangeError('Model preview limits require a positive concurrency and a nonnegative queue size.');
  }
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;
  let closed = false;

  function acquireSlot() {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    if (queue.length >= maxQueued) {
      return Promise.reject(failure('Model preview is busy. Try opening the result again shortly.', 503));
    }
    return new Promise((resolve, reject) => queue.push({ resolve, reject }));
  }

  function releaseSlot() {
    const next = queue.shift();
    if (next) next.resolve(); // Hand the occupied slot directly to the oldest waiter.
    else active -= 1;
  }

  function checkSize(bytes) {
    if (bytes.length > maxPreviewBytes) throw failure('3D preview exceeds the mesh size limit; download the CAD file to inspect it.', 413);
    if (!bytes.length) throw failure('The model preview is empty.', 422);
  }

  return {
    async readMesh({ sourcePath, jobId, artifactId }) {
      if (closed) throw failure('Model preview service is closed.', 503);
      const extension = extname(sourcePath).toLowerCase();
      if (!MODEL_EXTENSIONS.has(extension)) throw failure('This artifact format has no 3D preview.', 403);
      if (extension === '.stl') {
        const source = await readFile(sourcePath);
        if (closed) throw failure('Model preview service is closed.', 503);
        checkSize(source); return source;
      }
      // Cache lookup and queued requests need a content hash, not a retained CAD buffer.
      const requestedHash = await sourceHash(sourcePath);
      if (closed) throw failure('Model preview service is closed.', 503);
      const key = `${jobId}:${artifactId}:${requestedHash}`;
      if (cache.has(key)) return cache.get(key);
      if (pending.has(key)) return pending.get(key);
      const conversion = (async () => {
        // Shared conversions retain their slot if HTTP clients disconnect.
        // A single client's cancellation must not abort another client's mesh.
        await acquireSlot();
        let directory;
        try {
          if (closed) throw failure('Model preview service is closed.', 503);
          directory = await mkdtemp(join(tmpdir(), 'fcad-artifact-mesh-'));
          const inputPath = join(directory, `source${extension}`);
          const outputPath = join(directory, 'preview.stl');
          // Only admitted work creates a snapshot. Recheck queued or mid-copy changes
          // before invoking native conversion, then check the live source afterward.
          if (await sourceHash(sourcePath, inputPath) !== requestedHash) throw changedSource();
          if (closed) throw failure('Model preview service is closed.', 503);
          const result = await runScript('preview_model.py', { file: inputPath, output_path: outputPath }, { timeout: 120_000 });
          if (!result?.success) throw failure(result?.error || 'Model preview generation failed.', 422);
          const bytes = await readFile(outputPath);
          checkSize(bytes);
          if (await sourceHash(sourcePath) !== requestedHash) throw changedSource();
          if (!closed) {
            cache.set(key, bytes);
            while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
          }
          return bytes;
        } finally {
          try {
            if (directory) await rm(directory, { recursive: true, force: true });
          } finally { releaseSlot(); }
        }
      })();
      pending.set(key, conversion);
      try { return await conversion; }
      finally { pending.delete(key); }
    },
    async dispose() {
      closed = true;
      cache.clear();
      for (const waiter of queue.splice(0)) waiter.reject(failure('Model preview service is closed.', 503));
      await Promise.allSettled(pending.values());
    },
  };
}

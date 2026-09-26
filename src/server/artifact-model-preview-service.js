import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { runScript as defaultRunner } from '../../lib/runner.js';

const MODEL_EXTENSIONS = new Set(['.step', '.stp', '.brep', '.brp', '.stl']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const failure = (message, status) => Object.assign(new Error(message), { status });

// The route resolves job authority before every call, even on a cache hit.
// Only derived meshes are cached. Original CAD and quality evidence stay untouched.
export function createArtifactModelPreviewService({
  runScript = defaultRunner,
  maxPreviewBytes = 32 * 1024 * 1024,
  maxEntries = 6,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let closed = false;

  function checkSize(bytes) {
    if (bytes.length > maxPreviewBytes) throw failure('3D preview exceeds the mesh size limit; download the CAD file to inspect it.', 413);
    if (!bytes.length) throw failure('The model preview is empty.', 422);
  }

  return {
    async readMesh({ sourcePath, jobId, artifactId }) {
      if (closed) throw failure('Model preview service is closed.', 503);
      const extension = extname(sourcePath).toLowerCase();
      if (!MODEL_EXTENSIONS.has(extension)) throw failure('This artifact format has no 3D preview.', 403);
      const source = await readFile(sourcePath);
      if (closed) throw failure('Model preview service is closed.', 503);
      if (extension === '.stl') { checkSize(source); return source; }
      const sourceHash = digest(source);
      const key = `${jobId}:${artifactId}:${sourceHash}`;
      if (cache.has(key)) return cache.get(key);
      if (pending.has(key)) return pending.get(key);
      const conversion = (async () => {
        const directory = await mkdtemp(join(tmpdir(), 'fcad-artifact-mesh-'));
        try {
          const inputPath = join(directory, `source${extension}`);
          const outputPath = join(directory, 'preview.stl');
          await writeFile(inputPath, source);
          const result = await runScript('preview_model.py', { file: inputPath, output_path: outputPath }, { timeout: 120_000 });
          if (!result?.success) throw failure(result?.error || 'Model preview generation failed.', 422);
          const bytes = await readFile(outputPath);
          checkSize(bytes);
          if (digest(await readFile(sourcePath)) !== sourceHash) {
            throw failure('The source artifact changed during preview generation. Open the result again.', 409);
          }
          if (!closed) {
            cache.set(key, bytes);
            while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
          }
          return bytes;
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      })();
      pending.set(key, conversion);
      try { return await conversion; }
      finally { pending.delete(key); }
    },
    async dispose() {
      closed = true;
      cache.clear();
      await Promise.allSettled(pending.values());
    },
  };
}

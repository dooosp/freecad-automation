import { parentPort } from 'node:worker_threads';
import { resolveFreeCADRuntime } from '../../lib/paths.js';
import { buildRuntimeDiagnostics } from '../../lib/runtime-diagnostics.js';

parentPort.on('message', () => {
  try {
    // Rediscover each time: an executable or explicit override may have changed.
    const diagnostics = buildRuntimeDiagnostics({ runtime: resolveFreeCADRuntime() });
    parentPort.postMessage({ ok: true, diagnostics });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: error.message || 'Runtime diagnostics failed.' });
  }
});

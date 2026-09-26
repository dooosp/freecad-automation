import { Worker, SHARE_ENV } from 'node:worker_threads';

export function createRuntimeDiagnosticsService({
  workerFactory = () => new Worker(new URL('./runtime-diagnostics-worker.js', import.meta.url), { env: SHARE_ENV }),
  timeoutMs = 20_000,
} = {}) {
  let worker = null;
  let pending = null;
  let closed = false;

  function settle(activeWorker, error, diagnostics) {
    if (pending?.worker !== activeWorker) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    activeWorker.unref();
    if (error) current.reject(error);
    else current.resolve(diagnostics);
  }

  function discard(activeWorker, error) {
    if (worker === activeWorker) worker = null;
    settle(activeWorker, error);
    activeWorker.terminate().catch(() => {});
  }

  function ensureWorker() {
    if (worker) return worker;
    const activeWorker = workerFactory();
    worker = activeWorker;
    activeWorker.on('message', (message) => {
      settle(activeWorker, message.ok ? null : new Error(message.error || 'Runtime diagnostics failed.'), message.diagnostics);
    });
    activeWorker.on('error', (error) => discard(activeWorker, error));
    activeWorker.on('exit', () => {
      if (worker === activeWorker) worker = null;
      settle(activeWorker, new Error('Runtime diagnostics worker exited.'));
    });
    activeWorker.unref();
    return activeWorker;
  }

  return {
    read() {
      if (closed) return Promise.reject(new Error('Runtime diagnostics service is closed.'));
      // Coalesce only an active probe. Completed results are never cached.
      if (pending) return pending.promise;
      let activeWorker;
      try { activeWorker = ensureWorker(); }
      catch (error) { return Promise.reject(error); }
      let resolve;
      let reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      pending = {
        promise, resolve, reject, worker: activeWorker,
        timer: setTimeout(() => discard(activeWorker, new Error('Runtime diagnostics timed out.')), timeoutMs),
      };
      activeWorker.ref();
      try { activeWorker.postMessage({ type: 'probe' }); }
      catch (error) { discard(activeWorker, error); }
      return promise;
    },
    async dispose() {
      closed = true;
      const activeWorker = worker;
      worker = null;
      if (activeWorker) {
        settle(activeWorker, new Error('Runtime diagnostics service is closed.'));
        await activeWorker.terminate();
      }
    },
  };
}

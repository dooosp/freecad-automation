import { parentPort, workerData } from 'node:worker_threads';
let calls = 0;
parentPort.on('message', () => {
  if (workerData?.mode === 'crash') throw new Error('Synthetic probe worker crash');
  if (workerData?.mode === 'exit') process.exit(0);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData?.delayMs ?? 120);
  calls += 1;
  parentPort.postMessage({ ok: true, diagnostics: { calls, available: calls % 2 === 0 } });
});

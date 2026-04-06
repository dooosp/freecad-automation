import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const port = 34000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForFetch(url, { attempts = 30, delayMs = 200 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url} returned ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await delay(delayMs);
      }
    }
  }
  throw lastError;
}

const child = spawn(process.execPath, ['bin/serve-legacy.js', String(port)], {
  cwd: ROOT,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  const homeResponse = await waitForFetch(`${baseUrl}/`);
  const homeHtml = await homeResponse.text();
  assert.match(homeHtml, /FreeCAD Classic Viewer/);
  assert.match(homeHtml, /Classic compatibility mode/);
  assert.match(homeHtml, /fcad serve/);
  assert.match(homeHtml, /id="config-editor"/);
  assert.match(homeHtml, /\/js\/viewer\.js/);

  const examplesResponse = await waitForFetch(`${baseUrl}/api/examples`);
  const examplesPayload = await examplesResponse.json();
  assert.equal(Array.isArray(examplesPayload), true);
  assert.equal(examplesPayload.length > 0, true);
  assert.deepEqual(Object.keys(examplesPayload[0]).sort(), ['content', 'id', 'name']);
  assert.equal(typeof examplesPayload[0].id, 'string');
  assert.equal(typeof examplesPayload[0].name, 'string');
  assert.equal('path' in examplesPayload[0], false);
  assert.equal(JSON.stringify(examplesPayload).includes('/configs/examples/'), false);

  const cssResponse = await waitForFetch(`${baseUrl}/css/style.css`);
  const cssText = await cssResponse.text();
  assert.match(cssText, /\.layout/);
  assert.match(stdout, /FreeCAD Legacy Viewer \(compatibility mode\): http:\/\/localhost:/);
  assert.match(stderr, /compatibility-only legacy viewer shell/);

  console.log('legacy-serve-smoke.test.js: ok');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'close'),
    delay(2000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
  assert.equal(stderr.includes('Error:'), false, stderr);
}

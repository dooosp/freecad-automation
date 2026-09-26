import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createLocalApiServer } from '../src/server/local-api-server.js';
import { toPublicJobRequest } from '../src/server/public-job-request.js';

let server;
let root;
let port;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'fcad-access-boundary-'));
  ({ server } = createLocalApiServer({ projectRoot: resolve(import.meta.dirname, '..'), jobsDir: join(root, 'jobs') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
});
after(async () => {
  await new Promise((done) => server.close(done));
  await rm(root, { recursive: true, force: true });
});

function call({ host = `127.0.0.1:${port}`, origin, method = 'GET', body } = {}) {
  return new Promise((done, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/jobs', method,
      headers: { Host: host, ...(origin === undefined ? {} : { Origin: origin }), 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => done({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('local CLI and same-origin Studio can read job history', async () => {
  assert.equal((await call()).status, 200);
  assert.equal((await call({ host: `localhost:${port}`, origin: `http://localhost:${port}` })).status, 200);
});

test('an attacker-controlled Host cannot read the loopback API', async () => {
  for (const host of [`audit.invalid:${port}`, `localhost.audit.invalid:${port}`, `127.0.0.1:${port + 1}`]) {
    const response = await call({ host });
    assert.equal(response.status, 403, host);
    assert.equal(response.body.ok, false);
  }
});

test('foreign and opaque origins are rejected before parsing or scheduling', async () => {
  for (const origin of ['https://audit.invalid', 'null', `http://127.0.0.1:${port + 1}`]) {
    assert.equal((await call({ origin, method: 'POST', body: '{broken' })).status, 403, origin);
    assert.equal((await call({ origin })).status, 403, origin);
  }
  assert.equal((await call({ origin: `http://127.0.0.1:${port}`, method: 'POST', body: '{broken' })).status, 400);
  assert.deepEqual((await call()).body.jobs, []);
});

test('nested public config text cannot expose absolute paths or mutate the internal request', () => {
  const draft = '[import]\nsource_step = "/Users/private/customer/model.step"\n';
  const input = { type: 'review-context', options: { bootstrap: { draft_config_toml: draft },
    notes: ['Input C:\\Users\\private\\model.step failed'] } };
  const result = toPublicJobRequest(input);
  assert.doesNotMatch(JSON.stringify(result), /private|\/Users\/|C:\\\\Users/);
  assert.equal(input.options.bootstrap.draft_config_toml, draft);
  assert.match(result.options.bootstrap.draft_config_toml, /model\.step/);
});

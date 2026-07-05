import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { buildRuntimeFingerprint } from '../src/services/runtime/runtime-fingerprint-service.js';

test('buildRuntimeFingerprint records repo and runtime identity without production claims', () => {
  const fingerprint = buildRuntimeFingerprint({
    repo: { branch: 'master', head_sha: '8d2cd8d4186686bfa5ce0a78b909fc5852db22a3', dirty_at_start: false },
    runtime: { freecad_status: 'ready', freecad_version: '1.1.1', platform: 'darwin' },
    commands: ['create', 'draw', 'inspect'],
  });
  assert.equal(fingerprint.schema_version, '1.0');
  assert.equal(fingerprint.production_readiness_claim, false);
  assert.equal(fingerprint.runtime.freecad_version, '1.1.1');
});

test('runtime fingerprint satisfies its JSON schema boundary', () => {
  const fingerprint = buildRuntimeFingerprint({
    repo: { branch: 'master', head_sha: '8d2cd8d4186686bfa5ce0a78b909fc5852db22a3', dirty_at_start: false },
    runtime: {
      freecad_status: 'ready',
      freecad_version: '1.1.1',
      freecad_executable_detected: true,
      platform: 'darwin',
    },
    commands: ['create', 'draw', 'inspect'],
    generatedAt: '2026-07-04T00:00:00.000Z',
  });
  const schemaPath = resolve(import.meta.dirname, '..', 'schemas', 'runtime-fingerprint.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  assert.equal(
    validate(fingerprint),
    true,
    `runtime fingerprint should satisfy schema: ${ajv.errorsText(validate.errors)}`
  );
  assert.match(fingerprint.evidence_boundary, /local execution context only/);
});

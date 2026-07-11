import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin/fcad.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

const help = run(['inspection-evidence-quarantine', '--help']);
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /content-addressed local quarantine/i);

const traversal = run([
  'inspection-evidence-validate',
  '--record', '../outside/onboarding-record.json',
  '--actor', 'test.fixture.reviewer',
]);
assert.equal(traversal.status, 1);
assert.match(traversal.stderr, /unsafe_path/);

const unauthorizedAttach = run([
  'inspection-evidence-attach',
  '--record', 'local/inspection-evidence-quarantine/missing/onboarding-record.json',
  '--actor', 'test.fixture.authorizer',
]);
assert.equal(unauthorizedAttach.status, 1);
assert.match(unauthorizedAttach.stderr, /attachment_failed|ENOENT/i);

const qif = run([
  'inspection-evidence-quarantine',
  '--candidate', 'docs/examples/plate-with-holes/inspection/qif_lite_focused_checks.xml',
  '--envelope', 'tests/fixtures/inspection-evidence-onboarding/synthetic-envelope.json',
  '--package', 'plate-with-holes',
  '--revision', 'A',
  '--actor', 'test.fixture.receiver',
]);
assert.equal(qif.status, 2, `${qif.stdout}\n${qif.stderr}`);
assert.match(qif.stdout, /State: rejected/);
assert.match(qif.stdout, /Canonical evidence attached: no/);
assert.match(qif.stdout, /Canonical readiness regenerated: no/);
const recordMatch = qif.stdout.match(/Inspection evidence quarantine record: (.+onboarding-record\.json)/);
assert(recordMatch, qif.stdout);
rmSync(dirname(resolve(ROOT, recordMatch[1])), { recursive: true, force: true });

const prematureReadiness = run([
  'inspection-evidence-regenerate-readiness',
  '--attachment-record', 'docs/examples/plate-with-holes/inspection/inspection_evidence_attachment.json',
  '--authorization', 'tests/fixtures/inspection-evidence-onboarding/synthetic-envelope.json',
  '--review-pack', 'docs/examples/plate-with-holes/review/review_pack.json',
  '--out', 'output/should-not-exist-readiness.json',
]);
assert.equal(prematureReadiness.status, 1);
assert.match(prematureReadiness.stderr, /attachment|regeneration_failed|ENOENT/i);

console.log('inspection-evidence-onboarding-cli.test.js: ok');

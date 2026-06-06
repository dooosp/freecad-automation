import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEFAULT_MAINTAINER_DOCTOR_OUT_DIR,
  MAINTAINER_DOCTOR_CHECKS,
  REQUIRED_MAINTAINER_DOCTOR_SCRIPTS,
  findSensitiveLeakage,
  runMaintainerDoctor,
} from '../lib/maintainer-doctor.js';

const ROOT = resolve(import.meta.dirname, '..');
const outDirRel = `output/test-maintainer-doctor-${process.pid}`;
const outDir = join(ROOT, outDirRel);

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const doctorScript = readFileSync(join(ROOT, 'scripts', 'maintainer-doctor.js'), 'utf8');

try {
  assert.equal(DEFAULT_MAINTAINER_DOCTOR_OUT_DIR, 'output/maintainer-doctor');
  assert.equal(
    packageJson.scripts['maintainer:doctor'],
    'node scripts/maintainer-doctor.js'
  );
  Object.entries(REQUIRED_MAINTAINER_DOCTOR_SCRIPTS).forEach(([scriptName, command]) => {
    assert.equal(packageJson.scripts[scriptName], command, `${scriptName} should stay discoverable`);
  });

  [
    /\bnpm\s+publish\b/,
    /\bgh\s+release\b/,
    /\bgit\s+tag\b/,
    /\bgit\s+push\s+--tags\b/,
    /\bupload-artifact\b/,
    /\breadiness-pack\b.*--out\s+docs\/examples/s,
    /\breview-context\b.*--inspection-evidence/s,
  ].forEach((pattern) => {
    assert.doesNotMatch(doctorScript, pattern, `maintainer doctor must not contain production/release/evidence mutation: ${pattern}`);
  });

  const checkById = new Map(MAINTAINER_DOCTOR_CHECKS.map((check) => [check.id, check]));
  [
    'source_hygiene',
    'stage5b_pipeline_doctor',
    'release_dry_run_doctor',
    'node_contract_discoverability',
    'docs_source_of_truth',
    'stage5b_source_of_truth_guard',
    'stage5b_artifact_catalog_guard',
    'generated_output_policy',
    'workflow_check_name_drift',
    'overclaim_guard',
  ].forEach((id) => assert(checkById.has(id), `missing maintainer doctor check ${id}`));

  assert.deepEqual(checkById.get('source_hygiene').argv, ['npm', 'run', 'check:source-hygiene']);
  assert.deepEqual(checkById.get('stage5b_pipeline_doctor').argv, ['npm', 'run', 'test:stage5b:pipeline-doctor']);
  assert.deepEqual(checkById.get('release_dry_run_doctor').argv, ['npm', 'run', 'release:dry-run:doctor', '--', '--clean']);
  assert.equal(
    MAINTAINER_DOCTOR_CHECKS.some((check) => check.argv.join(' ').includes('test:runtime-smoke')),
    false,
    'runtime smoke should remain explicit self-hosted/local guidance, not a default maintainer doctor side effect'
  );

  const commandCalls = [];
  const result = await runMaintainerDoctor({
    projectRoot: ROOT,
    outDir: outDirRel,
    clean: true,
    includeGithub: false,
    now: () => '2026-06-06T00:00:00.000Z',
    runCommand: async (check) => {
      commandCalls.push(check.id);
      return {
        command: check.argv,
        status: 0,
        stdout: `${check.id}: ok`,
        stderr: '',
        duration_ms: 1,
      };
    },
  });

  assert.equal(
    result.exitCode,
    0,
    JSON.stringify({
      summary: result.report.summary,
      preflight: result.report.preflight,
      static_checks: result.report.static_checks,
    }, null, 2)
  );
  assert.deepEqual(commandCalls, MAINTAINER_DOCTOR_CHECKS.filter((check) => check.mode === 'run').map((check) => check.id));
  assert.equal(existsSync(join(outDir, 'maintainer_doctor_report.json')), true);

  const report = JSON.parse(readFileSync(join(outDir, 'maintainer_doctor_report.json'), 'utf8'));
  assert.equal(report.artifact_type, 'maintainer_doctor_report');
  assert.equal(report.generated_at, '2026-06-06T00:00:00.000Z');
  assert.equal(report.output_dir, outDirRel);
  assert.equal(report.boundary.local_only, true);
  assert.equal(report.boundary.network_required, false);
  assert.equal(report.boundary.published_release, false);
  assert.equal(report.boundary.git_tag_created, false);
  assert.equal(report.boundary.artifacts_uploaded, false);
  assert.equal(report.boundary.inspection_evidence_attached, false);
  assert.equal(report.boundary.canonical_readiness_regenerated, false);
  assert.equal(report.current_repo_truth.stage5b_held, true);
  assert.equal(report.current_repo_truth.real_inspection_evidence_attached, false);
  assert.equal(report.current_repo_truth.release_published, false);
  assert.equal(report.current_repo_truth.ci_governance_docs_present, true);
  assert.match(report.current_repo_truth.runtime_smoke_truth, /self-hosted|local/i);
  assert.match(report.current_repo_truth.runtime_smoke_truth, /not production proof/i);
  assert.equal(report.github_metadata.mode, 'skipped');
  assert.equal(report.summary.decision, 'pass');
  assert.equal(report.summary.failed_check_count, 0);
  assert.equal(report.summary.blocker_count, 0);
  assert.equal(report.static_checks.required_scripts.status, 'pass');
  assert.equal(report.static_checks.generated_output_policy.status, 'pass');
  assert.equal(report.static_checks.raw_inbox_leakage.status, 'pass');
  assert.equal(report.static_checks.sensitive_leakage.status, 'pass');

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('/Users/'), false, 'report should not expose local user paths');
  assert.equal(serialized.includes('/private/'), false, 'report should not expose private temp paths');
  assert.equal(serialized.includes('gho_'), false, 'report should not expose GitHub tokens');

  const leakage = findSensitiveLeakage([
    {
      path: 'src/example.js',
      text: `const token = "${['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_')}";\n`,
    },
    {
      path: 'docs/example.md',
      text: 'local file was /Users/someone/private/source.csv\n',
    },
    {
      path: 'tests/redaction-fixture.test.js',
      text: 'FREECAD_BIN=/private/tmp/freecad-secret/FreeCADCmd\n',
    },
  ]);
  assert.deepEqual(
    leakage.map((entry) => [entry.path, entry.kind]).sort(),
    [
      ['docs/example.md', 'absolute_private_path'],
      ['src/example.js', 'token_or_secret'],
    ]
  );

  console.log('maintainer-doctor.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

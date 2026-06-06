import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  BOOTSTRAP_DOCTOR_COMMANDS,
  DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR,
  REQUIRED_BOOTSTRAP_DOCTOR_SCRIPTS,
  findDocsLocalStateDependencies,
  findMissingDocumentedNpmScripts,
  runBootstrapDoctor,
} from '../lib/bootstrap-doctor.js';

const ROOT = resolve(import.meta.dirname, '..');
const outDirRel = `output/test-bootstrap-doctor-${process.pid}`;
const outDir = join(ROOT, outDirRel);

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const doctorScript = readFileSync(join(ROOT, 'scripts', 'bootstrap-doctor.js'), 'utf8');

try {
  assert.equal(DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR, 'output/bootstrap-doctor');
  assert.equal(packageJson.scripts['bootstrap:doctor'], 'node scripts/bootstrap-doctor.js');
  Object.entries(REQUIRED_BOOTSTRAP_DOCTOR_SCRIPTS).forEach(([scriptName, command]) => {
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
    assert.doesNotMatch(doctorScript, pattern, `bootstrap doctor must not contain production/release/evidence mutation: ${pattern}`);
  });

  const commandById = new Map(BOOTSTRAP_DOCTOR_COMMANDS.map((command) => [command.id, command]));
  [
    'npm_ci',
    'local_cli_help',
    'source_hygiene',
    'maintainer_doctor_clean',
    'release_dry_run_doctor_clean',
    'stage5b_pipeline_doctor',
  ].forEach((id) => assert(commandById.has(id), `missing bootstrap doctor command ${id}`));

  assert.deepEqual(commandById.get('npm_ci').argv, ['npm', 'ci']);
  assert.deepEqual(commandById.get('local_cli_help').argv, ['node', 'bin/fcad.js', '--help']);
  assert.deepEqual(commandById.get('source_hygiene').argv, ['npm', 'run', 'check:source-hygiene']);
  assert.deepEqual(commandById.get('maintainer_doctor_clean').argv, ['npm', 'run', 'maintainer:doctor', '--', '--clean', '--out-dir', 'output/bootstrap-doctor/maintainer-doctor']);
  assert.deepEqual(commandById.get('release_dry_run_doctor_clean').argv, ['npm', 'run', 'release:dry-run:doctor', '--', '--clean', '--out-dir', 'output/bootstrap-doctor/release-dry-run-doctor/quality-pass-bracket']);
  assert.deepEqual(commandById.get('stage5b_pipeline_doctor').argv, ['npm', 'run', 'test:stage5b:pipeline-doctor']);

  const commandCalls = [];
  const result = await runBootstrapDoctor({
    projectRoot: ROOT,
    outDir: outDirRel,
    clean: true,
    now: () => '2026-06-06T00:00:00.000Z',
    runCommand: async (command) => {
      commandCalls.push(command.id);
      return {
        command: command.argv,
        status: 0,
        stdout: `${command.id}: ok`,
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
      docs_alignment: result.report.docs_alignment,
      prerequisites: result.report.prerequisites,
    }, null, 2)
  );
  assert.deepEqual(commandCalls, BOOTSTRAP_DOCTOR_COMMANDS.map((command) => command.id));
  assert.equal(existsSync(join(outDir, 'bootstrap_doctor_report.json')), true);

  const report = JSON.parse(readFileSync(join(outDir, 'bootstrap_doctor_report.json'), 'utf8'));
  assert.equal(report.artifact_type, 'bootstrap_doctor_report');
  assert.equal(report.generated_at, '2026-06-06T00:00:00.000Z');
  assert.equal(report.output_dir, outDirRel);
  assert.equal(report.boundary.local_only, true);
  assert.equal(report.boundary.production_called, false);
  assert.equal(report.boundary.published_release, false);
  assert.equal(report.boundary.git_tag_created, false);
  assert.equal(report.boundary.artifacts_uploaded, false);
  assert.equal(report.boundary.inspection_evidence_attached, false);
  assert.equal(report.boundary.canonical_readiness_regenerated, false);
  assert.equal(report.prerequisites.package_manager, 'npm');
  assert.equal(report.prerequisites.lockfile, 'package-lock.json');
  assert.equal(report.docs_alignment.status, 'pass');
  assert.equal(report.docs_alignment.missing_documented_npm_scripts.length, 0);
  assert.equal(report.docs_alignment.local_state_dependency_count, 0);
  assert.equal(report.static_checks.sensitive_leakage.status, 'pass');
  assert.equal(report.static_checks.generated_output_policy.status, 'pass');
  assert.equal(report.summary.decision, 'pass');
  assert.equal(report.summary.failed_check_count, 0);
  assert.match(report.summary.next_maintainer_action, /review output\/bootstrap-doctor\/bootstrap_doctor_report\.json/i);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('/Users/'), false, 'report should not expose local user paths');
  assert.equal(serialized.includes('/private/'), false, 'report should not expose private temp paths');
  assert.equal(serialized.includes('gho_'), false, 'report should not expose GitHub tokens');

  assert.deepEqual(
    findMissingDocumentedNpmScripts({
      packageScripts: { known: 'node known.js', test: 'node test.js' },
      docs: [
        {
          path: 'docs/onboarding.md',
          text: 'Run `npm run known`, then `npm run missing`, then `npm test`.\n',
        },
      ],
    }),
    [
      {
        path: 'docs/onboarding.md',
        line: 1,
        script: 'missing',
      },
    ]
  );

  assert.deepEqual(
    findDocsLocalStateDependencies([
      {
        path: 'docs/onboarding.md',
        text: [
          'See [private inbox](../local/stage5b-candidate-evidence-inbox/pkg/source.json).',
          'Then run `cat output/bootstrap-doctor/bootstrap_doctor_report.json`.',
        ].join('\n'),
      },
    ]).map((entry) => [entry.path, entry.line, entry.kind]),
    [
      ['docs/onboarding.md', 1, 'markdown_link_to_ignored_local_path'],
      ['docs/onboarding.md', 2, 'command_reads_ignored_output'],
    ]
  );

  console.log('bootstrap-doctor.test.js: ok');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

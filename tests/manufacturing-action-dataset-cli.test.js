import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { CLI_DISPATCH_COMMANDS } from '../bin/fcad.js';
import {
  LOCAL_API_JOB_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  STUDIO_JOB_COMMANDS,
  getCommandEntry,
  renderCliAllUsage,
  renderCliUsage,
  renderCommandUsage,
} from '../src/shared/command-manifest.js';
import { getExpectedPackageScripts, getLaneManifest } from './lane-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const GENERATED_AT = '2026-07-28T00:00:00.000Z';
const OUTPUT_ROOT_REF = `output/test-manufacturing-action-dataset-cli-${process.pid}`;
const OUTPUT_ROOT = join(ROOT, OUTPUT_ROOT_REF);
const DOCTOR_DATASET_REF = `${OUTPUT_ROOT_REF}/dataset`;
const CLI_DATASET_REF = `${OUTPUT_ROOT_REF}/cli-dataset`;
const EXPECTED_USAGE = 'fcad manufacturing-action-dataset --config <authoritative-config> --review-pack <proof-review-pack> --inspection-plan <proof-inspection-plan> --robot-config <robot-config> --task-plan <task-plan.json> --proof-lineage --generated-at <iso8601> --out-dir <directory>';
const EXPECTED_FILES = Object.freeze([
  'artifact-manifest.json',
  'design_manufacturing_quality_handoff.json',
  'design_manufacturing_quality_handoff.md',
  'manufacturing_action_dictionary.json',
  'manufacturing_data_validation_report.json',
  'manufacturing_episode_annotation.json',
  'manufacturing_robotics_dataset_manifest.json',
  'output-manifest.json',
]);
const DOMAIN_TYPES = Object.freeze({
  'manufacturing_action_dictionary.json': 'manufacturing_action_dictionary',
  'manufacturing_episode_annotation.json': 'manufacturing_episode_annotation',
  'manufacturing_data_validation_report.json': 'manufacturing_data_validation_report',
  'manufacturing_robotics_dataset_manifest.json': 'manufacturing_robotics_dataset_manifest',
  'design_manufacturing_quality_handoff.json': 'design_manufacturing_quality_handoff',
});

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runCli(args) {
  return runNode([CLI, ...args]);
}

function combinedOutput(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function assertRejected(result, pattern, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded:\n${result.stdout}`);
  assert.match(combinedOutput(result), pattern, label);
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function assertExactDataset(directory) {
  assert.deepEqual(readdirSync(directory).sort(), [...EXPECTED_FILES]);
  for (const [filename, artifactType] of Object.entries(DOMAIN_TYPES)) {
    const document = readJson(join(directory, filename));
    assert.equal(document.schema_version, '1.0', `${filename} schema version`);
    assert.equal(document.artifact_type, artifactType, `${filename} artifact type`);
  }
  assert.equal(
    readJson(join(directory, 'manufacturing_data_validation_report.json')).status,
    'valid_synthetic_demo'
  );
}

function assertPortableDataset(directory) {
  for (const filename of EXPECTED_FILES) {
    const text = readFileSync(join(directory, filename), 'utf8');
    assert.equal(text.includes(ROOT), false, `${filename} must not expose the repository path`);
    assert.equal(/\/(?:Users|private|var\/folders)\//.test(text), false, `${filename} must not expose a host path`);
  }
}

function assertByteIdenticalDirectories(leftDirectory, rightDirectory) {
  assert.deepEqual(readdirSync(leftDirectory).sort(), readdirSync(rightDirectory).sort());
  for (const filename of EXPECTED_FILES) {
    assert.deepEqual(
      readFileSync(join(leftDirectory, filename)),
      readFileSync(join(rightDirectory, filename)),
      `fixed-time rerun must be byte-identical for ${filename}`
    );
  }
}

try {
  const entry = getCommandEntry('manufacturing-action-dataset');
  assert(entry, 'manufacturing-action-dataset must be in the command manifest');
  assert.equal(entry.lifecycle, 'experimental');
  assert.equal(entry.defaultHelpVisible, false);
  assert.equal(entry.audience, 'engineer');
  assert.equal(entry.workflow, 'engineering');
  assert.equal(entry.runtime.classification, 'plain-python-node');
  assert.equal(entry.runtime.requiresFreecadRuntime, false);
  assert.deepEqual(entry.surfaces, {
    jobExecutor: true,
    localApi: true,
    studio: true,
    studioSubmission: 'server-profile',
  });
  assert.equal(entry.helpEntries.length, 1);
  assert.equal(entry.helpEntries[0].usage, EXPECTED_USAGE);
  assert.match(entry.safetyBoundary, /synthetic dataset generation only/i);
  assert.match(entry.safetyBoundary, /no robot execution/i);
  assert.match(entry.safetyBoundary, /no.*inspection evidence/i);
  assert.match(entry.safetyBoundary, /no.*product release/i);

  assert.equal(renderCliUsage().includes('manufacturing-action-dataset'), false);
  assert.match(renderCliAllUsage(), new RegExp(EXPECTED_USAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(renderCommandUsage('manufacturing-action-dataset'), /Lifecycle:\s+experimental/);
  assert.match(renderCommandUsage('manufacturing-action-dataset'), /plain-python-node/);
  assert.equal(CLI_DISPATCH_COMMANDS.includes('manufacturing-action-dataset'), true);
  assert.equal(PLAIN_PYTHON_COMMANDS.includes('manufacturing-action-dataset'), true);
  assert.equal(LOCAL_API_JOB_COMMANDS.includes('manufacturing-action-dataset'), true);
  assert.equal(STUDIO_JOB_COMMANDS.includes('manufacturing-action-dataset'), true);

  const defaultHelpRun = runCli(['--help']);
  assert.equal(defaultHelpRun.status, 0, defaultHelpRun.stderr);
  assert.equal(defaultHelpRun.stdout.includes('manufacturing-action-dataset'), false);
  const allHelpRun = runCli(['help', '--all']);
  assert.equal(allHelpRun.status, 0, allHelpRun.stderr);
  assert.match(allHelpRun.stdout, /fcad manufacturing-action-dataset --config/);
  const commandHelpRun = runCli(['help', 'manufacturing-action-dataset']);
  assert.equal(commandHelpRun.status, 0, commandHelpRun.stderr);
  assert.match(commandHelpRun.stdout, /Lifecycle:\s+experimental/);
  assert.match(commandHelpRun.stdout, /FreeCAD and robot execution not used|does not run FreeCAD, control a robot/i);

  assertRejected(
    runCli(['manufacturing-action-dataset', '--proof-lineage=false']),
    /valueless flag/i,
    'assigned proof flag'
  );
  assertRejected(
    runCli(['manufacturing-action-dataset', '--proof-lineage', 'false']),
    /valueless flag/i,
    'separated proof flag value'
  );
  assertRejected(
    runCli(['manufacturing-action-dataset', '--config', 'configs/examples/hinge_block.toml']),
    /requires --proof-lineage/i,
    'missing explicit proof activation'
  );
  assertRejected(
    runCli(['manufacturing-action-dataset', 'unexpected', '--proof-lineage']),
    /does not accept positional arguments/i,
    'positional argument'
  );
  assertRejected(
    runCli(['manufacturing-action-dataset', '--proof-lineage', '--unknown']),
    /does not accept option.*--unknown/i,
    'unsupported option'
  );

  const requiredOptions = Object.freeze({
    config: 'configs/examples/hinge_block.toml',
    'review-pack': `${OUTPUT_ROOT_REF}/proof-inputs/review_pack.json`,
    'inspection-plan': `${OUTPUT_ROOT_REF}/proof-inputs/inspection_plan.json`,
    'robot-config': 'configs/examples/robot_arm_6axis.toml',
    'task-plan': 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    'generated-at': GENERATED_AT,
    'out-dir': CLI_DATASET_REF,
  });
  for (const missingOption of Object.keys(requiredOptions)) {
    const args = ['manufacturing-action-dataset', '--proof-lineage'];
    for (const [key, value] of Object.entries(requiredOptions)) {
      if (key !== missingOption) args.push(`--${key}`, value);
    }
    assertRejected(
      runCli(args),
      new RegExp(`--${missingOption.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} requires a value`, 'i'),
      `missing --${missingOption}`
    );
  }
  const unsafePathArgs = ['manufacturing-action-dataset', '--proof-lineage'];
  for (const [key, value] of Object.entries({ ...requiredOptions, config: '/tmp/outside.toml' })) {
    unsafePathArgs.push(`--${key}`, value);
  }
  const unsafePathRun = runCli(unsafePathArgs);
  assertRejected(unsafePathRun, /unsafe_path:.*repository-relative/i, 'unsafe service input path');
  assert.match(combinedOutput(unsafePathRun), /Stage: schema/);
  assert.match(combinedOutput(unsafePathRun), /Path: \/config_path/);
  assert.match(combinedOutput(unsafePathRun), /Remediation:/);

  const expectedScripts = getExpectedPackageScripts();
  assert.equal(
    expectedScripts['manufacturing-action-dataset:doctor'],
    'node scripts/manufacturing-action-dataset-doctor.js'
  );
  const packageJson = readJson(join(ROOT, 'package.json'));
  assert.equal(
    packageJson.scripts['manufacturing-action-dataset:doctor'],
    expectedScripts['manufacturing-action-dataset:doctor']
  );
  const contractLane = getLaneManifest().find((lane) => lane.id === 'contract');
  assert(
    contractLane.steps.some((step) => step.args.includes('tests/manufacturing-action-dataset-cli.test.js')),
    'contract lane must include the manufacturing action dataset CLI test'
  );

  const doctorHelp = runNode(['scripts/manufacturing-action-dataset-doctor.js', '--help']);
  assert.equal(doctorHelp.status, 0, doctorHelp.stderr);
  assert.match(doctorHelp.stdout, /does not run FreeCAD or a robot/i);
  assert.match(doctorHelp.stdout, /YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss\.sssZ/);
  const doctorWholeSecondHelp = runNode([
    'scripts/manufacturing-action-dataset-doctor.js',
    '--help',
    '--generated-at', '2026-07-28T00:00:00Z',
  ]);
  assert.equal(doctorWholeSecondHelp.status, 0, doctorWholeSecondHelp.stderr);
  const doctorMillisecondHelp = runNode([
    'scripts/manufacturing-action-dataset-doctor.js',
    '--help',
    '--generated-at', '2026-07-28T00:00:00.123Z',
  ]);
  assert.equal(doctorMillisecondHelp.status, 0, doctorMillisecondHelp.stderr);
  assertRejected(
    runNode([
      'scripts/manufacturing-action-dataset-doctor.js',
      '--help',
      '--generated-at', '2026-02-31T00:00:00Z',
    ]),
    /calendar-valid UTC timestamp/i,
    'impossible doctor calendar date'
  );
  assertRejected(
    runNode([
      'scripts/manufacturing-action-dataset-doctor.js',
      '--help',
      '--generated-at', '2026-07-28T00:00:00.1Z',
    ]),
    /YYYY-MM-DDTHH:mm:ss\[\.sss\]Z/i,
    'unsupported doctor fractional precision'
  );
  assertRejected(
    runNode(['scripts/manufacturing-action-dataset-doctor.js', '--out-dir', '/tmp/outside']),
    /portable repo-relative path/i,
    'absolute doctor output'
  );
  assertRejected(
    runNode(['scripts/manufacturing-action-dataset-doctor.js', '--out-dir', 'output/nested/../escape']),
    /portable repo-relative path/i,
    'traversing doctor output'
  );
  assertRejected(
    runNode(['scripts/manufacturing-action-dataset-doctor.js', '--out-dir', 'output\\backslash']),
    /portable repo-relative path/i,
    'backslash doctor output'
  );
  assertRejected(
    runNode(['scripts/manufacturing-action-dataset-doctor.js', '--out-dir', 'output']),
    /child directory under output\/ or tmp\/codex\//i,
    'broad doctor output root'
  );

  const doctorRun = runNode([
    'scripts/manufacturing-action-dataset-doctor.js',
    '--out-dir', OUTPUT_ROOT_REF,
    '--generated-at', GENERATED_AT,
    '--clean',
  ]);
  assert.equal(doctorRun.status, 0, combinedOutput(doctorRun));
  assert.match(doctorRun.stdout, /manufacturing-action-dataset-doctor: ok/);
  assert.match(doctorRun.stdout, /files: 8/);
  assert.match(doctorRun.stdout, /synthetic demo only/);
  assert.match(doctorRun.stdout, /human review required: yes/);

  const proofReviewRef = `${OUTPUT_ROOT_REF}/proof-inputs/review_pack.json`;
  const proofInspectionRef = `${OUTPUT_ROOT_REF}/proof-inputs/inspection_plan.json`;
  assert.equal(existsSync(join(ROOT, proofReviewRef)), true);
  assert.equal(existsSync(join(ROOT, proofInspectionRef)), true);
  const proofReview = readJson(join(ROOT, proofReviewRef));
  const proofInspection = readJson(join(ROOT, proofInspectionRef));
  assert.deepEqual(proofReview.revision_lineage.identity, {
    package_slug: 'hinge-block',
    part_id: 'hinge_block',
    revision: 'A',
    config_sha256: '992cf687e1da65f9ac89c12bd36ad7cd2b57367deb0cc6d50a74d4c03b7a52d1',
  });
  assert.deepEqual(proofInspection.revision_lineage.identity, proofReview.revision_lineage.identity);

  const doctorDataset = join(ROOT, DOCTOR_DATASET_REF);
  assertExactDataset(doctorDataset);
  assertPortableDataset(doctorDataset);

  const cliRun = runCli([
    'manufacturing-action-dataset',
    '--config', 'configs/examples/hinge_block.toml',
    '--review-pack', proofReviewRef,
    '--inspection-plan', proofInspectionRef,
    '--robot-config', 'configs/examples/robot_arm_6axis.toml',
    '--task-plan', 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    '--proof-lineage',
    '--generated-at', GENERATED_AT,
    '--out-dir', CLI_DATASET_REF,
  ]);
  assert.equal(cliRun.status, 0, combinedOutput(cliRun));
  assert.match(cliRun.stdout, /Status: valid_synthetic_demo/);
  assert.match(cliRun.stdout, /FreeCAD and robot execution not used/);
  assert.match(cliRun.stdout, /Human review required: yes/);

  const cliDataset = join(ROOT, CLI_DATASET_REF);
  assertExactDataset(cliDataset);
  assertPortableDataset(cliDataset);
  assertByteIdenticalDirectories(doctorDataset, cliDataset);

  console.log('manufacturing-action-dataset-cli.test.js: ok');
} finally {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
}

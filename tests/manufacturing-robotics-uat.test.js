import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  EXPECTED_PREDICTION_IDS,
  aggregateManufacturingRoboticsUatResults,
  validateManufacturingRoboticsUatResult,
} from '../scripts/manufacturing-robotics-uat-aggregate.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_PATH = resolve(
  ROOT,
  'tests',
  'fixtures',
  'manufacturing-robotics-uat',
  'synthetic-result-template.json'
);
const SCRIPT_PATH = resolve(ROOT, 'scripts', 'manufacturing-robotics-uat-aggregate.js');
const fixtureTemplate = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

function clone(value) {
  return structuredClone(value);
}

function setPredictionScore(record, correctCount, { unreachedLast = false } = {}) {
  record.predictions = EXPECTED_PREDICTION_IDS.map((opportunityId, index) => {
    if (index < correctCount) {
      return { opportunity_id: opportunityId, reached: true, score: 'CORRECT' };
    }
    if (unreachedLast && index === EXPECTED_PREDICTION_IDS.length - 1) {
      return { opportunity_id: opportunityId, reached: false, score: 'UNREACHED' };
    }
    return { opportunity_id: opportunityId, reached: true, score: 'INCORRECT' };
  });
}

function buildSyntheticCohort() {
  const configurations = [
    { label: 'P1', locale: 'en', correct: 8, actions: 4 },
    {
      label: 'P2',
      locale: 'ko',
      correct: 7,
      actions: 4,
      observationFalse: 'revision_mismatch_explained',
    },
    {
      label: 'P3',
      locale: 'en',
      correct: 6,
      actions: 3,
      observationFalse: 'lerobot_gap_explained',
    },
    {
      label: 'P4',
      locale: 'ko',
      correct: 6,
      actions: 5,
      observationFalse: 'action_feature_link_explained',
    },
    {
      label: 'P5',
      locale: 'ko',
      correct: 5,
      actions: 6,
      observationFalse: 'dataset_summary_without_help',
      unreachedLast: true,
    },
  ];

  return configurations.map((configuration) => {
    const record = clone(fixtureTemplate);
    record.participant_label = configuration.label;
    record.attempt_label = configuration.label;
    record.locale = configuration.locale;
    record.observations.completed_path_primary_actions = configuration.actions;
    if (configuration.observationFalse) {
      record.observations[configuration.observationFalse] = false;
    }
    setPredictionScore(record, configuration.correct, {
      unreachedLast: configuration.unreachedLast,
    });
    return record;
  });
}

test('closed result schema accepts the synthetic template and rejects PII-shaped fields', () => {
  assert.deepEqual(validateManufacturingRoboticsUatResult(fixtureTemplate), {
    ok: true,
    errors: [],
  });

  const withName = clone(fixtureTemplate);
  withName.name = 'Do not collect names';
  const nameValidation = validateManufacturingRoboticsUatResult(withName);
  assert.equal(nameValidation.ok, false);
  assert.equal(
    nameValidation.errors.some(
      (entry) => entry.keyword === 'additionalProperties' && entry.path === '/'
    ),
    true
  );

  const withNestedNote = clone(fixtureTemplate);
  withNestedNote.observations.free_form_note = 'not allowed';
  const noteValidation = validateManufacturingRoboticsUatResult(withNestedNote);
  assert.equal(noteValidation.ok, false);
  assert.equal(
    noteValidation.errors.some((entry) => entry.keyword === 'additionalProperties'),
    true
  );

  const withoutConsent = clone(fixtureTemplate);
  withoutConsent.protocol.anonymous_notes_consent = false;
  assert.equal(validateManufacturingRoboticsUatResult(withoutConsent).ok, false);

  const invalidWithoutReason = clone(fixtureTemplate);
  invalidWithoutReason.protocol.valid_attempt = false;
  assert.equal(validateManufacturingRoboticsUatResult(invalidWithoutReason).ok, false);
});

test('calculator preserves the fixed five-person and forty-prediction denominators', () => {
  const cohort = buildSyntheticCohort();
  assert.throws(
    () => aggregateManufacturingRoboticsUatResults(cohort),
    (error) => error?.code === 'manufacturing_robotics_uat_test_fixture_forbidden'
  );

  const aggregate = aggregateManufacturingRoboticsUatResults(cohort, {
    allowTestFixtures: true,
  });

  assert.equal(aggregate.evidence_mode, 'SYNTHETIC_TEST_FIXTURE');
  assert.equal(aggregate.human_uat, 'NOT_RUN');
  assert.equal(aggregate.overall_decision, 'TEST_ONLY');
  assert.equal(aggregate.criteria_outcome, 'PASS');
  assert.deepEqual(aggregate.cohort, {
    complete_valid_records: 5,
    fixed_required_records: 5,
    english_locale_records: 2,
    korean_locale_records: 3,
  });

  for (const criterionId of [
    'MR-UAT-01',
    'MR-UAT-02',
    'MR-UAT-03',
    'MR-UAT-04',
    'MR-UAT-05',
  ]) {
    assert.equal(aggregate.criteria[criterionId].denominator, 5);
    assert.equal(aggregate.criteria[criterionId].status, 'PASS');
  }
  assert.equal(aggregate.criteria['MR-UAT-01'].numerator, 4);
  assert.equal(aggregate.criteria['MR-UAT-02'].numerator, 4);
  assert.equal(aggregate.criteria['MR-UAT-03'].numerator, 5);
  assert.equal(aggregate.criteria['MR-UAT-04'].numerator, 4);
  assert.equal(aggregate.criteria['MR-UAT-05'].numerator, 4);
  assert.equal(aggregate.criteria['MR-UAT-06'].numerator, 32);
  assert.equal(aggregate.criteria['MR-UAT-06'].denominator, 40);
  assert.equal(aggregate.criteria['MR-UAT-06'].percent, 80);
  assert.deepEqual(
    aggregate.criteria['MR-UAT-07'].sorted_primary_action_counts,
    [3, 4, 4, 5, 6]
  );
  assert.equal(aggregate.criteria['MR-UAT-07'].median, 4);
  assert.equal(aggregate.criteria['MR-UAT-08'].material_error_count, 0);
  assert.deepEqual(aggregate.publication_boundary, {
    count_only: true,
    participant_rows_included: false,
    participant_locale_mapping_included: false,
    notes_included: false,
    raw_record_paths_included: false,
  });
  assert.doesNotMatch(JSON.stringify(aggregate), /participant_label|attempt_label/);
});

test('calculator rejects incomplete, duplicate, missed-prompt, and candidate-drift cohorts', () => {
  const cohort = buildSyntheticCohort();
  assert.throws(
    () => aggregateManufacturingRoboticsUatResults(cohort.slice(0, 4), {
      allowTestFixtures: true,
    }),
    (error) => error?.code === 'manufacturing_robotics_uat_exact_cohort_required'
  );

  const duplicate = clone(cohort);
  duplicate[4].participant_label = 'P4';
  duplicate[4].attempt_label = 'P4-R1';
  assert.throws(
    () => aggregateManufacturingRoboticsUatResults(duplicate, {
      allowTestFixtures: true,
    }),
    (error) => error?.code === 'manufacturing_robotics_uat_participant_set_invalid'
  );

  const missed = clone(cohort);
  missed[0].predictions[0].score = 'FACILITATOR_MISSED';
  assert.throws(
    () => aggregateManufacturingRoboticsUatResults(missed, {
      allowTestFixtures: true,
    }),
    (error) => error?.code === 'manufacturing_robotics_uat_facilitator_missed'
  );

  const drifted = clone(cohort);
  drifted[4].candidate.resolved_commit = 'd'.repeat(40);
  assert.throws(
    () => aggregateManufacturingRoboticsUatResults(drifted, {
      allowTestFixtures: true,
    }),
    (error) => error?.code === 'manufacturing_robotics_uat_round_identity_mismatch'
  );
});

test('CLI writes only a count aggregate and requires the explicit fixture-only switch', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'manufacturing-robotics-uat-'));
  try {
    const cohort = buildSyntheticCohort();
    const inputPaths = cohort.map((record, index) => {
      const inputPath = join(tempRoot, `record-${index + 1}.json`);
      writeFileSync(inputPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      return inputPath;
    });
    const outputPath = join(tempRoot, 'aggregate.json');

    const rejected = spawnSync(process.execPath, [SCRIPT_PATH, ...inputPaths], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /manufacturing_robotics_uat_test_fixture_forbidden/);

    const completed = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--allow-test-fixtures', '--out', outputPath, ...inputPaths],
      {
        cwd: ROOT,
        encoding: 'utf8',
      }
    );
    assert.equal(completed.status, 0, completed.stderr);
    const aggregateText = readFileSync(outputPath, 'utf8');
    const aggregate = JSON.parse(aggregateText);
    assert.equal(aggregate.criteria['MR-UAT-06'].denominator, 40);
    assert.equal(aggregate.overall_decision, 'TEST_ONLY');
    assert.doesNotMatch(aggregateText, /participant_label|attempt_label|record-[1-5]\.json/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

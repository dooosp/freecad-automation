#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { parseInspectionEvidenceJsonBytes } from '../lib/inspection-evidence-onboarding.js';

const ROOT = resolve(import.meta.dirname, '..');
const SCHEMA_PATH = resolve(ROOT, 'schemas', 'manufacturing-robotics-uat-result.schema.json');
const EXPECTED_PARTICIPANTS = Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5']);
export const EXPECTED_PREDICTION_IDS = Object.freeze([
  'MR-PRED-01',
  'MR-PRED-02',
  'MR-PRED-03',
  'MR-PRED-04',
  'MR-PRED-05',
  'MR-PRED-06',
  'MR-PRED-07',
  'MR-PRED-08',
]);

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  strictNumbers: true,
  validateFormats: false,
});
const validateSchema = ajv.compile(schema);

function uatError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function formatSchemaErrors(errors = []) {
  return errors
    .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
    .join('; ');
}

export function validateManufacturingRoboticsUatResult(document) {
  const ok = validateSchema(document);
  return {
    ok,
    errors: ok
      ? []
      : (validateSchema.errors || []).map((entry) => ({
          path: entry.instancePath || '/',
          keyword: entry.keyword,
          message: entry.message || 'invalid value',
        })),
  };
}

export function readManufacturingRoboticsUatResult(filePath) {
  const bytes = readFileSync(filePath);
  const document = parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: false });
  const validation = validateManufacturingRoboticsUatResult(document);
  if (!validation.ok) {
    throw uatError(
      'manufacturing_robotics_uat_schema_invalid',
      `UAT result schema validation failed: ${formatSchemaErrors(validation.errors.map((entry) => ({
        instancePath: entry.path,
        message: entry.message,
      })))}`
    );
  }
  return document;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function countWhere(records, selector) {
  return records.reduce((count, record) => count + (selector(record) ? 1 : 0), 0);
}

function passFail(passed) {
  return passed ? 'PASS' : 'FAIL';
}

function assertCompleteCohort(records, { allowTestFixtures }) {
  if (!Array.isArray(records) || records.length !== 5) {
    throw uatError(
      'manufacturing_robotics_uat_exact_cohort_required',
      'Exactly five validated P1-P5 records are required; the denominator must not shrink.'
    );
  }

  for (const record of records) {
    const validation = validateManufacturingRoboticsUatResult(record);
    if (!validation.ok) {
      throw uatError(
        'manufacturing_robotics_uat_schema_invalid',
        `UAT result schema validation failed: ${formatSchemaErrors(validation.errors.map((entry) => ({
          instancePath: entry.path,
          message: entry.message,
        })))}`
      );
    }
  }

  const origins = [...new Set(records.map((record) => record.record_origin))];
  if (origins.length !== 1) {
    throw uatError(
      'manufacturing_robotics_uat_mixed_record_origins',
      'A cohort cannot mix private human records and synthetic test fixtures.'
    );
  }
  const recordOrigin = origins[0];
  if (recordOrigin === 'synthetic_test_fixture' && !allowTestFixtures) {
    throw uatError(
      'manufacturing_robotics_uat_test_fixture_forbidden',
      'Synthetic test fixtures cannot be aggregated as human UAT. Use --allow-test-fixtures only in tests.'
    );
  }

  const labels = records.map((record) => record.participant_label).sort();
  if (!sameJson(labels, EXPECTED_PARTICIPANTS)) {
    throw uatError(
      'manufacturing_robotics_uat_participant_set_invalid',
      'The validated cohort must contain each anonymous label P1-P5 exactly once.'
    );
  }

  const baseline = records[0];
  for (const record of records) {
    if (
      record.round_id !== baseline.round_id
      || !sameJson(record.candidate, baseline.candidate)
      || !sameJson(record.round_gates, baseline.round_gates)
    ) {
      throw uatError(
        'manufacturing_robotics_uat_round_identity_mismatch',
        'All five records must bind the same round, candidate identity, and prerun gates.'
      );
    }
    if (
      record.attempt_label !== record.participant_label
      && !record.attempt_label.startsWith(`${record.participant_label}-R`)
    ) {
      throw uatError(
        'manufacturing_robotics_uat_attempt_label_mismatch',
        'Each attempt label must belong to its anonymous participant label.'
      );
    }
    if (
      !record.protocol.anonymous_notes_consent
      || !record.protocol.valid_attempt
      || !record.protocol.all_required_fields_complete
      || !record.protocol.sensitive_data_review_complete
    ) {
      throw uatError(
        'manufacturing_robotics_uat_valid_replacement_required',
        'Every aggregate input must be a complete, consented, privacy-reviewed valid attempt.'
      );
    }
    if (
      !record.candidate.clean_status_matches
      || !record.round_gates.candidate_unchanged
      || record.round_gates.p0_status !== 'PASS'
      || record.round_gates.human_bilingual_review_status !== 'PASS'
    ) {
      throw uatError(
        'manufacturing_robotics_uat_prerun_gate_failed',
        'Candidate identity, P0, and human bilingual review must pass before aggregation.'
      );
    }

    const predictionIds = record.predictions.map((entry) => entry.opportunity_id);
    if (!sameJson(predictionIds, EXPECTED_PREDICTION_IDS)) {
      throw uatError(
        'manufacturing_robotics_uat_prediction_set_invalid',
        'Every record must contain the eight canonical prediction opportunities in fixed order.'
      );
    }
    if (record.predictions.some((entry) => entry.score === 'FACILITATOR_MISSED')) {
      throw uatError(
        'manufacturing_robotics_uat_facilitator_missed',
        'FACILITATOR_MISSED invalidates the attempt; collect a valid replacement without shrinking 40.'
      );
    }
  }

  return recordOrigin;
}

function buildCriterion({ measure, numerator, denominator, threshold, passed, extra = {} }) {
  return {
    measure,
    numerator,
    denominator,
    threshold,
    status: passFail(passed),
    ...extra,
  };
}

export function aggregateManufacturingRoboticsUatResults(records, {
  allowTestFixtures = false,
} = {}) {
  const recordOrigin = assertCompleteCohort(records, { allowTestFixtures });
  const byLabel = [...records].sort(
    (left, right) => left.participant_label.localeCompare(right.participant_label)
  );
  const baseline = byLabel[0];

  const summaryWithoutHelp = countWhere(
    byLabel,
    (record) => record.observations.dataset_summary_without_help
  );
  const actionFeature = countWhere(
    byLabel,
    (record) => record.observations.action_feature_link_explained
  );
  const syntheticBoundary = countWhere(
    byLabel,
    (record) => record.observations.synthetic_vs_real_explained
  );
  const lerobotGap = countWhere(
    byLabel,
    (record) => record.observations.lerobot_gap_explained
  );
  const revisionMismatch = countWhere(
    byLabel,
    (record) => record.observations.revision_mismatch_explained
  );
  const predictionCorrect = byLabel
    .flatMap((record) => record.predictions)
    .filter((entry) => entry.score === 'CORRECT')
    .length;
  const predictionDenominator = EXPECTED_PREDICTION_IDS.length * EXPECTED_PARTICIPANTS.length;
  const completedPathCounts = byLabel
    .filter((record) => record.observations.dataset_summary_reached)
    .map((record) => record.observations.completed_path_primary_actions)
    .sort((left, right) => left - right);
  const primaryActionMedian = median(completedPathCounts);
  const materialErrorCount = baseline.round_gates.material_bilingual_error_count;

  const mrUat01Passed = summaryWithoutHelp >= 4;
  const criteria = {
    'MR-UAT-01': buildCriterion({
      measure: 'dataset summary reached without help',
      numerator: summaryWithoutHelp,
      denominator: 5,
      threshold: 'at_least_4_of_5',
      passed: mrUat01Passed,
    }),
    'MR-UAT-02': buildCriterion({
      measure: 'one action-to-CAD-feature linkage explained',
      numerator: actionFeature,
      denominator: 5,
      threshold: 'at_least_4_of_5',
      passed: actionFeature >= 4,
    }),
    'MR-UAT-03': buildCriterion({
      measure: 'synthetic data distinguished from real shop-floor data',
      numerator: syntheticBoundary,
      denominator: 5,
      threshold: 'at_least_4_of_5',
      passed: syntheticBoundary >= 4,
    }),
    'MR-UAT-04': buildCriterion({
      measure: 'reason output is not LeRobot training-ready explained',
      numerator: lerobotGap,
      denominator: 5,
      threshold: 'at_least_4_of_5',
      passed: lerobotGap >= 4,
    }),
    'MR-UAT-05': buildCriterion({
      measure: 'revision mismatch block explained',
      numerator: revisionMismatch,
      denominator: 5,
      threshold: 'at_least_4_of_5',
      passed: revisionMismatch >= 4,
    }),
    'MR-UAT-06': buildCriterion({
      measure: 'fixed next-action predictions correct',
      numerator: predictionCorrect,
      denominator: predictionDenominator,
      threshold: 'at_least_80_percent',
      passed: predictionCorrect / predictionDenominator >= 0.8,
      extra: {
        percent: Number(((predictionCorrect / predictionDenominator) * 100).toFixed(2)),
      },
    }),
    'MR-UAT-07': {
      measure: 'median completed summary path primary actions',
      completed_path_count: completedPathCounts.length,
      sorted_primary_action_counts: completedPathCounts,
      median: primaryActionMedian,
      threshold: 'median_lte_4_and_mr_uat_01_pass',
      dependency: mrUat01Passed ? 'PASS' : 'FAIL_MR_UAT_01',
      status: mrUat01Passed && primaryActionMedian !== null && primaryActionMedian <= 4
        ? 'PASS'
        : 'FAIL',
    },
    'MR-UAT-08': {
      measure: 'material Korean-English meaning errors',
      material_error_count: materialErrorCount,
      threshold: 'exactly_0',
      status: passFail(materialErrorCount === 0),
    },
  };

  const criteriaOutcome = Object.values(criteria).every((criterion) => criterion.status === 'PASS')
    ? 'PASS'
    : 'FAIL';
  const isFixture = recordOrigin === 'synthetic_test_fixture';

  return {
    schema_version: '1.0',
    aggregate_type: 'manufacturing_robotics_human_uat_count_aggregate',
    evidence_mode: isFixture ? 'SYNTHETIC_TEST_FIXTURE' : 'PRIVATE_HUMAN_SESSION',
    round_id: baseline.round_id,
    human_uat: isFixture ? 'NOT_RUN' : 'RUN_COMPLETE',
    human_bilingual_review: baseline.round_gates.human_bilingual_review_status,
    overall_decision: isFixture ? 'TEST_ONLY' : criteriaOutcome,
    criteria_outcome: criteriaOutcome,
    candidate: {
      resolved_commit: baseline.candidate.resolved_commit,
      git_tree: baseline.candidate.git_tree,
      candidate_tree_sha256: baseline.candidate.candidate_tree_sha256,
      unchanged: true,
    },
    cohort: {
      complete_valid_records: 5,
      fixed_required_records: 5,
      english_locale_records: countWhere(byLabel, (record) => record.locale === 'en'),
      korean_locale_records: countWhere(byLabel, (record) => record.locale === 'ko'),
    },
    criteria,
    diagnostics: {
      keyboard_operable: countWhere(
        byLabel,
        (record) => record.accessibility.keyboard_operable === 'PASS'
      ),
      zoom_200_operable: countWhere(
        byLabel,
        (record) => record.accessibility.zoom_200_operable === 'PASS'
      ),
      reduced_motion_operable: countWhere(
        byLabel,
        (record) => record.accessibility.reduced_motion_operable === 'PASS'
      ),
    },
    publication_boundary: {
      count_only: true,
      participant_rows_included: false,
      participant_locale_mapping_included: false,
      notes_included: false,
      raw_record_paths_included: false,
    },
    warning: isFixture
      ? 'Synthetic fixtures exercise the calculator only. They are not human UAT evidence.'
      : 'This aggregate contains counts only; private raw records remain outside the repository.',
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/manufacturing-robotics-uat-aggregate.js [--out <aggregate.json>] <P1.json> <P2.json> <P3.json> <P4.json> <P5.json>',
    '',
    'Validates exactly five private P1-P5 records and emits one count-only JSON aggregate.',
    'Synthetic fixtures are rejected unless --allow-test-fixtures is used explicitly in tests.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    outPath: null,
    allowTestFixtures: false,
    help: false,
    inputPaths: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--allow-test-fixtures') {
      options.allowTestFixtures = true;
    } else if (arg === '--out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw uatError('manufacturing_robotics_uat_out_required', '--out requires a file path.');
      }
      options.outPath = value;
      index += 1;
    } else if (arg.startsWith('--')) {
      throw uatError('manufacturing_robotics_uat_unknown_option', `Unknown option: ${arg}`);
    } else {
      options.inputPaths.push(arg);
    }
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.inputPaths.length !== 5) {
    throw uatError(
      'manufacturing_robotics_uat_exact_inputs_required',
      'Exactly five private result paths are required; the denominator must not shrink.'
    );
  }

  const records = options.inputPaths.map((filePath) => (
    readManufacturingRoboticsUatResult(resolve(filePath))
  ));
  const aggregate = aggregateManufacturingRoboticsUatResults(records, {
    allowTestFixtures: options.allowTestFixtures,
  });
  const serialized = `${JSON.stringify(aggregate, null, 2)}\n`;
  if (options.outPath) {
    writeFileSync(resolve(options.outPath), serialized, 'utf8');
  } else {
    process.stdout.write(serialized);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.code || 'manufacturing_robotics_uat_error'}: ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

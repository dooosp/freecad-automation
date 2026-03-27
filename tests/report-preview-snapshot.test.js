import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  assertReportPreviewSnapshot,
  normalizeReportPreviewSnapshot,
} from './helpers/report-preview-snapshot.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_PATH = join(ROOT, 'tests', 'fixtures', 'report', 'readiness_preview.json');
const SNAPSHOT_DIR = join(ROOT, 'tests', 'fixtures', 'snapshots', 'report');
const EXPECT_UPDATED = process.env.UPDATE_SNAPSHOTS === '1';

const fixtureReport = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

const baselineResult = assertReportPreviewSnapshot('readiness_preview', fixtureReport, { snapshotDir: SNAPSHOT_DIR });
assert.equal(baselineResult.updated, EXPECT_UPDATED, 'report preview baseline update state should match UPDATE_SNAPSHOTS');

const noisyReport = {
  ...fixtureReport,
  generated_at: '2026-03-28T02:15:01Z',
  artifact_path: '/Users/tester/tmp/output/pcb_mount_plate_readiness_report.json',
  run_id: 'run-123e4567-e89b-12d3-a456-426614174000',
};

const stableReport = {
  ...fixtureReport,
  generated_at: '2026-03-29T05:30:45Z',
  artifact_path: 'C:\\Users\\tester\\Documents\\pcb_mount_plate_readiness_report.json',
  run_id: 'run-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

assert.equal(
  normalizeReportPreviewSnapshot(noisyReport),
  normalizeReportPreviewSnapshot(stableReport),
  'Volatile report metadata should normalize away'
);

const changedReport = JSON.parse(JSON.stringify(fixtureReport));
changedReport.summary.top_issues[0] = 'Hole diameter drift has been replaced by flange warp risk';

if (!EXPECT_UPDATED) {
  assert.throws(
    () => assertReportPreviewSnapshot('readiness_preview', changedReport, { snapshotDir: SNAPSHOT_DIR }),
    /Report preview snapshot mismatch[\s\S]*First diff at line/,
    'Meaningful report changes should fail snapshot comparison with a useful diff'
  );
}

console.log('report-preview-snapshot.test.js: ok');

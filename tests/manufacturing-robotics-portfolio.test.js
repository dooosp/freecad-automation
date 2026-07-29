import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const PACK_ROOT = 'docs/portfolio/manufacturing-robotics-demo';
const LEROBOT_COMMIT = '30da8e687a6dfc617fcd94afc367ac7071c376ce';
const PROFILE_ID = 'hinge-block-synthetic-inspection-v1';
const REQUIRED_DOCUMENTS = Object.freeze([
  'README.ko.md',
  'README.en.md',
  'problem-and-solution.md',
  'architecture.md',
  'kia-talent-evidence-map.md',
  'trust-boundaries.md',
  'lerobot-v3-gap-analysis.md',
  'demo-script-90sec.ko.md',
  'demo-script-90sec.en.md',
  'demo-script-6min.ko.md',
  'interview-questions.ko.md',
  'interview-questions.en.md',
  'human-uat-session-kit.md',
  'human-uat-round-1-aggregate.md',
  'screenshots/README.md',
]);
const OUTPUT_FILENAMES = Object.freeze([
  'manufacturing_action_dictionary.json',
  'manufacturing_episode_annotation.json',
  'manufacturing_data_validation_report.json',
  'manufacturing_robotics_dataset_manifest.json',
  'design_manufacturing_quality_handoff.json',
  'design_manufacturing_quality_handoff.md',
  'artifact-manifest.json',
  'output-manifest.json',
]);
const SCREENSHOT_FILENAMES = Object.freeze([
  '01-en-prerun.png',
  '02-ko-prerun.png',
  '03-en-success-timeline.png',
  '04-ko-handoff.png',
  '05-en-trust-lerobot-gap.png',
  '06-ko-blocked-mismatch.png',
]);

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function readPack(filename) {
  return read(`${PACK_ROOT}/${filename}`);
}

function assertContains(text, value, label) {
  assert.equal(text.includes(value), true, `${label} should include ${value}`);
}

function localMarkdownTargets(relativePath) {
  const text = read(relativePath);
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((target) => target && !/^(?:https?:|mailto:|#)/i.test(target));
}

test('portfolio pack is complete, indexed, and has no broken local links', () => {
  for (const document of REQUIRED_DOCUMENTS) {
    const relativePath = `${PACK_ROOT}/${document}`;
    assert.equal(existsSync(resolve(ROOT, relativePath)), true, `${relativePath} should exist`);
    for (const target of localMarkdownTargets(relativePath)) {
      const linkedPath = resolve(ROOT, dirname(relativePath), target);
      assert.equal(existsSync(linkedPath), true, `${relativePath} has broken link ${target}`);
    }
  }

  const index = read('docs/portfolio/README.md');
  assertContains(index, 'manufacturing-robotics-demo/README.ko.md', 'portfolio index');
  assertContains(index, 'manufacturing-robotics-demo/README.en.md', 'portfolio index');
  assertContains(index, 'Human UAT and human bilingual review are `NOT_RUN`', 'portfolio index');
});

test('bilingual overview and architecture preserve the exact profile and output contract', () => {
  const Korean = readPack('README.ko.md');
  const English = readPack('README.en.md');
  const architecture = readPack('architecture.md');
  for (const text of [Korean, English, architecture]) {
    assertContains(text, PROFILE_ID, 'portfolio overview');
    for (const filename of OUTPUT_FILENAMES) {
      assertContains(text, filename, 'portfolio output contract');
    }
  }
  for (const text of [Korean, English]) {
    assertContains(text, 'REVISION_LINEAGE_IDENTITY_MISMATCH', 'portfolio overview');
    assertContains(text, '0 / 8', 'portfolio overview');
    assertContains(text, 'NOT_RUN', 'overview human hold');
  }
});

test('trust and LeRobot documents keep explicit false boundaries and pinned primary sources', () => {
  const trust = readPack('trust-boundaries.md');
  const architecture = readPack('architecture.md');
  const gap = readPack('lerobot-v3-gap-analysis.md');
  for (const fragment of [
    '| `synthetic_demo` | `true` |',
    '| `real_shop_floor_data` | `false` |',
    '| `computer_vision_model_used` | `false` |',
    '| `lerobot_compatible` | `false` |',
    '| `training_ready` | `false` |',
    '| `product_release` / `production_readiness` | `false` / `false` |',
    '| `human_review_required` | `true` |',
  ]) {
    assertContains(trust, fragment, 'trust boundary table');
  }
  for (const text of [trust, architecture]) {
    assertContains(text, '0-item control fixture', 'inspection-plan truth boundary');
    assertContains(text, 'inspection_plan_item_ids', 'inspection-plan truth boundary');
    assertContains(text, 'action-to-inspection-plan-item', 'inspection-plan truth boundary');
    assert.match(text, /quality characteristic IDs/i);
    assert.match(text, /inspection snapshot.*(?:identity\/lineage|Revision A.*(?:identity|계보))/is);
  }
  assertContains(trust, '`inspection_evidence: false`', 'inspection evidence boundary');
  assertContains(trust, '`evidence_attached: false`', 'inspection evidence boundary');

  assertContains(gap, LEROBOT_COMMIT, 'LeRobot gap analysis');
  for (const sourcePath of [
    'docs/source/lerobot-dataset-v3.mdx',
    'docs/source/porting_datasets_v3.mdx',
    'src/lerobot/datasets/utils.py',
    'src/lerobot/utils/constants.py',
    'src/lerobot/datasets/dataset_writer.py',
  ]) {
    assertContains(gap, sourcePath, 'LeRobot gap analysis');
  }
  for (const requirement of [
    'Frame-level Parquet data',
    'Frame indices and timestamps',
    'Positive sampling FPS',
    '`meta/info.json` feature schema and counters',
    '`meta/tasks.parquet` and episode metadata',
    'Statistics',
    'Numeric `observation.state` and `action` vectors',
    'Loader validation',
  ]) {
    assertContains(gap, requirement, 'LeRobot gap analysis');
  }
  assert.match(gap, /not (?:a )?universal v3 (?:format )?requirement/i);
  assertContains(gap, 'Current export status: `NOT_EXPORTABLE_YET`', 'LeRobot gap analysis');
  assertContains(gap, '`LEROBOT_COMPATIBLE`: `false`', 'LeRobot gap analysis');
  assertContains(gap, '`TRAINING_READY`: `false`', 'LeRobot gap analysis');
});

test('UAT packet fixes the cohort, denominators, thresholds, privacy, and restart rules', () => {
  const session = readPack('human-uat-session-kit.md');
  const aggregate = readPack('human-uat-round-1-aggregate.md');
  for (const text of [session, aggregate]) {
    assertContains(text, 'Human UAT: `NOT_RUN`', 'UAT packet');
    assertContains(text, 'Human Korean/English meaning review: `NOT_RUN`', 'UAT packet');
    for (let number = 1; number <= 8; number += 1) {
      assertContains(text, `MR-UAT-0${number}`, 'UAT packet');
    }
    assertContains(text, '4 / 5', 'UAT packet');
    assertContains(text, '32 / 40', 'UAT packet');
    assertContains(text, '<= 4', 'UAT packet');
    assertContains(text, 'exactly `0`', 'UAT packet');
  }

  for (const phrase of [
    'P0`, excluded from every human metric',
    'exactly `P1`, `P2`, `P3`, `P4`, `P5`',
    'fixed `5 × 8 = 40`',
    'outside every repository and worktree',
    'Do not use `--allow-test-fixtures` for a human round',
    '`INVALIDATED_RESTART_REQUIRED`',
    'Do not combine observations from two candidates',
    'Ask `MR-PRED-02`',
    'Action 1 starts unselected',
    'checking it starts no job and changes no completed result',
    'separately enabled blocked-demo button',
  ]) {
    assertContains(session, phrase, 'UAT session kit');
  }
  assertContains(aggregate, 'Complete valid private human records | 0 / 5', 'empty aggregate');
  assertContains(aggregate, 'participant rows', 'empty aggregate publication boundary');
  assertContains(aggregate, 'FOLLOW_UP_REQUIRED', 'empty aggregate state');
});

test('screenshot directory accepts only the bounded P0 capture set', () => {
  const screenshotRoot = resolve(ROOT, PACK_ROOT, 'screenshots');
  const entries = readdirSync(screenshotRoot).filter((entry) => entry !== 'README.md');
  for (const entry of entries) {
    assert.equal(extname(entry).toLowerCase(), '.png', `unexpected screenshot file type: ${entry}`);
    assert.equal(SCREENSHOT_FILENAMES.includes(entry), true, `unexpected screenshot: ${entry}`);
  }
  const capturePlan = readPack('screenshots/README.md');
  for (const filename of SCREENSHOT_FILENAMES) {
    assertContains(capturePlan, filename, 'screenshot capture plan');
  }
  assert.match(capturePlan, /PENDING_P0_CAPTURE|CAPTURED_FROM_P0/);
  assertContains(capturePlan, 'Human participant screenshots: prohibited', 'screenshot boundary');
});

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { generateManufacturingActionDataset } from '../src/services/manufacturing-action-dataset/manufacturing-action-dataset-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const DEFAULT_OUT_DIR = 'output/manufacturing-action-dataset-doctor';
const DEFAULT_GENERATED_AT = '2026-07-28T00:00:00.000Z';
const CONFIG_PATH = 'configs/examples/hinge_block.toml';
const ROBOT_CONFIG_PATH = 'configs/examples/robot_arm_6axis.toml';
const TASK_PLAN_PATH = 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json';
const EXPECTED_DATASET_FILES = Object.freeze([
  'artifact-manifest.json',
  'design_manufacturing_quality_handoff.json',
  'design_manufacturing_quality_handoff.md',
  'manufacturing_action_dictionary.json',
  'manufacturing_data_validation_report.json',
  'manufacturing_episode_annotation.json',
  'manufacturing_robotics_dataset_manifest.json',
  'output-manifest.json',
]);
const FIXED_BOUNDARIES = Object.freeze({
  synthetic_demo: true,
  real_shop_floor_data: false,
  automatic_video_segmentation: false,
  computer_vision_model_used: false,
  lerobot_compatible: false,
  training_ready: false,
  inspection_evidence: false,
  evidence_attached: false,
  readiness_regenerated: false,
  product_release: false,
  production_readiness: false,
  human_review_required: true,
});
const EXACT_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function usage() {
  return [
    'Usage: node scripts/manufacturing-action-dataset-doctor.js [--out-dir <ignored-output-dir>] [--generated-at <iso8601>] [--clean]',
    '',
    'Builds proof review/readiness/inspection inputs with existing CLI builders, then',
    'generates the bounded offline synthetic manufacturing action dataset.',
    'It does not run FreeCAD or a robot, attach inspection evidence, regenerate',
    'canonical readiness, create training-ready data, or release a product.',
    'Timestamp format: YYYY-MM-DDTHH:mm:ssZ or YYYY-MM-DDTHH:mm:ss.sssZ.',
  ].join('\n');
}

function requireArgValue(flag, value) {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value\n\n${usage()}`);
  return value;
}

function parseArgs(argv) {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    generatedAt: DEFAULT_GENERATED_AT,
    clean: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--out-dir') {
      options.outDir = requireArgValue('--out-dir', argv[index + 1]);
      index += 1;
    } else if (arg === '--generated-at') {
      options.generatedAt = requireArgValue('--generated-at', argv[index + 1]);
      index += 1;
    } else if (arg === '--clean') {
      options.clean = true;
    } else {
      throw new Error(`Unknown manufacturing action dataset doctor argument: ${arg}\n\n${usage()}`);
    }
  }
  const timestampMillis = Date.parse(options.generatedAt);
  const normalizedTimestamp = Number.isNaN(timestampMillis)
    ? null
    : new Date(timestampMillis).toISOString();
  const normalizedInput = options.generatedAt.includes('.')
    ? options.generatedAt
    : options.generatedAt.replace(/Z$/, '.000Z');
  if (!EXACT_UTC_TIMESTAMP_PATTERN.test(options.generatedAt)
    || normalizedTimestamp !== normalizedInput) {
    throw new Error(`--generated-at must be a calendar-valid UTC timestamp in YYYY-MM-DDTHH:mm:ss[.sss]Z form: ${options.generatedAt}`);
  }
  return options;
}

function repoRelative(pathValue, label = 'Path') {
  if (typeof pathValue !== 'string'
    || !pathValue
    || pathValue !== pathValue.trim()
    || isAbsolute(pathValue)
    || pathValue.startsWith('~')
    || pathValue.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(pathValue)
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(pathValue)
    || pathValue.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a safe portable repo-relative path`);
  }
  const absolutePath = resolve(ROOT, pathValue);
  const repoPath = relative(ROOT, absolutePath).split(sep).join('/');
  if (!repoPath || repoPath === '..' || repoPath.startsWith('../') || isAbsolute(repoPath)) {
    throw new Error(`${label} must stay inside this repository: ${pathValue}`);
  }
  return repoPath;
}

function assertAllowedOutputRoot(repoPath) {
  const allowed = repoPath.startsWith('output/') || repoPath.startsWith('tmp/codex/');
  if (!allowed || repoPath === 'output' || repoPath === 'tmp/codex') {
    throw new Error('Doctor output must be a child directory under output/ or tmp/codex/');
  }
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function assertCommandOk(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed:\n${result.stdout || ''}\n${result.stderr || ''}`.trim()
  );
}

function assertIgnoredPath(repoPath) {
  const result = run('git', ['check-ignore', '-q', '--', `${repoPath}/`]);
  assert.equal(result.status, 0, `Doctor output directory must be ignored by git: ${repoPath}`);
}

function assertNoSymlinkComponents(repoPath) {
  const segments = repoPath.split('/');
  let cursor = ROOT;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
    assert.equal(lstatSync(cursor).isSymbolicLink(), false, `Doctor path must not traverse a symlink: ${repoPath}`);
  }
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function writeEngineeringContext(contextPath, generatedAt) {
  const context = {
    metadata: {
      created_at: generatedAt,
      warnings: [],
      source_files: [],
    },
    part: {
      part_id: 'hinge_block',
      name: 'hinge_block',
      revision: 'A',
      material: 'AL6061',
      process: 'machining',
    },
    geometry_source: {
      path: null,
      file_type: 'fixture_metadata',
      model_metadata: {
        volume: 54000,
        area: 15600,
        faces: 18,
        edges: 36,
        vertices: 24,
        bounding_box: {
          min: [0, 0, 0],
          max: [90, 50, 38],
          size: [90, 50, 38],
        },
      },
      feature_hints: {
        cylinders: [],
        bolt_circles: [],
        fillets: [],
        chamfers: [],
      },
    },
    bom: [],
    inspection_results: [],
    quality_issues: [],
    manufacturing_context: {},
  };
  writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
}

function buildProofInputs({ rootPath, generatedAt }) {
  const proofDir = join(rootPath, 'proof-inputs');
  mkdirSync(proofDir, { recursive: true });
  const contextPath = join(proofDir, 'engineering_context.json');
  const reviewPackPath = join(proofDir, 'review_pack.json');
  const readinessPath = join(proofDir, 'readiness_report.json');
  const inspectionPlanPath = join(proofDir, 'inspection_plan.json');
  writeEngineeringContext(contextPath, generatedAt);

  const contextRef = repoRelative(relative(ROOT, contextPath).split(sep).join('/'), 'Engineering context');
  const reviewPackRef = repoRelative(relative(ROOT, reviewPackPath).split(sep).join('/'), 'Review pack');
  const readinessRef = repoRelative(relative(ROOT, readinessPath).split(sep).join('/'), 'Readiness report');
  const inspectionPlanRef = repoRelative(relative(ROOT, inspectionPlanPath).split(sep).join('/'), 'Inspection plan');

  const reviewRun = run(process.execPath, [
    CLI,
    'review-context',
    '--context', contextRef,
    '--config', CONFIG_PATH,
    '--part-id', 'hinge_block',
    '--revision', 'A',
    '--proof-lineage',
    '--out', reviewPackRef,
  ]);
  assertCommandOk(reviewRun, 'proof review-context builder');

  const readinessRun = run(process.execPath, [
    CLI,
    'readiness-pack',
    '--review-pack', reviewPackRef,
    '--proof-lineage',
    '--out', readinessRef,
  ]);
  assertCommandOk(readinessRun, 'proof readiness-pack builder');

  const inspectionRun = run(process.execPath, [
    CLI,
    'inspection-plan',
    '--review-pack', reviewPackRef,
    '--readiness', readinessRef,
    '--config', CONFIG_PATH,
    '--scope', 'full',
    '--proof-lineage',
    '--generated-at', generatedAt,
    '--out', inspectionPlanRef,
  ]);
  assertCommandOk(inspectionRun, 'proof inspection-plan builder');

  return {
    proofDir,
    reviewPackPath: reviewPackRef,
    inspectionPlanPath: inspectionPlanRef,
  };
}

function assertFixedBoundaries(boundaries) {
  assert(boundaries && typeof boundaries === 'object', 'Dataset service must return its fixed boundaries');
  for (const [key, expected] of Object.entries(FIXED_BOUNDARIES)) {
    assert.equal(boundaries[key], expected, `Dataset boundary ${key} must remain ${expected}`);
  }
}

function assertPortableOutputs(datasetDir) {
  for (const filename of EXPECTED_DATASET_FILES) {
    const bytes = readFileSync(join(datasetDir, filename), 'utf8');
    assert.equal(bytes.includes(ROOT), false, `${filename} must not expose the repository absolute path`);
    assert.equal(/\/(?:Users|private|var\/folders)\//.test(bytes), false, `${filename} must not expose host paths`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const rootRef = repoRelative(options.outDir, 'Doctor output');
  assertAllowedOutputRoot(rootRef);
  assertIgnoredPath(rootRef);
  assertNoSymlinkComponents(rootRef);
  const rootPath = resolve(ROOT, rootRef);
  if (options.clean) rmSync(rootPath, { recursive: true, force: true });
  mkdirSync(rootPath, { recursive: true });
  assertNoSymlinkComponents(rootRef);

  const proofInputs = buildProofInputs({ rootPath, generatedAt: options.generatedAt });
  const datasetRef = `${rootRef}/dataset`;
  const datasetDir = resolve(ROOT, datasetRef);
  const result = await generateManufacturingActionDataset({
    projectRoot: ROOT,
    configPath: CONFIG_PATH,
    reviewPackPath: proofInputs.reviewPackPath,
    inspectionPlanPath: proofInputs.inspectionPlanPath,
    robotConfigPath: ROBOT_CONFIG_PATH,
    taskPlanPath: TASK_PLAN_PATH,
    generatedAt: options.generatedAt,
    proofLineage: true,
    outDir: datasetRef,
  });

  assert.equal(result.status, 'valid_synthetic_demo');
  assertFixedBoundaries(result.boundaries);
  assert.deepEqual(readdirSync(datasetDir).sort(), [...EXPECTED_DATASET_FILES]);
  assert.equal(readJson(join(datasetDir, 'manufacturing_data_validation_report.json')).status, 'valid_synthetic_demo');
  assertPortableOutputs(datasetDir);

  console.log('manufacturing-action-dataset-doctor: ok');
  console.log(`  status: ${result.status}`);
  console.log(`  proof inputs: ${repoRelative(relative(ROOT, proofInputs.proofDir).split(sep).join('/'), 'Proof inputs')}`);
  console.log(`  dataset: ${datasetRef}`);
  console.log(`  files: ${EXPECTED_DATASET_FILES.length}`);
  console.log('  runtime: offline artifact-driven Node; FreeCAD and robot execution not used');
  console.log('  boundary: synthetic demo only; no shop-floor data, computer vision, LeRobot export, training readiness, inspection evidence, readiness regeneration, or product release');
  console.log('  human review required: yes');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

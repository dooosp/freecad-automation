import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DIAGNOSTIC_COMMANDS,
  FREECAD_BACKED_COMMANDS,
  LOCAL_API_JOB_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS,
  STUDIO_ARTIFACT_JOB_COMMANDS,
  STUDIO_JOB_COMMANDS,
  STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS,
  formatCommandNameList,
  getServeEntrypointMetadata,
  renderCommandUsage,
  renderCliUsage,
  renderServeUsage,
} from '../src/shared/command-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const cliHelp = renderCliUsage();
assert.match(cliHelp, /fcad check-runtime \[--json\] \[--redact-paths\]/);
assert.match(cliHelp, /fcad readiness-report <config\.toml\|json> \[--out <readiness_report\.json>\]\s+legacy compatibility \/ non-canonical/i);
assert.match(cliHelp, /fcad generate-standard-docs <config\.toml\|json> --readiness-report <readiness_report\.json>/i);
assert.match(cliHelp, /fcad closeout-package <canonical-package-slug> --mode software-demo \[--out-dir <dir>\] \[--strict-boundary\]/i);
assert.match(cliHelp, /fcad inspection-evidence-intake \[--package <canonical-package-slug>\] \[--out <report\.json>\] \[--include-github\]/i);
assert.match(cliHelp, /fcad inspection-evidence-promotion-dry-run --intake-report <report\.json> \[--out <promotion_dry_run_manifest\.json>\]/i);
assert.match(cliHelp, /fcad stage5b-evidence-audit --out-dir <dir> \[--include-github\]/i);
assert.match(cliHelp, /fcad stage5b-surrogate-inspection-validation --out-dir <dir> \[--package <canonical-package-slug>\]/i);
assert.match(cliHelp, /fcad pack --readiness <readiness_report\.json>[\s\S]*--out <release_bundle\.zip> \[--generated-at <iso8601>\]/i);
assert.match(cliHelp, /fcad review-context --model <file>[\s\S]*\[--inspection-evidence inspection_evidence\.json --attachment-authorization authorization_record\.json\][\s\S]*--out <review_pack\.json>/i);
assert.match(cliHelp, /--inspection-evidence <path>\s+Genuine completed inspection evidence JSON side input for review-context; requires Stage 5B attachment authorization/i);
assert.match(cliHelp, /--attachment-authorization <path>\s+Stage 5B authorization control record required with --inspection-evidence; it is not inspection evidence/i);
assert.match(cliHelp, /--strict-quality\s+Fail create or draw when blocking quality checks are found/i);
assert.match(cliHelp, /--generated-at <iso8601>\s+Use a fixed release bundle timestamp with pack for deterministic bundle metadata and ZIP entries/i);
assert.match(cliHelp, /fcad serve \[port\] \[--jobs-dir <dir>\] \[--legacy-viewer\]/);

for (const command of ['create', 'draw', 'inspect', 'report', 'pack', 'review-context']) {
  const commandHelp = renderCommandUsage(command);
  assert.match(commandHelp, new RegExp(`fcad ${command.replace('-', '\\-')}`));
  assert.match(commandHelp, /Usage:/);

  const run = spawnSync('node', [CLI, command, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${command} --help failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /Usage:/);
}

const serveHelp = renderServeUsage();
assert.match(serveHelp, /fcad serve - local API, studio shell, and legacy compatibility viewer/);
assert.match(serveHelp, /npm run serve:legacy/);

assert.deepEqual(DIAGNOSTIC_COMMANDS, ['check-runtime']);
assert.equal(FREECAD_BACKED_COMMANDS.includes('inspect'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('serve'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('closeout-package'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-surrogate-inspection-validation'), true);
assert.deepEqual(STUDIO_ARTIFACT_JOB_COMMANDS, ['readiness-pack', 'generate-standard-docs', 'pack']);
assert.deepEqual(STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS, ['compare-rev', 'stabilization-review']);
assert.deepEqual(STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS, ['inspect', 'report', 'readiness-pack', 'generate-standard-docs', 'pack', 'inspection-evidence-promotion-dry-run']);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('review-context'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-surrogate-inspection-validation'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('review-context'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-surrogate-inspection-validation'), false);
assert.equal(
  formatCommandNameList(STUDIO_JOB_COMMANDS, { conjunction: 'or' }),
  'create, draw, inspect, report, compare-rev, readiness-pack, stabilization-review, generate-standard-docs, pack, inspection-evidence-intake, inspection-evidence-promotion-dry-run, or stage5b-evidence-audit'
);

const serveEntrypoints = getServeEntrypointMetadata();
assert.equal(serveEntrypoints.preferredScriptCommand, packageJson.scripts.serve);
assert.equal(serveEntrypoints.legacyScriptCommand, packageJson.scripts['serve:legacy']);
assert.equal(serveEntrypoints.legacyPackageScript, 'npm run serve:legacy');

console.log('command-manifest.test.js: ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  renderCliUsage,
  renderServeUsage,
} from '../src/shared/command-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const cliHelp = renderCliUsage();
assert.match(cliHelp, /fcad check-runtime \[--json\]/);
assert.match(cliHelp, /fcad readiness-report <config\.toml\|json> \[--out <readiness_report\.json>\]\s+legacy compatibility \/ non-canonical/i);
assert.match(cliHelp, /fcad generate-standard-docs <config\.toml\|json> --readiness-report <readiness_report\.json>/i);
assert.match(cliHelp, /fcad closeout-package <canonical-package-slug> --mode software-demo \[--out-dir <dir>\] \[--strict-boundary\]/i);
assert.match(cliHelp, /fcad inspection-evidence-intake \[--package <canonical-package-slug>\] \[--out <report\.json>\] \[--include-github\]/i);
assert.match(cliHelp, /fcad inspection-evidence-promotion-dry-run --intake-report <report\.json> \[--out <promotion_dry_run_manifest\.json>\]/i);
assert.match(cliHelp, /fcad serve \[port\] \[--jobs-dir <dir>\] \[--legacy-viewer\]/);

const serveHelp = renderServeUsage();
assert.match(serveHelp, /fcad serve - local API, studio shell, and legacy compatibility viewer/);
assert.match(serveHelp, /npm run serve:legacy/);

assert.deepEqual(DIAGNOSTIC_COMMANDS, ['check-runtime']);
assert.equal(FREECAD_BACKED_COMMANDS.includes('inspect'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('serve'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('closeout-package'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.deepEqual(STUDIO_ARTIFACT_JOB_COMMANDS, ['readiness-pack', 'generate-standard-docs', 'pack']);
assert.deepEqual(STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS, ['compare-rev', 'stabilization-review']);
assert.deepEqual(STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS, ['inspect', 'report', 'readiness-pack', 'generate-standard-docs', 'pack']);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('review-context'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('review-context'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(
  formatCommandNameList(STUDIO_JOB_COMMANDS, { conjunction: 'or' }),
  'create, draw, inspect, report, compare-rev, readiness-pack, stabilization-review, generate-standard-docs, pack, or inspection-evidence-intake'
);

const serveEntrypoints = getServeEntrypointMetadata();
assert.equal(serveEntrypoints.preferredScriptCommand, packageJson.scripts.serve);
assert.equal(serveEntrypoints.legacyScriptCommand, packageJson.scripts['serve:legacy']);
assert.equal(serveEntrypoints.legacyPackageScript, 'npm run serve:legacy');

console.log('command-manifest.test.js: ok');

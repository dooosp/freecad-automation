import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CLI_DISPATCH_COMMANDS } from '../bin/fcad.js';
import {
  CONDITIONAL_COMMANDS,
  DIAGNOSTIC_COMMANDS,
  FREECAD_BACKED_COMMANDS,
  LOCAL_API_JOB_COMMANDS,
  LOCAL_API_SERVER_PROFILE_JOB_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS,
  STUDIO_ARTIFACT_JOB_COMMANDS,
  STUDIO_JOB_COMMANDS,
  STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS,
  formatCommandNameList,
  getCommandManifest,
  getServeEntrypointMetadata,
  renderCommandUsage,
  renderCliAllUsage,
  renderCliUsage,
  renderServeUsage,
} from '../src/shared/command-manifest.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'bin', 'fcad.js');
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const commandManifest = getCommandManifest();
const manifestCommandNames = commandManifest.map((entry) => entry.name);

function assertSameCommands(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

const defaultHelp = renderCliUsage();
const allHelp = renderCliAllUsage();
assertSameCommands(
  CLI_DISPATCH_COMMANDS,
  manifestCommandNames,
  'CLI dispatch commands should match src/shared/command-manifest.js'
);
commandManifest.forEach((entry) => {
  assert.equal(typeof entry.name, 'string');
  assert(['stable', 'beta', 'experimental', 'maintainer', 'compatibility', 'deprecated', 'internal'].includes(entry.lifecycle), `${entry.name} should have exactly one known lifecycle`);
  assert.equal(typeof entry.defaultHelpVisible, 'boolean', `${entry.name} should declare default help visibility`);
  assert.equal(typeof entry.audience, 'string', `${entry.name} should declare an audience`);
  assert(Object.hasOwn(entry, 'workflow'), `${entry.name} should declare a workflow`);
  assert(Object.hasOwn(entry, 'replacement'), `${entry.name} should declare replacement metadata`);
  assert.equal(entry.removalVersion, null, `${entry.name} should not announce an unapproved removal version`);
  assert.equal(typeof entry.safetyBoundary, 'string', `${entry.name} should declare a safety boundary`);
  assert(entry.helpEntries.length > 0, `${entry.name} should expose help entries`);
  entry.helpEntries.forEach((helpEntry) => {
    assert.match(allHelp, new RegExp(helpEntry.usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
assert.equal(commandManifest.filter((entry) => entry.defaultHelpVisible).length, 12);
assert.match(defaultHelp, /1\. Create or import and review/);
assert.match(defaultHelp, /2\. Compare revisions and plan inspection/);
assert.match(defaultHelp, /3\. Receive and normalize completed inspection results/);
assert.doesNotMatch(defaultHelp, /fcad stage5b-evidence-audit/);
assert.match(defaultHelp, /fcad inspection-result-normalize/);
for (const section of ['Stable', 'Beta engineering tools', 'Experimental tools', 'Maintainer controls', 'Compatibility commands', 'Deprecated routes', 'Internal implementation commands']) assert.match(allHelp, new RegExp(section));
assert.match(allHelp, /fcad check-runtime \[--json\] \[--redact-paths\] \[--fingerprint-out <runtime_fingerprint\.json>\]/);
assert.match(allHelp, /--fingerprint-out <runtime_fingerprint\.json>\s+Write reproducibility context only; not inspection evidence or production readiness proof/i);
assert.match(allHelp, /runtime fingerprint records local reproducibility context only/i);
assert.match(allHelp, /fcad readiness-report <config\.toml\|json> \[--out <readiness_report\.json>\]\s+legacy compatibility \/ non-canonical/i);
assert.match(allHelp, /fcad generate-standard-docs <config\.toml\|json> --readiness-report <readiness_report\.json>/i);
assert.match(allHelp, /fcad closeout-package <canonical-package-slug> --mode software-demo \[--out-dir <dir>\] \[--strict-boundary\]/i);
assert.match(allHelp, /fcad evidence-readiness-audit \[--out-dir <dir>\] \[--package <canonical-package-slug>\] \[--generated-at <iso8601>\] \[--clean\]/i);
assert.match(allHelp, /fcad evidence-artifacts-materialize \[--package <canonical-package-slug>\] \[--generated-at <iso8601>\] \[--dry-run\] \[--force\]/i);
assert.match(allHelp, /fcad maintainer-decision-journal \[--audit <evidence_readiness_audit\.json>\] \[--decision hold\|proceed\|exception_requested\|exception_approved\]/i);
assert.match(allHelp, /fcad inspection-evidence-intake \[--package <canonical-package-slug>\] \[--out <report\.json>\] \[--include-github\]/i);
assert.match(allHelp, /fcad inspection-evidence-quarantine --candidate <source> --envelope <envelope\.json> --package <slug> --revision <revision> --actor <identity-ref>/i);
assert.match(allHelp, /fcad inspection-evidence-regenerate-readiness --attachment-record <record\.json> --authorization <readiness-authorization\.json>/i);
assert.match(allHelp, /fcad inspection-evidence-promotion-dry-run --intake-report <report\.json> \[--out <promotion_dry_run_manifest\.json>\]/i);
assert.match(allHelp, /fcad stage5b-evidence-audit --out-dir <dir> \[--include-github\]/i);
assert.match(allHelp, /fcad stage5b-evidence-source-kit \[--package <canonical-package-slug>\] \[--out <report\.json>\]/i);
assert.match(allHelp, /fcad stage5b-evidence-source-preflight \[--package <canonical-package-slug>\] \[--source <raw-source\.json\|csv\|tsv>\] \[--out <report\.json>\]/i);
assert.match(allHelp, /fcad stage5b-evidence-attachment-controller --review-manifest <manifest\.json> --authorization-record <path-or-url> --out-dir <ignored-dir> \[--dry-run\]/i);
assert.match(allHelp, /fcad stage5b-surrogate-inspection-validation --out-dir <dir> \[--package <canonical-package-slug>\]/i);
assert.match(allHelp, /fcad evidence-graph --package <slug> --review-pack <review_pack\.json> --readiness <readiness_report\.json> --out <evidence_graph\.json>/i);
assert.match(allHelp, /fcad pack --readiness <readiness_report\.json>[\s\S]*--out <release_bundle\.zip> \[--generated-at <iso8601>\]/i);
assert.match(allHelp, /fcad review-context --model <file>[\s\S]*\[--inspection-evidence inspection_evidence\.json --attachment-authorization authorization_record\.json --evidence-attachment-record attachment_record\.json\][\s\S]*--out <review_pack\.json>/i);
assert.match(allHelp, /fcad compare-rev <baseline\.json> <candidate\.json>[\s\S]*--impact-out <revision_impact_report\.json>[\s\S]*--baseline-readiness <readiness_report\.json>[\s\S]*--candidate-evidence-receipt <attachment_receipt\.json>[\s\S]*--generated-at <iso8601>/i);
assert.match(allHelp, /--inspection-evidence <path>\s+Canonical attached inspection evidence envelope; requires its checksum-bound onboarding authorization and immutable receipt/i);
assert.match(allHelp, /--attachment-authorization <path>\s+Canonical inspection_evidence_attachment_authorization produced by onboarding; legacy stage5b_attachment_authorization is rejected/i);
assert.match(allHelp, /--evidence-attachment-record <path>\s+Immutable inspection_evidence_attachment_record required with --inspection-evidence/i);
assert.match(allHelp, /--strict-quality\s+Fail create or draw when blocking quality checks are found/i);
assert.match(allHelp, /--config <config\.toml\|json>\s+Authoritative config for proof-enabled review-context, inspection-plan, or manufacturing-action-dataset ingress/i);
assert.match(allHelp, /--generated-at <iso8601>\s+Use a fixed timestamp on supported standard-docs, inspection-plan, manufacturing-action-dataset, and pack outputs for deterministic metadata/i);
assert.match(allHelp, /--proof-lineage\s+Valueless opt-in for authoritative revision lineage on supported review, readiness, standard-docs, inspection-plan, manufacturing-action-dataset, and pack ingress/i);
assert.match(allHelp, /fcad serve \[port\] \[--jobs-dir <dir>\] \[--legacy-viewer\]/);

const cliAllRun = spawnSync('node', [CLI, 'help', '--all'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(cliAllRun.status, 0, cliAllRun.stderr);
assert.equal(cliAllRun.stdout.trim(), allHelp);
const cliCommandHelpRun = spawnSync('node', [CLI, 'help', 'inspection-result-normalize'], { cwd: ROOT, encoding: 'utf8' });
assert.equal(cliCommandHelpRun.status, 0, cliCommandHelpRun.stderr);
assert.match(cliCommandHelpRun.stdout, /Lifecycle:\s+stable/);
assert.match(cliCommandHelpRun.stdout, /ready_for_quarantine_review/);
const readinessHelp = renderCommandUsage('readiness-report');
assert.match(readinessHelp, /Deprecated route:/);
assert.match(readinessHelp, /Behavior remains available: yes/);
assert.match(readinessHelp, /readiness-pack --review-pack/);

for (const command of manifestCommandNames.filter((name) => name !== 'help')) {
  const commandHelp = renderCommandUsage(command);
  assert.match(commandHelp, new RegExp(`fcad ${command.replace('-', '\\-')}`));
  assert.match(commandHelp, /Usage:/);

  const run = spawnSync('node', [CLI, command, '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${command} --help failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /Usage:/);
  assert.equal(run.stdout.trim(), commandHelp);
}

const serveHelp = renderServeUsage();
assert.match(serveHelp, /fcad serve - local API, studio shell, and legacy compatibility viewer/);
assert.match(serveHelp, /npm run serve:legacy/);

assertSameCommands(
  DIAGNOSTIC_COMMANDS,
  commandManifest
    .filter((entry) => entry.runtime?.classification === 'diagnostics')
    .map((entry) => entry.name),
  'diagnostic runtime commands should be derived from manifest entries'
);
assertSameCommands(
  FREECAD_BACKED_COMMANDS,
  commandManifest
    .filter((entry) => entry.runtime?.classification === 'freecad-backed')
    .map((entry) => entry.name),
  'FreeCAD-backed runtime commands should be derived from manifest entries'
);
assertSameCommands(
  PLAIN_PYTHON_COMMANDS,
  commandManifest
    .filter((entry) => entry.runtime?.classification === 'plain-python-node')
    .map((entry) => entry.name),
  'plain-Python runtime commands should be derived from manifest entries'
);
assertSameCommands(
  CONDITIONAL_COMMANDS.map((entry) => entry.name),
  commandManifest
    .filter((entry) => entry.runtime?.classification === 'mixed-conditional')
    .map((entry) => entry.name),
  'conditional runtime commands should be derived from manifest entries'
);
assert.deepEqual(DIAGNOSTIC_COMMANDS, ['check-runtime']);
assert.equal(FREECAD_BACKED_COMMANDS.includes('inspect'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('serve'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('closeout-package'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('evidence-readiness-audit'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('evidence-artifacts-materialize'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('maintainer-decision-journal'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-quarantine'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-validate'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-authorize'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-attach'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-regenerate-readiness'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-evidence-source-kit'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-evidence-source-preflight'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-evidence-attachment-controller'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('stage5b-surrogate-inspection-validation'), true);
assert.equal(PLAIN_PYTHON_COMMANDS.includes('evidence-graph'), true);
assert.deepEqual(STUDIO_ARTIFACT_JOB_COMMANDS, ['readiness-pack', 'generate-standard-docs', 'inspection-plan', 'pack']);
assert.deepEqual(STUDIO_PAIRED_ARTIFACT_JOB_COMMANDS, ['compare-rev', 'stabilization-review']);
assert.deepEqual(STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS, ['inspect', 'report', 'readiness-pack', 'generate-standard-docs', 'inspection-plan', 'pack', 'inspection-evidence-promotion-dry-run']);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('review-context'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('evidence-graph'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('evidence-readiness-audit'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('evidence-artifacts-materialize'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('maintainer-decision-journal'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-evidence-source-kit'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-evidence-source-preflight'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-evidence-attachment-controller'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('stage5b-surrogate-inspection-validation'), false);
assert.equal(LOCAL_API_JOB_COMMANDS.includes('manufacturing-action-dataset'), true);
assert.deepEqual(LOCAL_API_SERVER_PROFILE_JOB_COMMANDS, ['manufacturing-action-dataset']);
assert.equal(STUDIO_JOB_COMMANDS.includes('review-context'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('evidence-graph'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('evidence-readiness-audit'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('evidence-artifacts-materialize'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('maintainer-decision-journal'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('inspection-evidence-intake'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('inspection-evidence-promotion-dry-run'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-evidence-audit'), true);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-evidence-source-kit'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-evidence-source-preflight'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-evidence-attachment-controller'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('stage5b-surrogate-inspection-validation'), false);
assert.equal(STUDIO_JOB_COMMANDS.includes('manufacturing-action-dataset'), true);
assert.equal(
  formatCommandNameList(STUDIO_JOB_COMMANDS, { conjunction: 'or' }),
  'create, draw, inspect, report, compare-rev, readiness-pack, evidence-graph, stabilization-review, generate-standard-docs, inspection-plan, manufacturing-action-dataset, pack, evidence-readiness-audit, inspection-evidence-intake, inspection-evidence-promotion-dry-run, or stage5b-evidence-audit'
);

const serveEntrypoints = getServeEntrypointMetadata();
assert.equal(serveEntrypoints.preferredScriptCommand, packageJson.scripts.serve);
assert.equal(serveEntrypoints.legacyScriptCommand, packageJson.scripts['serve:legacy']);
assert.equal(serveEntrypoints.legacyPackageScript, 'npm run serve:legacy');

console.log('command-manifest.test.js: ok');

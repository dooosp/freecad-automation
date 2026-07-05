#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { listZipEntries } from '../lib/zip-archive.js';
import { writeEvidenceReadinessAudit } from '../src/services/evidence-readiness-audit/evidence-readiness-audit-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_PACKAGE = 'quality-pass-bracket';
const DEFAULT_GENERATED_AT = '2026-06-06T00:00:00.000Z';

function usage() {
  return [
    'Usage: node scripts/release-dry-run-doctor.js [--package <canonical-package-slug>] [--out-dir <ignored-output-dir>] [--generated-at <iso8601>] [--clean]',
    '',
    'Builds a local release bundle dry-run under an ignored output directory.',
    'It never publishes, tags, uploads artifacts, attaches evidence, or regenerates canonical readiness.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    packageSlug: DEFAULT_PACKAGE,
    outDir: null,
    generatedAt: DEFAULT_GENERATED_AT,
    clean: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--package') {
      options.packageSlug = argv[index + 1];
      index += 1;
    } else if (arg === '--out-dir') {
      options.outDir = argv[index + 1];
      index += 1;
    } else if (arg === '--generated-at') {
      options.generatedAt = argv[index + 1];
      index += 1;
    } else if (arg === '--clean') {
      options.clean = true;
    } else {
      throw new Error(`Unknown release dry-run doctor argument: ${arg}\n\n${usage()}`);
    }
  }

  if (!options.packageSlug || !/^[a-z0-9][a-z0-9-]*$/.test(options.packageSlug)) {
    throw new Error(`Invalid canonical package slug for release dry-run doctor: ${options.packageSlug || '(empty)'}`);
  }
  if (!options.generatedAt || Number.isNaN(Date.parse(options.generatedAt))) {
    throw new Error(`Invalid --generated-at value for release dry-run doctor: ${options.generatedAt || '(empty)'}`);
  }

  options.outDir ||= join('output', 'release-dry-run-doctor', options.packageSlug);
  return options;
}

function repoRelative(pathValue) {
  const relPath = relative(ROOT, resolve(ROOT, pathValue)).replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(`Release dry-run doctor path must stay inside this repo: ${pathValue}`);
  }
  return relPath;
}

function run(command, args, { stdio = 'pipe' } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio,
  });
  return {
    command: [command, ...args],
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function publicCommand(argv) {
  const normalizedRoot = ROOT.replace(/\\/g, '/');
  return argv.map((value, index) => {
    if (index === 0 && value === process.execPath) {
      return 'node';
    }
    const stringValue = String(value);
    const normalizedValue = stringValue.replace(/\\/g, '/');
    if (normalizedValue.startsWith(`${normalizedRoot}/`)) {
      return repoRelative(stringValue);
    }
    return stringValue;
  });
}

function assertCommandOk(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed:\n${result.stdout || ''}\n${result.stderr || ''}`.trim()
  );
}

function gitStatus() {
  const result = run('git', ['status', '--porcelain', '--untracked-files=all']);
  assertCommandOk(result, 'git status');
  return result.stdout.trim();
}

function assertIgnoredPath(repoPath) {
  const result = run('git', ['check-ignore', '-q', `${repoPath.replace(/\/?$/, '/')}`]);
  assert.equal(
    result.status,
    0,
    `Release dry-run doctor output directory must be ignored by git: ${repoPath}`
  );
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function assertNoHostPaths(text, label) {
  assert.equal(/\/(?:Users|private|tmp|var)\//.test(text), false, `${label} must not expose host absolute paths`);
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false, `${label} must not expose Windows absolute paths`);
  assert.equal(/local\/stage5b-candidate-evidence-inbox/.test(text), false, `${label} must not expose local Stage 5B inbox paths`);
}

function assertChecksumFormat(checksumsPath) {
  const lines = readFileSync(checksumsPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  assert(lines.length > 0, 'release_bundle_checksums.sha256 should contain at least one checksum line');
  for (const line of lines) {
    assert.match(line, /^[a-f0-9]{64}  [^\s].+$/, `Invalid checksum line: ${line}`);
  }
  assert(lines.some((line) => line.endsWith('  release_bundle_log.json')), 'checksums should include release_bundle_log.json');
  return lines.length;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageRoot = join(ROOT, 'docs', 'examples', options.packageSlug);
  const readinessPath = join(packageRoot, 'readiness', 'readiness_report.json');
  const docsManifestPath = join(packageRoot, 'standard-docs', 'standard_docs_manifest.json');
  const outputDir = resolve(ROOT, options.outDir);
  const outputDirRel = repoRelative(outputDir);
  const bundlePath = join(outputDir, 'release_bundle.zip');
  const manifestPath = join(outputDir, 'release_bundle_manifest.json');
  const logPath = join(outputDir, 'release_bundle_log.json');
  const checksumsPath = join(outputDir, 'release_bundle_checksums.sha256');
  const artifactManifestPath = join(outputDir, 'release_bundle_artifact-manifest.json');
  const evidenceAuditPath = join(outputDir, 'evidence_readiness_audit.json');
  const evidenceAuditSummaryPath = join(outputDir, 'evidence_readiness_audit.md');
  const doctorReportPath = join(outputDir, 'release_dry_run_doctor_report.json');

  assert.equal(existsSync(readinessPath), true, `Missing canonical readiness input: ${repoRelative(readinessPath)}`);
  assert.equal(existsSync(docsManifestPath), true, `Missing standard docs manifest: ${repoRelative(docsManifestPath)}`);
  assertIgnoredPath(outputDirRel);

  if (options.clean) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  const statusBefore = gitStatus();
  const evidenceAudit = await writeEvidenceReadinessAudit({
    projectRoot: ROOT,
    outDir: outputDir,
    packageSlugs: [options.packageSlug],
    generatedAt: options.generatedAt,
    clean: false,
  });
  const packRun = run(process.execPath, [
    'bin/fcad.js',
    'pack',
    '--readiness',
    repoRelative(readinessPath),
    '--docs-manifest',
    repoRelative(docsManifestPath),
    '--out',
    repoRelative(bundlePath),
    '--generated-at',
    options.generatedAt,
  ]);
  assertCommandOk(packRun, 'release dry-run pack');

  for (const pathValue of [bundlePath, manifestPath, logPath, checksumsPath, artifactManifestPath]) {
    assert.equal(existsSync(pathValue), true, `Expected release dry-run output: ${repoRelative(pathValue)}`);
  }

  const manifest = readJson(manifestPath);
  assert.equal(manifest.artifact_type, 'release_bundle_manifest');
  assert.equal(manifest.contract?.command, 'pack');
  assert.equal(manifest.readiness_report_ref?.path, repoRelative(readinessPath));
  assert.equal(manifest.docs_manifest_ref?.path, repoRelative(docsManifestPath));
  assert.equal(manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_checksums'), true);
  assert.equal(manifest.bundle_artifacts.some((entry) => entry.artifact_type === 'release_bundle_log'), true);
  assert.equal(manifest.bundle_file?.filename, 'release_bundle.zip');

  const zipEntries = await listZipEntries(bundlePath);
  const zipEntryNames = zipEntries.map((entry) => entry.name).sort();
  [
    'canonical/readiness_report.json',
    'docs/standard_docs_manifest.json',
    'release_bundle_checksums.sha256',
    'release_bundle_log.json',
    'release_bundle_manifest.json',
  ].forEach((entryName) => {
    assert(zipEntryNames.includes(entryName), `Release dry-run ZIP should include ${entryName}`);
  });

  const checksumLineCount = assertChecksumFormat(checksumsPath);
  assertNoHostPaths(readFileSync(manifestPath, 'utf8'), 'release bundle manifest');
  assertNoHostPaths(readFileSync(logPath, 'utf8'), 'release bundle log');

  const sourceHygieneRun = run(process.execPath, ['scripts/check-source-tree-hygiene.js']);
  assertCommandOk(sourceHygieneRun, 'source hygiene after release dry-run');
  const statusAfter = gitStatus();
  assert.equal(statusAfter, statusBefore, 'release dry-run doctor must not change git status outside ignored outputs');

  const report = {
    schema_version: '1.0',
    artifact_type: 'release_dry_run_doctor_report',
    generated_at: new Date().toISOString(),
    package_slug: options.packageSlug,
    output_dir: outputDirRel,
    dry_run_boundary: {
      dry_run_only: true,
      output_is_git_ignored: true,
      canonical_readiness_regenerated: false,
      canonical_package_artifacts_mutated: false,
      inspection_evidence_attached: false,
      evidence_readiness_audit_ran: true,
      stage5b_evidence_attached_or_promoted: false,
      git_tag_created: false,
      github_release_created: false,
      artifacts_uploaded: false,
      npm_published: false,
    },
    inputs: {
      readiness_report: repoRelative(readinessPath),
      docs_manifest: repoRelative(docsManifestPath),
    },
    outputs: {
      release_bundle: repoRelative(bundlePath),
      release_bundle_manifest: repoRelative(manifestPath),
      release_bundle_log: repoRelative(logPath),
      release_bundle_checksums: repoRelative(checksumsPath),
      release_bundle_artifact_manifest: repoRelative(artifactManifestPath),
      evidence_readiness_audit: repoRelative(evidenceAuditPath),
      evidence_readiness_audit_summary: repoRelative(evidenceAuditSummaryPath),
      doctor_report: repoRelative(doctorReportPath),
    },
    checks: {
      manifest_contract_command: manifest.contract?.command,
      zip_entry_count: zipEntries.length,
      checksum_line_count: checksumLineCount,
      evidence_readiness_audit_decision: evidenceAudit.audit.summary.decision,
      evidence_readiness_release_overclaim_risk_count: evidenceAudit.audit.summary.release_overclaim_risk_count,
      evidence_readiness_evidence_graph_package_count: evidenceAudit.audit.summary.evidence_graph_package_count,
      evidence_readiness_runtime_fingerprint_package_count: evidenceAudit.audit.summary.runtime_fingerprint_package_count,
      evidence_readiness_qif_lite_package_count: evidenceAudit.audit.summary.qif_lite_package_count,
      evidence_readiness_pr170_artifact_coverage: evidenceAudit.audit.summary.pr170_artifact_coverage,
      source_hygiene_after_dry_run: 'pass',
      git_status_unchanged_outside_ignored_outputs: true,
    },
    commands: [
      {
        name: 'pack',
        argv: publicCommand(packRun.command),
        status: packRun.status,
      },
      {
        name: 'source_hygiene',
        argv: publicCommand(sourceHygieneRun.command),
        status: sourceHygieneRun.status,
      },
    ],
  };
  writeFileSync(doctorReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('release-dry-run-doctor: ok');
  console.log(`  package: ${options.packageSlug}`);
  console.log(`  output: ${outputDirRel}`);
  console.log('  boundary: no publish, no tag, no upload, no evidence attachment, no canonical readiness regeneration');
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

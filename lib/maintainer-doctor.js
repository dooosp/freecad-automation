import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_MAINTAINER_DOCTOR_OUT_DIR = 'output/maintainer-doctor';
export const MAINTAINER_DOCTOR_REPORT_NAME = 'maintainer_doctor_report.json';

export const REQUIRED_MAINTAINER_DOCTOR_SCRIPTS = Object.freeze({
  'maintainer:doctor': 'node scripts/maintainer-doctor.js',
  'evidence:readiness:audit': 'node bin/fcad.js evidence-readiness-audit --out-dir output/evidence-readiness-audit',
  'check:source-hygiene': 'node scripts/check-source-tree-hygiene.js',
  'test:stage5b:pipeline-doctor': 'node tests/stage5b-evidence-pipeline-doctor.test.js',
  'release:dry-run:doctor': 'node scripts/release-dry-run-doctor.js',
  'test:node:contract': 'node tests/run-node-lane.js contract',
  test: 'node scripts/run-test-suite.js default-node',
});

export const MAINTAINER_DOCTOR_CHECKS = Object.freeze([
  Object.freeze({
    id: 'evidence_readiness_audit',
    label: 'Evidence/readiness maintainer audit',
    mode: 'run',
    argv: Object.freeze(['npm', 'run', 'evidence:readiness:audit', '--', '--clean']),
    detects: Object.freeze(['canonical readiness hold reasons', 'evidence boundary drift', 'release readiness overclaim']),
  }),
  Object.freeze({
    id: 'source_hygiene',
    label: 'Source hygiene',
    mode: 'run',
    argv: Object.freeze(['npm', 'run', 'check:source-hygiene']),
    detects: Object.freeze(['tracked generated artifacts', 'generated output policy drift']),
  }),
  Object.freeze({
    id: 'stage5b_pipeline_doctor',
    label: 'Stage 5B pipeline doctor',
    mode: 'run',
    argv: Object.freeze(['npm', 'run', 'test:stage5b:pipeline-doctor']),
    detects: Object.freeze(['Stage 5B source pipeline drift', 'raw inbox leakage', 'evidence overclaim']),
  }),
  Object.freeze({
    id: 'release_dry_run_doctor',
    label: 'Release dry-run doctor',
    mode: 'run',
    argv: Object.freeze(['npm', 'run', 'release:dry-run:doctor', '--', '--clean']),
    detects: Object.freeze(['release dry-run contract drift', 'generated release output policy drift']),
  }),
  Object.freeze({
    id: 'node_contract_discoverability',
    label: 'Node contract discoverability',
    mode: 'static',
    argv: Object.freeze([]),
    detects: Object.freeze(['missing npm scripts', 'test lane discoverability drift']),
  }),
  Object.freeze({
    id: 'docs_source_of_truth',
    label: 'Docs/source-of-truth drift',
    mode: 'run',
    argv: Object.freeze(['node', 'tests/source-of-truth-drift.test.js']),
    detects: Object.freeze(['stale docs references', 'script/docs mismatch']),
  }),
  Object.freeze({
    id: 'stage5b_source_of_truth_guard',
    label: 'Stage 5B source-of-truth guard',
    mode: 'run',
    argv: Object.freeze(['node', 'tests/stage5b-source-of-truth-guard.test.js']),
    detects: Object.freeze(['Stage 5B command/API/Studio/docs drift']),
  }),
  Object.freeze({
    id: 'stage5b_artifact_catalog_guard',
    label: 'Stage 5B artifact/schema catalog guard',
    mode: 'run',
    argv: Object.freeze(['node', 'tests/stage5b-artifact-catalog.test.js']),
    detects: Object.freeze(['artifact catalog drift', 'schema discoverability drift']),
  }),
  Object.freeze({
    id: 'generated_output_policy',
    label: 'Generated output policy',
    mode: 'static',
    argv: Object.freeze([]),
    detects: Object.freeze(['tracked generated output', 'ignored output policy drift']),
  }),
  Object.freeze({
    id: 'workflow_check_name_drift',
    label: 'Workflow/check-name drift',
    mode: 'run',
    argv: Object.freeze(['node', 'tests/lane-manifest.test.js']),
    detects: Object.freeze(['workflow command drift', 'check-name drift', 'action pin drift']),
  }),
  Object.freeze({
    id: 'overclaim_guard',
    label: 'Readiness/release/evidence overclaim guard',
    mode: 'run',
    argv: Object.freeze(['node', 'tests/portfolio-evidence-boundary.test.js']),
    detects: Object.freeze(['overclaimed readiness statements', 'release/evidence boundary drift']),
  }),
]);

const REQUIRED_DOCS = Object.freeze([
  'README.md',
  'docs/ci-governance.md',
  'docs/testing.md',
  'docs/final-maintainer-handoff.md',
  'docs/stage-5b-operational-runbook.md',
  'docs/stage-5b-artifact-schema-catalog.md',
]);

const REQUIRED_SCHEMAS = Object.freeze([
  'schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json',
  'schemas/stage5b-evidence-review-dry-run-manifest.schema.json',
  'schemas/stage5b-evidence-attachment-control-manifest.schema.json',
  'schemas/stage5b-intake-report.schema.json',
  'schemas/stage5b-promotion-dry-run-manifest.schema.json',
  'schemas/stage5b-audit-manifest.schema.json',
  'schemas/release_bundle_manifest.schema.json',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.md',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const POSIX_PRIVATE_ROOTS = Object.freeze(['Users', 'home', 'private', 'var']);
const POSIX_PRIVATE_ROOT_PATTERN = POSIX_PRIVATE_ROOTS.join('|');
const PRIVATE_PATH_PATTERN = new RegExp(
  `(^|[\\s"'(=:])(/(?:${POSIX_PRIVATE_ROOT_PATTERN})/[^\\s"'<>)]*)`,
  'g'
);
const WINDOWS_USER_PATH_PATTERN = /(^|[\s"'(=:])([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s"'<>)]*)/g;
const TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_./+=-]{16,})/gi;
const PRIVATE_URL_PATTERN = /\bhttps?:\/\/(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|[^/\s"'<>]+\.internal(?:[/:?#]|$))[^\s"'<>]*/gi;
const PII_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

function repoRelative(projectRoot, pathValue) {
  const relPath = relative(resolve(projectRoot), resolve(projectRoot, pathValue)).split(sep).join('/');
  if (!relPath || relPath.startsWith('..') || isAbsolute(relPath)) {
    throw new Error(`Path must stay inside repository root: ${pathValue}`);
  }
  return relPath;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function posixRootPath(rootName) {
  return `/${rootName}`;
}

function sanitizeText(value) {
  let sanitized = String(value || '').replaceAll(resolve(import.meta.dirname, '..'), '<repo-root>');
  for (const rootName of POSIX_PRIVATE_ROOTS) {
    const rootPath = posixRootPath(rootName);
    sanitized = sanitized.replace(
      new RegExp(`${escapeRegExp(rootPath)}/[^/\\s"'<>)]*`, 'g'),
      `${rootPath}/<redacted>`
    );
  }
  return sanitized
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\s"'<>)]*/g, ['C:', 'Users', '<redacted>'].join('/'))
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, '<github-token>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+/g, '<github-token>')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '<api-token>');
}

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function readTextIfExists(projectRoot, relativePath) {
  const pathValue = resolve(projectRoot, relativePath);
  return existsSync(pathValue) ? readFileSync(pathValue, 'utf8') : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function isRepoTextFile(pathValue) {
  if (pathValue.startsWith('node_modules/') || pathValue.startsWith('output/')) return false;
  const extension = extname(pathValue).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  if (/\.(?:zip|png|jpe?g|webp|pdf|step|stp|stl|brep|fcstd|dxf)$/i.test(pathValue)) return false;
  return true;
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function pushRegexFindings({ findings, path, text, pattern, kind, skipForTests = false }) {
  if (skipForTests && path.startsWith('tests/')) return;
  for (const match of text.matchAll(pattern)) {
    const matchedValue = match[2] || match[0];
    if (kind === 'absolute_private_path' && /^\/(?:Users|home|private|var)\/?$/.test(matchedValue)) {
      continue;
    }
    findings.push({
      path,
      kind,
      line: lineNumberForIndex(text, match.index || 0),
      sample_sha256: sha256(match[0]).slice(0, 16),
    });
  }
}

export function findSensitiveLeakage(files) {
  const findings = [];
  for (const file of files) {
    const path = String(file.path || '').replaceAll('\\', '/');
    const text = String(file.text || '');
    if (path.startsWith('tests/')) continue;
    pushRegexFindings({
      findings,
      path,
      text,
      pattern: PRIVATE_PATH_PATTERN,
      kind: 'absolute_private_path',
      skipForTests: true,
    });
    pushRegexFindings({
      findings,
      path,
      text,
      pattern: WINDOWS_USER_PATH_PATTERN,
      kind: 'absolute_private_path',
      skipForTests: true,
    });
    pushRegexFindings({ findings, path, text, pattern: TOKEN_PATTERN, kind: 'token_or_secret' });
    pushRegexFindings({ findings, path, text, pattern: PRIVATE_URL_PATTERN, kind: 'private_url' });
    pushRegexFindings({ findings, path, text, pattern: PII_PATTERN, kind: 'pii_pattern' });
  }
  return findings.sort((a, b) => `${a.path}:${a.line}:${a.kind}`.localeCompare(`${b.path}:${b.line}:${b.kind}`));
}

function listTrackedTextFiles(projectRoot) {
  const listed = runGit(projectRoot, ['ls-files', '-z']);
  if (!listed.ok) return [];
  return listed.stdout
    .split('\0')
    .filter(Boolean)
    .filter(isRepoTextFile)
    .map((path) => {
      try {
        const absolute = resolve(projectRoot, path);
        const stats = statSync(absolute);
        if (stats.size > 2 * 1024 * 1024) return null;
        const text = readFileSync(absolute, 'utf8');
        if (text.includes('\0')) return null;
        return { path, text };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function checkGitIgnored(projectRoot, relativePath) {
  const result = runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  return result.status === 0;
}

function assertIgnoredOutputDir(projectRoot, outDirRel) {
  const normalized = String(outDirRel || DEFAULT_MAINTAINER_DOCTOR_OUT_DIR).replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.startsWith('output/')) {
    throw new Error('maintainer doctor out-dir must stay under ignored output/');
  }
  const absolute = resolve(projectRoot, normalized);
  const rel = repoRelative(projectRoot, absolute);
  if (!checkGitIgnored(projectRoot, `${rel}/`) && !checkGitIgnored(projectRoot, rel)) {
    throw new Error(`maintainer doctor out-dir must be ignored by git: ${rel}`);
  }
  return { absolute, relative: rel };
}

function parseArgsFromRemoteHead(value) {
  const text = String(value || '').trim();
  return text.replace(/^refs\/remotes\//, '');
}

function remoteMatchesFreecadAutomation(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  return /(?:^|[:/])dooosp\/freecad-automation(?:\.git)?$/i.test(value)
    || /(?:^|[:/])freecad-automation(?:\.git)?$/i.test(value);
}

function collectPreflight(projectRoot) {
  const rootResult = runGit(projectRoot, ['rev-parse', '--show-toplevel']);
  const repoRoot = rootResult.ok ? rootResult.stdout.trim() : projectRoot;
  const branch = runGit(projectRoot, ['branch', '--show-current']);
  const head = runGit(projectRoot, ['rev-parse', 'HEAD']);
  const remoteHead = runGit(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const remoteUrl = runGit(projectRoot, ['config', '--get', 'remote.origin.url']);
  const remoteDefaultHead = remoteHead.ok ? parseArgsFromRemoteHead(remoteHead.stdout) : null;
  const remoteDefaultHeadSha = remoteDefaultHead ? runGit(projectRoot, ['rev-parse', remoteDefaultHead]) : null;
  const status = runGit(projectRoot, ['status', '--short', '--branch']);
  const dirty = runGit(projectRoot, ['status', '--porcelain', '--untracked-files=all']);
  const packageJson = existsSync(resolve(projectRoot, 'package.json'))
    ? readJson(resolve(projectRoot, 'package.json'))
    : {};
  const basenameOk = basename(repoRoot) === 'freecad-automation';
  const packageOk = packageJson.name === 'freecad-automation';
  const remoteOk = remoteUrl.ok && remoteMatchesFreecadAutomation(remoteUrl.stdout);
  const repoIdentityOk = packageOk && (basenameOk || remoteOk);
  return {
    repo_root_basename: basename(repoRoot),
    repo_package_name: packageJson.name || null,
    repo_identity_ok: repoIdentityOk,
    repo_identity_signals: {
      basename_ok: basenameOk,
      package_name_ok: packageOk,
      remote_url_ok: remoteOk,
    },
    current_branch: branch.ok ? branch.stdout.trim() || null : null,
    head_sha: head.ok ? head.stdout.trim() || null : null,
    remote_default_head: remoteDefaultHead,
    remote_default_head_sha: remoteDefaultHeadSha?.ok ? remoteDefaultHeadSha.stdout.trim() || null : null,
    dirty_tree: dirty.ok ? dirty.stdout.trim().length > 0 : null,
    dirty_path_count: dirty.ok ? dirty.stdout.split('\n').filter(Boolean).length : null,
    checkout_safety: {
      status_summary: sanitizeText(status.stdout).trim(),
      repo_identity_ok: repoIdentityOk,
      head_discovered: head.ok,
      remote_default_head_discovered: Boolean(remoteDefaultHead),
    },
  };
}

function collectInventory(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const workflowDir = resolve(projectRoot, '.github', 'workflows');
  const workflowFiles = existsSync(workflowDir)
    ? readdirSync(workflowDir).filter((name) => /\.(?:ya?ml)$/i.test(name)).sort()
    : [];
  const workflowNames = workflowFiles.map((name) => {
    const text = readFileSync(join(workflowDir, name), 'utf8');
    const match = text.match(/^name:\s*(.+)$/m);
    return { path: `.github/workflows/${name}`, name: match ? match[1].trim() : null };
  });
  return {
    scripts: Object.keys(packageJson.scripts || {}).sort(),
    workflows: workflowNames,
    docs: REQUIRED_DOCS.map((path) => ({ path, exists: existsSync(resolve(projectRoot, path)) })),
    schemas: REQUIRED_SCHEMAS.map((path) => ({ path, exists: existsSync(resolve(projectRoot, path)) })),
    artifact_catalog: {
      path: 'docs/stage-5b-artifact-schema-catalog.md',
      exists: existsSync(resolve(projectRoot, 'docs/stage-5b-artifact-schema-catalog.md')),
    },
    generated_output_policy: {
      gitignore_paths: ['output/', '.ci/', 'tmp/codex/', 'local/stage5b-candidate-evidence-inbox/']
        .map((path) => ({
          path,
          documented: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm')
            .test(readTextIfExists(projectRoot, '.gitignore')),
        })),
    },
  };
}

function checkRequiredScripts(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const missing = [];
  const mismatched = [];
  Object.entries(REQUIRED_MAINTAINER_DOCTOR_SCRIPTS).forEach(([scriptName, expected]) => {
    const actual = packageJson.scripts?.[scriptName];
    if (!actual) {
      missing.push(scriptName);
    } else if (actual !== expected) {
      mismatched.push({ script: scriptName, expected, actual });
    }
  });
  return {
    status: missing.length || mismatched.length ? 'fail' : 'pass',
    missing,
    mismatched,
  };
}

function checkNodeContractDiscoverability(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const laneManifest = readTextIfExists(projectRoot, 'tests/lane-manifest.js');
  const runNodeLane = readTextIfExists(projectRoot, 'tests/run-node-lane.js');
  const findings = [];
  if (packageJson.scripts?.['test:node:contract'] !== 'node tests/run-node-lane.js contract') {
    findings.push('package_json_test_node_contract_mismatch');
  }
  if (!laneManifest.includes("id: 'contract'")) findings.push('contract_lane_missing');
  if (!laneManifest.includes("npmScript: 'test:node:contract'")) findings.push('contract_lane_script_missing');
  if (!runNodeLane.includes('getNodeLane')) findings.push('run_node_lane_discovery_missing');
  return {
    status: findings.length ? 'fail' : 'pass',
    findings,
  };
}

function checkGeneratedOutputPolicy(projectRoot, outputDirRel) {
  const trackedOutput = runGit(projectRoot, ['ls-files', '--', 'output', 'tmp/codex', '.ci']);
  const trackedInbox = runGit(projectRoot, ['ls-files', '--', 'local/stage5b-candidate-evidence-inbox']);
  const inboxStatus = runGit(projectRoot, ['status', '--short', '--', 'local/stage5b-candidate-evidence-inbox']);
  const gitignore = readTextIfExists(projectRoot, '.gitignore');
  const missingGitignoreEntries = ['output/', '.ci/', 'tmp/codex/', 'local/stage5b-candidate-evidence-inbox/']
    .filter((entry) => !new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(gitignore));
  const outputIgnored = checkGitIgnored(projectRoot, `${outputDirRel.replace(/\/+$/, '')}/`);
  const trackedGenerated = (trackedOutput.stdout || '').split('\n').filter(Boolean);
  const trackedRawInbox = (trackedInbox.stdout || '').split('\n').filter(Boolean);
  const dirtyRawInbox = (inboxStatus.stdout || '').split('\n').filter(Boolean).map(sanitizeText);
  return {
    generated_output_policy: {
      status: trackedGenerated.length || missingGitignoreEntries.length || !outputIgnored ? 'fail' : 'pass',
      tracked_generated_output_count: trackedGenerated.length,
      tracked_generated_output: trackedGenerated,
      missing_gitignore_entries: missingGitignoreEntries,
      maintainer_doctor_output_ignored: outputIgnored,
    },
    raw_inbox_leakage: {
      status: trackedRawInbox.length || dirtyRawInbox.length ? 'fail' : 'pass',
      tracked_raw_inbox_count: trackedRawInbox.length,
      dirty_raw_inbox_count: dirtyRawInbox.length,
      tracked_raw_inbox: trackedRawInbox,
      dirty_raw_inbox: dirtyRawInbox,
    },
  };
}

function checkDocsAndSchemas(projectRoot) {
  const missingDocs = REQUIRED_DOCS.filter((path) => !existsSync(resolve(projectRoot, path)));
  const missingSchemas = REQUIRED_SCHEMAS.filter((path) => !existsSync(resolve(projectRoot, path)));
  return {
    status: missingDocs.length || missingSchemas.length ? 'fail' : 'pass',
    missing_docs: missingDocs,
    missing_schemas: missingSchemas,
  };
}

function checkSensitiveLeakage(projectRoot) {
  const findings = findSensitiveLeakage(listTrackedTextFiles(projectRoot));
  return {
    status: findings.length ? 'fail' : 'pass',
    finding_count: findings.length,
    findings,
  };
}

function collectStaticChecks(projectRoot, outputDirRel) {
  const generatedPolicy = checkGeneratedOutputPolicy(projectRoot, outputDirRel);
  return {
    required_scripts: checkRequiredScripts(projectRoot),
    node_contract_discoverability: checkNodeContractDiscoverability(projectRoot),
    docs_and_schemas_present: checkDocsAndSchemas(projectRoot),
    generated_output_policy: generatedPolicy.generated_output_policy,
    raw_inbox_leakage: generatedPolicy.raw_inbox_leakage,
    sensitive_leakage: checkSensitiveLeakage(projectRoot),
  };
}

function canonicalPackageSlugs(projectRoot) {
  const manifestPath = resolve(projectRoot, 'docs', 'examples', 'example-library-manifest.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = readJson(manifestPath);
  return (Array.isArray(manifest.examples) ? manifest.examples : [])
    .filter((example) => example?.status === 'canonical-package')
    .map((example) => example.docs_example_root?.split('/').at(-1) || example.slug)
    .filter(Boolean)
    .sort();
}

function summarizeCanonicalReadiness(projectRoot) {
  return canonicalPackageSlugs(projectRoot).map((slug) => {
    const readinessPath = resolve(projectRoot, 'docs', 'examples', slug, 'readiness', 'readiness_report.json');
    const readiness = existsSync(readinessPath) ? readJson(readinessPath) : {};
    const summary = readiness.readiness_summary || {};
    return {
      slug,
      status: summary.status || null,
      score: summary.score ?? null,
      gate_decision: summary.gate_decision || null,
      inspection_evidence_missing: summary.gate_decision === 'hold_for_evidence_completion',
    };
  });
}

function summarizeMaintainerTruth(projectRoot) {
  const ciGovernancePresent = existsSync(resolve(projectRoot, 'docs', 'ci-governance.md'));
  const releaseDoctorPresent = existsSync(resolve(projectRoot, 'scripts', 'release-dry-run-doctor.js'));
  const evidenceReadinessAuditAvailable = existsSync(resolve(projectRoot, 'src/services/evidence-readiness-audit/evidence-readiness-audit-service.js'));
  const readiness = summarizeCanonicalReadiness(projectRoot);
  const allHeld = readiness.length > 0
    && readiness.every((entry) => entry.status === 'needs_more_evidence' && entry.gate_decision === 'hold_for_evidence_completion');
  return {
    stage5b_governance_closed: true,
    ci_governance_closed: true,
    release_dry_run_governance_closed: releaseDoctorPresent,
    stage5b_held: allHeld,
    canonical_package_readiness: readiness,
    real_inspection_evidence_attached: false,
    release_published: false,
    evidence_readiness_audit_available: evidenceReadinessAuditAvailable,
    ci_governance_docs_present: ciGovernancePresent,
    runtime_smoke_truth: 'Runtime smoke is hosted/self-hosted or maintainer-local guidance; it is not production proof and is not run by this doctor unless a maintainer runs the explicit runtime lane.',
  };
}

function defaultRunCommand(check, { projectRoot }) {
  const [command, ...args] = check.argv;
  const start = Date.now();
  const completed = spawnSync(command === 'node' ? process.execPath : command, command === 'node' ? args : args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return {
    command: check.argv,
    status: completed.status ?? 1,
    stdout: completed.stdout || '',
    stderr: completed.stderr || '',
    duration_ms: Date.now() - start,
  };
}

function commandReport(check, result) {
  const status = result.status === 0 ? 'pass' : 'fail';
  return {
    id: check.id,
    label: check.label,
    mode: check.mode,
    status,
    exit_code: result.status,
    duration_ms: result.duration_ms ?? null,
    argv: [...check.argv],
    detects: [...check.detects],
    stdout_sha256: result.stdout ? sha256(sanitizeText(result.stdout)) : null,
    stderr_sha256: result.stderr ? sha256(sanitizeText(result.stderr)) : null,
  };
}

function staticCheckReports(staticChecks) {
  return Object.entries(staticChecks).map(([id, check]) => ({
    id,
    status: check.status,
  }));
}

function collectBlockers({ preflight, staticChecks, commandReports }) {
  const blockers = [];
  if (!preflight.repo_identity_ok) {
    blockers.push({
      code: 'repo_identity_mismatch',
      gate: 'preflight',
      message: 'Repository identity must resolve to freecad-automation before maintainer doctor output can be trusted.',
    });
  }
  Object.entries(staticChecks).forEach(([id, check]) => {
    if (check.status !== 'pass') {
      blockers.push({
        code: `${id}_failed`,
        gate: id,
        message: `Static maintainer doctor check failed: ${id}`,
      });
    }
  });
  commandReports.forEach((check) => {
    if (check.status !== 'pass') {
      blockers.push({
        code: `${check.id}_failed`,
        gate: check.id,
        message: `Maintainer doctor command failed: ${check.label}`,
      });
    }
  });
  return blockers;
}

function collectGithubMetadata(projectRoot) {
  const ghVersion = spawnSync('gh', ['--version'], { cwd: projectRoot, encoding: 'utf8' });
  if (ghVersion.status !== 0) {
    return { mode: 'unavailable', reason: 'gh_not_available' };
  }
  const prList = spawnSync('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '50',
    '--json',
    'number,title,headRefName,baseRefName,isDraft,url,updatedAt',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (prList.status !== 0) {
    return {
      mode: 'unavailable',
      reason: 'gh_pr_list_failed',
      stderr_sha256: sha256(sanitizeText(prList.stderr || prList.stdout || '')),
    };
  }
  let openPullRequests = [];
  try {
    openPullRequests = JSON.parse(prList.stdout || '[]');
  } catch {
    return { mode: 'unavailable', reason: 'gh_pr_list_json_parse_failed' };
  }
  return {
    mode: 'included',
    open_pull_request_count: openPullRequests.length,
    open_pull_requests: openPullRequests.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      isDraft: pr.isDraft,
      url: pr.url,
      updatedAt: pr.updatedAt,
    })),
  };
}

export async function runMaintainerDoctor({
  projectRoot = resolve(import.meta.dirname, '..'),
  outDir = DEFAULT_MAINTAINER_DOCTOR_OUT_DIR,
  clean = false,
  includeGithub = false,
  now = () => new Date().toISOString(),
  runCommand = defaultRunCommand,
} = {}) {
  const root = resolve(projectRoot);
  const outputDir = assertIgnoredOutputDir(root, outDir);
  if (clean) {
    rmSync(outputDir.absolute, { recursive: true, force: true });
  }
  await mkdir(outputDir.absolute, { recursive: true });

  const preflight = collectPreflight(root);
  const inventory = collectInventory(root);
  const staticChecks = collectStaticChecks(root, outputDir.relative);
  const commandReports = [];
  for (const check of MAINTAINER_DOCTOR_CHECKS.filter((entry) => entry.mode === 'run')) {
    const result = await runCommand(check, { projectRoot: root });
    commandReports.push(commandReport(check, result));
  }

  const staticReports = staticCheckReports(staticChecks);
  const blockers = collectBlockers({ preflight, staticChecks, commandReports });
  const report = {
    schema_version: '1.0',
    artifact_type: 'maintainer_doctor_report',
    generated_at: now(),
    output_dir: outputDir.relative,
    boundary: {
      local_only: true,
      network_required: false,
      optional_github_metadata: Boolean(includeGithub),
      production_called: false,
      published_release: false,
      git_tag_created: false,
      artifacts_uploaded: false,
      inspection_evidence_attached: false,
      stage5b_evidence_promoted: false,
      canonical_readiness_regenerated: false,
      github_settings_changed: false,
    },
    preflight,
    inventory,
    current_repo_truth: summarizeMaintainerTruth(root),
    github_metadata: includeGithub
      ? collectGithubMetadata(root)
      : { mode: 'skipped', reason: 'use --include-github for optional open PR metadata' },
    static_checks: staticChecks,
    checks: commandReports,
    static_check_summary: staticReports,
    summary: {
      decision: blockers.length ? 'hold' : 'pass',
      command_count: commandReports.length,
      failed_check_count: commandReports.filter((check) => check.status !== 'pass').length
        + staticReports.filter((check) => check.status !== 'pass').length,
      blocker_count: blockers.length,
      blockers,
    },
  };

  const reportPath = join(outputDir.absolute, MAINTAINER_DOCTOR_REPORT_NAME);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {
    exitCode: blockers.length ? 1 : 0,
    report,
    reportPath,
  };
}

export function maintainerDoctorUsage() {
  return [
    'Usage: node scripts/maintainer-doctor.js [--out-dir <ignored-output-dir>] [--clean] [--include-github]',
    '',
    'Runs the local maintainer handoff doctor and writes output/maintainer-doctor/maintainer_doctor_report.json by default.',
    'The command is local-only by default and never publishes, tags, uploads, attaches evidence, regenerates readiness, changes GitHub settings, or calls production.',
  ].join('\n');
}

export function parseMaintainerDoctorArgs(argv = []) {
  const options = {
    outDir: DEFAULT_MAINTAINER_DOCTOR_OUT_DIR,
    clean: false,
    includeGithub: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { ...options, help: true };
    }
    if (arg === '--out-dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('--out-dir requires a value');
      options.outDir = value;
      index += 1;
    } else if (arg === '--clean') {
      options.clean = true;
    } else if (arg === '--include-github') {
      options.includeGithub = true;
    } else {
      throw new Error(`Unknown maintainer doctor argument: ${arg}\n\n${maintainerDoctorUsage()}`);
    }
  }
  return options;
}

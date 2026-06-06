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

import { findSensitiveLeakage } from './maintainer-doctor.js';

export const DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR = 'output/bootstrap-doctor';
export const BOOTSTRAP_DOCTOR_REPORT_NAME = 'bootstrap_doctor_report.json';

export const REQUIRED_BOOTSTRAP_DOCTOR_SCRIPTS = Object.freeze({
  'bootstrap:doctor': 'node scripts/bootstrap-doctor.js',
  'maintainer:doctor': 'node scripts/maintainer-doctor.js',
  'release:dry-run:doctor': 'node scripts/release-dry-run-doctor.js',
  'check:source-hygiene': 'node scripts/check-source-tree-hygiene.js',
  'test:stage5b:pipeline-doctor': 'node tests/stage5b-evidence-pipeline-doctor.test.js',
  'test:node:contract': 'node tests/run-node-lane.js contract',
  test: 'node scripts/run-test-suite.js default-node',
});

export const BOOTSTRAP_DOCTOR_COMMANDS = Object.freeze([
  Object.freeze({
    id: 'npm_ci',
    label: 'Clean npm install',
    argv: Object.freeze(['npm', 'ci']),
    detects: Object.freeze(['lockfile drift', 'fresh-clone install failure', 'missing package manager']),
  }),
  Object.freeze({
    id: 'local_cli_help',
    label: 'Local CLI help discoverability',
    argv: Object.freeze(['node', 'bin/fcad.js', '--help']),
    detects: Object.freeze(['broken bin entrypoint', 'stale CLI command surface']),
  }),
  Object.freeze({
    id: 'source_hygiene',
    label: 'Source hygiene',
    argv: Object.freeze(['npm', 'run', 'check:source-hygiene']),
    detects: Object.freeze(['tracked generated artifacts', 'generated output policy drift']),
  }),
  Object.freeze({
    id: 'maintainer_doctor_clean',
    label: 'Maintainer doctor',
    argv: Object.freeze([
      'npm',
      'run',
      'maintainer:doctor',
      '--',
      '--clean',
      '--out-dir',
      'output/bootstrap-doctor/maintainer-doctor',
    ]),
    detects: Object.freeze(['maintainer handoff drift', 'docs/source-of-truth drift', 'overclaimed readiness']),
  }),
  Object.freeze({
    id: 'release_dry_run_doctor_clean',
    label: 'Release dry-run doctor',
    argv: Object.freeze([
      'npm',
      'run',
      'release:dry-run:doctor',
      '--',
      '--clean',
      '--out-dir',
      'output/bootstrap-doctor/release-dry-run-doctor/quality-pass-bracket',
    ]),
    detects: Object.freeze(['release rehearsal drift', 'release output policy drift']),
  }),
  Object.freeze({
    id: 'stage5b_pipeline_doctor',
    label: 'Stage 5B pipeline doctor',
    argv: Object.freeze(['npm', 'run', 'test:stage5b:pipeline-doctor']),
    detects: Object.freeze(['Stage 5B fixture pipeline drift', 'raw evidence leakage', 'readiness overclaim']),
  }),
]);

const REQUIRED_DOCS = Object.freeze([
  'README.md',
  'docs/testing.md',
  'docs/ci-governance.md',
  'docs/final-maintainer-handoff.md',
  'docs/releases/v1.1.0-checklist.md',
]);

const IGNORED_LOCAL_PATHS = Object.freeze([
  'output/',
  '.ci/',
  'tmp/codex/',
  'local/stage5b-candidate-evidence-inbox/',
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

const COMMAND_READS_IGNORED_OUTPUT_PATTERN = /^(?:cat|less|more|open|pbcopy|jq|tail|head|sed)\b[^`]*\b(?:output|\.ci|tmp\/codex|local\/stage5b-candidate-evidence-inbox)\//;

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

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function sanitizeText(value) {
  return String(value || '')
    .replaceAll(resolve(import.meta.dirname, '..'), '<repo-root>')
    .replace(/\/(?:Users|home|private|var)\/[^\s"'<>)]*/g, (match) => {
      const root = match.split('/')[1] || 'path';
      return `/${root}/<redacted>`;
    })
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

function checkGitIgnored(projectRoot, relativePath) {
  const result = runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  return result.status === 0;
}

function assertIgnoredOutputDir(projectRoot, outDirRel) {
  const normalized = String(outDirRel || DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR).replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalized.startsWith('output/')) {
    throw new Error('bootstrap doctor out-dir must stay under ignored output/');
  }
  const absolute = resolve(projectRoot, normalized);
  const rel = repoRelative(projectRoot, absolute);
  if (!checkGitIgnored(projectRoot, `${rel}/`) && !checkGitIgnored(projectRoot, rel)) {
    throw new Error(`bootstrap doctor out-dir must be ignored by git: ${rel}`);
  }
  return { absolute, relative: rel };
}

function isRepoTextFile(pathValue) {
  if (pathValue.startsWith('node_modules/') || pathValue.startsWith('output/')) return false;
  const extension = extname(pathValue).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  if (/\.(?:zip|png|jpe?g|webp|pdf|step|stp|stl|brep|fcstd|dxf)$/i.test(pathValue)) return false;
  return true;
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

function listTrackedMarkdownDocs(projectRoot) {
  const listed = runGit(projectRoot, ['ls-files', '-z', '--', '*.md']);
  if (!listed.ok) return [];
  return listed.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => path === 'README.md' || path.startsWith('docs/'))
    .map((path) => {
      try {
        return { path, text: readFileSync(resolve(projectRoot, path), 'utf8') };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeMarkdownTarget(target) {
  let value = String(target || '').trim();
  if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('#')) return null;
  value = value.split('#')[0].split('?')[0].replaceAll('\\', '/');
  while (value.startsWith('../')) value = value.slice(3);
  while (value.startsWith('./')) value = value.slice(2);
  return value;
}

function isIgnoredLocalPathRef(pathRef) {
  const normalized = normalizeMarkdownTarget(pathRef);
  if (!normalized) return false;
  return IGNORED_LOCAL_PATHS.some((ignoredPath) => (
    normalized === ignoredPath.replace(/\/$/, '')
    || normalized.startsWith(ignoredPath)
  ));
}

export function findMissingDocumentedNpmScripts({ packageScripts, docs }) {
  const scripts = packageScripts || {};
  const findings = [];
  const seen = new Set();
  for (const doc of docs || []) {
    const text = String(doc.text || '');
    for (const match of text.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) {
      const script = match[1];
      if (scripts[script]) continue;
      const line = lineNumberForIndex(text, match.index || 0);
      const key = `${doc.path}:${line}:${script}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ path: doc.path, line, script });
    }
  }
  return findings.sort((a, b) => `${a.path}:${a.line}:${a.script}`.localeCompare(`${b.path}:${b.line}:${b.script}`));
}

export function findDocsLocalStateDependencies(docs) {
  const findings = [];
  for (const doc of docs || []) {
    const text = String(doc.text || '');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (!isIgnoredLocalPathRef(match[1])) continue;
      findings.push({
        path: doc.path,
        line: lineNumberForIndex(text, match.index || 0),
        kind: 'markdown_link_to_ignored_local_path',
      });
    }
    for (const match of text.matchAll(/`([^`]+)`/g)) {
      const command = String(match[1] || '').trim().replaceAll('\\', '/');
      if (!COMMAND_READS_IGNORED_OUTPUT_PATTERN.test(command)) continue;
      findings.push({
        path: doc.path,
        line: lineNumberForIndex(text, match.index || 0),
        kind: 'command_reads_ignored_output',
      });
    }
  }
  return findings.sort((a, b) => `${a.path}:${a.line}:${a.kind}`.localeCompare(`${b.path}:${b.line}:${b.kind}`));
}

function parseRemoteHead(value) {
  return String(value || '').trim().replace(/^refs\/remotes\//, '') || null;
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
  const remoteDefaultHead = remoteHead.ok ? parseRemoteHead(remoteHead.stdout) : null;
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
  const dirtyPaths = dirty.ok
    ? dirty.stdout.split('\n').filter(Boolean).map((line) => sanitizeText(line)).slice(0, 100)
    : [];
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
    dirty_tree: dirtyPaths.length > 0,
    dirty_path_count: dirtyPaths.length,
    dirty_paths_sample: dirtyPaths,
    checkout_safety: {
      status_summary: sanitizeText(status.stdout).trim(),
      repo_identity_ok: repoIdentityOk,
      head_discovered: head.ok,
      remote_default_head_discovered: Boolean(remoteDefaultHead),
      dirty_tree_is_reported_not_auto_cleaned: true,
    },
  };
}

function collectWorkflowNodeVersions(projectRoot) {
  const workflowDir = resolve(projectRoot, '.github', 'workflows');
  if (!existsSync(workflowDir)) return [];
  const versions = new Set();
  for (const file of readdirSync(workflowDir).filter((name) => /\.(?:ya?ml)$/i.test(name))) {
    const text = readFileSync(resolve(workflowDir, file), 'utf8');
    for (const match of text.matchAll(/node-version:\s*["']?([^"'\n#]+)/g)) {
      versions.add(match[1].trim());
    }
  }
  return [...versions].sort();
}

function commandVersion(command, args, projectRoot) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return {
    available: result.status === 0,
    version: result.status === 0 ? String(result.stdout || '').trim().split(/\r?\n/)[0] || null : null,
    failure_sha256: result.status === 0 ? null : sha256(sanitizeText(result.stderr || result.stdout || '')).slice(0, 16),
  };
}

function checkPackageManager(projectRoot, packageJson) {
  const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
    .filter((path) => existsSync(resolve(projectRoot, path)));
  if (lockfiles.includes('package-lock.json') || lockfiles.includes('npm-shrinkwrap.json')) return 'npm';
  if (lockfiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (lockfiles.includes('yarn.lock')) return 'yarn';
  if (/^npm@/.test(packageJson.packageManager || '')) return 'npm';
  if (/^pnpm@/.test(packageJson.packageManager || '')) return 'pnpm';
  if (/^yarn@/.test(packageJson.packageManager || '')) return 'yarn';
  return null;
}

function collectPrerequisites(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
    .filter((path) => existsSync(resolve(projectRoot, path)));
  const packageManager = checkPackageManager(projectRoot, packageJson);
  const npmVersion = commandVersion('npm', ['--version'], projectRoot);
  const failures = [];
  if (packageManager !== 'npm') {
    failures.push({
      code: 'npm_package_manager_not_detected',
      message: 'This repository bootstrap expects npm with package-lock.json so a fresh maintainer can run npm ci.',
    });
  }
  if (!lockfiles.includes('package-lock.json')) {
    failures.push({
      code: 'package_lock_missing',
      message: 'Missing package-lock.json; npm ci cannot prove a clean-clone install.',
    });
  }
  if (!npmVersion.available) {
    failures.push({
      code: 'npm_unavailable',
      message: 'npm is required for npm ci and npm run doctor scripts.',
    });
  }
  return {
    status: failures.length ? 'fail' : 'pass',
    package_manager: packageManager,
    package_manager_field: packageJson.packageManager || null,
    lockfile: lockfiles[0] || null,
    lockfiles,
    node: {
      current: process.version,
      package_engines: packageJson.engines?.node || null,
      workflow_node_versions: collectWorkflowNodeVersions(projectRoot),
    },
    npm: {
      available: npmVersion.available,
      current: npmVersion.version,
      package_engines: packageJson.engines?.npm || null,
      failure_sha256: npmVersion.failure_sha256,
    },
    failures,
  };
}

function collectInventory(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const workflowDir = resolve(projectRoot, '.github', 'workflows');
  const workflowFiles = existsSync(workflowDir)
    ? readdirSync(workflowDir).filter((name) => /\.(?:ya?ml)$/i.test(name)).sort()
    : [];
  return {
    scripts: Object.keys(packageJson.scripts || {}).sort(),
    workflows: workflowFiles.map((name) => {
      const text = readFileSync(resolve(workflowDir, name), 'utf8');
      const match = text.match(/^name:\s*(.+)$/m);
      return {
        path: `.github/workflows/${name}`,
        name: match ? match[1].trim() : null,
      };
    }),
    docs: REQUIRED_DOCS.map((path) => ({
      path,
      exists: existsSync(resolve(projectRoot, path)),
    })),
    generated_output_policy: {
      gitignore_paths: IGNORED_LOCAL_PATHS.map((path) => ({
        path,
        documented: new RegExp(`^${escapeRegExp(path)}$`, 'm').test(readTextIfExists(projectRoot, '.gitignore')),
      })),
    },
  };
}

function checkRequiredScripts(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const missing = [];
  const mismatched = [];
  Object.entries(REQUIRED_BOOTSTRAP_DOCTOR_SCRIPTS).forEach(([scriptName, expected]) => {
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

function checkGeneratedOutputPolicy(projectRoot, outputDirRel) {
  const trackedOutput = runGit(projectRoot, ['ls-files', '--', 'output', 'tmp/codex', '.ci']);
  const trackedInbox = runGit(projectRoot, ['ls-files', '--', 'local/stage5b-candidate-evidence-inbox']);
  const inboxStatus = runGit(projectRoot, ['status', '--short', '--', 'local/stage5b-candidate-evidence-inbox']);
  const gitignore = readTextIfExists(projectRoot, '.gitignore');
  const missingGitignoreEntries = IGNORED_LOCAL_PATHS
    .filter((entry) => !new RegExp(`^${escapeRegExp(entry)}$`, 'm').test(gitignore));
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
      bootstrap_doctor_output_ignored: outputIgnored,
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

function collectDocsAlignment(projectRoot) {
  const packageJson = readJson(resolve(projectRoot, 'package.json'));
  const docs = listTrackedMarkdownDocs(projectRoot);
  const missingDocs = REQUIRED_DOCS.filter((path) => !existsSync(resolve(projectRoot, path)));
  const missingDocumentedNpmScripts = findMissingDocumentedNpmScripts({
    packageScripts: packageJson.scripts || {},
    docs,
  });
  const localStateDependencies = findDocsLocalStateDependencies(docs);
  return {
    status: missingDocs.length || missingDocumentedNpmScripts.length || localStateDependencies.length ? 'fail' : 'pass',
    checked_doc_count: docs.length,
    required_docs_missing: missingDocs,
    missing_documented_npm_scripts: missingDocumentedNpmScripts,
    local_state_dependency_count: localStateDependencies.length,
    local_state_dependencies: localStateDependencies,
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

function collectStaticChecks(projectRoot, outputDirRel, docsAlignment) {
  const generatedPolicy = checkGeneratedOutputPolicy(projectRoot, outputDirRel);
  return {
    required_scripts: checkRequiredScripts(projectRoot),
    docs_alignment: {
      status: docsAlignment.status,
    },
    generated_output_policy: generatedPolicy.generated_output_policy,
    raw_inbox_leakage: generatedPolicy.raw_inbox_leakage,
    sensitive_leakage: checkSensitiveLeakage(projectRoot),
  };
}

function defaultRunCommand(command, { projectRoot }) {
  const [executable, ...args] = command.argv;
  const start = Date.now();
  const completed = spawnSync(executable === 'node' ? process.execPath : executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return {
    command: command.argv,
    status: completed.status ?? 1,
    stdout: completed.stdout || '',
    stderr: completed.stderr || '',
    duration_ms: Date.now() - start,
  };
}

function commandReport(command, result) {
  const status = result.status === 0 ? 'pass' : 'fail';
  return {
    id: command.id,
    label: command.label,
    status,
    exit_code: result.status,
    duration_ms: result.duration_ms ?? null,
    argv: [...command.argv],
    detects: [...command.detects],
    stdout_sha256: result.stdout ? sha256(sanitizeText(result.stdout)) : null,
    stderr_sha256: result.stderr ? sha256(sanitizeText(result.stderr)) : null,
    stdout_line_count: result.stdout ? result.stdout.split(/\r?\n/).filter(Boolean).length : 0,
    stderr_line_count: result.stderr ? result.stderr.split(/\r?\n/).filter(Boolean).length : 0,
    failure_message: status === 'fail'
      ? `${command.label} failed with exit ${result.status}; rerun ${command.argv.join(' ')} locally and inspect its local ignored output.`
      : null,
  };
}

function collectBlockers({ preflight, prerequisites, docsAlignment, staticChecks, commandReports }) {
  const blockers = [];
  if (!preflight.repo_identity_ok) {
    blockers.push({
      code: 'repo_identity_mismatch',
      gate: 'preflight',
      message: 'Repository identity must resolve to freecad-automation before bootstrap doctor output can be trusted.',
    });
  }
  if (prerequisites.status !== 'pass') {
    prerequisites.failures.forEach((failure) => blockers.push({
      code: failure.code,
      gate: 'prerequisites',
      message: failure.message,
    }));
  }
  if (docsAlignment.status !== 'pass') {
    blockers.push({
      code: 'docs_alignment_failed',
      gate: 'docs_alignment',
      message: 'Docs reference missing npm scripts or depend on ignored local output/inbox state.',
    });
  }
  Object.entries(staticChecks).forEach(([id, check]) => {
    if (check.status !== 'pass') {
      blockers.push({
        code: `${id}_failed`,
        gate: id,
        message: `Bootstrap static check failed: ${id}`,
      });
    }
  });
  commandReports.forEach((check) => {
    if (check.status !== 'pass') {
      blockers.push({
        code: `${check.id}_failed`,
        gate: check.id,
        message: `Bootstrap command failed: ${check.label}`,
      });
    }
  });
  return blockers;
}

function nextMaintainerAction(blockers) {
  if (blockers.length) {
    return 'Fix the listed bootstrap blockers, rerun npm run bootstrap:doctor -- --clean, and do not publish, tag, upload, attach evidence, or regenerate readiness from this doctor.';
  }
  return 'Review output/bootstrap-doctor/bootstrap_doctor_report.json, then proceed with the normal scoped PR checks; do not publish, tag, upload, attach evidence, or regenerate readiness from this doctor.';
}

export async function runBootstrapDoctor({
  projectRoot = resolve(import.meta.dirname, '..'),
  outDir = DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR,
  clean = false,
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
  const prerequisites = collectPrerequisites(root);
  const inventory = collectInventory(root);
  const docsAlignment = collectDocsAlignment(root);
  const staticChecks = collectStaticChecks(root, outputDir.relative, docsAlignment);
  const commandReports = [];
  for (const command of BOOTSTRAP_DOCTOR_COMMANDS) {
    const result = await runCommand(command, { projectRoot: root });
    commandReports.push(commandReport(command, result));
  }

  const blockers = collectBlockers({
    preflight,
    prerequisites,
    docsAlignment,
    staticChecks,
    commandReports,
  });
  const failedCheckCount = commandReports.filter((check) => check.status !== 'pass').length
    + Object.values(staticChecks).filter((check) => check.status !== 'pass').length
    + (prerequisites.status === 'pass' ? 0 : 1)
    + (docsAlignment.status === 'pass' ? 0 : 1);

  const report = {
    schema_version: '1.0',
    artifact_type: 'bootstrap_doctor_report',
    generated_at: now(),
    output_dir: outputDir.relative,
    boundary: {
      local_only: true,
      network_required: false,
      production_called: false,
      published_release: false,
      git_tag_created: false,
      artifacts_uploaded: false,
      inspection_evidence_attached: false,
      stage5b_evidence_promoted: false,
      canonical_readiness_regenerated: false,
      github_settings_changed: false,
      secrets_required: false,
    },
    preflight,
    prerequisites,
    inventory,
    docs_alignment: docsAlignment,
    static_checks: staticChecks,
    commands: commandReports,
    summary: {
      decision: blockers.length ? 'hold' : 'pass',
      command_count: commandReports.length,
      failed_check_count: failedCheckCount,
      blocker_count: blockers.length,
      blockers,
      next_maintainer_action: nextMaintainerAction(blockers),
    },
  };

  const reportPath = join(outputDir.absolute, BOOTSTRAP_DOCTOR_REPORT_NAME);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {
    exitCode: blockers.length ? 1 : 0,
    report,
    reportPath,
  };
}

export function bootstrapDoctorUsage() {
  return [
    'Usage: node scripts/bootstrap-doctor.js [--out-dir <ignored-output-dir>] [--clean]',
    '',
    'Runs the local first-maintainer bootstrap doctor and writes output/bootstrap-doctor/bootstrap_doctor_report.json by default.',
    'The command validates npm ci, local CLI help, source hygiene, maintainer doctor, release dry-run doctor, Stage 5B pipeline doctor, docs alignment, and generated-output policy.',
    'It never publishes, tags, uploads artifacts, attaches evidence, regenerates readiness, changes GitHub settings, calls production, or requires secrets.',
  ].join('\n');
}

export function parseBootstrapDoctorArgs(argv = []) {
  const options = {
    outDir: DEFAULT_BOOTSTRAP_DOCTOR_OUT_DIR,
    clean: false,
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
    } else {
      throw new Error(`Unknown bootstrap doctor argument: ${arg}\n\n${bootstrapDoctorUsage()}`);
    }
  }
  return options;
}

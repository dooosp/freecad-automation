import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  getCommandEntry,
} from '../../shared/command-manifest.js';
import {
  CANONICAL_PACKAGE_SLUGS,
} from '../../server/canonical-package-discovery.js';
import {
  assertValidStage5bEvidencePipelineDoctorManifest,
} from './stage5b-runtime-validation.js';
import {
  getStage5bArtifactSchemaCatalog,
} from '../../../lib/stage5b-artifact-contracts.js';

const execFile = promisify(execFileCallback);

export const STAGE5B_EVIDENCE_PIPELINE_DOCTOR_ARTIFACT_TYPE = 'stage5b_evidence_pipeline_doctor_manifest';
export const STAGE5B_EVIDENCE_PIPELINE_DOCTOR_SCHEMA_VERSION = '1.0';
export const STAGE5B_EVIDENCE_PIPELINE_DOCTOR_MANIFEST_FILE_NAME = 'stage5b_evidence_pipeline_doctor_manifest.json';

const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const RAW_COPY_MARKER = 'RAW_STAGE5B_PIPELINE_DOCTOR_DO_NOT_COPY';

const DEFAULT_REQUIRED_COMMANDS = Object.freeze([
  'stage5b-evidence-source-kit',
  'stage5b-evidence-source-preflight',
  'stage5b-surrogate-inspection-validation',
  'stage5b-evidence-review-dry-run',
  'stage5b-evidence-attachment-controller',
  'stage5b-evidence-pipeline-doctor',
]);

const REQUIRED_SCHEMA_PATHS = Object.freeze([
  'schemas/stage5b-evidence-pipeline-doctor-manifest.schema.json',
  'schemas/stage5b-evidence-review-dry-run-manifest.schema.json',
  'schemas/stage5b-evidence-attachment-control-manifest.schema.json',
  'schemas/stage5b-surrogate-inspection-validation.schema.json',
  'schemas/stage5b-candidate-gate-report.schema.json',
  'schemas/stage5b-intake-report.schema.json',
  'schemas/stage5b-promotion-dry-run-manifest.schema.json',
  'schemas/stage5b-audit-manifest.schema.json',
]);

const REQUIRED_CATALOG_IDS = Object.freeze([
  'stage5b_evidence_pipeline_doctor_manifest',
  'stage5b_evidence_review_dry_run_manifest',
  'stage5b_evidence_attachment_control_manifest',
  'stage5b_surrogate_inspection_validation',
  'inspection_evidence_intake_report',
  'inspection_evidence_promotion_dry_run_manifest',
  'stage5b_evidence_audit_manifest',
  'stage5b_validation_diagnostics',
]);

const REQUIRED_DOCS = Object.freeze([
  'README.md',
  'docs/stage-5b-operational-runbook.md',
  'docs/support-matrix.md',
  'docs/testing.md',
]);

const SAFE_CHAIN_TEXT = 'source-kit -> source-preflight -> review-dry-run -> attachment-controller -> pipeline-doctor -> later explicit real attachment/regeneration goal';

const REQUIRED_NPM_SCRIPTS = Object.freeze({
  'test:stage5b:pipeline-doctor': 'node tests/stage5b-evidence-pipeline-doctor.test.js',
  'test:stage5b:no-evidence': 'node tests/run-node-lane.js stage5b-no-evidence',
  'test:node:contract': 'node tests/run-node-lane.js contract',
  test: 'node scripts/run-test-suite.js default-node',
});

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(value = null) {
  return value || new Date().toISOString();
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function safeSlug(value) {
  const slug = normalizeRepoPath(value).toLowerCase();
  if (!CANONICAL_PACKAGE_SLUGS.includes(slug)) {
    throw new Error(`Stage 5B evidence pipeline doctor package must be a canonical package slug: ${value}`);
  }
  return slug;
}

function sanitizeSubdir(value, fallback) {
  const raw = normalizeRepoPath(value || fallback);
  if (
    !raw
    || raw.startsWith('/')
    || raw.startsWith('~')
    || raw.includes('\0')
    || raw.includes('\\')
    || raw.split('/').includes('..')
    || isWindowsAbsolutePath(raw)
  ) {
    throw new Error(`Invalid Stage 5B pipeline doctor inbox subdir: ${value}`);
  }
  return raw;
}

function pathInsideProject(projectRoot, pathValue, label = 'path') {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw new Error(`${label} is required`);
  }
  if (pathValue.includes('\0') || pathValue.includes('\\') || pathValue.startsWith('~') || isWindowsAbsolutePath(pathValue)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split('/').includes('..')) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  return { absolute, relative: rel };
}

function repoRelativePath(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return pathValue || null;
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : normalizeRepoPath(pathValue);
}

function commandForManifest(args = []) {
  return ['fcad', ...args];
}

async function runGit(projectRoot, args = []) {
  try {
    const { stdout } = await execFile('git', args, {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, status: 0, stdout: stdout || '' };
  } catch (error) {
    return {
      ok: false,
      status: typeof error?.code === 'number' ? error.code : 1,
      stdout: error?.stdout || '',
      stderr: error?.stderr || error?.message || '',
    };
  }
}

async function isGitIgnored(projectRoot, relativePath) {
  const result = await runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

async function sha256IfReadable(pathValue) {
  try {
    return createHash('sha256').update(await readFile(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

async function readJsonIfExists(projectRoot, relativePath) {
  try {
    return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonFile(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function assertIgnoredOutputDir(projectRoot, outDir) {
  const outputDir = pathInsideProject(projectRoot, outDir || 'output/stage5b-evidence-pipeline-doctor', 'stage5b evidence pipeline doctor out-dir');
  const allowedRoot = outputDir.relative.startsWith('output/') || outputDir.relative.startsWith('tmp/codex/');
  if (!allowedRoot) {
    throw new Error('stage5b evidence pipeline doctor out-dir must stay under output/ or tmp/codex/');
  }
  const ignored = await isGitIgnored(projectRoot, outputDir.relative);
  if (ignored !== true) {
    throw new Error('stage5b evidence pipeline doctor out-dir must be ignored by git');
  }
  await mkdir(outputDir.absolute, { recursive: true });
  return outputDir;
}

async function collectRepoPreflight(projectRoot) {
  const [
    pwdResult,
    rootResult,
    branchResult,
    headRefResult,
    headResult,
    defaultResult,
    remoteHeadResult,
    statusResult,
  ] = await Promise.all([
    Promise.resolve({ ok: true, stdout: process.cwd() }),
    runGit(projectRoot, ['rev-parse', '--show-toplevel']),
    runGit(projectRoot, ['branch', '--show-current']),
    runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectRoot, ['rev-parse', 'HEAD']),
    runGit(projectRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    runGit(projectRoot, ['rev-parse', 'origin/HEAD']),
    runGit(projectRoot, ['status', '--short']),
  ]);
  const repoRoot = rootResult.ok ? rootResult.stdout.trim() : null;
  const branchName = branchResult.ok ? branchResult.stdout.trim() || null : null;
  const headRef = headRefResult.ok ? headRefResult.stdout.trim() || null : null;
  const headSha = headResult.ok ? headResult.stdout.trim() || null : null;
  const gitDefaultHead = defaultResult.ok ? defaultResult.stdout.trim() || null : null;
  const githubBaseRef = normalizeRepoPath(process.env.GITHUB_BASE_REF || '');
  const remoteDefaultHead = gitDefaultHead || (githubBaseRef ? `origin/${githubBaseRef}` : null);
  const remoteDefaultHeadSource = gitDefaultHead
    ? 'git_symbolic_ref'
    : githubBaseRef
      ? 'github_base_ref_fallback'
      : 'unavailable';
  const dirtyPaths = statusResult.ok
    ? statusResult.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const detachedHead = !branchName && headRef === 'HEAD';
  const cleanDetachedHeadCheckoutOk = Boolean(detachedHead && headSha && dirtyPaths.length === 0);
  return {
    pwd: pwdResult.stdout,
    repo_root: repoRoot,
    repo_root_basename: repoRoot ? basename(repoRoot) : null,
    repo_identity_ok: repoRoot ? basename(repoRoot) === 'freecad-automation' : false,
    current_branch: branchName,
    head_ref: headRef,
    head_sha: headSha,
    default_branch: remoteDefaultHead,
    remote_default_head: remoteDefaultHead,
    remote_default_head_source: remoteDefaultHeadSource,
    remote_default_head_sha: remoteHeadResult.ok ? remoteHeadResult.stdout.trim() || null : null,
    dirty_tree: dirtyPaths.length > 0,
    dirty_paths: dirtyPaths,
    checkout_safety: {
      repo_identity_ok: repoRoot ? basename(repoRoot) === 'freecad-automation' : false,
      branch_discovered: Boolean(branchName),
      detached_head: detachedHead,
      clean_detached_head_checkout_ok: cleanDetachedHeadCheckoutOk,
      head_discovered: Boolean(headSha),
      remote_default_discovered: Boolean(remoteDefaultHead),
      remote_default_head_source: remoteDefaultHeadSource,
      dirty_tree_status_discovered: statusResult.ok,
      canonical_package_dirty_paths: dirtyPaths.filter((line) => /\sdocs\/examples\//.test(line)),
      raw_inbox_dirty_paths: dirtyPaths.filter((line) => /\slocal\/stage5b-candidate-evidence-inbox\//.test(line)),
    },
  };
}

function blocker(code, gate, message, evidence = {}) {
  return { code, gate, message, evidence };
}

function addBlocker(blockers, code, gate, message, evidence = {}) {
  blockers.push(blocker(code, gate, message, evidence));
}

export function isCleanDetachedStage5bPipelineDoctorCheckout(repoPreflight) {
  return Boolean(
    !repoPreflight?.current_branch
    && repoPreflight?.head_sha
    && repoPreflight?.dirty_tree === false
    && repoPreflight?.checkout_safety?.detached_head === true
    && repoPreflight?.checkout_safety?.clean_detached_head_checkout_ok === true
  );
}

function uniqueBlockers(blockers = []) {
  const seen = new Set();
  const result = [];
  for (const entry of blockers) {
    const key = `${entry.code}|${entry.gate}|${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function commandDriftChecks(projectRoot, requiredCommands = []) {
  const blockers = [];
  const binPath = resolve(projectRoot, 'bin/fcad.js');
  const binText = existsSync(binPath) ? String(readFileSyncSafe(binPath)) : '';
  const entries = requiredCommands.map((name) => {
    const entry = getCommandEntry(name);
    const dispatchPresent = binText.includes(`command === '${name}'`) || binText.includes(`command === "${name}"`);
    if (!entry) {
      addBlocker(blockers, 'command_missing_from_manifest', 'command_contract', `Required Stage 5B doctor command is missing from the command manifest: ${name}`, { command: name });
    }
    if (!dispatchPresent) {
      addBlocker(blockers, 'command_missing_from_cli_dispatch', 'command_contract', `Required Stage 5B doctor command is missing from bin/fcad.js dispatch: ${name}`, { command: name });
    }
    return {
      name,
      present_in_command_manifest: Boolean(entry),
      present_in_cli_dispatch: dispatchPresent,
      help_usage: entry?.helpEntries?.[0]?.usage || null,
      requires_freecad_runtime: entry?.runtime?.requiresFreecadRuntime ?? null,
    };
  });
  return { entries, blockers };
}

function readFileSyncSafe(pathValue) {
  try {
    return readFileSync(pathValue, 'utf8');
  } catch {
    return '';
  }
}

async function runCliCommand(projectRoot, args, {
  expectedStatuses = [0],
  expectedHoldStatus = false,
  outputPath = null,
} = {}) {
  const startedAt = nowIso();
  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    const result = await execFile(process.execPath, ['bin/fcad.js', ...args], {
      cwd: projectRoot,
      env: process.env,
      maxBuffer: 30 * 1024 * 1024,
    });
    stdout = result.stdout || '';
    stderr = result.stderr || '';
  } catch (error) {
    status = typeof error?.code === 'number' ? error.code : 1;
    stdout = error?.stdout || '';
    stderr = error?.stderr || error?.message || '';
  }
  const expected = expectedStatuses.includes(status);
  let output = null;
  if (outputPath) {
    const absolute = resolve(projectRoot, outputPath);
    output = {
      path: outputPath,
      exists: existsSync(absolute),
      sha256: await sha256IfReadable(absolute),
    };
  }
  return {
    name: args[0],
    command: commandForManifest(args),
    started_at: startedAt,
    completed_at: nowIso(),
    expected_status: expectedStatuses.length === 1 ? expectedStatuses[0] : expectedStatuses,
    actual_status: status,
    status: expectedHoldStatus && status !== 0 && expected ? 'expected_hold' : expected ? 'pass' : 'failed',
    accepted_as_fail_closed: Boolean(expectedHoldStatus && status !== 0 && expected),
    stdout_excerpt: stdout.trim().split('\n').slice(-8),
    stderr_excerpt: stderr.trim().split('\n').slice(-8),
    mutates_canonical_artifacts: false,
    output,
  };
}

async function listFiles(rootDir) {
  const files = [];
  async function visit(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const pathValue = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(pathValue);
      } else if (entry.isFile()) {
        files.push(pathValue);
      }
    }
  }
  await visit(rootDir);
  return files;
}

async function markerCopiedToOutput(outputDir, marker) {
  const files = await listFiles(outputDir);
  for (const file of files) {
    try {
      const text = await readFile(file, 'utf8');
      if (text.includes(marker)) return true;
    } catch {
      // Binary outputs are not part of the raw marker guard.
    }
  }
  return false;
}

async function createRawPrivateCopyGuard(projectRoot, slug, inboxSubdir) {
  const inboxRel = `local/stage5b-candidate-evidence-inbox/${slug}/${inboxSubdir}`;
  const markerPath = resolve(projectRoot, inboxRel, 'raw-private-do-not-copy.txt');
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${RAW_COPY_MARKER}\n`, 'utf8');
  return {
    raw_private_marker_path: repoRelativePath(projectRoot, markerPath),
    marker_sha256: await sha256IfReadable(markerPath),
  };
}

async function collectArtifacts(projectRoot, outputDir, paths = {}) {
  const artifactEntries = [];
  for (const [key, value] of Object.entries(paths)) {
    if (!value) continue;
    const absolute = resolve(projectRoot, value);
    artifactEntries.push({
      key,
      path: value,
      exists: existsSync(absolute),
      sha256: await sha256IfReadable(absolute),
    });
  }
  const trackedOutput = await runGit(projectRoot, ['ls-files', '--', outputDir.relative]);
  const trackedInbox = await runGit(projectRoot, ['ls-files', '--', 'local/stage5b-candidate-evidence-inbox']);
  return {
    entries: artifactEntries,
    tracked_output_files: trackedOutput.ok ? trackedOutput.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [],
    tracked_raw_inbox_files: trackedInbox.ok ? trackedInbox.stdout.split('\n').map((line) => line.trim()).filter(Boolean) : [],
  };
}

async function collectSchemaStatus(projectRoot) {
  const catalog = getStage5bArtifactSchemaCatalog();
  const catalogIds = catalog.map((entry) => entry.id);
  return {
    schemas: await Promise.all(REQUIRED_SCHEMA_PATHS.map(async (schemaPath) => ({
      path: schemaPath,
      exists: existsSync(resolve(projectRoot, schemaPath)),
      sha256: await sha256IfReadable(resolve(projectRoot, schemaPath)),
    }))),
    artifact_catalog: {
      required_ids: [...REQUIRED_CATALOG_IDS],
      present_ids: catalogIds.filter((id) => REQUIRED_CATALOG_IDS.includes(id)),
      missing_ids: REQUIRED_CATALOG_IDS.filter((id) => !catalogIds.includes(id)),
    },
  };
}

async function collectDocsStatus(projectRoot) {
  const docs = [];
  for (const docPath of REQUIRED_DOCS) {
    const text = await readFile(resolve(projectRoot, docPath), 'utf8').catch(() => '');
    docs.push({
      path: docPath,
      exists: Boolean(text),
      mentions_pipeline_doctor: /stage5b-evidence-pipeline-doctor/.test(text),
      contains_safe_chain: text.includes(SAFE_CHAIN_TEXT),
      contains_later_real_flow_boundary: /later explicit real attachment\/regeneration goal/i.test(text),
      contains_hard_evidence_rule: /Only genuine completed physical\/supplier\/lab\/QA inspection records/i.test(text),
    });
  }
  return docs;
}

async function collectPackageScriptStatus(projectRoot) {
  const pkg = await readJsonIfExists(projectRoot, 'package.json') || {};
  const scripts = safeObject(pkg.scripts);
  const required = Object.entries(REQUIRED_NPM_SCRIPTS).map(([name, expected]) => ({
    name,
    expected,
    actual: scripts[name] || null,
    present: typeof scripts[name] === 'string',
    matches_expected: scripts[name] === expected,
  }));
  const scriptReferences = Object.entries(scripts).flatMap(([name, script]) => scriptReferenceChecks(projectRoot, name, script, scripts));
  return { required, script_references: scriptReferences };
}

function scriptReferenceChecks(projectRoot, name, script, scripts) {
  const checks = [];
  const text = String(script || '');
  const nodeMatch = text.match(/\bnode\s+([^\s&|;]+)/);
  if (nodeMatch) {
    const filePath = nodeMatch[1];
    checks.push({
      script: name,
      reference_type: 'node_entrypoint',
      ref: filePath,
      exists: existsSync(resolve(projectRoot, filePath)),
    });
  }
  const npmRunMatches = [...text.matchAll(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g)];
  npmRunMatches.forEach((match) => {
    checks.push({
      script: name,
      reference_type: 'npm_script',
      ref: match[1],
      exists: typeof scripts[match[1]] === 'string',
    });
  });
  return checks;
}

async function collectWorkflowStatus(projectRoot) {
  const workflows = [
    '.github/workflows/automation-ci.yml',
    '.github/workflows/freecad-runtime-smoke.yml',
  ];
  const result = [];
  for (const pathValue of workflows) {
    const text = await readFile(resolve(projectRoot, pathValue), 'utf8').catch(() => '');
    result.push({
      path: pathValue,
      exists: Boolean(text),
      runs_source_hygiene: /npm run check:source-hygiene/.test(text),
      runs_node_contract: /npm run test:node:contract/.test(text),
      runs_runtime_smoke: /npm run test:runtime-smoke/.test(text),
    });
  }
  return result;
}

async function collectReadinessStatus(projectRoot) {
  const packages = [];
  for (const slug of CANONICAL_PACKAGE_SLUGS) {
    const readinessPath = `docs/examples/${slug}/readiness/readiness_report.json`;
    const doc = await readJsonIfExists(projectRoot, readinessPath);
    const summary = safeObject(doc?.readiness_summary || doc?.summary);
    packages.push({
      slug,
      path: readinessPath,
      exists: Boolean(doc),
      status: summary.status || null,
      gate_decision: summary.gate_decision || null,
      missing_inputs: safeList(summary.missing_inputs),
      readiness_remains_held: summary.status === 'needs_more_evidence'
        && summary.gate_decision === 'hold_for_evidence_completion',
    });
  }
  return packages;
}

function blockerCodesFromManifest(manifest) {
  return safeList(manifest?.blockers).map((entry) => entry.code).filter(Boolean);
}

function summarizeCommandResult(commandResult, manifest = null) {
  return {
    ...commandResult,
    blocker_codes: blockerCodesFromManifest(manifest),
  };
}

async function preflightNonEvidenceGuard({ projectRoot, slug, outputDir, source, kind, index }) {
  const outPath = `${outputDir.relative}/non-evidence-guards/${String(index).padStart(2, '0')}-${kind}.json`;
  const result = await runCliCommand(projectRoot, [
    'stage5b-evidence-source-preflight',
    '--package',
    slug,
    '--source',
    source,
    '--out',
    outPath,
  ], { expectedStatuses: [0], outputPath: outPath });
  const report = await readJsonIfExists(projectRoot, outPath);
  return {
    kind,
    source,
    command_status: result.status,
    report_path: outPath,
    classification: report?.classification || null,
    source_status: report?.summary?.source_status || null,
    canonical_evidence_eligible: false,
    evidence_attached: false,
    source_finding_codes: safeList(report?.source_findings).map((finding) => finding.code).filter(Boolean),
    safety_finding_codes: safeList(report?.safety_findings).map((finding) => finding.code).filter(Boolean),
  };
}

function nextHumanStep(slug) {
  return {
    required: true,
    instructions: `Later, after a genuine completed physical/supplier/lab/QA inspection record is received for ${slug}, keep the raw record in local/stage5b-candidate-evidence-inbox/${slug}/, rerun source-preflight, rerun review-dry-run without --fixture, complete the Stage 5B attachment authorization record, rerun the attachment controller with --dry-run, and only then start a separate explicit real evidence attachment/regeneration goal.`,
    canonical_attachment_allowed_now: false,
    canonical_readiness_regeneration_allowed_now: false,
  };
}

function readinessHeldTruth() {
  return {
    readiness_remains_held: true,
    status: 'needs_more_evidence',
    gate_decision: 'hold_for_evidence_completion',
    inspection_evidence_missing: true,
    canonical_readiness_regenerated: false,
    canonical_artifacts_mutated: false,
    packages_marked_ready: false,
    statement: 'Pipeline doctor output is fixture-only control metadata; canonical readiness remains needs_more_evidence / hold_for_evidence_completion until a later explicit real evidence attachment/regeneration goal completes.',
  };
}

function addInspectionBlockers({
  blockers,
  repoPreflight,
  commandContract,
  schemaStatus,
  docsStatus,
  packageScripts,
  workflows,
  readinessPackages,
  artifacts,
  nonEvidenceGuards,
  rawPrivateCopyGuard,
}) {
  if (!repoPreflight.repo_identity_ok) {
    addBlocker(blockers, 'repo_identity_invalid', 'repo_preflight', 'Repo root basename must be freecad-automation.', { repo_root: repoPreflight.repo_root });
  }
  if (!repoPreflight.current_branch && !isCleanDetachedStage5bPipelineDoctorCheckout(repoPreflight)) {
    addBlocker(blockers, 'branch_not_discovered', 'repo_preflight', 'Current branch could not be discovered outside a clean detached CI checkout.', {
      head_ref: repoPreflight.head_ref,
      dirty_tree: repoPreflight.dirty_tree,
    });
  }
  if (!repoPreflight.head_sha) {
    addBlocker(blockers, 'head_sha_not_discovered', 'repo_preflight', 'HEAD SHA could not be discovered.');
  }
  safeList(repoPreflight.checkout_safety?.canonical_package_dirty_paths).forEach((pathValue) => {
    addBlocker(blockers, 'canonical_package_dirty_path', 'checkout_safety', 'Canonical package paths are dirty during the pipeline doctor run.', { path: pathValue });
  });

  commandContract.blockers.forEach((entry) => blockers.push(entry));

  schemaStatus.schemas.filter((entry) => !entry.exists).forEach((entry) => {
    addBlocker(blockers, 'schema_missing', 'schemas', `Required Stage 5B schema is missing: ${entry.path}`, { path: entry.path });
  });
  schemaStatus.artifact_catalog.missing_ids.forEach((id) => {
    addBlocker(blockers, 'artifact_catalog_entry_missing', 'artifact_catalog', `Required Stage 5B artifact catalog entry is missing: ${id}`, { id });
  });

  docsStatus.forEach((doc) => {
    if (!doc.exists) {
      addBlocker(blockers, 'doc_missing', 'docs_runbook', `Required Stage 5B documentation file is missing: ${doc.path}`, { path: doc.path });
    } else if (!doc.mentions_pipeline_doctor || !doc.contains_safe_chain || !doc.contains_later_real_flow_boundary || !doc.contains_hard_evidence_rule) {
      addBlocker(blockers, 'docs_runbook_mismatch', 'docs_runbook', `Stage 5B documentation does not describe the safe pipeline-doctor chain: ${doc.path}`, { path: doc.path, doc });
    }
  });

  packageScripts.required.forEach((entry) => {
    if (!entry.present) {
      addBlocker(blockers, 'npm_script_missing', 'npm_scripts', `Required npm script is missing: ${entry.name}`, entry);
    } else if (!entry.matches_expected) {
      addBlocker(blockers, 'npm_script_drift', 'npm_scripts', `Required npm script has drifted: ${entry.name}`, entry);
    }
  });
  packageScripts.script_references.filter((entry) => !entry.exists).forEach((entry) => {
    addBlocker(blockers, 'npm_script_reference_broken', 'npm_scripts', `npm script ${entry.script} references missing ${entry.reference_type}: ${entry.ref}`, entry);
  });

  const automation = workflows.find((entry) => entry.path === '.github/workflows/automation-ci.yml');
  if (!automation?.exists || !automation.runs_source_hygiene || !automation.runs_node_contract) {
    addBlocker(blockers, 'ci_workflow_mismatch', 'ci_workflows', 'Automation CI must run source hygiene and the Node contract lane.', automation || {});
  }
  const runtime = workflows.find((entry) => entry.path === '.github/workflows/freecad-runtime-smoke.yml');
  if (!runtime?.exists || !runtime.runs_runtime_smoke) {
    addBlocker(blockers, 'ci_runtime_workflow_mismatch', 'ci_workflows', 'Runtime smoke workflow must keep runtime smoke separate from this CLI-only doctor.', runtime || {});
  }

  readinessPackages.filter((pkg) => !pkg.readiness_remains_held).forEach((pkg) => {
    addBlocker(blockers, 'readiness_overclaiming', 'readiness_packages', `Canonical package readiness is not held for ${pkg.slug}.`, pkg);
  });

  if (artifacts.tracked_output_files.length > 0) {
    addBlocker(blockers, 'unsafe_tracked_output', 'output_safety', 'Pipeline doctor output path has tracked files.', { tracked_output_files: artifacts.tracked_output_files });
  }
  if (artifacts.tracked_raw_inbox_files.length > 0) {
    addBlocker(blockers, 'tracked_raw_inbox_data', 'output_safety', 'Stage 5B raw inbox files must never be tracked.', { tracked_raw_inbox_files: artifacts.tracked_raw_inbox_files });
  }
  if (rawPrivateCopyGuard.marker_copied_to_output) {
    addBlocker(blockers, 'raw_private_marker_copied_to_output', 'output_safety', 'Doctor copied raw private marker text into output artifacts.', rawPrivateCopyGuard);
  }

  nonEvidenceGuards.forEach((guard) => {
    if (guard.classification !== 'unsafe_or_not_evidence' || guard.evidence_attached !== false || guard.canonical_evidence_eligible !== false) {
      addBlocker(blockers, 'non_evidence_guard_failed', 'non_evidence_guards', `${guard.kind} input was not rejected as non-evidence.`, guard);
    }
  });
}

export async function writeStage5bEvidencePipelineDoctorManifest({
  projectRoot = process.cwd(),
  packageSlug = 'quality-pass-bracket',
  outDir = 'output/stage5b-evidence-pipeline-doctor',
  inboxSubdir = null,
  generatedAt = null,
  extraRequiredCommands = [],
} = {}) {
  const root = resolve(projectRoot);
  const slug = safeSlug(packageSlug);
  const generated = nowIso(generatedAt);
  const outputDir = await assertIgnoredOutputDir(root, outDir);
  const safeInboxSubdir = sanitizeSubdir(inboxSubdir, `pipeline-doctor-${Date.now()}`);
  const requiredCommands = [...new Set([...DEFAULT_REQUIRED_COMMANDS, ...safeList(extraRequiredCommands).map(String).filter(Boolean)])];
  const commandContract = commandDriftChecks(root, requiredCommands);
  const blockers = [...commandContract.blockers];

  const manifestPath = join(outputDir.absolute, STAGE5B_EVIDENCE_PIPELINE_DOCTOR_MANIFEST_FILE_NAME);
  const manifestRel = repoRelativePath(root, manifestPath);
  const commandResults = [];
  const nonEvidenceGuards = [];
  let rawPrivateCopyGuard = {};
  let sourceKitReportPath = null;
  let sourcePreflightReportPath = null;
  let surrogateManifestPath = null;
  let reviewManifestPath = null;
  let attachmentControlManifestPath = null;

  const repoPreflight = await collectRepoPreflight(root);
  const schemaStatus = await collectSchemaStatus(root);
  const docsStatus = await collectDocsStatus(root);
  const packageScripts = await collectPackageScriptStatus(root);
  const workflows = await collectWorkflowStatus(root);
  const readinessPackages = await collectReadinessStatus(root);

  const canRunSequence = commandContract.blockers.length === 0;
  if (canRunSequence) {
    sourceKitReportPath = `${outputDir.relative}/source-kit-report.json`;
    const sourceKit = await runCliCommand(root, [
      'stage5b-evidence-source-kit',
      '--package',
      slug,
      '--inbox-subdir',
      safeInboxSubdir,
      '--out',
      sourceKitReportPath,
    ], { expectedStatuses: [0], outputPath: sourceKitReportPath });
    commandResults.push(sourceKit);

    rawPrivateCopyGuard = await createRawPrivateCopyGuard(root, slug, safeInboxSubdir);

    sourcePreflightReportPath = `${outputDir.relative}/source-preflight-report.json`;
    const sourcePreflight = await runCliCommand(root, [
      'stage5b-evidence-source-preflight',
      '--package',
      slug,
      '--inbox-subdir',
      safeInboxSubdir,
      '--out',
      sourcePreflightReportPath,
    ], { expectedStatuses: [0], outputPath: sourcePreflightReportPath });
    commandResults.push(sourcePreflight);

    const surrogateOutDir = `${outputDir.relative}/surrogate`;
    surrogateManifestPath = `${surrogateOutDir}/surrogate_inspection_validation.json`;
    const surrogate = await runCliCommand(root, [
      'stage5b-surrogate-inspection-validation',
      '--package',
      slug,
      '--out-dir',
      surrogateOutDir,
    ], { expectedStatuses: [0], outputPath: surrogateManifestPath });
    commandResults.push(surrogate);

    const nonEvidenceSources = [
      { kind: 'surrogate', source: surrogateManifestPath },
      { kind: 'generated', source: `docs/examples/${slug}/quality/quality_pass_bracket_create_quality.json` },
      { kind: 'docs', source: `docs/inspection-evidence-collection/${slug}.md` },
      { kind: 'ci', source: '.github/workflows/automation-ci.yml' },
      { kind: 'readiness', source: `docs/examples/${slug}/readiness/readiness_report.json` },
      { kind: 'cad', source: `docs/examples/${slug}/cad/quality_pass_bracket.step` },
    ];
    for (let index = 0; index < nonEvidenceSources.length; index += 1) {
      nonEvidenceGuards.push(await preflightNonEvidenceGuard({
        projectRoot: root,
        slug,
        outputDir,
        ...nonEvidenceSources[index],
        index,
      }));
    }

    const reviewOutDir = `${outputDir.relative}/review-dry-run`;
    const fixtureSourcePath = `local/stage5b-candidate-evidence-inbox/${slug}/${safeInboxSubdir}/pipeline-doctor-fixture-source.json`;
    reviewManifestPath = `${reviewOutDir}/stage5b_evidence_review_dry_run_manifest.json`;
    const reviewDryRun = await runCliCommand(root, [
      'stage5b-evidence-review-dry-run',
      '--package',
      slug,
      '--source',
      fixtureSourcePath,
      '--out-dir',
      reviewOutDir,
      '--fixture',
    ], { expectedStatuses: [0], outputPath: reviewManifestPath });
    commandResults.push(reviewDryRun);

    const attachmentOutDir = `${outputDir.relative}/attachment-controller`;
    attachmentControlManifestPath = `${attachmentOutDir}/stage5b_evidence_attachment_control_manifest.json`;
    const attachmentController = await runCliCommand(root, [
      'stage5b-evidence-attachment-controller',
      '--review-manifest',
      reviewManifestPath,
      '--authorization-record',
      `${outputDir.relative}/missing-attachment-authorization.json`,
      '--out-dir',
      attachmentOutDir,
      '--dry-run',
    ], {
      expectedStatuses: [2],
      expectedHoldStatus: true,
      outputPath: attachmentControlManifestPath,
    });
    const attachmentManifest = await readJsonIfExists(root, attachmentControlManifestPath);
    commandResults.push(summarizeCommandResult(attachmentController, attachmentManifest));
  }

  const artifacts = await collectArtifacts(root, outputDir, {
    source_kit_report: sourceKitReportPath,
    source_preflight_report: sourcePreflightReportPath,
    surrogate_manifest: surrogateManifestPath,
    review_dry_run_manifest: reviewManifestPath,
    attachment_control_manifest: attachmentControlManifestPath,
    pipeline_doctor_manifest: manifestRel,
  });
  const markerCopied = await markerCopiedToOutput(outputDir.absolute, RAW_COPY_MARKER);
  rawPrivateCopyGuard = {
    ...rawPrivateCopyGuard,
    marker_copied_to_output: markerCopied,
    raw_inbox_tracked: artifacts.tracked_raw_inbox_files.some((pathValue) => pathValue.includes(safeInboxSubdir)),
  };

  addInspectionBlockers({
    blockers,
    repoPreflight,
    commandContract,
    schemaStatus,
    docsStatus,
    packageScripts,
    workflows,
    readinessPackages,
    artifacts,
    nonEvidenceGuards,
    rawPrivateCopyGuard,
  });

  commandResults.filter((entry) => entry.status === 'failed').forEach((entry) => {
    addBlocker(blockers, 'command_failed_unexpected_status', 'commands_run', `Stage 5B doctor subcommand failed unexpectedly: ${entry.name}`, entry);
  });
  const attachmentStep = commandResults.find((entry) => entry.name === 'stage5b-evidence-attachment-controller');
  if (canRunSequence && (!attachmentStep || attachmentStep.accepted_as_fail_closed !== true)) {
    addBlocker(blockers, 'attachment_controller_fail_closed_not_proven', 'commands_run', 'Attachment controller did not prove the expected fail-closed dry-run behavior.', attachmentStep || {});
  }

  const finalBlockers = uniqueBlockers(blockers);
  const decision = finalBlockers.length === 0 ? 'pass' : 'hold';
  const manifest = {
    artifact_type: STAGE5B_EVIDENCE_PIPELINE_DOCTOR_ARTIFACT_TYPE,
    schema_version: STAGE5B_EVIDENCE_PIPELINE_DOCTOR_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: true,
    fixture_only: true,
    non_mutating: true,
    package_slug: slug,
    repo_preflight: repoPreflight,
    command_contract: {
      required_commands: requiredCommands,
      entries: commandContract.entries,
    },
    commands_run: commandResults,
    artifacts: artifacts.entries,
    schemas: schemaStatus.schemas,
    artifact_catalog: schemaStatus.artifact_catalog,
    docs_runbook: docsStatus,
    npm_scripts: packageScripts,
    ci_workflows: workflows,
    readiness_packages: readinessPackages,
    non_evidence_guards: nonEvidenceGuards,
    raw_private_copy_guard: rawPrivateCopyGuard,
    blockers: finalBlockers,
    next_human_step: nextHumanStep(slug),
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      pipeline_doctor_does_not_attach_evidence: true,
      pipeline_doctor_does_not_promote_evidence: true,
      pipeline_doctor_does_not_regenerate_readiness: true,
      pipeline_doctor_does_not_mark_packages_ready: true,
      later_explicit_real_attachment_regeneration_goal_required: true,
      fixture_surrogate_generated_docs_ci_readiness_cad_are_not_evidence: true,
      rejected_as_real_evidence: [
        'surrogate/generated inspection validation artifacts',
        'synthetic fixtures and test fixtures',
        'templates and sample records',
        'collection guides and request packets',
        'generated CAD/spec/docs values',
        'CI workflow files and metadata',
        'readiness reports, review packs, standard docs, and release bundles',
        'CAD files and CAD-derived measurements',
        'schemas, runbooks, request packets, source preflight reports, review dry-run manifests, attachment-control manifests, candidate gate reports, intake reports, promotion dry-run manifests, audit manifests, and authorization records',
      ],
    },
    readiness_held_truth: readinessHeldTruth(),
    summary: {
      pipeline_status: decision === 'pass' ? 'pass_fixture_only_readiness_held' : 'hold_for_pipeline_doctor_blockers',
      decision,
      blocker_count: finalBlockers.length,
      command_count: commandResults.length,
      fixture_only: true,
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      packages_marked_ready: false,
      readiness_status: 'needs_more_evidence',
      readiness_gate_decision: 'hold_for_evidence_completion',
      readiness_remains_held: true,
      attachment_controller_fail_closed_proven: attachmentStep?.accepted_as_fail_closed === true,
      next_human_step: nextHumanStep(slug).instructions,
    },
    outputs: {
      manifest: {
        path: manifestRel,
        artifact_type: STAGE5B_EVIDENCE_PIPELINE_DOCTOR_ARTIFACT_TYPE,
        sha256: null,
      },
    },
  };

  assertValidStage5bEvidencePipelineDoctorManifest(manifest, {
    label: 'evidence pipeline doctor manifest',
    artifactPath: manifestPath,
    projectRoot: root,
  });
  await writeJsonFile(manifestPath, manifest);
  const manifestSha = await sha256IfReadable(manifestPath);
  const finalManifest = {
    ...manifest,
    outputs: {
      ...manifest.outputs,
      manifest: {
        ...manifest.outputs.manifest,
        sha256: manifestSha,
      },
    },
  };
  await writeJsonFile(manifestPath, finalManifest);
  return {
    manifest: finalManifest,
    output_dir: outputDir.relative,
    manifest_path: manifestRel,
    absolute_manifest_path: manifestPath,
  };
}

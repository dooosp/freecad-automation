import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const DEFAULT_MAINTAINER_DECISION_JOURNAL_OUT_DIR = 'output/maintainer-decision-journal';
export const MAINTAINER_DECISION_JOURNAL_JSON = 'maintainer_decision_journal.json';
export const MAINTAINER_DECISION_JOURNAL_MARKDOWN = 'maintainer_decision_journal.md';
export const MAINTAINER_DECISION_JOURNAL_ARTIFACT_TYPE = 'maintainer_decision_journal';

const SCHEMA_VERSION = '1.0';
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence. A maintainer decision journal can record hold/proceed/exception intent, but it does not attach evidence or regenerate readiness.';
const VALID_DECISIONS = new Set(['hold', 'proceed', 'exception_requested', 'exception_approved']);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function assertPathInsideProject(projectRoot, pathValue, label) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    throw new Error(`${label} is required`);
  }
  if (pathValue.includes('\0') || pathValue.includes('\\') || pathValue.startsWith('~') || isWindowsAbsolutePath(pathValue)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  return { absolute, relative: rel };
}

function repoRelative(projectRoot, pathValue) {
  const rel = relative(resolve(projectRoot), resolve(projectRoot, pathValue)).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path must stay inside repository root: ${pathValue}`);
  }
  return rel;
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

function checkGitIgnored(projectRoot, pathValue) {
  const result = runGit(projectRoot, ['check-ignore', '-q', '--', pathValue]);
  return result.status === 0;
}

function assertIgnoredOutputDir(projectRoot, outDir) {
  const outputDir = assertPathInsideProject(projectRoot, outDir || DEFAULT_MAINTAINER_DECISION_JOURNAL_OUT_DIR, 'maintainer decision journal out-dir');
  if (!outputDir.relative.startsWith('output/') && !outputDir.relative.startsWith('tmp/codex/')) {
    throw new Error('maintainer decision journal out-dir must stay under ignored output/ or tmp/codex/');
  }
  if (!checkGitIgnored(projectRoot, `${outputDir.relative.replace(/\/+$/, '')}/`) && !checkGitIgnored(projectRoot, outputDir.relative)) {
    throw new Error(`maintainer decision journal out-dir must be ignored by git: ${outputDir.relative}`);
  }
  return outputDir;
}

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

function readJsonIfExists(pathValue) {
  try {
    return existsSync(pathValue) ? readJson(pathValue) : null;
  } catch {
    return null;
  }
}

function sha256File(pathValue) {
  return createHash('sha256').update(readFileSync(pathValue)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function collectRepoContext(projectRoot) {
  const root = runGit(projectRoot, ['rev-parse', '--show-toplevel']);
  const branch = runGit(projectRoot, ['branch', '--show-current']);
  const head = runGit(projectRoot, ['rev-parse', 'HEAD']);
  const remoteDefault = runGit(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  return {
    repo_root_basename: basename(root.ok ? root.stdout.trim() : resolve(projectRoot)),
    current_branch: branch.ok ? branch.stdout.trim() || null : null,
    head_sha: head.ok ? head.stdout.trim() || null : null,
    default_branch: remoteDefault.ok ? remoteDefault.stdout.trim().replace(/^refs\/remotes\//, '') : null,
  };
}

function normalizeDecision(value) {
  const decision = normalizeRepoPath(value).replaceAll('-', '_');
  if (!VALID_DECISIONS.has(decision)) {
    throw new Error(`Invalid maintainer decision: ${value || '(empty)'}`);
  }
  return decision;
}

function auditRef(projectRoot, auditPath, audit) {
  const path = assertPathInsideProject(projectRoot, auditPath, 'maintainer decision journal audit path');
  return {
    path: path.relative,
    artifact_type: audit?.artifact_type || 'evidence_readiness_audit',
    sha256: sha256File(path.absolute),
    audit_decision: audit?.summary?.decision || null,
    package_count: audit?.summary?.package_count ?? null,
    held_package_count: audit?.summary?.held_package_count ?? null,
    trusted_inspection_evidence_record_count: audit?.summary?.trusted_evidence_record_count ?? null,
    release_overclaim_risk_count: audit?.summary?.release_overclaim_risk_count ?? null,
  };
}

function evaluateReleaseGate({ audit, decision, allowReleaseException, approver }) {
  const summary = safeObject(audit?.summary);
  const auditDecision = summary.decision || 'unknown';
  const trusted = Number(summary.trusted_evidence_record_count || 0);
  const heldCount = Number(summary.held_package_count || 0);
  const overclaimCount = Number(summary.release_overclaim_risk_count || 0);
  const auditAllowsRelease = auditDecision === 'pass'
    && heldCount === 0
    && overclaimCount === 0
    && trusted > 0;

  if (decision === 'proceed' && !auditAllowsRelease) {
    throw new Error('Cannot record proceed: the evidence/readiness audit is not pass with trusted inspection evidence.');
  }

  if (decision === 'exception_approved') {
    if (allowReleaseException !== true || !String(approver || '').trim()) {
      throw new Error('Cannot approve readiness exception without --allow-release-exception and --approver.');
    }
    return {
      release_allowed: true,
      release_allowed_by_exception: true,
      reason: 'Release is allowed only by explicit maintainer exception approval; canonical readiness and evidence boundary remain unchanged.',
    };
  }

  if (decision === 'proceed') {
    return {
      release_allowed: true,
      release_allowed_by_exception: false,
      reason: 'Release is allowed because the audit passed with trusted inspection evidence and no hold/overclaim risk.',
    };
  }

  return {
    release_allowed: false,
    release_allowed_by_exception: false,
    reason: decision === 'exception_requested'
      ? 'Exception was requested but not approved; release remains blocked.'
      : 'Maintainer decision is hold; release remains blocked.',
  };
}

function buildRecord({
  projectRoot,
  audit,
  auditPath,
  decision,
  reason,
  actor,
  generatedAt,
  allowReleaseException,
  approver,
}) {
  const releaseGate = evaluateReleaseGate({ audit, decision, allowReleaseException, approver });
  const ref = auditRef(projectRoot, auditPath, audit);
  const id = sha256Text(`${generatedAt}|${decision}|${actor || ''}|${approver || ''}|${ref.sha256}|${reason || ''}`).slice(0, 16);
  return {
    id,
    recorded_at: generatedAt,
    actor: actor || 'unknown',
    decision,
    reason: reason || null,
    audit_ref: ref,
    package_slugs: safeList(audit?.packages).map((pkg) => pkg.slug).filter(Boolean),
    release_gate: releaseGate,
    exception: {
      status: decision === 'exception_requested'
        ? 'requested_not_approved'
        : decision === 'exception_approved'
          ? 'approved_by_maintainer_exception'
          : 'none',
      approver: decision === 'exception_approved' ? approver : null,
    },
    boundary: {
      local_decision_record_only: true,
      inspection_evidence_attached: false,
      canonical_readiness_regenerated: false,
      release_published: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
  };
}

function summarizeJournal({ records, audit }) {
  const latest = records.at(-1) || null;
  const summary = safeObject(audit?.summary);
  return {
    record_count: records.length,
    latest_decision: latest?.decision || null,
    release_allowed: latest?.release_gate?.release_allowed === true,
    release_allowed_by_exception: latest?.release_gate?.release_allowed_by_exception === true,
    audit_decision: summary.decision || null,
    held_package_count: summary.held_package_count ?? null,
    trusted_inspection_evidence_record_count: summary.trusted_evidence_record_count ?? null,
    release_overclaim_risk_count: summary.release_overclaim_risk_count ?? null,
  };
}

function buildJournal({ projectRoot, outDir, generatedAt, audit, records }) {
  return {
    artifact_type: MAINTAINER_DECISION_JOURNAL_ARTIFACT_TYPE,
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    output_dir: outDir,
    boundary: {
      local_only: true,
      generated_control_only: true,
      inspection_evidence_attached: false,
      canonical_readiness_regenerated: false,
      release_published: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
    repo_context: collectRepoContext(projectRoot),
    summary: summarizeJournal({ records, audit }),
    records,
  };
}

function renderMarkdown(journal) {
  const latest = journal.records.at(-1) || {};
  return [
    '# Maintainer Decision Journal',
    '',
    `Generated: ${journal.generated_at}`,
    `Records: ${journal.summary.record_count}`,
    `Latest decision: ${journal.summary.latest_decision || 'none'}`,
    `Audit decision: ${journal.summary.audit_decision || 'unknown'}`,
    `Release allowed: ${journal.summary.release_allowed ? 'yes' : 'no'}`,
    `Release allowed by exception: ${journal.summary.release_allowed_by_exception ? 'yes' : 'no'}`,
    '',
    '## Boundary',
    '',
    journal.boundary.hard_evidence_rule,
    '',
    '## Latest Record',
    '',
    `- ID: ${latest.id || 'none'}`,
    `- Actor: ${latest.actor || 'unknown'}`,
    `- Reason: ${latest.reason || 'none'}`,
    `- Release gate: ${latest.release_gate?.reason || 'none'}`,
    '',
  ].join('\n');
}

export async function writeMaintainerDecisionJournal({
  projectRoot = resolve(import.meta.dirname, '../../..'),
  auditPath,
  outDir = DEFAULT_MAINTAINER_DECISION_JOURNAL_OUT_DIR,
  decision = 'hold',
  reason = null,
  actor = null,
  approver = null,
  allowReleaseException = false,
  generatedAt = null,
  clean = false,
} = {}) {
  const root = resolve(projectRoot);
  const outputDir = assertIgnoredOutputDir(root, outDir);
  const generated = generatedAt || new Date().toISOString();
  const normalizedDecision = normalizeDecision(decision);
  const auditFile = assertPathInsideProject(root, auditPath, 'maintainer decision journal audit path');
  const audit = readJson(auditFile.absolute);
  const journalPath = join(outputDir.absolute, MAINTAINER_DECISION_JOURNAL_JSON);
  const summaryPath = join(outputDir.absolute, MAINTAINER_DECISION_JOURNAL_MARKDOWN);

  if (clean) {
    rmSync(outputDir.absolute, { recursive: true, force: true });
  }
  await mkdir(outputDir.absolute, { recursive: true });

  const previous = clean ? null : readJsonIfExists(journalPath);
  const records = safeList(previous?.records);
  const record = buildRecord({
    projectRoot: root,
    audit,
    auditPath: auditFile.relative,
    decision: normalizedDecision,
    reason,
    actor,
    generatedAt: generated,
    allowReleaseException,
    approver,
  });
  records.push(record);

  const journal = buildJournal({
    projectRoot: root,
    outDir: outputDir.relative,
    generatedAt: generated,
    audit,
    records,
  });
  const summary = renderMarkdown(journal);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await writeFile(summaryPath, summary, 'utf8');

  return {
    journal,
    paths: {
      journal: repoRelative(root, journalPath),
      summary: repoRelative(root, summaryPath),
    },
  };
}

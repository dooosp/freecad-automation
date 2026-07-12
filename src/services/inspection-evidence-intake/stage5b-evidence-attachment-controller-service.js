import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { assertValidStage5bEvidenceAttachmentControlManifest } from './stage5b-runtime-validation.js';
import { assertValidStage5bEvidenceReviewDryRunManifest } from './stage5b-runtime-validation.js';
import {
  splitStage5bCanonicalDirtyPaths,
} from './stage5b-repo-dirty-paths.js';

const execFile = promisify(execFileCallback);

export const STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_ARTIFACT_TYPE = 'stage5b_evidence_attachment_control_manifest';
export const STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_SCHEMA_VERSION = '1.0';
export const STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_MANIFEST_FILE_NAME = 'stage5b_evidence_attachment_control_manifest.json';

const REVIEW_DRY_RUN_ARTIFACT_TYPE = 'stage5b_evidence_review_dry_run_manifest';
const AUTHORIZATION_RECORD_TYPE = 'stage5b_attachment_authorization';
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const COMPLETE_STATUSES = new Set(['complete', 'completed', 'closed', 'final', 'released', 'approved']);
const REJECTED_AS_REAL_EVIDENCE = Object.freeze([
  'surrogate/generated inspection validation artifacts',
  'synthetic fixtures and test fixtures',
  'templates and sample records',
  'generated CAD/spec/docs values',
  'CAD files and CAD-derived measurements',
  'docs, runbooks, collection guides, and request packets',
  'CI/GitHub metadata, workflow files, comments, and PR bodies',
  'readiness reports, review packs, and release bundles',
  'schemas and control manifests',
  'source preflight reports, review dry-run manifests, candidate gate reports, intake reports, promotion dry-run manifests, audit manifests, and authorization records',
]);

const DISALLOWED_SOURCE_PATH_RULES = Object.freeze([
  ['surrogate_artifact_not_evidence', /(^|\/)[^/]*surrogate[^/]*\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['generated_artifact_not_evidence', /(^|\/)[^/]*(?:_create_quality|_drawing_quality|_drawing_qa|_drawing_intent|_feature_catalog|_extracted_drawing_semantics|_dfm_report)\.(?:json|csv|tsv|md|markdown|txt)$/i],
  ['cad_or_generated_values_not_evidence', /\.(?:step|stp|stl|brep|fcstd|dxf)$/i],
  ['docs_or_collection_guide_not_evidence', /^docs\/(?!examples\/[^/]+\/inspection\/).+\.(?:md|markdown|txt)$/i],
  ['ci_artifact_not_evidence', /^\.github\//i],
  ['readiness_artifact_not_evidence', /(^|\/)(?:readiness_report|readiness-report)\.(?:json|csv|tsv|md|markdown|pdf|txt)$/i],
  ['schema_not_evidence', /^schemas\//i],
  ['fixture_not_evidence', /^tests\/fixtures\//i],
]);

const PRIVATE_URL_PATTERN = /https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])|169\.254\.|[^/\s"'`<>]+\.local|[^/\s"'`<>]*intranet[^/\s"'`<>]*)[^\s"'`<>]*/i;
const TOKEN_PATTERN = /authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]+|github_pat_[A-Za-z0-9_]+|gh[opsu]_[A-Za-z0-9_]+|access_token=|token=|secret=|api[_-]?key=|x-api-key/i;
const ABSOLUTE_PATH_PATTERN = /(?:\/Users\/|\/private\/|\/home\/|\/var\/folders\/|[A-Za-z]:\\|\\\\[^\s"'`<>|]+\\)/i;
const PII_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{3}-\d{2}-\d{4}\b/i;

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function githubActionsBranchFallback() {
  return process.env.GITHUB_HEAD_REF
    || process.env.GITHUB_REF_NAME
    || null;
}

function githubActionsRemoteDefaultFallback() {
  const ref = process.env.GITHUB_BASE_REF || null;
  return ref ? `origin/${ref}` : null;
}

function githubActionsCurrentRefFallback() {
  return process.env.GITHUB_REF_NAME || null;
}

function parseRemoteDefaultHead(stdout = '') {
  const match = String(stdout).match(/^\s*HEAD branch:\s*(\S+)\s*$/m);
  return match ? `origin/${match[1]}` : null;
}

async function readPackageName(projectRoot) {
  try {
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
    return typeof packageJson.name === 'string' ? packageJson.name : null;
  } catch {
    return null;
  }
}

function buildRepoIdentity(projectRoot, packageName) {
  const rootBasename = projectRoot ? basename(projectRoot) : null;
  const basenameMatches = rootBasename === 'freecad-automation';
  const packageNameMatches = packageName === 'freecad-automation';
  return {
    ok: Boolean(projectRoot && (basenameMatches || packageNameMatches)),
    rootBasename,
    packageName,
    evidence: {
      root_basename_matches: basenameMatches,
      package_name_matches: packageNameMatches,
    },
  };
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
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

function pathInsideProject(projectRoot, pathValue, fallback = null) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return null;
  if (pathValue.includes('\0') || pathValue.includes('\\') || pathValue.startsWith('~') || isWindowsAbsolutePath(pathValue)) {
    return null;
  }
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) ? resolve(pathValue) : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split('/').includes('..')) return null;
  return {
    absolute,
    relative: rel,
  };
}

function isSafePublicAuthorizationUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && !PRIVATE_URL_PATTERN.test(value)
      && !TOKEN_PATTERN.test(value);
  } catch {
    return false;
  }
}

function sanitizedRef(projectRoot, value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(String(value))) {
    if (!isSafePublicAuthorizationUrl(value)) return basename(String(value).split(/[?#]/)[0]) || 'redacted-url';
    return value;
  }
  return repoRelativePath(projectRoot, value);
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
  if (!relativePath) return null;
  const result = await runGit(projectRoot, ['check-ignore', '-q', '--', relativePath]);
  if (result.ok) return true;
  if (result.status === 1) return false;
  return null;
}

async function assertIgnoredOutputDir(projectRoot, outDir) {
  const outputDir = pathInsideProject(projectRoot, outDir || 'output/stage5b-evidence-attachment-controller');
  if (!outputDir) {
    throw new Error('stage5b evidence attachment controller out-dir must stay inside the repository root');
  }
  const ignored = await isGitIgnored(projectRoot, outputDir.relative);
  if (ignored !== true) {
    throw new Error('stage5b evidence attachment controller out-dir must be ignored by git');
  }
  await mkdir(outputDir.absolute, { recursive: true });
  return outputDir;
}

async function sha256IfReadable(pathValue) {
  try {
    return createHash('sha256').update(await readFile(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

async function readJsonFile(pathValue) {
  return JSON.parse(await readFile(pathValue, 'utf8'));
}

async function writeJsonFile(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function gate(id, ok, message, {
  reasons = [],
  evidence = {},
} = {}) {
  return {
    id,
    status: ok ? 'pass' : 'blocked',
    required: true,
    message,
    reasons: [...new Set(reasons.filter(Boolean))],
    evidence,
  };
}

function blocker(code, gateId, message, evidence = {}) {
  return {
    code,
    gate: gateId,
    message,
    evidence,
  };
}

function blockersFromGate(gateEntry) {
  if (gateEntry.status === 'pass') return [];
  const reasons = safeList(gateEntry.reasons).length > 0 ? gateEntry.reasons : [gateEntry.id];
  return reasons.map((reason) => blocker(reason, gateEntry.id, gateEntry.message));
}

export function isCleanDetachedStage5bAttachmentControllerCheckout(repoPreflight) {
  return Boolean(
    !repoPreflight?.current_branch
    && repoPreflight?.head_sha
    && repoPreflight?.dirty_tree === false
    && repoPreflight?.checkout_safety?.detached_head === true
    && repoPreflight?.checkout_safety?.clean_detached_head_checkout_ok === true
  );
}

async function collectRepoPreflight(projectRoot) {
  const [
    rootResult,
    branchResult,
    headRefResult,
    headResult,
    defaultResult,
    remoteShowResult,
    statusResult,
  ] = await Promise.all([
    runGit(projectRoot, ['rev-parse', '--show-toplevel']),
    runGit(projectRoot, ['branch', '--show-current']),
    runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectRoot, ['rev-parse', 'HEAD']),
    runGit(projectRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    runGit(projectRoot, ['remote', 'show', 'origin']),
    runGit(projectRoot, ['status', '--short', '--untracked-files=all']),
  ]);
  const repoRoot = rootResult.ok ? rootResult.stdout.trim() : null;
  const packageName = repoRoot ? await readPackageName(repoRoot) : null;
  const repoIdentity = buildRepoIdentity(repoRoot, packageName);
  const dirtyPaths = statusResult.ok
    ? statusResult.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : [];
  const canonicalDirtyPaths = splitStage5bCanonicalDirtyPaths(dirtyPaths);
  const branchName = branchResult.ok
    ? branchResult.stdout.trim() || githubActionsBranchFallback() || githubActionsCurrentRefFallback()
    : githubActionsBranchFallback() || githubActionsCurrentRefFallback();
  const headRef = headRefResult.ok ? headRefResult.stdout.trim() || null : null;
  const gitDefaultHead = defaultResult.ok ? defaultResult.stdout.trim() || null : null;
  const remoteShowDefaultHead = remoteShowResult.ok ? parseRemoteDefaultHead(remoteShowResult.stdout) : null;
  const githubBaseDefaultHead = githubActionsRemoteDefaultFallback();
  const currentRefDefaultHead = branchName && ['master', 'main'].includes(branchName)
    ? `origin/${branchName}`
    : null;
  const remoteDefaultHead = gitDefaultHead
    || remoteShowDefaultHead
    || githubBaseDefaultHead
    || currentRefDefaultHead;
  const remoteDefaultHeadSource = gitDefaultHead
    ? 'git_symbolic_ref'
    : remoteShowDefaultHead
      ? 'git_remote_show'
      : githubBaseDefaultHead
        ? 'github_base_ref_fallback'
        : currentRefDefaultHead
          ? 'current_default_branch_fallback'
          : 'unavailable';
  const remoteHeadResult = remoteDefaultHead
    ? await runGit(projectRoot, ['rev-parse', remoteDefaultHead])
    : { ok: false, stdout: '' };
  const detachedHead = !branchName && headRef === 'HEAD';
  return {
    repo_root: repoRoot,
    repo_root_basename: repoIdentity.rootBasename,
    repo_package_name: repoIdentity.packageName,
    repo_identity_ok: repoIdentity.ok,
    repo_identity_evidence: repoIdentity.evidence,
    current_branch: branchName,
    head_ref: headRef,
    head_sha: headResult.ok ? headResult.stdout.trim() || null : null,
    remote_default_head: remoteDefaultHead,
    remote_default_head_source: remoteDefaultHeadSource,
    remote_default_head_sha: remoteHeadResult.ok ? remoteHeadResult.stdout.trim() || null : null,
    dirty_tree: dirtyPaths.length > 0,
    dirty_paths: dirtyPaths,
    checkout_safety: {
      repo_identity_ok: repoIdentity.ok,
      repo_identity_evidence: repoIdentity.evidence,
      branch_discovered: Boolean(branchName),
      detached_head: detachedHead,
      clean_detached_head_checkout_ok: Boolean(detachedHead && headResult.ok && headResult.stdout.trim() && dirtyPaths.length === 0),
      branch_discovery_source: branchResult.ok && branchResult.stdout.trim() ? 'git_branch' : githubActionsBranchFallback() || githubActionsCurrentRefFallback() ? 'github_actions_env' : null,
      head_discovered: Boolean(headResult.ok && headResult.stdout.trim()),
      remote_default_discovered: Boolean(remoteDefaultHead),
      remote_default_head_source: remoteDefaultHeadSource,
      dirty_tree_status_discovered: statusResult.ok,
      canonical_package_dirty_paths: canonicalDirtyPaths.canonicalPackageDirtyPaths,
      pr170_generated_control_dirty_paths: canonicalDirtyPaths.pr170GeneratedControlDirtyPaths,
    },
  };
}

function findingCodes(findings = []) {
  return safeList(findings)
    .filter((finding) => finding && typeof finding === 'object')
    .map((finding) => finding.code)
    .filter(Boolean);
}

function severeFindingCodes(findings = []) {
  return safeList(findings)
    .filter((finding) => finding?.severity === 'error')
    .map((finding) => finding.code)
    .filter(Boolean);
}

function disallowedPathCodes(pathValue = '') {
  const normalized = normalizeRepoPath(pathValue);
  return [...new Set(DISALLOWED_SOURCE_PATH_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([code]) => code))];
}

function scanPrivateText(prefix, text) {
  const findings = [];
  if (PRIVATE_URL_PATTERN.test(text)) findings.push(`${prefix}_private_url`);
  if (TOKEN_PATTERN.test(text)) findings.push(`${prefix}_token_or_secret`);
  if (ABSOLUTE_PATH_PATTERN.test(text)) findings.push(`${prefix}_absolute_path`);
  if (PII_PATTERN.test(text)) findings.push(`${prefix}_pii`);
  return findings;
}

function firstString(document, fields = []) {
  const source = safeObject(document);
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function measuredFeatures(document = {}) {
  return safeList(safeObject(document).measured_features)
    .filter((feature) => feature && typeof feature === 'object' && !Array.isArray(feature));
}

function completeReview(review = {}) {
  const status = normalizeStatus(review.status);
  return COMPLETE_STATUSES.has(status)
    && typeof review.reviewed_by === 'string'
    && review.reviewed_by.trim()
    && typeof review.reviewed_at === 'string'
    && review.reviewed_at.trim();
}

function readReviewManifestSummary(projectRoot, reviewPath, reviewManifest, reviewSha) {
  const pathRef = pathInsideProject(projectRoot, reviewPath);
  return {
    path: pathRef?.relative || normalizeRepoPath(reviewPath),
    exists: Boolean(reviewManifest),
    artifact_type: reviewManifest?.artifact_type || null,
    package_slug: reviewManifest?.package_slug || null,
    sha256: reviewSha,
  };
}

async function loadAuthorizationRecord(projectRoot, authorizationRef) {
  if (!authorizationRef) {
    return {
      exists: false,
      document: null,
      ref: null,
      errors: ['authorization_record_missing'],
    };
  }
  if (/^https?:\/\//i.test(authorizationRef)) {
    if (!isSafePublicAuthorizationUrl(authorizationRef)) {
      return {
        exists: false,
        document: null,
        ref: sanitizedRef(projectRoot, authorizationRef),
        errors: ['authorization_url_not_safe_public_ref'],
      };
    }
    try {
      const response = await fetch(authorizationRef);
      if (!response.ok) {
        return {
          exists: false,
          document: null,
          ref: authorizationRef,
          errors: ['authorization_url_unavailable'],
        };
      }
      return {
        exists: true,
        document: await response.json(),
        ref: authorizationRef,
        errors: [],
      };
    } catch {
      return {
        exists: false,
        document: null,
        ref: authorizationRef,
        errors: ['authorization_url_unavailable'],
      };
    }
  }

  const authPath = pathInsideProject(projectRoot, authorizationRef);
  if (!authPath || !existsSync(authPath.absolute)) {
    return {
      exists: false,
      document: null,
      ref: authPath?.relative || normalizeRepoPath(authorizationRef),
      errors: ['authorization_record_missing'],
    };
  }
  try {
    return {
      exists: true,
      document: await readJsonFile(authPath.absolute),
      ref: authPath.relative,
      errors: [],
    };
  } catch {
    return {
      exists: true,
      document: null,
      ref: authPath.relative,
      errors: ['authorization_record_json_invalid'],
    };
  }
}

function buildReviewManifestGate(reviewManifest, validationErrors) {
  const ok = reviewManifest?.artifact_type === REVIEW_DRY_RUN_ARTIFACT_TYPE
    && reviewManifest?.dry_run === true
    && reviewManifest?.non_mutating === true
    && validationErrors.length === 0;
  const reasons = [];
  if (!reviewManifest) reasons.push('review_manifest_missing');
  if (reviewManifest && reviewManifest.artifact_type !== REVIEW_DRY_RUN_ARTIFACT_TYPE) reasons.push('review_manifest_wrong_artifact_type');
  if (reviewManifest && reviewManifest.dry_run !== true) reasons.push('review_manifest_not_dry_run');
  if (reviewManifest && reviewManifest.non_mutating !== true) reasons.push('review_manifest_not_non_mutating');
  reasons.push(...validationErrors);
  return gate(
    'review_manifest_from_stage5b_review_dry_run',
    ok,
    ok
      ? 'Review manifest was produced by stage5b-evidence-review-dry-run and validates as non-mutating control output.'
      : 'Review manifest must exist, validate, and come from stage5b-evidence-review-dry-run.',
    { reasons }
  );
}

function buildSourcePreflightGate(reviewManifest) {
  const preflight = safeObject(reviewManifest?.source_preflight);
  const source = safeObject(preflight.source);
  const ready = preflight.classification === 'ready_for_stage5b_review'
    && preflight.summary?.ready_for_later_attachment_flow === true
    && source.exists === true;
  const reasons = [];
  if (!reviewManifest) reasons.push('review_manifest_missing');
  if (preflight.classification !== 'ready_for_stage5b_review') reasons.push('source_preflight_not_ready');
  if (preflight.summary?.ready_for_later_attachment_flow !== true) reasons.push('source_preflight_not_ready_for_later_attachment_flow');
  if (source.exists !== true) reasons.push('source_missing');
  reasons.push(...severeFindingCodes(preflight.source_findings));
  reasons.push(...severeFindingCodes(preflight.safety_findings));
  return gate(
    'source_preflight_ready',
    ready,
    ready
      ? 'Source preflight is ready_for_stage5b_review.'
      : 'Source preflight must be ready_for_stage5b_review with an existing source.',
    {
      reasons,
      evidence: {
        classification: preflight.classification || null,
        source_status: preflight.summary?.source_status || null,
        source_path: source.path || null,
      },
    }
  );
}

function buildSourceSafetyGate(reviewManifest, authorization = {}) {
  const preflight = safeObject(reviewManifest?.source_preflight);
  const source = safeObject(preflight.source);
  const authorizedExplicitSafe = authorization.source_safety_review?.explicitly_safe_source_ref === true
    && completeReview(authorization.source_safety_review);
  const ignoredAndUntracked = source.ignored_by_git === true && source.tracked_by_git !== true;
  const ok = source.exists === true && (ignoredAndUntracked || authorizedExplicitSafe);
  const reasons = [];
  if (source.exists !== true) reasons.push('source_missing');
  if (!ignoredAndUntracked && !authorizedExplicitSafe) reasons.push('source_not_ignored_or_explicitly_safe');
  return gate(
    'source_ignored_or_explicitly_safe',
    ok,
    ok
      ? 'Source is ignored/untracked or explicitly reviewed as safe for this controller.'
      : 'Source must be ignored and untracked, or explicitly reviewed safe in the authorization record.',
    {
      reasons,
      evidence: {
        source_path: source.path || null,
        ignored_by_git: source.ignored_by_git ?? null,
        tracked_by_git: source.tracked_by_git ?? null,
        explicit_safe_review: authorizedExplicitSafe,
      },
    }
  );
}

async function loadCandidate(projectRoot, reviewManifest) {
  const candidateRel = reviewManifest?.generated_candidate?.path;
  const candidatePath = pathInsideProject(projectRoot, candidateRel || '');
  if (!candidatePath || !existsSync(candidatePath.absolute)) {
    return {
      exists: false,
      document: null,
      path: candidatePath?.relative || candidateRel || null,
      errors: ['candidate_json_missing'],
    };
  }
  try {
    return {
      exists: true,
      document: await readJsonFile(candidatePath.absolute),
      path: candidatePath.relative,
      errors: [],
    };
  } catch {
    return {
      exists: true,
      document: null,
      path: candidatePath.relative,
      errors: ['candidate_json_invalid'],
    };
  }
}

function buildCandidateGate(reviewManifest, candidateLoad) {
  const candidate = safeObject(candidateLoad.document);
  const packageSlug = reviewManifest?.package_slug;
  const text = JSON.stringify(candidateLoad.document || {});
  const privateFindings = scanPrivateText('candidate', text);
  const candidatePathCodes = disallowedPathCodes(candidateLoad.path || '').filter((code) => code !== 'generated_artifact_not_evidence');
  const reviewScope = safeObject(candidate.review_scope);
  const packageScoped = candidate.package_id === packageSlug || candidate.inspected_part === packageSlug;
  const provenanceComplete = Boolean(
    candidate.source_type
    && firstString(candidate, ['inspection_status', 'status', 'completion_status', 'record_status'])
    && firstString(candidate, ['inspection_date', 'inspected_at', 'date', 'completed_at'])
    && firstString(candidate, ['inspector', 'inspection_author'])
    && firstString(candidate, ['reviewed_by', 'approved_by', 'qa_reviewer', 'reviewer', 'quality_reviewer'])
    && firstString(candidate, ['source_ref', 'source_file'])
    && measuredFeatures(candidate).length > 0
  );
  const redacted = reviewManifest?.redaction_findings?.raw_source_copied === false
    && reviewManifest?.generated_candidate?.raw_source_copied === false
    && reviewScope.raw_source_copied === false;
  const reviewScopedOnly = candidate.artifact_type === 'stage5b_evidence_review_dry_run_candidate'
    && reviewScope.dry_run === true
    && reviewScope.review_scoped_only === true
    && reviewScope.canonical_evidence_eligible === false;
  const ok = candidateLoad.exists === true
    && candidateLoad.errors.length === 0
    && privateFindings.length === 0
    && candidatePathCodes.length === 0
    && packageScoped
    && provenanceComplete
    && redacted
    && reviewScopedOnly;
  const reasons = [
    ...candidateLoad.errors,
    ...privateFindings,
    ...candidatePathCodes,
  ];
  if (!packageScoped) reasons.push('candidate_not_package_scoped');
  if (!provenanceComplete) reasons.push('candidate_provenance_incomplete');
  if (!redacted) reasons.push('candidate_not_redacted_or_raw_source_copied');
  if (!reviewScopedOnly) reasons.push('candidate_not_review_scoped_dry_run_derivative');
  return gate(
    'candidate_json_redacted_package_scoped_provenance_complete',
    ok,
    ok
      ? 'Review candidate JSON is redacted, package-scoped, provenance-complete, and review-scoped only.'
      : 'Review candidate JSON must be redacted, package-scoped, provenance-complete, and free of private/raw data.',
    {
      reasons,
      evidence: {
        path: candidateLoad.path,
        package_id: candidate.package_id || null,
        inspected_part: candidate.inspected_part || null,
        measured_feature_count: measuredFeatures(candidate).length,
      },
    }
  );
}

function buildAuthorizationGate({ projectRoot, authorization, authRef, reviewManifest, reviewManifestPath, candidatePath }) {
  const auth = safeObject(authorization.document);
  const expectedReviewRef = repoRelativePath(projectRoot, reviewManifestPath);
  const expectedManifestOutputRef = reviewManifest?.outputs?.manifest?.path || expectedReviewRef;
  const expectedCandidateRef = candidatePath || reviewManifest?.generated_candidate?.path || null;
  const expectedSourcePreflightRef = reviewManifest?.outputs?.source_preflight_report?.path || null;
  const expectedAuditRef = reviewManifest?.outputs?.audit_manifest?.path || null;
  const authText = JSON.stringify(auth);
  const unsafeAuth = scanPrivateText('authorization', authText);
  const requiredReviews = [
    'redaction_review',
    'provenance_review',
    'package_mapping_review',
    'intake_review',
    'promotion_dry_run_review',
    'audit_review',
  ];
  const incompleteReviews = requiredReviews.filter((field) => !completeReview(auth[field]));
  const recordType = auth.record_type || auth.artifact_type || null;
  const reviewRefMatches = normalizeRepoPath(auth.review_manifest_ref) === normalizeRepoPath(expectedReviewRef)
    || normalizeRepoPath(auth.review_manifest_ref) === normalizeRepoPath(expectedManifestOutputRef);
  const candidateRefMatches = normalizeRepoPath(auth.reviewed_redacted_evidence_json_ref) === normalizeRepoPath(expectedCandidateRef);
  const sourcePreflightMatches = !expectedSourcePreflightRef
    || normalizeRepoPath(auth.source_preflight_ref) === normalizeRepoPath(expectedSourcePreflightRef);
  const auditMatches = !expectedAuditRef || normalizeRepoPath(auth.audit_output_ref) === normalizeRepoPath(expectedAuditRef);
  const approvedCommands = safeList(auth.approved_commands).join('\n');
  const approvedCommandBoundary = /review-context\b/.test(approvedCommands)
    && /--inspection-evidence\b/.test(approvedCommands)
    && /--attachment-authorization\b/.test(approvedCommands);
  const readinessHeldAck = /needs_more_evidence\s*\/\s*hold_for_evidence_completion/i.test(String(auth.readiness_held_acknowledgement || ''));
  const hardRuleAck = /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/i
    .test(String(auth.evidence_boundary_acknowledgement || ''));
  const ok = authorization.exists === true
    && authorization.errors.length === 0
    && recordType === AUTHORIZATION_RECORD_TYPE
    && auth.authorized_attachment === true
    && auth.package_slug === reviewManifest?.package_slug
    && reviewRefMatches
    && candidateRefMatches
    && sourcePreflightMatches
    && auditMatches
    && typeof auth.human_authorizer === 'string'
    && auth.human_authorizer.trim()
    && typeof auth.authorized_at === 'string'
    && auth.authorized_at.trim()
    && typeof auth.later_attachment_task_boundary === 'string'
    && auth.later_attachment_task_boundary.trim()
    && approvedCommandBoundary
    && readinessHeldAck
    && hardRuleAck
    && incompleteReviews.length === 0
    && unsafeAuth.length === 0;
  const reasons = [...authorization.errors, ...unsafeAuth];
  if (authorization.exists && recordType !== AUTHORIZATION_RECORD_TYPE) reasons.push('authorization_record_wrong_type');
  if (authorization.exists && auth.authorized_attachment !== true) reasons.push('authorization_record_not_authorized');
  if (authorization.exists && auth.package_slug !== reviewManifest?.package_slug) reasons.push('authorization_package_scope_mismatch');
  if (authorization.exists && !reviewRefMatches) reasons.push('authorization_review_manifest_scope_mismatch');
  if (authorization.exists && !candidateRefMatches) reasons.push('authorization_candidate_scope_mismatch');
  if (authorization.exists && !sourcePreflightMatches) reasons.push('authorization_source_preflight_scope_mismatch');
  if (authorization.exists && !auditMatches) reasons.push('authorization_audit_scope_mismatch');
  if (authorization.exists && incompleteReviews.length > 0) reasons.push(...incompleteReviews.map((field) => `${field}_incomplete`));
  if (authorization.exists && !approvedCommandBoundary) reasons.push('authorization_command_boundary_missing_review_context');
  if (authorization.exists && !readinessHeldAck) reasons.push('authorization_readiness_held_acknowledgement_missing');
  if (authorization.exists && !hardRuleAck) reasons.push('authorization_hard_evidence_rule_acknowledgement_missing');
  return gate(
    'authorization_record_scopes_attachment_attempt',
    ok,
    ok
      ? 'Authorization record exists and scopes this exact controller attempt.'
      : 'Authorization record must exist, be complete, and scope the review manifest, candidate, package, and later mutation boundary.',
    {
      reasons,
      evidence: {
        ref: authRef,
        record_type: recordType,
        package_slug: auth.package_slug || null,
      },
    }
  );
}

function buildNonEvidenceBoundaryGate(reviewManifest) {
  const preflight = safeObject(reviewManifest?.source_preflight);
  const sourcePath = preflight.source?.path || '';
  const sourceCodes = [
    ...disallowedPathCodes(sourcePath),
    ...findingCodes(preflight.source_findings),
    ...findingCodes(preflight.safety_findings),
  ].filter((code) => (
    /surrogate|synthetic|generated|cad|docs|collection|ci|readiness|schema|fixture|tracked_source_file|unsupported_source_format/i.test(code)
  ));
  const ok = sourceCodes.length === 0;
  return gate(
    'non_evidence_sources_rejected_as_real_evidence',
    ok,
    ok
      ? 'Surrogate/generated/docs/CI/readiness/spec/CAD/test fixture sources are not being treated as real evidence.'
      : 'Surrogate/generated/docs/CI/readiness/spec/CAD/test fixture sources cannot pass as real evidence.',
    {
      reasons: [...new Set(sourceCodes.length > 0 ? ['source_boundary_rejected', ...sourceCodes] : [])],
      evidence: { source_path: sourcePath || null },
    }
  );
}

function buildRepoGate(repoPreflight) {
  const branchOrCleanDetached = Boolean(repoPreflight.current_branch)
    || isCleanDetachedStage5bAttachmentControllerCheckout(repoPreflight);
  const safe = repoPreflight.repo_identity_ok
    && branchOrCleanDetached
    && Boolean(repoPreflight.head_sha)
    && Boolean(repoPreflight.remote_default_head);
  const reasons = [];
  if (!repoPreflight.repo_identity_ok) reasons.push('repo_identity_invalid');
  if (!repoPreflight.current_branch && !isCleanDetachedStage5bAttachmentControllerCheckout(repoPreflight)) {
    reasons.push('branch_not_discovered');
  }
  if (!repoPreflight.head_sha) reasons.push('head_not_discovered');
  if (!repoPreflight.remote_default_head) reasons.push('remote_default_head_not_discovered');
  if (repoPreflight.checkout_safety?.dirty_tree_status_discovered !== true) {
    reasons.push('dirty_tree_status_not_discovered');
  }
  if (safeList(repoPreflight.checkout_safety?.canonical_package_dirty_paths).length > 0) {
    reasons.push('canonical_package_dirty_paths_present');
  }
  return gate(
    'repo_checkout_preflight',
    safe && reasons.length === 0,
    safe && reasons.length === 0
      ? 'Repository root, branch, HEAD, remote default HEAD, and checkout safety were verified.'
      : 'Repository checkout preflight is not safe enough for attachment control.',
    {
      reasons,
      evidence: {
        repo_root_basename: repoPreflight.repo_root_basename,
        current_branch: repoPreflight.current_branch,
        head_sha: repoPreflight.head_sha,
        remote_default_head: repoPreflight.remote_default_head,
        dirty_tree: repoPreflight.dirty_tree,
      },
    }
  );
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
    statement: 'Controller output is readiness-held control metadata only; canonical readiness remains needs_more_evidence / hold_for_evidence_completion until a later explicit attachment/regeneration task completes.',
  };
}

function nextCommands({ reviewManifest, authorizationRef, ready }) {
  const packageSlug = reviewManifest?.package_slug || 'unknown-package';
  const sourcePath = reviewManifest?.source_preflight?.source?.path || `local/stage5b-candidate-evidence-inbox/${packageSlug}/received-record.json`;
  const reviewManifestPath = reviewManifest?.outputs?.manifest?.path || 'output/stage5b-review-dry-run/stage5b_evidence_review_dry_run_manifest.json';
  const candidatePath = reviewManifest?.generated_candidate?.path || '<reviewed-redacted-evidence.json>';
  return [
    {
      label: 'repair_source_preflight',
      allowed_now: !ready,
      command: [
        'fcad',
        'stage5b-evidence-source-preflight',
        '--package',
        packageSlug,
        '--source',
        sourcePath,
        '--out',
        `local/stage5b-candidate-evidence-inbox/${packageSlug}/source-preflight-report.json`,
      ],
    },
    {
      label: 'rerun_review_dry_run',
      allowed_now: !ready,
      command: [
        'fcad',
        'stage5b-evidence-review-dry-run',
        '--package',
        packageSlug,
        '--source',
        sourcePath,
        '--out-dir',
        'output/stage5b-review-dry-run',
      ],
    },
    {
      label: 'rerun_attachment_controller',
      allowed_now: !ready,
      command: [
        'fcad',
        'stage5b-evidence-attachment-controller',
        '--review-manifest',
        reviewManifestPath,
        '--authorization-record',
        authorizationRef || '<authorization-record.json>',
        '--out-dir',
        'output/stage5b-attachment-controller',
        '--dry-run',
      ],
    },
    {
      label: 'later_explicit_attachment_task_only',
      allowed_now: false,
      command: [
        'fcad',
        'review-context',
        '--inspection-evidence',
        candidatePath,
        '--attachment-authorization',
        authorizationRef || '<authorization-record.json>',
      ],
      note: 'Boundary only: this controller never runs the attachment command and readiness regeneration remains a separate later explicit task.',
    },
  ];
}

export async function writeStage5bEvidenceAttachmentControlManifest({
  projectRoot = process.cwd(),
  reviewManifestPath,
  authorizationRecord,
  outDir,
  dryRun = false,
  generatedAt = null,
} = {}) {
  const root = resolve(projectRoot);
  const generated = nowIso(generatedAt);
  const outputDir = await assertIgnoredOutputDir(root, outDir || 'output/stage5b-evidence-attachment-controller');
  const outputPath = join(outputDir.absolute, STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_MANIFEST_FILE_NAME);
  const repoPreflight = await collectRepoPreflight(root);
  const reviewPath = pathInsideProject(root, reviewManifestPath || '');

  let reviewManifest = null;
  let reviewSha = null;
  const reviewValidationErrors = [];
  if (!reviewPath || !existsSync(reviewPath.absolute)) {
    reviewValidationErrors.push('review_manifest_missing');
  } else {
    try {
      reviewManifest = await readJsonFile(reviewPath.absolute);
      reviewSha = await sha256IfReadable(reviewPath.absolute);
      try {
        assertValidStage5bEvidenceReviewDryRunManifest(reviewManifest, {
          label: 'evidence review dry-run manifest',
          artifactPath: reviewPath.absolute,
          projectRoot: root,
        });
      } catch (error) {
        reviewValidationErrors.push(...safeList(error.validation_errors).map(() => 'review_manifest_schema_invalid'));
      }
    } catch {
      reviewValidationErrors.push('review_manifest_json_invalid');
    }
  }

  const authorization = await loadAuthorizationRecord(root, authorizationRecord);
  const auth = safeObject(authorization.document);
  const candidateLoad = reviewManifest ? await loadCandidate(root, reviewManifest) : {
    exists: false,
    document: null,
    path: null,
    errors: ['candidate_json_missing'],
  };

  const gates = [
    buildRepoGate(repoPreflight),
    buildReviewManifestGate(reviewManifest, reviewValidationErrors),
    buildSourcePreflightGate(reviewManifest),
    buildSourceSafetyGate(reviewManifest, auth),
    buildCandidateGate(reviewManifest, candidateLoad),
    buildAuthorizationGate({
      projectRoot: root,
      authorization,
      authRef: authorization.ref,
      reviewManifest,
      reviewManifestPath: reviewPath?.relative || normalizeRepoPath(reviewManifestPath),
      candidatePath: candidateLoad.path,
    }),
    buildNonEvidenceBoundaryGate(reviewManifest),
  ];

  const blockerList = [];
  for (const gateEntry of gates) {
    blockerList.push(...blockersFromGate(gateEntry));
  }
  const uniqueBlockers = [];
  const seenBlockers = new Set();
  for (const item of blockerList) {
    const key = `${item.code}|${item.gate}`;
    if (seenBlockers.has(key)) continue;
    seenBlockers.add(key);
    uniqueBlockers.push(item);
  }

  const ready = uniqueBlockers.length === 0;
  const manifest = {
    artifact_type: STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_ARTIFACT_TYPE,
    schema_version: STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_SCHEMA_VERSION,
    generated_at: generated,
    dry_run: dryRun === true,
    non_mutating: true,
    review_manifest: readReviewManifestSummary(root, reviewManifestPath, reviewManifest, reviewSha),
    authorization_record: {
      ref: authorization.ref,
      exists: authorization.exists,
      record_type: auth.record_type || auth.artifact_type || null,
      package_slug: auth.package_slug || null,
      safe_ref_only: true,
    },
    repo_preflight: repoPreflight,
    source_control: {
      source_path: reviewManifest?.source_preflight?.source?.path || null,
      source_classification: reviewManifest?.source_preflight?.classification || null,
      source_status: reviewManifest?.source_preflight?.summary?.source_status || null,
      source_ignored_by_git: reviewManifest?.source_preflight?.source?.ignored_by_git ?? null,
      source_tracked_by_git: reviewManifest?.source_preflight?.source?.tracked_by_git ?? null,
      source_finding_codes: findingCodes(reviewManifest?.source_preflight?.source_findings),
      safety_finding_codes: findingCodes(reviewManifest?.source_preflight?.safety_findings),
    },
    candidate_control: {
      path: candidateLoad.path,
      exists: candidateLoad.exists,
      artifact_type: candidateLoad.document?.artifact_type || null,
      package_id: candidateLoad.document?.package_id || null,
      inspected_part: candidateLoad.document?.inspected_part || null,
      raw_source_copied: candidateLoad.document?.review_scope?.raw_source_copied ?? null,
      review_scoped_only: candidateLoad.document?.review_scope?.review_scoped_only ?? null,
      canonical_evidence_eligible: candidateLoad.document?.review_scope?.canonical_evidence_eligible ?? null,
    },
    gates,
    blockers: uniqueBlockers,
    next_commands: nextCommands({ reviewManifest, authorizationRef: authorization.ref, ready }),
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      controller_does_not_attach_evidence: true,
      controller_does_not_promote_evidence: true,
      controller_does_not_regenerate_readiness: true,
      controller_does_not_mark_packages_ready: true,
      later_explicit_attachment_task_required: true,
      rejected_as_real_evidence: [...REJECTED_AS_REAL_EVIDENCE],
      authorization_records_are_control_metadata_only: true,
      review_dry_run_candidates_are_control_metadata_only: true,
    },
    readiness_held_truth: readinessHeldTruth(),
    summary: {
      attachment_control_status: ready
        ? dryRun === true ? 'authorized_attachment_ready_dry_run' : 'authorized_attachment_ready_control_only'
        : 'hold_for_attachment_controller_blockers',
      decision: ready ? 'pass' : 'hold',
      future_explicit_attachment_prerequisites_met: ready,
      blocker_count: uniqueBlockers.length,
      evidence_attached: false,
      canonical_artifacts_mutated: false,
      canonical_readiness_regenerated: false,
      packages_marked_ready: false,
      readiness_status: 'needs_more_evidence',
      readiness_gate_decision: 'hold_for_evidence_completion',
      attachment_command_ran: false,
      canonical_readiness_regeneration_ran: false,
    },
    outputs: {
      manifest: {
        path: repoRelativePath(root, outputPath),
        artifact_type: STAGE5B_EVIDENCE_ATTACHMENT_CONTROL_ARTIFACT_TYPE,
        sha256: null,
      },
    },
  };

  assertValidStage5bEvidenceAttachmentControlManifest(manifest, {
    label: 'evidence attachment control manifest',
    artifactPath: outputPath,
    projectRoot: root,
  });
  await writeJsonFile(outputPath, manifest);
  const manifestSha = await sha256IfReadable(outputPath);
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
  await writeJsonFile(outputPath, finalManifest);
  return {
    manifest: finalManifest,
    output_dir: outputDir.relative,
    output_path: repoRelativePath(root, outputPath),
    absolute_output_path: outputPath,
  };
}

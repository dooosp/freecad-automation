import { createHash } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { constants, lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import { validateDocsManifestAgainstReadiness } from '../../lib/af-execution-contract.js';
import { collectArtifactMetadata } from '../../lib/artifact-manifest.js';
import {
  C_ARTIFACT_SCHEMA_VERSION,
  assertValidCArtifact,
  getCCommandContract,
} from '../../lib/c-artifact-schema.js';
import { writeValidatedCArtifact } from '../../lib/context-loader.js';
import { publishAtomicOutputSet } from '../../lib/atomic-output-publication.js';
import { buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';
import { parseInspectionEvidenceJsonBytes } from '../../lib/inspection-evidence-onboarding.js';
import {
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
} from '../../lib/revision-lineage-contract.js';
import { buildZipArchive, createZipArchive } from '../../lib/zip-archive.js';

const MAX_PROOF_BUNDLE_SOURCE_BYTES = 64 * 1024 * 1024;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nowIso(explicitValue = null) {
  if (typeof explicitValue === 'string' && explicitValue.trim()) return explicitValue.trim();
  return new Date().toISOString();
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function compareStrings(left = '', right = '') {
  return String(left || '').localeCompare(String(right || ''));
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function exactLineageParent(lineage, role, artifactType, label) {
  const matches = lineage.parents.filter((parent) => (
    parent.role === role && parent.artifact_type === artifactType
  ));
  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${role} ${artifactType} lineage parent.`);
  }
  const [parent] = matches;
  if (!Number.isInteger(parent.size_bytes)) {
    throw new Error(`${label} ${role} lineage parent must include size_bytes.`);
  }
  return parent;
}

function assertExactLineageParent(left, right, label) {
  if (
    left.artifact_type !== right.artifact_type
    || left.role !== right.role
    || left.path !== right.path
    || left.sha256 !== right.sha256
    || left.size_bytes !== right.size_bytes
  ) {
    throw new Error(`${label} does not match the exact upstream lineage parent.`);
  }
}

function parseCanonicalProofJson(bytes, label) {
  try {
    return parseInspectionEvidenceJsonBytes(bytes, { requireCanonical: true });
  } catch (error) {
    const wrapped = new Error(`${label} is not canonical strict JSON: ${error.message}`, { cause: error });
    wrapped.code = error?.code || 'invalid_proof_json';
    throw wrapped;
  }
}

function pathWithinRootRelative(rootDir, targetPath) {
  if (!rootDir || !targetPath) return null;
  const relPath = relative(resolve(rootDir), resolve(targetPath)).replace(/\\/g, '/');
  return relPath && !relPath.startsWith('..') && !isAbsolute(relPath) ? relPath : null;
}

function isBlockedRepoPath(repoPath = '') {
  const normalized = normalizeBundlePath(repoPath);
  return normalized === '.git'
    || normalized.startsWith('.git/')
    || normalized === 'local'
    || normalized.startsWith('local/')
    || normalized === 'tmp'
    || normalized.startsWith('tmp/')
    || normalized === 'output'
    || normalized.startsWith('output/');
}

function isAllowedRepoSourcePath(repoPath = '') {
  const normalized = normalizeBundlePath(repoPath);
  if (!normalized || isBlockedRepoPath(normalized)) return false;
  return normalized.startsWith('docs/examples/')
    || normalized.startsWith('configs/examples/')
    || normalized.startsWith('configs/generated/')
    || normalized.startsWith('tests/fixtures/');
}

function mergeSourceArtifactRefs(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const ref of [...primary, ...secondary]) {
    if (!ref?.artifact_type || !ref?.role) continue;
    const key = `${ref.artifact_type}|${ref.path || ''}|${ref.role}|${ref.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      artifact_type: ref.artifact_type,
      path: ref.path || null,
      role: ref.role,
      label: ref.label || null,
      ...(typeof ref.sha256 === 'string' ? { sha256: ref.sha256 } : {}),
      ...(Number.isInteger(ref.size_bytes) ? { size_bytes: ref.size_bytes } : {}),
    });
  }
  return merged;
}

function repoRelativePath(projectRoot, filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
  const relPath = relative(resolve(projectRoot), resolve(filePath)).replace(/\\/g, '/');
  return relPath && !relPath.startsWith('..') && !relPath.startsWith('/')
    ? relPath
    : filePath;
}

function portablePath(projectRoot, filePath, fallbackRoots = []) {
  if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
  const repoPath = pathWithinRootRelative(projectRoot, filePath);
  if (repoPath) return repoPath;
  for (const root of fallbackRoots.filter(Boolean)) {
    const rootPath = pathWithinRootRelative(root, filePath);
    if (rootPath) return rootPath;
  }
  return safeDisplayPath(filePath);
}

function proofPortablePath(projectRoot, filePath, portableRoots = []) {
  if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
  for (const root of portableRoots.filter(Boolean)) {
    const rootPath = pathWithinRootRelative(root, filePath);
    if (rootPath) return `run/${rootPath}`;
  }
  return portablePath(projectRoot, filePath);
}

function outputPortablePath(outputDir, filePath) {
  return portablePath(null, filePath, [outputDir]);
}

function isPathWithinRoot(rootDir, targetPath) {
  if (!rootDir || !targetPath) return false;
  const relPath = relative(resolve(rootDir), resolve(targetPath)).replace(/\\/g, '/');
  return relPath === '' || (!relPath.startsWith('..') && !isAbsolute(relPath));
}

function normalizeBundlePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function assertSafeBundlePath(relativePath) {
  const normalized = normalizeBundlePath(relativePath);
  const segments = normalized.split('/');
  const unsafe = !normalized
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || normalized.includes('\0');
  if (unsafe) {
    throw new Error(`Unsafe release bundle path: ${relativePath || '(empty)'}`);
  }
  return normalized;
}

function makeUniqueBundlePath(desiredPath, usedPaths) {
  const normalized = assertSafeBundlePath(desiredPath);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }

  const extension = extname(normalized);
  const base = extension ? normalized.slice(0, -extension.length) : normalized;
  let index = 2;
  while (usedPaths.has(`${base}-${index}${extension}`)) {
    index += 1;
  }
  const resolved = `${base}-${index}${extension}`;
  usedPaths.add(resolved);
  return resolved;
}

function defaultBundlePathForSourceRef(ref) {
  const sourcePath = ref.path || `${ref.artifact_type}.bin`;
  const fileName = basename(sourcePath);
  switch (ref.artifact_type) {
    case 'review_pack':
      return 'canonical/review_pack.json';
    case 'config':
      return `inputs/${fileName}`;
    case 'engineering_context':
      return `inputs/${fileName}`;
    case 'cad_model':
      return `references/${fileName}`;
    case 'source_file':
      return `references/${fileName}`;
    default:
      return `references/${fileName}`;
  }
}

function isCanonicalLineageRef(ref) {
  if (ref?.artifact_type !== 'review_pack') return false;
  const fileName = basename(String(ref.path || '').replace(/\\/g, '/'));
  return fileName === 'review_pack.json';
}

function isExactProofLineageParentRef(ref, proofLineageParents = []) {
  return safeList(proofLineageParents).some((parent) => (
    ref?.artifact_type === parent.artifact_type
    && ref?.role === parent.role
    && ref?.path === parent.path
    && ref?.sha256 === parent.sha256
    && (ref?.size_bytes ?? null) === (parent.size_bytes ?? null)
  ));
}

function safeDisplayPath(rawPath) {
  const fileName = basename(String(rawPath || '').replace(/\\/g, '/'));
  return fileName || 'outside-bundle-root';
}

function safeDocumentFilename(rawFilename, resolvedDocumentPath) {
  const candidate = String(rawFilename || basename(resolvedDocumentPath) || '').trim();
  if (
    !candidate
    || candidate.includes('/')
    || candidate.includes('\\')
    || candidate.includes('\0')
    || candidate === '.'
    || candidate === '..'
  ) {
    throw new Error(`Unsafe docs manifest filename for release bundle: ${safeDisplayPath(candidate || resolvedDocumentPath)}`);
  }
  return candidate;
}

function assertRepoScopedDocsManifest(projectRoot, docsManifestPath) {
  if (!docsManifestPath) return;
  const repoPath = pathWithinRootRelative(projectRoot, docsManifestPath);
  if (!repoPath) {
    throw new Error('Docs manifest for release packaging must stay inside the repository root.');
  }
}

function resolveArtifactPath(rawPath, {
  projectRoot,
  readinessDir,
  allowedRoots = null,
  proofMode = false,
}) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return {
      ok: false,
      path: null,
      reason: 'missing_path',
    };
  }

  const roots = uniqueStrings(
    (allowedRoots || [projectRoot, readinessDir])
      .filter(Boolean)
      .map((root) => resolve(root))
  );
  const raw = rawPath.trim();
  let candidates;
  if (proofMode && raw.startsWith('run/')) {
    const runRelative = raw.slice('run/'.length);
    const runCandidate = resolve(readinessDir, runRelative);
    if (!runRelative || !isPathWithinRoot(readinessDir, runCandidate)) {
      return { ok: false, path: runCandidate, reason: 'unsafe_run_locator' };
    }
    candidates = [runCandidate];
  } else if (proofMode && (raw.startsWith('input/') || raw.startsWith('runtime/'))) {
    return { ok: false, path: null, reason: 'unsupported_proof_locator' };
  } else if (proofMode && isAbsolute(raw)) {
    return { ok: false, path: resolve(raw), reason: 'absolute_proof_locator' };
  } else if (isAbsolute(raw)) {
    candidates = [resolve(raw)];
  } else if (proofMode) {
    candidates = [resolve(projectRoot, raw)];
  } else {
    candidates = [resolve(projectRoot, raw), resolve(readinessDir, raw)];
  }

  const allowedCandidates = candidates.filter((candidate) =>
    roots.some((root) => isPathWithinRoot(root, candidate))
  );

  const existing = allowedCandidates.find((candidate) => existsSync(candidate));
  if (existing) {
    return {
      ok: true,
      path: existing,
      reason: 'found',
    };
  }

  if (allowedCandidates.length > 0) {
    return {
      ok: true,
      path: allowedCandidates[0],
      reason: 'missing',
    };
  }

  return {
    ok: false,
    path: candidates[0],
    reason: 'outside_allowed_roots',
  };
}

function sourceArtifactAllowed(ref, resolvedPath, {
  projectRoot,
  readinessDir,
  trustedSourceRoots = [],
  proofLineageParents = [],
}) {
  if (!ref?.path || !resolvedPath) {
    return { ok: true, reason: 'allowed' };
  }
  if (trustedSourceRoots.some((root) => isPathWithinRoot(root, resolvedPath))) {
    return { ok: true, reason: 'allowed_tracked_job_artifact' };
  }
  const repoPath = pathWithinRootRelative(projectRoot, resolvedPath);
  if (!repoPath) {
    return { ok: true, reason: 'allowed_external_work_dir' };
  }
  const readinessPath = pathWithinRootRelative(readinessDir, resolvedPath);
  if (readinessPath && isExactProofLineageParentRef(ref, proofLineageParents)) {
    return { ok: true, reason: 'allowed_exact_proof_parent_in_readiness_dir' };
  }
  if (readinessPath && !isBlockedRepoPath(repoPath)) {
    return { ok: true, reason: 'allowed_readiness_dir' };
  }
  if (isAllowedRepoSourcePath(repoPath)) {
    return { ok: true, reason: 'allowed_repo_source' };
  }
  return { ok: false, reason: 'disallowed_repo_source_path' };
}

function filterAllowedSourceArtifactRefs(refs = [], {
  projectRoot,
  readinessDir,
  trustedSourceRoots = [],
  proofLineageParents = [],
  warnings,
  skippedArtifacts,
}) {
  const allowedRoots = uniqueStrings([projectRoot, readinessDir, ...trustedSourceRoots]);
  const proofMode = proofLineageParents.length > 0;
  return safeList(refs).filter((ref) => {
    if (!ref?.path) return true;
    const resolved = resolveArtifactPath(ref.path, {
      projectRoot,
      readinessDir,
      allowedRoots,
      proofMode,
    });
    const allowed = resolved.ok
      ? sourceArtifactAllowed(ref, resolved.path, {
          projectRoot,
          readinessDir,
          trustedSourceRoots,
          proofLineageParents,
        })
      : resolved;
    if (resolved.ok && allowed.ok) return true;
    skippedArtifacts.push({
      artifact_type: ref.artifact_type || 'source_artifact',
      role: ref.role || 'input',
      source_path: safeDisplayPath(ref.path),
      label: ref.label || null,
      reason: allowed.reason || resolved.reason,
    });
    warnings.push(`Optional source artifact path is not allowed in release bundles and was omitted: ${safeDisplayPath(ref.path)}`);
    return false;
  });
}

function manifestSourceArtifactRefs(refs = [], {
  projectRoot,
  readinessDir,
  outputDir,
  trustedSourceRoots = [],
  proofMode = false,
}) {
  const allowedRoots = uniqueStrings([projectRoot, readinessDir, ...trustedSourceRoots]);
  return safeList(refs)
    .map((ref) => {
      if (!ref?.path) return ref;
      const resolved = resolveArtifactPath(ref.path, {
        projectRoot,
        readinessDir,
        allowedRoots,
        proofMode,
      });
      return {
        ...ref,
        path: resolved.ok
          ? proofMode
            ? proofPortablePath(projectRoot, resolved.path, [readinessDir, outputDir, ...trustedSourceRoots])
            : portablePath(projectRoot, resolved.path, [readinessDir, outputDir, ...trustedSourceRoots])
          : safeDisplayPath(ref.path),
      };
    })
    .sort((left, right) => {
      const leftKey = `${left?.artifact_type || ''}|${left?.path || ''}|${left?.role || ''}|${left?.label || ''}`;
      const rightKey = `${right?.artifact_type || ''}|${right?.path || ''}|${right?.role || ''}|${right?.label || ''}`;
      return compareStrings(leftKey, rightKey);
    });
}

async function buildMetadataEntry({
  artifactType,
  role,
  label,
  bundlePath,
  sourcePath,
  expectedSha256 = null,
  requireAuthoritativeLineage = false,
  proofAllowedRoots = [],
}) {
  if (requireAuthoritativeLineage) {
    const absolute = resolve(sourcePath);
    const allowedRoots = uniqueStrings(proofAllowedRoots).map((root) => resolve(root))
      .filter((root) => isPathWithinRoot(root, absolute));
    const [before, canonicalPath, canonicalRoots] = await Promise.all([
      lstat(absolute, { bigint: true }),
      realpath(absolute),
      Promise.all(allowedRoots.map((root) => realpath(root))),
    ]);
    if (
      canonicalPath !== absolute
      || !canonicalRoots.some((root) => isPathWithinRoot(root, canonicalPath))
      || !before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1n
    ) {
      throw new Error(`Proof bundle source is not a safe single-link regular file: ${absolute}`);
    }
    if (before.size < 1n || before.size > BigInt(MAX_PROOF_BUNDLE_SOURCE_BYTES)) {
      throw new Error(`Proof bundle source exceeds the bounded size contract: ${absolute}`);
    }
    let handle;
    let bytes;
    let opened;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      opened = await handle.stat({ bigint: true });
      if (opened.dev !== before.dev
        || opened.ino !== before.ino
        || opened.size !== before.size
        || opened.mtimeNs !== before.mtimeNs
        || opened.ctimeNs !== before.ctimeNs
        || opened.nlink !== before.nlink) {
        throw new Error(`Proof bundle source changed while being snapshotted: ${absolute}`);
      }
      bytes = await handle.readFile();
      const afterRead = await handle.stat({ bigint: true });
      const [afterPath, afterCanonicalPath, afterCanonicalRoots] = await Promise.all([
        lstat(absolute, { bigint: true }),
        realpath(absolute),
        Promise.all(allowedRoots.map((root) => realpath(root))),
      ]);
      if (afterCanonicalPath !== absolute
        || canonicalRoots.length !== afterCanonicalRoots.length
        || canonicalRoots.some((root, index) => root !== afterCanonicalRoots[index])
        || !afterCanonicalRoots.some((root) => isPathWithinRoot(root, afterCanonicalPath))
        || !afterPath.isFile()
        || afterPath.isSymbolicLink()
        || opened.dev !== afterPath.dev
        || opened.ino !== afterPath.ino
        || opened.size !== afterPath.size
        || opened.mtimeNs !== afterPath.mtimeNs
        || opened.ctimeNs !== afterPath.ctimeNs
        || opened.nlink !== afterPath.nlink
        || opened.dev !== afterRead.dev
        || opened.ino !== afterRead.ino
        || opened.size !== afterRead.size
        || opened.mtimeNs !== afterRead.mtimeNs
        || opened.ctimeNs !== afterRead.ctimeNs
        || opened.nlink !== afterRead.nlink
        || BigInt(bytes.length) !== opened.size) {
        throw new Error(`Proof bundle source changed while being snapshotted: ${absolute}`);
      }
    } finally {
      await handle?.close();
    }
    const digest = sha256(bytes);
    if (expectedSha256 && expectedSha256 !== digest) {
      throw new Error(`Proof bundle source digest mismatch: ${absolute}`);
    }
    return {
      artifact_type: artifactType,
      role,
      label: label || null,
      path: bundlePath,
      source_path: absolute,
      exists: true,
      size_bytes: bytes.length,
      sha256: digest,
      _proof_bytes: bytes,
      _proof_identity: {
        dev: opened.dev.toString(),
        ino: opened.ino.toString(),
        size: opened.size.toString(),
        mtime_ns: opened.mtimeNs.toString(),
        ctime_ns: opened.ctimeNs.toString(),
      },
      _proof_allowed_roots: allowedRoots,
      _proof_canonical_roots: canonicalRoots,
    };
  }
  const [metadata] = await collectArtifactMetadata([{
    type: artifactType,
    path: sourcePath,
    label,
    scope: 'internal',
    stability: 'stable',
  }]);

  return {
    artifact_type: artifactType,
    role,
    label: label || null,
    path: bundlePath,
    source_path: metadata?.path || resolve(sourcePath),
    exists: Boolean(metadata?.exists),
    size_bytes: metadata?.size_bytes ?? null,
    sha256: metadata?.sha256 ?? null,
  };
}

async function assertProofSourceStillBound(entry) {
  const expected = entry?._proof_identity;
  if (!expected) return;
  const [current, canonicalPath, canonicalRoots] = await Promise.all([
    lstat(entry.source_path, { bigint: true }),
    realpath(entry.source_path),
    Promise.all(entry._proof_allowed_roots.map((root) => realpath(root))),
  ]);
  const actual = {
    dev: current.dev.toString(),
    ino: current.ino.toString(),
    size: current.size.toString(),
    mtime_ns: current.mtimeNs.toString(),
    ctime_ns: current.ctimeNs.toString(),
  };
  if (canonicalPath !== resolve(entry.source_path)
    || canonicalRoots.length !== entry._proof_canonical_roots.length
    || canonicalRoots.some((root, index) => root !== entry._proof_canonical_roots[index])
    || !canonicalRoots.some((root) => isPathWithinRoot(root, canonicalPath))
    || !current.isFile() || current.isSymbolicLink() || current.nlink !== 1n
    || Object.keys(expected).some((key) => actual[key] !== expected[key])) {
    throw new Error(`Proof bundle source changed after snapshot: ${entry.source_path}`);
  }
}

function renderBundleLog(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderChecksums(entries = []) {
  const lines = entries
    .filter((entry) => entry.sha256 && entry.path)
    .map((entry) => `${entry.sha256}  ${entry.path}`);
  return `${lines.join('\n')}\n`;
}

async function writeBundleLog(logPath, payload) {
  await writeFile(logPath, renderBundleLog(payload), 'utf8');
  return logPath;
}

async function writeChecksumsFile(checksumPath, entries = []) {
  await writeFile(checksumPath, renderChecksums(entries), 'utf8');
  return checksumPath;
}

function buildCanonicalArtifactDescriptor() {
  const contract = getCCommandContract('pack');
  return {
    json_is_source_of_truth: true,
    artifact_type: 'release_bundle_manifest',
    artifact_filename: contract?.primary_output || 'release_bundle_manifest.json',
    derived_outputs: contract?.derived_outputs || ['release_bundle'],
    rationale: 'release_bundle_manifest.json is the canonical packaging inventory; the ZIP is a derived transport artifact.',
  };
}

function buildPropagatedConfidence(readinessReport) {
  const readinessConfidence = safeObject(readinessReport.confidence);
  return {
    level: readinessConfidence.level || 'heuristic',
    score: Number.isFinite(readinessConfidence.score) ? readinessConfidence.score : 0.5,
    rationale: readinessConfidence.rationale || 'Confidence propagated from readiness_report.',
    propagated_from: 'readiness_report',
    propagation_notes: [
      'Release packaging preserves readiness_report confidence without changing score or level.',
    ],
  };
}

function buildReleaseNotes({ docsManifestPath, skippedArtifacts }) {
  const notes = [
    'Canonical readiness_report.json remains the source of truth for release packaging.',
  ];
  if (docsManifestPath) {
    notes.push('Standard-document drafts were included from the supplied or discovered docs manifest.');
  }
  if (skippedArtifacts.length > 0) {
    notes.push('Some optional source artifacts were unavailable and were omitted from the portable bundle.');
  }
  return notes;
}

export async function runReleaseBundleWorkflow({
  projectRoot,
  readinessPath,
  readinessReport,
  outputPath,
  docsManifestPath = null,
  docsManifest = null,
  additionalWarnings = [],
  allowBundledDocsManifestPair = false,
  trustedSourceRoots = [],
  generatedAt = null,
  requireAuthoritativeLineage = false,
  publicationHooks = {},
} = {}) {
  const resolvedReadinessPath = resolve(readinessPath);
  const resolvedOutputPath = resolve(outputPath);
  const outputDir = dirname(resolvedOutputPath);
  const readinessDir = dirname(resolvedReadinessPath);
  const manifestPath = join(outputDir, 'release_bundle_manifest.json');
  const logPath = join(outputDir, 'release_bundle_log.json');
  const checksumsPath = join(outputDir, 'release_bundle_checksums.sha256');
  const usedBundlePaths = new Set();
  const resolvedGeneratedAt = nowIso(generatedAt);
  const zipEntryDate = new Date(resolvedGeneratedAt);
  const bundleEntries = [];
  const skippedArtifacts = [];
  const warnings = [...safeList(readinessReport.warnings), ...additionalWarnings];
  const trustedSourceRootPaths = uniqueStrings(
    safeList(trustedSourceRoots)
      .filter((root) => typeof root === 'string' && root.trim())
      .map((root) => resolve(root))
  );
  const proofPortableRoots = [
    readinessDir,
    ...(docsManifestPath ? [dirname(resolve(docsManifestPath))] : []),
    outputDir,
    ...trustedSourceRootPaths,
  ];
  const serializedSourcePath = (filePath) => requireAuthoritativeLineage
    ? proofPortablePath(projectRoot, filePath, proofPortableRoots)
    : portablePath(projectRoot, filePath, proofPortableRoots);
  if (!requireAuthoritativeLineage) await mkdir(outputDir, { recursive: true });
  const proofLineage = requireAuthoritativeLineage
    ? assertRevisionLineage(readinessReport.revision_lineage)
    : null;
  let proofDocsLineage = null;
  const lineageSourceArtifactRefs = proofLineage
    ? proofLineage.parents.map((parent) => ({
        artifact_type: parent.artifact_type,
        path: parent.path,
        role: parent.role,
        label: `Proof lineage parent: ${parent.role}`,
        sha256: parent.sha256,
        ...(Number.isInteger(parent.size_bytes) ? { size_bytes: parent.size_bytes } : {}),
      }))
    : [];
  const readinessSourceArtifactRefs = mergeSourceArtifactRefs(
    safeList(readinessReport.source_artifact_refs),
    lineageSourceArtifactRefs
  );
  const bundledReadinessSourceArtifactRefs = filterAllowedSourceArtifactRefs(
    readinessSourceArtifactRefs,
    {
      projectRoot,
      readinessDir,
      trustedSourceRoots: trustedSourceRootPaths,
      proofLineageParents: proofLineage?.parents || [],
      warnings,
      skippedArtifacts,
    }
  );
  const manifestReadinessSourceArtifactRefs = mergeSourceArtifactRefs(
    bundledReadinessSourceArtifactRefs,
    readinessSourceArtifactRefs.filter(isCanonicalLineageRef)
  );
  const sourceArtifactRefs = mergeSourceArtifactRefs(
    manifestReadinessSourceArtifactRefs,
    [
      buildSourceArtifactRef(
        'readiness_report',
        requireAuthoritativeLineage
          ? proofPortablePath(projectRoot, resolvedReadinessPath, [readinessDir])
          : repoRelativePath(projectRoot, resolvedReadinessPath),
        'input',
        'Canonical readiness report JSON'
      ),
      ...(docsManifestPath && docsManifest
          ? [buildSourceArtifactRef(
            'docs_manifest',
            requireAuthoritativeLineage
              ? proofPortablePath(projectRoot, resolve(docsManifestPath), [readinessDir])
              : repoRelativePath(projectRoot, docsManifestPath),
            'input',
            'Standard docs manifest JSON'
          )]
        : []),
    ]
  );

  if (docsManifestPath && docsManifest) {
    assertRepoScopedDocsManifest(projectRoot, docsManifestPath);
    validateDocsManifestAgainstReadiness({
      readinessReport,
      readinessPath: resolvedReadinessPath,
      docsManifest,
      docsManifestPath: resolve(docsManifestPath),
      allowBundledPair: allowBundledDocsManifestPair,
      projectRoot,
      portablePathRoot: readinessDir,
    });
  }

  const readinessEntry = await buildMetadataEntry({
    artifactType: 'readiness_report',
    role: 'primary',
    label: 'Canonical readiness report JSON',
    bundlePath: makeUniqueBundlePath('canonical/readiness_report.json', usedBundlePaths),
    sourcePath: resolvedReadinessPath,
    requireAuthoritativeLineage,
    proofAllowedRoots: [readinessDir],
  });
  if (requireAuthoritativeLineage) {
    const snapshottedReadiness = parseCanonicalProofJson(
      readinessEntry._proof_bytes,
      'Proof readiness snapshot'
    );
    assertValidCArtifact('readiness_report', snapshottedReadiness, {
      command: 'pack',
      path: resolvedReadinessPath,
    });
    if (!isDeepStrictEqual(snapshottedReadiness, readinessReport)) {
      throw new Error('Proof readiness object does not match the exact readiness snapshot bytes');
    }
    if (!snapshottedReadiness.revision_lineage) {
      throw new Error('Proof release bundle requires readiness revision_lineage');
    }
    assertRevisionLineageIdentityAgreement([proofLineage, snapshottedReadiness.revision_lineage]);
  }
  bundleEntries.push(readinessEntry);

  const readinessMarkdownPath = resolvedReadinessPath.replace(/\.json$/i, '.md');
  if (existsSync(readinessMarkdownPath)) {
    bundleEntries.push(await buildMetadataEntry({
      artifactType: 'readiness_markdown',
      role: 'derived',
      label: 'Readiness report Markdown',
      bundlePath: makeUniqueBundlePath('canonical/readiness_report.md', usedBundlePaths),
      sourcePath: readinessMarkdownPath,
      requireAuthoritativeLineage,
      proofAllowedRoots: [readinessDir],
    }));
  } else {
    warnings.push('Readiness markdown was not found next to the supplied readiness_report.json and was omitted.');
  }

  const includedSourceTypes = new Set(['review_pack', 'config', 'engineering_context', 'cad_model', 'source_file']);
  const seenSourcePaths = new Set([resolvedReadinessPath, readinessMarkdownPath]);
  const sortedRefs = [...bundledReadinessSourceArtifactRefs].sort((left, right) => {
    const leftKey = `${left?.artifact_type || ''}|${left?.path || ''}|${left?.label || ''}`;
    const rightKey = `${right?.artifact_type || ''}|${right?.path || ''}|${right?.label || ''}`;
    return leftKey.localeCompare(rightKey);
  });

  for (const ref of sortedRefs) {
    if (!includedSourceTypes.has(ref?.artifact_type)) continue;
    if (!ref.path) continue;

    const resolvedSource = resolveArtifactPath(ref.path, {
      projectRoot,
      readinessDir,
      allowedRoots: [projectRoot, readinessDir, ...trustedSourceRootPaths],
      proofMode: requireAuthoritativeLineage,
    });
    if (!resolvedSource.ok) {
      skippedArtifacts.push({
        artifact_type: ref.artifact_type,
        role: ref.role || 'input',
        source_path: safeDisplayPath(ref.path),
        label: ref.label || null,
        reason: resolvedSource.reason,
      });
      warnings.push(`Optional source artifact path is outside allowed bundle roots and was omitted: ${safeDisplayPath(ref.path)}`);
      continue;
    }
    const resolvedSourcePath = resolvedSource.path;
    if (!existsSync(resolvedSourcePath)) {
      skippedArtifacts.push({
        artifact_type: ref.artifact_type,
        role: ref.role || 'input',
        source_path: serializedSourcePath(resolvedSourcePath),
        label: ref.label || null,
        reason: 'missing',
      });
      warnings.push(`Optional source artifact was not found and was omitted: ${serializedSourcePath(resolvedSourcePath)}`);
      continue;
    }

    if (seenSourcePaths.has(resolvedSourcePath)) continue;
    seenSourcePaths.add(resolvedSourcePath);

    bundleEntries.push(await buildMetadataEntry({
      artifactType: ref.artifact_type,
      role: ref.role || 'input',
      label: ref.label || null,
      bundlePath: makeUniqueBundlePath(defaultBundlePathForSourceRef(ref), usedBundlePaths),
      sourcePath: resolvedSourcePath,
      expectedSha256: ref.sha256 || null,
      requireAuthoritativeLineage,
      proofAllowedRoots: [projectRoot, readinessDir, ...trustedSourceRootPaths],
    }));
  }

  if (docsManifestPath && docsManifest) {
    const resolvedDocsManifestPath = resolve(docsManifestPath);
    const docsManifestEntry = await buildMetadataEntry({
      artifactType: 'docs_manifest',
      role: 'input',
      label: 'Standard docs manifest JSON',
      bundlePath: makeUniqueBundlePath('docs/standard_docs_manifest.json', usedBundlePaths),
      sourcePath: resolvedDocsManifestPath,
      requireAuthoritativeLineage,
      proofAllowedRoots: [projectRoot],
    });
    if (requireAuthoritativeLineage) {
      const snapshottedDocsManifest = parseCanonicalProofJson(
        docsManifestEntry._proof_bytes,
        'Proof docs-manifest snapshot'
      );
      assertValidCArtifact('docs_manifest', snapshottedDocsManifest, {
        command: 'pack',
        path: resolvedDocsManifestPath,
      });
      if (!isDeepStrictEqual(snapshottedDocsManifest, docsManifest)) {
        throw new Error('Proof docs-manifest object does not match the exact snapshot bytes');
      }
      if (!snapshottedDocsManifest.revision_lineage) {
        throw new Error('Proof release bundle requires docs-manifest revision_lineage');
      }
      proofDocsLineage = assertRevisionLineage(snapshottedDocsManifest.revision_lineage);
      assertRevisionLineageIdentityAgreement([proofLineage, proofDocsLineage]);

      for (const readinessParent of proofLineage.parents) {
        const docsParent = exactLineageParent(
          proofDocsLineage,
          readinessParent.role,
          readinessParent.artifact_type,
          'Proof docs manifest'
        );
        assertExactLineageParent(
          docsParent,
          readinessParent,
          `Proof docs-manifest ${readinessParent.role} parent`
        );
      }
      const readinessParent = exactLineageParent(
        proofDocsLineage,
        'readiness_report',
        'readiness_report',
        'Proof docs manifest'
      );
      if (
        readinessParent.sha256 !== readinessEntry.sha256
        || readinessParent.size_bytes !== readinessEntry.size_bytes
      ) {
        throw new Error('Proof docs-manifest readiness parent does not match the snapshotted readiness bundle entry.');
      }
      const resolvedReadinessParent = resolveArtifactPath(readinessParent.path, {
        projectRoot,
        readinessDir,
        allowedRoots: [projectRoot, readinessDir, ...trustedSourceRootPaths],
        proofMode: true,
      });
      if (
        !allowBundledDocsManifestPair
        && (!resolvedReadinessParent.ok
          || resolve(resolvedReadinessParent.path) !== resolve(readinessEntry.source_path))
      ) {
        throw new Error('Proof docs-manifest readiness parent path does not match the snapshotted readiness bundle entry.');
      }
      if (proofDocsLineage.parents.length !== proofLineage.parents.length + 1) {
        throw new Error('Proof docs-manifest lineage must preserve the exact readiness chain plus its readiness parent.');
      }
    }
    bundleEntries.push(docsManifestEntry);
    seenSourcePaths.add(resolvedDocsManifestPath);

    const sortedDocuments = [...safeList(docsManifest.documents)].sort((left, right) => {
      const leftKey = `${left?.path || ''}|${left?.filename || ''}|${left?.label || ''}`;
      const rightKey = `${right?.path || ''}|${right?.filename || ''}|${right?.label || ''}`;
      return compareStrings(leftKey, rightKey);
    });
    for (const document of sortedDocuments) {
      const resolvedDocument = resolveArtifactPath(document.path, {
        projectRoot,
        readinessDir: dirname(resolvedDocsManifestPath),
        allowedRoots: [dirname(resolvedDocsManifestPath)],
        proofMode: requireAuthoritativeLineage,
      });
      if (!resolvedDocument.ok) {
        skippedArtifacts.push({
          artifact_type: 'docs_document',
          role: 'derived',
          source_path: safeDisplayPath(document.path),
          label: document.label || document.filename || null,
          reason: resolvedDocument.reason,
        });
        warnings.push(`Document listed in docs manifest is outside allowed bundle roots and was omitted: ${safeDisplayPath(document.path)}`);
        continue;
      }
      const resolvedDocumentPath = resolvedDocument.path;
      if (!existsSync(resolvedDocumentPath)) {
        skippedArtifacts.push({
          artifact_type: 'docs_document',
          role: 'derived',
          source_path: serializedSourcePath(resolvedDocumentPath),
          label: document.label || document.filename || null,
          reason: 'missing',
        });
        warnings.push(`Document listed in docs manifest was not found and was omitted: ${serializedSourcePath(resolvedDocumentPath)}`);
        continue;
      }

      if (seenSourcePaths.has(resolvedDocumentPath)) continue;
      seenSourcePaths.add(resolvedDocumentPath);
      const documentFilename = safeDocumentFilename(document.filename, resolvedDocumentPath);
      bundleEntries.push(await buildMetadataEntry({
        artifactType: 'docs_document',
        role: 'derived',
        label: document.label || documentFilename,
        bundlePath: makeUniqueBundlePath(`docs/${documentFilename}`, usedBundlePaths),
        sourcePath: resolvedDocumentPath,
        expectedSha256: document.sha256 || null,
        requireAuthoritativeLineage,
        proofAllowedRoots: [dirname(resolvedDocsManifestPath)],
      }));
    }
  }

  if (proofLineage) {
    for (const parent of proofLineage.parents) {
      const resolvedParent = resolveArtifactPath(parent.path, {
        projectRoot,
        readinessDir,
        allowedRoots: [projectRoot, readinessDir, ...trustedSourceRootPaths],
        proofMode: true,
      });
      const entry = resolvedParent.ok
        ? bundleEntries.find((candidate) => (
            candidate.artifact_type === parent.artifact_type
            && resolve(candidate.source_path) === resolve(resolvedParent.path)
          ))
        : null;
      if (!entry) throw new Error(`Proof release bundle is missing lineage parent: ${parent.role}`);
      if (entry.sha256 !== parent.sha256
        || (Number.isInteger(parent.size_bytes) && entry.size_bytes !== parent.size_bytes)) {
        throw new Error(`Proof release bundle lineage parent digest mismatch: ${parent.role}`);
      }
    }
    if (proofDocsLineage) {
      const docsConfigParent = exactLineageParent(
        proofDocsLineage,
        'authoritative_config',
        'config',
        'Proof docs manifest'
      );
      const resolvedDocsConfig = resolveArtifactPath(docsConfigParent.path, {
        projectRoot,
        readinessDir,
        allowedRoots: [projectRoot, readinessDir, ...trustedSourceRootPaths],
        proofMode: true,
      });
      const configEntry = resolvedDocsConfig.ok
        ? bundleEntries.find((entry) => (
            entry.artifact_type === 'config'
            && resolve(entry.source_path) === resolve(resolvedDocsConfig.path)
          ))
        : null;
      if (!configEntry
        || configEntry.sha256 !== docsConfigParent.sha256
        || configEntry.size_bytes !== docsConfigParent.size_bytes) {
        throw new Error('Proof docs-manifest authoritative config parent does not match the snapshotted config bundle entry.');
      }
    }
  }

  const bundleLogPayload = {
    generated_at: resolvedGeneratedAt,
    readiness_report_path: serializedSourcePath(resolvedReadinessPath),
    docs_manifest_path: docsManifestPath ? serializedSourcePath(resolve(docsManifestPath)) : null,
    bundle_output_path: outputPortablePath(outputDir, resolvedOutputPath),
    included_artifacts: bundleEntries.map((entry) => ({
      artifact_type: entry.artifact_type,
      role: entry.role,
      label: entry.label,
      path: entry.path,
      source_path: serializedSourcePath(entry.source_path),
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
    })),
    skipped_artifacts: skippedArtifacts,
    warnings: uniqueStrings(warnings),
  };
  const logContent = renderBundleLog(bundleLogPayload);
  let logEntry;
  if (requireAuthoritativeLineage) {
    logEntry = {
      path: logPath,
      exists: true,
      size_bytes: Buffer.byteLength(logContent),
      sha256: sha256(Buffer.from(logContent)),
    };
  } else {
    await writeBundleLog(logPath, bundleLogPayload);
    [logEntry] = await collectArtifactMetadata([{
      type: 'release_bundle_log',
      path: logPath,
      label: 'Release bundle log JSON',
      scope: 'internal',
      stability: 'stable',
    }]);
  }

  const checksummedEntries = [
    ...bundleEntries,
    {
      artifact_type: 'release_bundle_log',
      role: 'supporting',
      label: 'Release bundle log JSON',
      path: 'release_bundle_log.json',
      source_path: logEntry.path,
      size_bytes: logEntry.size_bytes,
      sha256: logEntry.sha256,
      exists: logEntry.exists,
    },
  ];
  const checksumsContent = renderChecksums(checksummedEntries);
  let checksumsMetadata;
  if (requireAuthoritativeLineage) {
    checksumsMetadata = {
      path: checksumsPath,
      exists: true,
      size_bytes: Buffer.byteLength(checksumsContent),
      sha256: sha256(Buffer.from(checksumsContent)),
    };
  } else {
    await writeChecksumsFile(checksumsPath, checksummedEntries);
    [checksumsMetadata] = await collectArtifactMetadata([{
      type: 'release_bundle_checksums',
      path: checksumsPath,
      label: 'Release bundle checksums',
      scope: 'internal',
      stability: 'stable',
    }]);
  }

  const manifest = {
    schema_version: C_ARTIFACT_SCHEMA_VERSION,
    artifact_type: 'release_bundle_manifest',
    workflow: 'readiness_release_bundle',
    generated_at: resolvedGeneratedAt,
    ...(requireAuthoritativeLineage ? {
      effective_policy: { proof_lineage: true },
      revision_lineage: readinessReport.revision_lineage,
    } : {}),
    warnings: uniqueStrings(warnings),
    coverage: {
      ...safeObject(readinessReport.coverage),
      bundled_artifact_count: bundleEntries.length + 3,
      source_artifact_count: sourceArtifactRefs.length,
      included_source_artifact_count: bundleEntries.filter((entry) => entry.role !== 'derived').length,
      skipped_optional_artifact_count: skippedArtifacts.length,
      docs_included: Boolean(docsManifestPath && docsManifest),
      document_count: safeList(docsManifest?.documents).length,
    },
    confidence: buildPropagatedConfidence(readinessReport),
    source_artifact_refs: manifestSourceArtifactRefs(sourceArtifactRefs, {
      projectRoot,
      readinessDir,
      outputDir,
      trustedSourceRoots: trustedSourceRootPaths,
      proofMode: requireAuthoritativeLineage,
    }),
    canonical_artifact: buildCanonicalArtifactDescriptor(),
    contract: getCCommandContract('pack'),
    readiness_report_ref: {
      ...buildSourceArtifactRef(
        'readiness_report',
        serializedSourcePath(resolvedReadinessPath),
        'input',
        'Canonical readiness report JSON'
      ),
      ...(requireAuthoritativeLineage ? {
        sha256: readinessEntry.sha256,
        size_bytes: readinessEntry.size_bytes,
      } : {}),
    },
    ...(docsManifestPath && docsManifest
      ? {
          docs_manifest_ref: {
            ...buildSourceArtifactRef(
              'docs_manifest',
              serializedSourcePath(resolve(docsManifestPath)),
              'input',
              'Standard docs manifest JSON'
            ),
            ...(requireAuthoritativeLineage ? (() => {
              const entry = bundleEntries.find((item) => item.artifact_type === 'docs_manifest');
              return entry ? { sha256: entry.sha256, size_bytes: entry.size_bytes } : {};
            })() : {}),
          },
        }
      : {}),
    bundle_artifacts: [
      ...bundleEntries.map((entry) => ({
        artifact_type: entry.artifact_type,
        role: entry.role,
        label: entry.label,
        path: entry.path,
        source_path: serializedSourcePath(entry.source_path),
        size_bytes: entry.size_bytes,
        sha256: entry.sha256,
      })),
      {
        artifact_type: 'release_bundle_log',
        role: 'supporting',
        label: 'Release bundle log JSON',
        path: 'release_bundle_log.json',
          source_path: outputPortablePath(outputDir, logEntry.path),
        size_bytes: logEntry.size_bytes,
        sha256: logEntry.sha256,
      },
      {
        artifact_type: 'release_bundle_checksums',
        role: 'supporting',
        label: 'Release bundle checksums',
        path: 'release_bundle_checksums.sha256',
          source_path: outputPortablePath(outputDir, checksumsMetadata.path),
        size_bytes: checksumsMetadata.size_bytes,
        sha256: checksumsMetadata.sha256,
      },
      {
        artifact_type: 'release_bundle_manifest',
        role: 'primary',
        label: 'Release bundle manifest JSON',
        path: 'release_bundle_manifest.json',
        source_path: outputPortablePath(outputDir, manifestPath),
      },
    ],
    skipped_artifacts: skippedArtifacts,
    release_notes: buildReleaseNotes({
      docsManifestPath,
      skippedArtifacts,
    }),
    bundle_file: {
      path: outputPortablePath(outputDir, resolvedOutputPath),
      filename: basename(resolvedOutputPath),
    },
  };

  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  if (requireAuthoritativeLineage) {
    assertValidCArtifact('release_bundle_manifest', manifest, { command: 'pack', path: manifestPath });
    const zipEntries = [
      ...bundleEntries.map((entry) => ({
        name: entry.path,
        data: entry._proof_bytes,
        date: zipEntryDate,
      })),
      { name: 'release_bundle_log.json', data: Buffer.from(logContent), date: zipEntryDate },
      { name: 'release_bundle_checksums.sha256', data: Buffer.from(checksumsContent), date: zipEntryDate },
      { name: 'release_bundle_manifest.json', data: Buffer.from(manifestContent), date: zipEntryDate },
    ];
    const zipBytes = buildZipArchive(zipEntries);
    for (const entry of bundleEntries) await assertProofSourceStillBound(entry);
    await mkdir(outputDir, { recursive: true });
    await publishAtomicOutputSet({
      directory: outputDir,
      outputs: [
        { path: logPath, content: logContent },
        { path: checksumsPath, content: checksumsContent },
        { path: manifestPath, content: manifestContent },
        { path: resolvedOutputPath, content: zipBytes },
      ],
      hooks: publicationHooks,
    });
  } else {
    await writeValidatedCArtifact(manifestPath, 'release_bundle_manifest', manifest, {
      command: 'pack',
    });
    const zipEntries = [];
    for (const entry of bundleEntries) {
      zipEntries.push({
        name: entry.path,
        data: await readFile(entry.source_path),
        date: zipEntryDate,
      });
    }
    zipEntries.push(
      { name: 'release_bundle_log.json', data: await readFile(logPath), date: zipEntryDate },
      { name: 'release_bundle_checksums.sha256', data: await readFile(checksumsPath), date: zipEntryDate },
      { name: 'release_bundle_manifest.json', data: await readFile(manifestPath), date: zipEntryDate },
    );
    await createZipArchive(resolvedOutputPath, zipEntries);
  }

  return {
    bundle_zip_path: resolvedOutputPath,
    manifest_path: manifestPath,
    log_path: logPath,
    checksums_path: checksumsPath,
    manifest,
    bundle_artifacts: manifest.bundle_artifacts,
  };
}

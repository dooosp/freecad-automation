import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises';

import { AfExecutionContractError } from '../../../lib/af-execution-contract.js';
import { assertValidCArtifact } from '../../../lib/c-artifact-schema.js';
import { parseInspectionEvidenceJsonBytes } from '../../../lib/inspection-evidence-onboarding.js';
import { assertRevisionLineage } from '../../../lib/revision-lineage-contract.js';
import { listZipEntries, readZipEntry } from '../../../lib/zip-archive.js';

const CANONICAL_BUNDLE_ENTRY_BY_TARGET = Object.freeze({
  review_pack: 'canonical/review_pack.json',
  readiness_report: 'canonical/readiness_report.json',
  docs_manifest: 'docs/standard_docs_manifest.json',
});
const BUNDLE_MANIFEST_ENTRY = 'release_bundle_manifest.json';
const BUNDLE_CHECKSUMS_ENTRY = 'release_bundle_checksums.sha256';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_PROOF_BUNDLE_BYTES = 512 * 1024 * 1024;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactDetail(code, message) {
  return { code, message };
}

function normalizeEntryName(value) {
  return normalizeString(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
    && left.nlink === right.nlink;
}

function pathIsWithin(rootPath, targetPath) {
  const rel = relative(resolve(rootPath), resolve(targetPath)).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel));
}

function assertProofEntryName(value, bundlePath) {
  const raw = normalizeString(value);
  const normalized = normalizeEntryName(value);
  const segments = raw.split('/');
  if (
    !raw
    || raw !== normalized
    || raw.includes('\\')
    || raw.includes('\0')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw buildBundleImportError(
      'bundle_proof_unsafe_entry',
      `Release bundle ${bundlePath} contains an unsafe proof entry name.`,
      { path: bundlePath, details: [compactDetail('unsafe_bundle_entry', raw || '(empty)')] }
    );
  }
  return normalized;
}

async function readProofBundleSnapshot(bundlePath, {
  jobStore = null,
  sourceArtifactBinding = null,
} = {}) {
  const absoluteBundlePath = resolve(bundlePath);
  let expectedAllowedRoot = dirname(absoluteBundlePath);
  if (sourceArtifactBinding) {
    if (resolve(sourceArtifactBinding.path || '') !== absoluteBundlePath) {
      throw buildBundleImportError(
        'bundle_proof_binding_mismatch',
        'Release bundle path does not match its registered proof binding.',
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    if (typeof jobStore?.verifyArtifactBinding !== 'function') {
      throw buildBundleImportError(
        'bundle_proof_binding_unverifiable',
        'Release bundle proof binding cannot be revalidated on this execution path.',
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    await jobStore.verifyArtifactBinding(
      sourceArtifactBinding.job_id,
      sourceArtifactBinding.artifact_id,
      { expectedBinding: sourceArtifactBinding }
    );
    expectedAllowedRoot = typeof jobStore.getJobDir === 'function'
      ? jobStore.getJobDir(sourceArtifactBinding.job_id)
      : dirname(resolve(sourceArtifactBinding.path));
  }

  let before;
  let canonicalPath;
  let canonicalAllowedRoot;
  try {
    [before, canonicalPath, canonicalAllowedRoot] = await Promise.all([
      lstat(absoluteBundlePath, { bigint: true }),
      realpath(absoluteBundlePath),
      realpath(expectedAllowedRoot),
    ]);
  } catch {
    throw buildBundleImportError(
      'bundle_proof_path_unavailable',
      `Release bundle ${bundlePath} is unavailable for proof re-entry.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  if (
    canonicalPath !== absoluteBundlePath
    || !pathIsWithin(canonicalAllowedRoot, canonicalPath)
    || !before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== 1n
  ) {
    throw buildBundleImportError(
      'bundle_proof_path_unsafe',
      `Release bundle ${bundlePath} failed regular-file, link, or canonical-path proof checks.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  if (before.size > BigInt(MAX_PROOF_BUNDLE_BYTES)) {
    throw buildBundleImportError(
      'bundle_proof_size_out_of_bounds',
      `Release bundle ${bundlePath} exceeds the proof re-entry size limit.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw buildBundleImportError(
      'bundle_proof_nofollow_unavailable',
      'This runtime cannot enforce no-follow reads for release bundle proof re-entry.',
      { path: bundlePath, target: 'release_bundle' }
    );
  }

  let handle;
  try {
    handle = await open(absoluteBundlePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || !sameFileIdentity(before, opened)) {
      throw buildBundleImportError(
        'bundle_proof_file_replaced',
        `Release bundle ${bundlePath} changed before proof bytes could be read.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const [afterPath, afterCanonicalPath, afterCanonicalAllowedRoot] = await Promise.all([
      lstat(absoluteBundlePath, { bigint: true }),
      realpath(absoluteBundlePath),
      realpath(expectedAllowedRoot),
    ]);
    if (
      afterCanonicalPath !== absoluteBundlePath
      || afterCanonicalAllowedRoot !== canonicalAllowedRoot
      || !pathIsWithin(afterCanonicalAllowedRoot, afterCanonicalPath)
      || !afterPath.isFile()
      || afterPath.isSymbolicLink()
    ) {
      throw buildBundleImportError(
        'bundle_proof_path_unsafe',
        `Release bundle ${bundlePath} failed regular-file, link, or canonical-path proof checks.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    if (
      !sameFileIdentity(opened, after)
      || !sameFileIdentity(opened, afterPath)
      || bytes.length !== Number(opened.size)
    ) {
      throw buildBundleImportError(
        'bundle_proof_file_replaced',
        `Release bundle ${bundlePath} changed while proof bytes were being read.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    const snapshot = {
      bytes: Buffer.from(bytes),
      sha256: sha256(bytes),
      size_bytes: bytes.length,
    };
    if (
      sourceArtifactBinding
      && (
        snapshot.sha256 !== sourceArtifactBinding.sha256
        || snapshot.size_bytes !== sourceArtifactBinding.size_bytes
      )
    ) {
      throw buildBundleImportError(
        'bundle_proof_binding_mismatch',
        'Release bundle bytes no longer match their registered proof binding.',
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    return snapshot;
  } catch (error) {
    if (error instanceof AfExecutionContractError) throw error;
    throw buildBundleImportError(
      'bundle_proof_nofollow_read_failed',
      `Release bundle ${bundlePath} could not be read through a no-follow proof handle.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  } finally {
    await handle?.close().catch(() => {});
  }
}

function parseProofChecksums(bytes, bundlePath) {
  const lines = bytes.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) {
      throw buildBundleImportError(
        'bundle_proof_checksum_invalid',
        `Release bundle ${bundlePath} contains a malformed checksum record.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    const entryName = assertProofEntryName(match[2], bundlePath);
    if (checksums.has(entryName)) {
      throw buildBundleImportError(
        'bundle_proof_checksum_duplicate',
        `Release bundle ${bundlePath} contains a duplicate checksum entry for ${entryName}.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    checksums.set(entryName, match[1]);
  }
  return checksums;
}

async function verifyProofBundleSnapshot(bundlePath, snapshot) {
  let zipEntries;
  try {
    zipEntries = await listZipEntries(snapshot.bytes);
  } catch (error) {
    throw buildBundleImportError(
      'bundle_proof_zip_invalid',
      `Release bundle ${bundlePath} is not a valid proof ZIP: ${error instanceof Error ? error.message : String(error)}`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  const entryNames = zipEntries.map((entry) => assertProofEntryName(entry.name, bundlePath));
  if (new Set(entryNames).size !== entryNames.length) {
    throw buildBundleImportError(
      'bundle_proof_duplicate_entry',
      `Release bundle ${bundlePath} contains duplicate ZIP entry names.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  if (!entryNames.includes(BUNDLE_MANIFEST_ENTRY) || !entryNames.includes(BUNDLE_CHECKSUMS_ENTRY)) {
    throw buildBundleImportError(
      'bundle_proof_control_member_missing',
      `Release bundle ${bundlePath} is missing its proof manifest or checksum member.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }

  let manifestEntry;
  let checksumsEntry;
  let manifest;
  try {
    [manifestEntry, checksumsEntry] = await Promise.all([
      readZipEntry(snapshot.bytes, BUNDLE_MANIFEST_ENTRY),
      readZipEntry(snapshot.bytes, BUNDLE_CHECKSUMS_ENTRY),
    ]);
    manifest = parseInspectionEvidenceJsonBytes(manifestEntry.data, { requireCanonical: true });
    assertValidCArtifact('release_bundle_manifest', manifest, {
      command: 'pack',
      path: `${bundlePath}:${BUNDLE_MANIFEST_ENTRY}`,
    });
  } catch (error) {
    throw buildBundleImportError(
      'bundle_proof_manifest_invalid',
      `Release bundle ${bundlePath} contains an invalid proof manifest: ${error instanceof Error ? error.message : String(error)}`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  if (manifest.effective_policy?.proof_lineage !== true) {
    throw buildBundleImportError(
      'bundle_proof_policy_missing',
      `Release bundle ${bundlePath} does not explicitly retain proof lineage policy.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  try {
    assertRevisionLineage(manifest.revision_lineage);
  } catch (error) {
    throw buildBundleImportError(
      'bundle_proof_lineage_invalid',
      `Release bundle ${bundlePath} contains invalid revision lineage: ${error instanceof Error ? error.message : String(error)}`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }

  const inventory = new Map();
  for (const entry of Array.isArray(manifest.bundle_artifacts) ? manifest.bundle_artifacts : []) {
    const entryName = assertProofEntryName(entry?.path, bundlePath);
    if (inventory.has(entryName)) {
      throw buildBundleImportError(
        'bundle_proof_inventory_duplicate',
        `Release bundle ${bundlePath} manifest contains duplicate inventory path ${entryName}.`,
        { path: bundlePath, target: 'release_bundle' }
      );
    }
    inventory.set(entryName, entry);
  }
  if (
    inventory.size !== entryNames.length
    || entryNames.some((entryName) => !inventory.has(entryName))
  ) {
    throw buildBundleImportError(
      'bundle_proof_inventory_mismatch',
      `Release bundle ${bundlePath} ZIP members do not exactly match its manifest inventory.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }

  const checksumInventory = inventory.get(BUNDLE_CHECKSUMS_ENTRY);
  const checksumsDigest = sha256(checksumsEntry.data);
  if (
    !checksumInventory
    || checksumInventory.sha256 !== checksumsDigest
    || checksumInventory.size_bytes !== checksumsEntry.data.length
  ) {
    throw buildBundleImportError(
      'bundle_proof_checksum_binding_mismatch',
      `Release bundle ${bundlePath} checksum member does not match its manifest binding.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }
  const checksums = parseProofChecksums(checksumsEntry.data, bundlePath);
  const checksummedNames = entryNames.filter(
    (entryName) => entryName !== BUNDLE_MANIFEST_ENTRY && entryName !== BUNDLE_CHECKSUMS_ENTRY
  );
  if (
    checksums.size !== checksummedNames.length
    || checksummedNames.some((entryName) => !checksums.has(entryName))
  ) {
    throw buildBundleImportError(
      'bundle_proof_checksum_inventory_mismatch',
      `Release bundle ${bundlePath} checksum inventory does not match its manifest members.`,
      { path: bundlePath, target: 'release_bundle' }
    );
  }

  const verifiedEntries = new Map([
    [BUNDLE_MANIFEST_ENTRY, Buffer.from(manifestEntry.data)],
    [BUNDLE_CHECKSUMS_ENTRY, Buffer.from(checksumsEntry.data)],
  ]);
  for (const entryName of checksummedNames) {
    let zipEntry;
    try {
      zipEntry = await readZipEntry(snapshot.bytes, entryName);
    } catch (error) {
      throw buildBundleImportError(
        'bundle_proof_member_invalid',
        `Release bundle member ${entryName} failed ZIP validation: ${error instanceof Error ? error.message : String(error)}`,
        { path: bundlePath, target: entryName }
      );
    }
    const inventoryEntry = inventory.get(entryName);
    const memberDigest = sha256(zipEntry.data);
    if (
      !SHA256_PATTERN.test(inventoryEntry?.sha256 || '')
      || !Number.isSafeInteger(inventoryEntry?.size_bytes)
      || inventoryEntry.size_bytes !== zipEntry.data.length
      || inventoryEntry.sha256 !== memberDigest
      || checksums.get(entryName) !== memberDigest
    ) {
      throw buildBundleImportError(
        'bundle_proof_member_digest_mismatch',
        `Release bundle member ${entryName} does not match its manifest and checksum bindings.`,
        { path: bundlePath, target: entryName }
      );
    }
    verifiedEntries.set(entryName, Buffer.from(zipEntry.data));
  }

  return {
    snapshot_sha256: snapshot.sha256,
    snapshot_size_bytes: snapshot.size_bytes,
    manifest,
    verifiedEntries,
  };
}

function isBundlePath(filePath = '') {
  return typeof filePath === 'string' && extname(filePath).toLowerCase() === '.zip';
}

function configEntryPriority(entryName) {
  const normalized = normalizeEntryName(entryName).toLowerCase();
  if (/^inputs\/effective-config\.json$/.test(normalized)) return 0;
  if (/^inputs\/effective-config\.toml$/.test(normalized)) return 1;
  if (/^inputs\/input-config\.json$/.test(normalized)) return 2;
  if (/^inputs\/input-config\.toml$/.test(normalized)) return 3;
  if (/^inputs\/.+\.toml$/.test(normalized)) return 4;
  if (/^inputs\/.+\.json$/.test(normalized)) return 5;
  if (/^configs?\/.+\.toml$/.test(normalized)) return 6;
  if (/^configs?\/.+\.json$/.test(normalized)) return 7;
  return 20;
}

function isBundleConfigCandidate(entryName) {
  return configEntryPriority(entryName) < 20;
}

function buildBundleImportError(code, message, {
  path = null,
  target = null,
  details = [],
} = {}) {
  return new AfExecutionContractError(code, message, {
    status: 422,
    path,
    target,
    details,
  });
}

function pickConfigEntry(configEntries = [], bundlePath) {
  if (configEntries.length === 0) {
    throw buildBundleImportError(
      'bundle_config_missing',
      `No config-like input was found in release bundle ${bundlePath}.`,
      {
        path: bundlePath,
        target: 'config',
        details: [
          compactDetail(
            'missing_bundle_config',
            'Release bundle re-entry for generate-standard-docs requires a bundled config-like input under inputs/ or config/.'
          ),
        ],
      }
    );
  }

  const scored = [...configEntries]
    .map((entryName) => ({ entryName, priority: configEntryPriority(entryName) }))
    .sort((left, right) => left.priority - right.priority || left.entryName.localeCompare(right.entryName));
  const best = scored[0];
  const equallyPreferred = scored.filter((entry) => entry.priority === best.priority);

  if (equallyPreferred.length > 1) {
    throw buildBundleImportError(
      'bundle_config_ambiguous',
      `Multiple equally preferred config-like inputs were found in release bundle ${bundlePath}.`,
      {
        path: bundlePath,
        target: 'config',
        details: equallyPreferred.map((entry) => compactDetail(
          'ambiguous_bundle_config',
          `Competing bundled config input: ${entry.entryName}`
        )),
      }
    );
  }

  return best.entryName;
}

export async function inspectCanonicalBundle(bundlePath, {
  proofLineage = false,
  jobStore = null,
  sourceArtifactBinding = null,
} = {}) {
  const snapshot = proofLineage === true
    ? await readProofBundleSnapshot(bundlePath, { jobStore, sourceArtifactBinding })
    : null;
  const proof = snapshot
    ? await verifyProofBundleSnapshot(bundlePath, snapshot)
    : null;
  const entries = await listZipEntries(snapshot?.bytes || bundlePath);
  const entryNames = entries.map((entry) => normalizeEntryName(entry.name));
  const configEntries = entryNames.filter((entryName) => isBundleConfigCandidate(entryName));
  return {
    bundlePath,
    entryNames,
    canonical: {
      review_pack: entryNames.includes(CANONICAL_BUNDLE_ENTRY_BY_TARGET.review_pack)
        ? CANONICAL_BUNDLE_ENTRY_BY_TARGET.review_pack
        : null,
      readiness_report: entryNames.includes(CANONICAL_BUNDLE_ENTRY_BY_TARGET.readiness_report)
        ? CANONICAL_BUNDLE_ENTRY_BY_TARGET.readiness_report
        : null,
      docs_manifest: entryNames.includes(CANONICAL_BUNDLE_ENTRY_BY_TARGET.docs_manifest)
        ? CANONICAL_BUNDLE_ENTRY_BY_TARGET.docs_manifest
        : null,
    },
    configEntries,
    ...(proof ? { proof } : {}),
  };
}

async function extractBundleEntry(bundlePath, entryName, destinationPath, { verifiedData = null } = {}) {
  const entryData = verifiedData
    ? Buffer.from(verifiedData)
    : (await readZipEntry(bundlePath, entryName)).data;
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, entryData);
  return destinationPath;
}

function buildImportDirectory(jobStore, jobId) {
  return join(jobStore.getJobDir(jobId), 'imports');
}

export async function resolveBundleBackedCanonicalPath({
  jobStore,
  jobId,
  inputPath,
  target,
  outputFileName = null,
  proofLineage = false,
  sourceArtifactBinding = null,
}) {
  if (!isBundlePath(inputPath)) {
    return {
      path: inputPath,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(inputPath, {
    proofLineage,
    jobStore,
    sourceArtifactBinding,
  });
  const entryName = bundle.canonical[target];
  if (!entryName) {
    throw buildBundleImportError(
      'bundle_canonical_artifact_missing',
      `Release bundle ${inputPath} does not contain the canonical ${target} entry required for this AF2 flow.`,
      {
        path: inputPath,
        target,
        details: [
          compactDetail(
            'missing_bundle_entry',
            `Expected ${CANONICAL_BUNDLE_ENTRY_BY_TARGET[target]} inside the supplied release bundle.`
          ),
        ],
      }
    );
  }

  const outputPath = join(
    buildImportDirectory(jobStore, jobId),
    outputFileName || basename(entryName)
  );
  await extractBundleEntry(inputPath, entryName, outputPath, {
    verifiedData: bundle.proof?.verifiedEntries.get(entryName) || null,
  });
  return {
    path: outputPath,
    importRecord: {
      kind: target,
      bundle_path: inputPath,
      entry_name: entryName,
      extracted_path: outputPath,
      ...(bundle.proof ? {
        proof_verified: true,
        bundle_sha256: bundle.proof.snapshot_sha256,
        member_sha256: sha256(bundle.proof.verifiedEntries.get(entryName)),
      } : {}),
    },
  };
}

export async function resolveBundleBackedConfigPath({
  jobStore,
  jobId,
  inputPath,
  outputFileName = null,
  proofLineage = false,
  sourceArtifactBinding = null,
}) {
  if (!isBundlePath(inputPath)) {
    return {
      path: inputPath,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(inputPath, {
    proofLineage,
    jobStore,
    sourceArtifactBinding,
  });
  const entryName = pickConfigEntry(bundle.configEntries, inputPath);
  const outputPath = join(
    buildImportDirectory(jobStore, jobId),
    outputFileName || basename(entryName)
  );
  await extractBundleEntry(inputPath, entryName, outputPath, {
    verifiedData: bundle.proof?.verifiedEntries.get(entryName) || null,
  });
  return {
    path: outputPath,
    importRecord: {
      kind: 'config',
      bundle_path: inputPath,
      entry_name: entryName,
      extracted_path: outputPath,
      ...(bundle.proof ? {
        proof_verified: true,
        bundle_sha256: bundle.proof.snapshot_sha256,
        member_sha256: sha256(bundle.proof.verifiedEntries.get(entryName)),
      } : {}),
    },
  };
}

export async function resolveBundleBackedDocsManifestPath({
  jobStore,
  jobId,
  explicitPath = null,
  fallbackBundlePath = null,
  outputFileName = 'standard_docs_manifest.json',
  proofLineage = false,
  sourceArtifactBinding = null,
}) {
  const candidatePath = explicitPath || fallbackBundlePath;
  if (!candidatePath || !isBundlePath(candidatePath)) {
    return {
      path: explicitPath || null,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(candidatePath, {
    proofLineage,
    jobStore,
    sourceArtifactBinding,
  });
  const entryName = bundle.canonical.docs_manifest;
  if (!entryName) {
    if (explicitPath) {
      throw buildBundleImportError(
        'bundle_docs_manifest_missing',
        `Release bundle ${candidatePath} does not contain docs/standard_docs_manifest.json.`,
        {
          path: candidatePath,
          target: 'docs_manifest',
          details: [
            compactDetail(
              'missing_bundle_docs_manifest',
              'The supplied bundle does not include the canonical standard docs manifest.'
            ),
          ],
        }
      );
    }
    return {
      path: null,
      importRecord: null,
    };
  }

  const outputPath = join(buildImportDirectory(jobStore, jobId), outputFileName);
  await extractBundleEntry(candidatePath, entryName, outputPath, {
    verifiedData: bundle.proof?.verifiedEntries.get(entryName) || null,
  });
  return {
    path: outputPath,
    importRecord: {
      kind: 'docs_manifest',
      bundle_path: candidatePath,
      entry_name: entryName,
      extracted_path: outputPath,
      auto_detected: !explicitPath,
      ...(bundle.proof ? {
        proof_verified: true,
        bundle_sha256: bundle.proof.snapshot_sha256,
        member_sha256: sha256(bundle.proof.verifiedEntries.get(entryName)),
      } : {}),
    },
  };
}

export function summarizeBundleImports(importRecords = []) {
  return importRecords
    .filter((record) => isPlainObject(record))
    .map((record) => ({
      ...record,
      bundle_path: normalizeString(record.bundle_path) || null,
      entry_name: normalizeString(record.entry_name) || null,
      extracted_path: normalizeString(record.extracted_path) || null,
    }));
}

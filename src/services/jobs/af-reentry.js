import { basename, dirname, extname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { AfExecutionContractError } from '../../../lib/af-execution-contract.js';
import { listZipEntries, readZipEntry } from '../../../lib/zip-archive.js';

const CANONICAL_BUNDLE_ENTRY_BY_TARGET = Object.freeze({
  review_pack: 'canonical/review_pack.json',
  readiness_report: 'canonical/readiness_report.json',
  docs_manifest: 'docs/standard_docs_manifest.json',
});

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

export async function inspectCanonicalBundle(bundlePath) {
  const entries = await listZipEntries(bundlePath);
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
  };
}

async function extractBundleEntry(bundlePath, entryName, destinationPath) {
  const entry = await readZipEntry(bundlePath, entryName);
  await mkdir(dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, entry.data);
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
}) {
  if (!isBundlePath(inputPath)) {
    return {
      path: inputPath,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(inputPath);
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
  await extractBundleEntry(inputPath, entryName, outputPath);
  return {
    path: outputPath,
    importRecord: {
      kind: target,
      bundle_path: inputPath,
      entry_name: entryName,
      extracted_path: outputPath,
    },
  };
}

export async function resolveBundleBackedConfigPath({
  jobStore,
  jobId,
  inputPath,
  outputFileName = null,
}) {
  if (!isBundlePath(inputPath)) {
    return {
      path: inputPath,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(inputPath);
  const entryName = pickConfigEntry(bundle.configEntries, inputPath);
  const outputPath = join(
    buildImportDirectory(jobStore, jobId),
    outputFileName || basename(entryName)
  );
  await extractBundleEntry(inputPath, entryName, outputPath);
  return {
    path: outputPath,
    importRecord: {
      kind: 'config',
      bundle_path: inputPath,
      entry_name: entryName,
      extracted_path: outputPath,
    },
  };
}

export async function resolveBundleBackedDocsManifestPath({
  jobStore,
  jobId,
  explicitPath = null,
  fallbackBundlePath = null,
  outputFileName = 'standard_docs_manifest.json',
}) {
  const candidatePath = explicitPath || fallbackBundlePath;
  if (!candidatePath || !isBundlePath(candidatePath)) {
    return {
      path: explicitPath || null,
      importRecord: null,
    };
  }

  const bundle = await inspectCanonicalBundle(candidatePath);
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
  await extractBundleEntry(candidatePath, entryName, outputPath);
  return {
    path: outputPath,
    importRecord: {
      kind: 'docs_manifest',
      bundle_path: candidatePath,
      entry_name: entryName,
      extracted_path: outputPath,
      auto_detected: !explicitPath,
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

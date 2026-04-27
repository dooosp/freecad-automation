import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { validateDocsManifestAgainstReadiness } from '../../lib/af-execution-contract.js';
import { collectArtifactMetadata } from '../../lib/artifact-manifest.js';
import {
  C_ARTIFACT_SCHEMA_VERSION,
  getCCommandContract,
} from '../../lib/c-artifact-schema.js';
import { writeValidatedCArtifact } from '../../lib/context-loader.js';
import { buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';
import { createZipArchive } from '../../lib/zip-archive.js';

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

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
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

function normalizeBundlePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function makeUniqueBundlePath(desiredPath, usedPaths) {
  const normalized = normalizeBundlePath(desiredPath);
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

function resolveArtifactPath(rawPath, { projectRoot, readinessDir }) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  if (existsSync(rawPath)) return resolve(rawPath);

  const candidates = [
    resolve(process.cwd(), rawPath),
    resolve(projectRoot, rawPath),
    resolve(readinessDir, rawPath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return resolve(projectRoot, rawPath);
}

async function buildMetadataEntry({
  artifactType,
  role,
  label,
  bundlePath,
  sourcePath,
}) {
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

async function writeBundleLog(logPath, payload) {
  await writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return logPath;
}

async function writeChecksumsFile(checksumPath, entries = []) {
  const lines = entries
    .filter((entry) => entry.sha256 && entry.path)
    .map((entry) => `${entry.sha256}  ${entry.path}`);
  await writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
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
} = {}) {
  const resolvedReadinessPath = resolve(readinessPath);
  const resolvedOutputPath = resolve(outputPath);
  const outputDir = dirname(resolvedOutputPath);
  const readinessDir = dirname(resolvedReadinessPath);
  const manifestPath = join(outputDir, 'release_bundle_manifest.json');
  const logPath = join(outputDir, 'release_bundle_log.json');
  const checksumsPath = join(outputDir, 'release_bundle_checksums.sha256');
  const usedBundlePaths = new Set();
  const generatedAt = nowIso();
  const bundleEntries = [];
  const skippedArtifacts = [];
  const warnings = [...safeList(readinessReport.warnings), ...additionalWarnings];
  const sourceArtifactRefs = mergeSourceArtifactRefs(
    safeList(readinessReport.source_artifact_refs),
    [
      buildSourceArtifactRef(
        'readiness_report',
        repoRelativePath(projectRoot, resolvedReadinessPath),
        'input',
        'Canonical readiness report JSON'
      ),
      ...(docsManifestPath && docsManifest
        ? [buildSourceArtifactRef(
            'docs_manifest',
            repoRelativePath(projectRoot, docsManifestPath),
            'input',
            'Standard docs manifest JSON'
          )]
        : []),
    ]
  );

  if (docsManifestPath && docsManifest) {
    validateDocsManifestAgainstReadiness({
      readinessReport,
      readinessPath: resolvedReadinessPath,
      docsManifest,
      docsManifestPath: resolve(docsManifestPath),
      allowBundledPair: allowBundledDocsManifestPair,
    });
  }

  bundleEntries.push(await buildMetadataEntry({
    artifactType: 'readiness_report',
    role: 'primary',
    label: 'Canonical readiness report JSON',
    bundlePath: makeUniqueBundlePath('canonical/readiness_report.json', usedBundlePaths),
    sourcePath: resolvedReadinessPath,
  }));

  const readinessMarkdownPath = resolvedReadinessPath.replace(/\.json$/i, '.md');
  if (existsSync(readinessMarkdownPath)) {
    bundleEntries.push(await buildMetadataEntry({
      artifactType: 'readiness_markdown',
      role: 'derived',
      label: 'Readiness report Markdown',
      bundlePath: makeUniqueBundlePath('canonical/readiness_report.md', usedBundlePaths),
      sourcePath: readinessMarkdownPath,
    }));
  } else {
    warnings.push('Readiness markdown was not found next to the supplied readiness_report.json and was omitted.');
  }

  const includedSourceTypes = new Set(['review_pack', 'config', 'engineering_context', 'cad_model', 'source_file']);
  const seenSourcePaths = new Set([resolvedReadinessPath, readinessMarkdownPath]);
  const sortedRefs = [...safeList(readinessReport.source_artifact_refs)].sort((left, right) => {
    const leftKey = `${left?.artifact_type || ''}|${left?.path || ''}|${left?.label || ''}`;
    const rightKey = `${right?.artifact_type || ''}|${right?.path || ''}|${right?.label || ''}`;
    return leftKey.localeCompare(rightKey);
  });

  for (const ref of sortedRefs) {
    if (!includedSourceTypes.has(ref?.artifact_type)) continue;
    if (!ref.path) continue;

    const resolvedSourcePath = resolveArtifactPath(ref.path, { projectRoot, readinessDir });
    if (!existsSync(resolvedSourcePath)) {
      skippedArtifacts.push({
        artifact_type: ref.artifact_type,
        role: ref.role || 'input',
        source_path: repoRelativePath(projectRoot, resolvedSourcePath),
        label: ref.label || null,
        reason: 'missing',
      });
      warnings.push(`Optional source artifact was not found and was omitted: ${ref.path}`);
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
    }));
  }

  if (docsManifestPath && docsManifest) {
    const resolvedDocsManifestPath = resolve(docsManifestPath);
    bundleEntries.push(await buildMetadataEntry({
      artifactType: 'docs_manifest',
      role: 'input',
      label: 'Standard docs manifest JSON',
      bundlePath: makeUniqueBundlePath('docs/standard_docs_manifest.json', usedBundlePaths),
      sourcePath: resolvedDocsManifestPath,
    }));
    seenSourcePaths.add(resolvedDocsManifestPath);

    for (const document of safeList(docsManifest.documents)) {
      const resolvedDocumentPath = resolveArtifactPath(document.path, {
        projectRoot,
        readinessDir: dirname(resolvedDocsManifestPath),
      });
      if (!existsSync(resolvedDocumentPath)) {
        skippedArtifacts.push({
          artifact_type: 'docs_document',
          role: 'derived',
          source_path: repoRelativePath(projectRoot, resolvedDocumentPath),
          label: document.label || document.filename || null,
          reason: 'missing',
        });
        warnings.push(`Document listed in docs manifest was not found and was omitted: ${document.path}`);
        continue;
      }

      if (seenSourcePaths.has(resolvedDocumentPath)) continue;
      seenSourcePaths.add(resolvedDocumentPath);
      bundleEntries.push(await buildMetadataEntry({
        artifactType: 'docs_document',
        role: 'derived',
        label: document.label || document.filename || null,
        bundlePath: makeUniqueBundlePath(`docs/${document.filename || basename(resolvedDocumentPath)}`, usedBundlePaths),
        sourcePath: resolvedDocumentPath,
      }));
    }
  }

  const bundleLogPayload = {
    generated_at: generatedAt,
    readiness_report_path: repoRelativePath(projectRoot, resolvedReadinessPath),
    docs_manifest_path: docsManifestPath ? repoRelativePath(projectRoot, docsManifestPath) : null,
    bundle_output_path: repoRelativePath(projectRoot, resolvedOutputPath),
    included_artifacts: bundleEntries.map((entry) => ({
      artifact_type: entry.artifact_type,
      role: entry.role,
      label: entry.label,
      path: entry.path,
      source_path: repoRelativePath(projectRoot, entry.source_path),
      sha256: entry.sha256,
      size_bytes: entry.size_bytes,
    })),
    skipped_artifacts: skippedArtifacts,
    warnings: uniqueStrings(warnings),
  };
  await writeBundleLog(logPath, bundleLogPayload);
  const [logEntry] = await collectArtifactMetadata([{
    type: 'release_bundle_log',
    path: logPath,
    label: 'Release bundle log JSON',
    scope: 'internal',
    stability: 'stable',
  }]);

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
  await writeChecksumsFile(checksumsPath, checksummedEntries);
  const [checksumsMetadata] = await collectArtifactMetadata([{
    type: 'release_bundle_checksums',
    path: checksumsPath,
    label: 'Release bundle checksums',
    scope: 'internal',
    stability: 'stable',
  }]);

  const manifest = {
    schema_version: C_ARTIFACT_SCHEMA_VERSION,
    artifact_type: 'release_bundle_manifest',
    workflow: 'readiness_release_bundle',
    generated_at: generatedAt,
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
    source_artifact_refs: sourceArtifactRefs,
    canonical_artifact: buildCanonicalArtifactDescriptor(),
    contract: getCCommandContract('pack'),
    readiness_report_ref: buildSourceArtifactRef(
      'readiness_report',
      repoRelativePath(projectRoot, resolvedReadinessPath),
      'input',
      'Canonical readiness report JSON'
    ),
    ...(docsManifestPath && docsManifest
      ? {
          docs_manifest_ref: buildSourceArtifactRef(
            'docs_manifest',
            repoRelativePath(projectRoot, docsManifestPath),
            'input',
            'Standard docs manifest JSON'
          ),
        }
      : {}),
    bundle_artifacts: [
      ...bundleEntries.map((entry) => ({
        artifact_type: entry.artifact_type,
        role: entry.role,
        label: entry.label,
        path: entry.path,
        source_path: repoRelativePath(projectRoot, entry.source_path),
        size_bytes: entry.size_bytes,
        sha256: entry.sha256,
      })),
      {
        artifact_type: 'release_bundle_log',
        role: 'supporting',
        label: 'Release bundle log JSON',
        path: 'release_bundle_log.json',
        source_path: repoRelativePath(projectRoot, logEntry.path),
        size_bytes: logEntry.size_bytes,
        sha256: logEntry.sha256,
      },
      {
        artifact_type: 'release_bundle_checksums',
        role: 'supporting',
        label: 'Release bundle checksums',
        path: 'release_bundle_checksums.sha256',
        source_path: repoRelativePath(projectRoot, checksumsMetadata.path),
        size_bytes: checksumsMetadata.size_bytes,
        sha256: checksumsMetadata.sha256,
      },
      {
        artifact_type: 'release_bundle_manifest',
        role: 'primary',
        label: 'Release bundle manifest JSON',
        path: 'release_bundle_manifest.json',
        source_path: repoRelativePath(projectRoot, manifestPath),
      },
    ],
    release_notes: buildReleaseNotes({
      docsManifestPath,
      skippedArtifacts,
    }),
    bundle_file: {
      path: repoRelativePath(projectRoot, resolvedOutputPath),
      filename: basename(resolvedOutputPath),
    },
  };

  await writeValidatedCArtifact(manifestPath, 'release_bundle_manifest', manifest, {
    command: 'pack',
  });

  const zipEntries = [];
  for (const entry of bundleEntries) {
    zipEntries.push({
      name: entry.path,
      data: await readFile(entry.source_path),
    });
  }
  zipEntries.push(
    {
      name: 'release_bundle_log.json',
      data: await readFile(logPath),
    },
    {
      name: 'release_bundle_checksums.sha256',
      data: await readFile(checksumsPath),
    },
    {
      name: 'release_bundle_manifest.json',
      data: await readFile(manifestPath),
    },
  );
  await createZipArchive(resolvedOutputPath, zipEntries);

  return {
    bundle_zip_path: resolvedOutputPath,
    manifest_path: manifestPath,
    log_path: logPath,
    checksums_path: checksumsPath,
    manifest,
    bundle_artifacts: manifest.bundle_artifacts,
  };
}

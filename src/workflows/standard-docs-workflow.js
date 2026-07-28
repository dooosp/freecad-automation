import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { publishAtomicOutputSet } from '../../lib/atomic-output-publication.js';
import { assertValidCArtifact, getCCommandContract } from '../../lib/c-artifact-schema.js';
import { writeValidatedCArtifact } from '../../lib/context-loader.js';
import { buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';
import { parseInspectionEvidenceJsonBytes } from '../../lib/inspection-evidence-onboarding.js';
import {
  RevisionLineageError,
  assertRevisionLineage,
  assertRevisionLineageIdentityAgreement,
  assertRevisionLineageSnapshotCurrent,
  buildRevisionLineage,
  buildRevisionLineageParent,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
  readRevisionLineageFileSnapshot,
} from '../../lib/revision-lineage-contract.js';
import { getPartIdentity } from '../agents/common.js';
import { createStandardDocTemplateService } from '../services/report/standard-doc-template-service.js';
import { loadShopProfile } from '../services/config/profile-service.js';
import { loadRuleProfile, summarizeRuleProfile } from '../services/config/rule-profile-service.js';
import { runReadinessReportWorkflow } from './readiness-report-workflow.js';

async function writeTextFile(filePath, content) {
  await writeFile(filePath, content, 'utf8');
  return filePath;
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
      ...(typeof ref.sha256 === 'string' ? { sha256: ref.sha256 } : {}),
      ...(Number.isInteger(ref.size_bytes) ? { size_bytes: ref.size_bytes } : {}),
    });
  }
  return merged;
}

function lineageError(code, message, details = {}) {
  return new RevisionLineageError(code, message, details);
}

function assertProofPath(value, label) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value !== value.trim()
    || isAbsolute(value)
    || value.includes('\\')
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw lineageError('unsafe_path', `Proof standard docs require a safe repository-relative ${label}.`);
  }
  return value;
}

function proofRunLocator(pathValue, portablePathRoot, label) {
  const relPath = relative(portablePathRoot, pathValue).replace(/\\/g, '/');
  if (!relPath || relPath === '..' || relPath.startsWith('../') || isAbsolute(relPath)) {
    throw lineageError('path_escape', `Proof ${label} is outside its explicit portable run root.`);
  }
  return `run/${relPath}`;
}

function exactParent(lineage, role, artifactType) {
  const matches = lineage.parents.filter((parent) => (
    parent.role === role && parent.artifact_type === artifactType
  ));
  if (matches.length !== 1) {
    throw lineageError('missing_parent', `Proof readiness must contain exactly one ${role} parent.`, {
      role,
      artifact_type: artifactType,
      match_count: matches.length,
    });
  }
  return matches[0];
}

function assertParentMatchesSnapshot(parent, snapshot, label) {
  if (
    parent.path !== snapshot.path
    || parent.sha256 !== snapshot.sha256
    || parent.size_bytes !== snapshot.size_bytes
  ) {
    throw lineageError('digest_mismatch', `${label} does not match the exact proof snapshot.`, {
      role: parent.role,
      artifact_type: parent.artifact_type,
    });
  }
}

function assertReadinessAliases(readinessReport, identity) {
  const part = readinessReport?.part || {};
  for (const [field, expected] of [
    ['package_slug', identity.package_slug],
    ['part_id', identity.part_id],
    ['revision', identity.revision],
  ]) {
    if (typeof part[field] !== 'string' || !part[field].trim()) {
      throw lineageError('missing_identity', `Proof readiness part.${field} is required.`);
    }
    if (part[field] !== expected) {
      throw lineageError('conflicting_identity', `Proof readiness part.${field} disagrees with revision_lineage.`);
    }
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function createProofStandardDocsContext({
  freecadRoot,
  configPath,
  authoritativeConfigSnapshot = null,
  readinessReportPath,
  readinessReport,
  lineageSelection,
}) {
  const configLocator = assertProofPath(configPath, 'config path');
  const readinessLocator = assertProofPath(readinessReportPath, 'readiness-report path');
  const configSnapshot = authoritativeConfigSnapshot || await readAuthoritativeConfigSnapshot({
    projectRoot: freecadRoot,
    configPath: configLocator,
    ...(lineageSelection === undefined ? {} : { selection: lineageSelection }),
  });
  if (configSnapshot.path !== configLocator) {
    throw lineageError('conflicting_identity', 'Proof config snapshot path does not match configPath.');
  }
  const readinessSnapshot = await readRevisionLineageFileSnapshot({
    projectRoot: freecadRoot,
    path: readinessLocator,
  });
  let snapshottedReadiness;
  try {
    snapshottedReadiness = parseInspectionEvidenceJsonBytes(readinessSnapshot.bytes, {
      requireCanonical: true,
    });
  } catch (error) {
    throw lineageError('malformed_identity', `Proof readiness snapshot is not valid strict JSON: ${error.message}`);
  }
  assertValidCArtifact('readiness_report', snapshottedReadiness, {
    command: 'generate-standard-docs',
    path: readinessLocator,
  });
  if (!isDeepStrictEqual(readinessReport, snapshottedReadiness)) {
    throw lineageError('input_changed_during_read', 'Loaded readiness report does not match its exact proof snapshot.');
  }
  if (!snapshottedReadiness.revision_lineage) {
    throw lineageError('unsupported_legacy', 'Proof standard docs require readiness revision_lineage.');
  }
  const readinessLineage = assertRevisionLineage(snapshottedReadiness.revision_lineage);
  assertRevisionLineageIdentityAgreement([configSnapshot.identity, readinessLineage]);
  assertReadinessAliases(snapshottedReadiness, readinessLineage.identity);
  const expectedConfigParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot: configSnapshot,
  });
  assertParentMatchesSnapshot(
    exactParent(readinessLineage, 'authoritative_config', 'config'),
    expectedConfigParent,
    'Readiness authoritative config parent'
  );
  const readinessParent = buildRevisionLineageParent({
    artifactType: 'readiness_report',
    role: 'readiness_report',
    path: proofRunLocator(
      readinessSnapshot.path,
      dirname(readinessSnapshot.path),
      'readiness report'
    ),
    sha256: readinessSnapshot.sha256,
    sizeBytes: readinessSnapshot.size_bytes,
  });
  const revisionLineage = buildRevisionLineage({
    identity: readinessLineage.identity,
    parents: [...readinessLineage.parents, readinessParent],
  });
  return {
    config: configSnapshot.config,
    configSnapshot,
    readinessReport: snapshottedReadiness,
    readinessSnapshot,
    readinessParent,
    revisionLineage,
  };
}

function repoRelativePath(projectRoot, filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return filePath;
  const relPath = relative(resolve(projectRoot), resolve(filePath)).replace(/\\/g, '/');
  return relPath && !relPath.startsWith('..') && !relPath.startsWith('/')
    ? relPath
    : filePath;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function deriveConfigLineageIdentity(config = {}) {
  const part = getPartIdentity(config);
  return {
    part_id: firstDefined(config.part?.part_id, config.product?.part_id, config.product?.id, null),
    name: part.name || null,
    revision: part.revision || null,
  };
}

function deriveReadinessLineageIdentity(report = {}) {
  const part = report?.part || {};
  return {
    part_id: part.part_id || report?.part_id || null,
    name: part.name || null,
    revision: part.revision || report?.revision || null,
  };
}

function describeLineageIdentity(identity = {}) {
  const segments = [];
  if (identity.part_id) segments.push(`part_id=${identity.part_id}`);
  if (identity.name) segments.push(`name=${identity.name}`);
  if (identity.revision) segments.push(`revision=${identity.revision}`);
  return segments.join(', ') || 'unknown identity';
}

function collectLineageMismatches(configIdentity, readinessIdentity) {
  const mismatches = [];
  if (configIdentity.part_id && readinessIdentity.part_id && configIdentity.part_id !== readinessIdentity.part_id) {
    mismatches.push(`part_id mismatch (${configIdentity.part_id} != ${readinessIdentity.part_id})`);
  }
  if (configIdentity.name && readinessIdentity.name && configIdentity.name !== readinessIdentity.name) {
    mismatches.push(`name mismatch (${configIdentity.name} != ${readinessIdentity.name})`);
  }
  if (configIdentity.revision && readinessIdentity.revision && configIdentity.revision !== readinessIdentity.revision) {
    mismatches.push(`revision mismatch (${configIdentity.revision} != ${readinessIdentity.revision})`);
  }
  return mismatches;
}

function summarizeConfigRefs(report = {}) {
  const configRefs = (report.source_artifact_refs || [])
    .filter((ref) => ref?.artifact_type === 'config' && typeof ref.path === 'string' && ref.path.trim())
    .map((ref) => ref.path);
  return uniqueStrings(configRefs);
}

function assertConfigMatchesReadinessLineage(config, report, { configPath = null } = {}) {
  const configIdentity = deriveConfigLineageIdentity(config);
  const readinessIdentity = deriveReadinessLineageIdentity(report);
  const mismatches = collectLineageMismatches(configIdentity, readinessIdentity);
  if (mismatches.length === 0) return;

  const referencedConfigPaths = summarizeConfigRefs(report);
  const reportConfigNote = referencedConfigPaths.length > 0
    ? ` readiness_report source config refs: ${referencedConfigPaths.join(', ')}.`
    : '';
  throw new Error(
    `generate-standard-docs config does not match readiness report lineage (${describeLineageIdentity(configIdentity)} vs ${describeLineageIdentity(readinessIdentity)}): ${mismatches.join('; ')}.${configPath ? ` input config: ${configPath}.` : ''}${reportConfigNote}`
  );
}

export function createStandardDocsWorkflow() {
  const generateStandardDocs = createStandardDocTemplateService();

  return async function runStandardDocsWorkflow({
    freecadRoot,
    runScript,
    loadConfig,
    configPath,
    config,
    options = {},
  }) {
    const requireAuthoritativeLineage = options.requireAuthoritativeLineage === true;
    if (options.requireAuthoritativeLineage !== undefined
      && options.requireAuthoritativeLineage !== true
      && options.requireAuthoritativeLineage !== false) {
      throw lineageError('malformed_policy', 'requireAuthoritativeLineage must be a boolean.');
    }
    if (requireAuthoritativeLineage && (!options.report || !options.reportPath)) {
      throw lineageError('missing_parent', 'Proof standard docs require an explicit readiness report object and path.');
    }
    const proofContext = requireAuthoritativeLineage
        ? await createProofStandardDocsContext({
          freecadRoot,
          configPath,
          authoritativeConfigSnapshot: options.authoritativeConfigSnapshot || null,
          readinessReportPath: options.reportPath,
          readinessReport: options.report,
          lineageSelection: options.lineageSelection,
        })
      : null;
    const loadedConfig = proofContext?.config || config || await loadConfig(configPath);
    const siteProfile = options.siteProfile || await loadShopProfile(freecadRoot, options.profileName || null, { silent: true });
    const ruleProfile = options.ruleProfile || await loadRuleProfile(freecadRoot, loadedConfig, { silent: true });
    const report = proofContext?.readinessReport || options.report || await runReadinessReportWorkflow({
      freecadRoot,
      runScript,
      loadConfig,
      configPath,
      config: loadedConfig,
      options,
    });
    assertConfigMatchesReadinessLineage(loadedConfig, report, { configPath });
    const defaultDir = resolve(freecadRoot, 'output', `${report.part?.name || 'part'}_standard_docs`);
    const outDir = resolve(options.outDir || defaultDir);
    const readinessReportPath = options.reportPath
      ? resolve(freecadRoot, options.reportPath)
      : await writeValidatedCArtifact(
          join(outDir, 'readiness_report.json'),
          'readiness_report',
          report,
          { command: 'readiness-report' }
        );

    const documents = generateStandardDocs(report, { siteProfile, ruleProfile });
    const artifacts = {};
    for (const filename of Object.keys(documents)) artifacts[filename] = join(outDir, filename);

    const generatedAt = options.generatedAt || report.generated_at;
    if (requireAuthoritativeLineage && (
      typeof generatedAt !== 'string'
      || !generatedAt.trim()
      || Number.isNaN(Date.parse(generatedAt))
    )) {
      throw lineageError('malformed_identity', 'Proof standard docs require a fixed parseable generated_at.');
    }

    const readinessSourceRef = proofContext
      ? {
          artifact_type: 'readiness_report',
          path: proofContext.readinessParent.path,
          role: 'input',
          label: 'Canonical readiness report JSON',
          sha256: proofContext.readinessSnapshot.sha256,
          size_bytes: proofContext.readinessSnapshot.size_bytes,
        }
      : buildSourceArtifactRef(
          'readiness_report',
          repoRelativePath(freecadRoot, readinessReportPath),
          'input',
          'Canonical readiness report JSON'
        );

    const manifest = {
      schema_version: '1.0',
      artifact_type: 'docs_manifest',
      workflow: 'standard_docs_generation',
      generated_at: generatedAt || new Date().toISOString(),
      ...(proofContext ? {
        effective_policy: { proof_lineage: true },
        revision_lineage: proofContext.revisionLineage,
      } : {}),
      draft_notice: 'Generated planning aid only. Engineering review required before controlled-document use.',
      part: report.part,
      warnings: uniqueStrings(report.warnings || []),
      coverage: {
        document_count: Object.keys(artifacts).length,
        source_artifact_count: (report.source_artifact_refs || []).length + 1,
      },
      confidence: report.confidence || {
        level: 'heuristic',
        score: 0.55,
        rationale: 'Standard-doc drafts are derived from the readiness-report JSON contract and still require engineering review.',
      },
      source_artifact_refs: mergeSourceArtifactRefs(
        report.source_artifact_refs || [],
        [readinessSourceRef]
      ),
      canonical_artifact: {
        json_is_source_of_truth: true,
        artifact_type: 'docs_manifest',
        artifact_filename: 'standard_docs_manifest.json',
        derived_outputs: Object.keys(artifacts),
        rationale: 'The docs manifest JSON is the canonical inventory for derived standard-document drafts.',
      },
      contract: getCCommandContract('generate-standard-docs'),
      site_profile: siteProfile
        ? {
            name: siteProfile.name || siteProfile.label || siteProfile.site?.name || null,
            label: siteProfile.label || null,
          }
        : null,
      rule_profile: summarizeRuleProfile(ruleProfile),
      documents: Object.entries(artifacts).map(([filename, path]) => ({
        filename,
        path: proofContext
          ? proofRunLocator(path, outDir, 'standard-doc document')
          : repoRelativePath(freecadRoot, path),
      })),
    };
    const manifestPath = join(outDir, 'standard_docs_manifest.json');
    if (proofContext) {
      assertValidCArtifact('docs_manifest', manifest, {
        command: 'generate-standard-docs',
        path: manifestPath,
      });
      const outputs = [
        ...Object.entries(documents).map(([filename, content]) => ({
          path: artifacts[filename],
          content,
        })),
        { path: manifestPath, content: `${JSON.stringify(manifest, null, 2)}\n` },
      ];
      const precomputedMetadata = Object.fromEntries(outputs.map((entry) => {
        const bytes = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
        return [resolve(entry.path), {
          exists: true,
          size_bytes: bytes.length,
          sha256: sha256(bytes),
        }];
      }));
      const additionalOutputs = typeof options.prepareProofPublicationOutputs === 'function'
        ? await options.prepareProofPublicationOutputs({
            artifacts: { ...artifacts, manifest: manifestPath },
            manifest,
            revisionLineage: proofContext.revisionLineage,
            configSnapshot: proofContext.configSnapshot,
            readinessSnapshot: proofContext.readinessSnapshot,
            precomputedMetadata,
          })
        : [];
      for (const entry of additionalOutputs || []) {
        if (!entry?.path || entry.content === undefined) {
          throw new Error('Proof standard-docs additional outputs require path and content.');
        }
        outputs.push(entry);
      }
      if (new Set(outputs.map((entry) => resolve(entry.path))).size !== outputs.length) {
        throw new Error('Proof standard-docs outputs must have unique paths.');
      }
      if (outputs.some((entry) => dirname(resolve(entry.path)) !== outDir)) {
        throw new Error('Proof standard-docs outputs must share the standard-docs output directory.');
      }
      await Promise.all([
        assertRevisionLineageSnapshotCurrent(proofContext.configSnapshot, { projectRoot: freecadRoot }),
        assertRevisionLineageSnapshotCurrent(proofContext.readinessSnapshot, { projectRoot: freecadRoot }),
      ]);
      await mkdir(outDir, { recursive: true });
      await publishAtomicOutputSet({
        directory: outDir,
        outputs,
        hooks: options.publicationHooks || {},
      });
    } else {
      await mkdir(outDir, { recursive: true });
      for (const [filename, content] of Object.entries(documents)) {
        artifacts[filename] = await writeTextFile(join(outDir, filename), content);
      }
      await writeValidatedCArtifact(
        manifestPath,
        'docs_manifest',
        manifest,
        { command: 'generate-standard-docs' }
      );
    }
    artifacts.manifest = manifestPath;

    return {
      report,
      config: loadedConfig,
      readiness_report_path: readinessReportPath,
      out_dir: outDir,
      artifacts,
      manifest,
      ...(proofContext ? {
        revisionLineage: proofContext.revisionLineage,
        proofSnapshots: {
          config: proofContext.configSnapshot,
          readiness: proofContext.readinessSnapshot,
        },
      } : {}),
    };
  };
}

export const runStandardDocsWorkflow = createStandardDocsWorkflow();

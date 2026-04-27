import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { getCCommandContract } from '../../lib/c-artifact-schema.js';
import { writeValidatedCArtifact } from '../../lib/context-loader.js';
import { buildSourceArtifactRef } from '../../lib/d-artifact-schema.js';
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
    const loadedConfig = config ?? await loadConfig(configPath);
    const siteProfile = options.siteProfile || await loadShopProfile(freecadRoot, options.profileName || null, { silent: true });
    const ruleProfile = options.ruleProfile || await loadRuleProfile(freecadRoot, loadedConfig, { silent: true });
    const report = options.report || await runReadinessReportWorkflow({
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
    await mkdir(outDir, { recursive: true });
    const readinessReportPath = options.reportPath
      ? resolve(options.reportPath)
      : await writeValidatedCArtifact(
          join(outDir, 'readiness_report.json'),
          'readiness_report',
          report,
          { command: 'readiness-report' }
        );

    const documents = generateStandardDocs(report, { siteProfile, ruleProfile });
    const artifacts = {};
    for (const [filename, content] of Object.entries(documents)) {
      artifacts[filename] = await writeTextFile(join(outDir, filename), content);
    }

    const manifest = {
      schema_version: '1.0',
      artifact_type: 'docs_manifest',
      workflow: 'standard_docs_generation',
      generated_at: new Date().toISOString(),
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
        [buildSourceArtifactRef(
          'readiness_report',
          repoRelativePath(freecadRoot, readinessReportPath),
          'input',
          'Canonical readiness report JSON'
        )]
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
        path: repoRelativePath(freecadRoot, path),
      })),
    };

    artifacts.manifest = await writeValidatedCArtifact(
      join(outDir, 'standard_docs_manifest.json'),
      'docs_manifest',
      manifest,
      { command: 'generate-standard-docs' }
    );

    return {
      report,
      readiness_report_path: readinessReportPath,
      out_dir: outDir,
      artifacts,
      manifest,
    };
  };
}

export const runStandardDocsWorkflow = createStandardDocsWorkflow();

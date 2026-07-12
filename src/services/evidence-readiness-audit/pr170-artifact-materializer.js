import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { buildRuntimeDiagnostics } from '../../../lib/runtime-diagnostics.js';
import { CANONICAL_PACKAGE_SLUGS } from '../../server/canonical-package-discovery.js';

export const PR170_ARTIFACT_MATERIALIZATION_TYPE = 'pr170_evidence_artifact_materialization';
export const PR170_EVIDENCE_GRAPH_RELATIVE_PATH = 'evidence/evidence_graph.json';
export const PR170_RUNTIME_FINGERPRINT_RELATIVE_PATH = 'runtime/runtime_fingerprint.json';
export const PR170_QIF_LITE_RELATIVE_PATH = 'inspection/qif_lite_focused_checks.xml';

const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence. Generated evidence graph, runtime fingerprint, and QIF-lite artifacts are review/control artifacts and do not satisfy inspection_evidence.';

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRepoPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function assertInsideProject(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${label} is required`);
  }
  if (
    relativePath.includes('\0')
    || relativePath.includes('\\')
    || relativePath.startsWith('~')
    || relativePath.split('/').includes('..')
    || isAbsolute(relativePath)
    || isWindowsAbsolutePath(relativePath)
  ) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  const root = resolve(projectRoot);
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the repository root`);
  }
  return { absolute, relative: rel };
}

function packageRelativePath(slug, suffix = '') {
  return suffix ? `docs/examples/${slug}/${suffix}` : `docs/examples/${slug}`;
}

function readJson(projectRoot, relativePath, label) {
  const { absolute } = assertInsideProject(projectRoot, relativePath, label);
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`Missing or invalid ${label}: ${relativePath}`);
  }
}

function sha256Text(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sha256File(projectRoot, relativePath) {
  const { absolute } = assertInsideProject(projectRoot, relativePath, relativePath);
  try {
    return createHash('sha256').update(readFileSync(absolute)).digest('hex');
  } catch {
    return null;
  }
}

function artifactRef(projectRoot, relativePath, artifactType) {
  const { absolute } = assertInsideProject(projectRoot, relativePath, artifactType);
  if (!existsSync(absolute)) {
    return {
      artifact_type: artifactType,
      path: relativePath,
      exists: false,
      size_bytes: null,
      sha256: null,
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    };
  }
  const stats = statSync(absolute);
  return {
    artifact_type: artifactType,
    path: relativePath,
    exists: true,
    size_bytes: stats.size,
    sha256: stats.isFile() ? sha256File(projectRoot, relativePath) : null,
    evidence_class: 'generated_or_control',
    trusted_inspection_evidence: false,
  };
}

function runGit(projectRoot, args) {
  const result = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

function collectRepoContext(projectRoot) {
  return {
    repo_root_basename: basename(resolve(projectRoot)),
    current_branch: runGit(projectRoot, ['branch', '--show-current']),
    head_sha: runGit(projectRoot, ['rev-parse', 'HEAD']),
    default_branch: runGit(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD'])?.replace(/^refs\/remotes\//, '') || null,
  };
}

function redactString(projectRoot, value) {
  const root = resolve(projectRoot).replaceAll('\\', '/');
  let text = String(value);
  text = text.replaceAll(root, '<repo-root>');
  text = text.replace(/\/(?:Applications|Users|home|private|var|tmp)\/[^\s"'<>),]+/g, (match) => {
    const file = basename(match);
    return file ? `<redacted>/${file}` : '<redacted>';
  });
  text = text.replace(/[A-Za-z]:[\\/]Users[\\/][^\s"'<>),]+/g, (match) => `<redacted>/${basename(match)}`);
  return text;
}

function redactValue(projectRoot, value) {
  if (typeof value === 'string') return redactString(projectRoot, value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(projectRoot, entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(projectRoot, entry)])
    );
  }
  return value;
}

function collectRuntimeContext(projectRoot, runtimeDiagnosticsFactory) {
  let diagnostics = {};
  try {
    diagnostics = runtimeDiagnosticsFactory({
      format: 'json',
      redactPaths: true,
    }) || {};
  } catch (error) {
    diagnostics = {
      runtime_available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const redacted = redactValue(projectRoot, diagnostics);
  return {
    available: redacted.runtime_available === true
      || redacted.available === true
      || Boolean(redacted.selected?.freecadcmd || redacted.selected_runtime),
    selected: safeObject(redacted.selected),
    versions: safeObject(redacted.versions),
    diagnostics: redacted,
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

function readinessSummary(readinessReport = {}) {
  const summary = safeObject(readinessReport.readiness_summary);
  const missingInputs = safeList(summary.missing_inputs);
  const inspectionMissing = missingInputs.includes('inspection_evidence')
    || summary.gate_decision === 'hold_for_evidence_completion'
    || summary.status === 'needs_more_evidence';
  return {
    status: summary.status || 'unknown',
    score: summary.score ?? null,
    gate_decision: summary.gate_decision || null,
    missing_inputs: missingInputs,
    inspection_evidence_missing: inspectionMissing,
  };
}

function sourceRefsFromReviewPack(reviewPack = {}) {
  return safeList(reviewPack.source_artifact_refs)
    .map((entry) => safeObject(entry))
    .filter((entry) => entry.path || entry.artifact_type)
    .map((entry, index) => ({
      id: `source:${index}:${entry.artifact_type || 'artifact'}`,
      kind: entry.artifact_type || 'source_artifact',
      path: entry.path || null,
      role: entry.role || 'review_control',
      label: entry.label || entry.artifact_type || 'Source artifact',
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    }));
}

function evidenceRecordsFromReviewPack(reviewPack = {}) {
  return safeList(reviewPack.evidence_ledger?.records)
    .map((entry) => safeObject(entry))
    .filter((entry) => entry.evidence_id || entry.type || entry.artifact_type)
    .map((entry, index) => ({
      id: `record:${normalizeRepoPath(entry.evidence_id || `${index}`)}`,
      kind: entry.artifact_type || entry.type || 'review_record',
      title: entry.title || entry.evidence_id || 'Review record',
      category: entry.category || null,
      source_ref: entry.source_ref || null,
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    }));
}

function buildInputArtifacts(projectRoot, slug) {
  const reviewPath = packageRelativePath(slug, 'review/review_pack.json');
  const readinessPath = packageRelativePath(slug, 'readiness/readiness_report.json');
  return {
    review_pack: artifactRef(projectRoot, reviewPath, 'review_pack'),
    readiness_report: artifactRef(projectRoot, readinessPath, 'readiness_report'),
  };
}

function buildEvidenceGraph({ projectRoot, slug, generatedAt, reviewPack, readinessReport }) {
  const inputArtifacts = buildInputArtifacts(projectRoot, slug);
  const sourceRefs = sourceRefsFromReviewPack(reviewPack);
  const evidenceRecords = evidenceRecordsFromReviewPack(reviewPack);
  const nodes = [
    {
      id: `package:${slug}`,
      kind: 'canonical_package',
      label: slug,
      evidence_class: 'control',
      trusted_inspection_evidence: false,
    },
    {
      id: 'artifact:review_pack',
      kind: 'review_pack',
      path: inputArtifacts.review_pack.path,
      sha256: inputArtifacts.review_pack.sha256,
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    },
    {
      id: 'artifact:readiness_report',
      kind: 'readiness_report',
      path: inputArtifacts.readiness_report.path,
      sha256: inputArtifacts.readiness_report.sha256,
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    },
    {
      id: 'artifact:evidence_graph',
      kind: 'evidence_graph',
      path: packageRelativePath(slug, PR170_EVIDENCE_GRAPH_RELATIVE_PATH),
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    },
    {
      id: 'artifact:runtime_fingerprint',
      kind: 'runtime_fingerprint',
      path: packageRelativePath(slug, PR170_RUNTIME_FINGERPRINT_RELATIVE_PATH),
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    },
    {
      id: 'artifact:qif_lite_focused_checks',
      kind: 'qif_lite_inspection_xml',
      path: packageRelativePath(slug, PR170_QIF_LITE_RELATIVE_PATH),
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
    },
    ...sourceRefs,
    ...evidenceRecords,
  ];
  const edges = [
    { from: `package:${slug}`, to: 'artifact:review_pack', kind: 'has_review_control_artifact' },
    { from: 'artifact:review_pack', to: 'artifact:readiness_report', kind: 'feeds_readiness' },
    { from: 'artifact:readiness_report', to: 'artifact:qif_lite_focused_checks', kind: 'readiness_gated_by' },
    { from: 'artifact:runtime_fingerprint', to: 'artifact:evidence_graph', kind: 'records_runtime_context_for' },
    ...sourceRefs.map((node) => ({
      from: node.id,
      to: 'artifact:review_pack',
      kind: 'referenced_by_review_pack',
    })),
    ...evidenceRecords.map((node) => ({
      from: node.id,
      to: 'artifact:review_pack',
      kind: 'summarized_by_review_pack',
    })),
  ];
  const trustedCount = nodes.filter((node) => node.trusted_inspection_evidence === true).length;
  return {
    artifact_type: 'evidence_graph',
    schema_version: '1.0',
    generated_at: generatedAt,
    package_slug: slug,
    source_of_truth: {
      review_pack: inputArtifacts.review_pack.path,
      readiness_report: inputArtifacts.readiness_report.path,
    },
    boundary: {
      generated_control_only: true,
      inspection_evidence_attached: false,
      readiness_regenerated: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
    readiness: readinessSummary(readinessReport),
    nodes,
    edges,
    summary: {
      node_count: nodes.length,
      edge_count: edges.length,
      trusted_inspection_evidence_node_count: trustedCount,
      generated_or_control_node_count: nodes.length - trustedCount,
      source_ref_count: sourceRefs.length,
      review_record_count: evidenceRecords.length,
    },
  };
}

function buildRuntimeFingerprint({
  projectRoot,
  slug,
  generatedAt,
  reviewPack,
  readinessReport,
  runtimeDiagnosticsFactory,
}) {
  const inputArtifacts = buildInputArtifacts(projectRoot, slug);
  return {
    artifact_type: 'runtime_fingerprint',
    schema_version: '1.0',
    generated_at: generatedAt,
    package_slug: slug,
    boundary: {
      generated_control_only: true,
      inspection_evidence_attached: false,
      readiness_regenerated: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
    repo_context: collectRepoContext(projectRoot),
    runtime_context: collectRuntimeContext(projectRoot, runtimeDiagnosticsFactory),
    input_artifacts: inputArtifacts,
    source_hashes: {
      review_pack_payload_sha256: sha256Text(JSON.stringify(reviewPack)),
      readiness_report_payload_sha256: sha256Text(JSON.stringify(readinessReport)),
    },
  };
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildQifLiteXml({ slug, generatedAt, reviewPack, readinessReport }) {
  const readiness = readinessSummary(readinessReport);
  const sourceRefs = sourceRefsFromReviewPack(reviewPack);
  const records = evidenceRecordsFromReviewPack(reviewPack);
  const status = readiness.inspection_evidence_missing ? 'held_missing' : 'review_only';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<QIFLiteInspection schema_version="1.0" generated_at="${escapeXml(generatedAt)}" package_slug="${escapeXml(slug)}" evidence_class="generated_or_control" inspection_evidence_attached="false">`,
    `  <EvidenceBoundary>${escapeXml(HARD_EVIDENCE_RULE)}</EvidenceBoundary>`,
    `  <Readiness status="${escapeXml(readiness.status)}" gate_decision="${escapeXml(readiness.gate_decision || 'unknown')}" score="${escapeXml(readiness.score ?? 'unknown')}" />`,
    `  <FocusedCheck id="inspection_evidence" status="${escapeXml(status)}" trusted_inspection_evidence="false" source="readiness_report" />`,
    `  <FocusedCheck id="generated_review_control_artifacts" status="review_only" trusted_inspection_evidence="false" count="${sourceRefs.length + records.length}" />`,
    ...records.slice(0, 12).map((record) =>
      `  <FocusedCheck id="${escapeXml(record.id)}" status="review_only" trusted_inspection_evidence="false" kind="${escapeXml(record.kind)}" />`
    ),
    '</QIFLiteInspection>',
    '',
  ].join('\n');
}

async function writeMaterializedArtifact({ projectRoot, relativePath, content, dryRun, force }) {
  const { absolute } = assertInsideProject(projectRoot, relativePath, relativePath);
  const exists = existsSync(absolute);
  if (dryRun) {
    return { path: relativePath, status: exists ? 'would_check_existing' : 'would_write' };
  }
  if (exists) {
    const current = readFileSync(absolute, 'utf8');
    if (current === content) {
      return { path: relativePath, status: 'unchanged' };
    }
    if (!force) {
      throw new Error(`Refusing to overwrite existing PR #170 artifact without --force: ${relativePath}`);
    }
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  return { path: relativePath, status: exists ? 'rewritten' : 'written' };
}

async function materializePackage({ projectRoot, slug, generatedAt, runtimeDiagnosticsFactory, dryRun, force }) {
  const reviewPath = packageRelativePath(slug, 'review/review_pack.json');
  const readinessPath = packageRelativePath(slug, 'readiness/readiness_report.json');
  const reviewPack = readJson(projectRoot, reviewPath, 'canonical review_pack.json');
  const readinessReport = readJson(projectRoot, readinessPath, 'canonical readiness_report.json');
  const graph = buildEvidenceGraph({ projectRoot, slug, generatedAt, reviewPack, readinessReport });
  const fingerprint = buildRuntimeFingerprint({
    projectRoot,
    slug,
    generatedAt,
    reviewPack,
    readinessReport,
    runtimeDiagnosticsFactory,
  });
  const qifLite = buildQifLiteXml({ slug, generatedAt, reviewPack, readinessReport });
  const artifacts = [
    {
      artifact_type: 'evidence_graph',
      path: packageRelativePath(slug, PR170_EVIDENCE_GRAPH_RELATIVE_PATH),
      content: `${JSON.stringify(graph, null, 2)}\n`,
    },
    {
      artifact_type: 'runtime_fingerprint',
      path: packageRelativePath(slug, PR170_RUNTIME_FINGERPRINT_RELATIVE_PATH),
      content: `${JSON.stringify(fingerprint, null, 2)}\n`,
    },
    {
      artifact_type: 'qif_lite_inspection_xml',
      path: packageRelativePath(slug, PR170_QIF_LITE_RELATIVE_PATH),
      content: qifLite,
    },
  ];
  const writes = [];
  for (const artifact of artifacts) {
    const writeResult = await writeMaterializedArtifact({
      projectRoot,
      relativePath: artifact.path,
      content: artifact.content,
      dryRun,
      force,
    });
    writes.push({
      artifact_type: artifact.artifact_type,
      path: artifact.path,
      evidence_class: 'generated_or_control',
      trusted_inspection_evidence: false,
      ...writeResult,
    });
  }
  return {
    slug,
    readiness: readinessSummary(readinessReport),
    artifacts: writes,
    generated_control_only: true,
    trusted_inspection_evidence: false,
  };
}

export async function materializePr170EvidenceArtifacts({
  projectRoot = resolve(import.meta.dirname, '../../..'),
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  generatedAt = null,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
  dryRun = false,
  force = false,
} = {}) {
  const root = resolve(projectRoot);
  const selectedSlugs = safeList(packageSlugs).length > 0 ? packageSlugs : CANONICAL_PACKAGE_SLUGS;
  selectedSlugs.forEach((slug) => {
    if (!CANONICAL_PACKAGE_SLUGS.includes(slug)) {
      throw new Error(`Unknown canonical package slug for PR #170 artifact materialization: ${slug}`);
    }
  });
  const generated = generatedAt || new Date().toISOString();
  const packages = [];
  for (const slug of selectedSlugs) {
    packages.push(await materializePackage({
      projectRoot: root,
      slug,
      generatedAt: generated,
      runtimeDiagnosticsFactory,
      dryRun,
      force,
    }));
  }
  const artifactStatuses = packages.flatMap((pkg) => pkg.artifacts.map((artifact) => artifact.status));
  return {
    artifact_type: PR170_ARTIFACT_MATERIALIZATION_TYPE,
    schema_version: '1.0',
    generated_at: generated,
    dry_run: dryRun === true,
    boundary: {
      generated_control_only: true,
      dry_run: dryRun === true,
      inspection_evidence_attached: false,
      readiness_regenerated: false,
      canonical_readiness_mutated: false,
      release_published: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
    summary: {
      package_count: packages.length,
      planned_artifact_count: packages.length * 3,
      written_artifact_count: artifactStatuses.filter((status) => status === 'written' || status === 'rewritten').length,
      unchanged_artifact_count: artifactStatuses.filter((status) => status === 'unchanged').length,
      generated_control_only: true,
    },
    packages,
  };
}

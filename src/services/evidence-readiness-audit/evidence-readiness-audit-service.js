import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { buildRuntimeDiagnostics } from '../../../lib/runtime-diagnostics.js';
import {
  CANONICAL_PACKAGE_SLUGS,
  buildCanonicalPackagesPayload,
} from '../../server/canonical-package-discovery.js';

export const DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR = 'output/evidence-readiness-audit';
export const EVIDENCE_READINESS_AUDIT_JSON = 'evidence_readiness_audit.json';
export const EVIDENCE_READINESS_AUDIT_MARKDOWN = 'evidence_readiness_audit.md';

const AUDIT_SCHEMA_VERSION = '1.0';
const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence. Generated CAD, drawing, quality, DFM, readiness, review, standard-doc, release, evidence graph, runtime fingerprint, QIF-lite, CI, fixture, template, and collection-guide artifacts are review/control artifacts unless a validated authorized inspection_evidence record is attached through the canonical flow.';
const RELEASE_OVERCLAIM_REASON = 'Release bundle presence does not mean production-ready; readiness remains gated by the canonical readiness report and authorized inspection_evidence.';

const GENERATED_REVIEW_ARTIFACT_TYPES = new Set([
  'create_quality_report',
  'drawing_quality_report',
  'drawing_qa_report',
  'drawing_intent',
  'extracted_drawing_semantics',
  'feature_catalog',
  'dfm_report',
  'quality_risk',
  'process_plan',
  'product_review',
  'investment_review',
  'review_pack',
  'readiness_report',
  'standard_docs_manifest',
  'release_bundle_manifest',
  'evidence_graph',
  'runtime_fingerprint',
  'qif_lite_inspection_xml',
]);

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
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
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

function parseRemoteDefault(value) {
  const text = String(value || '').trim();
  return text ? text.replace(/^refs\/remotes\//, '') : null;
}

function readJson(projectRoot, relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8'));
  } catch {
    return null;
  }
}

function sha256File(pathValue) {
  try {
    return createHash('sha256').update(readFileSync(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

function artifactRef(projectRoot, relativePath, artifactType, {
  role = 'control',
  evidenceClass = 'generated_or_control',
} = {}) {
  const absolute = resolve(projectRoot, relativePath);
  if (!existsSync(absolute)) {
    return {
      path: relativePath,
      artifact_type: artifactType,
      role,
      evidence_class: evidenceClass,
      exists: false,
      size_bytes: null,
      sha256: null,
    };
  }
  const stats = statSync(absolute);
  return {
    path: relativePath,
    artifact_type: artifactType,
    role,
    evidence_class: evidenceClass,
    exists: true,
    size_bytes: stats.size,
    sha256: stats.isFile() ? sha256File(absolute) : null,
  };
}

function findFirstExisting(projectRoot, relativePaths, artifactType, options = {}) {
  const existing = relativePaths.find((pathValue) => existsSync(resolve(projectRoot, pathValue)));
  return artifactRef(projectRoot, existing || relativePaths[0], artifactType, options);
}

function listFiles(projectRoot, relativeDir) {
  const absoluteDir = resolve(projectRoot, relativeDir);
  if (!existsSync(absoluteDir)) return [];
  const results = [];
  function walk(currentDir) {
    for (const name of readdirSync(currentDir)) {
      const absolute = join(currentDir, name);
      const rel = relative(projectRoot, absolute).split(sep).join('/');
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        walk(absolute);
      } else {
        results.push(rel);
      }
    }
  }
  walk(absoluteDir);
  return results.sort();
}

function classifyGeneratedArtifactType(pathValue) {
  const normalized = normalizeRepoPath(pathValue).toLowerCase();
  const extension = extname(normalized);
  if (normalized.includes('/inspection/') && extension === '.json') return 'inspection_evidence_candidate';
  if (normalized.includes('/quality/') && normalized.includes('create_quality')) return 'create_quality_report';
  if (normalized.includes('/quality/') && normalized.includes('drawing_quality')) return 'drawing_quality_report';
  if (normalized.includes('/quality/') && normalized.includes('drawing_qa')) return 'drawing_qa_report';
  if (normalized.includes('/drawing/') && normalized.includes('drawing_intent')) return 'drawing_intent';
  if (normalized.includes('/drawing/') && normalized.includes('extracted_drawing_semantics')) return 'extracted_drawing_semantics';
  if (normalized.includes('/drawing/') && normalized.includes('feature_catalog')) return 'feature_catalog';
  if (normalized.endsWith('/review/review_pack.json')) return 'review_pack';
  if (normalized.endsWith('/readiness/readiness_report.json')) return 'readiness_report';
  if (normalized.includes('/standard-docs/')) return 'standard_docs';
  if (normalized.includes('/release/')) return 'release_control';
  if (normalized.includes('evidence_graph')) return 'evidence_graph';
  if (normalized.includes('runtime_fingerprint')) return 'runtime_fingerprint';
  if (normalized.includes('qif') && normalized.includes('lite')) return 'qif_lite_inspection_xml';
  if (['.step', '.stp', '.stl', '.brep', '.brp', '.fcstd'].includes(extension)) return 'cad_model';
  return 'package_artifact';
}

function countEvidenceLedger({ reviewPack, canonicalInspectionEvidenceAttached }) {
  const records = safeList(reviewPack?.evidence_ledger?.records);
  const sourceRefs = safeList(reviewPack?.source_artifact_refs);
  const explicitInspectionRecords = records.filter((record) =>
    record?.inspection_evidence === true
    && record?.type === 'inspection_evidence'
    && record?.artifact_type === 'inspection_evidence'
  );
  const generatedLedgerRecords = records.filter((record) => {
    if (record?.inspection_evidence === true) return false;
    const type = record?.artifact_type || record?.type;
    return GENERATED_REVIEW_ARTIFACT_TYPES.has(type) || record?.source_ref || record?.evidence_id;
  });
  const generatedSourceRefs = sourceRefs.filter((ref) =>
    ref?.artifact_type !== 'inspection_evidence'
    && ref?.role !== 'inspection_evidence'
  );
  const authorizedInspection = canonicalInspectionEvidenceAttached
    ? Math.max(1, explicitInspectionRecords.length)
    : 0;
  return {
    authorized_inspection: authorizedInspection,
    trusted_inspection: authorizedInspection,
    generated_review: generatedLedgerRecords.length + generatedSourceRefs.length,
    control_artifacts: 0,
    ledger_record_count: records.length,
    source_ref_count: sourceRefs.length,
  };
}

function summarizeGraph(graph = null) {
  if (!graph) {
    return {
      exists: false,
      node_count: 0,
      edge_count: 0,
      inspection_evidence_node_count: 0,
      generated_or_control_node_count: 0,
    };
  }
  const nodes = safeList(graph.nodes);
  const edges = safeList(graph.edges);
  const inspectionNodes = nodes.filter((node) =>
    node?.kind === 'inspection_evidence'
    || node?.inspection_evidence === true
    || node?.data?.inspection_evidence === true
  );
  return {
    exists: true,
    node_count: nodes.length,
    edge_count: edges.length,
    inspection_evidence_node_count: inspectionNodes.length,
    generated_or_control_node_count: Math.max(0, nodes.length - inspectionNodes.length),
  };
}

function summarizeRuntimeFingerprint(fingerprint = null) {
  if (!fingerprint) {
    return {
      exists: false,
      reproducible_context_recorded: false,
      freecad_version: null,
      python_version: null,
      git_head: null,
    };
  }
  return {
    exists: true,
    reproducible_context_recorded: true,
    freecad_version: fingerprint.freecad_version || fingerprint.runtime?.freecad_version || fingerprint.versions?.freecad || null,
    python_version: fingerprint.python_version || fingerprint.runtime?.python_version || fingerprint.versions?.python || null,
    git_head: fingerprint.git_head || fingerprint.repo?.head_sha || fingerprint.repo_context?.head_sha || null,
  };
}

function summarizeQifLiteInspection(projectRoot, artifact) {
  if (!artifact?.exists) {
    return {
      exists: false,
      focused_check_count: 0,
      qif_lite_root_detected: false,
      generated_control_only: true,
    };
  }
  let content = '';
  try {
    content = readFileSync(resolve(projectRoot, artifact.path), 'utf8');
  } catch {
    content = '';
  }
  const focusedChecks = content.match(/<\s*FocusedCheck\b/gi) || [];
  return {
    exists: true,
    focused_check_count: focusedChecks.length,
    qif_lite_root_detected: /<\s*(QIFLiteInspection|QIFLite|QIF)\b/i.test(content),
    generated_control_only: true,
  };
}

function buildPr170ArtifactState(artifact, summary = {}) {
  const exists = artifact?.exists === true;
  return {
    status: exists ? 'present_generated_control' : 'missing',
    path: artifact?.path || null,
    artifact_type: artifact?.artifact_type || null,
    evidence_class: artifact?.evidence_class || 'generated_or_control',
    trusted_inspection_evidence: false,
    generated_control_only: true,
    ...summary,
  };
}

function holdReasons(readiness = {}) {
  return [
    ...new Set([
      ...safeList(readiness.missing_inputs),
      readiness.inspection_evidence_missing ? 'inspection_evidence' : null,
      readiness.gate_decision === 'hold_for_evidence_completion' ? 'inspection_evidence' : null,
    ].filter(Boolean)),
  ];
}

function summarizeReadiness(readiness = {}) {
  const reasons = holdReasons(readiness);
  const held = readiness.status !== 'ready'
    || readiness.gate_decision === 'hold_for_evidence_completion'
    || reasons.length > 0;
  return {
    status: readiness.status || 'unknown',
    score: readiness.score ?? null,
    gate_decision: readiness.gate_decision || null,
    missing_inputs: safeList(readiness.missing_inputs),
    inspection_evidence_missing: readiness.inspection_evidence_missing === true,
    source_of_truth_path: readiness.source_of_truth_path || null,
    held,
    hold_reasons: reasons,
    hold_explanation: held
      ? `Readiness is held because ${reasons.join(', ') || readiness.gate_decision || 'the readiness report does not clear the gate'}.`
      : 'Readiness report does not record a hold.',
  };
}

function buildNextSafeCommands(slug, outputRoot = DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR) {
  return [
    {
      name: 'inspection_evidence_intake',
      command: [
        'fcad',
        'inspection-evidence-intake',
        '--package',
        slug,
        '--out',
        `${outputRoot}/${slug}-inspection-evidence-intake.json`,
      ],
      mutates_canonical_artifacts: false,
      read_only: true,
      purpose: 'discover and classify candidate inspection evidence without attaching it',
    },
    {
      name: 'stage5b_evidence_audit',
      command: [
        'fcad',
        'stage5b-evidence-audit',
        '--package',
        slug,
        '--out-dir',
        `${outputRoot}/${slug}-stage5b`,
      ],
      mutates_canonical_artifacts: false,
      read_only: true,
      purpose: 'rerun the non-mutating Stage 5B intake and promotion dry-run bundle for this package',
    },
    {
      name: 'release_dry_run_doctor',
      command: [
        'npm',
        'run',
        'release:dry-run:doctor',
        '--',
        '--package',
        slug,
        '--clean',
      ],
      mutates_canonical_artifacts: false,
      read_only: true,
      purpose: 'prove a release dry run does not publish, tag, upload, attach evidence, or regenerate readiness',
    },
  ];
}

function collectPackageArtifacts(projectRoot, slug) {
  const root = `docs/examples/${slug}`;
  const evidenceGraphCandidates = [
    `${root}/evidence/evidence_graph.json`,
    `${root}/review/evidence_graph.json`,
    `${root}/review/evidence-graph.json`,
    `${root}/evidence-graph/evidence_graph.json`,
    `${root}/evidence-graph.json`,
  ];
  const runtimeFingerprintCandidates = [
    `${root}/runtime/runtime_fingerprint.json`,
    `${root}/review/runtime_fingerprint.json`,
    `${root}/reproducibility/runtime_fingerprint.json`,
    `${root}/runtime-fingerprint.json`,
  ];
  const qifLiteCandidates = [
    `${root}/inspection/qif_lite_focused_checks.xml`,
    `${root}/inspection/qif-lite-focused-checks.xml`,
    `${root}/inspection/qif_lite_inspection.xml`,
    `${root}/inspection/qif-lite-inspection.xml`,
    `${root}/inspection/qif_lite.xml`,
    `${root}/inspection/qif-lite.xml`,
    `${root}/review/qif_lite_inspection.xml`,
    `${root}/qif-lite/qif_lite_inspection.xml`,
    `${root}/qif-lite.xml`,
  ];
  return {
    package_root: artifactRef(projectRoot, root, 'canonical_package_root'),
    readme: artifactRef(projectRoot, `${root}/README.md`, 'package_readme'),
    config: artifactRef(projectRoot, `${root}/config.toml`, 'package_config', { role: 'input' }),
    review_pack: artifactRef(projectRoot, `${root}/review/review_pack.json`, 'review_pack'),
    readiness_report: artifactRef(projectRoot, `${root}/readiness/readiness_report.json`, 'readiness_report'),
    standard_docs_manifest: artifactRef(projectRoot, `${root}/standard-docs/standard_docs_manifest.json`, 'standard_docs_manifest'),
    release_manifest: artifactRef(projectRoot, `${root}/release/release_bundle_manifest.json`, 'release_bundle_manifest'),
    release_bundle: artifactRef(projectRoot, `${root}/release/release_bundle.zip`, 'release_bundle'),
    release_checksums: artifactRef(projectRoot, `${root}/release/release_bundle_checksums.sha256`, 'release_bundle_checksums'),
    evidence_graph: findFirstExisting(projectRoot, evidenceGraphCandidates, 'evidence_graph'),
    runtime_fingerprint: findFirstExisting(projectRoot, runtimeFingerprintCandidates, 'runtime_fingerprint'),
    qif_lite_inspection: findFirstExisting(projectRoot, qifLiteCandidates, 'qif_lite_inspection_xml'),
  };
}

function collectRepoContext(projectRoot) {
  const root = runGit(projectRoot, ['rev-parse', '--show-toplevel']);
  const branch = runGit(projectRoot, ['branch', '--show-current']);
  const head = runGit(projectRoot, ['rev-parse', 'HEAD']);
  const remoteDefault = runGit(projectRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const dirty = runGit(projectRoot, ['status', '--porcelain', '--untracked-files=all']);
  const repoRoot = root.ok ? root.stdout.trim() : resolve(projectRoot);
  const dirtyPaths = dirty.ok ? dirty.stdout.split(/\r?\n/).filter(Boolean) : [];
  return {
    repo_root_basename: basename(repoRoot),
    current_branch: branch.ok ? branch.stdout.trim() || null : null,
    head_sha: head.ok ? head.stdout.trim() || null : null,
    default_branch: remoteDefault.ok ? parseRemoteDefault(remoteDefault.stdout) : null,
    dirty_path_count: dirtyPaths.length,
    dirty_paths_redacted: dirtyPaths.map((entry) => entry.replace(/^(.{2})\s+/, '').replaceAll('\\', '/')),
  };
}

function redactString(projectRoot, value) {
  const root = resolve(projectRoot).replaceAll('\\', '/');
  let text = String(value);
  text = text.replaceAll(root, '<repo-root>');
  text = text.replace(/\/(?:Users|home|private|var|tmp)\/[^\s"'<>),]+/g, (match) => {
    const file = basename(match);
    return file && file !== '<redacted>' ? `<redacted>/${file}` : '<redacted>';
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
  };
}

async function buildPackageAudit({ projectRoot, slug, canonicalPackage, outputRoot }) {
  const packageRoot = `docs/examples/${slug}`;
  const artifacts = collectPackageArtifacts(projectRoot, slug);
  const reviewPack = readJson(projectRoot, `${packageRoot}/review/review_pack.json`);
  const evidenceGraph = artifacts.evidence_graph.exists ? readJson(projectRoot, artifacts.evidence_graph.path) : null;
  const runtimeFingerprint = artifacts.runtime_fingerprint.exists ? readJson(projectRoot, artifacts.runtime_fingerprint.path) : null;
  const readiness = summarizeReadiness(canonicalPackage?.readiness || {});
  const evidenceCounts = countEvidenceLedger({
    reviewPack,
    canonicalInspectionEvidenceAttached: Boolean(canonicalPackage?.inspection_evidence_path),
  });
  const packageFiles = listFiles(projectRoot, packageRoot);
  const generatedArtifactTypes = packageFiles
    .map(classifyGeneratedArtifactType)
    .filter((type) => type !== 'inspection_evidence_candidate');
  const controlArtifactCount = [
    artifacts.review_pack,
    artifacts.readiness_report,
    artifacts.standard_docs_manifest,
    artifacts.release_manifest,
    artifacts.release_bundle,
    artifacts.release_checksums,
    artifacts.evidence_graph,
    artifacts.runtime_fingerprint,
    artifacts.qif_lite_inspection,
  ].filter((artifact) => artifact.exists).length;
  evidenceCounts.control_artifacts = controlArtifactCount;

  const graphSummary = summarizeGraph(evidenceGraph);
  const fingerprintSummary = summarizeRuntimeFingerprint(runtimeFingerprint);
  const qifLiteSummary = summarizeQifLiteInspection(projectRoot, artifacts.qif_lite_inspection);
  const releaseOverclaim = readiness.held && artifacts.release_bundle.exists;
  return {
    slug,
    name: canonicalPackage?.name || slug,
    package_path: packageRoot,
    artifacts,
    package_artifact_inventory: {
      file_count: packageFiles.length,
      generated_or_control_artifact_types: [...new Set(generatedArtifactTypes)].sort(),
    },
    readiness,
    evidence_counts: evidenceCounts,
    evidence_graph: graphSummary,
    runtime_fingerprint: fingerprintSummary,
    qif_lite: qifLiteSummary,
    pr170_artifacts: {
      evidence_graph: buildPr170ArtifactState(artifacts.evidence_graph, graphSummary),
      runtime_fingerprint: buildPr170ArtifactState(artifacts.runtime_fingerprint, fingerprintSummary),
      qif_lite: buildPr170ArtifactState(artifacts.qif_lite_inspection, qifLiteSummary),
    },
    evidence_boundary: {
      trusted_vs_generated_explained: true,
      authorized_inspection_evidence_path: canonicalPackage?.inspection_evidence_path || null,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      generated_review_artifacts_are_not_inspection_evidence: true,
      release_bundles_are_not_readiness_proof: true,
      pr170_artifacts_are_not_authorized_inspection_evidence: true,
    },
    release_decision: {
      release_manifest_present: artifacts.release_manifest.exists,
      release_bundle_present: artifacts.release_bundle.exists,
      overclaim_if_marked_ready: releaseOverclaim,
      reason: releaseOverclaim
        ? RELEASE_OVERCLAIM_REASON
        : 'Release sidecars do not overclaim readiness in this audit state.',
    },
    next_safe_commands: buildNextSafeCommands(slug, outputRoot),
  };
}

function summarizePackages(packages) {
  const heldPackages = packages.filter((pkg) => pkg.readiness.held);
  const authorizedInspection = packages.reduce((sum, pkg) => sum + pkg.evidence_counts.authorized_inspection, 0);
  const trustedInspection = packages.reduce((sum, pkg) => sum + pkg.evidence_counts.trusted_inspection, 0);
  const generatedReview = packages.reduce((sum, pkg) => sum + pkg.evidence_counts.generated_review, 0);
  const evidenceGraphCount = packages.filter((pkg) => pkg.artifacts.evidence_graph.exists).length;
  const runtimeFingerprintCount = packages.filter((pkg) => pkg.artifacts.runtime_fingerprint.exists).length;
  const qifLiteCount = packages.filter((pkg) => pkg.artifacts.qif_lite_inspection.exists).length;
  const completePr170Count = packages.filter((pkg) =>
    pkg.artifacts.evidence_graph.exists
    && pkg.artifacts.runtime_fingerprint.exists
    && pkg.artifacts.qif_lite_inspection.exists
  ).length;
  const releaseOverclaimCount = packages.filter((pkg) => pkg.release_decision.overclaim_if_marked_ready).length;
  return {
    package_count: packages.length,
    held_package_count: heldPackages.length,
    ready_package_count: packages.length - heldPackages.length,
    authorized_inspection_evidence_record_count: authorizedInspection,
    trusted_evidence_record_count: trustedInspection,
    generated_review_artifact_count: generatedReview,
    evidence_graph_package_count: evidenceGraphCount,
    runtime_fingerprint_package_count: runtimeFingerprintCount,
    qif_lite_package_count: qifLiteCount,
    pr170_artifact_coverage: {
      evidence_graph_package_count: evidenceGraphCount,
      runtime_fingerprint_package_count: runtimeFingerprintCount,
      qif_lite_package_count: qifLiteCount,
      complete_package_count: completePr170Count,
      missing_package_count: Math.max(0, packages.length - completePr170Count),
    },
    release_overclaim_risk_count: releaseOverclaimCount,
    decision: heldPackages.length || releaseOverclaimCount ? 'hold' : 'pass',
    primary_hold_reasons: [...new Set(heldPackages.flatMap((pkg) => pkg.readiness.hold_reasons))],
  };
}

function renderMarkdown(audit) {
  const lines = [
    '# Evidence/Readiness Maintainer Audit',
    '',
    `Generated: ${audit.generated_at}`,
    `Decision: ${audit.summary.decision}`,
    `Packages: ${audit.summary.package_count}`,
    `Readiness held: ${audit.summary.held_package_count}`,
    `Trusted inspection evidence records: ${audit.summary.trusted_evidence_record_count}`,
    `Generated review/control artifact count: ${audit.summary.generated_review_artifact_count}`,
    `Evidence graph packages: ${audit.summary.evidence_graph_package_count}`,
    `Runtime fingerprint packages: ${audit.summary.runtime_fingerprint_package_count}`,
    `QIF-lite packages: ${audit.summary.qif_lite_package_count}`,
    `Release overclaim risks: ${audit.summary.release_overclaim_risk_count}`,
    '',
    '## Boundary',
    '',
    audit.boundary.hard_evidence_rule,
    '',
    '## Packages',
    '',
    ...audit.packages.map((pkg) => [
      `### ${pkg.slug}`,
      '',
      `- Readiness: ${pkg.readiness.status} / ${pkg.readiness.gate_decision || 'unknown'} (${pkg.readiness.score ?? 'no score'})`,
      `- Hold reasons: ${pkg.readiness.hold_reasons.join(', ') || 'none'}`,
      `- Trusted inspection evidence: ${pkg.evidence_counts.trusted_inspection}`,
      `- Generated review/control evidence: ${pkg.evidence_counts.generated_review}`,
      `- Evidence graph: ${pkg.evidence_graph.exists ? 'present' : 'missing'}`,
      `- Runtime fingerprint: ${pkg.runtime_fingerprint.exists ? 'present' : 'missing'}`,
      `- QIF-lite: ${pkg.qif_lite.exists ? 'present' : 'missing'}`,
      `- PR #170 artifact boundary: ${pkg.pr170_artifacts.evidence_graph.status}, ${pkg.pr170_artifacts.runtime_fingerprint.status}, ${pkg.pr170_artifacts.qif_lite.status}; generated/control only`,
      `- Release decision: ${pkg.release_decision.reason}`,
      `- Next safe command: ${pkg.next_safe_commands[0]?.command.join(' ') || 'none'}`,
      '',
    ].join('\n')),
  ];
  return `${lines.join('\n')}\n`;
}

export async function buildEvidenceReadinessAudit({
  projectRoot = resolve(import.meta.dirname, '../../..'),
  packageSlugs = CANONICAL_PACKAGE_SLUGS,
  generatedAt = null,
  outputRoot = DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
} = {}) {
  const root = resolve(projectRoot);
  const canonicalPayload = await buildCanonicalPackagesPayload({ projectRoot: root });
  const canonicalBySlug = new Map(canonicalPayload.packages.map((pkg) => [pkg.slug, pkg]));
  const selectedSlugs = safeList(packageSlugs).length > 0 ? packageSlugs : CANONICAL_PACKAGE_SLUGS;
  const packages = await Promise.all(
    selectedSlugs.map((slug) => buildPackageAudit({
      projectRoot: root,
      slug,
      canonicalPackage: canonicalBySlug.get(slug),
      outputRoot,
    }))
  );
  const generated = generatedAt || new Date().toISOString();
  const summary = summarizePackages(packages);

  return {
    artifact_type: 'evidence_readiness_audit',
    schema_version: AUDIT_SCHEMA_VERSION,
    generated_at: generated,
    non_mutating: true,
    dry_run: true,
    boundary: {
      canonical_artifacts_mutated: false,
      inspection_evidence_attached: false,
      readiness_regenerated: false,
      release_published: false,
      git_tag_created: false,
      artifacts_uploaded: false,
      hard_evidence_rule: HARD_EVIDENCE_RULE,
    },
    repo_context: collectRepoContext(root),
    runtime_context: collectRuntimeContext(root, runtimeDiagnosticsFactory),
    summary,
    packages,
    maintainer_decision: {
      decision: summary.decision,
      release_would_overclaim_readiness: summary.release_overclaim_risk_count > 0,
      safe_to_publish_release: summary.decision === 'pass',
      reason: summary.decision === 'pass'
        ? 'All audited packages cleared the evidence/readiness hold checks.'
        : 'At least one canonical package remains held or would overclaim readiness if released as production-ready.',
    },
    next_safe_commands: [
      {
        name: 'rerun_evidence_readiness_audit',
        command: ['fcad', 'evidence-readiness-audit', '--out-dir', outputRoot, '--clean'],
        mutates_canonical_artifacts: false,
        read_only: true,
      },
      {
        name: 'maintainer_doctor',
        command: ['npm', 'run', 'maintainer:doctor', '--', '--clean'],
        mutates_canonical_artifacts: false,
        read_only: true,
      },
    ],
  };
}

export async function writeEvidenceReadinessAudit({
  projectRoot = resolve(import.meta.dirname, '../../..'),
  outDir = DEFAULT_EVIDENCE_READINESS_AUDIT_OUT_DIR,
  clean = false,
  packageSlugs = undefined,
  generatedAt = null,
  runtimeDiagnosticsFactory = buildRuntimeDiagnostics,
} = {}) {
  const root = resolve(projectRoot);
  const outputDir = assertPathInsideProject(root, outDir, 'evidence-readiness-audit out-dir');
  if (!outputDir.relative.startsWith('output/')) {
    throw new Error('evidence-readiness-audit out-dir must stay under ignored output/');
  }
  if (clean) {
    rmSync(outputDir.absolute, { recursive: true, force: true });
  }
  await mkdir(outputDir.absolute, { recursive: true });
  const audit = await buildEvidenceReadinessAudit({
    projectRoot: root,
    packageSlugs,
    generatedAt,
    outputRoot: outputDir.relative,
    runtimeDiagnosticsFactory,
  });
  const auditPath = join(outputDir.absolute, EVIDENCE_READINESS_AUDIT_JSON);
  const summaryPath = join(outputDir.absolute, EVIDENCE_READINESS_AUDIT_MARKDOWN);
  const markdown = renderMarkdown(audit);
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await writeFile(summaryPath, markdown, 'utf8');
  return {
    audit,
    outputDir: outputDir.relative,
    auditPath,
    summaryPath,
    paths: {
      audit: repoRelative(root, auditPath),
      summary: repoRelative(root, summaryPath),
    },
  };
}

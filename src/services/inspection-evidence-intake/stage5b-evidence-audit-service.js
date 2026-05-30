import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { discoverInspectionEvidenceIntake } from './inspection-evidence-intake-service.js';
import { writeInspectionEvidencePromotionDryRunManifest } from './promotion-dry-run-service.js';
import {
  assertValidStage5bAuditManifest,
  assertValidStage5bAuditSummaryMarkdown,
  assertValidStage5bIntakeReport,
  assertValidStage5bPromotionDryRunManifest,
} from './stage5b-runtime-validation.js';

const AUDIT_SCHEMA_VERSION = '1.0';
const INTAKE_FILE_NAME = 'intake_report.json';
const PROMOTION_DRY_RUN_FILE_NAME = 'promotion_dry_run_manifest.json';
const AUDIT_MANIFEST_FILE_NAME = 'stage5b_audit_manifest.json';
const AUDIT_SUMMARY_FILE_NAME = 'stage5b_audit_summary.md';

const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence. Intake reports, dry-run manifests, audit manifests, fixtures, generated CAD/drawing/quality/DFM/readiness/review reports, release bundles, screenshots, CI summaries, templates, collection guides, and GitHub metadata alone are not evidence.';

const REJECTED_AS_FINAL_EVIDENCE = Object.freeze([
  'intake reports',
  'promotion dry-run manifests',
  'audit manifests',
  'fixtures',
  'generated CAD artifacts',
  'generated drawing artifacts',
  'generated quality artifacts',
  'generated DFM reports',
  'generated readiness reports',
  'generated review reports',
  'release bundles',
  'screenshots',
  'CI summaries',
  'templates',
  'collection guides',
  'GitHub metadata alone',
]);

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nowIso(explicitValue = null) {
  return explicitValue || new Date().toISOString();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function normalizeRepoPath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || ''));
}

function isSafeRepoPath(value) {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return false;
  if (normalized.includes('\0')) return false;
  if (normalized.includes('\\')) return false;
  if (normalized.startsWith('/') || isAbsolute(normalized) || isWindowsAbsolutePath(normalized)) return false;
  if (normalized.startsWith('~')) return false;
  if (normalized.includes('<') || normalized.includes('>')) return false;
  return !normalized.split('/').includes('..');
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
  if (!isSafeRepoPath(rel)) {
    throw new Error(`${label} failed repository path safety checks`);
  }
  return { absolute, relative: rel };
}

function repoRelativePath(projectRoot, pathValue) {
  if (typeof pathValue !== 'string' || !pathValue.trim()) return pathValue;
  const root = resolve(projectRoot);
  const absolute = isAbsolute(pathValue) || isWindowsAbsolutePath(pathValue)
    ? resolve(pathValue)
    : resolve(root, pathValue);
  const rel = relative(root, absolute).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : pathValue;
}

async function sha256IfReadable(pathValue) {
  if (!pathValue) return null;
  try {
    return createHash('sha256').update(await readFile(pathValue)).digest('hex');
  } catch {
    return null;
  }
}

async function writeJsonFile(pathValue, data) {
  await mkdir(dirname(pathValue), { recursive: true });
  await writeFile(pathValue, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return pathValue;
}

function countByClassification(candidates = []) {
  const counts = {};
  for (const candidate of safeList(candidates)) {
    const key = candidate?.classification || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countByField(candidates = [], fieldName) {
  const counts = {};
  for (const candidate of safeList(candidates)) {
    const key = candidate?.[fieldName] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function outputRef(projectRoot, pathValue, artifactType, sha256 = null, extra = {}) {
  return {
    path: repoRelativePath(projectRoot, pathValue),
    artifact_type: artifactType,
    sha256,
    ...extra,
  };
}

function sourceClasses(intakeReport = {}) {
  const accepted = safeList(intakeReport.accepted_candidates);
  const rejected = safeList(intakeReport.rejected_candidates);
  const searchedSources = [
    ...safeList(intakeReport.searched_sources),
    ...safeList(intakeReport.github_discovery?.searched_sources),
    ...safeList(intakeReport.github_discovery?.skipped_sources),
  ];
  return {
    searched_source_classes: uniqueStrings([
      ...safeList(intakeReport.source_boundary?.allowed_sources),
      ...searchedSources.map((source) => source.kind),
    ]),
    searched_sources: searchedSources,
    accepted_count: accepted.length,
    rejected_count: rejected.length,
    accepted_counts: countByClassification(accepted),
    rejected_counts: countByClassification(rejected),
    accepted_source_kinds: countByField(accepted, 'source_kind'),
    rejected_source_kinds: countByField(rejected, 'source_kind'),
    accepted_source_formats: countByField(accepted, 'source_format'),
    rejected_source_formats: countByField(rejected, 'source_format'),
  };
}

function githubSummary(intakeReport = {}) {
  const github = safeObject(intakeReport.github_discovery);
  return {
    enabled: github.enabled === true,
    repo: github.repo || null,
    searched_source_count: safeList(github.searched_sources).length,
    skipped_source_count: safeList(github.skipped_sources).length,
    downloaded_candidate_count: safeList(github.downloaded_candidates).length,
    accepted_candidate_count: github.accepted_candidate_count || 0,
    rejected_candidate_count: github.rejected_candidate_count || 0,
    rejection_classes: safeObject(github.rejection_classes),
    searched_sources: safeList(github.searched_sources),
    skipped_sources: safeList(github.skipped_sources),
    downloaded_candidates: safeList(github.downloaded_candidates),
  };
}

function packageReadinessStates(intakeReport = {}, promotionDryRunManifest = {}) {
  const dryRunBySlug = new Map(
    safeList(promotionDryRunManifest.packages).map((pkg) => [pkg.package_slug, pkg])
  );
  return safeList(intakeReport.packages).map((pkg) => {
    const dryRun = dryRunBySlug.get(pkg.slug) || {};
    const readinessAfter = safeObject(pkg.readiness_after);
    return {
      slug: pkg.slug,
      intake_classification: pkg.classification || 'unknown',
      promotion_status: dryRun.promotion_status || 'not_evaluated',
      attachment_ready: pkg.attachment_plan?.attachment_ready === true,
      readiness_before: safeObject(pkg.readiness_before),
      readiness_after: readinessAfter,
      readiness_remains_held: readinessAfter.status === 'needs_more_evidence'
        || readinessAfter.gate_decision === 'hold_for_evidence_completion'
        || safeList(readinessAfter.missing_inputs).includes('inspection_evidence')
        || dryRun.promotion_status !== 'ready_for_future_promotion_dry_run',
      blockers: uniqueStrings([
        ...safeList(pkg.attachment_plan?.blockers),
        ...safeList(pkg.intake_action?.blockers),
        ...safeList(dryRun.blockers),
      ]),
    };
  });
}

function attachmentReadyCandidates(intakeReport = {}) {
  return safeList(intakeReport.accepted_candidates)
    .filter((candidate) => candidate.attachment_ready === true)
    .map((candidate) => ({
      path: candidate.path || null,
      source_kind: candidate.source_kind || null,
      source_format: candidate.source_format || null,
      matched_package: candidate.matched_package || null,
      match_confidence: candidate.match_confidence || null,
      fixture_or_test_source: normalizeRepoPath(candidate.path).startsWith('tests/fixtures/')
        || String(candidate.source_kind || '').includes('fixture'),
    }));
}

function collectBlockers(intakeReport = {}, promotionDryRunManifest = {}) {
  const blockers = uniqueStrings([
    ...safeList(promotionDryRunManifest.summary?.blockers),
    ...safeList(promotionDryRunManifest.packages).flatMap((pkg) => safeList(pkg.blockers)),
    ...safeList(intakeReport.packages).flatMap((pkg) => [
      ...safeList(pkg.attachment_plan?.blockers),
      ...safeList(pkg.intake_action?.blockers),
    ]),
  ]);
  if (intakeReport.summary?.genuine_inspection_evidence_found !== true) {
    blockers.push('no_genuine_completed_inspection_evidence');
  }
  if (promotionDryRunManifest.summary?.promotion_can_run !== true) {
    blockers.push('promotion_blocked_readiness_held');
    blockers.push('no_safe_promotion_command_available');
  }
  return uniqueStrings(blockers);
}

function nextSafeCommands({ includeGitHub, intakeReportPath, promotionDryRunManifestPath, outDir }) {
  const intakeCommand = [
    'fcad',
    'inspection-evidence-intake',
    '--out',
    intakeReportPath,
  ];
  if (includeGitHub) intakeCommand.push('--include-github');
  return [
    {
      name: 'stage5b_evidence_audit',
      command: [
        'fcad',
        'stage5b-evidence-audit',
        '--out-dir',
        outDir,
        ...(includeGitHub ? ['--include-github'] : []),
      ],
      mutates_canonical_artifacts: false,
      writes: [
        INTAKE_FILE_NAME,
        PROMOTION_DRY_RUN_FILE_NAME,
        AUDIT_MANIFEST_FILE_NAME,
        AUDIT_SUMMARY_FILE_NAME,
      ],
      purpose: 'rerun the complete non-mutating Stage 5B audit bundle',
    },
    {
      name: 'intake',
      command: intakeCommand,
      mutates_canonical_artifacts: false,
      writes: [INTAKE_FILE_NAME],
      purpose: 'refresh the evidence intake report only',
    },
    {
      name: 'promotion_dry_run',
      command: [
        'fcad',
        'inspection-evidence-promotion-dry-run',
        '--intake-report',
        intakeReportPath,
        '--out',
        promotionDryRunManifestPath,
      ],
      mutates_canonical_artifacts: false,
      writes: [PROMOTION_DRY_RUN_FILE_NAME],
      purpose: 'refresh the non-mutating promotion plan from the audit intake report',
    },
  ];
}

function readinessHeldTruth(intakeReport = {}, promotionDryRunManifest = {}) {
  const genuineFound = intakeReport.summary?.genuine_inspection_evidence_found === true;
  const promotionCanRun = promotionDryRunManifest.summary?.promotion_can_run === true;
  const statement = promotionCanRun
    ? 'A future promotion plan exists, but this audit did not attach evidence or change canonical readiness.'
    : 'No genuine completed inspection evidence is available for promotion; no promotion can run and readiness remains needs_more_evidence / hold_for_evidence_completion.';
  return {
    statement,
    no_genuine_completed_inspection_evidence_found: !genuineFound,
    no_promotion_can_run: !promotionCanRun,
    readiness_remains_held: !promotionCanRun,
    canonical_package_artifacts_mutated: false,
    requires_human_measurement_entry: false,
    current_repo_truth: !genuineFound
      ? 'Current audit found no genuine completed inspection evidence.'
      : 'Audit found candidate evidence; canonical readiness still requires a deliberate future promotion chain before any readiness claim changes.',
  };
}

export function buildStage5bEvidenceAuditManifest({
  projectRoot,
  outDir,
  intakeReport,
  intakeReportPath,
  promotionDryRunManifest,
  promotionDryRunManifestPath,
  auditManifestPath = null,
  auditSummaryPath = null,
  includeGitHub = false,
  generatedAt = null,
  intakeSha256 = null,
  promotionDryRunSha256 = null,
  auditSummarySha256 = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const outputDir = assertPathInsideProject(resolvedRoot, outDir || 'output/stage5b-evidence-audit', 'stage5b audit out-dir');
  const intakePath = intakeReportPath || join(outputDir.absolute, INTAKE_FILE_NAME);
  const dryRunPath = promotionDryRunManifestPath || join(outputDir.absolute, PROMOTION_DRY_RUN_FILE_NAME);
  const manifestPath = auditManifestPath || join(outputDir.absolute, AUDIT_MANIFEST_FILE_NAME);
  const summaryPath = auditSummaryPath || join(outputDir.absolute, AUDIT_SUMMARY_FILE_NAME);
  const intake = safeObject(intakeReport);
  const dryRun = safeObject(promotionDryRunManifest);
  const promotionCanRun = dryRun.summary?.promotion_can_run === true;
  const attachmentReady = attachmentReadyCandidates(intake);
  const blockers = collectBlockers(intake, dryRun);
  const readinessTruth = readinessHeldTruth(intake, dryRun);

  return {
    artifact_type: 'stage5b_evidence_audit_manifest',
    schema_version: AUDIT_SCHEMA_VERSION,
    generated_at: nowIso(generatedAt),
    dry_run: true,
    non_mutating: true,
    include_github: includeGitHub === true,
    outputs: {
      intake_report: outputRef(resolvedRoot, intakePath, 'inspection_evidence_intake_report', intakeSha256),
      promotion_dry_run_manifest: outputRef(resolvedRoot, dryRunPath, 'inspection_evidence_promotion_dry_run_manifest', promotionDryRunSha256),
      stage5b_audit_manifest: outputRef(resolvedRoot, manifestPath, 'stage5b_evidence_audit_manifest', null, {
        sha256_note: 'Self-referential hash omitted from manifest body.',
      }),
      stage5b_audit_summary: outputRef(resolvedRoot, summaryPath, 'stage5b_evidence_audit_summary_markdown', auditSummarySha256),
    },
    source_classes: sourceClasses(intake),
    github_summary: githubSummary(intake),
    attachment_ready: {
      count: attachmentReady.length,
      candidates: attachmentReady,
    },
    blockers,
    canonical_package_readiness_states: packageReadinessStates(intake, dryRun),
    evidence_boundary: {
      hard_evidence_rule: HARD_EVIDENCE_RULE,
      rejected_as_final_evidence: [...REJECTED_AS_FINAL_EVIDENCE],
      generated_artifacts_do_not_satisfy_inspection_evidence: true,
      github_metadata_alone_is_not_evidence: true,
      human_measurement_entry_requested: false,
    },
    next_safe_commands: nextSafeCommands({
      includeGitHub,
      intakeReportPath: repoRelativePath(resolvedRoot, intakePath),
      promotionDryRunManifestPath: repoRelativePath(resolvedRoot, dryRunPath),
      outDir: outputDir.relative,
    }),
    readiness_held_truth: readinessTruth,
    summary: {
      package_count: safeList(intake.packages).length,
      accepted_candidate_count: intake.summary?.accepted_candidate_count || 0,
      rejected_candidate_count: intake.summary?.rejected_candidate_count || 0,
      attachment_ready_candidate_count: intake.summary?.attachment_ready_candidate_count ?? attachmentReady.length,
      genuine_inspection_evidence_found: intake.summary?.genuine_inspection_evidence_found === true,
      promotion_can_run: promotionCanRun,
      readiness_remains_held: readinessTruth.readiness_remains_held,
      canonical_artifacts_mutated: false,
      requires_human_measurement_entry: false,
      audit_bundle_only: true,
      intake_report_path: repoRelativePath(resolvedRoot, intakePath),
      promotion_dry_run_manifest_path: repoRelativePath(resolvedRoot, dryRunPath),
    },
  };
}

function renderAuditSummaryMarkdown(manifest) {
  const lines = [
    '# Stage 5B Evidence Audit Summary',
    '',
    `Generated: ${manifest.generated_at}`,
    `Genuine completed evidence found: ${manifest.summary.genuine_inspection_evidence_found ? 'yes' : 'no'}`,
    `Promotion can run: ${manifest.summary.promotion_can_run ? 'yes' : 'no'}`,
    `Readiness remains held: ${manifest.summary.readiness_remains_held ? 'yes' : 'no'}`,
    `Attachment-ready candidates: ${manifest.summary.attachment_ready_candidate_count}`,
    `Rejected candidates: ${manifest.summary.rejected_candidate_count}`,
    '',
    '## Outputs',
    '',
    `- Intake report: ${manifest.outputs.intake_report.path}`,
    `- Promotion dry-run manifest: ${manifest.outputs.promotion_dry_run_manifest.path}`,
    `- Audit manifest: ${manifest.outputs.stage5b_audit_manifest.path}`,
    '',
    '## Evidence Boundary',
    '',
    manifest.evidence_boundary.hard_evidence_rule,
    '',
    '## Blockers',
    '',
    ...(manifest.blockers.length > 0 ? manifest.blockers.map((blocker) => `- ${blocker}`) : ['- none']),
    '',
    '## Canonical Package Readiness',
    '',
    ...manifest.canonical_package_readiness_states.map((pkg) => (
      `- ${pkg.slug}: ${pkg.readiness_after.status || 'unknown'} / ${pkg.readiness_after.gate_decision || 'unknown'} (${pkg.promotion_status})`
    )),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

export async function writeStage5bEvidenceAuditBundle({
  projectRoot,
  outDir,
  packageSlugs = undefined,
  includeGitHub = false,
  githubRepo = 'dooosp/freecad-automation',
  githubRunner = undefined,
  githubFetch = undefined,
  trackedPaths = null,
  generatedAt = null,
} = {}) {
  const resolvedRoot = resolve(projectRoot || process.cwd());
  const outputDir = assertPathInsideProject(resolvedRoot, outDir || 'output/stage5b-evidence-audit', 'stage5b audit out-dir');
  await mkdir(outputDir.absolute, { recursive: true });

  const generated = nowIso(generatedAt);
  const intakeReportPath = join(outputDir.absolute, INTAKE_FILE_NAME);
  const promotionDryRunManifestPath = join(outputDir.absolute, PROMOTION_DRY_RUN_FILE_NAME);
  const auditManifestPath = join(outputDir.absolute, AUDIT_MANIFEST_FILE_NAME);
  const auditSummaryPath = join(outputDir.absolute, AUDIT_SUMMARY_FILE_NAME);

  const intakeOptions = {
    projectRoot: resolvedRoot,
    packageSlugs,
    includeGitHub: includeGitHub === true,
    githubRepo,
    trackedPaths,
    generatedAt: generated,
  };
  if (githubRunner) intakeOptions.githubRunner = githubRunner;
  if (githubFetch) intakeOptions.githubFetch = githubFetch;

  const intakeReport = await discoverInspectionEvidenceIntake(intakeOptions);
  assertValidStage5bIntakeReport(intakeReport, {
    label: 'audit intake report',
    artifactPath: intakeReportPath,
    projectRoot: resolvedRoot,
  });
  await writeJsonFile(intakeReportPath, intakeReport);

  const promotionResult = await writeInspectionEvidencePromotionDryRunManifest({
    projectRoot: resolvedRoot,
    intakeReport,
    intakeReportPath,
    outputPath: promotionDryRunManifestPath,
    generatedAt: generated,
  });
  assertValidStage5bPromotionDryRunManifest(promotionResult.manifest, {
    label: 'audit promotion dry-run manifest',
    artifactPath: promotionDryRunManifestPath,
    projectRoot: resolvedRoot,
  });

  const intakeSha256 = await sha256IfReadable(intakeReportPath);
  const promotionDryRunSha256 = await sha256IfReadable(promotionDryRunManifestPath);
  let manifest = buildStage5bEvidenceAuditManifest({
    projectRoot: resolvedRoot,
    outDir: outputDir.absolute,
    intakeReport,
    intakeReportPath,
    promotionDryRunManifest: promotionResult.manifest,
    promotionDryRunManifestPath,
    auditManifestPath,
    auditSummaryPath,
    includeGitHub,
    generatedAt: generated,
    intakeSha256,
    promotionDryRunSha256,
  });
  const summaryMarkdown = renderAuditSummaryMarkdown(manifest);
  assertValidStage5bAuditSummaryMarkdown(summaryMarkdown, {
    label: 'audit summary markdown',
    artifactPath: auditSummaryPath,
    projectRoot: resolvedRoot,
  });
  await writeFile(auditSummaryPath, summaryMarkdown, 'utf8');
  const auditSummarySha256 = await sha256IfReadable(auditSummaryPath);
  manifest = {
    ...manifest,
    outputs: {
      ...manifest.outputs,
      stage5b_audit_summary: {
        ...manifest.outputs.stage5b_audit_summary,
        sha256: auditSummarySha256,
      },
    },
  };
  assertValidStage5bAuditManifest(manifest, {
    label: 'audit manifest',
    artifactPath: auditManifestPath,
    projectRoot: resolvedRoot,
  });
  await writeJsonFile(auditManifestPath, manifest);

  return {
    manifest,
    intake_report: intakeReport,
    promotion_dry_run_manifest: promotionResult.manifest,
    output_dir: outputDir.relative,
    absolute_output_dir: outputDir.absolute,
    paths: {
      intake_report: repoRelativePath(resolvedRoot, intakeReportPath),
      promotion_dry_run_manifest: repoRelativePath(resolvedRoot, promotionDryRunManifestPath),
      stage5b_audit_manifest: repoRelativePath(resolvedRoot, auditManifestPath),
      stage5b_audit_summary: repoRelativePath(resolvedRoot, auditSummaryPath),
    },
  };
}

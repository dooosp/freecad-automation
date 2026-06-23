import {
  buildStage5bValidationDiagnosticsPayload,
  isStage5bRuntimeValidationError,
} from '../../inspection-evidence-intake/stage5b-runtime-validation.js';

const STAGE5B_JOB_TYPES = new Set([
  'inspection-evidence-intake',
  'inspection-evidence-promotion-dry-run',
  'stage5b-evidence-audit',
]);

export function createStage5bHandlers() {
  return {
    'inspection-evidence-intake': async (job, context) => {
      const intakeResult = await context.executeInspectionEvidenceIntake(job);
      return {
        result: intakeResult.report,
        artifacts: {
          inspection_evidence_intake_report: intakeResult.reportPath,
        },
        manifestArtifacts: [{
          type: 'inspection-evidence.intake-report',
          path: intakeResult.reportPath,
          label: 'Stage 5B inspection evidence intake report',
          scope: 'user-facing',
          stability: 'stable',
          metadata: {
            artifact_type: 'inspection_evidence_intake_report',
            schema_version: intakeResult.report.schema_version || '1.0',
            accepted_candidate_count: intakeResult.report.summary?.accepted_candidate_count ?? null,
            rejected_candidate_count: intakeResult.report.summary?.rejected_candidate_count ?? null,
            genuine_inspection_evidence_found: intakeResult.report.summary?.genuine_inspection_evidence_found === true,
            readiness_truth: intakeResult.report.summary?.readiness_truth || null,
            execution_notes: [
              'inspection-evidence-intake reports are discovery/review artifacts only; they are not package inspection evidence.',
              'Report preview is limited to registered tracked job artifact routes.',
            ],
          },
        }],
      };
    },
    'inspection-evidence-promotion-dry-run': async (job, context) => {
      const dryRunResult = await context.executeInspectionEvidencePromotionDryRun(job);
      return {
        result: dryRunResult.manifest,
        artifacts: {
          inspection_evidence_promotion_dry_run_manifest: dryRunResult.manifestPath,
        },
        manifestArtifacts: [{
          type: 'inspection-evidence.promotion-dry-run-manifest',
          path: dryRunResult.manifestPath,
          label: 'Stage 5B inspection evidence promotion dry-run manifest',
          scope: 'user-facing',
          stability: 'stable',
          metadata: {
            artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
            schema_version: dryRunResult.manifest.schema_version || '1.0',
            promotion_can_run: dryRunResult.manifest.summary?.promotion_can_run === true,
            ready_package_count: dryRunResult.manifest.summary?.ready_package_count ?? null,
            blocked_package_count: dryRunResult.manifest.summary?.blocked_package_count ?? null,
            canonical_artifacts_mutated: false,
            readiness_expectation: dryRunResult.manifest.summary?.readiness_expectation || null,
            execution_notes: [
              'promotion dry-run manifests are planning/control artifacts only; they are not inspection evidence.',
              'Dry-run execution writes only the tracked job manifest artifact and does not mutate canonical packages.',
            ],
          },
        }],
      };
    },
    'stage5b-evidence-audit': async (job, context) => {
      const auditResult = await context.executeStage5bEvidenceAudit(job);
      const outputDir = auditResult.absolute_output_dir;
      const intakePath = context.joinPath(outputDir, 'intake_report.json');
      const dryRunPath = context.joinPath(outputDir, 'promotion_dry_run_manifest.json');
      const auditManifestPath = context.joinPath(outputDir, 'stage5b_audit_manifest.json');
      const auditSummaryPath = context.joinPath(outputDir, 'stage5b_audit_summary.md');

      return {
        result: auditResult.manifest,
        artifacts: {
          stage5b_audit_intake_report: intakePath,
          stage5b_audit_promotion_dry_run_manifest: dryRunPath,
          stage5b_audit_manifest: auditManifestPath,
          stage5b_audit_summary: auditSummaryPath,
        },
        manifestArtifacts: [
          {
            type: 'inspection-evidence.intake-report',
            path: intakePath,
            label: 'Stage 5B audit intake report',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'inspection_evidence_intake_report',
              schema_version: auditResult.intake_report.schema_version || '1.0',
              accepted_candidate_count: auditResult.intake_report.summary?.accepted_candidate_count ?? null,
              rejected_candidate_count: auditResult.intake_report.summary?.rejected_candidate_count ?? null,
              genuine_inspection_evidence_found: auditResult.intake_report.summary?.genuine_inspection_evidence_found === true,
              execution_notes: [
                'Audit intake reports are discovery/review artifacts only; they are not package inspection evidence.',
                'Report preview is limited to registered tracked job artifact routes.',
              ],
            },
          },
          {
            type: 'inspection-evidence.promotion-dry-run-manifest',
            path: dryRunPath,
            label: 'Stage 5B audit promotion dry-run manifest',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'inspection_evidence_promotion_dry_run_manifest',
              schema_version: auditResult.promotion_dry_run_manifest.schema_version || '1.0',
              promotion_can_run: auditResult.promotion_dry_run_manifest.summary?.promotion_can_run === true,
              canonical_artifacts_mutated: false,
              execution_notes: [
                'Audit promotion dry-run manifests are planning/control artifacts only; they are not inspection evidence.',
                'Dry-run execution writes only tracked job artifacts and does not mutate canonical packages.',
              ],
            },
          },
          {
            type: 'stage5b.evidence-audit-manifest',
            path: auditManifestPath,
            label: 'Stage 5B evidence audit manifest',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'stage5b_evidence_audit_manifest',
              schema_version: auditResult.manifest.schema_version || '1.0',
              genuine_inspection_evidence_found: auditResult.manifest.summary?.genuine_inspection_evidence_found === true,
              promotion_can_run: auditResult.manifest.summary?.promotion_can_run === true,
              attachment_ready_candidate_count: auditResult.manifest.summary?.attachment_ready_candidate_count ?? null,
              readiness_remains_held: auditResult.manifest.summary?.readiness_remains_held === true,
              canonical_artifacts_mutated: false,
              execution_notes: [
                'Stage 5B audit manifests are review/control artifacts only; they are not inspection evidence.',
                'Tracked audit execution does not attach evidence, regenerate readiness, or mutate canonical packages.',
              ],
            },
          },
          {
            type: 'stage5b.evidence-audit-summary',
            path: auditSummaryPath,
            label: 'Stage 5B evidence audit summary',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'stage5b_evidence_audit_summary_markdown',
              schema_version: auditResult.manifest.schema_version || '1.0',
              canonical_artifacts_mutated: false,
              execution_notes: [
                'Stage 5B audit summaries are markdown views of the tracked audit manifest.',
              ],
            },
          },
        ],
      };
    },
  };
}

export async function writeTrackedStage5bValidationDiagnostics(job, error, context, {
  artifacts,
  manifestArtifacts,
  diagnostics,
}) {
  if (!isStage5bRuntimeValidationError(error)) return diagnostics;
  if (!STAGE5B_JOB_TYPES.has(job.type)) {
    return diagnostics;
  }

  const payload = buildStage5bValidationDiagnosticsPayload(error, {
    projectRoot: context.projectRoot,
    command: job.type,
  });
  const diagnosticsPath = await context.jobStore.writeJobFile(
    job.id,
    'artifacts/validation_diagnostics.json',
    `${JSON.stringify(payload, null, 2)}\n`
  );
  artifacts.stage5b_validation_diagnostics = diagnosticsPath;
  manifestArtifacts.push({
    type: 'stage5b.validation-diagnostics',
    path: diagnosticsPath,
    label: 'Stage 5B validation diagnostics',
    scope: 'user-facing',
    stability: 'best-effort',
    metadata: {
      artifact_type: 'stage5b_validation_diagnostics',
      diagnostic_count: payload.diagnostic_count,
      validated_artifact_type: payload.artifact_type,
      validation_status: payload.validation_status,
      execution_notes: [
        'Validation diagnostics are sanitized failure metadata for review only; they are not inspection evidence.',
        'Diagnostics artifacts do not expose arbitrary local files and do not satisfy readiness evidence.',
      ],
    },
  });
  return {
    ...diagnostics,
    stage5b_validation_diagnostics: payload,
  };
}

export function createEvidenceReadinessHandlers() {
  return {
    'evidence-readiness-audit': async (job, context) => {
      const auditResult = await context.executeEvidenceReadinessAudit(job);
      return {
        result: auditResult.audit,
        artifacts: {
          evidence_readiness_audit: auditResult.auditPath,
          evidence_readiness_audit_summary: auditResult.summaryPath,
        },
        manifestArtifacts: [
          {
            type: 'evidence-readiness.audit-json',
            path: auditResult.auditPath,
            label: 'Evidence/readiness maintainer audit JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'evidence_readiness_audit',
              schema_version: auditResult.audit.schema_version || '1.0',
              decision: auditResult.audit.summary?.decision || 'unknown',
              package_count: auditResult.audit.summary?.package_count ?? null,
              held_package_count: auditResult.audit.summary?.held_package_count ?? null,
              trusted_evidence_record_count: auditResult.audit.summary?.trusted_evidence_record_count ?? null,
              generated_review_artifact_count: auditResult.audit.summary?.generated_review_artifact_count ?? null,
              canonical_artifacts_mutated: false,
              execution_notes: [
                'Evidence/readiness audits are read-only maintainer decision artifacts.',
                'Audit execution does not attach evidence, regenerate readiness, or publish releases.',
              ],
            },
          },
          {
            type: 'evidence-readiness.audit-summary',
            path: auditResult.summaryPath,
            label: 'Evidence/readiness maintainer audit summary',
            scope: 'user-facing',
            stability: 'stable',
            metadata: {
              artifact_type: 'evidence_readiness_audit_markdown',
              schema_version: auditResult.audit.schema_version || '1.0',
              canonical_artifacts_mutated: false,
              execution_notes: [
                'Markdown audit summaries are derived views of the tracked JSON audit.',
              ],
            },
          },
        ],
      };
    },
  };
}

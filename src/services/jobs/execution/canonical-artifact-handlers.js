export function createCanonicalArtifactHandlers() {
  return {
    'readiness-pack': async (job, context) => {
      const result = await context.executeReadinessPack(job);
      return {
        result,
        artifacts: {
          readiness_report: result.artifacts.json,
          readiness_markdown: result.artifacts.markdown,
        },
        manifestArtifacts: [
          {
            type: 'readiness-report.json',
            path: result.artifacts.json,
            label: 'Readiness report JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: context.buildAfArtifactContractFromDocument({
              jobType: 'readiness-pack',
              target: 'readiness_report',
              document: result.report,
              path: result.artifacts.json,
            }),
          },
          { type: 'readiness-report.markdown', path: result.artifacts.markdown, label: 'Readiness report Markdown', scope: 'user-facing', stability: 'stable' },
          { type: 'input.review-pack', path: result.reviewPackPath, label: 'Review pack JSON', scope: 'internal', stability: 'stable' },
          ...(result.processPlanPath ? [{ type: 'input.process-plan', path: result.processPlanPath, label: 'Process plan JSON', scope: 'internal', stability: 'stable' }] : []),
          ...(result.qualityRiskPath ? [{ type: 'input.quality-risk', path: result.qualityRiskPath, label: 'Quality risk JSON', scope: 'internal', stability: 'stable' }] : []),
        ],
      };
    },
    'stabilization-review': async (job, context) => {
      const result = await context.executeStabilizationReview(job);
      return {
        result,
        artifacts: {
          stabilization_review: result.outputPath,
        },
        manifestArtifacts: [
          {
            type: 'review.stabilization.json',
            path: result.outputPath,
            label: 'Stabilization review JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: context.buildGenericAfMetadata('stabilization-review', result.review, [
              'stabilization-review compares canonical readiness artifacts and preserves their lineage.',
            ]),
          },
          { type: 'input.readiness.baseline', path: result.baselinePath, label: 'Baseline readiness report JSON', scope: 'internal', stability: 'stable' },
          { type: 'input.readiness.candidate', path: result.candidatePath, label: 'Candidate readiness report JSON', scope: 'internal', stability: 'stable' },
        ],
      };
    },
    'generate-standard-docs': async (job, context) => {
      const result = await context.executeGenerateStandardDocs(job, context.resolvedConfig);
      return {
        result,
        artifacts: {
          out_dir: result.out_dir,
          docs_manifest: result.artifacts.manifest,
          ...(result.readiness_report_path ? { readiness_report: result.readiness_report_path } : {}),
        },
        manifestArtifacts: [
          ...Object.entries(result.artifacts).map(([filename, filePath]) => ({
            type: filename === 'manifest' ? 'standard-docs.summary' : `standard-docs.${filename}`,
            path: filePath,
            label: filename,
            scope: 'user-facing',
            stability: filename === 'manifest' ? 'best-effort' : 'stable',
            ...(filename === 'manifest'
              ? {
                  metadata: context.buildGenericAfMetadata('generate-standard-docs', result.manifest, [
                    'generate-standard-docs consumes canonical readiness input and emits document drafts plus a manifest.',
                  ]),
                }
              : {}),
          })),
          ...(result.readiness_report_path ? [{
            type: 'readiness-report.json',
            path: result.readiness_report_path,
            label: 'Canonical readiness report JSON',
            scope: 'internal',
            stability: 'stable',
            metadata: context.buildAfArtifactContractFromDocument({
              jobType: 'generate-standard-docs',
              target: 'readiness_report',
              document: result.report,
              path: result.readiness_report_path,
              strictReentry: true,
            }),
          }] : []),
        ],
      };
    },
    pack: async (job, context) => {
      const result = await context.executePack(job);
      return {
        result,
        artifacts: {
          release_bundle: result.bundle_zip_path,
          release_bundle_manifest: result.manifest_path,
          release_bundle_checksums: result.checksums_path,
          release_bundle_log: result.log_path,
        },
        manifestArtifacts: [
          {
            type: 'release-bundle.zip',
            path: result.bundle_zip_path,
            label: 'Release bundle ZIP',
            scope: 'user-facing',
            stability: 'stable',
            metadata: context.buildReleaseBundleMetadata({
              readinessReport: result.readinessReport,
              releaseBundleManifest: result.manifest,
            }),
          },
          {
            type: 'release-bundle.manifest.json',
            path: result.manifest_path,
            label: 'Release bundle manifest JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: context.buildReleaseBundleManifestMetadata({
              readinessReport: result.readinessReport,
              releaseBundleManifest: result.manifest,
            }),
          },
          { type: 'release-bundle.checksums', path: result.checksums_path, label: 'Release bundle checksums', scope: 'user-facing', stability: 'stable' },
          { type: 'release-bundle.log.json', path: result.log_path, label: 'Release bundle log JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'input.readiness-report', path: result.readinessPath, label: 'Canonical readiness report JSON', scope: 'internal', stability: 'stable' },
          ...(result.docsManifestPath ? [{ type: 'input.docs-manifest', path: result.docsManifestPath, label: 'Standard docs manifest JSON', scope: 'internal', stability: 'stable' }] : []),
        ],
      };
    },
  };
}

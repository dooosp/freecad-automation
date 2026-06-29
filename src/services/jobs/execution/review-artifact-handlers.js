export function createReviewArtifactHandlers() {
  return {
    'review-context': async (job, context) => {
      const result = await context.executeReviewContext(job);
      return {
        result,
        artifacts: {
          context: result.artifacts.context,
          engineering_context: result.artifacts.engineeringContext || result.artifacts.context,
          ingest_log: result.artifacts.ingestLog,
          import_diagnostics: result.artifacts.importDiagnostics,
          bootstrap_summary: result.artifacts.bootstrapSummary,
          bootstrap_warnings: result.artifacts.bootstrapWarnings,
          confidence_map: result.artifacts.confidenceMap,
          ...(result.artifacts.draftConfig ? { draft_config: result.artifacts.draftConfig } : {}),
          geometry: result.artifacts.geometry,
          hotspots: result.artifacts.hotspots,
          inspection_linkage: result.artifacts.inspectionLinkage,
          inspection_outliers: result.artifacts.inspectionOutliers,
          quality_linkage: result.artifacts.qualityLinkage,
          quality_hotspots: result.artifacts.qualityHotspots,
          review_priorities: result.artifacts.reviewPriorities,
          review_pack_json: result.artifacts.reviewPackJson,
          review_pack_markdown: result.artifacts.reviewPackMarkdown,
          review_pack_pdf: result.artifacts.reviewPackPdf,
          ...(result.artifacts.revisionComparison ? { revision_comparison: result.artifacts.revisionComparison } : {}),
        },
        manifestArtifacts: [
          { type: 'engineering_context.json', path: result.artifacts.engineeringContext || result.artifacts.context, label: 'Engineering context JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'ingest.log.json', path: result.artifacts.ingestLog, label: 'Ingest log JSON', scope: 'internal', stability: 'stable' },
          { type: 'import_diagnostics.json', path: result.artifacts.importDiagnostics, label: 'Import diagnostics JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'bootstrap_summary.json', path: result.artifacts.bootstrapSummary, label: 'Bootstrap summary JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'bootstrap_warnings.json', path: result.artifacts.bootstrapWarnings, label: 'Bootstrap warnings JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'confidence_map.json', path: result.artifacts.confidenceMap, label: 'Confidence map JSON', scope: 'user-facing', stability: 'stable' },
          ...(result.artifacts.draftConfig ? [{ type: 'config.bootstrap-draft', path: result.artifacts.draftConfig, label: 'Draft config TOML', scope: 'user-facing', stability: 'best-effort' }] : []),
          { type: 'geometry_intelligence.json', path: result.artifacts.geometry, label: 'Geometry intelligence JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'manufacturing_hotspots.json', path: result.artifacts.hotspots, label: 'Manufacturing hotspots JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'quality-link.inspection-linkage.json', path: result.artifacts.inspectionLinkage, label: 'Inspection linkage JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'quality-link.inspection-outliers.json', path: result.artifacts.inspectionOutliers, label: 'Inspection outliers JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'quality-link.quality-linkage.json', path: result.artifacts.qualityLinkage, label: 'Quality linkage JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'quality-link.quality-hotspots.json', path: result.artifacts.qualityHotspots, label: 'Quality hotspots JSON', scope: 'user-facing', stability: 'stable' },
          { type: 'quality-link.review-priorities.json', path: result.artifacts.reviewPriorities, label: 'Review priorities JSON', scope: 'user-facing', stability: 'stable' },
          {
            type: 'review-pack.json',
            path: result.artifacts.reviewPackJson,
            label: 'Review pack JSON',
            scope: 'user-facing',
            stability: 'stable',
            metadata: context.buildAfArtifactContractFromDocument({
              jobType: 'review-context',
              target: 'review_pack',
              document: result.reviewPackDocument,
              path: result.artifacts.reviewPackJson,
            }),
          },
          { type: 'review-pack.markdown', path: result.artifacts.reviewPackMarkdown, label: 'Review pack Markdown', scope: 'user-facing', stability: 'stable' },
          { type: 'review-pack.pdf', path: result.artifacts.reviewPackPdf, label: 'Review pack PDF', scope: 'user-facing', stability: 'stable' },
          ...(result.artifacts.revisionComparison ? [{
            type: 'revision-comparison.json',
            path: result.artifacts.revisionComparison,
            label: 'Revision comparison JSON',
            scope: 'user-facing',
            stability: 'stable',
          }] : []),
        ],
      };
    },
    'compare-rev': async (job, context) => {
      const result = await context.executeCompareRev(job);
      return {
        result,
        artifacts: {
          revision_comparison: result.outputPath,
        },
        manifestArtifacts: [{
          type: 'revision-comparison.json',
          path: result.outputPath,
          label: 'Revision comparison JSON',
          scope: 'user-facing',
          stability: 'stable',
          metadata: context.buildGenericAfMetadata('compare-rev', result.comparison, [
            'compare-rev compares canonical review-pack artifacts and preserves their lineage.',
          ]),
        }],
      };
    },
  };
}

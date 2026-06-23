import {
  collectCreateManifestArtifacts,
  collectDrawManifestArtifacts,
  collectReportManifestArtifacts,
  inferCreateArtifactPaths,
  inferDrawArtifactPaths,
  inferReportArtifactPaths,
} from '../../../shared/artifact-surface.js';

export function createRuntimeBackedHandlers() {
  return {
    create: async (job, context) => {
      const result = await context.executeCreate(job, context.resolvedConfig);
      return {
        result,
        artifacts: inferCreateArtifactPaths(result),
        manifestArtifacts: collectCreateManifestArtifacts(result),
      };
    },
    draw: async (job, context) => {
      const result = await context.executeDraw(job, context.resolvedConfig);
      return {
        result,
        artifacts: inferDrawArtifactPaths(result),
        manifestArtifacts: collectDrawManifestArtifacts(result),
      };
    },
    inspect: async (job, context) => {
      const result = await context.executeInspect(job, context.resolvedConfig);
      return {
        result,
        artifacts: {
          input_model: context.resolvedConfig.filePath,
        },
        manifestArtifacts: context.collectInspectManifestArtifacts(context.resolvedConfig),
      };
    },
    report: async (job, context) => {
      const result = await context.executeReport(job, context.resolvedConfig);
      return {
        result,
        artifacts: inferReportArtifactPaths(result),
        manifestArtifacts: collectReportManifestArtifacts(result),
      };
    },
  };
}

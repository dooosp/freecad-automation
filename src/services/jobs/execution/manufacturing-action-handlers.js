import { basename } from 'node:path';

export const MANUFACTURING_ACTION_TRACKED_ARTIFACTS = Object.freeze([
  Object.freeze({
    key: 'action_dictionary',
    filename: 'manufacturing_action_dictionary.json',
    type: 'manufacturing-action.dictionary.json',
    label: 'Manufacturing action dictionary JSON',
  }),
  Object.freeze({
    key: 'episode_annotation',
    filename: 'manufacturing_episode_annotation.json',
    type: 'manufacturing-action.episode-annotation.json',
    label: 'Manufacturing episode annotation JSON',
  }),
  Object.freeze({
    key: 'validation_report',
    filename: 'manufacturing_data_validation_report.json',
    type: 'manufacturing-action.validation-report.json',
    label: 'Manufacturing data validation report JSON',
  }),
  Object.freeze({
    key: 'dataset_manifest',
    filename: 'manufacturing_robotics_dataset_manifest.json',
    type: 'manufacturing-action.dataset-manifest.json',
    label: 'Manufacturing robotics dataset manifest JSON',
  }),
  Object.freeze({
    key: 'handoff_json',
    filename: 'design_manufacturing_quality_handoff.json',
    type: 'manufacturing-action.handoff.json',
    label: 'Design manufacturing quality handoff JSON',
  }),
  Object.freeze({
    key: 'handoff_markdown',
    filename: 'design_manufacturing_quality_handoff.md',
    type: 'manufacturing-action.handoff.markdown',
    label: 'Design manufacturing quality handoff Markdown',
  }),
  Object.freeze({
    key: 'artifact_manifest',
    filename: 'artifact-manifest.json',
    type: 'manufacturing-action.artifact-manifest.json',
    label: 'Manufacturing action artifact manifest JSON',
  }),
  Object.freeze({
    key: 'output_manifest',
    filename: 'output-manifest.json',
    type: 'manufacturing-action.output-manifest.json',
    label: 'Manufacturing action output manifest JSON',
  }),
]);

function assertExactTrackedOutputs(outputs) {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    throw new Error('Manufacturing action dataset did not return its fixed eight-file output set.');
  }

  const expectedKeys = MANUFACTURING_ACTION_TRACKED_ARTIFACTS.map((artifact) => artifact.key).sort();
  const actualKeys = Object.keys(outputs).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error('Manufacturing action dataset did not return its fixed eight-file output set.');
  }

  for (const artifact of MANUFACTURING_ACTION_TRACKED_ARTIFACTS) {
    const outputPath = outputs[artifact.key];
    if (typeof outputPath !== 'string' || basename(outputPath) !== artifact.filename) {
      throw new Error(`Manufacturing action dataset output ${artifact.key} is missing or misnamed.`);
    }
  }
}

export function createManufacturingActionHandlers() {
  return {
    'manufacturing-action-dataset': async (job, context) => {
      const execution = await context.executeManufacturingActionDataset(job);
      assertExactTrackedOutputs(execution?.outputs);

      return {
        result: execution.result,
        artifacts: { ...execution.outputs },
        manifestArtifacts: MANUFACTURING_ACTION_TRACKED_ARTIFACTS.map((artifact) => ({
          type: artifact.type,
          path: execution.outputs[artifact.key],
          label: artifact.label,
          scope: 'user-facing',
          stability: 'stable',
        })),
        ...(execution.diagnostics ? { diagnostics: execution.diagnostics } : {}),
      };
    },
  };
}

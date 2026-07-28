import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  buildRevisionLineage,
  buildRevisionLineageParentFromSnapshot,
  readAuthoritativeConfigSnapshot,
} from '../../lib/revision-lineage-contract.js';
import { createInspectionPlanFromPaths } from '../../src/services/inspection-plan/inspection-plan-service.js';

export const MANUFACTURING_DATASET_TEST_GENERATED_AT = '2026-07-28T00:00:00Z';

export async function createManufacturingActionDatasetFixture({
  projectRoot,
  generatedAt = MANUFACTURING_DATASET_TEST_GENERATED_AT,
} = {}) {
  const root = resolve(projectRoot);
  await mkdir(resolve(root, 'tmp/codex'), { recursive: true });
  const tempRoot = await mkdtemp(resolve(root, 'tmp/codex/manufacturing-action-dataset-test-'));
  const inputDirectory = join(tempRoot, 'proof-inputs');
  await mkdir(inputDirectory, { recursive: true });
  const portable = (path) => relative(root, path).replaceAll('\\', '/');

  const configPath = 'configs/examples/hinge_block.toml';
  const configSnapshot = await readAuthoritativeConfigSnapshot({ projectRoot: root, configPath });
  const configParent = buildRevisionLineageParentFromSnapshot({
    artifactType: 'config',
    role: 'authoritative_config',
    snapshot: configSnapshot,
  });
  const reviewPath = join(inputDirectory, 'review_pack.json');
  const inspectionPath = join(inputDirectory, 'inspection_plan.json');
  const reviewPack = {
    artifact_type: 'review_pack',
    package_slug: configSnapshot.identity.package_slug,
    part_id: configSnapshot.identity.part_id,
    revision: configSnapshot.identity.revision,
    part: {
      package_slug: configSnapshot.identity.package_slug,
      part_id: configSnapshot.identity.part_id,
      revision: configSnapshot.identity.revision,
    },
    revision_lineage: buildRevisionLineage({
      identity: configSnapshot.identity,
      parents: [configParent],
    }),
  };
  await writeFile(reviewPath, `${JSON.stringify(reviewPack, null, 2)}\n`, 'utf8');
  const inspectionPlan = await createInspectionPlanFromPaths({
    projectRoot: root,
    reviewPackPath: portable(reviewPath),
    configPath,
    scope: 'full',
    generatedAt,
    requireAuthoritativeLineage: true,
  });
  await writeFile(inspectionPath, `${JSON.stringify(inspectionPlan, null, 2)}\n`, 'utf8');

  const baseOptions = {
    projectRoot: root,
    configPath,
    reviewPackPath: portable(reviewPath),
    inspectionPlanPath: portable(inspectionPath),
    robotConfigPath: 'configs/examples/robot_arm_6axis.toml',
    taskPlanPath: 'configs/examples/manufacturing/hinge_block_robot_inspection_task_plan.json',
    generatedAt,
    proofLineage: true,
  };

  return {
    root,
    tempRoot,
    inputDirectory,
    reviewPath,
    inspectionPath,
    reviewPack,
    inspectionPlan,
    baseOptions,
    portable,
    outputOptions(name = 'dataset-output') {
      return { ...baseOptions, outDir: portable(join(tempRoot, name)) };
    },
    async writeJson(name, document) {
      const path = join(inputDirectory, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      return { path, locator: portable(path) };
    },
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

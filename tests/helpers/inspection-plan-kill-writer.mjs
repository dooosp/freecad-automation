import { resolve, join, relative } from 'node:path';
import { createInspectionPlanFromPaths, writeInspectionPlanOutputs } from '../../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '../..');
const directory = resolve(process.argv[2]);
const plan = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json'), scope: 'full', generatedAt: '2026-07-12T00:00:00Z' });
await writeInspectionPlanOutputs({
  projectRoot: ROOT,
  plan,
  outputPath: relative(ROOT, join(directory, 'inspection_plan.json')),
  checksheetPath: relative(ROOT, join(directory, 'inspection_checksheet.csv')),
  requestPath: relative(ROOT, join(directory, 'supplier_inspection_request.md')),
  resultTemplatePath: relative(ROOT, join(directory, 'inspection_result_template.csv')),
  publicationHooks: { afterCommit: ({ index }) => { if (index === 0) process.kill(process.pid, 'SIGKILL'); } },
});

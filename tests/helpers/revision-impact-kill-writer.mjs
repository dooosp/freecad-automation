import { resolve, join } from 'node:path';

import {
  createRevisionImpactReportFromPaths,
  preflightRevisionImpactArtifactTargets,
  writeRevisionImpactArtifacts,
} from '../../src/services/revision-impact/revision-impact-service.js';

const ROOT = resolve(import.meta.dirname, '../..');
const outputDirectory = resolve(process.argv[2]);
const interruptionPhase = process.argv[3] || 'commit';
const fixture = resolve(ROOT, 'tests/fixtures/revision-impact/unchanged-review-pack.json');
const { report } = await createRevisionImpactReportFromPaths({
  projectRoot: ROOT,
  baselineReviewPackPath: fixture,
  candidateReviewPackPath: fixture,
  generatedAt: '2026-07-11T00:00:00Z',
});
const plan = await preflightRevisionImpactArtifactTargets({
  projectRoot: ROOT,
  report,
  jsonPath: join(outputDirectory, 'revision_impact_report.json'),
  markdownPath: join(outputDirectory, 'revision_impact_report.md'),
  allowedOutputRoots: [outputDirectory],
  companionArtifacts: [{
    path: join(outputDirectory, 'revision_comparison.json'),
    extension: '.json',
    label: 'revision comparison JSON',
    content: 'interrupted legacy output\n',
  }],
});

await writeRevisionImpactArtifacts({
  preparedPlan: plan,
  ...(interruptionPhase === 'initial-journal'
    ? { __testHardExitBeforeInitialJournalRename: true }
    : { __testHardExitAfterCommitCount: 1 }),
});
process.exitCode = 97;

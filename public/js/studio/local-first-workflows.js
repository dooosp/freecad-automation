function normalizedJobs(recentJobs = {}) {
  return Array.isArray(recentJobs)
    ? recentJobs
    : (recentJobs.status === 'ready' && Array.isArray(recentJobs.items) ? recentJobs.items : []);
}

function hasJob(jobs, types) {
  return jobs.some((job) => types.has(String(job?.type || '').toLowerCase()));
}

export function deriveLocalFirstWorkflowGuidance(state = {}) {
  const jobs = normalizedJobs(state.data?.recentJobs || state.recentJobs || {});
  const connected = (state.connectionState || 'shell-only') === 'connected';
  const runtimeReady = state.data?.health?.available === true;
  const reviewAvailable = hasJob(jobs, new Set(['review-context', 'report', 'inspect']));
  const readinessAvailable = hasJob(jobs, new Set(['readiness-pack']));
  const packageAvailable = hasJob(jobs, new Set(['pack']));
  const compareAvailable = hasJob(jobs, new Set(['compare-rev']));
  const planAvailable = hasJob(jobs, new Set(['inspection-plan']));

  const reviewNext = !connected
    ? 'Start `fcad serve`, then refresh Studio before queueing tracked work.'
    : !reviewAvailable
      ? 'Create or import the design, then build a traceable review pack.'
      : !readinessAvailable
        ? 'Run readiness-pack from the intended review pack.'
        : !packageAvailable
          ? 'Review the readiness hold, then package only the existing decision trail.'
          : 'Reopen the latest tracked review or package and continue from its artifacts.';

  const compareNext = planAvailable
    ? 'Human engineering and quality review is next; do not release the plan automatically.'
    : compareAvailable
      ? 'Create a delta inspection plan from the revision impact.'
      : 'Select baseline and candidate review packs, then run compare-rev.';

  return [
    {
      id: 'review',
      kicker: 'Workflow 1',
      title: 'Create or Import & Review',
      startingArtifact: 'Config, STEP/FCStd, or an existing review artifact',
      currentArtifacts: [
        reviewAvailable ? 'Review pack available' : 'No review pack yet',
        readinessAvailable ? 'Readiness report available' : 'No readiness report yet',
        packageAvailable ? 'Package artifacts available' : 'No package artifacts yet',
      ].join(' · '),
      nextSafeAction: reviewNext,
      runtimeRequirement: runtimeReady
        ? 'FreeCAD runtime detected for create/draw; artifact-driven review remains available.'
        : 'FreeCAD is required for create/draw; artifact-driven review does not require it.',
      generatedOutputs: 'Model/drawing or import diagnostics, review pack, readiness report, package artifacts',
      safetyBoundary: 'Generated QA and readiness outputs are review artifacts, not inspection evidence.',
      action: reviewAvailable ? 'go-artifacts' : 'go-model',
      actionLabel: reviewAvailable ? 'Open tracked artifacts' : 'Open Model or import path',
      tone: reviewAvailable ? 'ok' : 'info',
    },
    {
      id: 'compare-plan',
      kicker: 'Workflow 2',
      title: 'Compare Revisions & Plan Inspection',
      startingArtifact: 'Baseline and candidate review packs',
      currentArtifacts: `${compareAvailable ? 'Revision impact available' : 'No revision impact yet'} · ${planAvailable ? 'Inspection plan available' : 'No inspection plan yet'}`,
      nextSafeAction: compareNext,
      runtimeRequirement: 'Artifact-driven; FreeCAD is not required when the review packs already exist.',
      generatedOutputs: 'Revision impact, reinspection requirements, inspection plan, checksheet, request, blank result template',
      safetyBoundary: 'A plan is control material, not evidence; ready_for_human_release requires external human review.',
      action: 'go-artifacts',
      actionLabel: 'Open compare and plan artifacts',
      tone: planAvailable ? 'warn' : compareAvailable ? 'ok' : 'info',
    },
    {
      id: 'receive-results',
      kicker: 'Workflow 3',
      title: 'Receive Results & Continue Onboarding',
      startingArtifact: 'Human-released plan, immutable release record, completed native CSV, and submission metadata',
      currentArtifacts: planAvailable
        ? 'Inspection plan available; release and result files remain CLI-managed.'
        : 'No tracked inspection plan is visible; raw result files remain CLI-managed.',
      nextSafeAction: 'Complete external human release, then run the CLI normalization handoff.',
      runtimeRequirement: 'Artifact-driven; FreeCAD is not required.',
      generatedOutputs: 'Immutable execution release record and untrusted normalization report',
      safetyBoundary: 'CLI-only raw bytes; no upload, evidence approval, attachment, readiness regeneration, or release publication.',
      command: 'fcad inspection-result-normalize --inspection-plan <inspection_plan.json> --plan-release-record <inspection_plan_release_record.json> --source <completed_result.csv> --submission-metadata <metadata.json> --adapter plan-result-csv-v1 --out <inspection_result_normalization.json>',
      action: planAvailable ? 'go-artifacts' : null,
      actionLabel: planAvailable ? 'Open registered plan artifacts' : null,
      tone: 'warn',
    },
  ];
}

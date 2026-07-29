import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildArtifactDetailItems,
  buildArtifactOpenLabel,
  buildArtifactViewer,
  parseArtifactPayload,
} from '../public/js/studio/artifact-insights.js';

const ROOT = resolve(import.meta.dirname, '..');

const reviewPack = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/d-artifacts/sample_review_pack.canonical.json'), 'utf8')
);
const readinessReport = JSON.parse(
  readFileSync(resolve(ROOT, 'tests/fixtures/c-artifacts/sample_readiness_report.canonical.json'), 'utf8')
);

const reviewArtifact = {
  id: 'review-pack',
  type: 'review-pack.json',
  file_name: 'review_pack.json',
  extension: '.json',
  contract: {
    reentry_target: 'review_pack',
    artifact_identity: {
      warnings: reviewPack.warnings,
      coverage: reviewPack.coverage,
      confidence: reviewPack.confidence,
      lineage: {
        part_id: reviewPack.part?.part_id || reviewPack.part_id,
        name: reviewPack.part?.name || null,
        revision: reviewPack.part?.revision || reviewPack.revision || null,
      },
      source_artifact_refs: reviewPack.source_artifact_refs,
    },
  },
};

const reviewViewer = buildArtifactViewer({
  artifact: reviewArtifact,
  parsedPayload: reviewPack,
});

assert.equal(buildArtifactOpenLabel(reviewArtifact), 'Open review pack');
assert.equal(reviewViewer.kind, 'review_pack');
assert.equal(reviewViewer.title, 'Review pack viewer');
assert.equal(reviewViewer.highlights.find((item) => item.label === 'Review priorities')?.value, String(reviewPack.review_priorities.length));
assert.equal(reviewViewer.sections.some((section) => section.title === 'Coverage and confidence'), true);
assert.equal(reviewViewer.sections.some((section) => section.title === 'Next actions in artifact'), true);

const readinessArtifact = {
  id: 'readiness-report',
  type: 'readiness-report.json',
  file_name: 'readiness_report.json',
  extension: '.json',
  contract: {
    reentry_target: 'readiness_report',
    artifact_identity: {
      warnings: readinessReport.warnings,
      coverage: readinessReport.coverage,
      confidence: readinessReport.confidence,
      lineage: {
        part_id: readinessReport.part?.part_id || null,
        name: readinessReport.part?.name || null,
        revision: readinessReport.part?.revision || null,
      },
      source_artifact_refs: readinessReport.source_artifact_refs,
    },
  },
};

const readinessViewer = buildArtifactViewer({
  artifact: readinessArtifact,
  parsedPayload: readinessReport,
});

assert.equal(buildArtifactOpenLabel(readinessArtifact), 'Open readiness report');
assert.equal(readinessViewer.kind, 'readiness_report');
assert.equal(readinessViewer.title, 'Readiness viewer');
assert.equal(readinessViewer.highlights.find((item) => item.label === 'Gate')?.value, readinessReport.readiness_summary.gate_decision);
assert.equal(readinessViewer.sections.some((section) => section.title === 'Decision summary'), true);
assert.equal(readinessViewer.sections.some((section) => section.title === 'Next actions in artifact'), true);

const truncatedJsonPreview = '{"artifact_type":"readiness_report","part":{}\n\n…truncated for the studio preview…';
assert.equal(
  parseArtifactPayload({
    content_type: 'application/json; charset=utf-8',
    extension: '.json',
  }, truncatedJsonPreview),
  null
);

const comparisonArtifact = {
  id: 'revision-comparison',
  type: 'revision-comparison.json',
  file_name: 'revision_comparison.json',
  extension: '.json',
  contract: {
    artifact_identity: {
      warnings: [],
      coverage: {
        source_artifact_count: 2,
        review_priority_count: 8,
      },
      confidence: {
        level: 'heuristic',
        score: 0.58,
      },
      lineage: {
        part_id: 'sample_part',
        name: 'sample_part',
        revision: 'B',
      },
      source_artifact_refs: [
        { artifact_type: 'review_pack', path: '/tmp/baseline.json', role: 'comparison_baseline' },
        { artifact_type: 'review_pack', path: '/tmp/candidate.json', role: 'comparison_candidate' },
      ],
    },
  },
};

const comparisonViewer = buildArtifactViewer({
  artifact: comparisonArtifact,
  parsedPayload: {
    comparison_type: 'evidence_driven_review_pack_diff',
    revision: {
      baseline: 'A',
      candidate: 'B',
    },
    new_hotspots: [{ category: 'wall_thickness' }],
    resolved_hotspots: [],
    shifted_hotspots: [{ category: 'inspection_access' }],
    confidence_changes: {
      delta: 0.12,
    },
    revision_story: [
      '1 new hotspot category surfaced in the candidate revision.',
    ],
  },
});

assert.equal(comparisonViewer.kind, 'revision_comparison');
assert.equal(comparisonViewer.title, 'Compare viewer');
assert.equal(comparisonViewer.sections.some((section) => section.title === 'Revision story'), true);

const revisionImpactArtifact = {
  id: 'revision-impact-report',
  type: 'revision-impact.report-json',
  file_name: 'revision_impact_report.json',
  extension: '.json',
};
const revisionImpactViewer = buildArtifactViewer({
  artifact: revisionImpactArtifact,
  parsedPayload: {
    artifact_type: 'revision_impact_report',
    schema_version: '1.0',
    generated_at: '2026-07-11T00:00:00Z',
    baseline: { package_slug: 'fixture-bracket', revision: 'A', artifact_refs: ['fixtures/baseline.json'], source_hashes: { review_pack: 'a'.repeat(64) } },
    candidate: { package_slug: 'fixture-bracket', revision: 'B', artifact_refs: ['fixtures/candidate.json'], source_hashes: { review_pack: 'b'.repeat(64) } },
    summary: {
      decision: 'reinspection_required',
      material_change_count: 1,
      review_required_count: 0,
      reinspection_required_count: 1,
      unable_to_determine_count: 0,
      readiness_review_required: true,
    },
    changes: [{
      change_type: 'tolerance_change',
      affected_entity_id: 'HOLE_LEFT_DIA',
      determinability: 'determined',
      rationale: 'The authoritative tolerance tightened.',
    }],
    evidence_applicability: {
      assessments: [{ applicability_status: 'reinspection_required' }],
      authoritative_evidence_state_changed: false,
    },
    reinspection_plan: {
      items: [{ affected_entity_id: 'HOLE_LEFT_DIA', reason: 'Repeat the authoritative characteristic measurement.' }],
    },
    boundaries: {
      inspection_evidence_attached: false,
      existing_evidence_mutated: false,
      evidence_superseded: false,
      readiness_regenerated: false,
    },
  },
});

assert.equal(buildArtifactOpenLabel(revisionImpactArtifact), 'Open revision impact');
assert.equal(revisionImpactViewer.kind, 'revision_impact_report');
assert.equal(revisionImpactViewer.title, 'Revision impact viewer');
assert.equal(revisionImpactViewer.sections.some((section) => section.title === 'Reinspection requirements'), true);
assert.equal(revisionImpactViewer.sections.some((section) => section.title === 'Unresolved mappings'), true);
assert.equal(revisionImpactViewer.sections.some((section) => section.title === 'Dimensions, tolerances, drawing and specification impacts'), true);
assert.equal(revisionImpactViewer.sections.some((section) => section.title === 'Affected inspection characteristics'), true);
assert.equal(
  revisionImpactViewer.sections.find((section) => section.title === 'Source hashes and provenance')?.entries.includes(`Baseline review_pack • ${'a'.repeat(64)}`),
  true
);
assert.equal(
  revisionImpactViewer.sections.find((section) => section.title === 'Non-mutation boundaries')?.entries.includes('No inspection evidence was attached.'),
  true
);

const stabilizationArtifact = {
  id: 'stabilization-review',
  type: 'review.stabilization.json',
  file_name: 'stabilization_review.json',
  extension: '.json',
  contract: {
    artifact_identity: {
      warnings: [],
      coverage: {
        source_artifact_count: 2,
        missing_input_count: 0,
      },
      confidence: {
        level: 'heuristic',
        score: 0.76,
      },
      lineage: {
        part_id: 'sample_part',
        name: 'sample_part',
        revision: 'B',
      },
      source_artifact_refs: [
        { artifact_type: 'readiness_report', path: '/tmp/baseline.json', role: 'input' },
        { artifact_type: 'readiness_report', path: '/tmp/candidate.json', role: 'input' },
      ],
    },
  },
};

const stabilizationViewer = buildArtifactViewer({
  artifact: stabilizationArtifact,
  parsedPayload: {
    summary: {
      runtime_basis: 'runtime_informed',
      top_bottlenecks: ['ST30 forming'],
    },
    baseline: { revision: 'A' },
    candidate: { revision: 'B' },
    readiness_deltas: {
      score_delta: 4,
      warning_delta: -1,
      missing_input_delta: 0,
    },
    change_reasons: [
      { reason: 'Cycle time instability improved at ST30.' },
    ],
    recommended_action_changes: {
      added: ['Rebalance launch staffing'],
      removed: [],
      changed: [],
    },
  },
});

assert.equal(stabilizationViewer.kind, 'stabilization_review');
assert.equal(stabilizationViewer.title, 'Stabilization viewer');
assert.equal(stabilizationViewer.sections.some((section) => section.title === 'Change reasons'), true);

const bundleManifestArtifact = {
  id: 'bundle-manifest',
  type: 'release-bundle.manifest.json',
  file_name: 'release_bundle_manifest.json',
  extension: '.json',
  contract: {
    artifact_identity: {
      warnings: [],
      coverage: {
        source_artifact_count: 2,
      },
      confidence: {
        level: 'heuristic',
        score: 0.76,
      },
      lineage: {
        part_id: 'sample_part',
        name: 'sample_part',
        revision: 'B',
      },
      source_artifact_refs: [
        { artifact_type: 'readiness_report', path: '/tmp/readiness_report.json', role: 'input' },
      ],
    },
  },
};

const bundleArtifact = {
  id: 'release-bundle',
  type: 'release-bundle.zip',
  file_name: 'release_bundle.zip',
  extension: '.zip',
  contract: {
    reentry_target: 'release_bundle',
    artifact_identity: bundleManifestArtifact.contract.artifact_identity,
  },
};

const bundleViewer = buildArtifactViewer({
  artifact: bundleArtifact,
  relatedArtifacts: [bundleManifestArtifact],
  relatedPayloads: {
    [bundleManifestArtifact.id]: {
      included_artifacts: [
        { path: 'canonical/readiness_report.json' },
        { path: 'canonical/review_pack.json' },
        { path: 'docs/standard_docs_manifest.json' },
      ],
      release_notes: [
        'Canonical readiness_report.json remains the source of truth for release packaging.',
      ],
      warnings: [],
      coverage: {
        source_artifact_count: 2,
      },
      confidence: {
        level: 'heuristic',
        score: 0.76,
      },
      source_artifact_refs: [
        { artifact_type: 'readiness_report', path: '/tmp/readiness_report.json', role: 'input' },
      ],
      part: {
        part_id: 'sample_part',
        name: 'sample_part',
        revision: 'B',
      },
    },
  },
});

assert.equal(buildArtifactOpenLabel(bundleArtifact), 'Open release bundle');
assert.equal(bundleViewer.kind, 'release_bundle');
assert.equal(bundleViewer.title, 'Bundle viewer');
assert.equal(bundleViewer.highlights.find((item) => item.label === 'Canonical entries')?.value, '2');
assert.equal(bundleViewer.sections.some((section) => section.title === 'Bundle contents'), true);

const af5ArtifactSurface = [
  {
    id: 'review-pack',
    type: 'review-pack.json',
    file_name: 'review_pack.json',
    extension: '.json',
    openLabel: 'Open review pack',
    reentryTarget: 'review_pack',
  },
  {
    id: 'readiness-report',
    type: 'readiness-report.json',
    file_name: 'readiness_report.json',
    extension: '.json',
    openLabel: 'Open readiness report',
    reentryTarget: 'readiness_report',
  },
  {
    id: 'standard-docs-manifest',
    type: 'standard-docs.summary',
    file_name: 'standard_docs_manifest.json',
    extension: '.json',
    openLabel: 'Open',
    reentryTarget: null,
  },
  {
    id: 'release-bundle-manifest',
    type: 'release-bundle.manifest.json',
    file_name: 'release_bundle_manifest.json',
    extension: '.json',
    openLabel: 'Open bundle manifest',
    reentryTarget: null,
  },
  {
    id: 'release-bundle',
    type: 'release-bundle.zip',
    file_name: 'release_bundle.zip',
    extension: '.zip',
    openLabel: 'Open release bundle',
    reentryTarget: 'release_bundle',
  },
].map((artifact) => ({
  ...artifact,
  key: artifact.id,
  exists: true,
  size_bytes: 4096,
  content_type: artifact.extension === '.zip' ? 'application/zip' : 'application/json',
  scope: 'user-facing',
  stability: 'stable',
  capabilities: {
    can_open: artifact.extension !== '.zip',
    can_download: true,
    browser_safe: artifact.extension !== '.zip',
  },
  links: {
    open: `/artifacts/job-af5/${artifact.id}`,
    download: `/artifacts/job-af5/${artifact.id}/download`,
  },
  contract: artifact.reentryTarget
    ? {
        reentry_target: artifact.reentryTarget,
        canonical_file_name: artifact.file_name,
      }
    : null,
}));

assert.deepEqual(af5ArtifactSurface.map((artifact) => artifact.file_name), [
  'review_pack.json',
  'readiness_report.json',
  'standard_docs_manifest.json',
  'release_bundle_manifest.json',
  'release_bundle.zip',
]);
for (const artifact of af5ArtifactSurface) {
  assert.equal(buildArtifactOpenLabel(artifact), artifact.openLabel);
  const detailMap = Object.fromEntries(
    buildArtifactDetailItems(artifact, { summary: { request: { source_label: 'Tracked AF5 job' } } })
      .map((item) => [item.label, item])
  );
  assert.equal(detailMap['File name'].value, artifact.file_name);
  assert.equal(detailMap['Open route'].value, artifact.extension === '.zip' ? 'Unavailable' : 'Available');
  assert.equal(detailMap['Download route'].value, 'Available');
  assert.equal(JSON.stringify(detailMap).includes('/artifacts/job-af5'), false);
  if (artifact.reentryTarget) {
    assert.equal(detailMap['Re-entry target'].value, artifact.reentryTarget);
  }
}

const manufacturingArtifactSurface = [
  ['action-dictionary', 'manufacturing-action.dictionary.json', 'manufacturing_action_dictionary.json'],
  ['episode-annotation', 'manufacturing-action.episode-annotation.json', 'manufacturing_episode_annotation.json'],
  ['validation-report', 'manufacturing-action.validation-report.json', 'manufacturing_data_validation_report.json'],
  ['dataset-manifest', 'manufacturing-action.dataset-manifest.json', 'manufacturing_robotics_dataset_manifest.json'],
  ['handoff-json', 'manufacturing-action.handoff.json', 'design_manufacturing_quality_handoff.json'],
  ['handoff-markdown', 'manufacturing-action.handoff.markdown', 'design_manufacturing_quality_handoff.md'],
  ['artifact-manifest', 'manufacturing-action.artifact-manifest.json', 'artifact-manifest.json'],
  ['output-manifest', 'manufacturing-action.output-manifest.json', 'output-manifest.json'],
].map(([id, type, fileName]) => ({
  id,
  type,
  file_name: fileName,
  extension: fileName.endsWith('.json') ? '.json' : '.md',
  exists: true,
}));
const manufacturingIdentity = {
  package_slug: 'hinge-block',
  part_id: 'hinge_block',
  revision: 'A',
  config_sha256: 'a'.repeat(64),
};
const manufacturingSources = [
  ['authoritative_config', 'config.toml', '/Users/private/authoritative-config.toml'],
  ['review_pack', 'review_pack', '../outside/review_pack.json'],
  ['inspection_plan', 'inspection_plan', 'run/inspection_plan.json'],
  ['robot_config', 'robot_config', 'configs/robot.toml'],
  ['manufacturing_task_plan', 'manufacturing_task_plan', 'configs/task-plan.json'],
].map(([role, artifactType, path], index) => ({
  role,
  artifact_type: artifactType,
  path,
  sha256: String(index + 1).repeat(64),
  size_bytes: 100 + index,
}));
const manufacturingBoundaries = {
  synthetic_demo: true,
  real_shop_floor_data: false,
  automatic_video_segmentation: false,
  computer_vision_model_used: false,
  lerobot_compatible: false,
  training_ready: false,
  inspection_evidence: false,
  evidence_attached: false,
  readiness_regenerated: false,
  product_release: false,
  production_readiness: false,
  human_review_required: true,
};
const manufacturingDatasetArtifact = manufacturingArtifactSurface.find((artifact) => artifact.id === 'dataset-manifest');
const manufacturingViewer = buildArtifactViewer({
  artifact: manufacturingDatasetArtifact,
  parsedPayload: {
    artifact_type: 'manufacturing_robotics_dataset_manifest',
    identity: manufacturingIdentity,
    revision_lineage: {
      schema_version: '1.0',
      mode: 'proof',
      identity: manufacturingIdentity,
      parents: manufacturingSources,
    },
    source_snapshots: manufacturingSources,
    boundaries: manufacturingBoundaries,
    members: [
      { role: 'manufacturing_task_plan' },
      { role: 'action_dictionary' },
      { role: 'episode_annotation' },
    ],
  },
  relatedArtifacts: manufacturingArtifactSurface,
});

assert.equal(manufacturingViewer.kind, 'manufacturing_robotics');
assert.equal(manufacturingViewer.title, 'Manufacturing robotics trust viewer');
assert.match(manufacturingViewer.summary, /does not establish inspection evidence/i);
assert.equal(
  manufacturingViewer.sections.find((section) => section.title === 'Identity')
    ?.items.find((item) => item.label === 'Part ID')?.value,
  'hinge_block'
);
assert.equal(
  manufacturingViewer.sections.find((section) => section.title === 'Revision lineage')?.entries.length,
  5
);
assert.equal(
  manufacturingViewer.sections.find((section) => section.title === 'Source snapshots')?.entries.length,
  5
);
const manufacturingCounts = Object.fromEntries(
  manufacturingViewer.sections.find((section) => section.title === 'Manifest count guide')
    .items.map((item) => [item.label, item])
);
assert.equal(manufacturingCounts['Dataset members'].value, '3');
assert.equal(manufacturingCounts['Domain files'].value, '6');
assert.equal(manufacturingCounts['Declared outputs'].value, '7');
assert.equal(manufacturingCounts['Registered result files'].value, '8');
assert.match(manufacturingCounts['Dataset members'].note, /task plan, action dictionary, and episode annotation/);
assert.match(manufacturingCounts['Domain files'].note, /artifact-manifest\.json/);
assert.match(manufacturingCounts['Declared outputs'].note, /does not list itself/);
assert.match(manufacturingCounts['Registered result files'].note, /output-manifest\.json registered/);
const manufacturingTrustCopy = manufacturingViewer.sections
  .find((section) => section.title === 'Trust boundaries').entries.join(' ');
assert.match(manufacturingTrustCopy, /No inspection evidence is attached or created/);
assert.match(manufacturingTrustCopy, /No engineering or quality approval is granted/);
assert.match(manufacturingTrustCopy, /does not establish production readiness/);
assert.match(manufacturingTrustCopy, /No product release is performed or authorized/);
assert.match(manufacturingTrustCopy, /Not LeRobot-compatible or training-ready/);
const serializedManufacturingViewer = JSON.stringify(manufacturingViewer);
assert.equal(serializedManufacturingViewer.includes('/Users/private/authoritative-config.toml'), false);
assert.equal(serializedManufacturingViewer.includes('../outside/review_pack.json'), false);
assert.equal(serializedManufacturingViewer.includes('run/inspection_plan.json'), false);

const manufacturingArtifactManifestViewer = buildArtifactViewer({
  artifact: manufacturingArtifactSurface.find((artifact) => artifact.id === 'artifact-manifest'),
  parsedPayload: {
    command: 'manufacturing-action-dataset',
    revision_lineage: {
      schema_version: '1.0',
      mode: 'proof',
      identity: manufacturingIdentity,
      parents: manufacturingSources,
    },
    details: { boundaries: manufacturingBoundaries },
    artifacts: Array.from({ length: 6 }, (_, index) => ({ path: `run/domain-${index}.json` })),
  },
  relatedArtifacts: manufacturingArtifactSurface,
});
assert.equal(manufacturingArtifactManifestViewer.kind, 'manufacturing_robotics');
assert.equal(
  manufacturingArtifactManifestViewer.sections.find((section) => section.title === 'Manifest count guide')
    .items.find((item) => item.label === 'Domain files')?.value,
  '6'
);

const unrelatedOutputManifestViewer = buildArtifactViewer({
  artifact: {
    id: 'generic-output-manifest',
    type: 'output.manifest',
    file_name: 'output-manifest.json',
    extension: '.json',
  },
  parsedPayload: {
    command: 'create',
    outputs: [],
  },
});
assert.equal(unrelatedOutputManifestViewer.kind, 'generic');

console.log('studio-artifact-viewers.test.js: ok');

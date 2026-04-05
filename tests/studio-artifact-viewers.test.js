import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildArtifactOpenLabel,
  buildArtifactViewer,
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

console.log('studio-artifact-viewers.test.js: ok');

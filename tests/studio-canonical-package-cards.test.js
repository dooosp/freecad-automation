import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CANONICAL_PACKAGES_ENDPOINT,
  buildCanonicalPackageSectionModel,
  normalizeCanonicalPackagesPayload,
} from '../public/js/studio/canonical-packages.js';
import { translateText } from '../public/js/i18n/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const shellCoreSource = readFileSync(resolve(ROOT, 'public/js/studio/studio-shell-core.js'), 'utf8');
const canonicalPackagesSource = readFileSync(resolve(ROOT, 'public/js/studio/canonical-packages.js'), 'utf8');
const workspaceSource = readFileSync(resolve(ROOT, 'public/js/studio/workspaces.js'), 'utf8');
const examplesSource = readFileSync(resolve(ROOT, 'public/js/studio/examples.js'), 'utf8');
const canonicalRefsRendererSource = workspaceSource.slice(
  workspaceSource.indexOf('function createCanonicalArtifactRefsList'),
  workspaceSource.indexOf('function createCanonicalPackageCards')
);

function makePackage(slug) {
  return {
    slug,
    name: `${slug} package`,
    package_path: `docs/examples/${slug}`,
    readme_path: `docs/examples/${slug}/README.md`,
    readiness: {
      status: 'needs_more_evidence',
      score: 64,
      gate_decision: 'hold_for_evidence_completion',
      missing_inputs: ['inspection_evidence'],
      inspection_evidence_missing: true,
      source_of_truth_path: `docs/examples/${slug}/readiness/readiness_report.json`,
    },
    artifacts: {
      review_pack_path: `docs/examples/${slug}/review/review_pack.json`,
      readiness_report_path: `docs/examples/${slug}/readiness/readiness_report.json`,
      standard_docs_manifest_path: `docs/examples/${slug}/standard-docs/standard_docs_manifest.json`,
      release_manifest_path: `docs/examples/${slug}/release/release_bundle_manifest.json`,
      release_checksums_path: `docs/examples/${slug}/release/release_bundle_checksums.sha256`,
      release_bundle_path: `docs/examples/${slug}/release/release_bundle.zip`,
      reopen_notes_path: `docs/examples/${slug}/reopen-notes.md`,
    },
    evidence_boundary: {
      release_bundle_presence_does_not_mean_production_ready:
        'Release bundle presence does not mean production-ready; readiness remains gated by the canonical readiness report.',
      quality_drawing_evidence_does_not_satisfy_inspection_evidence:
        'Quality and drawing evidence does not satisfy inspection_evidence without genuine completed inspection evidence.',
      packages_remain_needs_more_evidence_until_real_inspection_evidence_is_attached:
        'Canonical packages remain needs_more_evidence until real inspection_evidence is attached through the canonical flow.',
    },
    studio_boundary: {
      checked_in_canonical_packages_are_read_only_docs_packages:
        'Checked-in canonical packages are read-only docs packages for discovery.',
      tracked_job_artifact_reopen_remains_separate:
        'Studio tracked job/artifact reopen remains separate from checked-in canonical docs package discovery.',
    },
    collection_guide_path: `docs/inspection-evidence-collection/${slug}.md`,
    inspection_evidence_path: null,
  };
}

const payload = {
  ok: true,
  packages: [
    makePackage('quality-pass-bracket'),
    makePackage('plate-with-holes'),
    makePackage('motor-mount'),
    makePackage('controller-housing-eol'),
  ],
};

const state = normalizeCanonicalPackagesPayload(payload);
const sectionModel = buildCanonicalPackageSectionModel(state);
const serialized = JSON.stringify(sectionModel);

assert.equal(CANONICAL_PACKAGES_ENDPOINT, '/api/canonical-packages');
assert.match(canonicalPackagesSource, /\/api\/canonical-packages/);
assert.match(shellCoreSource, /loadCanonicalPackages/);
assert.match(shellCoreSource, /loadExamples/);
assert.match(shellCoreSource, /copy-canonical-artifact-path/);
assert.match(shellCoreSource, /navigatorRef\?\.clipboard\?\.writeText/);
assert.match(workspaceSource, /createCanonicalPackageCards/);
assert.match(canonicalRefsRendererSource, /copy-canonical-artifact-path/);
assert.match(canonicalRefsRendererSource, /canonicalArtifactPath/);
assert.match(canonicalRefsRendererSource, /Copy repo path/);
assert.doesNotMatch(canonicalRefsRendererSource, /href/);
assert.doesNotMatch(canonicalRefsRendererSource, /download/);
assert.doesNotMatch(canonicalRefsRendererSource, /\/artifacts\//);
assert.doesNotMatch(canonicalRefsRendererSource, /run-artifact/);
assert.doesNotMatch(canonicalRefsRendererSource, /input/i);
assert.match(examplesSource, /quality_pass_bracket/);
assert.doesNotMatch(examplesSource, /canonical-packages/);
assert.equal(translateText('Copy repo path', 'ko'), '저장소 경로 복사');
assert.equal(translateText('Copied', 'ko'), '복사됨');
assert.equal(translateText('Copy failed', 'ko'), '복사 실패');

assert.equal(state.status, 'ready');
assert.equal(sectionModel.title, 'Canonical CAD packages');
assert.equal(sectionModel.cards.length, 4);
assert.equal(sectionModel.boundaryNotes.some((note) => /read-only docs packages/i.test(note)), true);
assert.equal(sectionModel.boundaryNotes.some((note) => /tracked job\/artifact reopen remains separate/i.test(note)), true);
assert.equal(sectionModel.boundaryNotes.some((note) => /release bundle presence does not mean production-ready/i.test(note)), true);
assert.equal(sectionModel.boundaryNotes.some((note) => /quality and drawing evidence does not satisfy inspection_evidence/i.test(note)), true);

for (const card of sectionModel.cards) {
  assert.equal(card.readiness.status, 'needs_more_evidence');
  assert.equal(card.readiness.gateDecision, 'hold_for_evidence_completion');
  assert.equal(card.readiness.missingInspectionEvidence, true);
  assert.match(card.callout, /inspection_evidence/);
  assert.match(card.callout, /needs_more_evidence/);
  assert.match(card.sourceOfTruthPath, /^docs\/examples\/.+\/readiness\/readiness_report\.json$/);
  assert.equal(card.actions.length, 0);
  assert.equal(card.artifactRefs.every((ref) => /^docs\//.test(ref.path)), true);
  assert.equal(card.artifactRefs.every((ref) => ref.copyAction?.label === 'Copy repo path'), true);
  assert.equal(card.artifactRefs.every((ref) => ref.copyAction?.copiedLabel === 'Copied'), true);
  assert.equal(card.artifactRefs.every((ref) => ref.copyAction?.failedLabel === 'Copy failed'), true);
  assert.equal(card.artifactRefs.every((ref) => typeof ref.key === 'string' && ref.key.endsWith('_path')), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'review_pack'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'readiness_report'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'standard-docs manifest'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'release manifest'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'checksums'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'release bundle'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'reopen notes'), true);
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'release bundle')?.note || '',
    /Release bundle presence does not mean production-ready/
  );
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'release bundle')?.note || '',
    /needs_more_evidence/
  );
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'release bundle')?.note || '',
    /inspection_evidence/
  );
}

assert.equal(serialized.includes('/Users/'), false);
assert.equal(serialized.includes('href'), false);
assert.equal(serialized.includes('download'), false);
assert.equal(serialized.includes('data-action'), false);
assert.equal(serialized.includes('/artifacts/'), false);

console.log('studio-canonical-package-cards.test.js: ok');

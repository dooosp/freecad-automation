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
const canonicalPreviewPanelSource = workspaceSource.slice(
  workspaceSource.indexOf('function createCanonicalArtifactPreviewPanel'),
  workspaceSource.indexOf('function createCanonicalPackageCards')
);
const canonicalPreviewHandlerSource = shellCoreSource.slice(
  shellCoreSource.indexOf("if (action === 'preview-canonical-artifact')"),
  shellCoreSource.indexOf("if (action === 'copy-canonical-artifact-path')")
);

function makePackage(slug) {
  const artifacts = {
    review_pack_path: `docs/examples/${slug}/review/review_pack.json`,
    readiness_report_path: `docs/examples/${slug}/readiness/readiness_report.json`,
    standard_docs_manifest_path: `docs/examples/${slug}/standard-docs/standard_docs_manifest.json`,
    release_manifest_path: `docs/examples/${slug}/release/release_bundle_manifest.json`,
    release_checksums_path: `docs/examples/${slug}/release/release_bundle_checksums.sha256`,
    release_bundle_path: `docs/examples/${slug}/release/release_bundle.zip`,
    reopen_notes_path: `docs/examples/${slug}/reopen-notes.md`,
  };
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
    artifacts,
    artifact_catalog: [
      {
        key: 'readme',
        label: 'README',
        path_field: 'readme_path',
        path: `docs/examples/${slug}/README.md`,
        content_kind: 'markdown',
        text_preview_allowed: true,
        download_allowed: false,
        warning_required: false,
        warning: null,
        path_must_be_repo_relative: true,
        optional: false,
        available: true,
        production_ready: null,
      },
      ...[
        ['review_pack', 'Review pack', 'review_pack_path', 'json', true],
        ['readiness_report', 'Readiness report', 'readiness_report_path', 'json', true],
        ['standard_docs_manifest', 'Standard docs manifest', 'standard_docs_manifest_path', 'manifest', true],
        ['release_manifest', 'Release manifest', 'release_manifest_path', 'manifest', true],
        ['release_checksums', 'Release checksums', 'release_checksums_path', 'checksum', true],
        ['release_bundle', 'Release bundle', 'release_bundle_path', 'zip', false],
        ['reopen_notes', 'Reopen notes', 'reopen_notes_path', 'markdown', true],
      ].map(([key, label, pathField, contentKind, textPreviewAllowed]) => ({
        key,
        label,
        path_field: pathField,
        path: artifacts[pathField],
        content_kind: contentKind,
        text_preview_allowed: textPreviewAllowed,
        download_allowed: false,
        warning_required: key === 'release_bundle',
        warning: key === 'release_bundle'
          ? 'Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.'
          : null,
        path_must_be_repo_relative: true,
        optional: false,
        available: true,
        production_ready: key === 'release_bundle' ? false : null,
      })),
      {
        key: 'collection_guide',
        label: 'Inspection evidence collection guide',
        path_field: 'collection_guide_path',
        path: `docs/inspection-evidence-collection/${slug}.md`,
        content_kind: 'markdown',
        text_preview_allowed: true,
        download_allowed: false,
        warning_required: false,
        warning: null,
        path_must_be_repo_relative: true,
        optional: true,
        available: true,
        production_ready: null,
      },
    ],
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
assert.match(shellCoreSource, /preview-canonical-artifact/);
assert.match(canonicalPreviewHandlerSource, /buildCanonicalArtifactPreviewRoute\(slug, artifactKey\)/);
assert.match(canonicalPreviewHandlerSource, /canonicalPackageSlug/);
assert.match(canonicalPreviewHandlerSource, /canonicalArtifactKey/);
assert.doesNotMatch(canonicalPreviewHandlerSource, /canonicalArtifactPath/);
assert.doesNotMatch(canonicalPreviewHandlerSource, /\/jobs\//);
assert.doesNotMatch(canonicalPreviewHandlerSource, /run-artifact/);
assert.match(shellCoreSource, /navigatorRef\?\.clipboard\?\.writeText/);
assert.match(workspaceSource, /createCanonicalPackageCards/);
assert.match(canonicalRefsRendererSource, /copy-canonical-artifact-path/);
assert.match(canonicalRefsRendererSource, /preview-canonical-artifact/);
assert.match(canonicalRefsRendererSource, /canonicalArtifactPath/);
assert.match(canonicalRefsRendererSource, /canonicalArtifactKey/);
assert.match(canonicalRefsRendererSource, /Copy repo path/);
assert.match(canonicalRefsRendererSource, /Preview/);
assert.doesNotMatch(canonicalRefsRendererSource, /href/);
assert.doesNotMatch(canonicalRefsRendererSource, /download/);
assert.doesNotMatch(canonicalRefsRendererSource, /run-artifact/);
assert.doesNotMatch(canonicalRefsRendererSource, /input/i);
assert.match(canonicalPreviewPanelSource, /el\('pre'/);
assert.match(canonicalPreviewPanelSource, /text: preview\.content/);
assert.doesNotMatch(canonicalPreviewPanelSource, /html:/);
assert.doesNotMatch(canonicalPreviewPanelSource, /innerHTML/);
assert.match(examplesSource, /quality_pass_bracket/);
assert.doesNotMatch(examplesSource, /canonical-packages/);
assert.equal(translateText('Copy repo path', 'ko'), '저장소 경로 복사');
assert.equal(translateText('Copied', 'ko'), '복사됨');
assert.equal(translateText('Copy failed', 'ko'), '복사 실패');
assert.equal(translateText('Preview', 'ko'), '미리보기');
assert.equal(translateText('Close preview', 'ko'), '미리보기 닫기');
assert.equal(translateText('Preview failed', 'ko'), '미리보기 실패');
assert.equal(translateText('Preview truncated by server size limit.', 'ko'), '서버 크기 제한으로 미리보기가 잘렸습니다.');

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
  assert.equal(card.artifactRefs.every((ref) => typeof ref.key === 'string' && ref.key.endsWith('_path') === false), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'README'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Review pack'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Readiness report'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Standard docs manifest'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Release manifest'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Release checksums'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Release bundle'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Reopen notes'), true);
  assert.equal(card.artifactRefs.some((ref) => ref.label === 'Inspection evidence collection guide'), true);
  assert.equal(card.artifactRefs.filter((ref) => ref.previewAction).length, 8);
  assert.equal(card.artifactRefs.filter((ref) => !ref.previewAction).map((ref) => ref.key).join(','), 'release_bundle');
  assert.equal(card.artifactRefs.every((ref) => ref.previewAction?.route.includes(ref.path) !== true), true);
  assert.equal(card.artifactRefs.every((ref) => ref.previewAction?.route.includes(`/${card.slug}/artifacts/${ref.key}/preview`) !== false), true);
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'Release bundle')?.note || '',
    /Release bundle presence does not mean production-ready/
  );
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'Release bundle')?.note || '',
    /needs_more_evidence/
  );
  assert.match(
    card.artifactRefs.find((ref) => ref.label === 'Release bundle')?.note || '',
    /inspection_evidence/
  );
}

const previewModel = buildCanonicalPackageSectionModel({
  ...state,
  preview: {
    status: 'ready',
    slug: 'quality-pass-bracket',
    artifactKey: 'readiness_report',
    payload: {
      path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      content_kind: 'json',
      content_type: 'application/json; charset=utf-8',
      size_bytes: 1024,
      truncated: true,
      warnings: ['inspection_evidence remains missing unless real completed inspection evidence is attached.'],
      content: '<script>alert("xss")</script>',
    },
  },
});
assert.equal(previewModel.preview.status, 'ready');
assert.equal(previewModel.preview.content, '<script>alert("xss")</script>');
assert.equal(previewModel.preview.truncated, true);
assert.equal(previewModel.preview.warnings.length, 1);

assert.equal(serialized.includes('/Users/'), false);
assert.equal(serialized.includes('href'), false);
assert.equal(serialized.includes('download'), false);
assert.equal(serialized.includes('data-action'), false);
assert.equal(serialized.includes('/api/canonical-packages/quality-pass-bracket/artifacts/readiness_report/preview'), true);
assert.equal(serialized.includes('/jobs/'), false);

console.log('studio-canonical-package-cards.test.js: ok');

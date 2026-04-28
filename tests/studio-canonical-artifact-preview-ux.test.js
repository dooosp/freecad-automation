import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CANONICAL_PACKAGES_ENDPOINT,
  buildCanonicalArtifactPreviewRoute,
  buildCanonicalPackageSectionModel,
  normalizeCanonicalPackagesPayload,
} from '../public/js/studio/canonical-packages.js';
import { translateText } from '../public/js/i18n/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const canonicalPackagesSource = readFileSync(resolve(ROOT, 'public/js/studio/canonical-packages.js'), 'utf8');
const workspaceSource = readFileSync(resolve(ROOT, 'public/js/studio/workspaces.js'), 'utf8');
const shellCoreSource = readFileSync(resolve(ROOT, 'public/js/studio/studio-shell-core.js'), 'utf8');
const routesSource = readFileSync(resolve(ROOT, 'src/server/routes/local-api-operational-routes.js'), 'utf8');

const canonicalRefsRendererSource = workspaceSource.slice(
  workspaceSource.indexOf('function createCanonicalArtifactRefsList'),
  workspaceSource.indexOf('function formatPreviewSize')
);
const canonicalPreviewPanelSource = workspaceSource.slice(
  workspaceSource.indexOf('function createCanonicalArtifactPreviewPanel'),
  workspaceSource.indexOf('function createCanonicalPackageCards')
);
const previewActionHandlerSource = shellCoreSource.slice(
  shellCoreSource.indexOf("if (action === 'preview-canonical-artifact')"),
  shellCoreSource.indexOf("if (action === 'close-canonical-artifact-preview')")
);
const copyActionHandlerSource = shellCoreSource.slice(
  shellCoreSource.indexOf("if (action === 'copy-canonical-artifact-path')"),
  shellCoreSource.indexOf("if (action === 'refresh-health')")
);

function makePackage(slug = 'quality-pass-bracket') {
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
    name: 'Quality pass bracket',
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
      ['readme', 'README', 'readme_path', `docs/examples/${slug}/README.md`, 'markdown', true],
      ['review_pack', 'Review pack', 'review_pack_path', artifacts.review_pack_path, 'json', true],
      ['readiness_report', 'Readiness report', 'readiness_report_path', artifacts.readiness_report_path, 'json', true],
      ['standard_docs_manifest', 'Standard docs manifest', 'standard_docs_manifest_path', artifacts.standard_docs_manifest_path, 'manifest', true],
      ['release_manifest', 'Release manifest', 'release_manifest_path', artifacts.release_manifest_path, 'manifest', true],
      ['release_checksums', 'Release checksums', 'release_checksums_path', artifacts.release_checksums_path, 'checksum', true],
      ['release_bundle', 'Release bundle', 'release_bundle_path', artifacts.release_bundle_path, 'zip', false],
      ['reopen_notes', 'Reopen notes', 'reopen_notes_path', artifacts.reopen_notes_path, 'markdown', true],
      ['collection_guide', 'Inspection evidence collection guide', 'collection_guide_path', `docs/inspection-evidence-collection/${slug}.md`, 'markdown', true],
    ].map(([key, label, pathField, path, contentKind, textPreviewAllowed]) => ({
      key,
      label,
      path_field: pathField,
      path,
      content_kind: contentKind,
      text_preview_allowed: textPreviewAllowed,
      download_allowed: false,
      warning_required: key === 'release_bundle',
      warning: key === 'release_bundle'
        ? 'Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.'
        : null,
      path_must_be_repo_relative: true,
      optional: key === 'collection_guide',
      available: true,
      production_ready: key === 'release_bundle' ? false : null,
    })),
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

const state = normalizeCanonicalPackagesPayload({
  ok: true,
  packages: [makePackage()],
});
const sectionModel = buildCanonicalPackageSectionModel(state);
const card = sectionModel.cards[0];
const previewRefs = card.artifactRefs.filter((ref) => ref.previewAction);
const nonPreviewRefs = card.artifactRefs.filter((ref) => !ref.previewAction);

assert.equal(CANONICAL_PACKAGES_ENDPOINT, '/api/canonical-packages');
assert.equal(buildCanonicalArtifactPreviewRoute('quality-pass-bracket', 'readiness_report'), '/api/canonical-packages/quality-pass-bracket/artifacts/readiness_report/preview');
assert.deepEqual(previewRefs.map((ref) => ref.key), [
  'readme',
  'review_pack',
  'readiness_report',
  'standard_docs_manifest',
  'release_manifest',
  'release_checksums',
  'reopen_notes',
  'collection_guide',
]);
assert.deepEqual(nonPreviewRefs.map((ref) => ref.key), ['release_bundle']);
assert.equal(
  previewRefs.every((ref) => ref.previewAction.route === buildCanonicalArtifactPreviewRoute(card.slug, ref.key)),
  true
);
assert.equal(previewRefs.some((ref) => ref.previewAction.route.includes(ref.path)), false);
assert.equal(card.artifactRefs.every((ref) => ref.copyAction?.label === 'Copy repo path'), true);
assert.equal(card.artifactRefs.every((ref) => ref.copyAction && !Object.hasOwn(ref.copyAction, 'href')), true);
assert.equal(card.artifactRefs.every((ref) => ref.copyAction && !Object.hasOwn(ref.copyAction, 'download')), true);

assert.match(canonicalRefsRendererSource, /action: 'preview-canonical-artifact'/);
assert.match(canonicalRefsRendererSource, /canonicalPackageSlug: ref\.slug/);
assert.match(canonicalRefsRendererSource, /canonicalArtifactKey: ref\.key/);
assert.doesNotMatch(canonicalRefsRendererSource, /canonicalArtifactPath: ref\.path[\s\S]*preview-canonical-artifact/);
assert.doesNotMatch(canonicalRefsRendererSource, /href/);
assert.doesNotMatch(canonicalRefsRendererSource, /download/);
assert.doesNotMatch(canonicalRefsRendererSource, /\/jobs\//);
assert.doesNotMatch(canonicalRefsRendererSource, /run-artifact/);
assert.match(canonicalRefsRendererSource, /action: 'copy-canonical-artifact-path'/);
assert.match(canonicalRefsRendererSource, /canonicalArtifactPath: ref\.path/);

assert.match(previewActionHandlerSource, /buildCanonicalArtifactPreviewRoute\(slug, artifactKey\)/);
assert.match(previewActionHandlerSource, /canonicalPackageSlug/);
assert.match(previewActionHandlerSource, /canonicalArtifactKey/);
assert.doesNotMatch(previewActionHandlerSource, /canonicalArtifactPath/);
assert.doesNotMatch(previewActionHandlerSource, /\/jobs\//);
assert.doesNotMatch(previewActionHandlerSource, /run-artifact/);
assert.doesNotMatch(previewActionHandlerSource, /artifactPath/);
assert.match(copyActionHandlerSource, /copyTextToClipboard/);
assert.doesNotMatch(copyActionHandlerSource, /fetchJson/);

assert.match(canonicalPreviewPanelSource, /el\('pre'/);
assert.match(canonicalPreviewPanelSource, /text: preview\.content/);
assert.match(canonicalPreviewPanelSource, /preview\.warnings\.map/);
assert.match(canonicalPreviewPanelSource, /text: warning/);
assert.match(canonicalPreviewPanelSource, /preview\.truncated \? 'Yes' : 'No'/);
assert.match(canonicalPreviewPanelSource, /Preview truncated by server size limit\./);
assert.doesNotMatch(canonicalPreviewPanelSource, /html:/);
assert.doesNotMatch(canonicalPreviewPanelSource, /innerHTML/);
assert.doesNotMatch(canonicalPreviewPanelSource, /eval\(/);
assert.doesNotMatch(canonicalPreviewPanelSource, /new Function/);
assert.doesNotMatch(canonicalPreviewPanelSource, /marked|markdown-it|DOMParser/);

const previewModel = buildCanonicalPackageSectionModel({
  ...state,
  preview: {
    status: 'ready',
    slug: 'quality-pass-bracket',
    artifactKey: 'readiness_report',
    label: 'Readiness report',
    payload: {
      path: 'docs/examples/quality-pass-bracket/readiness/readiness_report.json',
      content_kind: 'json',
      content_type: 'application/json; charset=utf-8',
      size_bytes: 128,
      truncated: true,
      warnings: ['inspection_evidence remains missing unless real completed inspection evidence is attached.'],
      content: '<script>globalThis.__canonicalPreviewExecuted = true</script>\n{"ok":true}',
    },
  },
});
assert.equal(previewModel.preview.content.includes('<script>'), true);
assert.equal(previewModel.preview.truncated, true);
assert.deepEqual(previewModel.preview.warnings, [
  'inspection_evidence remains missing unless real completed inspection evidence is attached.',
]);

assert.match(routesSource, /app\.get\('\/api\/examples'/);
assert.match(routesSource, /app\.get\('\/api\/canonical-packages'/);
assert.match(routesSource, /app\.get\(CANONICAL_ARTIFACT_PREVIEW_ROUTE/);
assert.doesNotMatch(routesSource, /canonical-packages[\s\S]*\/artifacts\/:artifactKey\/download/);
assert.doesNotMatch(routesSource, /canonical-packages[\s\S]*\/artifacts\/:artifactKey\/open/);

assert.match(canonicalPackagesSource, /textPreviewAllowed = entry\.text_preview_allowed === true && key !== 'release_bundle'/);
assert.doesNotMatch(canonicalPackagesSource, /download_allowed[^;]*true/);
assert.equal(translateText('Preview', 'ko'), '미리보기');
assert.equal(translateText('Preview failed', 'ko'), '미리보기 실패');
assert.equal(translateText('Preview truncated by server size limit.', 'ko'), '서버 크기 제한으로 미리보기가 잘렸습니다.');
assert.equal(
  translateText('Release bundle presence does not mean production-ready; package remains needs_more_evidence until real inspection_evidence is attached.', 'ko'),
  '릴리스 번들이 있어도 production-ready를 뜻하지 않습니다. 실제 inspection_evidence가 첨부될 때까지 패키지는 needs_more_evidence 상태로 유지됩니다.'
);

console.log('studio-canonical-artifact-preview-ux.test.js: ok');

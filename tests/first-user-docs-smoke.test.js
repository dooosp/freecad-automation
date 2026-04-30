import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROOT_README_PATH = resolve(ROOT, 'README.md');
const EXAMPLE_INDEX_PATH = resolve(ROOT, 'docs', 'examples', 'README.md');
const PROJECT_CLOSEOUT_STATUS_PATH = resolve(ROOT, 'docs', 'project-closeout-status.md');
const FINAL_CLOSEOUT_PATH = resolve(ROOT, 'docs', 'final-non-inspection-software-closeout.md');
const DFM_READINESS_GUIDE_PATH = resolve(ROOT, 'docs', 'dfm-readiness-guide.md');
const CANONICAL_PACKAGE_WORKFLOW_PATH = resolve(ROOT, 'docs', 'canonical-package-generation-workflow.md');
const STUDIO_FIRST_USER_WALKTHROUGH_PATH = resolve(ROOT, 'docs', 'studio-first-user-walkthrough.md');
const STUDIO_CANONICAL_PACKAGE_API_PATH = resolve(ROOT, 'docs', 'studio-canonical-package-api.md');
const TESTING_DOC_PATH = resolve(ROOT, 'docs', 'testing.md');
const INSPECTION_CONTRACT_PATH = resolve(ROOT, 'docs', 'inspection-evidence-contract.md');
const INSPECTION_COLLECTION_DIR = resolve(ROOT, 'docs', 'inspection-evidence-collection');
const SYNTHETIC_FIXTURE_REF = 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json';

const CANONICAL_PACKAGES = Object.freeze([
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
  'hinge-block',
]);

function readText(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function assertMentions(text, pattern, label) {
  assert.match(text, pattern, label);
}

function assertDoesNotMention(text, pattern, label) {
  assert.equal(pattern.test(text), false, label);
}

function assertNoPositiveProductionReadyClaim(text, label) {
  const positiveClaimPatterns = [
    /\b(is|are|as|now|marked|considered)\s+production-ready\b/i,
    /\bproduction readiness (is|has been) (complete|cleared|approved|achieved)\b/i,
    /\bready for production\b/i,
  ];
  for (const pattern of positiveClaimPatterns) {
    assertDoesNotMention(text, pattern, label);
  }
}

function parseCanonicalPackageList(markdown) {
  const matches = markdown.matchAll(/^- \[`([^`]+)`\]\(\.\/[^)]+\/README\.md\)$/gm);
  return Array.from(matches, (match) => match[1]);
}

assert.equal(existsSync(ROOT_README_PATH), true, 'root README should exist');
assert.equal(existsSync(EXAMPLE_INDEX_PATH), true, 'canonical example index should exist');
assert.equal(existsSync(PROJECT_CLOSEOUT_STATUS_PATH), true, 'project closeout status should exist');
assert.equal(existsSync(FINAL_CLOSEOUT_PATH), true, 'final non-inspection software closeout should exist');
assert.equal(existsSync(DFM_READINESS_GUIDE_PATH), true, 'DFM/readiness guide should exist');
assert.equal(existsSync(CANONICAL_PACKAGE_WORKFLOW_PATH), true, 'canonical package generation workflow guide should exist');
assert.equal(existsSync(STUDIO_FIRST_USER_WALKTHROUGH_PATH), true, 'Studio first-user walkthrough should exist');
assert.equal(existsSync(STUDIO_CANONICAL_PACKAGE_API_PATH), true, 'Studio canonical package API doc should exist');
assert.equal(existsSync(TESTING_DOC_PATH), true, 'testing doc should exist');
assert.equal(existsSync(INSPECTION_CONTRACT_PATH), true, 'inspection evidence contract should exist');
assert.equal(
  existsSync(join(INSPECTION_COLLECTION_DIR, 'README.md')),
  true,
  'inspection evidence collection guide index should exist'
);

const rootReadmeText = readText(ROOT_README_PATH);
const exampleIndexText = readText(EXAMPLE_INDEX_PATH);
const projectCloseoutStatusText = readText(PROJECT_CLOSEOUT_STATUS_PATH);
const finalCloseoutText = readText(FINAL_CLOSEOUT_PATH);
const dfmReadinessGuideText = readText(DFM_READINESS_GUIDE_PATH);
const canonicalPackageWorkflowText = readText(CANONICAL_PACKAGE_WORKFLOW_PATH);
const studioFirstUserWalkthroughText = readText(STUDIO_FIRST_USER_WALKTHROUGH_PATH);
const studioCanonicalPackageApiText = readText(STUDIO_CANONICAL_PACKAGE_API_PATH);
const testingDocText = readText(TESTING_DOC_PATH);
const inspectionContractText = readText(INSPECTION_CONTRACT_PATH);
const collectionGuideIndexText = readText(join(INSPECTION_COLLECTION_DIR, 'README.md'));

assertMentions(
  rootReadmeText,
  /\[canonical example library\]\(\.\/docs\/examples\/README\.md\)/,
  'root README should point first users to docs/examples/README.md'
);
assertMentions(rootReadmeText, /First-user CLI recipe: inspect a canonical package/, 'root README should include the first-user CLI recipe');
assertMentions(rootReadmeText, /inspect checked-in canonical package artifacts without regenerating anything/, 'CLI recipe should inspect checked-in artifacts');
assertMentions(rootReadmeText, /Regenerate later only when/, 'CLI recipe should distinguish future regeneration from inspection');
assertMentions(rootReadmeText, /read-only canonical package cards/, 'root README should describe Studio canonical package cards');
assertMentions(rootReadmeText, /allowlisted artifact preview/, 'root README should describe allowlisted artifact preview');
assertMentions(rootReadmeText, /checked-in canonical packages remain docs-package artifacts/, 'root README should describe checked-in packages as docs-package artifacts');
assertMentions(rootReadmeText, /GET \/api\/canonical-packages/, 'root README should document the canonical package listing route');
assertMentions(rootReadmeText, /GET \/api\/canonical-packages\/:slug\/artifacts\/:artifactKey\/preview/, 'root README should document the canonical artifact preview route');
assertMentions(rootReadmeText, /does not accept arbitrary local file paths/, 'root README should reject arbitrary local file paths for canonical previews');
assertMentions(rootReadmeText, /release_bundle\.zip` appears as the `release_bundle` package artifact, but it is not text-previewable/, 'root README should keep release_bundle.zip as a non-previewable package artifact');
assertMentions(rootReadmeText, /--inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>/, 'root README should show the completed-real-evidence CLI placeholder');
assertMentions(rootReadmeText, /Do not treat synthetic fixtures or generated CAD\/drawing\/readiness outputs as package inspection evidence/, 'root README should reject synthetic/generated package evidence');
assertMentions(rootReadmeText, /quality\/drawing evidence does not satisfy `inspection_evidence`/, 'root README should preserve the inspection evidence boundary');
assertMentions(rootReadmeText, new RegExp(SYNTHETIC_FIXTURE_REF), 'root README should explicitly reject the synthetic fixture as package evidence');
assertMentions(
  rootReadmeText,
  /\[Studio first-user walkthrough\]\(\.\/docs\/studio-first-user-walkthrough\.md\)/,
  'root README should link the Studio first-user walkthrough'
);
assertMentions(
  rootReadmeText,
  /\[canonical package generation workflow\]\(\.\/docs\/canonical-package-generation-workflow\.md\)/,
  'root README should link the canonical package generation workflow'
);
assertMentions(
  rootReadmeText,
  /\[DFM and readiness guide\]\(\.\/docs\/dfm-readiness-guide\.md\)/,
  'root README should link the DFM and readiness guide'
);
assertMentions(
  rootReadmeText,
  /\[final non-inspection software closeout\]\(\.\/docs\/final-non-inspection-software-closeout\.md\)/,
  'root README should link the final non-inspection software closeout'
);

assert.deepEqual(
  parseCanonicalPackageList(exampleIndexText),
  CANONICAL_PACKAGES,
  'example index should list exactly the five canonical packages in first-user order'
);
assertMentions(exampleIndexText, /readiness_report\.json` is the readiness source of truth/, 'example index should name readiness_report.json as source of truth');
assertMentions(exampleIndexText, /quality and drawing evidence is review evidence.*does not satisfy `inspection_evidence`/, 'example index should preserve the generated-evidence boundary');
assertMentions(exampleIndexText, /## Artifact Map/, 'example index should include a first-user artifact map');
assertMentions(exampleIndexText, /review\/review_pack\.json/, 'artifact map should mention the review pack');
assertMentions(exampleIndexText, /package evidence ledger/, 'artifact map should describe the review pack ledger');
assertMentions(exampleIndexText, /source refs/, 'artifact map should mention portable source refs');
assertMentions(exampleIndexText, /readiness\/readiness_report\.json/, 'artifact map should mention the readiness report');
assertMentions(exampleIndexText, /readiness source of truth/, 'artifact map should identify the readiness source of truth');
assertMentions(exampleIndexText, /standard-docs\//, 'artifact map should mention standard docs');
assertMentions(exampleIndexText, /release\//, 'artifact map should mention the release directory');
assertMentions(exampleIndexText, /release_bundle_manifest\.json/, 'artifact map should mention the release bundle manifest');
assertMentions(exampleIndexText, /release_bundle_checksums\.sha256/, 'artifact map should mention release checksums');
assertMentions(exampleIndexText, /release_bundle\.zip/, 'artifact map should mention the release bundle zip');
assertMentions(exampleIndexText, /reopen-notes\.md/, 'artifact map should mention reopen notes');
assertMentions(exampleIndexText, /read-only canonical package cards/, 'artifact map should mention Studio canonical package cards');
assertMentions(exampleIndexText, /allowlisted artifact preview/, 'artifact map should mention allowlisted artifact preview');
assertMentions(exampleIndexText, /tracked job\/artifact reopen remains separate/, 'artifact map should preserve the Studio tracked-job boundary');
assertMentions(exampleIndexText, /Release bundle presence does not mean production-ready/, 'artifact map should not imply release bundles are production-ready');
assertMentions(exampleIndexText, /remain `needs_more_evidence` until real `inspection_evidence`/, 'artifact map should keep the current evidence boundary');
assertMentions(
  exampleIndexText,
  /\[Studio first-user walkthrough\]\(\.\.\/studio-first-user-walkthrough\.md\)/,
  'example index should link the Studio first-user walkthrough'
);
assertMentions(
  exampleIndexText,
  /\[canonical package generation workflow\]\(\.\.\/canonical-package-generation-workflow\.md\)/,
  'example index should link the canonical package generation workflow'
);
assertMentions(
  exampleIndexText,
  /\[DFM and readiness guide\]\(\.\.\/dfm-readiness-guide\.md\)/,
  'example index should link the DFM and readiness guide'
);

assertMentions(projectCloseoutStatusText, /non-inspection software milestone/, 'project closeout should separate software closeout');
assertMentions(projectCloseoutStatusText, /Production readiness remains held/, 'project closeout should not claim production readiness');
assertMentions(projectCloseoutStatusText, /release bundle presence does not mean production-ready/, 'project closeout should preserve release boundary');
assertMentions(projectCloseoutStatusText, /Stage 5B inspection evidence remains parked/, 'project closeout should state Stage 5B is parked');
assertMentions(projectCloseoutStatusText, /Quality\/drawing evidence is review evidence, not inspection evidence/, 'project closeout should preserve evidence boundary');
assertMentions(
  projectCloseoutStatusText,
  /\[Studio first-user walkthrough\]\(\.\/studio-first-user-walkthrough\.md\)/,
  'project closeout should link the Studio first-user walkthrough'
);
assertMentions(
  projectCloseoutStatusText,
  /\[DFM and readiness guide\]\(\.\/dfm-readiness-guide\.md\)/,
  'project closeout should link the DFM and readiness guide'
);
assertMentions(
  projectCloseoutStatusText,
  /\[final non-inspection software closeout\]\(\.\/final-non-inspection-software-closeout\.md\)/,
  'project closeout should link the final non-inspection software closeout'
);
assertMentions(projectCloseoutStatusText, /config\s+-> cad\/export\s+-> quality\/drawing\s+-> review_pack\s+-> readiness_report\s+-> standard_docs\s+-> release_bundle\s+-> Studio reopen\/preview/, 'project closeout should include current artifact chain');
for (const [slug, score] of Object.entries({
  'quality-pass-bracket': 61,
  'plate-with-holes': 61,
  'motor-mount': 55,
  'controller-housing-eol': 52,
  'hinge-block': 52,
})) {
  assertMentions(
    projectCloseoutStatusText,
    new RegExp(`\\| \`${slug}\` [^\\n]+\\| ${score} \\| \`hold_for_evidence_completion\` \\| \`inspection_evidence\` \\|`),
    `project closeout should list ${slug} readiness truth`
  );
}

assertMentions(
  finalCloseoutText,
  /^# Final non-inspection software closeout/m,
  'final closeout should have the expected title'
);
assertMentions(
  finalCloseoutText,
  /AF5-style package flow|AF5 package flow/,
  'final closeout should mention AF5 or the artifact chain'
);
assertMentions(finalCloseoutText, /Studio/, 'final closeout should mention Studio');
assertMentions(
  finalCloseoutText,
  /release_bundle\.zip` remains non-previewable and non-downloadable/,
  'final closeout should preserve release bundle preview/download boundary'
);
assertMentions(finalCloseoutText, /`needs_more_evidence`/, 'final closeout should mention needs_more_evidence');
assertMentions(finalCloseoutText, /`hold_for_evidence_completion`/, 'final closeout should mention hold_for_evidence_completion');
assertMentions(finalCloseoutText, /`inspection_evidence`/, 'final closeout should mention inspection_evidence');
assertMentions(
  finalCloseoutText,
  /Stage 5B remains parked/,
  'final closeout should keep Stage 5B parked'
);
assertMentions(
  finalCloseoutText,
  /Generated quality, drawing, review, readiness, standard-doc, and release artifacts are not inspection evidence/,
  'final closeout should reject generated artifacts as inspection evidence'
);
assertMentions(
  finalCloseoutText,
  /DFM signals and reports are review\/manufacturability signals, not physical inspection evidence/,
  'final closeout should keep DFM signals out of inspection evidence'
);
assertMentions(
  finalCloseoutText,
  /No measured values were fabricated/,
  'final closeout should reject fabricated measured values'
);
assertMentions(
  finalCloseoutText,
  /no open pull request rows/i,
  'final closeout should record the preflight open PR status'
);
assertNoPositiveProductionReadyClaim(finalCloseoutText, 'final closeout should not claim production readiness');
for (const [slug, score] of Object.entries({
  'quality-pass-bracket': 61,
  'plate-with-holes': 61,
  'motor-mount': 55,
  'controller-housing-eol': 52,
  'hinge-block': 52,
})) {
  assertMentions(finalCloseoutText, new RegExp(`\\| \`${slug}\` [^\\n]+\\|`), `final closeout should mention ${slug}`);
  assertMentions(
    finalCloseoutText,
    new RegExp(`\\| \`${slug}\` \\| \`needs_more_evidence\` \\| ${score} \\| \`hold_for_evidence_completion\` \\| \`inspection_evidence\` \\|`),
    `final closeout should list ${slug} readiness truth`
  );
}

assertMentions(dfmReadinessGuideText, /^# DFM and readiness guide/m, 'DFM/readiness guide should have the expected title');
assertMentions(dfmReadinessGuideText, /\bDFM\b/, 'DFM/readiness guide should mention DFM');
assertMentions(
  dfmReadinessGuideText,
  /Readiness reports are the source of truth for status, score, gate decision, and missing inputs/,
  'DFM/readiness guide should identify readiness reports as source of truth'
);
assertMentions(dfmReadinessGuideText, /`needs_more_evidence`/, 'DFM/readiness guide should mention needs_more_evidence');
assertMentions(dfmReadinessGuideText, /`hold_for_evidence_completion`/, 'DFM/readiness guide should mention hold_for_evidence_completion');
assertMentions(dfmReadinessGuideText, /`inspection_evidence`/, 'DFM/readiness guide should mention inspection_evidence');
assertMentions(
  dfmReadinessGuideText,
  /Release bundle presence does not mean production-ready/,
  'DFM/readiness guide should preserve the release bundle readiness boundary'
);
assertMentions(
  dfmReadinessGuideText,
  /DFM signals and DFM reports are not inspection evidence/,
  'DFM/readiness guide should state DFM signals and reports are not inspection evidence'
);
assertMentions(
  dfmReadinessGuideText,
  /Stage 5B remains parked/,
  'DFM/readiness guide should preserve the Stage 5B parked boundary'
);
assertMentions(
  dfmReadinessGuideText,
  /Do not fabricate measured values/,
  'DFM/readiness guide should reject fabricated measured values'
);
assertMentions(
  dfmReadinessGuideText,
  /Do not infer measured values from CAD nominal dimensions/,
  'DFM/readiness guide should reject inferred measured values'
);
assertNoPositiveProductionReadyClaim(dfmReadinessGuideText, 'DFM/readiness guide should not claim production readiness');
for (const [slug, score] of Object.entries({
  'quality-pass-bracket': 61,
  'plate-with-holes': 61,
  'motor-mount': 55,
  'controller-housing-eol': 52,
  'hinge-block': 52,
})) {
  const guideRowPattern = new RegExp(
    '\\| `' +
      slug +
      '` \\| `needs_more_evidence` \\| ' +
      score +
      ' \\| `hold_for_evidence_completion` \\| `inspection_evidence` \\|'
  );
  assertMentions(
    dfmReadinessGuideText,
    guideRowPattern,
    `DFM/readiness guide should list ${slug} readiness truth`
  );
}

assertMentions(
  canonicalPackageWorkflowText,
  /^# Canonical package generation workflow/m,
  'canonical package workflow should have the expected title'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Use this maintainer guide/,
  'canonical package workflow should identify itself as a maintainer guide'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Do not use this guide as approval to regenerate CAD, package, readiness, standard-doc, or release artifacts/,
  'canonical package workflow should not authorize regeneration'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Generated package artifacts are not inspection evidence/,
  'canonical package workflow should reject generated package artifacts as inspection evidence'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Release bundles are package transport artifacts, not production-readiness proof/,
  'canonical package workflow should preserve the release bundle boundary'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Stage 5B remains parked/,
  'canonical package workflow should preserve Stage 5B parked language'
);
assertMentions(
  canonicalPackageWorkflowText,
  /New package work should start with candidate selection and explicit approval/,
  'canonical package workflow should require candidate approval'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Use these commands only in a separately approved package-generation task/,
  'canonical package workflow should keep generation commands future-only'
);
for (const command of [
  'fcad validate-config',
  'fcad create',
  'fcad draw',
  'fcad review-context',
  'fcad readiness-pack',
  'fcad generate-standard-docs',
  'fcad pack',
]) {
  assert.equal(canonicalPackageWorkflowText.includes(command), true, `canonical package workflow should mention ${command}`);
}
for (const artifact of [
  'review/review_pack.json',
  'readiness/readiness_report.json',
  'readiness/readiness_report.md',
  'standard-docs/',
  'release/release_bundle_manifest.json',
  'release/release_bundle_checksums.sha256',
  'release/release_bundle_log.json',
  'release/release_bundle.zip',
  'reopen-notes.md',
]) {
  assert.equal(canonicalPackageWorkflowText.includes(artifact), true, `canonical package workflow should mention ${artifact}`);
}
assertMentions(
  canonicalPackageWorkflowText,
  /Keep readiness as `needs_more_evidence` with gate decision `hold_for_evidence_completion` when `inspection_evidence` is missing/,
  'canonical package workflow should preserve readiness hold wording'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Do not pass `--inspection-evidence` unless a separate evidence-gated task validates real evidence/,
  'canonical package workflow should protect inspection evidence attachment'
);
assertMentions(
  canonicalPackageWorkflowText,
  /`release_bundle\.zip` is not previewable, downloadable, or openable through canonical package preview/,
  'canonical package workflow should preserve release bundle preview/download/open boundary'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Do not add arbitrary local file serving/,
  'canonical package workflow should reject arbitrary local file serving'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Do not widen Studio or API preview, download, or open routes/,
  'canonical package workflow should reject route widening'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Update `docs\/examples\/example-library-manifest\.json`/,
  'canonical package workflow should include manifest updates'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Canonical slugs must be visible through the existing canonical package discovery contract/,
  'canonical package workflow should keep Studio discovery scoped'
);
assertMentions(
  canonicalPackageWorkflowText,
  /node tests\/first-user-docs-smoke\.test\.js/,
  'canonical package workflow should list docs smoke validation'
);
assertMentions(
  canonicalPackageWorkflowText,
  /Do not run `fcad create`, `fcad draw`, `fcad pack`, or runtime smoke for a docs-only guide update/,
  'canonical package workflow should preserve docs-only validation boundary'
);
assertNoPositiveProductionReadyClaim(canonicalPackageWorkflowText, 'canonical package workflow should not claim production readiness');
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    canonicalPackageWorkflowText.includes(`\`${slug}\``),
    true,
    `canonical package workflow should mention ${slug}`
  );
}

assertMentions(studioFirstUserWalkthroughText, /^# Studio First-User Walkthrough/m, 'Studio walkthrough should have the expected title');
assertMentions(studioFirstUserWalkthroughText, /Studio uses tracked\/canonical package and artifact routes/, 'Studio walkthrough should mention tracked/canonical routes');
assertMentions(studioFirstUserWalkthroughText, /Canonical package cards are read-only views/, 'Studio walkthrough should explain canonical package cards');
assertMentions(
  studioFirstUserWalkthroughText,
  /\[Studio canonical package API\]\(\.\/studio-canonical-package-api\.md\)/,
  'Studio walkthrough should link the Studio canonical package API doc'
);
assertMentions(studioFirstUserWalkthroughText, /safe package identifiers and artifact keys/, 'Studio walkthrough should explain safe slug plus artifact key preview');
assertMentions(studioFirstUserWalkthroughText, /\/api\/canonical-packages/, 'Studio walkthrough should show the canonical package listing route');
assertMentions(studioFirstUserWalkthroughText, /\/api\/canonical-packages\/<slug>\/artifacts\/<artifactKey>\/preview/, 'Studio walkthrough should show the safe canonical preview route shape');
assertMentions(studioFirstUserWalkthroughText, /Canonical artifact actions are read-only/, 'Studio walkthrough should mention read-only canonical artifact actions');
assertMentions(studioFirstUserWalkthroughText, /release_bundle\.zip` is a curated package artifact, not a text-preview artifact/, 'Studio walkthrough should keep release_bundle.zip non-preview text boundary');
assertMentions(studioFirstUserWalkthroughText, /remains non-previewable/, 'Studio walkthrough should state release_bundle.zip remains non-previewable');
assertMentions(studioFirstUserWalkthroughText, /does not expose an arbitrary local file open or download route/, 'Studio walkthrough should reject arbitrary local open/download routes');
assertMentions(studioFirstUserWalkthroughText, /Release bundle presence does not mean production-ready/, 'Studio walkthrough should preserve release bundle readiness boundary');
assertMentions(studioFirstUserWalkthroughText, /All five canonical packages remain `needs_more_evidence`/, 'Studio walkthrough should keep current readiness status');
assertMentions(studioFirstUserWalkthroughText, /`inspection_evidence` means genuine completed inspection evidence JSON/, 'Studio walkthrough should define inspection_evidence');
assertMentions(studioFirstUserWalkthroughText, /Generated quality, drawing, review, readiness, standard-docs, release, template, fixture, and collection-guide artifacts are not inspection evidence/, 'Studio walkthrough should reject generated artifacts as inspection evidence');
assertMentions(studioFirstUserWalkthroughText, /Production readiness remains held until genuine completed inspection evidence exists/, 'Studio walkthrough should keep production readiness held');
assertMentions(studioFirstUserWalkthroughText, /Stage 5B remains parked until a genuine completed inspection evidence JSON exists/, 'Studio walkthrough should preserve Stage 5B parked language');
assertMentions(
  studioFirstUserWalkthroughText,
  /\[final non-inspection software closeout\]\(\.\/final-non-inspection-software-closeout\.md\)/,
  'Studio walkthrough should link the final non-inspection software closeout'
);
assertNoPositiveProductionReadyClaim(studioFirstUserWalkthroughText, 'Studio walkthrough should not claim production readiness');
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    studioFirstUserWalkthroughText.includes(`\`${slug}\``),
    true,
    `Studio walkthrough should mention ${slug}`
  );
}

assertMentions(studioCanonicalPackageApiText, /^# Studio canonical package API/m, 'Studio canonical package API doc should have the expected title');
assertMentions(studioCanonicalPackageApiText, /GET \/api\/canonical-packages/, 'Studio canonical package API doc should document the package listing route');
assertMentions(
  studioCanonicalPackageApiText,
  /GET \/api\/canonical-packages\/<slug>\/artifacts\/<artifactKey>\/preview/,
  'Studio canonical package API doc should document the preview route'
);
assertMentions(studioCanonicalPackageApiText, /not an arbitrary local folder importer/, 'Studio canonical package API doc should reject arbitrary local folders');
assertMentions(studioCanonicalPackageApiText, /not a path supplied by the browser/, 'Studio canonical package API doc should reject browser-supplied paths');
assertMentions(studioCanonicalPackageApiText, /release_bundle\.zip` is listed in the package artifact catalog as `release_bundle`/, 'Studio canonical package API doc should list release_bundle as a package artifact');
assertMentions(studioCanonicalPackageApiText, /does not add a preview, download, or open route for it/, 'Studio canonical package API doc should preserve release bundle route boundary');
assertMentions(studioCanonicalPackageApiText, /release_bundle_manifest\.json` and `release_bundle_checksums\.sha256`/, 'Studio canonical package API doc should distinguish previewable release text artifacts');
assertMentions(studioCanonicalPackageApiText, /Generated quality, drawing, review, readiness, standard-doc, release, fixture, template, and collection-guide artifacts are not inspection evidence/, 'Studio canonical package API doc should reject generated artifacts as inspection evidence');
assertMentions(studioCanonicalPackageApiText, /Stage 5B remains parked until a genuine completed inspection evidence JSON exists/, 'Studio canonical package API doc should preserve Stage 5B parked boundary');
assertNoPositiveProductionReadyClaim(studioCanonicalPackageApiText, 'Studio canonical package API doc should not claim production readiness');
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    studioCanonicalPackageApiText.includes(`\`${slug}\``),
    true,
    `Studio canonical package API doc should mention ${slug}`
  );
}

assertMentions(
  testingDocText,
  /node tests\/first-user-docs-smoke\.test\.js/,
  'testing doc should mention the first-user docs smoke command'
);
assertMentions(
  testingDocText,
  /Studio walkthrough for canonical package cards, safe artifact preview, release bundle boundaries/,
  'testing doc should document the Studio walkthrough docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /canonical package generation workflow guide/,
  'testing doc should document canonical package workflow docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /final non-inspection software closeout report/,
  'testing doc should document final closeout docs-smoke coverage'
);

for (const slug of CANONICAL_PACKAGES) {
  const packageRoot = resolve(ROOT, 'docs', 'examples', slug);
  const packageReadmePath = join(packageRoot, 'README.md');
  const readinessReportPath = join(packageRoot, 'readiness', 'readiness_report.json');
  const reviewPackPath = join(packageRoot, 'review', 'review_pack.json');
  const inspectionEvidencePath = join(packageRoot, 'inspection', 'inspection_evidence.json');
  const collectionGuidePath = join(INSPECTION_COLLECTION_DIR, `${slug}.md`);

  assert.equal(existsSync(packageReadmePath), true, `${slug} README should exist`);
  assert.equal(existsSync(readinessReportPath), true, `${slug} readiness_report.json should exist`);
  assert.equal(existsSync(reviewPackPath), true, `${slug} review_pack.json should exist`);
  assert.equal(existsSync(inspectionEvidencePath), false, `${slug} should not have canonical inspection_evidence.json`);
  assert.equal(existsSync(collectionGuidePath), true, `${slug} inspection collection guide should exist`);

  const packageReadmeText = readText(packageReadmePath);
  const collectionGuideText = readText(collectionGuidePath);
  const readinessReport = readJson(readinessReportPath);
  const reviewPack = readJson(reviewPackPath);
  const missingInputs = readinessReport.review_pack?.uncertainty_coverage_report?.missing_inputs || [];
  const evidenceRecords = reviewPack.evidence_ledger?.records || [];

  assert.equal(readinessReport.readiness_summary?.status, 'needs_more_evidence', `${slug} readiness status should remain evidence-limited`);
  assert.equal(
    readinessReport.readiness_summary?.gate_decision,
    'hold_for_evidence_completion',
    `${slug} gate decision should remain held for evidence completion`
  );
  assert.equal(missingInputs.includes('inspection_evidence'), true, `${slug} should still miss inspection_evidence`);
  assertMentions(
    packageReadmeText,
    /readiness\/readiness_report\.json` is the readiness source of truth/,
    `${slug} README should point to readiness/readiness_report.json as source of truth`
  );
  assertMentions(
    packageReadmeText,
    /no real inspection evidence is attached yet/,
    `${slug} README should not claim real inspection evidence exists`
  );
  assertMentions(
    packageReadmeText,
    /(?:do|does) not satisfy `inspection_evidence`/,
    `${slug} README should not treat generated quality or drawing evidence as inspection evidence`
  );
  assertDoesNotMention(
    packageReadmeText,
    new RegExp(SYNTHETIC_FIXTURE_REF),
    `${slug} README should not reference the synthetic fixture as package evidence`
  );
  assert.equal(
    evidenceRecords.some((record) => record.inspection_evidence === true),
    false,
    `${slug} review pack should not contain an inspection evidence record`
  );
  assertMentions(collectionGuideText, /This guide is not readiness evidence/, `${slug} guide should identify itself as a guide, not evidence`);
  assertMentions(collectionGuideText, /Do not use it as package evidence/, `${slug} guide should reject the Stage 2 fixture as package evidence`);
  assertMentions(collectionGuideText, /Measured values must come from real physical inspection or a supplier/, `${slug} guide should require real measurements`);
  assertMentions(collectionGuideText, /<PATH_TO_COMPLETED_REAL_JSON>/, `${slug} guide should keep completed-real-evidence placeholder boundary`);
  assertMentions(
    collectionGuideText,
    new RegExp(`docs/examples/${slug}/inspection/inspection_evidence\\.json`),
    `${slug} guide should name the future completed real JSON target`
  );
  assertDoesNotMention(
    collectionGuideText,
    /"measured_value":\s*(?:\d+|true|false|"[^"<][^"]*")/,
    `${slug} guide should not include fabricated measured values`
  );
}

for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    collectionGuideIndexText.includes(`[\`${slug}\`](./${slug}.md)`),
    true,
    `collection guide index should link ${slug}`
  );
}
assertMentions(collectionGuideIndexText, /These non-canonical guides/, 'collection guide index should mark guides non-canonical');
assertMentions(collectionGuideIndexText, /They are not\s+inspection evidence/, 'collection guide index should say guides are not evidence');
assertMentions(collectionGuideIndexText, /review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>/, 'collection guide index should preserve future attachment boundary');
assertMentions(collectionGuideIndexText, /canonical packages remain\s+`needs_more_evidence`/, 'collection guide index should keep current readiness boundary');
assertMentions(inspectionContractText, /is not package readiness evidence/, 'contract doc should state the fixture is not package readiness evidence');
assertMentions(inspectionContractText, /The guide is not readiness evidence/, 'contract doc should treat the collection guide as non-canonical guidance');

console.log('first-user-docs-smoke.test.js: ok');

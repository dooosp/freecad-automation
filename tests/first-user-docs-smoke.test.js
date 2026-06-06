import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROOT_README_PATH = resolve(ROOT, 'README.md');
const EXAMPLE_INDEX_PATH = resolve(ROOT, 'docs', 'examples', 'README.md');
const PROJECT_CLOSEOUT_STATUS_PATH = resolve(ROOT, 'docs', 'project-closeout-status.md');
const FINAL_CLOSEOUT_PATH = resolve(ROOT, 'docs', 'final-non-inspection-software-closeout.md');
const FINAL_MAINTAINER_HANDOFF_PATH = resolve(ROOT, 'docs', 'final-maintainer-handoff.md');
const STAGE_5B_AUTOMATION_CLOSEOUT_PATH = resolve(ROOT, 'docs', 'stage-5b-automation-closeout-status.md');
const RELEASE_CANDIDATE_GAP_LEDGER_PATH = resolve(ROOT, 'docs', 'release-candidate-closeout-gap-ledger.md');
const STAGE_5B_OPERATIONAL_RUNBOOK_PATH = resolve(ROOT, 'docs', 'stage-5b-operational-runbook.md');
const STAGE_5B_EVIDENCE_REQUEST_PACKET_PATH = resolve(ROOT, 'docs', 'stage-5b-evidence-request-packet.md');
const STAGE_5B_ATTACHMENT_AUTHORIZATION_RECORD_PATH = resolve(ROOT, 'docs', 'stage-5b-attachment-authorization-record.md');
const STAGE_5B_ARTIFACT_SCHEMA_CATALOG_PATH = resolve(ROOT, 'docs', 'stage-5b-artifact-schema-catalog.md');
const STAGE_5D_CLOSEOUT_PATH = resolve(ROOT, 'docs', 'stage-5d-feature-expansion-closeout.md');
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

function assertNoPositiveCloseoutOverclaim(text, label) {
  const unsafePatterns = [
    /\b(?:readiness|readiness gate|gate decision)\b[^\n.]{0,120}\b(?:complete|cleared|approved|achieved|satisfied|released)\b/i,
    /\b(?:inspection evidence|inspection_evidence)\b[^\n.]{0,120}\b(?:found|attached|promoted|satisfied|complete|cleared)\b/i,
    /\bproduction deployment\b[^\n.]{0,120}\b(?:complete|done|approved|ready|live)\b/i,
    /\bhosted CI\b[^\n.]{0,120}\b(?:proves|covers|verifies)\b[^\n.]{0,120}\b(?:live FreeCAD|FreeCAD launch|FreeCAD install|runtime-backed)\b/i,
    /\b(?:Linux|Windows|WSL)\b[^\n.]{0,120}\brepository-owned live runtime smoke\b/i,
  ];
  const negated = /\b(?:not|no|does not|do not|did not|cannot|never|must not|without|only genuine|still requires|remains held|missing|compatibility-only)\b/i;
  const unsafeLines = text.split('\n').filter((line) => (
    unsafePatterns.some((pattern) => pattern.test(line)) && !negated.test(line)
  ));
  assert.deepEqual(unsafeLines, [], `${label} must not overclaim readiness, evidence attachment, production deployment, hosted CI, or runtime coverage`);
}

function parseCanonicalPackageList(markdown) {
  const matches = markdown.matchAll(/^- \[`([^`]+)`\]\(\.\/[^)]+\/README\.md\)$/gm);
  return Array.from(matches, (match) => match[1]);
}

assert.equal(existsSync(ROOT_README_PATH), true, 'root README should exist');
assert.equal(existsSync(EXAMPLE_INDEX_PATH), true, 'canonical example index should exist');
assert.equal(existsSync(PROJECT_CLOSEOUT_STATUS_PATH), true, 'project closeout status should exist');
assert.equal(existsSync(FINAL_CLOSEOUT_PATH), true, 'final non-inspection software closeout should exist');
assert.equal(existsSync(FINAL_MAINTAINER_HANDOFF_PATH), true, 'final maintainer handoff should exist');
assert.equal(existsSync(STAGE_5B_AUTOMATION_CLOSEOUT_PATH), true, 'Stage 5B automation closeout status should exist');
assert.equal(existsSync(RELEASE_CANDIDATE_GAP_LEDGER_PATH), true, 'release candidate closeout gap ledger should exist');
assert.equal(existsSync(STAGE_5B_OPERATIONAL_RUNBOOK_PATH), true, 'Stage 5B operational runbook should exist');
assert.equal(existsSync(STAGE_5B_EVIDENCE_REQUEST_PACKET_PATH), true, 'Stage 5B evidence request packet should exist');
assert.equal(existsSync(STAGE_5B_ATTACHMENT_AUTHORIZATION_RECORD_PATH), true, 'Stage 5B attachment authorization record should exist');
assert.equal(existsSync(STAGE_5B_ARTIFACT_SCHEMA_CATALOG_PATH), true, 'Stage 5B artifact/schema catalog should exist');
assert.equal(existsSync(STAGE_5D_CLOSEOUT_PATH), true, 'Stage 5D feature expansion closeout should exist');
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
const finalMaintainerHandoffText = readText(FINAL_MAINTAINER_HANDOFF_PATH);
const stage5bAutomationCloseoutText = readText(STAGE_5B_AUTOMATION_CLOSEOUT_PATH);
const releaseCandidateGapLedgerText = readText(RELEASE_CANDIDATE_GAP_LEDGER_PATH);
const stage5bOperationalRunbookText = readText(STAGE_5B_OPERATIONAL_RUNBOOK_PATH);
const stage5bEvidenceRequestPacketText = readText(STAGE_5B_EVIDENCE_REQUEST_PACKET_PATH);
const stage5bAttachmentAuthorizationRecordText = readText(STAGE_5B_ATTACHMENT_AUTHORIZATION_RECORD_PATH);
const stage5bArtifactSchemaCatalogText = readText(STAGE_5B_ARTIFACT_SCHEMA_CATALOG_PATH);
const stage5dCloseoutText = readText(STAGE_5D_CLOSEOUT_PATH);
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
assertMentions(rootReadmeText, /fcad inspection-evidence-intake --out <report\.json>/, 'root README should show autonomous inspection evidence intake');
assertMentions(rootReadmeText, /Studio can run `inspection-evidence-intake` as a tracked local job/, 'root README should document Studio tracked Stage 5B intake');
assertMentions(rootReadmeText, /explicit CSV\/TSV\/Markdown inspection tables/, 'root README should document table intake adapter coverage');
assertMentions(rootReadmeText, /\/api\/studio\/jobs/, 'root README should document the Studio tracked job submission route');
assertMentions(rootReadmeText, /inspection-evidence\.intake-report/, 'root README should document the tracked intake report artifact type');
assertMentions(rootReadmeText, /intake reports are discovery\/review artifacts only/, 'root README should keep intake reports out of inspection evidence');
assertMentions(rootReadmeText, /Do not treat synthetic fixtures or generated CAD\/drawing\/readiness outputs as package inspection evidence/, 'root README should reject synthetic/generated package evidence');
assertMentions(rootReadmeText, /quality\/drawing evidence does not satisfy `inspection_evidence`/, 'root README should preserve the inspection evidence boundary');
assertMentions(rootReadmeText, /`generated_shape_geometry` marks measurements captured from the FreeCAD shape that `fcad create` generated before export/, 'root README should define generated_shape_geometry as pre-export generated-shape evidence');
assertMentions(rootReadmeText, /`reimported_step_geometry` marks measurements captured only after the exported STEP file is re-imported/, 'root README should define reimported_step_geometry as STEP reimport evidence');
assertMentions(rootReadmeText, /STEP round-trip evidence for the exported file, not a replacement source for generated-shape checks/, 'root README should keep STEP reimport evidence separate from generated-shape checks');
assertMentions(rootReadmeText, /unavailable STEP geometry state instead of fake measurements/, 'root README should describe unavailable STEP geometry as explicit unavailable evidence');
assertMentions(rootReadmeText, /Unavailable STEP geometry is reported as explicit unavailable provenance, not inferred or synthetic measurement evidence/, 'root README should reject synthetic STEP geometry measurements');
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
assertMentions(
  rootReadmeText,
  /\[final maintainer handoff\]\(\.\/docs\/final-maintainer-handoff\.md\)/,
  'root README should link the final maintainer handoff'
);
assertMentions(
  rootReadmeText,
  /\[Stage 5B automation closeout status\]\(\.\/docs\/stage-5b-automation-closeout-status\.md\)/,
  'root README should link the Stage 5B automation closeout status'
);
assertMentions(
  rootReadmeText,
  /\[release candidate closeout gap ledger\]\(\.\/docs\/release-candidate-closeout-gap-ledger\.md\)/,
  'root README should link the release candidate closeout gap ledger'
);
assertMentions(
  rootReadmeText,
  /\[Stage 5B operational runbook\]\(\.\/docs\/stage-5b-operational-runbook\.md\)/,
  'root README should link the Stage 5B operational runbook'
);
assertMentions(
  rootReadmeText,
  /\[Stage 5B evidence request packet\]\(\.\/docs\/stage-5b-evidence-request-packet\.md\)/,
  'root README should link the Stage 5B evidence request packet'
);
assertMentions(
  rootReadmeText,
  /\[Stage 5B attachment authorization record\]\(\.\/docs\/stage-5b-attachment-authorization-record\.md\)/,
  'root README should link the Stage 5B attachment authorization record'
);
assertMentions(
  rootReadmeText,
  /\[Stage 5D feature expansion closeout\]\(\.\/docs\/stage-5d-feature-expansion-closeout\.md\)/,
  'root README should link the Stage 5D feature expansion closeout'
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
assertMentions(
  projectCloseoutStatusText,
  /\[final maintainer handoff\]\(\.\/final-maintainer-handoff\.md\)/,
  'project closeout should link the final maintainer handoff'
);
assertMentions(
  projectCloseoutStatusText,
  /\[Stage 5D feature expansion closeout\]\(\.\/stage-5d-feature-expansion-closeout\.md\)/,
  'project closeout should link the Stage 5D feature expansion closeout'
);
assertMentions(projectCloseoutStatusText, /config\s+-> cad\/export\s+-> quality\/drawing\s+-> review_pack\s+-> readiness_report\s+-> standard_docs\s+-> release_bundle\s+-> Studio reopen\/preview/, 'project closeout should include current artifact chain');
assertMentions(projectCloseoutStatusText, /Freeze Handoff Stop Point/, 'project closeout should include final freeze stop point');
assertMentions(projectCloseoutStatusText, /Stop active hardening unless a later authorized evidence task brings genuine\s+completed inspection records/, 'project closeout should stop active hardening until genuine records arrive');
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

assertMentions(
  finalMaintainerHandoffText,
  /^# Final maintainer handoff/m,
  'final maintainer handoff should have the expected title'
);
assertMentions(finalMaintainerHandoffText, /735e991d40d33b69987a4ddd52db810791e968d3/, 'final maintainer handoff should pin the current default-branch head');
assertMentions(finalMaintainerHandoffText, /PR \[#165\]/, 'final maintainer handoff should cite PR #165');
assertMentions(finalMaintainerHandoffText, /27058839538/, 'final maintainer handoff should record the post-merge hosted CI run');
assertMentions(finalMaintainerHandoffText, /27058885140/, 'final maintainer handoff should record the post-merge runtime smoke run');
assertMentions(finalMaintainerHandoffText, /Stage 5B and CI governance are closed through PR #162/, 'final maintainer handoff should preserve Stage 5B/CI governance closeout');
assertMentions(finalMaintainerHandoffText, /release dry-run governance is closed through PR #163/, 'final maintainer handoff should record release dry-run governance closeout');
assertMentions(finalMaintainerHandoffText, /maintainer doctor is closed through PR #164/, 'final maintainer handoff should record maintainer doctor closeout');
assertMentions(finalMaintainerHandoffText, /bootstrap doctor is closed through PR #165/, 'final maintainer handoff should record bootstrap doctor closeout');
assertMentions(finalMaintainerHandoffText, /Weekly default-branch drift check/, 'final maintainer handoff should include weekly commands');
assertMentions(finalMaintainerHandoffText, /Before release publication review/, 'final maintainer handoff should include before-release commands');
assertMentions(finalMaintainerHandoffText, /When genuine completed inspection evidence arrives/, 'final maintainer handoff should include real-evidence commands');
assertMentions(finalMaintainerHandoffText, /Stop conditions/, 'final maintainer handoff should include stop conditions');
assertMentions(finalMaintainerHandoffText, /no open PR rows/i, 'final maintainer handoff should record open PR state');
assertMentions(finalMaintainerHandoffText, /No genuine completed inspection evidence has been found or attached/i, 'final maintainer handoff should preserve no-evidence truth');
assertMentions(finalMaintainerHandoffText, /`needs_more_evidence`/, 'final maintainer handoff should mention needs_more_evidence');
assertMentions(finalMaintainerHandoffText, /`hold_for_evidence_completion`/, 'final maintainer handoff should mention hold_for_evidence_completion');
assertMentions(finalMaintainerHandoffText, /Stop active hardening/, 'final maintainer handoff should state the stop point');
assertMentions(finalMaintainerHandoffText, /genuine completed physical, supplier, lab, or QA inspection\s+records arrive/, 'final maintainer handoff should name the next condition');
assertNoPositiveProductionReadyClaim(finalMaintainerHandoffText, 'final maintainer handoff should not claim production readiness');
assertNoPositiveCloseoutOverclaim(finalMaintainerHandoffText, 'final maintainer handoff');
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

assertMentions(
  stage5bAutomationCloseoutText,
  /^# Stage 5B automation closeout status/m,
  'Stage 5B automation closeout should have the expected title'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /\[Stage 5B operational runbook\]\(\.\/stage-5b-operational-runbook\.md\)/,
  'Stage 5B automation closeout should link the operational runbook'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /\[Stage 5B evidence request packet\]\(\.\/stage-5b-evidence-request-packet\.md\)/,
  'Stage 5B automation closeout should link the evidence request packet'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /\[Stage 5B attachment authorization record\]\(\.\/stage-5b-attachment-authorization-record\.md\)/,
  'Stage 5B automation closeout should link the attachment authorization record'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/,
  'Stage 5B automation closeout should link the artifact/schema catalog'
);
for (const pr of ['#113', '#114', '#115', '#116', '#117', '#118', '#119', '#120', '#121', '#130', '#131', '#132', '#133', '#134', '#135', '#136', '#137', '#138', '#139', '#140', '#141', '#142', '#143', '#144', '#145', '#146', '#147', '#148', '#149', '#150', '#151', '#152', '#153', '#155', '#156', '#157', '#158', '#159', '#160', '#161']) {
  assert.equal(stage5bAutomationCloseoutText.includes(pr), true, `Stage 5B automation closeout should mention PR ${pr}`);
}
assertMentions(stage5bAutomationCloseoutText, /through PR \[#161\]/, 'Stage 5B automation closeout should state the current PR chain endpoint');
for (const surface of [
  'inspection-evidence-intake',
  'table normalization',
  'include_github discovery',
  'attachment planning',
  'inspection-evidence-promotion-dry-run',
  'promotion dry-run',
  'stage5b-evidence-audit',
  'stage5b-surrogate-inspection-validation',
  'stage5b-evidence-source-kit',
  'stage5b-evidence-source-preflight',
  'stage5b-evidence-review-dry-run',
  'stage5b-evidence-attachment-controller',
  'stage5b-evidence-pipeline-doctor',
  'artifact/schema catalog',
  'attachment authorization record',
  'validation diagnostics',
  'tracked API/Studio review surfaces',
  'release bundle reproducibility',
  'first-user E2E',
  'local API schema parity',
  'Studio API fuzz',
  'runtime output contract',
  'CI/source hygiene',
  'workflow provenance pinning',
  'self-hosted runtime governance',
  'attachment provenance',
  'RC gap ledger handoff',
]) {
  assert.equal(
    stage5bAutomationCloseoutText.includes(surface),
    true,
    `Stage 5B automation closeout should mention ${surface}`
  );
}
assertMentions(
  stage5bAutomationCloseoutText,
  /no genuine completed inspection evidence (?:was|has been) found or attached/i,
  'Stage 5B automation closeout should state no genuine completed inspection evidence was found or attached'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /promotion cannot run/i,
  'Stage 5B automation closeout should state promotion cannot run'
);
assertMentions(
  stage5bAutomationCloseoutText,
  /`needs_more_evidence` \/ `hold_for_evidence_completion`/,
  'Stage 5B automation closeout should preserve readiness-held package truth'
);
for (const boundary of [
  'generated artifacts',
  'fixtures',
  'intake reports',
  'dry-run manifests',
  'audit manifests',
  'screenshots',
  'CI summaries',
  'GitHub metadata',
  'authorization records',
  'templates',
  'collection guides',
]) {
  assert.equal(
    stage5bAutomationCloseoutText.includes(boundary),
    true,
    `Stage 5B automation closeout should reject ${boundary} as inspection evidence`
  );
}
assertMentions(
  stage5bAutomationCloseoutText,
  /Generated\/fake\/human-entered measurements are not created or accepted/,
  'Stage 5B automation closeout should reject generated, fake, or human-entered measurements'
);
assertNoPositiveProductionReadyClaim(stage5bAutomationCloseoutText, 'Stage 5B automation closeout should not claim production readiness');
assertNoPositiveCloseoutOverclaim(stage5bAutomationCloseoutText, 'Stage 5B automation closeout');
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    stage5bAutomationCloseoutText.includes(`\`${slug}\``),
    true,
    `Stage 5B automation closeout should mention ${slug}`
  );
}

assertMentions(
  releaseCandidateGapLedgerText,
  /^# Release candidate closeout gap ledger/m,
  'release candidate gap ledger should have the expected title'
);
assertMentions(releaseCandidateGapLedgerText, /PR \[#153\]/, 'release candidate gap ledger should reference PR #153');
assertMentions(releaseCandidateGapLedgerText, /95a471971a2b8462813683060b5197b42bdd2760/, 'release candidate gap ledger should pin the audited head');
assertMentions(releaseCandidateGapLedgerText, /no open PR rows/i, 'release candidate gap ledger should record open PR state');
assertMentions(releaseCandidateGapLedgerText, /no open issue rows/i, 'release candidate gap ledger should record open issue state');
assertMentions(releaseCandidateGapLedgerText, /Automation CI \(hosted fast lanes\).*passed/i, 'release candidate gap ledger should record hosted CI state');
assertMentions(releaseCandidateGapLedgerText, /FreeCAD Runtime Smoke \(self-hosted macOS\).*passed/i, 'release candidate gap ledger should record self-hosted runtime smoke state');
for (const section of [
  'Complete software/control surfaces',
  'Readiness truth',
  'Still requires real inspection evidence',
  'Human or organization-settings dependent',
  'Must not be treated as evidence',
  'Stop point',
]) {
  assert.equal(releaseCandidateGapLedgerText.includes(section), true, `release candidate gap ledger should include ${section}`);
}
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    releaseCandidateGapLedgerText.includes(`\`${slug}\``),
    true,
    `release candidate gap ledger should mention ${slug}`
  );
}
for (const boundary of [
  'metadata',
  'CI logs',
  'screenshots',
  'diagnostics',
  'release bundles',
  'generated outputs',
  'authorization records',
  'GitHub issues',
  'CI/GitHub metadata',
  'CAD-generated',
]) {
  assert.equal(
    releaseCandidateGapLedgerText.includes(boundary),
    true,
    `release candidate gap ledger should reject ${boundary} as inspection evidence`
  );
}
assertMentions(
  releaseCandidateGapLedgerText,
  /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy/,
  'release candidate gap ledger should preserve the hard evidence rule'
);
assertMentions(
  releaseCandidateGapLedgerText,
  /No genuine completed inspection evidence has been found or attached/i,
  'release candidate gap ledger should state no genuine completed inspection evidence was found or attached'
);
assertMentions(
  releaseCandidateGapLedgerText,
  /Promotion\s+cannot run/i,
  'release candidate gap ledger should state promotion cannot run'
);
assertMentions(
  releaseCandidateGapLedgerText,
  /`needs_more_evidence` \/ `hold_for_evidence_completion`/,
  'release candidate gap ledger should preserve readiness-held package truth'
);
assertMentions(
  releaseCandidateGapLedgerText,
  /Stop active hardening/,
  'release candidate gap ledger should state the final freeze stop point'
);
assertNoPositiveProductionReadyClaim(releaseCandidateGapLedgerText, 'release candidate gap ledger should not claim production readiness');
assertNoPositiveCloseoutOverclaim(releaseCandidateGapLedgerText, 'release candidate gap ledger');

assertMentions(
  stage5bOperationalRunbookText,
  /^# Stage 5B operational runbook/m,
  'Stage 5B operational runbook should have the expected title'
);
assertMentions(
  stage5bOperationalRunbookText,
  /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/,
  'Stage 5B runbook should link the artifact/schema catalog'
);
for (const section of [
  'Quick CLI Path',
  'Candidate Acceptance Gate',
  'Pre-Attachment Review Checklist',
  'Attachment Authorization Record',
  'Artifact/Schema Catalog',
  'API And Tracked Job Path',
  'Studio Review Path',
  'Promotion Dry-Run Meaning',
  'Diagnostics Meaning',
  'What Never Counts As Inspection Evidence',
  'Future Genuine-Evidence Path',
  'Validation Commands',
]) {
  assert.equal(stage5bOperationalRunbookText.includes(section), true, `Stage 5B runbook should include ${section}`);
}
for (const command of [
  'scripts/stage5b-candidate-evidence-gate.js',
  'inspection-evidence-intake',
  'inspection-evidence-promotion-dry-run',
  'stage5b-evidence-audit',
]) {
  assert.equal(stage5bOperationalRunbookText.includes(command), true, `Stage 5B runbook should mention ${command}`);
}
for (const artifact of [
  'intake_report.json',
  'promotion_dry_run_manifest.json',
  'stage5b_audit_manifest.json',
  'stage5b_audit_summary.md',
  'inspection-evidence.intake-report',
  'inspection-evidence.promotion-dry-run-manifest',
  'stage5b.evidence-audit-manifest',
  'stage5b.evidence-audit-summary',
  'stage5b.validation-diagnostics',
  'stage-5b-attachment-authorization-record.md',
]) {
  assert.equal(stage5bOperationalRunbookText.includes(artifact), true, `Stage 5B runbook should mention ${artifact}`);
}
assertMentions(stage5bOperationalRunbookText, /Genuine candidate found: no/, 'Stage 5B runbook should state expected no-evidence CLI output');
assertMentions(stage5bOperationalRunbookText, /Inspection evidence attached: no/, 'Stage 5B runbook should state no evidence attachment');
assertMentions(stage5bOperationalRunbookText, /Promotion can run: no/, 'Stage 5B runbook should state expected no-promotion output');
assertMentions(stage5bOperationalRunbookText, /Readiness remains held: yes/, 'Stage 5B runbook should state expected held-readiness output');
assertMentions(stage5bOperationalRunbookText, /`needs_more_evidence`/, 'Stage 5B runbook should mention needs_more_evidence');
assertMentions(stage5bOperationalRunbookText, /`hold_for_evidence_completion`/, 'Stage 5B runbook should mention hold_for_evidence_completion');
assertMentions(stage5bOperationalRunbookText, /`inspection_evidence`/, 'Stage 5B runbook should mention inspection_evidence');
assertMentions(stage5bOperationalRunbookText, /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy inspection_evidence/, 'Stage 5B runbook should preserve hard evidence rule');
for (const boundary of [
  'diagnostics',
  'schemas',
  'fixtures',
  'CI metadata',
  'screenshots',
  'intake reports',
  'promotion dry-run manifests',
  'audit manifests',
  'GitHub metadata',
  'PR bodies',
  'docs artifacts',
  'release bundles',
  'templates',
  'collection guides',
  'human-typed, inferred, simulated, synthetic, CAD-generated, or guessed measurements',
]) {
  assert.equal(
    stage5bOperationalRunbookText.includes(boundary),
    true,
    `Stage 5B runbook should reject ${boundary} as inspection evidence`
  );
}
assertMentions(stage5bOperationalRunbookText, /review-context --inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>/, 'Stage 5B runbook should preserve future genuine evidence path');
assertMentions(stage5bOperationalRunbookText, /eligible_for_stage5b_intake_review: true/, 'Stage 5B runbook should document candidate gate acceptance wording');
for (const checklistItem of [
  'Accepted gate report',
  'Provenance and reviewer traceability',
  'Package / part / revision mapping',
  'Redaction and privacy review',
  'Path safety',
  'Next intake, dry-run, and audit commands',
  'Attachment authorization record',
  'Authorization before attachment',
  'Exact later attachment task boundary',
  'Readiness-held truth',
]) {
  assert.equal(
    stage5bOperationalRunbookText.includes(checklistItem),
    true,
    `Stage 5B runbook should include pre-attachment checklist item ${checklistItem}`
  );
  assert.equal(
    stage5bEvidenceRequestPacketText.includes(checklistItem),
    true,
    `Stage 5B evidence request packet should include pre-attachment checklist item ${checklistItem}`
  );
}
assertMentions(stage5bOperationalRunbookText, /node tests\/stage5b-candidate-evidence-gate\.test\.js/, 'Stage 5B runbook should list candidate gate validation');
assertMentions(stage5bOperationalRunbookText, /node tests\/stage5b-source-of-truth-guard\.test\.js/, 'Stage 5B runbook should list source-of-truth validation');
assertMentions(stage5bOperationalRunbookText, /node tests\/stage5b-artifact-catalog\.test\.js/, 'Stage 5B runbook should list catalog validation');
assertNoPositiveProductionReadyClaim(stage5bOperationalRunbookText, 'Stage 5B runbook should not claim production readiness');

assertMentions(
  stage5bEvidenceRequestPacketText,
  /^# Stage 5B evidence request packet/m,
  'Stage 5B evidence request packet should have the expected title'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /request\/checklist control document/,
  'Stage 5B evidence request packet should label itself as a control document'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /not `inspection_evidence`/,
  'Stage 5B evidence request packet should not claim to be evidence'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /no genuine completed inspection evidence has been found or\s+attached/i,
  'Stage 5B evidence request packet should preserve no-evidence truth'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /`needs_more_evidence`/,
  'Stage 5B evidence request packet should mention needs_more_evidence'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /`hold_for_evidence_completion`/,
  'Stage 5B evidence request packet should mention hold_for_evidence_completion'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /Only genuine completed physical\/supplier\/lab\/QA inspection\s+records can satisfy `?inspection_evidence`?/,
  'Stage 5B evidence request packet should preserve hard evidence rule'
);
for (const origin of [
  'physical inspection',
  'supplier inspection report',
  'lab inspection report',
  'QA inspection',
]) {
  assert.equal(
    stage5bEvidenceRequestPacketText.includes(origin),
    true,
    `Stage 5B evidence request packet should accept ${origin}`
  );
}
for (const requiredField of [
  'Package or part mapping',
  'Revision mapping',
  'Inspection date',
  'Completion status',
  'Overall result',
  'Inspector and reviewer',
  'Provenance',
  'Feature evidence',
]) {
  assert.equal(
    stage5bEvidenceRequestPacketText.includes(requiredField),
    true,
    `Stage 5B evidence request packet should require ${requiredField}`
  );
}
assertMentions(
  stage5bEvidenceRequestPacketText,
  /node scripts\/stage5b-candidate-evidence-gate\.js --candidate <repo-relative-json> --out <report\.json>/,
  'Stage 5B evidence request packet should document the candidate gate command'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /eligible_for_stage5b_intake_review: true/,
  'Stage 5B evidence request packet should document candidate acceptance meaning'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /Pre-Attachment Review Checklist/,
  'Stage 5B evidence request packet should document the pre-attachment checklist'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/,
  'Stage 5B evidence request packet should link the artifact/schema catalog'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /\[Stage 5B attachment authorization record\]\(\.\/stage-5b-attachment-authorization-record\.md\)/,
  'Stage 5B evidence request packet should link the attachment authorization record'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /Schema\s+discoverability does not make the report evidence/,
  'Stage 5B evidence request packet should keep candidate gate schema discoverability non-evidence'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /fcad inspection-evidence-intake --out <report\.json>/,
  'Stage 5B evidence request packet should document intake after candidate acceptance'
);
assertMentions(
  stage5bEvidenceRequestPacketText,
  /fcad inspection-evidence-promotion-dry-run --intake-report <report\.json> --out <promotion_dry_run_manifest\.json>/,
  'Stage 5B evidence request packet should document dry-run after candidate acceptance'
);
for (const boundary of [
  'diagnostics',
  'schemas',
  'fixtures',
  'intake reports',
  'promotion dry-run manifests',
  'audit outputs',
  'generated examples',
  'screenshots',
  'comments',
  'PR bodies',
  'authorization records',
  'docs',
  'release bundles',
  'CAD-generated measurements',
  'CI/GitHub metadata',
]) {
  assert.equal(
    stage5bEvidenceRequestPacketText.includes(boundary),
    true,
    `Stage 5B evidence request packet should reject ${boundary}`
  );
}
assertNoPositiveProductionReadyClaim(stage5bEvidenceRequestPacketText, 'Stage 5B evidence request packet should not claim production readiness');

assertMentions(
  stage5bAttachmentAuthorizationRecordText,
  /^# Stage 5B attachment authorization record/m,
  'Stage 5B attachment authorization record should have the expected title'
);
assertMentions(stage5bAttachmentAuthorizationRecordText, /control metadata, not `?inspection_evidence`?/i, 'authorization record should be control metadata only');
for (const item of [
  'Accepted candidate gate report',
  'Redaction/privacy review complete',
  'Provenance/reviewer traceability confirmed',
  'Package/part/revision mapping confirmed',
  'Intake/dry-run/audit outputs reviewed',
  'Explicit human authorization before attachment',
  'Exact later task boundary for attachment',
  'Readiness remains held until authorized attachment occurs',
]) {
  assert.equal(stage5bAttachmentAuthorizationRecordText.includes(item), true, `authorization record should include ${item}`);
}
assertMentions(stage5bAttachmentAuthorizationRecordText, /review-context --inspection-evidence/, 'authorization record should name the later attachment command boundary');
assertMentions(stage5bAttachmentAuthorizationRecordText, /authorization records? do not attach evidence/i, 'authorization record should deny self-evidence status');
assertMentions(stage5bAttachmentAuthorizationRecordText, /PR comments? do not attach evidence/i, 'authorization record should reject PR comments as evidence attachment');
assertMentions(stage5bAttachmentAuthorizationRecordText, /Only genuine completed physical\/supplier\/lab\/QA inspection records can satisfy `?inspection_evidence`?/, 'authorization record should preserve hard evidence rule');
assertMentions(stage5bAttachmentAuthorizationRecordText, /`needs_more_evidence` \/ `hold_for_evidence_completion`/, 'authorization record should preserve readiness-held truth');
assertNoPositiveProductionReadyClaim(stage5bAttachmentAuthorizationRecordText, 'Stage 5B attachment authorization record should not claim production readiness');

assertMentions(
  stage5bArtifactSchemaCatalogText,
  /^# Stage 5B artifact\/schema catalog/m,
  'Stage 5B artifact/schema catalog should have the expected title'
);
assertMentions(stage5bArtifactSchemaCatalogText, /schemas\/stage5b-candidate-gate-report\.schema\.json/, 'catalog should make the candidate gate report schema discoverable');
assertMentions(stage5bArtifactSchemaCatalogText, /docs\/stage-5b-attachment-authorization-record\.md/, 'catalog should include the attachment authorization record');
assertMentions(stage5bArtifactSchemaCatalogText, /validation_diagnostics\.json/, 'catalog should include validation diagnostics');
assertMentions(stage5bArtifactSchemaCatalogText, /inspection-evidence\.intake-report/, 'catalog should document tracked intake preview');
assertMentions(stage5bArtifactSchemaCatalogText, /stage5b\.validation-diagnostics/, 'catalog should document tracked diagnostics preview');
assertMentions(stage5bArtifactSchemaCatalogText, /Not inspection_evidence/, 'catalog should state artifacts are not inspection evidence');
assertMentions(stage5bArtifactSchemaCatalogText, /needs_more_evidence/, 'catalog should preserve needs_more_evidence truth');
assertMentions(stage5bArtifactSchemaCatalogText, /hold_for_evidence_completion/, 'catalog should preserve readiness-held truth');
assertMentions(stage5bArtifactSchemaCatalogText, /Only genuine completed physical\/supplier\/lab\/QA inspection\s+records can satisfy `?inspection_evidence`?/, 'catalog should preserve hard evidence rule');
assertNoPositiveProductionReadyClaim(stage5bArtifactSchemaCatalogText, 'Stage 5B artifact/schema catalog should not claim production readiness');

assertMentions(
  stage5dCloseoutText,
  /^# Stage 5D feature expansion closeout/m,
  'Stage 5D closeout should have the expected title'
);
assertMentions(stage5dCloseoutText, /Stage 5D-A: roadmap/, 'Stage 5D closeout should mention the Stage 5D-A roadmap');
assertMentions(stage5dCloseoutText, /Stage 5D-B: candidate selection/, 'Stage 5D closeout should mention Stage 5D-B candidate selection');
for (const pr of ['#91', '#92', '#93', '#94', '#95']) {
  assert.equal(stage5dCloseoutText.includes(pr), true, `Stage 5D closeout should mention PR ${pr}`);
}
for (const slug of CANONICAL_PACKAGES) {
  assert.equal(
    stage5dCloseoutText.includes(`\`${slug}\``),
    true,
    `Stage 5D closeout should mention ${slug}`
  );
}
assertMentions(stage5dCloseoutText, /`hinge-block` is the fifth canonical package/, 'Stage 5D closeout should identify hinge-block as fifth package');
assertMentions(stage5dCloseoutText, /`needs_more_evidence`/, 'Stage 5D closeout should mention needs_more_evidence');
assertMentions(stage5dCloseoutText, /`hold_for_evidence_completion`/, 'Stage 5D closeout should mention hold_for_evidence_completion');
assertMentions(stage5dCloseoutText, /`inspection_evidence`/, 'Stage 5D closeout should mention inspection_evidence');
assertMentions(stage5dCloseoutText, /Stage 5B remains parked/, 'Stage 5D closeout should keep Stage 5B parked');
assertMentions(stage5dCloseoutText, /No real inspection evidence was created or attached/, 'Stage 5D closeout should state no real inspection evidence was attached');
assertMentions(
  stage5dCloseoutText,
  /Generated CAD, drawing, quality, review, readiness, standard-doc, release, reopen, package, Markdown, fixture, and collection-guide artifacts are not `inspection_evidence`/,
  'Stage 5D closeout should reject generated artifacts as inspection evidence'
);
assertMentions(
  stage5dCloseoutText,
  /`release_bundle\.zip` is a package transport artifact/,
  'Stage 5D closeout should preserve release bundle transport boundary'
);
assertMentions(
  stage5dCloseoutText,
  /`release_bundle\.zip` is not production-readiness proof/,
  'Stage 5D closeout should reject release bundle production-readiness proof'
);
assertMentions(
  stage5dCloseoutText,
  /non-previewable, non-downloadable, and non-openable/,
  'Stage 5D closeout should preserve release bundle non-action boundary'
);
assertMentions(stage5dCloseoutText, /No deploy was performed/, 'Stage 5D closeout should state no deploy was performed');
assertMentions(stage5dCloseoutText, /No Studio\/API preview, download, or open route widening was added/, 'Stage 5D closeout should reject route widening');
assertNoPositiveProductionReadyClaim(stage5dCloseoutText, 'Stage 5D closeout should not claim production readiness');

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
assertMentions(studioFirstUserWalkthroughText, /Run Stage 5B audit from Review/, 'Studio walkthrough should document the Stage 5B audit review workflow');
assertMentions(
  studioFirstUserWalkthroughText,
  /\[Stage 5B operational runbook\]\(\.\/stage-5b-operational-runbook\.md\)/,
  'Studio walkthrough should link the Stage 5B operational runbook'
);
assertMentions(studioFirstUserWalkthroughText, /genuine evidence found, promotion can run, attachment-ready count, blockers, package readiness states, GitHub summary, next safe commands, readiness-held truth, and the evidence boundary/, 'Studio walkthrough should describe the audit summary fields');
assertMentions(studioFirstUserWalkthroughText, /Readiness remains held when accepted count is `0`/, 'Studio walkthrough should explain the no-valid-evidence state');
assertMentions(studioFirstUserWalkthroughText, /preview audit artifacts only through tracked job artifact routes/, 'Studio walkthrough should preserve tracked-audit preview safety');
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
assertMentions(
  testingDocText,
  /Stage 5B automation closeout status/,
  'testing doc should document Stage 5B automation closeout docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /release-candidate closeout gap ledger/,
  'testing doc should document release candidate gap ledger docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /Stage 5B operational runbook/,
  'testing doc should document Stage 5B operational runbook docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /Stage 5D feature expansion closeout/,
  'testing doc should document Stage 5D closeout docs-smoke coverage'
);
assertMentions(
  testingDocText,
  /Stage 5B inspection evidence audit\/intake Studio\/API review surface/,
  'testing doc should document Stage 5B audit/intake Studio/API test coverage'
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
assertMentions(inspectionContractText, /fcad inspection-evidence-intake/, 'contract doc should document autonomous evidence intake reporting');
assertMentions(inspectionContractText, /CSV, TSV, or Markdown tables/, 'contract doc should document machine-readable table adapter coverage');
assertMentions(inspectionContractText, /does not infer or generate measurement values/, 'contract doc should keep table normalization inside the evidence boundary');
assertMentions(inspectionContractText, /Tracked Studio\/API intake reports are discovery\/review artifacts only/, 'contract doc should keep tracked intake reports out of inspection evidence');
assertMentions(inspectionContractText, /Report preview is limited to registered tracked job artifacts/, 'contract doc should document preview allowlisting');
assertMentions(inspectionContractText, /is not package readiness evidence/, 'contract doc should state the fixture is not package readiness evidence');
assertMentions(inspectionContractText, /The guide is not readiness evidence/, 'contract doc should treat the collection guide as non-canonical guidance');

console.log('first-user-docs-smoke.test.js: ok');

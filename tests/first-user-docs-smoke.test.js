import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ROOT_README_PATH = resolve(ROOT, 'README.md');
const EXAMPLE_INDEX_PATH = resolve(ROOT, 'docs', 'examples', 'README.md');
const INSPECTION_CONTRACT_PATH = resolve(ROOT, 'docs', 'inspection-evidence-contract.md');
const QUALITY_PASS_COLLECTION_GUIDE_PATH = resolve(
  ROOT,
  'docs',
  'inspection-evidence-collection',
  'quality-pass-bracket.md'
);
const SYNTHETIC_FIXTURE_REF = 'tests/fixtures/inspection-evidence/valid-manual-caliper-inspection.json';

const CANONICAL_PACKAGES = Object.freeze([
  'quality-pass-bracket',
  'plate-with-holes',
  'motor-mount',
  'controller-housing-eol',
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

function parseCanonicalPackageList(markdown) {
  const matches = markdown.matchAll(/^- \[`([^`]+)`\]\(\.\/[^)]+\/README\.md\)$/gm);
  return Array.from(matches, (match) => match[1]);
}

assert.equal(existsSync(ROOT_README_PATH), true, 'root README should exist');
assert.equal(existsSync(EXAMPLE_INDEX_PATH), true, 'canonical example index should exist');
assert.equal(existsSync(INSPECTION_CONTRACT_PATH), true, 'inspection evidence contract should exist');
assert.equal(
  existsSync(QUALITY_PASS_COLLECTION_GUIDE_PATH),
  true,
  'quality-pass-bracket inspection collection guide should exist'
);

const rootReadmeText = readText(ROOT_README_PATH);
const exampleIndexText = readText(EXAMPLE_INDEX_PATH);
const inspectionContractText = readText(INSPECTION_CONTRACT_PATH);
const collectionGuideText = readText(QUALITY_PASS_COLLECTION_GUIDE_PATH);

assertMentions(
  rootReadmeText,
  /\[canonical example library\]\(\.\/docs\/examples\/README\.md\)/,
  'root README should point first users to docs/examples/README.md'
);
assertMentions(rootReadmeText, /First-user CLI recipe: inspect a canonical package/, 'root README should include the first-user CLI recipe');
assertMentions(rootReadmeText, /inspect checked-in canonical package artifacts without regenerating anything/, 'CLI recipe should inspect checked-in artifacts');
assertMentions(rootReadmeText, /Regenerate later only when/, 'CLI recipe should distinguish future regeneration from inspection');
assertMentions(rootReadmeText, /Studio supports tracked job\/artifact reopen/, 'root README should distinguish Studio tracked reopen');
assertMentions(rootReadmeText, /checked-in canonical packages are docs-package artifacts today/, 'root README should describe checked-in packages as docs-package artifacts');
assertMentions(rootReadmeText, /--inspection-evidence <PATH_TO_COMPLETED_REAL_JSON>/, 'root README should show the completed-real-evidence CLI placeholder');
assertMentions(rootReadmeText, /Do not treat synthetic fixtures or generated CAD\/drawing\/readiness outputs as package inspection evidence/, 'root README should reject synthetic/generated package evidence');
assertMentions(rootReadmeText, /quality\/drawing evidence does not satisfy `inspection_evidence`/, 'root README should preserve the inspection evidence boundary');
assertMentions(rootReadmeText, new RegExp(SYNTHETIC_FIXTURE_REF), 'root README should explicitly reject the synthetic fixture as package evidence');

assert.deepEqual(
  parseCanonicalPackageList(exampleIndexText),
  CANONICAL_PACKAGES,
  'example index should list exactly the four canonical packages in first-user order'
);
assertMentions(exampleIndexText, /readiness_report\.json` is the readiness source of truth/, 'example index should name readiness_report.json as source of truth');
assertMentions(exampleIndexText, /quality and drawing evidence is review evidence.*does not satisfy `inspection_evidence`/, 'example index should preserve the generated-evidence boundary');

for (const slug of CANONICAL_PACKAGES) {
  const packageRoot = resolve(ROOT, 'docs', 'examples', slug);
  const packageReadmePath = join(packageRoot, 'README.md');
  const readinessReportPath = join(packageRoot, 'readiness', 'readiness_report.json');
  const reviewPackPath = join(packageRoot, 'review', 'review_pack.json');
  const inspectionEvidencePath = join(packageRoot, 'inspection', 'inspection_evidence.json');

  assert.equal(existsSync(packageReadmePath), true, `${slug} README should exist`);
  assert.equal(existsSync(readinessReportPath), true, `${slug} readiness_report.json should exist`);
  assert.equal(existsSync(reviewPackPath), true, `${slug} review_pack.json should exist`);
  assert.equal(existsSync(inspectionEvidencePath), false, `${slug} should not have canonical inspection_evidence.json`);

  const packageReadmeText = readText(packageReadmePath);
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
}

assertMentions(collectionGuideText, /This guide is not readiness evidence/, 'collection guide should identify itself as a guide, not evidence');
assertMentions(collectionGuideText, /Do not use it as package evidence/, 'collection guide should reject the Stage 2 fixture as package evidence');
assertMentions(collectionGuideText, /Measured values must come from real physical inspection or a supplier/, 'collection guide should require real measurements');
assertMentions(inspectionContractText, /is not package readiness evidence/, 'contract doc should state the fixture is not package readiness evidence');
assertMentions(inspectionContractText, /The guide is not readiness evidence/, 'contract doc should treat the collection guide as non-canonical guidance');

console.log('first-user-docs-smoke.test.js: ok');

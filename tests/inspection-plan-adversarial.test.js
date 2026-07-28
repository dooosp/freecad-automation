import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { parseInspectionEvidenceJsonBytes } from '../lib/inspection-evidence-onboarding.js';
import { validateInspectionEvidenceSourceContainer } from '../src/services/inspection-evidence-intake/inspection-evidence-onboarding-service.js';
import { buildInspectionPlan, createInspectionPlanFromPaths, renderInspectionResultTemplate } from '../src/services/inspection-plan/inspection-plan-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const REVIEW = resolve(ROOT, 'tests/fixtures/revision-impact/tightened-tolerance-candidate-review-pack.json');
const generatedAt = '2026-07-12T00:00:00Z';
await mkdir(resolve(ROOT, 'tmp/codex'), { recursive: true });
const temp = await mkdtemp(join(resolve(ROOT, 'tmp/codex'), 'inspection-adversarial-'));
try {
  const badInputs = [
    ['duplicate.json', Buffer.from('{"artifact_type":"inspection_requirements","artifact_type":"inspection_requirements","items":[]}'), /duplicate/i],
    ['bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"artifact_type":"inspection_requirements","items":[]}')]), /BOM/i],
    ['utf8.json', Buffer.from([0xff, 0xfe, 0xfd]), /UTF|encoded|JSON/i],
    ['deep.json', Buffer.from(`${'{"a":'.repeat(270)}0${'}'.repeat(270)}`), /nesting/i],
  ];
  for (const [name, bytes, pattern] of badInputs) {
    const path = join(temp, name); await writeFile(path, bytes);
    await assert.rejects(createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW, requirementsPath: path, trustedInputRoots: [temp], scope: 'full', generatedAt }), pattern);
  }
  const oversized = join(temp, 'oversized.json'); await writeFile(oversized, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
  await assert.rejects(createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW, requirementsPath: oversized, trustedInputRoots: [temp], scope: 'full', generatedAt }), /bounded|oversized/i);

  assert.throws(() => parseInspectionEvidenceJsonBytes(Buffer.from('{"x":1,"x":2}'), { requireCanonical: false }), /duplicate/i);
  assert.equal(validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('a,a\n1,2\n')).errors.includes('csv_header_duplicate'), true);
  assert.equal(validateInspectionEvidenceSourceContainer('text/csv', Buffer.from('a,b\n"unterminated,2\n')).errors.includes('csv_unterminated_quote'), true);

  const review = JSON.parse(await (await import('node:fs/promises')).readFile(REVIEW, 'utf8'));
  const matrix = JSON.parse(await (await import('node:fs/promises')).readFile(resolve(ROOT, 'tests/fixtures/inspection-plan/case-matrix.json'), 'utf8'));
  assert.equal(matrix.production_trust, false); assert.equal(matrix.cases.length, 20); assert.equal(new Set(matrix.cases.map((entry) => entry.id)).size, 20);
  const noTolerance = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW, requirementsPath: resolve(ROOT, 'tests/fixtures/inspection-plan/nominal-without-tolerance.json'), scope: 'full', generatedAt });
  assert.equal(noTolerance.unresolved_requirements.some((entry) => entry.code === 'tolerance_unresolved'), true);
  const unsupported = await createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW, requirementsPath: resolve(ROOT, 'tests/fixtures/inspection-plan/unsupported-unit.json'), scope: 'full', generatedAt });
  assert.equal(unsupported.status, 'blocked'); assert.equal(unsupported.unresolved_requirements.some((entry) => entry.code === 'unsupported_unit'), true);
  const mismatchPath = join(temp, 'revision-impact-mismatch.json');
  await writeFile(mismatchPath, `${JSON.stringify({ artifact_type: 'revision_impact_report', candidate: { package_slug: 'fixture-bracket', revision: 'B', source_hashes: { review_pack: '0'.repeat(64) } }, reinspection_plan: { items: [] }, evidence_applicability: { assessments: [], authoritative_evidence_state_changed: false } })}\n`);
  await assert.rejects(createInspectionPlanFromPaths({ projectRoot: ROOT, reviewPackPath: REVIEW, revisionImpactPath: mismatchPath, trustedInputRoots: [temp], scope: 'delta', generatedAt }), /source-hash mismatch/);
  const snapshot = { review_pack: { artifact_type: 'review_pack', path: 'fixture.json', sha256: 'a'.repeat(64) } };
  assert.throws(
    () => buildInspectionPlan({
      reviewPack: review,
      config: { product: { package_slug: 'fixture-bracket', part_id: 'OTHER-PART', revision: 'B' } },
      sourceSnapshot: snapshot,
      scope: 'full',
      generatedAt,
    }),
    /config part ID mismatch/
  );
  assert.throws(
    () => buildInspectionPlan({
      reviewPack: review,
      revisionImpact: {
        artifact_type: 'revision_impact_report',
        candidate: { package_slug: 'fixture-bracket', part_id: 'OTHER-PART', revision: 'B' },
      },
      sourceSnapshot: snapshot,
      scope: 'full',
      generatedAt,
    }),
    /revision-impact candidate part ID mismatch/
  );
  assert.throws(
    () => buildInspectionPlan({
      reviewPack: review,
      readiness: { package_slug: 'fixture-bracket', revision: 'B', part: { part_id: 'FIXTURE-BRACKET-100', revision: 'C' } },
      sourceSnapshot: snapshot,
      scope: 'full',
      generatedAt,
    }),
    /readiness revision aliases conflict/
  );
  review.inspection_linkage.records[0].unit = 'inch'; review.inspection_linkage.records[0].nominal_value = 1; review.inspection_linkage.records[0].tolerance = { lower: -0.01, upper: 0.01 };
  const normalized = buildInspectionPlan({ reviewPack: review, sourceSnapshot: { review_pack: { artifact_type: 'review_pack', path: 'fixture.json', sha256: 'a'.repeat(64) } }, scope: 'full', generatedAt });
  assert.equal(normalized.items[0].unit, 'mm'); assert.equal(normalized.items[0].nominal_value, 25.4); assert.equal(normalized.items[0].lower_limit, 25.146);

  const fabricated = renderInspectionResultTemplate(normalized).replace(',,,,,,,', ',12.3,mm,PASS,completed,accepted,,');
  assert.match(fabricated, /PASS/);
  assert.doesNotMatch(renderInspectionResultTemplate(normalized), /\b(?:PASS|FAIL|accepted)\b/i);
} finally { await rm(temp, { recursive: true, force: true }); }

console.log('inspection-plan-adversarial.test.js: ok');

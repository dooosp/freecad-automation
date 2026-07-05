import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { writeEvidenceReadinessAudit } from '../src/services/evidence-readiness-audit/evidence-readiness-audit-service.js';
import {
  writeMaintainerDecisionJournal,
} from '../src/services/evidence-readiness-audit/maintainer-decision-journal-service.js';

const ROOT = resolve(import.meta.dirname, '..');
const RUN_ID = `${process.pid}`;
const outDir = `output/test-maintainer-decision-journal-${RUN_ID}`;
const fixedNow = '2026-07-05T01:00:00.000Z';

function readJson(pathValue) {
  return JSON.parse(readFileSync(pathValue, 'utf8'));
}

try {
  const auditResult = await writeEvidenceReadinessAudit({
    projectRoot: ROOT,
    outDir: join(outDir, 'audit'),
    packageSlugs: ['quality-pass-bracket'],
    generatedAt: fixedNow,
    clean: true,
  });

  const journalResult = await writeMaintainerDecisionJournal({
    projectRoot: ROOT,
    auditPath: auditResult.paths.audit,
    outDir: join(outDir, 'journal'),
    decision: 'hold',
    reason: 'Readiness remains held because inspection_evidence is missing.',
    actor: 'maintainer-test',
    generatedAt: fixedNow,
    clean: true,
  });

  assert.equal(journalResult.journal.artifact_type, 'maintainer_decision_journal');
  assert.equal(journalResult.journal.summary.latest_decision, 'hold');
  assert.equal(journalResult.journal.summary.release_allowed, false);
  assert.equal(journalResult.journal.summary.audit_decision, 'hold');
  assert.equal(journalResult.journal.summary.trusted_inspection_evidence_record_count, 0);
  assert.equal(journalResult.journal.boundary.inspection_evidence_attached, false);
  assert.equal(journalResult.journal.boundary.canonical_readiness_regenerated, false);
  assert.equal(journalResult.journal.records.length, 1);
  assert.equal(journalResult.journal.records[0].decision, 'hold');
  assert.equal(journalResult.journal.records[0].release_gate.release_allowed, false);
  assert.match(journalResult.journal.records[0].release_gate.reason, /hold/i);
  assert.equal(journalResult.journal.records[0].audit_ref.sha256.length, 64);
  assert.equal(existsSync(journalResult.paths.journal), true);
  assert.equal(existsSync(journalResult.paths.summary), true);

  const persisted = readJson(resolve(ROOT, journalResult.paths.journal));
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].id.length, 16);

  const appended = await writeMaintainerDecisionJournal({
    projectRoot: ROOT,
    auditPath: auditResult.paths.audit,
    outDir: join(outDir, 'journal'),
    decision: 'exception_requested',
    reason: 'Supplier record expected later; do not release yet.',
    actor: 'maintainer-test',
    generatedAt: '2026-07-05T01:05:00.000Z',
  });
  assert.equal(appended.journal.records.length, 2);
  assert.equal(appended.journal.summary.latest_decision, 'exception_requested');
  assert.equal(appended.journal.summary.release_allowed, false);
  assert.equal(appended.journal.records[1].exception.status, 'requested_not_approved');

  await assert.rejects(
    () => writeMaintainerDecisionJournal({
      projectRoot: ROOT,
      auditPath: auditResult.paths.audit,
      outDir: join(outDir, 'proceed'),
      decision: 'proceed',
      reason: 'Ship it.',
      actor: 'maintainer-test',
      generatedAt: fixedNow,
      clean: true,
    }),
    /Cannot record proceed/
  );

  console.log('maintainer-decision-journal.test.js: ok');
} finally {
  rmSync(resolve(ROOT, outDir), { recursive: true, force: true });
}

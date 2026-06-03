import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  JOB_EXECUTOR_COMMANDS,
  LOCAL_API_JOB_COMMANDS,
  PLAIN_PYTHON_COMMANDS,
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS,
  STUDIO_JOB_COMMANDS,
  getCommandEntry,
  renderCliUsage,
} from '../src/shared/command-manifest.js';
import { validateLocalApiJobRequest } from '../src/server/local-api-schemas.js';
import {
  translateStudioJobSubmission,
  validateStudioJobSubmission,
} from '../src/server/studio-job-bridge.js';
import { validateJobRequest } from '../src/services/jobs/job-executor.js';
import {
  buildReviewCards,
} from '../public/js/studio/artifact-insights.js';
import {
  canStartTrackedArtifactRun,
  findPreferredInspectionEvidenceIntakeArtifact,
  findPreferredInspectionEvidencePromotionDryRunArtifact,
  findPreferredStage5bEvidenceAuditArtifact,
  isInspectionEvidenceIntakeArtifact,
  isInspectionEvidencePromotionDryRunArtifact,
  isStage5bEvidenceAuditArtifact,
} from '../public/js/studio/artifact-actions.js';
import { isReviewableStudioJob } from '../public/js/studio/jobs-client.js';
import { getStage5bArtifactSchemaCatalog } from '../lib/stage5b-artifact-contracts.js';

const ROOT = resolve(import.meta.dirname, '..');
const readText = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const STAGE5B_COMMANDS = Object.freeze([
  'inspection-evidence-intake',
  'inspection-evidence-promotion-dry-run',
  'stage5b-evidence-audit',
]);

const LOCAL_STAGE5B_INBOX = 'local/stage5b-candidate-evidence-inbox/';
const STAGE5B_ARTIFACTS = Object.freeze({
  intake: Object.freeze({
    command: 'inspection-evidence-intake',
    type: 'inspection-evidence.intake-report',
    fileName: 'inspection-evidence-intake-report.json',
    auditFileName: 'intake_report.json',
    documentArtifactType: 'inspection_evidence_intake_report',
    cardId: 'inspection-intake',
  }),
  dryRun: Object.freeze({
    command: 'inspection-evidence-promotion-dry-run',
    type: 'inspection-evidence.promotion-dry-run-manifest',
    fileName: 'promotion_dry_run_manifest.json',
    documentArtifactType: 'inspection_evidence_promotion_dry_run_manifest',
    cardId: 'inspection-promotion-dry-run',
  }),
  auditManifest: Object.freeze({
    command: 'stage5b-evidence-audit',
    type: 'stage5b.evidence-audit-manifest',
    fileName: 'stage5b_audit_manifest.json',
    documentArtifactType: 'stage5b_evidence_audit_manifest',
    cardId: 'stage5b-evidence-audit',
  }),
  auditSummary: Object.freeze({
    command: 'stage5b-evidence-audit',
    type: 'stage5b.evidence-audit-summary',
    fileName: 'stage5b_audit_summary.md',
    documentArtifactType: 'stage5b_evidence_audit_summary_markdown',
  }),
});

const HARD_EVIDENCE_RULE = 'Only genuine completed physical/supplier/lab/QA inspection records can satisfy inspection_evidence.';
const NON_EVIDENCE_BOUNDARY_TERMS = Object.freeze([
  Object.freeze({ label: 'diagnostics', pattern: /diagnostics/i }),
  Object.freeze({ label: 'screenshots', pattern: /screenshots/i }),
  Object.freeze({ label: 'release bundles', pattern: /release\s+bundles/i }),
  Object.freeze({ label: 'release assets', pattern: /release\s+assets/i }),
  Object.freeze({ label: 'CI/GitHub metadata', pattern: /CI\/GitHub\s+metadata|CI\s+metadata|GitHub\s+metadata/i }),
]);
const PRE_ATTACHMENT_CHECKLIST_ITEMS = Object.freeze([
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
]);
const AUTHORIZATION_RECORD_ITEMS = Object.freeze([
  'accepted candidate gate report',
  'redaction/privacy review complete',
  'provenance/reviewer traceability confirmed',
  'package/part/revision mapping confirmed',
  'intake/dry-run/audit outputs reviewed',
  'explicit human authorization before attachment',
  'exact later task boundary for attachment',
  'readiness remains held until authorized attachment occurs',
]);

function assertIncludesAll(haystack, needles, label) {
  needles.forEach((needle) => {
    assert(
      haystack.includes(needle),
      `${label} should include ${needle}`
    );
  });
}

function assertNonEvidenceBoundary(text, label) {
  NON_EVIDENCE_BOUNDARY_TERMS.forEach((term) => {
    assert.match(text, term.pattern, `${label} should mention non-evidence boundary for ${term.label}`);
  });
}

function extractBacktickValuesFromLine(markdown, startsWith) {
  const line = markdown.split('\n').find((candidate) => candidate.startsWith(startsWith));
  assert(line, `Missing README line starting with ${startsWith}`);
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function assertSameMembers(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label);
}

function assertNoAffirmativePrivateCommitGuidance(text, label) {
  const unsafeLines = text.split('\n').filter((line) => {
    const normalized = line.toLowerCase();
    const mentionsCommitAction = /\b(?:git add|commit|check in|check-in)\b/.test(normalized);
    const mentionsPrivateMaterial = /\b(?:raw evidence|raw records|private records|private urls|pii|supplier records|lab records|qa records|secrets)\b/.test(normalized);
    const negated = /\b(?:do not|never|must not|without committing|not commit|not check in|not check-in)\b/.test(normalized);
    return mentionsCommitAction && mentionsPrivateMaterial && !negated;
  });
  assert.deepEqual(unsafeLines, [], `${label} must not tell users to commit raw/private evidence material`);
}

function assertPreAttachmentChecklist(text, label) {
  assert.match(text, /Pre-Attachment Review Checklist/, `${label} should include the pre-attachment review checklist`);
  for (const item of PRE_ATTACHMENT_CHECKLIST_ITEMS) {
    assert(text.includes(item), `${label} pre-attachment checklist should include ${item}`);
  }
  assert.match(text, /authorization before attachment/i, `${label} should require explicit later authorization before attachment`);
  assert.match(text, /readiness remains `?needs_more_evidence`? \/ `?hold_for_evidence_completion`?/i, `${label} should preserve readiness-held truth`);
}

function assertAttachmentAuthorizationRecord(text, label) {
  assert.match(text, /Stage 5B attachment authorization record/i, `${label} should name the attachment authorization record`);
  assert.match(text, /control metadata, not `?inspection_evidence`?/i, `${label} should classify the authorization record as control metadata`);
  for (const item of AUTHORIZATION_RECORD_ITEMS) {
    assert.match(text.toLowerCase(), new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} should include ${item}`);
  }
  assert.match(text, /review-context --inspection-evidence/i, `${label} should define the later attachment command boundary`);
  assert.match(text, /needs_more_evidence`? \/ `?hold_for_evidence_completion/i, `${label} should preserve readiness-held truth`);
}

function assertNoControlSurfaceAttachmentOverclaim(text, label) {
  const unsafeSurface = /\b(?:authorization records?|attachment authorization records?|candidate acceptance|accepted gate report|candidate gate report|inbox placement|inbox file|catalog entr(?:y|ies)|schemas?|reports?|dry-runs?|audits?)\b/i;
  const unsafeClaim = /\b(?:(?:attaches?|attached|promotes?|promoted)\b[^\n.]{0,120}\bevidence\b|(?:satisf(?:y|ies|ied)|clears?|cleared)\b[^\n.]{0,120}\b(?:inspection_evidence|readiness|evidence)\b|(?:proves?|proved)\b[^\n.]{0,120}\b(?:inspection_evidence|readiness)\b)/i;
  const negated = /\b(?:does not|do not|did not|cannot|never|must not|not |no |without|only genuine|control or review material only)\b/i;
  const unsafeLines = text.split('\n').filter((line) => unsafeSurface.test(line) && unsafeClaim.test(line) && !negated.test(line));
  assert.deepEqual(
    unsafeLines,
    [],
    `${label} must not imply candidate acceptance, inbox placement, catalog entries, schemas, reports, dry-runs, or audits attach evidence or satisfy readiness`
  );
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

function artifactFixture(definition, overrides = {}) {
  return {
    id: `${definition.type}-0`,
    key: definition.fileName,
    type: definition.type,
    file_name: definition.fileName,
    extension: definition.fileName.endsWith('.md') ? '.md' : '.json',
    content_type: definition.fileName.endsWith('.md') ? 'text/markdown' : 'application/json',
    exists: true,
    size_bytes: 512,
    scope: 'user-facing',
    stability: 'stable',
    capabilities: {
      can_open: true,
      can_download: true,
    },
    links: {
      open: `/jobs/job-stage5b/artifacts/${definition.type}-0/content`,
      download: `/jobs/job-stage5b/artifacts/${definition.type}-0/content?download=1`,
    },
    ...overrides,
  };
}

const intakeReport = {
  artifact_type: STAGE5B_ARTIFACTS.intake.documentArtifactType,
  schema_version: '1.0',
  source_boundary: {
    hard_evidence_rule: HARD_EVIDENCE_RULE,
    rejected_as_final_evidence: [
      'fixtures',
      'generated CAD/drawing/quality/DFM/readiness/review/standard-doc/release artifacts',
      'intake reports',
    ],
  },
  searched_sources: [{ kind: 'tracked_repo_files', status: 'searched' }],
  rejected_candidates: [{ classification: 'invalid_generated' }],
  packages: [
    {
      slug: 'quality-pass-bracket',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
      },
    },
  ],
  summary: {
    accepted_candidate_count: 0,
    rejected_candidate_count: 1,
    genuine_inspection_evidence_found: false,
    readiness_truth: 'readiness remains needs_more_evidence / hold_for_evidence_completion',
  },
};

const dryRunManifest = {
  artifact_type: STAGE5B_ARTIFACTS.dryRun.documentArtifactType,
  schema_version: '1.0',
  hard_evidence_rule: HARD_EVIDENCE_RULE,
  evidence_boundary: {
    dry_run_does_not_attach_evidence: true,
    rejected_as_final_evidence: [
      'dry-run manifests',
      'intake reports',
      'generated CAD/drawing/quality/DFM/readiness/review reports',
      'release bundles',
      'GitHub metadata',
    ],
  },
  summary: {
    promotion_can_run: false,
    ready_package_count: 0,
    blocked_package_count: 1,
    canonical_artifacts_mutated: false,
    readiness_expectation: 'No promotion can run; readiness remains needs_more_evidence / hold_for_evidence_completion.',
  },
  packages: [
    {
      package_slug: 'quality-pass-bracket',
      attachment_ready: false,
      match_confidence: 'none',
      blockers: ['no_genuine_completed_inspection_evidence'],
      canonical_next_command: null,
      mutation_boundaries: {
        dry_run_writes: ['promotion_dry_run_manifest.json'],
        canonical_artifacts_mutated_by_dry_run: false,
      },
      readiness_expectation: {
        dry_run: {
          status: 'needs_more_evidence',
          gate_decision: 'hold_for_evidence_completion',
        },
      },
    },
  ],
};

const auditManifest = {
  artifact_type: STAGE5B_ARTIFACTS.auditManifest.documentArtifactType,
  schema_version: '1.0',
  generated_artifacts: {
    intake_report: {
      path: 'output/jobs/job-stage5b/artifacts/intake_report.json',
      artifact_type: STAGE5B_ARTIFACTS.intake.documentArtifactType,
    },
    promotion_dry_run_manifest: {
      path: 'output/jobs/job-stage5b/artifacts/promotion_dry_run_manifest.json',
      artifact_type: STAGE5B_ARTIFACTS.dryRun.documentArtifactType,
    },
    stage5b_audit_manifest: {
      path: 'output/jobs/job-stage5b/artifacts/stage5b_audit_manifest.json',
      artifact_type: STAGE5B_ARTIFACTS.auditManifest.documentArtifactType,
    },
  },
  evidence_boundary: {
    hard_evidence_rule: HARD_EVIDENCE_RULE,
    rejected_as_final_evidence: [
      'intake reports',
      'dry-run manifests',
      'audit manifests',
      'fixtures',
      'generated CAD/drawing/quality/DFM/readiness/review reports',
      'release bundles',
      'screenshots',
      'CI summaries',
      'templates',
      'collection guides',
      'GitHub metadata alone',
    ],
  },
  summary: {
    genuine_inspection_evidence_found: false,
    promotion_can_run: false,
    attachment_ready_candidate_count: 0,
    readiness_remains_held: true,
    canonical_artifacts_mutated: false,
  },
  blockers: [
    'no_genuine_completed_inspection_evidence',
    'promotion_blocked_readiness_held',
  ],
  canonical_package_readiness_states: [
    {
      slug: 'quality-pass-bracket',
      promotion_status: 'blocked_no_candidate',
      readiness_after: {
        status: 'needs_more_evidence',
        gate_decision: 'hold_for_evidence_completion',
      },
    },
  ],
  github_summary: {
    enabled: false,
    repo: 'dooosp/freecad-automation',
    searched_source_count: 0,
    skipped_source_count: 0,
    downloaded_candidate_count: 0,
  },
  next_safe_commands: [
    {
      name: 'stage5b_evidence_audit',
      command: ['fcad', 'stage5b-evidence-audit', '--out-dir', 'output/stage5b'],
      mutates_canonical_artifacts: false,
    },
    {
      name: 'promotion_dry_run',
      command: ['fcad', 'inspection-evidence-promotion-dry-run', '--intake-report', 'output/stage5b/intake_report.json'],
      mutates_canonical_artifacts: false,
    },
  ],
  readiness_held_truth: {
    statement: 'No genuine completed inspection evidence is available for promotion; no promotion can run and readiness remains needs_more_evidence / hold_for_evidence_completion.',
    no_genuine_completed_inspection_evidence_found: true,
    canonical_package_artifacts_mutated: false,
  },
};

const stage5bArtifacts = [
  artifactFixture(STAGE5B_ARTIFACTS.intake),
  artifactFixture(STAGE5B_ARTIFACTS.dryRun),
  artifactFixture(STAGE5B_ARTIFACTS.auditManifest),
  artifactFixture(STAGE5B_ARTIFACTS.auditSummary),
];

const docs = {
  readme: readText('README.md'),
  supportMatrix: readText('docs/support-matrix.md'),
  testing: readText('docs/testing.md'),
  closeout: readText('docs/stage-5b-automation-closeout-status.md'),
  rcGapLedger: readText('docs/release-candidate-closeout-gap-ledger.md'),
  runbook: readText('docs/stage-5b-operational-runbook.md'),
  requestPacket: readText('docs/stage-5b-evidence-request-packet.md'),
  authorizationRecord: readText('docs/stage-5b-attachment-authorization-record.md'),
  artifactSchemaCatalog: readText('docs/stage-5b-artifact-schema-catalog.md'),
  inspectionContract: readText('docs/inspection-evidence-contract.md'),
  studioApi: readText('docs/studio-canonical-package-api.md'),
  studioWalkthrough: readText('docs/studio-first-user-walkthrough.md'),
};

const sources = {
  jobExecutor: readText('src/services/jobs/job-executor.js'),
  localApiSchemas: readText('src/server/local-api-schemas.js'),
  studioBridge: readText('src/server/studio-job-bridge.js'),
  studioClient: readText('public/js/studio/jobs-client.js'),
  reviewWorkspace: readText('public/js/studio/review-workspace.js'),
  artifactActions: readText('public/js/studio/artifact-actions.js'),
  artifactInsights: readText('public/js/studio/artifact-insights.js'),
  intakeTest: readText('tests/inspection-evidence-intake.test.js'),
  dryRunTest: readText('tests/inspection-evidence-promotion-dry-run.test.js'),
  auditTest: readText('tests/stage5b-evidence-audit.test.js'),
  studioUxTest: readText('tests/studio-inspection-evidence-intake-ux.test.js'),
};

const cliHelp = renderCliUsage();
for (const command of STAGE5B_COMMANDS) {
  const entry = getCommandEntry(command);
  assert(entry, `command manifest should include ${command}`);
  assert.equal(entry.runtime?.requiresFreecadRuntime, false, `${command} should remain non-FreeCAD`);
  assert.equal(entry.surfaces?.jobExecutor, true, `${command} should be a tracked job-executor command`);
  assert.equal(entry.surfaces?.localApi, true, `${command} should be a local API command`);
  assert.equal(entry.surfaces?.studio, true, `${command} should be a Studio command`);
  assert(PLAIN_PYTHON_COMMANDS.includes(command), `plain-Python docs source should include ${command}`);
  assert(JOB_EXECUTOR_COMMANDS.includes(command), `job executor command list should include ${command}`);
  assert(LOCAL_API_JOB_COMMANDS.includes(command), `local API command list should include ${command}`);
  assert(STUDIO_JOB_COMMANDS.includes(command), `Studio command list should include ${command}`);
  assert(cliHelp.includes(`fcad ${command}`), `CLI help should document fcad ${command}`);

  ['readme', 'supportMatrix', 'closeout', 'runbook'].forEach((docKey) => {
    assert(docs[docKey].includes(command), `${docKey} should document ${command}`);
  });
}

assertSameMembers(
  extractBacktickValuesFromLine(docs.readme, '- `POST /jobs`:').filter((value) => STAGE5B_COMMANDS.includes(value)),
  STAGE5B_COMMANDS,
  'README POST /jobs supported-job list should match Stage 5B tracked job types'
);
assertSameMembers(
  extractBacktickValuesFromLine(docs.readme, '- `POST /api/studio/jobs`:').filter((value) => STAGE5B_COMMANDS.includes(value)),
  STAGE5B_COMMANDS,
  'README POST /api/studio/jobs supported-job list should match Stage 5B tracked job types'
);
assertIncludesAll(
  docs.readme.split('\n').find((line) => line.includes('keeps the existing CLI/runtime execution path')) || '',
  STAGE5B_COMMANDS,
  'README local API execution-path bullet'
);
assertIncludesAll(
  docs.readme.split('\n').find((line) => line.includes('`Tracked run`: `POST /api/studio/jobs` queues')) || '',
  STAGE5B_COMMANDS,
  'README Studio tracked-run bullet'
);

assert.match(docs.closeout, /PR #122|\[#122\]/, 'Stage 5B closeout should include the PR #122 closeout state');
assert.match(docs.closeout, /PR #130|\[#130\]/, 'Stage 5B closeout should include the PR #130 operational runbook state');
assert.match(docs.closeout, /PR #131|\[#131\]/, 'Stage 5B closeout should include the PR #131 no-evidence lane state');
assert.match(docs.closeout, /PR #132|\[#132\]/, 'Stage 5B closeout should include the PR #132 candidate gate state');
assert.match(docs.closeout, /PR #133|\[#133\]/, 'Stage 5B closeout should include the PR #133 evidence request packet state');
assert.match(docs.closeout, /PR #134|\[#134\]/, 'Stage 5B closeout should include the PR #134 status ledger sync state');
assert.match(docs.closeout, /PR #135|\[#135\]/, 'Stage 5B closeout should include the PR #135 ignored inbox state');
assert.match(docs.closeout, /PR #136|\[#136\]/, 'Stage 5B closeout should include the PR #136 candidate gate schema state');
assert.match(docs.closeout, /PR #137|\[#137\]/, 'Stage 5B closeout should include the PR #137 artifact catalog state');
assert.match(docs.closeout, /PR #138|\[#138\]/, 'Stage 5B closeout should include the PR #138 pre-attachment checklist state');
assert.match(docs.closeout, /PR #139|\[#139\]/, 'Stage 5B closeout should include the PR #139 attachment authorization record state');
assert.match(docs.closeout, /PR #140|\[#140\]/, 'Stage 5B closeout should include the PR #140 API/Studio artifact hardening state');
assert.match(docs.closeout, /PR #141|\[#141\]/, 'Stage 5B closeout should include the PR #141 negative contract state');
assert.match(docs.closeout, /PR #142|\[#142\]/, 'Stage 5B closeout should include the PR #142 job/artifact lifecycle state');
assert.match(docs.closeout, /PR #143|\[#143\]/, 'Stage 5B closeout should include the PR #143 lifecycle hardening state');
assert.match(docs.closeout, /PR #144|\[#144\]/, 'Stage 5B closeout should include the PR #144 release bundle reproducibility state');
assert.match(docs.closeout, /PR #145|\[#145\]/, 'Stage 5B closeout should include the PR #145 first-user E2E state');
assert.match(docs.closeout, /PR #146|\[#146\]/, 'Stage 5B closeout should include the PR #146 local API schema parity state');
assert.match(docs.closeout, /PR #147|\[#147\]/, 'Stage 5B closeout should include the PR #147 Studio API fuzz state');
assert.match(docs.closeout, /PR #148|\[#148\]/, 'Stage 5B closeout should include the PR #148 runtime output contract state');
assert.match(docs.closeout, /PR #149|\[#149\]/, 'Stage 5B closeout should include the PR #149 CI/source hygiene state');
assert.match(docs.closeout, /PR #150|\[#150\]/, 'Stage 5B closeout should include the PR #150 workflow provenance pinning state');
assert.match(docs.closeout, /PR #151|\[#151\]/, 'Stage 5B closeout should include the PR #151 self-hosted runtime governance state');
assert.match(docs.closeout, /PR #152|\[#152\]/, 'Stage 5B closeout should include the PR #152 attachment provenance state');
assert.match(docs.closeout, /\[Stage 5B operational runbook\]\(\.\/stage-5b-operational-runbook\.md\)/, 'Stage 5B closeout should link the operational runbook');
assert.match(docs.closeout, /\[Stage 5B evidence request packet\]\(\.\/stage-5b-evidence-request-packet\.md\)/, 'Stage 5B closeout should link the evidence request packet');
assert.match(docs.closeout, /\[Stage 5B attachment authorization record\]\(\.\/stage-5b-attachment-authorization-record\.md\)/, 'Stage 5B closeout should link the attachment authorization record');
assert.match(docs.closeout, /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/, 'Stage 5B closeout should link the artifact/schema catalog');
[
  'Stage 5B evidence request packet',
  'Stage 5B artifact/schema catalog',
  'Stage 5B attachment authorization record',
  LOCAL_STAGE5B_INBOX,
  'node scripts/stage5b-candidate-evidence-gate.js --candidate <repo-relative-json>',
  'Pre-attachment review checklist',
  'exact later task boundary for attachment',
  'npm run test:stage5b:no-evidence',
  'inspection-evidence-intake',
  'inspection-evidence-promotion-dry-run',
  'stage5b-evidence-audit',
  'needs_more_evidence / hold_for_evidence_completion',
].forEach((needle) => {
  assert(docs.closeout.includes(needle), `Stage 5B closeout handoff ledger should include ${needle}`);
});
assert.match(docs.closeout, /through PR \[#152\]/, 'Stage 5B closeout should state the PR #152 endpoint');
assert.match(docs.readme, /HTTPS GitHub\/GitHubusercontent allowlisted public links/, 'README should document the bounded GitHub public-link downloader host policy');
assert.match(docs.supportMatrix, /HTTPS GitHub\/GitHubusercontent allowlisted public links/, 'support matrix should document the bounded GitHub public-link downloader host policy');
assert.match(docs.inspectionContract, /HTTPS URLs on the explicit GitHub\/GitHubusercontent host allowlist/, 'inspection evidence contract should document the explicit GitHub downloader host allowlist');
assert.match(docs.authorizationRecord, /safe repo-relative reviewed\/redacted/, 'authorization record should require repo-relative reviewed/redacted refs for canonical attachment');
assert.match(docs.artifactSchemaCatalog, /safe repo-relative reviewed\/redacted authorization JSON/, 'artifact catalog should require repo-relative reviewed/redacted authorization JSON for canonical attachment');
assert.doesNotMatch(docs.authorizationRecord, /private-control ref outside the repository root|private control record outside the repository root/i, 'authorization record should not allow outside-root private control refs as canonical attachment refs');
assert.doesNotMatch(docs.artifactSchemaCatalog, /private control record outside the repository root/i, 'artifact catalog should not allow outside-root private control refs as canonical attachment refs');
assert.match(docs.rcGapLedger, /^# Release candidate closeout gap ledger/m, 'RC gap ledger should exist with the expected title');
assert.match(docs.rcGapLedger, /PR \[#152\]/, 'RC gap ledger should cite PR #152');
assert.match(docs.rcGapLedger, /f4b38dec7b75671e73cd8d269955cdf837341b0b/, 'RC gap ledger should pin the audited head');
assert.match(docs.rcGapLedger, /No genuine completed inspection evidence has been found or attached/i, 'RC gap ledger should keep no-evidence truth');
assert.match(docs.rcGapLedger, /metadata[\s\S]+CI logs[\s\S]+screenshots[\s\S]+diagnostics[\s\S]+release bundles[\s\S]+generated outputs/i, 'RC gap ledger should reject non-evidence control artifacts');
assert.match(docs.rcGapLedger, /GitHub repository settings[\s\S]+protected branch[\s\S]+runner availability/i, 'RC gap ledger should list human/org-settings dependent residuals');
assert.match(docs.rcGapLedger, /Automation CI \(hosted fast lanes\).*passed/i, 'RC gap ledger should record hosted CI result without broadening coverage');
assert.match(docs.rcGapLedger, /FreeCAD Runtime Smoke \(self-hosted macOS\).*passed/i, 'RC gap ledger should record self-hosted runtime smoke result without broadening coverage');
assertNoPositiveCloseoutOverclaim(docs.closeout, 'Stage 5B closeout');
assertNoPositiveCloseoutOverclaim(docs.rcGapLedger, 'RC gap ledger');
assert.match(docs.testing, /stage5b-source-of-truth-guard\.test\.js/, 'testing docs should mention the Stage 5B source-of-truth guard');
assert.match(docs.testing, /stage5b-artifact-catalog\.test\.js/, 'testing docs should mention the Stage 5B artifact catalog guard');
assert.match(docs.testing, /Stage 5B operational runbook/, 'testing docs should mention the Stage 5B operational runbook');
assert.match(docs.testing, /Pre-Attachment Review Checklist/, 'testing docs should mention the Stage 5B pre-attachment checklist guard');
assert.match(docs.testing, /Stage 5B attachment authorization record/, 'testing docs should mention the Stage 5B attachment authorization record guard');

Object.entries({
  README: docs.readme,
  testing: docs.testing,
  closeout: docs.closeout,
  runbook: docs.runbook,
  requestPacket: docs.requestPacket,
  authorizationRecord: docs.authorizationRecord,
  artifactSchemaCatalog: docs.artifactSchemaCatalog,
  inspectionContract: docs.inspectionContract,
}).forEach(([label, text]) => {
  assert(text.includes(LOCAL_STAGE5B_INBOX), `${label} should document the local-only Stage 5B candidate inbox`);
  assert.match(text, /raw records|private records|private URLs|PII|supplier\/lab\/QA records/i, `${label} should document privacy-sensitive inbox boundaries`);
  assertNoAffirmativePrivateCommitGuidance(text, label);
});

Object.entries({
  README: docs.readme,
  testing: docs.testing,
  closeout: docs.closeout,
  runbook: docs.runbook,
  requestPacket: docs.requestPacket,
  authorizationRecord: docs.authorizationRecord,
  artifactSchemaCatalog: docs.artifactSchemaCatalog,
  inspectionContract: docs.inspectionContract,
}).forEach(([label, text]) => {
  assertNoControlSurfaceAttachmentOverclaim(text, label);
});

const schemaRequests = [
  { type: 'inspection-evidence-intake' },
  {
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_path: 'output/inspection-evidence-intake-report.json',
  },
  {
    type: 'inspection-evidence-promotion-dry-run',
    intake_report_artifact_ref: {
      job_id: 'job-intake',
      artifact_id: 'inspection-evidence-intake-report-0',
    },
  },
  {
    type: 'stage5b-evidence-audit',
    options: { include_github: false },
  },
];

for (const request of schemaRequests) {
  const localApiValidation = validateLocalApiJobRequest(request);
  assert.equal(localApiValidation.ok, true, `${request.type} should validate against the local API schema: ${localApiValidation.errors.join('\n')}`);

  const executorValidation = validateJobRequest(request);
  assert.equal(executorValidation.ok, true, `${request.type} should validate against the job executor: ${executorValidation.errors.join('\n')}`);
}

for (const command of STAGE5B_COMMANDS) {
  assert(
    isReviewableStudioJob({ type: command, status: 'succeeded' }),
    `Studio jobs client should classify ${command} as reviewable`
  );
  assert(sources.reviewWorkspace.includes(`type: '${command}'`), `Review workspace should queue ${command}`);
  assert(sources.studioClient.includes(`type === '${command}'`), `Studio jobs client should list ${command}`);
  assert(sources.studioBridge.includes(`request.type === '${command}'`), `Studio bridge should special-case ${command}`);
  assert(sources.jobExecutor.includes(`job.type === '${command}'`), `Job executor should execute ${command}`);
}

assert.equal(
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS.includes('inspection-evidence-promotion-dry-run'),
  true,
  'promotion dry-run should remain artifact-compatible for registered intake reports'
);
assert.equal(
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS.includes('inspection-evidence-intake'),
  false,
  'inspection-evidence-intake should remain a local-only Studio job, not artifact-ref driven'
);
assert.equal(
  STUDIO_ARTIFACT_COMPATIBLE_JOB_COMMANDS.includes('stage5b-evidence-audit'),
  false,
  'stage5b-evidence-audit should remain server-output-only, not artifact-ref driven'
);

const intakeSubmission = validateStudioJobSubmission({
  type: 'inspection-evidence-intake',
  options: { include_github: false },
});
assert.equal(intakeSubmission.ok, true, intakeSubmission.errors.join('\n'));

const invalidIntakeGithubRepoSubmission = validateStudioJobSubmission({
  type: 'inspection-evidence-intake',
  options: { github_repo: 'other/repo' },
});
assert.equal(invalidIntakeGithubRepoSubmission.ok, false);
assert.match(invalidIntakeGithubRepoSubmission.errors.join('\n'), /options only accepts include_github and package_slugs|github_repo/);

const auditSubmission = await translateStudioJobSubmission({
  type: 'stage5b-evidence-audit',
  options: { include_github: true },
});
assert.equal(auditSubmission.ok, true, auditSubmission.errors.join('\n'));
assert.deepEqual(auditSubmission.request, {
  type: 'stage5b-evidence-audit',
  options: { include_github: true },
});

const dryRunSubmission = await translateStudioJobSubmission({
  type: 'inspection-evidence-promotion-dry-run',
  artifact_ref: {
    job_id: 'job-intake',
    artifact_id: STAGE5B_ARTIFACTS.intake.type,
  },
}, {
  async resolveArtifactRef(ref) {
    return {
      jobId: ref.job_id,
      artifact: artifactFixture(STAGE5B_ARTIFACTS.intake, {
        id: ref.artifact_id,
        path: '/tmp/inspection-evidence-intake-report.json',
      }),
    };
  },
});
assert.equal(dryRunSubmission.ok, true, dryRunSubmission.errors.join('\n'));
assert.deepEqual(dryRunSubmission.request.intake_report_artifact_ref, {
  job_id: 'job-intake',
  artifact_id: STAGE5B_ARTIFACTS.intake.type,
});

assert.equal(isInspectionEvidenceIntakeArtifact(stage5bArtifacts[0]), true);
assert.equal(isInspectionEvidencePromotionDryRunArtifact(stage5bArtifacts[1]), true);
assert.equal(isStage5bEvidenceAuditArtifact(stage5bArtifacts[2]), true);
assert.equal(isStage5bEvidenceAuditArtifact(stage5bArtifacts[3]), true);
assert.equal(canStartTrackedArtifactRun(stage5bArtifacts[0], 'inspection-evidence-promotion-dry-run'), true);
assert.equal(findPreferredInspectionEvidenceIntakeArtifact(stage5bArtifacts)?.type, STAGE5B_ARTIFACTS.intake.type);
assert.equal(findPreferredInspectionEvidencePromotionDryRunArtifact(stage5bArtifacts)?.type, STAGE5B_ARTIFACTS.dryRun.type);
assert.equal(findPreferredStage5bEvidenceAuditArtifact(stage5bArtifacts)?.type, STAGE5B_ARTIFACTS.auditManifest.type);

Object.values(STAGE5B_ARTIFACTS).forEach((definition) => {
  assert(sources.jobExecutor.includes(`type: '${definition.type}'`), `job manifest should register ${definition.type}`);
  assert(sources.jobExecutor.includes(`artifact_type: '${definition.documentArtifactType}'`), `job manifest metadata should register ${definition.documentArtifactType}`);
  assert(sources.artifactActions.includes(definition.type), `artifact allowlist should recognize ${definition.type}`);
  assert(docs.runbook.includes(definition.type), `operational runbook should document ${definition.type}`);
  assert(
    docs.runbook.includes(definition.fileName) || docs.runbook.includes(definition.auditFileName),
    `operational runbook should document ${definition.fileName} or ${definition.auditFileName}`
  );
  if (definition.cardId) {
    assert(sources.artifactInsights.includes(`id: '${definition.cardId}'`), `Review card builder should expose ${definition.cardId}`);
  }
});
assert(sources.jobExecutor.includes(STAGE5B_ARTIFACTS.intake.auditFileName), 'audit job manifest should register intake_report.json');

const reviewCards = buildReviewCards({
  activeJob: {
    summary: {
      id: 'job-stage5b',
      type: 'stage5b-evidence-audit',
      status: 'succeeded',
    },
    manifest: {
      command: 'stage5b-evidence-audit',
      warnings: [],
    },
  },
  artifacts: stage5bArtifacts,
  sourceMap: {
    inspectionIntake: intakeReport,
    inspectionIntakeRaw: JSON.stringify(intakeReport, null, 2),
    inspectionPromotionDryRun: dryRunManifest,
    inspectionPromotionDryRunRaw: JSON.stringify(dryRunManifest, null, 2),
    stage5bAudit: auditManifest,
    stage5bAuditRaw: JSON.stringify(auditManifest, null, 2),
  },
});

assertIncludesAll(
  reviewCards.map((card) => card.id),
  [
    STAGE5B_ARTIFACTS.auditManifest.cardId,
    STAGE5B_ARTIFACTS.dryRun.cardId,
    STAGE5B_ARTIFACTS.intake.cardId,
  ],
  'Review cards'
);
reviewCards
  .filter((card) => [
    STAGE5B_ARTIFACTS.auditManifest.cardId,
    STAGE5B_ARTIFACTS.dryRun.cardId,
    STAGE5B_ARTIFACTS.intake.cardId,
  ].includes(card.id))
  .forEach((card) => {
    const rendered = JSON.stringify(card);
    assert.match(rendered, /needs_more_evidence/);
    assert.match(rendered, /hold_for_evidence_completion/);
    assert.match(rendered, /not (?:package )?inspection evidence|not evidence/i);
    assert.match(rendered, /No human-entered measurements|Only genuine completed physical\/supplier\/lab\/QA inspection records/i);
  });

Object.entries({
  README: docs.readme,
  supportMatrix: docs.supportMatrix,
  testing: docs.testing,
  closeout: docs.closeout,
  runbook: docs.runbook,
  inspectionContract: docs.inspectionContract,
  studioApi: docs.studioApi,
  studioWalkthrough: docs.studioWalkthrough,
}).forEach(([label, text]) => {
  assert.match(text, /needs_more_evidence/, `${label} should preserve needs_more_evidence truth`);
  assert.match(text, /hold_for_evidence_completion/, `${label} should preserve readiness-held truth`);
  assert.match(text, /inspection_evidence/, `${label} should preserve inspection_evidence boundary`);
});

assert.match(docs.closeout, /No genuine completed inspection evidence has been found or attached/);
assert.match(docs.closeout, new RegExp(HARD_EVIDENCE_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assertNonEvidenceBoundary(docs.closeout, 'Final non-inspection software closeout');

assert.match(docs.runbook, /^# Stage 5B operational runbook/m);
assert.match(docs.runbook, /Quick CLI Path/);
assert.match(docs.runbook, /Candidate Acceptance Gate/);
assertPreAttachmentChecklist(docs.runbook, 'Stage 5B operational runbook');
assertAttachmentAuthorizationRecord(docs.runbook, 'Stage 5B operational runbook');
assert.match(docs.runbook, /Local-Only Candidate Inbox/);
assert.match(docs.runbook, /local\/stage5b-candidate-evidence-inbox\/<package-slug>\/received-inspection-evidence\.json/);
assert.match(docs.runbook, /local\/stage5b-candidate-evidence-inbox\/<package-slug>\/candidate-gate-report\.json/);
assert.match(docs.runbook, /API And Tracked Job Path/);
assert.match(docs.runbook, /Studio Review Path/);
assert.match(docs.runbook, /Promotion Dry-Run Meaning/);
assert.match(docs.runbook, /Diagnostics Meaning/);
assert.match(docs.runbook, /Future Genuine-Evidence Path/);
assert.match(docs.runbook, /fcad inspection-evidence-intake \[--package <canonical-package-slug>\] \[--include-github\] --out output\/stage5b-runbook\/inspection-evidence-intake-report\.json/);
assert.match(docs.runbook, /fcad inspection-evidence-promotion-dry-run --intake-report output\/stage5b-runbook\/inspection-evidence-intake-report\.json --out output\/stage5b-runbook\/promotion_dry_run_manifest\.json/);
assert.match(docs.runbook, /fcad stage5b-evidence-audit --out-dir output\/stage5b-runbook-audit \[--include-github\]/);
assert.match(docs.runbook, /node scripts\/stage5b-candidate-evidence-gate\.js --candidate <repo-relative-json>/);
assert.match(docs.runbook, /POST http:\/\/127\.0\.0\.1:3000\/jobs/);
assert.match(docs.runbook, /POST http:\/\/127\.0\.0\.1:3000\/api\/studio\/jobs/);
assert.match(docs.runbook, /stage5b\.validation-diagnostics/);
assert.match(docs.runbook, /node tests\/first-user-docs-smoke\.test\.js/);
assert.match(docs.runbook, /node tests\/stage5b-candidate-evidence-gate\.test\.js/);
assert.match(docs.runbook, /node tests\/stage5b-source-of-truth-guard\.test\.js/);
assert.match(docs.runbook, /node tests\/stage5b-artifact-catalog\.test\.js/);
assert.match(docs.runbook, /node tests\/stage5b-evidence-audit-cli-smoke\.test\.js/);
assert.match(docs.runbook, /npm run test:stage5b:no-evidence/);
assert.match(docs.runbook, /npm run test:node:contract/);
assert.match(docs.runbook, /npm test/);
assert.match(docs.runbook, /human-typed, inferred, simulated, synthetic, CAD-generated, or guessed measurements/);
assert.match(docs.runbook, new RegExp(HARD_EVIDENCE_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assertNonEvidenceBoundary(docs.runbook, 'Stage 5B operational runbook');

assert.match(docs.requestPacket, /^# Stage 5B evidence request packet/m);
assertPreAttachmentChecklist(docs.requestPacket, 'Stage 5B evidence request packet');
assertAttachmentAuthorizationRecord(docs.requestPacket, 'Stage 5B evidence request packet');
assert.match(docs.requestPacket, /suppliers?, labs?, QA\s+reviewers?, and physical inspectors?/i);
assert.match(docs.requestPacket, /Local-only inbox convention/);
assert.match(docs.requestPacket, /local\/stage5b-candidate-evidence-inbox\/<package-slug>\//);
assert.match(docs.requestPacket, /node scripts\/stage5b-candidate-evidence-gate\.js --candidate <repo-relative-json> --out <report\.json>/);
assert.match(docs.requestPacket, /Package or part mapping/);
assert.match(docs.requestPacket, /Revision mapping/);
assert.match(docs.requestPacket, /Inspection date/);
assert.match(docs.requestPacket, /Completion status/);
assert.match(docs.requestPacket, /Overall result/);
assert.match(docs.requestPacket, /Inspector and reviewer/);
assert.match(docs.requestPacket, /Provenance/);
assert.match(docs.requestPacket, /Feature evidence/);
assert.match(docs.requestPacket, /eligible_for_stage5b_intake_review: true/);
assert.match(docs.requestPacket, /generated examples/);
assert.match(docs.requestPacket, /comments, PR bodies/);
assert.match(docs.requestPacket, /CAD-generated measurements/);
assert.match(docs.requestPacket, /CI\/GitHub metadata/);
assert.match(docs.requestPacket, /does not prove readiness, attach evidence, mutate canonical package\s+artifacts, or authorize promotion/);
assert.match(docs.requestPacket, /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/);
assert.match(docs.requestPacket, /Schema\s+discoverability does not make the report evidence/);
assertAttachmentAuthorizationRecord(docs.authorizationRecord, 'Stage 5B attachment authorization record');
assert.match(docs.authorizationRecord, /\[Stage 5B operational runbook\]\(\.\/stage-5b-operational-runbook\.md\)/);
assert.match(docs.authorizationRecord, /\[Stage 5B evidence request packet\]\(\.\/stage-5b-evidence-request-packet\.md\)/);
assert.match(docs.authorizationRecord, /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/);
assert.match(docs.authorizationRecord, /authorization records? do not attach evidence/i);
assert.match(docs.authorizationRecord, /PR comments? do not attach evidence/i);
assert.match(docs.authorizationRecord, new RegExp(HARD_EVIDENCE_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assertNonEvidenceBoundary(docs.authorizationRecord, 'Stage 5B attachment authorization record');
assertNoControlSurfaceAttachmentOverclaim(docs.authorizationRecord, 'Stage 5B attachment authorization record');
assert.match(
  docs.requestPacket.replace(/`inspection_evidence`/g, 'inspection_evidence').replace(/\s+/g, ' '),
  new RegExp(HARD_EVIDENCE_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
);
assertNonEvidenceBoundary(docs.requestPacket, 'Stage 5B evidence request packet');

assert.match(docs.runbook, /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/);
assert.match(docs.inspectionContract, /\[Stage 5B artifact\/schema catalog\]\(\.\/stage-5b-artifact-schema-catalog\.md\)/);
assert.match(docs.artifactSchemaCatalog, /^# Stage 5B artifact\/schema catalog/m);
assert.match(docs.artifactSchemaCatalog, /schemas\/stage5b-candidate-gate-report\.schema\.json/);
assert.match(docs.artifactSchemaCatalog, /Stage 5B attachment authorization record/);
assert.match(docs.artifactSchemaCatalog, /docs\/stage-5b-attachment-authorization-record\.md/);
assert.match(docs.artifactSchemaCatalog, /validation_diagnostics\.json/);
assert.match(
  docs.artifactSchemaCatalog.replace(/`inspection_evidence`/g, 'inspection_evidence'),
  new RegExp(HARD_EVIDENCE_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
);
getStage5bArtifactSchemaCatalog().forEach((entry) => {
  assert(docs.artifactSchemaCatalog.includes(entry.surface), `artifact/schema catalog should document ${entry.surface}`);
  assert.match(entry.inspection_evidence_status, /Not inspection_evidence/i, `${entry.id} should stay non-evidence`);
  assert.match(entry.readiness_effect, /No readiness change|Non-mutating|readiness remains|does not attach evidence/i, `${entry.id} should document readiness effect`);
});
assert.match(
  getStage5bArtifactSchemaCatalog().find((entry) => entry.id === 'stage5b_candidate_gate_report').readiness_effect,
  /pre-attachment checklist/i,
  'candidate gate catalog entry should point accepted reports to the pre-attachment checklist'
);

[
  'inspection-evidence-intake reports are discovery/review artifacts only; they are not package inspection evidence.',
  'promotion dry-run manifests are planning/control artifacts only; they are not inspection evidence.',
  'Stage 5B audit manifests are review/control artifacts only; they are not inspection evidence.',
].forEach((phrase) => {
  assert(sources.jobExecutor.includes(phrase), `job executor metadata should preserve non-evidence phrase: ${phrase}`);
});

const combinedStage5bTestSource = [
  sources.intakeTest,
  sources.dryRunTest,
  sources.auditTest,
  sources.studioUxTest,
].join('\n');

Object.values(STAGE5B_ARTIFACTS).forEach((definition) => {
  assert(
    combinedStage5bTestSource.includes(definition.type)
      || combinedStage5bTestSource.includes(definition.documentArtifactType)
      || combinedStage5bTestSource.includes(definition.fileName),
    `Stage 5B tests should cover ${definition.type}`
  );
});

console.log('stage5b-source-of-truth-guard.test.js: ok');

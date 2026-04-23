import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildReviewerFeedbackSummary,
  loadReviewerFeedbackInput,
} from '../src/services/drawing/reviewer-feedback.js';

const ROOT = resolve(import.meta.dirname, '..');
const FIXTURE_ROOT = join(ROOT, 'tests', 'fixtures', 'reviewer-feedback');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeEvidenceContext() {
  return {
    semanticQuality: {
      extracted_evidence: {
        required_dimensions: [
          {
            requirement_id: 'WIDTH',
            requirement_label: 'WIDTH',
            classification: 'extracted',
            matched_extracted_id: 'svg_text_001',
          },
        ],
        required_notes: [
          {
            requirement_id: 'MATERIAL',
            requirement_label: 'MATERIAL',
            classification: 'unknown',
            matched_extracted_id: null,
          },
        ],
        required_views: [],
      },
    },
    extractedDrawingSemantics: {
      dimensions: [
        {
          id: 'svg_text_001',
          raw_text: '40',
          matched_intent_id: 'WIDTH',
        },
      ],
      notes: [],
      views: [],
    },
    layoutReadability: {
      status: 'warning',
      findings: [
        {
          type: 'text_overlap',
          message: 'Structured QA evidence shows overlapping drawing text.',
          view_ids: ['front'],
        },
      ],
    },
    planner: {
      suggested_action_details: [
        {
          id: 'layout:text-overlap',
          classification: 'text_overlap',
          message: 'Structured QA evidence shows overlapping drawing text.',
        },
      ],
    },
    artifactPaths: {
      extracted_drawing_semantics_file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
      planner_file: '/tmp/output/ks_bracket_drawing_planner.json',
    },
  };
}

{
  const feedback = readJson(join(FIXTURE_ROOT, 'linked-open.json'));
  const summary = buildReviewerFeedbackSummary({
    reviewerFeedback: feedback,
    reviewerFeedbackPath: '/tmp/output/reviewer_feedback.json',
    ...makeEvidenceContext(),
  });

  assert.equal(summary.status, 'available');
  assert.equal(summary.evidence_state, 'linked');
  assert.equal(summary.total_count, 1);
  assert.equal(summary.unresolved_count, 1);
  assert.equal(summary.linked_count, 1);
  assert.equal(summary.items[0].link_status, 'linked');
  assert.equal(summary.items[0].linked_evidence.some((entry) => entry.path === 'required_dimensions.WIDTH.classification'), true);
  assert.equal(summary.suggested_actions.some((entry) => entry.includes('RF-001')), true);
}

{
  const feedback = readJson(join(FIXTURE_ROOT, 'mixed-partial.json'));
  const summary = buildReviewerFeedbackSummary({
    reviewerFeedback: feedback,
    reviewerFeedbackPath: '/tmp/output/reviewer_feedback.json',
    ...makeEvidenceContext(),
  });

  assert.equal(summary.status, 'partial');
  assert.equal(summary.evidence_state, 'partial');
  assert.equal(summary.total_count, 4);
  assert.equal(summary.unresolved_count, 3);
  assert.equal(summary.linked_count, 2);
  assert.equal(summary.stale_count, 1);
  assert.equal(summary.invalid_count, 1);
  assert.equal(summary.accepted_count, 1);
  assert.equal(summary.items.find((entry) => entry.id === 'RF-002')?.link_status, 'stale');
  assert.equal(summary.items.find((entry) => entry.id === 'RF-004')?.link_status, 'invalid');
  assert.equal(summary.items.find((entry) => entry.id === 'RF-004')?.validation_errors.length > 0, true);
}

{
  const tmpDir = mkdtempSync(join(tmpdir(), 'fcad-reviewer-feedback-'));
  try {
    const configPath = join(tmpDir, 'config.toml');
    const feedbackPath = join(tmpDir, 'reviewer_feedback.json');
    writeFileSync(configPath, 'name = "fixture"\n', 'utf8');
    writeFileSync(feedbackPath, JSON.stringify(readJson(join(FIXTURE_ROOT, 'linked-open.json')), null, 2), 'utf8');

    const loaded = loadReviewerFeedbackInput({
      projectRoot: tmpDir,
      configPath,
      config: {
        reviewer_feedback: {
          path: './reviewer_feedback.json',
        },
      },
    });
    assert.equal(loaded.inputStatus, 'available');
    assert.equal(loaded.reviewerFeedbackPath, feedbackPath);
    assert.equal(loaded.reviewerFeedback.items.length, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

{
  const tmpDir = mkdtempSync(join(tmpdir(), 'fcad-reviewer-feedback-'));
  try {
    const configPath = join(tmpDir, 'config.toml');
    const feedbackPath = join(tmpDir, 'broken_feedback.json');
    writeFileSync(configPath, 'name = "fixture"\n', 'utf8');
    writeFileSync(feedbackPath, '{not valid json}\n', 'utf8');

    const invalid = loadReviewerFeedbackInput({
      projectRoot: tmpDir,
      configPath,
      config: {
        reviewer_feedback: {
          path: './broken_feedback.json',
        },
      },
    });
    assert.equal(invalid.inputStatus, 'invalid');
    assert.equal(invalid.inputErrors.some((entry) => entry.includes('could not be parsed')), true);

    const unsupported = loadReviewerFeedbackInput({
      projectRoot: tmpDir,
      configPath,
      config: {
        reviewer_feedback: {
          path: '../outside.json',
        },
      },
    });
    assert.equal(unsupported.inputStatus, 'unsupported');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log('reviewer-feedback.test.js: ok');

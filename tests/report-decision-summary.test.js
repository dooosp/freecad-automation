import assert from 'node:assert/strict';

import {
  buildDecisionReportSummary,
  createReportSummaryPath,
  validateDecisionReportSummary,
} from '../src/services/report/decision-report-summary.js';

function makeBaseInput(overrides = {}) {
  return {
    configPath: '/tmp/ks_bracket.toml',
    config: {
      name: 'ks_bracket',
      tolerance: {
        review_threshold_pct: 95,
      },
    },
    reportPdfPath: '/tmp/output/ks_bracket_report.pdf',
    reportGeneratedAt: '2026-04-20T01:02:03.000Z',
    repoContext: {
      branch: 'feat/decision-report-upgrade',
      headSha: 'abc123def456',
    },
    runtimeInfo: {
      mode: 'macos-bundle',
      available: true,
    },
    createQuality: {
      status: 'pass',
      geometry: {
        valid_shape: true,
      },
      blocking_issues: [],
      warnings: [],
    },
    drawingQuality: {
      status: 'pass',
      score: 96,
      extracted_drawing_semantics_file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
      views: {
        overlap_count: 0,
      },
      dimensions: {
        missing_required_intents: [],
        conflict_count: 0,
      },
      traceability: {
        coverage_percent: 100,
      },
      blocking_issues: [],
      warnings: [],
      recommended_actions: [],
      layout_readability: {
        status: 'ok',
        score: 100,
        confidence: 'high',
        advisory_only: true,
        evidence_state: 'available',
        completeness_state: 'complete',
        summary: 'No advisory layout/readability findings were confirmed from structured metadata.',
        finding_count: 0,
        warning_count: 0,
        findings: [],
        provenance: {
          sources: [
            {
              artifact_type: 'layout_report',
              path: '/tmp/output/ks_bracket_layout_report.json',
              method: 'layout_report_views',
              source_kind: 'layout_report',
              source_artifact: 'layout_report',
              source_ref: 'layout_report_views',
              evidence_state: 'available',
              completeness_state: 'complete',
            },
          ],
          evaluated_view_ids: ['front'],
          source_completeness: {
            layout_report: {
              source_kind: 'layout_report',
              source_artifact: 'layout_report',
              source_ref: 'layout_report_views',
              path: '/tmp/output/ks_bracket_layout_report.json',
              method: 'layout_report_views',
              evidence_state: 'available',
              completeness_state: 'complete',
              available: true,
              inspected: true,
              missing_reasons: [],
              evidence_keys: ['views', 'summary', 'overflow'],
            },
          },
        },
      },
      semantic_quality: {
        decision: 'pass',
        advisory_decision: 'pass',
        enforceable: false,
        score: 100,
        critical_features_total: 1,
        critical_features_covered: 1,
        required_dimensions_total: 1,
        required_dimensions_present: 1,
        missing_required_dimensions: [],
        required_notes_missing: [],
        required_views_missing: [],
        traceability: {
          required_dimensions_total: 1,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: [],
        },
        missing_critical_information: [],
        required_blockers: [],
        optional_missing_information: [],
        suggested_actions: [],
        suggested_action_details: [],
        extracted_evidence: {
          status: 'partial',
          advisory_only: true,
          file: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
          path: '/tmp/output/ks_bracket_extracted_drawing_semantics.json',
          sources: [
            { artifact_type: 'svg', path: '/tmp/output/ks_bracket_drawing.svg', inspected: true, method: 'svg_text_scan' },
          ],
          coverage: {
            required_dimensions: { total: 1, extracted: 1, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
            required_notes: { total: 1, extracted: 0, missing: 0, unknown: 1, unsupported: 0, extracted_percent: 0 },
            required_views: { total: 1, extracted: 1, missing: 0, unknown: 0, unsupported: 0, extracted_percent: 100 },
            total_required: 3,
            total_extracted: 2,
            total_missing: 0,
            total_unknown: 1,
            total_unsupported: 0,
          },
          required_dimensions: [
            {
              requirement_id: 'WIDTH',
              requirement_label: 'WIDTH',
              classification: 'extracted',
              matched_extracted_id: 'svg_text_001',
              matched_raw_text: '40',
              matched_feature_id: 'body_width',
              source_artifact: 'svg',
              confidence: 0.9,
              reason: 'Reliable extracted dimension evidence matched this required dimension.',
              provenance: {
                artifact_type: 'svg',
                path: '/tmp/output/ks_bracket_drawing.svg',
                method: 'svg_dimension_text_scan',
              },
              candidate_matches: [],
            },
          ],
          required_notes: [
            {
              requirement_id: 'MATERIAL',
              requirement_label: 'MATERIAL',
              classification: 'unknown',
              matched_extracted_id: null,
              matched_raw_text: null,
              matched_feature_id: null,
              source_artifact: null,
              confidence: null,
              reason: 'Extracted drawing semantics explicitly marked this required note as uncertain.',
              provenance: null,
              candidate_matches: [],
            },
          ],
          required_views: [
            {
              requirement_id: 'front',
              requirement_label: 'front',
              classification: 'extracted',
              matched_extracted_id: 'front',
              matched_raw_text: 'Front',
              matched_feature_id: null,
              source_artifact: 'layout_report',
              confidence: 0.9,
              reason: 'Reliable extracted view evidence matched this required view.',
              provenance: {
                artifact_type: 'layout_report',
                path: '/tmp/output/ks_bracket_layout_report.json',
                method: 'layout_report_views',
              },
              candidate_matches: [],
            },
          ],
          unmatched_dimensions: [],
          unmatched_notes: [],
          matched_required_dimensions: 1,
          matched_required_notes: 0,
          matched_required_views: 1,
          missing_required_items: [],
          unknowns: ['Required note not reliably extracted: MATERIAL.'],
          limitations: ['Advisory-only foundation.'],
          suggested_actions: ['Review low-confidence or incomplete extracted note evidence for: MATERIAL.'],
          suggested_action_details: [
            {
              id: 'note:material:unknown',
              severity: 'review',
              category: 'note',
              target_requirement_id: 'MATERIAL',
              target_feature_id: null,
              classification: 'unknown',
              title: 'Required note MATERIAL is unknown in extracted drawing evidence.',
              message: 'Extracted drawing semantics explicitly marked this required note as uncertain.',
              recommended_fix: 'Verify the required note text is present and readable. Confirm extraction can still match the note to MATERIAL.',
              evidence: [
                {
                  source: 'drawing_quality.semantic_quality.extracted_evidence',
                  path: 'required_notes.MATERIAL.classification',
                  value: 'unknown',
                },
              ],
            },
          ],
        },
      },
    },
    featureCatalog: {
      artifact_type: 'feature_catalog',
      recognition_policy: 'conservative_config_evidence_only',
      summary: {
        total_features: 4,
        recognized_features: 4,
        unknown_features: 0,
      },
    },
    extractedDrawingSemantics: {
      artifact_type: 'extracted_drawing_semantics',
      status: 'partial',
      decision: 'advisory',
      coverage: {
        required_dimensions_total: 1,
        required_dimensions_extracted: 1,
        required_notes_total: 1,
        required_notes_extracted: 0,
        required_views_total: 1,
        required_views_extracted: 1,
      },
      unknowns: ['Required note not reliably extracted: MATERIAL.'],
      limitations: ['Advisory-only foundation.'],
    },
    dfm: {
      score: 92,
      issues: [],
      summary: {
        errors: 0,
        warnings: 0,
        severity_counts: {
          critical: 0,
          major: 0,
          minor: 0,
          info: 0,
        },
        top_fixes: [],
      },
    },
    fem: {
      fem: {
        mesh: {
          convergence_checked: true,
        },
        results: {
          safety_factor: 2.1,
        },
      },
    },
    tolerance: {
      stack_up: {
        success_rate_pct: 99.4,
      },
    },
    ...overrides,
  };
}

{
  const summary = buildDecisionReportSummary(makeBaseInput());
  const validation = validateDecisionReportSummary(summary);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.overall_score >= 95, true);
  assert.deepEqual(summary.blocking_issues, []);
  assert.equal(summary.missing_optional_artifacts.includes('fem'), false);
  assert.equal(summary.missing_optional_artifacts.includes('tolerance'), false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'create_quality')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'drawing_quality')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'dfm')?.required, true);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'feature_catalog')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'extracted_drawing_semantics')?.status, 'available');
  assert.equal(summary.feature_catalog.total_features, 4);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.required, false);
  assert.equal(summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.required, false);
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.decision, 'pass');
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.required_dimensions_present, 1);
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.status, 'partial');
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.coverage.required_dimensions.extracted, 1);
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.required_notes[0].classification, 'unknown');
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.suggested_action_details[0].target_requirement_id, 'MATERIAL');
  assert.equal(summary.surfaces.drawing_quality.semantic_quality.extracted_evidence.suggested_action_details[0].classification, 'unknown');
  assert.equal(summary.surfaces.drawing_quality.layout_readability.status, 'ok');
  assert.equal(summary.surfaces.drawing_quality.layout_readability.score, 100);
  assert.equal(summary.surfaces.drawing_quality.layout_readability.advisory_only, true);
  assert.equal(summary.surfaces.drawing_quality.layout_readability.completeness_state, 'complete');
  assert.equal(
    summary.surfaces.drawing_quality.layout_readability.provenance.source_completeness.layout_report.source_kind,
    'layout_report'
  );
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    drawingQuality: {
      ...makeBaseInput().drawingQuality,
      semantic_quality: {
        ...makeBaseInput().drawingQuality.semantic_quality,
        decision: 'advisory',
        advisory_decision: 'needs_attention',
        enforceable: false,
        score: 50,
        required_dimensions_total: 2,
        required_dimensions_present: 1,
        missing_required_dimensions: ['DEPTH'],
        traceability: {
          required_dimensions_total: 2,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: ['DEPTH'],
        },
        missing_critical_information: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        suggested_actions: ['Add or map required dimension(s): DEPTH.'],
      },
    },
  }));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.blocking_issues.length, 0);
  assert.equal(summary.warnings.some((warning) => warning.includes('advisory missing required semantic evidence')), false);
  assert(summary.recommended_actions.some((action) => action.includes('DEPTH')));
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    drawingQuality: {
      ...makeBaseInput().drawingQuality,
      semantic_quality: {
        ...makeBaseInput().drawingQuality.semantic_quality,
        decision: 'fail',
        advisory_decision: 'needs_attention',
        enforceable: true,
        score: 50,
        required_dimensions_total: 2,
        required_dimensions_present: 1,
        missing_required_dimensions: ['DEPTH'],
        traceability: {
          required_dimensions_total: 2,
          linked_required_dimensions: 1,
          missing_required_dimensions: [],
          unknown_required_dimensions: ['DEPTH'],
        },
        missing_critical_information: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        required_blockers: [
          'Required dimension is not evidenced on the drawing: DEPTH.',
        ],
        suggested_actions: ['Add or map required dimension(s): DEPTH.'],
      },
    },
  }));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.ready_for_manufacturing_review, false);
  assert(summary.blocking_issues.some((issue) => issue.includes('DEPTH')));
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    createQuality: {
      status: 'fail',
      geometry: {
        valid_shape: false,
      },
      blocking_issues: ['Generated model shape is invalid.'],
      warnings: [],
    },
  }));
  assert.equal(summary.overall_status, 'fail');
  assert.equal(summary.ready_for_manufacturing_review, false);
  assert(summary.blocking_issues.some((issue) => issue.includes('Generated model shape is invalid')));
  assert(summary.top_risks.some((risk) => risk.includes('invalid')));
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    fem: null,
    tolerance: null,
  }));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.status,
    'not_run'
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'fem')?.required,
    false
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.status,
    'not_available'
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'tolerance')?.required,
    false
  );
  assert.equal(
    summary.artifacts_referenced.find((artifact) => artifact.key === 'report_manifest')?.status,
    'generated'
  );
  assert.deepEqual(summary.blocking_issues, []);
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.missing_optional_artifacts.includes('report_manifest'), false);
}

{
  const summary = buildDecisionReportSummary(makeBaseInput({
    drawingQuality: {
      ...makeBaseInput().drawingQuality,
      reviewer_feedback: {
        advisory_only: true,
        status: 'partial',
        evidence_state: 'partial',
        total_count: 2,
        unresolved_count: 1,
        linked_count: 1,
        unmatched_count: 0,
        stale_count: 1,
        orphaned_count: 0,
        invalid_count: 0,
        accepted_count: 1,
        resolved_count: 0,
        items: [
          {
            id: 'RF-001',
            source: 'manual_review',
            target_type: 'required_dimension',
            target_id: 'WIDTH',
            category: 'dimension_review',
            status: 'open',
            severity: 'warning',
            link_status: 'linked',
            resolution_state: 'unresolved',
            comment: 'Confirm WIDTH after the latest layout change.',
            requested_action: 'Verify WIDTH against the linked evidence.',
            linked_evidence: [
              {
                source: 'drawing_quality.semantic_quality.extracted_evidence',
                path: 'required_dimensions.WIDTH.classification',
                value: 'extracted',
              },
            ],
            provenance: {
              path: '/tmp/output/reviewer_feedback.json',
            },
          },
          {
            id: 'RF-002',
            source: 'manual_review',
            target_type: 'planner_action',
            target_id: 'layout:text-overlap',
            category: 'layout_readability_review',
            status: 'accepted',
            severity: 'info',
            link_status: 'stale',
            resolution_state: 'accepted',
            comment: 'Accepted earlier.',
            linked_evidence: [],
            provenance: {
              path: '/tmp/output/reviewer_feedback.json',
            },
          },
        ],
        summary: '2 reviewer feedback item(s): 1 unresolved, 1 linked, 1 stale, 0 invalid.',
        suggested_actions: ['Follow up reviewer feedback RF-001 for WIDTH. Verify WIDTH against the linked evidence.'],
        suggested_action_details: [
          {
            id: 'reviewer_feedback:RF-001',
            severity: 'review',
            category: 'reviewer_feedback',
            target_requirement_id: 'WIDTH',
            classification: 'linked',
            title: 'Follow up reviewer feedback RF-001 for WIDTH.',
            message: 'Confirm WIDTH after the latest layout change.',
            recommended_fix: 'Verify WIDTH against the linked evidence.',
            evidence: [],
          },
        ],
        provenance: {
          path: '/tmp/output/reviewer_feedback.json',
        },
      },
      recommended_actions: [
        'Follow up reviewer feedback RF-001 for WIDTH. Verify WIDTH against the linked evidence.',
      ],
    },
  }));
  assert.equal(summary.overall_status, 'pass');
  assert.equal(summary.ready_for_manufacturing_review, true);
  assert.equal(summary.surfaces.drawing_quality.reviewer_feedback.status, 'partial');
  assert.equal(summary.surfaces.drawing_quality.reviewer_feedback.unresolved_count, 1);
  assert.equal(summary.recommended_actions.some((entry) => entry.includes('RF-001')), true);
  assert.equal(summary.top_risks.some((risk) => risk.includes('Open reviewer feedback items remain: 1')), true);
  assert.equal(summary.inputs_consumed.some((entry) => entry.key === 'reviewer_feedback_json' && entry.path === '/tmp/output/reviewer_feedback.json'), true);
}

assert.equal(
  createReportSummaryPath({
    primaryOutputPath: '/tmp/output/ks_bracket_report.pdf',
  }),
  '/tmp/output/ks_bracket_report_summary.json'
);

console.log('report-decision-summary.test.js: ok');

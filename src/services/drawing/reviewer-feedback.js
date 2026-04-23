import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const REVIEWER_FEEDBACK_SCHEMA = JSON.parse(
  readFileSync(new URL('../../../schemas/reviewer-feedback.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateReviewerFeedbackDocumentSchema = ajv.compile(REVIEWER_FEEDBACK_SCHEMA);
const validateReviewerFeedbackItemSchema = ajv.compile({
  ...REVIEWER_FEEDBACK_SCHEMA.$defs.feedbackItem,
  $defs: {
    feedbackEvidence: REVIEWER_FEEDBACK_SCHEMA.$defs.feedbackEvidence,
  },
});

export const REVIEWER_FEEDBACK_SCHEMA_VERSION = '0.1';

const DEFAULT_REVIEWER_FEEDBACK_SUMMARY = Object.freeze({
  advisory_only: true,
  status: 'none',
  evidence_state: 'none',
  total_count: 0,
  unresolved_count: 0,
  linked_count: 0,
  unmatched_count: 0,
  stale_count: 0,
  orphaned_count: 0,
  invalid_count: 0,
  accepted_count: 0,
  resolved_count: 0,
  items: [],
  summary: 'Reviewer feedback was not provided.',
  suggested_actions: [],
  suggested_action_details: [],
  provenance: {
    artifact_type: 'reviewer_feedback_json',
    path: null,
    method: 'explicit_reviewer_feedback_json',
    input_status: 'none',
  },
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = null) {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim();
    return text || fallback;
  }
  return fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function uniqueEvidence(entries = []) {
  const seen = new Set();
  return asArray(entries)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      source: cleanText(entry.source),
      path: cleanText(entry.path),
      value: cleanText(entry.value),
    }))
    .filter((entry) => entry.source && entry.path)
    .filter((entry) => {
      const key = `${entry.source}:${entry.path}:${entry.value || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeKey(value) {
  return cleanText(value, '')?.toLowerCase().replace(/[^a-z0-9]+/g, '') || '';
}

function resolveMaybe(pathValue) {
  return cleanText(pathValue) ? resolve(pathValue) : null;
}

function formatSchemaErrors(errors = []) {
  return asArray(errors)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .filter(Boolean);
}

function isWithinRoot(rootPath, candidatePath) {
  if (!rootPath || !candidatePath) return false;
  const resolvedRoot = resolve(rootPath);
  const resolvedCandidate = resolve(candidatePath);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function normalizeSeverity(value) {
  const normalized = cleanText(value, 'warning')?.toLowerCase();
  if (normalized === 'critical' || normalized === 'error' || normalized === 'high') return 'critical';
  if (normalized === 'info' || normalized === 'low') return 'info';
  return 'warning';
}

function normalizeStatus(value) {
  return cleanText(value)?.toLowerCase() || null;
}

function createSummary(overrides = {}) {
  return {
    ...structuredClone(DEFAULT_REVIEWER_FEEDBACK_SUMMARY),
    ...overrides,
    provenance: {
      ...structuredClone(DEFAULT_REVIEWER_FEEDBACK_SUMMARY.provenance),
      ...asObject(overrides.provenance),
    },
  };
}

function normalizeInputDocument(reviewerFeedback = null) {
  if (Array.isArray(reviewerFeedback)) {
    return {
      schema_version: REVIEWER_FEEDBACK_SCHEMA_VERSION,
      items: reviewerFeedback,
    };
  }
  return asObject(reviewerFeedback);
}

function reviewerFeedbackPathFromConfig(config = {}) {
  return cleanText(
    config?.reviewer_feedback?.path
      ?? config?.reviewer_feedback_json
      ?? config?.drawing?.reviewer_feedback_json
  );
}

export function loadReviewerFeedbackInput({
  projectRoot,
  configPath,
  config = {},
  readFileFn = readFileSync,
} = {}) {
  const configuredPath = reviewerFeedbackPathFromConfig(config);
  if (!configuredPath) {
    return {
      inputStatus: 'none',
      inputErrors: [],
      reviewerFeedback: null,
      reviewerFeedbackPath: null,
    };
  }

  const baseDir = dirname(resolve(configPath || projectRoot || '.'));
  const reviewerFeedbackPath = resolve(baseDir, configuredPath);
  if (!isWithinRoot(projectRoot, reviewerFeedbackPath)) {
    return {
      inputStatus: 'unsupported',
      inputErrors: ['Configured reviewer feedback path must stay under the repo root.'],
      reviewerFeedback: null,
      reviewerFeedbackPath,
    };
  }

  if (!existsSync(reviewerFeedbackPath)) {
    return {
      inputStatus: 'none',
      inputErrors: [],
      reviewerFeedback: null,
      reviewerFeedbackPath,
    };
  }

  try {
    const raw = readFileFn(reviewerFeedbackPath, 'utf8');
    return {
      inputStatus: 'available',
      inputErrors: [],
      reviewerFeedback: JSON.parse(raw),
      reviewerFeedbackPath,
    };
  } catch (error) {
    return {
      inputStatus: 'invalid',
      inputErrors: [`Reviewer feedback JSON could not be parsed: ${error.message}`],
      reviewerFeedback: null,
      reviewerFeedbackPath,
    };
  }
}

function buildTargetRegistry({
  semanticQuality = null,
  extractedDrawingSemantics = null,
  layoutReadability = null,
  planner = null,
  artifactPaths = {},
} = {}) {
  const byTypeAndId = new Map();
  const byPath = new Map();

  function registerTarget(target) {
    const targetType = cleanText(target.target_type);
    const targetId = cleanText(target.target_id);
    const targetPath = cleanText(target.target_path);
    const entry = {
      target_type: targetType,
      target_id: targetId,
      target_path: targetPath,
      target_label: cleanText(target.target_label),
      linked_evidence: uniqueEvidence(target.linked_evidence),
    };
    if (targetType && targetId) {
      byTypeAndId.set(`${targetType}:${normalizeKey(targetId)}`, entry);
    }
    if (targetPath) {
      byPath.set(targetPath, entry);
    }
  }

  const extractedEvidence = asObject(semanticQuality?.extracted_evidence);

  for (const entry of asArray(extractedEvidence.required_dimensions)) {
    const requirementId = cleanText(entry.requirement_id);
    if (!requirementId) continue;
    registerTarget({
      target_type: 'required_dimension',
      target_id: requirementId,
      target_path: `drawing_quality.semantic_quality.extracted_evidence.required_dimensions.${requirementId}`,
      target_label: cleanText(entry.requirement_label, requirementId),
      linked_evidence: [
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_dimensions.${requirementId}.classification`,
          value: cleanText(entry.classification),
        },
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_dimensions.${requirementId}.matched_extracted_id`,
          value: cleanText(entry.matched_extracted_id),
        },
      ],
    });
  }

  for (const entry of asArray(extractedEvidence.required_notes)) {
    const requirementId = cleanText(entry.requirement_id);
    if (!requirementId) continue;
    registerTarget({
      target_type: 'required_note',
      target_id: requirementId,
      target_path: `drawing_quality.semantic_quality.extracted_evidence.required_notes.${requirementId}`,
      target_label: cleanText(entry.requirement_label, requirementId),
      linked_evidence: [
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_notes.${requirementId}.classification`,
          value: cleanText(entry.classification),
        },
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_notes.${requirementId}.matched_extracted_id`,
          value: cleanText(entry.matched_extracted_id),
        },
      ],
    });
  }

  for (const entry of asArray(extractedEvidence.required_views)) {
    const requirementId = cleanText(entry.requirement_id);
    if (!requirementId) continue;
    registerTarget({
      target_type: 'required_view',
      target_id: requirementId,
      target_path: `drawing_quality.semantic_quality.extracted_evidence.required_views.${requirementId}`,
      target_label: cleanText(entry.requirement_label, requirementId),
      linked_evidence: [
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_views.${requirementId}.classification`,
          value: cleanText(entry.classification),
        },
        {
          source: 'drawing_quality.semantic_quality.extracted_evidence',
          path: `required_views.${requirementId}.matched_extracted_id`,
          value: cleanText(entry.matched_extracted_id),
        },
      ],
    });
  }

  for (const entry of asArray(extractedDrawingSemantics?.dimensions)) {
    const extractedId = cleanText(entry.id);
    if (!extractedId) continue;
    registerTarget({
      target_type: 'extracted_dimension',
      target_id: extractedId,
      target_path: `extracted_drawing_semantics.dimensions.${extractedId}`,
      target_label: cleanText(entry.raw_text, extractedId),
      linked_evidence: [
        {
          source: 'extracted_drawing_semantics',
          path: `dimensions.${extractedId}.raw_text`,
          value: cleanText(entry.raw_text),
        },
        {
          source: 'extracted_drawing_semantics',
          path: `dimensions.${extractedId}.matched_intent_id`,
          value: cleanText(entry.matched_intent_id),
        },
      ],
    });
  }

  for (const entry of asArray(extractedDrawingSemantics?.notes)) {
    const extractedId = cleanText(entry.id);
    if (!extractedId) continue;
    registerTarget({
      target_type: 'extracted_note',
      target_id: extractedId,
      target_path: `extracted_drawing_semantics.notes.${extractedId}`,
      target_label: cleanText(entry.raw_text, extractedId),
      linked_evidence: [
        {
          source: 'extracted_drawing_semantics',
          path: `notes.${extractedId}.raw_text`,
          value: cleanText(entry.raw_text),
        },
        {
          source: 'extracted_drawing_semantics',
          path: `notes.${extractedId}.matched_intent_id`,
          value: cleanText(entry.matched_intent_id),
        },
      ],
    });
  }

  for (const entry of asArray(extractedDrawingSemantics?.views)) {
    const extractedId = cleanText(entry.id);
    if (!extractedId) continue;
    registerTarget({
      target_type: 'extracted_view',
      target_id: extractedId,
      target_path: `extracted_drawing_semantics.views.${extractedId}`,
      target_label: cleanText(entry.label, extractedId),
      linked_evidence: [
        {
          source: 'extracted_drawing_semantics',
          path: `views.${extractedId}.label`,
          value: cleanText(entry.label),
        },
        {
          source: 'extracted_drawing_semantics',
          path: `views.${extractedId}.matched_intent_id`,
          value: cleanText(entry.matched_intent_id),
        },
      ],
    });
  }

  asArray(layoutReadability?.findings).forEach((finding, index) => {
    const findingType = cleanText(finding?.type, 'finding');
    const viewId = asArray(finding?.view_ids).map((entry) => cleanText(entry)).find(Boolean) || 'page';
    const targetId = `layout_${findingType}_${viewId}_${String(index + 1).padStart(2, '0')}`;
    registerTarget({
      target_type: 'layout_readability_finding',
      target_id: targetId,
      target_path: `drawing_quality.layout_readability.findings.${index}`,
      target_label: cleanText(finding?.message, findingType),
      linked_evidence: [
        {
          source: 'drawing_quality.layout_readability',
          path: `findings.${index}.type`,
          value: findingType,
        },
        {
          source: 'drawing_quality.layout_readability',
          path: `findings.${index}.view_ids`,
          value: JSON.stringify(asArray(finding?.view_ids)),
        },
        {
          source: 'drawing_quality.layout_readability',
          path: `findings.${index}.source_kind`,
          value: cleanText(finding?.source_kind),
        },
        {
          source: 'drawing_quality.layout_readability',
          path: `findings.${index}.completeness_state`,
          value: cleanText(finding?.completeness_state),
        },
      ],
    });
  });

  asArray(planner?.suggested_action_details).forEach((entry, index) => {
    const actionId = cleanText(entry?.id, `planner_action_${index + 1}`);
    registerTarget({
      target_type: 'planner_action',
      target_id: actionId,
      target_path: `drawing_planner.suggested_action_details.${actionId}`,
      target_label: cleanText(entry?.title, actionId),
      linked_evidence: [
        {
          source: 'drawing_planner',
          path: `suggested_action_details.${actionId}.classification`,
          value: cleanText(entry?.classification),
        },
        {
          source: 'drawing_planner',
          path: `suggested_action_details.${actionId}.message`,
          value: cleanText(entry?.message),
        },
      ],
    });
  });

  for (const [artifactKey, artifactPath] of Object.entries(asObject(artifactPaths))) {
    const resolvedPath = resolveMaybe(artifactPath);
    if (!resolvedPath) continue;
    registerTarget({
      target_type: 'artifact',
      target_id: artifactKey,
      target_path: resolvedPath,
      target_label: artifactKey,
      linked_evidence: [
        {
          source: 'artifacts',
          path: artifactKey,
          value: resolvedPath,
        },
      ],
    });
  }

  return {
    byTypeAndId,
    byPath,
  };
}

function resolutionStateFromStatus(status) {
  if (status === 'accepted') return 'accepted';
  if (status === 'resolved' || status === 'rejected') return 'resolved';
  return 'unresolved';
}

function classifyLinkState({ targetType, targetId, targetPath, validationErrors = [], registry }) {
  if (validationErrors.length > 0) {
    return { link_status: 'invalid', target: null };
  }

  if (targetPath && registry.byPath.has(targetPath)) {
    return {
      link_status: 'linked',
      target: registry.byPath.get(targetPath),
    };
  }

  if (targetType && targetId) {
    const key = `${targetType}:${normalizeKey(targetId)}`;
    if (registry.byTypeAndId.has(key)) {
      return {
        link_status: 'linked',
        target: registry.byTypeAndId.get(key),
      };
    }
  }

  if (!targetType && !targetId && !targetPath) {
    return { link_status: 'unmatched', target: null };
  }

  if (targetType === 'artifact' || (targetPath && (targetPath.startsWith('/') || targetPath.includes('\\')))) {
    return { link_status: 'orphaned', target: null };
  }

  return { link_status: 'stale', target: null };
}

function normalizeFeedbackItem(rawItem, index, { documentSource = null, reviewerFeedbackPath = null, registry }) {
  const normalizedItem = {
    id: cleanText(rawItem?.id, `reviewer_feedback_${String(index + 1).padStart(3, '0')}`),
    source: cleanText(rawItem?.source, documentSource || 'reviewer_feedback'),
    reviewer_label: cleanText(rawItem?.reviewer_label),
    target_type: cleanText(rawItem?.target_type)?.toLowerCase() || null,
    target_id: cleanText(rawItem?.target_id),
    target_path: cleanText(rawItem?.target_path),
    category: cleanText(rawItem?.category),
    status: normalizeStatus(rawItem?.status),
    severity: normalizeSeverity(rawItem?.severity),
    comment: cleanText(rawItem?.comment),
    requested_action: cleanText(rawItem?.requested_action),
    linked_evidence: uniqueEvidence(rawItem?.linked_evidence),
    validation_errors: [],
    provenance: {
      artifact_type: 'reviewer_feedback_json',
      path: resolveMaybe(reviewerFeedbackPath),
      method: 'explicit_reviewer_feedback_json',
      item_index: index,
      ...asObject(rawItem?.provenance),
    },
  };

  const validationTarget = Object.fromEntries(
    Object.entries({
      id: normalizedItem.id,
      source: normalizedItem.source,
      reviewer_label: normalizedItem.reviewer_label,
      target_type: normalizedItem.target_type,
      target_id: normalizedItem.target_id,
      target_path: normalizedItem.target_path,
      category: normalizedItem.category,
      status: normalizedItem.status,
      severity: normalizedItem.severity,
      comment: normalizedItem.comment,
      requested_action: normalizedItem.requested_action,
      linked_evidence: normalizedItem.linked_evidence,
      provenance: normalizedItem.provenance,
    }).filter(([, value]) => value !== null && value !== undefined)
  );

  const valid = validateReviewerFeedbackItemSchema(validationTarget);
  if (!valid) {
    normalizedItem.validation_errors = formatSchemaErrors(validateReviewerFeedbackItemSchema.errors || []);
  }

  const resolvedLink = classifyLinkState({
    targetType: normalizedItem.target_type,
    targetId: normalizedItem.target_id,
    targetPath: normalizedItem.target_path,
    validationErrors: normalizedItem.validation_errors,
    registry,
  });
  normalizedItem.link_status = resolvedLink.link_status;
  normalizedItem.resolution_state = resolutionStateFromStatus(normalizedItem.status);
  normalizedItem.linked_evidence = uniqueEvidence([
    ...normalizedItem.linked_evidence,
    ...asArray(resolvedLink.target?.linked_evidence),
  ]);

  if (!normalizedItem.target_path && resolvedLink.target?.target_path) {
    normalizedItem.target_path = resolvedLink.target.target_path;
  }

  return normalizedItem;
}

function summarizeFeedback(items = []) {
  const totalCount = items.length;
  const unresolvedCount = items.filter((item) => item.resolution_state === 'unresolved').length;
  const linkedCount = items.filter((item) => item.link_status === 'linked').length;
  const unmatchedCount = items.filter((item) => item.link_status === 'unmatched').length;
  const staleCount = items.filter((item) => item.link_status === 'stale').length;
  const orphanedCount = items.filter((item) => item.link_status === 'orphaned').length;
  const invalidCount = items.filter((item) => item.link_status === 'invalid').length;
  const acceptedCount = items.filter((item) => item.resolution_state === 'accepted').length;
  const resolvedCount = items.filter((item) => item.resolution_state === 'resolved').length;
  return {
    totalCount,
    unresolvedCount,
    linkedCount,
    unmatchedCount,
    staleCount,
    orphanedCount,
    invalidCount,
    acceptedCount,
    resolvedCount,
  };
}

function determineStatus({ inputStatus, counts }) {
  if (inputStatus === 'unsupported') return 'unsupported';
  if (counts.totalCount === 0) {
    return inputStatus === 'invalid' ? 'invalid' : 'none';
  }
  if (inputStatus === 'invalid' && counts.linkedCount === 0 && counts.invalidCount === counts.totalCount) {
    return 'invalid';
  }
  if (
    counts.invalidCount > 0
    || counts.unmatchedCount > 0
    || counts.staleCount > 0
    || counts.orphanedCount > 0
  ) {
    return 'partial';
  }
  return 'available';
}

function determineEvidenceState(counts) {
  if (counts.totalCount === 0) return 'none';
  if (counts.invalidCount === counts.totalCount) return 'invalid';
  if (counts.linkedCount === counts.totalCount) return 'linked';
  if (counts.linkedCount === 0) return 'unmatched';
  return 'partial';
}

function buildSummaryText({ status, counts, inputErrors = [] }) {
  if (status === 'none') {
    return 'Reviewer feedback was not provided.';
  }
  if (status === 'unsupported') {
    return uniqueStrings([
      'Reviewer feedback input is unsupported and remained advisory-only.',
      ...inputErrors,
    ]).join(' ');
  }
  if (status === 'invalid' && counts.totalCount === 0) {
    return uniqueStrings([
      'Reviewer feedback input is invalid and could not be normalized.',
      ...inputErrors,
    ]).join(' ');
  }
  return uniqueStrings([
    `${counts.totalCount} reviewer feedback item(s): ${counts.unresolvedCount} unresolved, ${counts.linkedCount} linked, ${counts.unmatchedCount} unmatched, ${counts.staleCount} stale, ${counts.orphanedCount} orphaned, ${counts.invalidCount} invalid.`,
    ...inputErrors,
  ]).join(' ');
}

function buildReviewerFeedbackActions(items = []) {
  const actionDetails = [];
  const suggestedActions = [];

  items.forEach((item) => {
    if (item.resolution_state !== 'unresolved') return;
    if (!['linked', 'unmatched', 'stale', 'orphaned'].includes(item.link_status)) return;

    const feedbackId = cleanText(item.id, 'reviewer feedback');
    const targetId = cleanText(item.target_id);
    const title = targetId
      ? `Follow up reviewer feedback ${feedbackId} for ${targetId}.`
      : `Follow up reviewer feedback ${feedbackId}.`;
    const recommendedFix = uniqueStrings([
      cleanText(item.requested_action),
      item.link_status === 'linked'
        ? `Review the linked evidence target and resolve reviewer feedback ${feedbackId} after confirming the current drawing output.`
        : null,
      item.link_status === 'unmatched'
        ? `Confirm whether reviewer feedback ${feedbackId} should map to an existing evidence target.`
        : null,
      (item.link_status === 'stale' || item.link_status === 'orphaned')
        ? `Verify whether the referenced evidence or artifact changed after reviewer feedback ${feedbackId} was recorded.`
        : null,
    ]).join(' ');

    suggestedActions.push(uniqueStrings([title, recommendedFix]).join(' '));
    actionDetails.push({
      id: `reviewer_feedback:${feedbackId}`,
      severity: item.severity === 'info' ? 'info' : 'review',
      category: 'reviewer_feedback',
      target_requirement_id: item.target_type?.startsWith('required_') ? item.target_id : null,
      target_feature_id: null,
      classification: item.link_status,
      title,
      message: cleanText(item.comment, 'Reviewer feedback remains advisory-only.'),
      recommended_fix: recommendedFix,
      evidence: uniqueEvidence([
        {
          source: 'drawing_quality.reviewer_feedback',
          path: `${feedbackId}.status`,
          value: cleanText(item.status),
        },
        {
          source: 'drawing_quality.reviewer_feedback',
          path: `${feedbackId}.link_status`,
          value: cleanText(item.link_status),
        },
      ]),
    });
  });

  return {
    suggestedActions: uniqueStrings(suggestedActions),
    actionDetails,
  };
}

export function buildReviewerFeedbackSummary({
  reviewerFeedback = null,
  reviewerFeedbackPath = null,
  inputStatus = null,
  inputErrors = [],
  semanticQuality = null,
  extractedDrawingSemantics = null,
  layoutReadability = null,
  planner = null,
  artifactPaths = {},
} = {}) {
  const effectiveInputStatus = inputStatus || (reviewerFeedback ? 'available' : 'none');
  const document = normalizeInputDocument(reviewerFeedback);
  const documentSource = cleanText(document.source, 'reviewer_feedback');
  const effectivePath = resolveMaybe(reviewerFeedbackPath);

  if (effectiveInputStatus === 'unsupported') {
    return createSummary({
      status: 'unsupported',
      evidence_state: 'invalid',
      summary: buildSummaryText({
        status: 'unsupported',
        counts: summarizeFeedback([]),
        inputErrors,
      }),
      provenance: {
        path: effectivePath,
        input_status: effectiveInputStatus,
      },
    });
  }

  if (!reviewerFeedback) {
    return createSummary({
      status: effectiveInputStatus === 'invalid' ? 'invalid' : 'none',
      evidence_state: effectiveInputStatus === 'invalid' ? 'invalid' : 'none',
      summary: buildSummaryText({
        status: effectiveInputStatus === 'invalid' ? 'invalid' : 'none',
        counts: summarizeFeedback([]),
        inputErrors,
      }),
      provenance: {
        path: effectivePath,
        input_status: effectiveInputStatus,
      },
    });
  }

  if (document.schema_version && document.schema_version !== REVIEWER_FEEDBACK_SCHEMA_VERSION) {
    return createSummary({
      status: 'unsupported',
      evidence_state: 'invalid',
      summary: `Reviewer feedback schema_version ${JSON.stringify(document.schema_version)} is unsupported.`,
      provenance: {
        path: effectivePath,
        input_status: 'unsupported',
      },
    });
  }

  const registry = buildTargetRegistry({
    semanticQuality,
    extractedDrawingSemantics,
    layoutReadability,
    planner,
    artifactPaths,
  });

  const rawItems = asArray(document.items);
  const items = rawItems.map((item, index) => normalizeFeedbackItem(item, index, {
    documentSource,
    reviewerFeedbackPath: effectivePath,
    registry,
  }));
  const counts = summarizeFeedback(items);
  const status = determineStatus({ inputStatus: effectiveInputStatus, counts });
  const evidenceState = determineEvidenceState(counts);
  const feedbackActions = buildReviewerFeedbackActions(items);
  const documentValidation = validateReviewerFeedbackDocumentSchema({
    schema_version: REVIEWER_FEEDBACK_SCHEMA_VERSION,
    source: documentSource,
    review_cycle: cleanText(document.review_cycle),
    items: items
      .filter((item) => item.link_status !== 'invalid')
      .map((item) => {
        const normalized = { ...item };
        delete normalized.link_status;
        delete normalized.resolution_state;
        delete normalized.validation_errors;
        return normalized;
      }),
  });
  const schemaErrors = documentValidation
    ? []
    : formatSchemaErrors(validateReviewerFeedbackDocumentSchema.errors || []);

  return createSummary({
    status,
    evidence_state: evidenceState,
    total_count: counts.totalCount,
    unresolved_count: counts.unresolvedCount,
    linked_count: counts.linkedCount,
    unmatched_count: counts.unmatchedCount,
    stale_count: counts.staleCount,
    orphaned_count: counts.orphanedCount,
    invalid_count: counts.invalidCount,
    accepted_count: counts.acceptedCount,
    resolved_count: counts.resolvedCount,
    items,
    summary: buildSummaryText({
      status,
      counts,
      inputErrors: uniqueStrings([
        ...inputErrors,
        ...schemaErrors,
      ]),
    }),
    suggested_actions: feedbackActions.suggestedActions,
    suggested_action_details: feedbackActions.actionDetails,
    provenance: {
      path: effectivePath,
      input_status: effectiveInputStatus,
      source: documentSource,
    },
  });
}

export function normalizeReviewerFeedbackSummary(reviewerFeedback = null) {
  if (!reviewerFeedback || typeof reviewerFeedback !== 'object') {
    return createSummary();
  }
  return createSummary(reviewerFeedback);
}

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  buildPlannerActionsFromExtractedCoverage,
  formatPlannerSuggestedAction,
} from './drawing-planner.js';

const EXTRACTED_DRAWING_SEMANTICS_SCHEMA = JSON.parse(
  readFileSync(new URL('../../../schemas/extracted-drawing-semantics.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const validateSemantics = ajv.compile(EXTRACTED_DRAWING_SEMANTICS_SCHEMA);

export const EXTRACTED_DRAWING_SEMANTICS_SCHEMA_VERSION = 1;
export const EXTRACTED_DRAWING_SEMANTICS_ARTIFACT_TYPE = 'extracted_drawing_semantics';
export const RELIABLE_EXTRACTED_MATCH_CONFIDENCE = 0.75;

function formatSchemaErrors(errors = []) {
  return errors.map((error) => `${error.instancePath || '/'} ${error.message}`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

function resolveMaybe(path) {
  return typeof path === 'string' && path.trim() ? resolve(path) : null;
}

function normalizeText(value = null) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeComparable(value = null) {
  return normalizeText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, '') || null;
}

function roundConfidence(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeRequirementItem(item, defaultRequired = false) {
  if (typeof item === 'string') {
    return {
      id: item,
      label: item,
      text: item,
      required: defaultRequired,
      optional: !defaultRequired,
    };
  }
  if (!item || typeof item !== 'object') return null;
  const id = normalizeText(item.id ?? item.key ?? item.name ?? item.feature ?? item.dim_id ?? item.view);
  const label = normalizeText(item.label ?? item.title ?? item.name ?? item.text ?? id);
  if (!id && !label) return null;
  const optional = item.optional === true || item.required === false;
  const required = item.required === true || item.critical === true || (!optional && defaultRequired);
  return {
    ...item,
    id,
    label: label || id,
    required,
    optional: optional || !required,
  };
}

function normalizeRequirementList(values = [], defaultRequired = false) {
  return asArray(values)
    .map((item) => normalizeRequirementItem(item, defaultRequired))
    .filter(Boolean);
}

function uniqueById(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeComparable(item?.id ?? item?.label ?? item?.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function collectIntentDimensions(drawingIntent = {}) {
  const required = normalizeRequirementList(
    drawingIntent.required_dimensions
      ?? drawingIntent.dimensions
      ?? drawingIntent.dimension_requirements,
    true
  ).filter((entry) => entry.required && !entry.optional);
  return uniqueById(required);
}

function collectIntentNotes(drawingIntent = {}) {
  return uniqueById(normalizeRequirementList(
    drawingIntent.required_notes
      ?? drawingIntent.notes?.required
      ?? drawingIntent.notes,
    true
  ).filter((entry) => entry.required && !entry.optional));
}

function collectIntentViews(drawingIntent = {}) {
  return uniqueById(normalizeRequirementList(
    drawingIntent.required_views
      ?? drawingIntent.views?.required
      ?? drawingIntent.views,
    true
  ).filter((entry) => entry.required && !entry.optional));
}

function createSource(artifactType, path, inspected, method) {
  return {
    artifact_type: artifactType,
    path: resolveMaybe(path),
    inspected: Boolean(inspected),
    method,
  };
}

function createProvenance({ artifactType, path = null, method, ...extra } = {}) {
  return {
    artifact_type: artifactType,
    path: resolveMaybe(path),
    method,
    ...extra,
  };
}

function decodeEntity(entity) {
  if (entity === '&amp;') return '&';
  if (entity === '&lt;') return '<';
  if (entity === '&gt;') return '>';
  if (entity === '&quot;') return '"';
  if (entity === '&apos;') return '\'';
  if (/^&#x[0-9a-f]+;$/i.test(entity)) {
    return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
  }
  if (/^&#\d+;$/.test(entity)) {
    return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
  }
  return entity;
}

function decodeXmlText(text = '') {
  return String(text).replace(/&(amp|lt|gt|quot|apos);|&#x[0-9a-f]+;|&#\d+;/gi, decodeEntity);
}

function extractSvgTextNodes(svgContent = null) {
  if (typeof svgContent !== 'string' || !svgContent.trim()) return [];
  const nodes = [];
  const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(svgContent)) !== null) {
    const attributes = match[1] || '';
    const rawInner = match[2] || '';
    const text = decodeXmlText(rawInner.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    nodes.push({
      id: `svg_text_${String(++index).padStart(3, '0')}`,
      text,
      attributes,
    });
  }
  return nodes;
}

function looksLikeDimensionText(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (/^\d{1,3}(?:\.\d+)?$/.test(normalized)) return true;
  if (/^(?:\d+X|X\d+)\s*[ØR]?\s*\d+(?:\.\d+)?(?:\s*(?:MM|DEG|°))?$/i.test(normalized)) return true;
  if (/^(?:THK|TYP)\s+\d+(?:\.\d+)?$/i.test(normalized)) return true;
  if (/^[ØR]\s*\d+(?:\.\d+)?(?:\s*(?:MM|DEG|°))?$/i.test(normalized)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:MM|DEG|°)$/.test(normalized.toUpperCase())) return true;
  return false;
}

function parseDimensionValue(rawText = '') {
  const normalized = normalizeText(rawText);
  if (!normalized) return { value: null, unit: null };
  const matches = [...normalized.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)].map((match) => match[1]);
  if (matches.length === 0) return { value: null, unit: null };
  const rawValue = /\b\d+\s*X\b/i.test(normalized) && matches.length > 1
    ? matches[matches.length - 1]
    : matches[0];
  const value = Number.parseFloat(rawValue);
  const upper = normalized.toUpperCase();
  const unit = upper.includes('DEG') || normalized.includes('°')
    ? 'deg'
    : 'mm';
  return {
    value: Number.isFinite(value) ? value : null,
    unit,
  };
}

function classifyNoteCategory(text = '') {
  const normalized = normalizeText(text)?.toUpperCase() || '';
  if (!normalized) return 'unknown';
  if (/\bMATERIAL\b/.test(normalized) || /\b(AL\d{3,4}|SS\d{3,4}|SUS\d{3,4}|SCM\d{3,4})\b/.test(normalized)) {
    return 'material';
  }
  if (/\bTOL(?:ERANCE)?\b/.test(normalized) || normalized.includes('±') || /\bH\d+\b/.test(normalized)) {
    return 'tolerance';
  }
  if (/[A-Z]/.test(normalized)) {
    return 'general';
  }
  return 'unknown';
}

function matchRequiredNote(note = {}, requiredNotes = []) {
  const noteComparable = normalizeComparable(note?.raw_text);
  if (!noteComparable) return null;
  for (const required of requiredNotes) {
    const candidates = uniqueStrings([
      required.id,
      required.label,
      required.text,
      required.note,
    ]);
    for (const candidate of candidates) {
      const comparable = normalizeComparable(candidate);
      if (comparable && noteComparable.includes(comparable)) {
        return required;
      }
    }
  }
  return null;
}

function viewAliases(viewId = null) {
  const normalized = normalizeComparable(viewId);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  const aliasMap = {
    front: ['frontview', 'elevation'],
    top: ['topview', 'plan'],
    right: ['rightview', 'sideview'],
    left: ['leftview'],
    iso: ['isometric', 'isometricview'],
    section: ['sectionview', 'sectionaa', 'sectionbb'],
  };
  for (const alias of aliasMap[normalized] || []) aliases.add(alias);
  return [...aliases];
}

function matchRequiredView(view = {}, requiredViews = []) {
  const target = normalizeComparable(view.id ?? view.label);
  if (!target) return null;
  return requiredViews.find((required) => viewAliases(required.id ?? required.view ?? required.label).includes(target)) || null;
}

function findUniqueRequiredDimensionByValue(requiredDimensions = [], value = null) {
  if (!Number.isFinite(value)) return null;
  const matches = requiredDimensions.filter((required) => Number(required.value_mm) === value);
  return matches.length === 1 ? matches[0] : null;
}

function matchFeatureId(requiredDimension = {}, traceability = null) {
  const requiredFeature = normalizeText(requiredDimension.feature ?? requiredDimension.feature_id);
  if (requiredFeature) return requiredFeature;
  const dimId = normalizeComparable(requiredDimension.id ?? requiredDimension.dim_id);
  if (!dimId) return null;
  const link = asArray(traceability?.links).find((entry) => (
    normalizeComparable(entry?.dim_id ?? entry?.dimension_id) === dimId
      && normalizeText(entry?.feature_id ?? entry?.feature)
  ));
  return normalizeText(link?.feature_id ?? link?.feature);
}

function collectViewsFromLayout(layoutReport = null, layoutReportPath = null, requiredViews = []) {
  const views = [];
  for (const [viewId, entry] of Object.entries(asObject(layoutReport?.views))) {
    const id = normalizeText(viewId);
    if (!id) continue;
    const matched = matchRequiredView({ id, label: entry?.label || id }, requiredViews);
    views.push({
      id,
      label: normalizeText(entry?.label) || id,
      source: resolveMaybe(layoutReportPath),
      matched_intent_id: matched?.id ?? null,
      confidence: roundConfidence(entry?.label ? 0.95 : 0.9),
      provenance: createProvenance({
        artifactType: 'layout_report',
        path: layoutReportPath,
        method: 'layout_report_views',
        layout_view_key: id,
      }),
    });
  }
  return views;
}

function collectViewsFromSvgText(textNodes = [], svgPath = null, requiredViews = []) {
  const views = [];
  for (const node of textNodes) {
    const comparable = normalizeComparable(node.text);
    if (!comparable) continue;
    const matched = requiredViews.find((required) => viewAliases(required.id ?? required.view ?? required.label).some((alias) => comparable.includes(alias)));
    if (!matched) continue;
    views.push({
      id: normalizeText(matched.id ?? matched.view ?? matched.label),
      label: node.text,
      source: resolveMaybe(svgPath),
      matched_intent_id: normalizeText(matched.id ?? matched.view ?? matched.label),
      confidence: roundConfidence(0.72),
      provenance: createProvenance({
        artifactType: 'svg',
        path: svgPath,
        method: 'svg_view_label_scan',
        svg_text_id: node.id,
      }),
    });
  }
  return views;
}

function dedupeViewEntries(entries = []) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = `${normalizeComparable(entry.id)}:${normalizeComparable(entry.label)}:${entry.provenance.method}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function collectDimensionsFromSvg(textNodes = [], svgPath = null, requiredDimensions = [], traceability = null) {
  const dimensions = [];
  for (const node of textNodes) {
    if (!looksLikeDimensionText(node.text)) continue;
    const { value, unit } = parseDimensionValue(node.text);
    const matchedRequired = findUniqueRequiredDimensionByValue(requiredDimensions, value);
    dimensions.push({
      id: node.id,
      raw_text: node.text,
      value,
      unit,
      matched_intent_id: matchedRequired?.id ?? null,
      matched_feature_id: matchedRequired ? matchFeatureId(matchedRequired, traceability) : null,
      source: resolveMaybe(svgPath),
      confidence: roundConfidence(matchedRequired ? 0.84 : 0.62),
      provenance: createProvenance({
        artifactType: 'svg',
        path: svgPath,
        method: 'svg_dimension_text_scan',
        svg_text_id: node.id,
      }),
    });
  }
  return dimensions;
}

function collectNotesFromSvg(textNodes = [], svgPath = null, requiredNotes = []) {
  const notes = [];
  for (const node of textNodes) {
    if (looksLikeDimensionText(node.text)) continue;
    if (!/[A-Za-z]/.test(node.text)) continue;
    if (['front', 'top', 'right', 'left', 'iso', 'section'].some((viewKey) => (
      viewAliases(viewKey).some((alias) => normalizeComparable(node.text)?.includes(alias))
    ))) {
      continue;
    }
    const category = classifyNoteCategory(node.text);
    const matchedRequired = matchRequiredNote({ raw_text: node.text }, requiredNotes);
    notes.push({
      id: node.id,
      raw_text: node.text,
      category,
      matched_intent_id: matchedRequired?.id ?? null,
      source: resolveMaybe(svgPath),
      confidence: roundConfidence(matchedRequired ? 0.82 : category === 'unknown' ? 0.45 : 0.68),
      provenance: createProvenance({
        artifactType: 'svg',
        path: svgPath,
        method: 'svg_note_text_scan',
        svg_text_id: node.id,
      }),
    });
  }
  return notes;
}

function firstMatchingNote(notes = [], predicate) {
  return notes.find((note) => predicate(note)) || null;
}

function buildTitleBlock(notes = []) {
  return {
    part_name: firstMatchingNote(notes, (note) => /\bPART\b|\bNAME\b/i.test(note.raw_text))
      ? {
          raw_text: firstMatchingNote(notes, (note) => /\bPART\b|\bNAME\b/i.test(note.raw_text)).raw_text,
          source: firstMatchingNote(notes, (note) => /\bPART\b|\bNAME\b/i.test(note.raw_text)).source,
          confidence: 0.6,
          provenance: firstMatchingNote(notes, (note) => /\bPART\b|\bNAME\b/i.test(note.raw_text)).provenance,
        }
      : null,
    material: firstMatchingNote(notes, (note) => note.category === 'material')
      ? {
          raw_text: firstMatchingNote(notes, (note) => note.category === 'material').raw_text,
          source: firstMatchingNote(notes, (note) => note.category === 'material').source,
          confidence: 0.72,
          provenance: firstMatchingNote(notes, (note) => note.category === 'material').provenance,
        }
      : null,
    tolerance: firstMatchingNote(notes, (note) => note.category === 'tolerance')
      ? {
          raw_text: firstMatchingNote(notes, (note) => note.category === 'tolerance').raw_text,
          source: firstMatchingNote(notes, (note) => note.category === 'tolerance').source,
          confidence: 0.72,
          provenance: firstMatchingNote(notes, (note) => note.category === 'tolerance').provenance,
        }
      : null,
    drawing_number: firstMatchingNote(notes, (note) => /\bDRAWING\b|\bDWG\b|\bNO\b/i.test(note.raw_text))
      ? {
          raw_text: firstMatchingNote(notes, (note) => /\bDRAWING\b|\bDWG\b|\bNO\b/i.test(note.raw_text)).raw_text,
          source: firstMatchingNote(notes, (note) => /\bDRAWING\b|\bDWG\b|\bNO\b/i.test(note.raw_text)).source,
          confidence: 0.58,
          provenance: firstMatchingNote(notes, (note) => /\bDRAWING\b|\bDWG\b|\bNO\b/i.test(note.raw_text)).provenance,
        }
      : null,
  };
}

function buildCoverage(requiredDimensions = [], requiredNotes = [], requiredViews = [], dimensions = [], notes = [], views = []) {
  const matchedDimensionIds = new Set(
    dimensions
      .map((entry) => normalizeComparable(entry.matched_intent_id))
      .filter(Boolean)
  );
  const matchedNoteIds = new Set(
    notes
      .map((entry) => normalizeComparable(entry.matched_intent_id))
      .filter(Boolean)
  );
  const matchedViewIds = new Set(
    views
      .map((entry) => normalizeComparable(entry.matched_intent_id ?? entry.id))
      .filter(Boolean)
  );
  return {
    required_dimensions_total: requiredDimensions.length,
    required_dimensions_extracted: requiredDimensions.filter((entry) => matchedDimensionIds.has(normalizeComparable(entry.id))).length,
    required_notes_total: requiredNotes.length,
    required_notes_extracted: requiredNotes.filter((entry) => matchedNoteIds.has(normalizeComparable(entry.id))).length,
    required_views_total: requiredViews.length,
    required_views_extracted: requiredViews.filter((entry) => matchedViewIds.has(normalizeComparable(entry.id ?? entry.view ?? entry.label))).length,
  };
}

function determineStatus({ sources = [], views = [], dimensions = [], notes = [], unknowns = [] } = {}) {
  const inspected = sources.filter((source) => source.inspected);
  const extractedCount = views.length + dimensions.length + notes.length;
  if (inspected.length === 0) return 'unsupported';
  if (extractedCount === 0) return 'unknown';
  return unknowns.length > 0 ? 'partial' : 'available';
}

function roundPercent(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function hasUsableProvenance(entry = {}) {
  return Boolean(
    entry?.provenance
      && typeof entry.provenance === 'object'
      && normalizeText(entry.provenance.artifact_type)
      && normalizeText(entry.provenance.method)
  );
}

function compareConfidence(a = {}, b = {}) {
  return Number(b?.confidence || 0) - Number(a?.confidence || 0);
}

function sortByConfidence(entries = []) {
  return [...entries].sort(compareConfidence);
}

function candidateMatch(entry = {}, reason) {
  return {
    matched_extracted_id: normalizeText(entry.id),
    matched_raw_text: normalizeText(entry.raw_text ?? entry.label),
    matched_feature_id: normalizeText(entry.matched_feature_id),
    source_artifact: normalizeText(entry.provenance?.artifact_type ?? entry.source),
    confidence: roundConfidence(entry.confidence),
    reason,
    provenance: hasUsableProvenance(entry) ? entry.provenance : null,
  };
}

function comparableRequirementHints(requirement = {}) {
  return uniqueStrings([
    requirement.id,
    requirement.label,
    requirement.text,
    requirement.note,
    requirement.view,
  ]).map((value) => normalizeComparable(value)).filter(Boolean);
}

function hasRequirementUnknownHint(requirement = {}, unknowns = []) {
  const hints = comparableRequirementHints(requirement);
  if (hints.length === 0) return false;
  return asArray(unknowns).some((entry) => {
    const comparable = normalizeComparable(entry);
    return comparable && hints.some((hint) => comparable.includes(hint));
  });
}

function categorySourcesAvailable(extractedDrawingSemantics = {}, category) {
  const sources = asArray(extractedDrawingSemantics?.sources).filter((source) => source?.inspected === true);
  if (category === 'views') {
    return sources.some((source) => source.artifact_type === 'layout_report' || source.artifact_type === 'svg');
  }
  return sources.some((source) => source.artifact_type === 'svg');
}

function reliableMatch(entry = {}) {
  return hasUsableProvenance(entry) && Number(entry.confidence || 0) >= RELIABLE_EXTRACTED_MATCH_CONFIDENCE;
}

function normalizeRequirementEntry(requirement = {}, classification, {
  match = null,
  reason,
  candidateMatches = [],
} = {}) {
  return {
    requirement_id: normalizeText(requirement.id),
    requirement_label: normalizeText(requirement.label ?? requirement.text ?? requirement.view ?? requirement.id),
    classification,
    matched_extracted_id: normalizeText(match?.id),
    matched_raw_text: normalizeText(match?.raw_text ?? match?.label),
    matched_feature_id: normalizeText(match?.matched_feature_id),
    source_artifact: normalizeText(match?.provenance?.artifact_type ?? match?.source),
    confidence: match ? roundConfidence(match.confidence) : null,
    reason,
    provenance: match && hasUsableProvenance(match) ? match.provenance : null,
    candidate_matches: candidateMatches,
  };
}

function coverageCounts(entries = []) {
  const counts = {
    total: entries.length,
    extracted: 0,
    missing: 0,
    unknown: 0,
    unsupported: 0,
  };
  for (const entry of entries) {
    if (entry?.classification === 'extracted') counts.extracted += 1;
    else if (entry?.classification === 'missing') counts.missing += 1;
    else if (entry?.classification === 'unsupported') counts.unsupported += 1;
    else counts.unknown += 1;
  }
  return {
    ...counts,
    extracted_percent: roundPercent(counts.extracted, counts.total),
  };
}

function compareRequiredDimensions(requiredDimensions = [], extractedDrawingSemantics = null) {
  const semantics = asObject(extractedDrawingSemantics);
  const unknowns = asArray(semantics.unknowns);
  const sourcesAvailable = categorySourcesAvailable(semantics, 'dimensions');
  const dimensions = asArray(semantics.dimensions);
  const usedIds = new Set();

  const required = requiredDimensions.map((requirement) => {
    const requirementId = normalizeComparable(requirement.id);
    const matches = sortByConfidence(dimensions.filter((entry) => (
      normalizeComparable(entry.matched_intent_id) === requirementId
    )));
    const reliable = matches.filter(reliableMatch);
    const bestReliable = reliable[0] || null;
    const candidateMatches = matches
      .filter((entry) => !reliableMatch(entry))
      .map((entry) => candidateMatch(entry, 'Matched extracted dimension stayed below the reliable confidence threshold.'));

    if (bestReliable) {
      usedIds.add(bestReliable.id);
      return normalizeRequirementEntry(
        requirement,
        'extracted',
        {
          match: bestReliable,
          reason: 'Reliable extracted dimension evidence matched this required dimension.',
          candidateMatches,
        }
      );
    }

    if (candidateMatches.length > 0) {
      matches.forEach((entry) => usedIds.add(entry.id));
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        {
          reason: 'Only low-confidence extracted dimension candidates were available for this required dimension.',
          candidateMatches,
        }
      );
    }

    if (!semantics || Object.keys(semantics).length === 0) {
      return normalizeRequirementEntry(
        requirement,
        'unsupported',
        { reason: 'Extracted drawing semantics artifact was not available for comparison.' }
      );
    }

    if (!sourcesAvailable) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'Dimension extraction evidence was unavailable, so this requirement remains unknown.' }
      );
    }

    if (hasRequirementUnknownHint(requirement, unknowns)) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'Extracted drawing semantics explicitly marked this required dimension as uncertain.' }
      );
    }

    return normalizeRequirementEntry(
      requirement,
      'missing',
      { reason: 'No reliable extracted dimension evidence matched this required dimension.' }
    );
  });

  const unmatched = sortByConfidence(dimensions)
    .filter((entry) => !usedIds.has(entry.id))
    .filter((entry) => !normalizeComparable(entry.matched_intent_id))
    .map((entry) => ({
      extracted_id: normalizeText(entry.id),
      raw_text: normalizeText(entry.raw_text),
      matched_feature_id: normalizeText(entry.matched_feature_id),
      source_artifact: normalizeText(entry.provenance?.artifact_type ?? entry.source),
      confidence: roundConfidence(entry.confidence),
      reason: 'Extracted dimension did not match a required drawing-intent dimension.',
      provenance: hasUsableProvenance(entry) ? entry.provenance : null,
    }));

  return {
    required,
    unmatched,
    coverage: coverageCounts(required),
  };
}

function compareRequiredNotes(requiredNotes = [], extractedDrawingSemantics = null) {
  const semantics = asObject(extractedDrawingSemantics);
  const unknowns = asArray(semantics.unknowns);
  const sourcesAvailable = categorySourcesAvailable(semantics, 'notes');
  const notes = asArray(semantics.notes);
  const usedIds = new Set();

  const required = requiredNotes.map((requirement) => {
    const requirementId = normalizeComparable(requirement.id);
    const matches = sortByConfidence(notes.filter((entry) => (
      normalizeComparable(entry.matched_intent_id) === requirementId
    )));
    const reliable = matches.filter(reliableMatch);
    const bestReliable = reliable[0] || null;
    const candidateMatches = matches
      .filter((entry) => !reliableMatch(entry))
      .map((entry) => candidateMatch(entry, 'Matched extracted note stayed below the reliable confidence threshold.'));

    if (bestReliable) {
      usedIds.add(bestReliable.id);
      return normalizeRequirementEntry(
        requirement,
        'extracted',
        {
          match: bestReliable,
          reason: 'Reliable extracted note evidence matched this required drawing note.',
          candidateMatches,
        }
      );
    }

    if (candidateMatches.length > 0) {
      matches.forEach((entry) => usedIds.add(entry.id));
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        {
          reason: 'Only low-confidence extracted note candidates were available for this required drawing note.',
          candidateMatches,
        }
      );
    }

    if (!semantics || Object.keys(semantics).length === 0) {
      return normalizeRequirementEntry(
        requirement,
        'unsupported',
        { reason: 'Extracted drawing semantics artifact was not available for comparison.' }
      );
    }

    if (!sourcesAvailable) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'Note extraction evidence was unavailable, so this requirement remains unknown.' }
      );
    }

    if (hasRequirementUnknownHint(requirement, unknowns)) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'Extracted drawing semantics explicitly marked this required note as uncertain.' }
      );
    }

    return normalizeRequirementEntry(
      requirement,
      'missing',
      { reason: 'No reliable extracted note evidence matched this required drawing note.' }
    );
  });

  const unmatched = sortByConfidence(notes)
    .filter((entry) => !usedIds.has(entry.id))
    .filter((entry) => !normalizeComparable(entry.matched_intent_id))
    .map((entry) => ({
      extracted_id: normalizeText(entry.id),
      raw_text: normalizeText(entry.raw_text),
      category: normalizeText(entry.category),
      source_artifact: normalizeText(entry.provenance?.artifact_type ?? entry.source),
      confidence: roundConfidence(entry.confidence),
      reason: 'Extracted note did not match a required drawing-intent note.',
      provenance: hasUsableProvenance(entry) ? entry.provenance : null,
    }));

  return {
    required,
    unmatched,
    coverage: coverageCounts(required),
  };
}

function compareRequiredViews(requiredViews = [], extractedDrawingSemantics = null) {
  const semantics = asObject(extractedDrawingSemantics);
  const unknowns = asArray(semantics.unknowns);
  const sourcesAvailable = categorySourcesAvailable(semantics, 'views');
  const views = asArray(semantics.views);

  const required = requiredViews.map((requirement) => {
    const aliases = viewAliases(requirement.id ?? requirement.view ?? requirement.label).map(normalizeComparable);
    const matches = sortByConfidence(views.filter((entry) => {
      const matchedIntentId = normalizeComparable(entry.matched_intent_id);
      const entryId = normalizeComparable(entry.id);
      return aliases.includes(matchedIntentId) || aliases.includes(entryId);
    }));
    const reliable = matches.filter(reliableMatch);
    const bestReliable = reliable[0] || null;
    const candidateMatches = matches
      .filter((entry) => !reliableMatch(entry))
      .map((entry) => candidateMatch(entry, 'Matched extracted view stayed below the reliable confidence threshold.'));

    if (bestReliable) {
      return normalizeRequirementEntry(
        requirement,
        'extracted',
        {
          match: bestReliable,
          reason: 'Reliable extracted view evidence matched this required view.',
          candidateMatches,
        }
      );
    }

    if (candidateMatches.length > 0) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        {
          reason: 'Only low-confidence extracted view candidates were available for this required view.',
          candidateMatches,
        }
      );
    }

    if (!semantics || Object.keys(semantics).length === 0) {
      return normalizeRequirementEntry(
        requirement,
        'unsupported',
        { reason: 'Extracted drawing semantics artifact was not available for comparison.' }
      );
    }

    if (!sourcesAvailable) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'View extraction evidence was unavailable, so this requirement remains unknown.' }
      );
    }

    if (hasRequirementUnknownHint(requirement, unknowns)) {
      return normalizeRequirementEntry(
        requirement,
        'unknown',
        { reason: 'Extracted drawing semantics explicitly marked this required view as uncertain.' }
      );
    }

    return normalizeRequirementEntry(
      requirement,
      'missing',
      { reason: 'No reliable extracted view evidence matched this required view.' }
    );
  });

  return {
    required,
    coverage: coverageCounts(required),
  };
}

function summarizeComparisonCoverage({ dimensions, notes, views }) {
  return {
    required_dimensions: dimensions.coverage,
    required_notes: notes.coverage,
    required_views: views.coverage,
    total_required: dimensions.coverage.total + notes.coverage.total + views.coverage.total,
    total_extracted: dimensions.coverage.extracted + notes.coverage.extracted + views.coverage.extracted,
    total_missing: dimensions.coverage.missing + notes.coverage.missing + views.coverage.missing,
    total_unknown: dimensions.coverage.unknown + notes.coverage.unknown + views.coverage.unknown,
    total_unsupported: dimensions.coverage.unsupported + notes.coverage.unsupported + views.coverage.unsupported,
  };
}

function summarizeUnknownRequirements(comparison = {}) {
  return [
    ...asArray(comparison.required_dimensions).filter((entry) => entry.classification === 'unknown').map((entry) => entry.requirement_id),
    ...asArray(comparison.required_notes).filter((entry) => entry.classification === 'unknown').map((entry) => entry.requirement_id),
    ...asArray(comparison.required_views).filter((entry) => entry.classification === 'unknown').map((entry) => entry.requirement_id),
  ].filter(Boolean);
}

function summarizeMissingRequirements(comparison = {}) {
  return [
    ...asArray(comparison.required_dimensions).filter((entry) => entry.classification === 'missing').map((entry) => entry.requirement_id),
    ...asArray(comparison.required_notes).filter((entry) => entry.classification === 'missing').map((entry) => entry.requirement_id),
    ...asArray(comparison.required_views).filter((entry) => entry.classification === 'missing').map((entry) => entry.requirement_id),
  ].filter(Boolean);
}

export function compareDrawingIntentToExtractedSemantics(
  drawingIntent = null,
  extractedDrawingSemantics = null,
  featureCatalog = null,
  planner = null,
  extractedDrawingSemanticsPath = null
) {
  const intent = asObject(drawingIntent);
  const requiredDimensions = collectIntentDimensions(intent);
  const requiredNotes = collectIntentNotes(intent);
  const requiredViews = collectIntentViews(intent);
  const semantics = extractedDrawingSemantics && typeof extractedDrawingSemantics === 'object'
    ? extractedDrawingSemantics
    : null;

  const dimensionComparison = compareRequiredDimensions(requiredDimensions, semantics);
  const noteComparison = compareRequiredNotes(requiredNotes, semantics);
  const viewComparison = compareRequiredViews(requiredViews, semantics);
  const coverage = summarizeComparisonCoverage({
    dimensions: dimensionComparison,
    notes: noteComparison,
    views: viewComparison,
  });

  const comparison = {
    status: semantics?.status || (extractedDrawingSemanticsPath ? 'not_available' : 'not_run'),
    advisory_only: semantics?.decision !== 'enforced',
    file: resolveMaybe(extractedDrawingSemanticsPath),
    path: resolveMaybe(extractedDrawingSemanticsPath),
    sources: asArray(semantics?.sources),
    coverage,
    required_dimensions: dimensionComparison.required,
    required_notes: noteComparison.required,
    required_views: viewComparison.required,
    unmatched_dimensions: dimensionComparison.unmatched,
    unmatched_notes: noteComparison.unmatched,
    unknowns: uniqueStrings([
      ...asArray(semantics?.unknowns),
      ...summarizeUnknownRequirements({
        required_dimensions: dimensionComparison.required,
        required_notes: noteComparison.required,
        required_views: viewComparison.required,
      }).map((requirementId) => `Required extracted evidence remains unknown: ${requirementId}.`),
    ]),
    limitations: uniqueStrings(asArray(semantics?.limitations)),
    matched_required_dimensions: coverage.required_dimensions.extracted,
    matched_required_notes: coverage.required_notes.extracted,
    matched_required_views: coverage.required_views.extracted,
    missing_required_items: summarizeMissingRequirements({
      required_dimensions: dimensionComparison.required,
      required_notes: noteComparison.required,
      required_views: viewComparison.required,
    }),
  };

  comparison.suggested_action_details = buildPlannerActionsFromExtractedCoverage({
    drawingIntent: intent,
    featureCatalog,
    planner,
    extractedEvidence: comparison,
  });
  comparison.suggested_actions = uniqueStrings(
    comparison.suggested_action_details.map((entry) => formatPlannerSuggestedAction(entry))
  );
  return comparison;
}

export function resolveExtractedDrawingSemanticsPath(drawingSvgPath) {
  if (!drawingSvgPath) return null;
  const resolvedSvgPath = resolve(drawingSvgPath);
  const parsed = parse(resolvedSvgPath);
  const stem = parsed.name.replace(/_drawing$/i, '');
  return join(parsed.dir, `${stem}_extracted_drawing_semantics.json`);
}

export function buildExtractedDrawingSemantics({
  drawingSvgPath = null,
  svgContent = null,
  layoutReportPath = null,
  layoutReport = null,
  dimensionMapPath = null,
  dimensionMap = null,
  traceabilityPath = null,
  traceability = null,
  drawingIntent = null,
} = {}) {
  const requiredDimensions = collectIntentDimensions(asObject(drawingIntent));
  const requiredNotes = collectIntentNotes(asObject(drawingIntent));
  const requiredViews = collectIntentViews(asObject(drawingIntent));
  const textNodes = extractSvgTextNodes(svgContent);

  const sources = [
    createSource('svg', drawingSvgPath, Boolean(svgContent), 'svg_text_scan'),
    createSource('layout_report', layoutReportPath, Boolean(layoutReport && typeof layoutReport === 'object'), 'layout_report_views'),
    createSource('dimension_map', dimensionMapPath, Boolean(dimensionMap && typeof dimensionMap === 'object'), 'dimension_map_reference'),
    createSource('traceability', traceabilityPath, Boolean(traceability && typeof traceability === 'object'), 'traceability_reference'),
  ];

  const methods = uniqueStrings(sources.filter((source) => source.inspected).map((source) => source.method));
  const views = dedupeViewEntries([
    ...collectViewsFromLayout(layoutReport, layoutReportPath, requiredViews),
    ...collectViewsFromSvgText(textNodes, drawingSvgPath, requiredViews),
  ]);
  const dimensions = collectDimensionsFromSvg(textNodes, drawingSvgPath, requiredDimensions, traceability);
  const notes = collectNotesFromSvg(textNodes, drawingSvgPath, requiredNotes);
  const titleBlock = buildTitleBlock(notes);
  const coverage = buildCoverage(requiredDimensions, requiredNotes, requiredViews, dimensions, notes, views);

  const unknowns = uniqueStrings([
    !svgContent ? 'SVG text evidence is unavailable; text extraction stayed conservative.' : null,
    !layoutReport ? 'Layout report evidence is unavailable; reliable view extraction may be incomplete.' : null,
    !dimensionMap ? 'Dimension map evidence is unavailable; rendered-dimension cross-checks stayed unknown.' : null,
    !traceability ? 'Traceability evidence is unavailable; matched feature provenance stayed unknown where applicable.' : null,
    ...requiredDimensions
      .filter((entry) => !dimensions.some((dimension) => normalizeComparable(dimension.matched_intent_id) === normalizeComparable(entry.id)))
      .map((entry) => `Required dimension not reliably extracted: ${entry.id}.`),
    ...requiredNotes
      .filter((entry) => !notes.some((note) => normalizeComparable(note.matched_intent_id) === normalizeComparable(entry.id)))
      .map((entry) => `Required note not reliably extracted: ${entry.id}.`),
    ...requiredViews
      .filter((entry) => !views.some((view) => normalizeComparable(view.matched_intent_id ?? view.id) === normalizeComparable(entry.id ?? entry.view ?? entry.label)))
      .map((entry) => `Required view not reliably extracted: ${entry.id ?? entry.view ?? entry.label}.`),
  ]);

  const limitations = uniqueStrings([
    'Advisory-only foundation; no OCR, no PDF raster parsing, and no screenshot analysis were used.',
    'Vector geometry without reliable text labels is not promoted to semantic matches in this task.',
    'Unsupported or missing extraction evidence remains unknown instead of being inferred as pass.',
  ]);

  const semantics = {
    schema_version: EXTRACTED_DRAWING_SEMANTICS_SCHEMA_VERSION,
    artifact_type: EXTRACTED_DRAWING_SEMANTICS_ARTIFACT_TYPE,
    status: determineStatus({ sources, views, dimensions, notes, unknowns }),
    decision: 'advisory',
    methods,
    sources,
    views,
    dimensions,
    notes,
    title_block: titleBlock,
    coverage,
    unknowns,
    limitations,
  };

  const validation = validateExtractedDrawingSemantics(semantics);
  if (!validation.ok) {
    throw new Error(`Invalid extracted drawing semantics: ${validation.errors.join(' | ')}`);
  }

  return semantics;
}

export function summarizeExtractedDrawingSemantics(extractedDrawingSemantics = null, extractedDrawingSemanticsPath = null) {
  if (!extractedDrawingSemantics || typeof extractedDrawingSemantics !== 'object') {
    return {
      status: extractedDrawingSemanticsPath ? 'not_available' : 'not_run',
      advisory_only: true,
      path: resolveMaybe(extractedDrawingSemanticsPath),
      matched_required_dimensions: 0,
      matched_required_notes: 0,
      matched_required_views: 0,
      unknowns: [],
      limitations: [],
    };
  }
  return {
    status: extractedDrawingSemantics.status || 'unknown',
    advisory_only: extractedDrawingSemantics.decision !== 'enforced',
    path: resolveMaybe(extractedDrawingSemanticsPath),
    matched_required_dimensions: Number(extractedDrawingSemantics.coverage?.required_dimensions_extracted || 0),
    matched_required_notes: Number(extractedDrawingSemantics.coverage?.required_notes_extracted || 0),
    matched_required_views: Number(extractedDrawingSemantics.coverage?.required_views_extracted || 0),
    unknowns: uniqueStrings(extractedDrawingSemantics.unknowns || []),
    limitations: uniqueStrings(extractedDrawingSemantics.limitations || []),
  };
}

export function validateExtractedDrawingSemantics(semantics) {
  const valid = validateSemantics(semantics);
  return {
    ok: Boolean(valid),
    errors: valid ? [] : formatSchemaErrors(validateSemantics.errors || []),
  };
}

export async function writeExtractedDrawingSemantics(semanticsPath, semantics) {
  const validation = validateExtractedDrawingSemantics(semantics);
  if (!validation.ok) {
    throw new Error(`Invalid extracted drawing semantics: ${validation.errors.join(' | ')}`);
  }
  const resolvedPath = resolve(semanticsPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(semantics, null, 2)}\n`, 'utf8');
  return resolvedPath;
}

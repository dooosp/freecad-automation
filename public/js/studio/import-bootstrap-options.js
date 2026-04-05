function sanitizeOptionalInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values = []) {
  return [...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
  )];
}

export function buildImportBootstrapOptions(preview, corrections = {}) {
  const bootstrap = preview?.bootstrap || {};
  const correctedKind = sanitizeOptionalInput(corrections.importKind);
  const correctedUnit = sanitizeOptionalInput(corrections.unit);
  const correctedBodyCount = Number.parseInt(sanitizeOptionalInput(corrections.bodyCount), 10);
  const correctionNote = sanitizeOptionalInput(corrections.note);
  const importDiagnostics = structuredClone(bootstrap.import_diagnostics || {});
  const bootstrapSummary = structuredClone(bootstrap.bootstrap_summary || {});
  const confidenceMap = structuredClone(bootstrap.confidence_map || {});
  const draftConfigToml = typeof bootstrap.draft_config_toml === 'string' && bootstrap.draft_config_toml.length > 0
    ? bootstrap.draft_config_toml
    : '';

  if (!confidenceMap.import_bootstrap && importDiagnostics.confidence) {
    confidenceMap.import_bootstrap = {
      overall: structuredClone(importDiagnostics.confidence),
    };
  }
  if (!confidenceMap.import_bootstrap || typeof confidenceMap.import_bootstrap !== 'object') {
    confidenceMap.import_bootstrap = {};
  }

  if (correctedKind) {
    importDiagnostics.import_kind = correctedKind;
    importDiagnostics.part_vs_assembly = {
      ...(importDiagnostics.part_vs_assembly || {}),
      classification: correctedKind,
      source: 'studio-correction',
    };
    bootstrapSummary.import_kind = correctedKind;
    bootstrapSummary.model_kind = correctedKind;
    confidenceMap.import_bootstrap.part_vs_assembly = {
      ...(confidenceMap.import_bootstrap.part_vs_assembly || {}),
      classification: correctedKind,
      body_count: Number.isInteger(correctedBodyCount) && correctedBodyCount >= 0
        ? correctedBodyCount
        : importDiagnostics.body_count ?? null,
      source: 'studio-correction',
      rationale: correctionNote
        || `Studio confirmed the import classification as ${correctedKind}.`,
    };
  }

  if (Number.isInteger(correctedBodyCount) && correctedBodyCount >= 0) {
    importDiagnostics.body_count = correctedBodyCount;
    importDiagnostics.part_vs_assembly = {
      ...(importDiagnostics.part_vs_assembly || {}),
      body_count: correctedBodyCount,
      source: 'studio-correction',
    };
    bootstrapSummary.body_count = correctedBodyCount;
    confidenceMap.import_bootstrap.part_vs_assembly = {
      ...(confidenceMap.import_bootstrap.part_vs_assembly || {}),
      classification: correctedKind || importDiagnostics.import_kind || null,
      body_count: correctedBodyCount,
      source: 'studio-correction',
      rationale: correctionNote
        || `Studio confirmed the import body count as ${correctedBodyCount}.`,
    };
  }

  if (correctedUnit) {
    importDiagnostics.unit_assumption = {
      ...(importDiagnostics.unit_assumption || {}),
      unit: correctedUnit,
      source: 'studio-correction',
      assumed: false,
      rationale: correctionNote || 'Confirmed or corrected in the Studio bootstrap gate.',
    };
    bootstrapSummary.unit_system = correctedUnit;
    confidenceMap.import_bootstrap.unit_assumption = {
      ...(confidenceMap.import_bootstrap.unit_assumption || {}),
      unit: correctedUnit,
      assumed: false,
      source: 'studio-correction',
      rationale: correctionNote || 'Confirmed or corrected in the Studio bootstrap gate.',
    };
  }

  bootstrapSummary.review_gate = {
    ...(bootstrapSummary.review_gate || {}),
    status: 'review_required',
    reason: correctionNote ? 'human_correction_recorded' : 'human_confirmation_required',
  };

  const correctionWarnings = [];
  if (correctedKind) correctionWarnings.push(`Studio corrected import classification to ${correctedKind}.`);
  if (Number.isInteger(correctedBodyCount) && correctedBodyCount >= 0) {
    correctionWarnings.push(`Studio confirmed body count as ${correctedBodyCount}.`);
  }
  if (correctedUnit) correctionWarnings.push(`Studio confirmed unit assumption as ${correctedUnit}.`);
  if (correctionNote) correctionWarnings.push(`Studio correction note: ${correctionNote}`);

  return {
    studio: {
      source: 'import-bootstrap',
      session_id: preview?.session_id || '',
    },
    bootstrap: {
      import_diagnostics: importDiagnostics,
      bootstrap_summary: bootstrapSummary,
      warnings: uniqueStrings([
        ...(bootstrap.bootstrap_warnings?.warnings || []),
        ...correctionWarnings,
      ]),
      confidence_map: confidenceMap,
      ...(draftConfigToml ? { draft_config_toml: draftConfigToml } : {}),
    },
  };
}

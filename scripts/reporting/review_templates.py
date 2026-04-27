from d_artifact_contract import build_confidence, build_contract_fields, build_coverage, summarize_part


def _records(payload, key):
    return (payload.get(key) or {}).get("records") or []


def _safe_list(value):
    return value if isinstance(value, list) else []


def _clamp(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def _round_number(value, digits=3):
    if isinstance(value, (int, float)):
        return round(value, digits)
    return value


def _build_executive_summary(part, hotspots, inspection_outliers, quality_linkage_records, review_priorities, actions, confidence_report):
    top_categories = [item.get("category") for item in review_priorities[:3] if item.get("category")]
    top_category_text = ", ".join(top_categories) if top_categories else "no elevated review categories"
    headline = (
        f"{part.get('name', 'unknown_part')} revision {part.get('revision', 'n/a')} "
        f"shows {len(review_priorities)} prioritized review topics led by {top_category_text}."
    )
    return {
        "headline": headline,
        "part_revision": part.get("revision"),
        "top_risk_categories": top_categories,
        "priority_count": len(review_priorities),
        "geometry_hotspot_count": len(hotspots),
        "inspection_anomaly_count": len(inspection_outliers),
        "quality_signal_count": len(quality_linkage_records),
        "recommended_action_count": len(actions),
        "confidence": {
            "label": confidence_report.get("analysis_confidence"),
            "numeric_score": confidence_report.get("numeric_score"),
        },
    }


def _build_prioritized_hotspots(review_priorities, hotspots, inspection_linkage_records, quality_linkage_records, actions):
    geometry_by_category = {}
    for hotspot in hotspots:
        category = hotspot.get("category")
        if category:
            geometry_by_category.setdefault(category, []).append(hotspot)

    inspection_by_category = {}
    for record in inspection_linkage_records:
        for category in record.get("matched_categories") or []:
            inspection_by_category.setdefault(category, []).append(record)

    quality_by_category = {}
    for record in quality_linkage_records:
        category = record.get("linked_hotspot_category")
        if category:
            quality_by_category.setdefault(category, []).append(record)

    action_by_category = {
        action.get("category"): action
        for action in actions
        if action.get("category")
    }

    prioritized = []
    seen_categories = set()

    for priority in review_priorities:
        category = priority.get("category")
        if not category:
            continue
        seen_categories.add(category)
        prioritized.append({
            "priority_rank": priority.get("priority_rank"),
            "hotspot_id": priority.get("hotspot_id"),
            "category": category,
            "title": priority.get("title"),
            "score": priority.get("score"),
            "rationale": priority.get("rationale"),
            "evidence_count": priority.get("evidence_count"),
            "score_breakdown": priority.get("score_breakdown") or {},
            "geometry_hotspot_titles": [item.get("title") for item in geometry_by_category.get(category, []) if item.get("title")],
            "inspection_record_ids": [item.get("record_id") for item in inspection_by_category.get(category, []) if item.get("record_id")],
            "quality_issue_ids": [item.get("issue_id") for item in quality_by_category.get(category, []) if item.get("issue_id")],
            "recommended_action": (action_by_category.get(category) or {}).get("recommended_action"),
        })

    for hotspot in hotspots:
        category = hotspot.get("category")
        if not category or category in seen_categories:
            continue
        prioritized.append({
            "priority_rank": None,
            "hotspot_id": hotspot.get("hotspot_id"),
            "category": category,
            "title": hotspot.get("title"),
            "score": hotspot.get("score"),
            "rationale": hotspot.get("rationale"),
            "evidence_count": 1,
            "score_breakdown": {},
            "geometry_hotspot_titles": [hotspot.get("title")] if hotspot.get("title") else [],
            "inspection_record_ids": [item.get("record_id") for item in inspection_by_category.get(category, []) if item.get("record_id")],
            "quality_issue_ids": [item.get("issue_id") for item in quality_by_category.get(category, []) if item.get("issue_id")],
            "recommended_action": (action_by_category.get(category) or {}).get("recommended_action"),
        })
        seen_categories.add(category)

    prioritized.sort(
        key=lambda item: (
            item.get("priority_rank") is None,
            item.get("priority_rank") or 999,
            -(item.get("score") or 0),
        )
    )
    return prioritized


def _build_inspection_anomaly_linkage(inspection_linkage, inspection_outliers):
    linkage_records = _safe_list((inspection_linkage or {}).get("records"))
    linkage_index = {
        item.get("record_id"): item
        for item in linkage_records
        if item.get("record_id")
    }

    records = []
    for outlier in inspection_outliers:
        linked = linkage_index.get(outlier.get("record_id")) or {}
        records.append({
            "record_id": outlier.get("record_id"),
            "dimension_name": outlier.get("dimension_name"),
            "direction": outlier.get("direction"),
            "magnitude": outlier.get("magnitude"),
            "status": linked.get("status") or outlier.get("status"),
            "matched_categories": linked.get("matched_categories") or [],
            "confidence": linked.get("confidence"),
            "rationale": linked.get("rationale"),
        })

    unmatched = [item for item in linkage_records if not item.get("matched_categories")]
    return {
        "summary": {
            "record_count": len(records),
            "linked_record_count": len([item for item in records if item.get("matched_categories")]),
            "unmatched_record_count": len(unmatched),
        },
        "records": records,
    }


def _build_quality_pattern_linkage(quality_linkage, quality_hotspots):
    linkage_records = _safe_list((quality_linkage or {}).get("records"))
    hotspot_records = _safe_list((quality_hotspots or {}).get("records"))
    return {
        "summary": {
            **((quality_linkage or {}).get("summary") or {}),
            "linked_record_count": len([item for item in linkage_records if item.get("linked_to_geometry")]),
            "hotspot_count": len(hotspot_records),
        },
        "records": linkage_records,
        "hotspots": hotspot_records,
    }


def _has_classification(records, classification):
    for record in records:
        classifications = _safe_list(record.get("classifications"))
        if classification in classifications or record.get("category") == classification:
            return True
    return False


def _build_package_evidence_ledger_records(package_evidence):
    records = []
    for index, evidence in enumerate(package_evidence):
        if not isinstance(evidence, dict):
            continue
        evidence_type = evidence.get("type") or evidence.get("artifact_type") or "package_evidence"
        classifications = _safe_list(evidence.get("classifications"))
        category = evidence.get("category") or (classifications[0] if classifications else "advisory_context")
        records.append({
            "evidence_id": evidence.get("evidence_id") or f"package:{evidence_type}:{index + 1}",
            "type": evidence_type,
            "artifact_type": evidence.get("artifact_type") or evidence_type,
            "category": category,
            "classifications": classifications,
            "source_ref": evidence.get("source_ref"),
            "file_name": evidence.get("file_name"),
            "title": evidence.get("label") or evidence.get("file_name") or evidence_type,
            "score": evidence.get("score"),
            "rationale": evidence.get("rationale") or "Explicit review-context package side input.",
            "confidence": evidence.get("confidence"),
            "size_bytes": evidence.get("size_bytes"),
            "sha256": evidence.get("sha256"),
            "inspection_evidence": bool(evidence.get("inspection_evidence") is True),
        })
    return records


def _build_evidence_ledger(hotspots, inspection_anomaly_linkage, quality_pattern_linkage, package_evidence=None):
    records = []

    for hotspot in hotspots:
        category = hotspot.get("category") or "uncategorized"
        records.append({
            "evidence_id": f"geometry:{category}:{(hotspot.get('title') or 'untitled').lower().replace(' ', '_')}",
            "type": "geometry_hotspot",
            "category": category,
            "title": hotspot.get("title"),
            "score": hotspot.get("score"),
            "rationale": hotspot.get("rationale"),
            "confidence": 0.6,
        })

    for anomaly in inspection_anomaly_linkage.get("records") or []:
        records.append({
            "evidence_id": f"inspection:{anomaly.get('record_id')}",
            "type": "inspection_anomaly",
            "category": (anomaly.get("matched_categories") or [None])[0] or "inspection_variation",
            "linked_categories": anomaly.get("matched_categories") or [],
            "title": anomaly.get("dimension_name"),
            "score": anomaly.get("magnitude"),
            "rationale": anomaly.get("rationale"),
            "confidence": anomaly.get("confidence"),
        })

    for issue in quality_pattern_linkage.get("records") or []:
        category = issue.get("linked_hotspot_category") or "quality_pattern"
        records.append({
            "evidence_id": f"quality:{issue.get('issue_id')}",
            "type": "quality_pattern",
            "category": category,
            "title": issue.get("description"),
            "score": issue.get("severity_score"),
            "rationale": issue.get("rationale"),
            "confidence": 0.7 if issue.get("linked_to_geometry") else 0.45,
        })

    records.extend(_build_package_evidence_ledger_records(_safe_list(package_evidence)))
    counts_by_type = {}
    for record in records:
        record_type = record.get("type") or "unknown"
        counts_by_type[record_type] = counts_by_type.get(record_type, 0) + 1

    return {
        "record_count": len(records),
        "counts_by_type": {
            "geometry_hotspot": len([item for item in records if item.get("type") == "geometry_hotspot"]),
            "inspection_anomaly": len([item for item in records if item.get("type") == "inspection_anomaly"]),
            "quality_pattern": len([item for item in records if item.get("type") == "quality_pattern"]),
            **counts_by_type,
        },
        "records": records,
    }


def _build_uncertainty_coverage_report(metadata, geometry, hotspots, inspection_anomaly_linkage, quality_pattern_linkage, review_priorities, evidence_ledger):
    source_files = _safe_list(metadata.get("source_files"))
    warnings = _safe_list(metadata.get("warnings"))
    ledger_records = _safe_list(evidence_ledger.get("records"))
    has_quality_evidence = bool(quality_pattern_linkage.get("records")) or _has_classification(ledger_records, "quality_evidence")
    missing_inputs = []
    if not source_files:
        missing_inputs.append("source_files")
    if not inspection_anomaly_linkage.get("records"):
        missing_inputs.append("inspection_evidence")
    if not has_quality_evidence:
        missing_inputs.append("quality_evidence")

    numeric_score = 0.45
    if hotspots:
        numeric_score += 0.15
    if inspection_anomaly_linkage.get("records"):
        numeric_score += 0.15
    if has_quality_evidence:
        numeric_score += 0.15
    if review_priorities:
        numeric_score += 0.05
    numeric_score -= min(len(warnings) * 0.03, 0.15)
    numeric_score = _round_number(_clamp(numeric_score, 0.1, 0.98), 3)

    return {
        "analysis_confidence": geometry.get("analysis_confidence") or "heuristic",
        "numeric_score": numeric_score,
        "partial_evidence": bool(missing_inputs),
        "missing_inputs": missing_inputs,
        "coverage": {
            "source_file_count": len(source_files),
            "geometry_hotspot_count": len(hotspots),
            "inspection_anomaly_count": len(inspection_anomaly_linkage.get("records") or []),
            "quality_pattern_count": len(quality_pattern_linkage.get("records") or []),
            "package_quality_evidence_count": len([
                item for item in ledger_records
                if _has_classification([item], "quality_evidence")
            ]),
            "drawing_evidence_count": len([
                item for item in ledger_records
                if _has_classification([item], "drawing_evidence")
            ]),
            "design_traceability_evidence_count": len([
                item for item in ledger_records
                if _has_classification([item], "design_traceability_evidence")
            ]),
            "review_priority_count": len(review_priorities),
            "evidence_record_count": evidence_ledger.get("record_count"),
        },
        "warnings": warnings,
    }


def _build_data_quality_notes(metadata, uncertainty_report):
    notes = []
    warnings = _safe_list(metadata.get("warnings"))
    for warning in warnings:
        notes.append({
            "severity": "warning",
            "message": warning,
        })

    for missing in uncertainty_report.get("missing_inputs") or []:
        notes.append({
            "severity": "info",
            "message": f"Missing or limited {missing.replace('_', ' ')}; review-pack remains usable with partial evidence.",
        })

    if not notes:
        notes.append({
            "severity": "info",
            "message": "No data-quality issues were detected in the supplied review inputs.",
        })
    return notes


def build_review_pack_data(payload):
    context = payload.get("context") or {}
    geometry = payload.get("geometry_intelligence") or {}
    hotspots = (payload.get("manufacturing_hotspots") or {}).get("hotspots") or []
    part = summarize_part(context.get("part") or geometry.get("part") or {})
    metrics = geometry.get("metrics") or {}
    features = geometry.get("features") or {}
    inspection_linkage = payload.get("inspection_linkage") or {"summary": {}, "records": []}
    inspection_outliers = _safe_list((payload.get("inspection_outliers") or {}).get("records"))
    quality_linkage = payload.get("quality_linkage") or {"summary": {}, "records": []}
    quality_hotspots = payload.get("quality_hotspots") or {"records": []}
    review_priorities_source = payload.get("review_priorities") or {"records": [], "recommended_actions": []}
    review_priorities = _safe_list(review_priorities_source.get("records"))
    actions = _safe_list(review_priorities_source.get("recommended_actions"))
    package_evidence = [
        item for item in _safe_list(payload.get("package_evidence"))
        if isinstance(item, dict)
    ]
    metadata = context.get("metadata") or {}
    workflow = ((payload.get("workflow") or {}).get("steps")) or ["ingest", "analyze-part", "quality-link", "review-pack"]
    source_refs = payload.get("source_artifact_refs") or []

    inspection_anomaly_linkage = _build_inspection_anomaly_linkage(inspection_linkage, inspection_outliers)
    quality_pattern_linkage = _build_quality_pattern_linkage(quality_linkage, quality_hotspots)
    evidence_ledger = _build_evidence_ledger(hotspots, inspection_anomaly_linkage, quality_pattern_linkage, package_evidence)
    uncertainty_report = _build_uncertainty_coverage_report(
        metadata,
        geometry,
        hotspots,
        inspection_anomaly_linkage,
        quality_pattern_linkage,
        review_priorities,
        evidence_ledger,
    )
    prioritized_hotspots = _build_prioritized_hotspots(
        review_priorities,
        hotspots,
        _safe_list(inspection_linkage.get("records")),
        _safe_list(quality_linkage.get("records")),
        actions,
    )
    executive_summary = _build_executive_summary(
        part,
        hotspots,
        inspection_outliers,
        _safe_list(quality_linkage.get("records")),
        review_priorities,
        actions,
        uncertainty_report,
    )
    data_quality_notes = _build_data_quality_notes(metadata, uncertainty_report)

    return {
        **build_contract_fields(
            payload,
            "review_pack",
            part=part,
            coverage=build_coverage(
                source_artifact_count=len(source_refs),
                source_file_count=len(_safe_list(metadata.get("source_files"))),
                hotspot_count=len(hotspots),
                inspection_record_count=len(_records(payload, "inspection_linkage")),
                inspection_outlier_count=len(inspection_outliers),
                quality_issue_count=len(_records(payload, "quality_linkage")),
                quality_hotspot_count=len(_safe_list(quality_hotspots.get("records"))),
                review_priority_count=len(review_priorities),
            ),
            confidence=build_confidence(
                "heuristic",
                0.76,
                "Canonical review pack combines upstream D artifacts into a decision-oriented JSON contract.",
            ),
            source_artifact_refs=source_refs,
        ),
        "canonical_artifact": {
            "type": "review_pack.json",
            "version": "2.0",
            "json_is_source_of_truth": True,
            "derived_renderers": ["markdown", "pdf"],
        },
        "part": {
            "part_id": part.get("part_id"),
            "name": part.get("name"),
            "description": part.get("description"),
            "revision": part.get("revision"),
            "material": part.get("material"),
            "process": part.get("process"),
        },
        "executive_summary": executive_summary,
        "prioritized_hotspots": prioritized_hotspots,
        "inspection_anomaly_linkage": inspection_anomaly_linkage,
        "quality_pattern_linkage": quality_pattern_linkage,
        "evidence_ledger": evidence_ledger,
        "uncertainty_coverage_report": uncertainty_report,
        "recommended_actions": actions,
        "data_quality_notes": data_quality_notes,
        "geometry_summary": metrics,
        "geometry_features": features,
        "geometry_hotspots": hotspots or [],
        "inspection_linkage": {
            "summary": inspection_linkage.get("summary") or {},
            "records": _safe_list(inspection_linkage.get("records")),
        },
        "inspection_anomalies": inspection_outliers,
        "quality_linkage": {
            "summary": quality_linkage.get("summary") or {},
            "records": _safe_list(quality_linkage.get("records")),
        },
        "quality_hotspots": _safe_list(quality_hotspots.get("records")),
        "review_priorities": review_priorities,
        "evidence_appendix": {
            "geometry_metrics": metrics,
            "geometry_feature_summary": features,
            "source_files": _safe_list(metadata.get("source_files")),
            "package_evidence": package_evidence,
            "warnings": _safe_list(metadata.get("warnings")),
            "inspection_record_count": len(_records(payload, "inspection_linkage")),
            "quality_issue_count": len(_records(payload, "quality_linkage")),
            "canonical_json_note": "review_pack.json is the canonical decision artifact; markdown/pdf are derived renderers.",
        },
        "metadata": {
            "analysis_confidence": geometry.get("analysis_confidence"),
            "artifact_provenance": {
                "workflow": workflow,
                "source_files": _safe_list(metadata.get("source_files")),
                "context_created_at": metadata.get("created_at"),
                "warnings": _safe_list(metadata.get("warnings")),
            },
            "renderers": ["markdown", "pdf"],
            "available_sections": [
                "executive_summary",
                "prioritized_hotspots",
                "inspection_anomaly_linkage",
                "quality_pattern_linkage",
                "evidence_ledger",
                "uncertainty_coverage_report",
                "recommended_actions",
                "data_quality_notes",
                "package_evidence",
            ],
            "package_evidence": {
                "record_count": len(package_evidence),
                "classifications": sorted({
                    classification
                    for item in package_evidence
                    for classification in _safe_list(item.get("classifications"))
                }),
            },
            "renderers_derived_from_canonical_json": ["markdown", "pdf"],
        },
    }


def build_markdown_sections(payload_or_report):
    report = payload_or_report if (payload_or_report or {}).get("executive_summary") else build_review_pack_data(payload_or_report or {})
    part = report["part"]
    executive_summary = report["executive_summary"]
    prioritized_hotspots = report["prioritized_hotspots"]
    inspection_anomaly_linkage = report["inspection_anomaly_linkage"]
    quality_pattern_linkage = report["quality_pattern_linkage"]
    evidence_ledger = report["evidence_ledger"]
    uncertainty_report = report["uncertainty_coverage_report"]
    actions = report["recommended_actions"]
    notes = report["data_quality_notes"]

    lines = [
        f"# Review Pack: {part.get('name', 'unknown_part')}",
        "",
        "## Executive Summary",
        f"- Headline: {executive_summary.get('headline')}",
        f"- Revision: {executive_summary.get('part_revision', 'n/a')}",
        f"- Confidence: {executive_summary.get('confidence', {}).get('label', 'n/a')} ({executive_summary.get('confidence', {}).get('numeric_score', 'n/a')})",
        f"- Top risk categories: {', '.join(executive_summary.get('top_risk_categories') or []) or 'none'}",
        "",
        "## Prioritized Hotspots",
    ]

    if prioritized_hotspots:
        for item in prioritized_hotspots[:5]:
            priority = f"P{item.get('priority_rank')}" if item.get("priority_rank") else "Support"
            action_note = f" Action: {item.get('recommended_action')}" if item.get("recommended_action") else ""
            breakdown = item.get("score_breakdown") or {}
            breakdown_note = ""
            if breakdown:
                breakdown_note = (
                    f" geometry={breakdown.get('geometry_evidence_score', 0)},"
                    f" inspection={breakdown.get('inspection_anomaly_score', 0)},"
                    f" quality={breakdown.get('quality_recurrence_score', 0)}."
                )
            lines.append(
                f"- {priority} {item.get('category')}: score {item.get('score')} from {item.get('title')}."
                f"{breakdown_note}{action_note}"
            )
    else:
        lines.append("- No prioritized hotspots were generated.")

    lines.extend([
        "",
        "## Inspection Anomaly Linkage",
    ])
    if inspection_anomaly_linkage.get("records"):
        for item in inspection_anomaly_linkage["records"][:5]:
            categories = ", ".join(item.get("matched_categories") or []) or "no linked category"
            lines.append(f"- {item.get('dimension_name')}: {item.get('direction')} by {item.get('magnitude')} ({categories})")
    else:
        lines.append("- No out-of-tolerance inspection signals captured.")

    lines.extend([
        "",
        "## Quality Pattern Linkage",
    ])
    if quality_pattern_linkage.get("records"):
        for item in quality_pattern_linkage["records"][:5]:
            lines.append(f"- {item.get('issue_id')}: {item.get('linked_hotspot_category')} via {item.get('description')}")
    else:
        lines.append("- No recurring quality hotspots captured.")

    lines.extend([
        "",
        "## Evidence Ledger",
        f"- Total evidence records: {evidence_ledger.get('record_count')}",
        f"- Geometry records: {evidence_ledger.get('counts_by_type', {}).get('geometry_hotspot', 0)}",
        f"- Inspection records: {evidence_ledger.get('counts_by_type', {}).get('inspection_anomaly', 0)}",
        f"- Quality records: {evidence_ledger.get('counts_by_type', {}).get('quality_pattern', 0)}",
        f"- Package side-input records: {sum(count for key, count in (evidence_ledger.get('counts_by_type') or {}).items() if key not in ['geometry_hotspot', 'inspection_anomaly', 'quality_pattern'])}",
    ])
    for record in (evidence_ledger.get("records") or [])[:5]:
        lines.append(f"- {record.get('type')}: {record.get('title')} [{record.get('category')}]")

    lines.extend([
        "",
        "## Uncertainty / Coverage Report",
        f"- Analysis confidence: {uncertainty_report.get('analysis_confidence')}",
        f"- Numeric score: {uncertainty_report.get('numeric_score')}",
        f"- Missing inputs: {', '.join(uncertainty_report.get('missing_inputs') or []) or 'none'}",
        f"- Partial evidence: {uncertainty_report.get('partial_evidence')}",
    ])

    lines.extend([
        "",
        "## Recommended Actions",
    ])
    if actions:
        for action in actions:
            target = action.get("target_hotspot_id") or action.get("category") or "unassigned hotspot"
            lines.append(f"- [{target}] {action.get('recommended_action')}")
    else:
        lines.append("- No actions generated.")

    lines.extend([
        "",
        "## Data Quality Notes",
    ])
    for note in notes:
        lines.append(f"- {note.get('severity')}: {note.get('message')}")

    return "\n".join(lines) + "\n"

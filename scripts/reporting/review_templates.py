from d_artifact_contract import build_confidence, build_contract_fields, build_coverage, summarize_part


def _records(payload, key):
    return (payload.get(key) or {}).get("records") or []


def build_review_pack_data(payload):
    context = payload.get("context") or {}
    geometry = payload.get("geometry_intelligence") or {}
    hotspots = (payload.get("manufacturing_hotspots") or {}).get("hotspots") or []
    part = summarize_part(context.get("part") or geometry.get("part") or {})
    metrics = geometry.get("metrics") or {}
    features = geometry.get("features") or {}
    inspection_linkage = payload.get("inspection_linkage") or {"summary": {}, "records": []}
    inspection_outliers = payload.get("inspection_outliers") or {"records": []}
    quality_linkage = payload.get("quality_linkage") or {"summary": {}, "records": []}
    quality_hotspots = payload.get("quality_hotspots") or {"records": []}
    review_priorities = payload.get("review_priorities") or {"records": [], "recommended_actions": []}
    actions = review_priorities.get("recommended_actions") or []
    metadata = context.get("metadata") or {}
    source_refs = payload.get("source_artifact_refs") or []

    return {
        **build_contract_fields(
            payload,
            "review_pack",
            part=part,
            coverage=build_coverage(
                source_artifact_count=len(source_refs),
                source_file_count=len(metadata.get("source_files") or []),
                hotspot_count=len(hotspots),
                inspection_record_count=len(_records(payload, "inspection_linkage")),
                inspection_outlier_count=len(inspection_outliers.get("records") or []),
                quality_issue_count=len(_records(payload, "quality_linkage")),
                quality_hotspot_count=len(quality_hotspots.get("records") or []),
                review_priority_count=len(review_priorities.get("records") or []),
            ),
            confidence=build_confidence(
                "heuristic",
                0.76,
                "Canonical review pack combines upstream D artifacts into a decision-oriented JSON contract.",
            ),
            source_artifact_refs=source_refs,
        ),
        "canonical_artifact": True,
        "part": {
            "part_id": part.get("part_id"),
            "name": part.get("name"),
            "description": part.get("description"),
            "revision": part.get("revision"),
            "material": part.get("material"),
            "process": part.get("process"),
        },
        "geometry_summary": metrics,
        "geometry_features": features,
        "geometry_hotspots": hotspots or [],
        "inspection_linkage": {
            "summary": inspection_linkage.get("summary") or {},
            "records": inspection_linkage.get("records") or [],
        },
        "inspection_anomalies": inspection_outliers.get("records") or [],
        "quality_linkage": {
            "summary": quality_linkage.get("summary") or {},
            "records": quality_linkage.get("records") or [],
        },
        "quality_hotspots": quality_hotspots.get("records") or [],
        "review_priorities": review_priorities.get("records") or [],
        "recommended_actions": actions,
        "evidence_appendix": {
            "geometry_metrics": metrics,
            "geometry_feature_summary": features,
            "source_files": metadata.get("source_files") or [],
            "warnings": metadata.get("warnings") or [],
            "inspection_record_count": len(_records(payload, "inspection_linkage")),
            "quality_issue_count": len(_records(payload, "quality_linkage")),
        },
        "metadata": {
            "analysis_confidence": geometry.get("analysis_confidence"),
            "artifact_provenance": {
                "workflow": ["ingest", "analyze-part", "quality-link", "review-pack"],
                "source_files": metadata.get("source_files") or [],
                "context_created_at": metadata.get("created_at"),
                "warnings": metadata.get("warnings") or [],
            },
            "renderers": ["markdown", "pdf"],
            "available_sections": [
                "part",
                "geometry_summary",
                "geometry_hotspots",
                "inspection_linkage",
                "inspection_anomalies",
                "quality_linkage",
                "quality_hotspots",
                "review_priorities",
                "recommended_actions",
                "evidence_appendix",
            ],
        },
    }


def build_markdown_sections(payload_or_report):
    report = payload_or_report if (payload_or_report or {}).get("artifact_type") == "review_pack" else build_review_pack_data(payload_or_report)
    part = report["part"]
    hotspots = report["geometry_hotspots"]
    inspection_outliers = report["inspection_anomalies"]
    quality_hotspots = report["quality_hotspots"]
    review_priorities = report["review_priorities"]
    actions = report["recommended_actions"]
    evidence = report["evidence_appendix"]

    lines = [
        f"# Review Pack: {part.get('name', 'unknown_part')}",
        "",
        "## Part Summary",
        f"- Part ID: {part.get('part_id', 'n/a')}",
        f"- Revision: {part.get('revision', 'n/a')}",
        f"- Material: {part.get('material', 'n/a')}",
        f"- Process: {part.get('process', 'n/a')}",
        "",
        "## Geometry Hotspots",
    ]

    if hotspots:
        for hotspot in hotspots[:5]:
            lines.append(f"- {hotspot.get('title')}: {hotspot.get('rationale')}")
    else:
        lines.append("- No geometry hotspots supplied.")

    lines.extend([
        "",
        "## Inspection Anomalies",
    ])
    if inspection_outliers:
        for item in inspection_outliers[:5]:
            lines.append(f"- {item.get('dimension_name')}: {item.get('direction')} by {item.get('magnitude')}")
    else:
        lines.append("- No out-of-tolerance inspection signals captured.")

    lines.extend([
        "",
        "## Quality Linkage",
    ])
    if quality_hotspots:
        for item in quality_hotspots[:5]:
            title = item.get("title") or item.get("category")
            lines.append(f"- {title}: score {item.get('score')}")
    else:
        lines.append("- No recurring quality hotspots captured.")

    lines.extend([
        "",
        "## Review Priorities",
    ])
    if review_priorities:
        for priority in review_priorities[:5]:
            breakdown = priority.get("score_breakdown") or {}
            lines.append(
                f"- P{priority.get('priority_rank')}: {priority.get('title')} "
                f"({priority.get('score')}; geometry={breakdown.get('geometry_evidence_score', 0)}, "
                f"inspection={breakdown.get('inspection_anomaly_score', 0)}, "
                f"quality={breakdown.get('quality_recurrence_score', 0)})"
            )
    else:
        lines.append("- No review priorities were generated.")

    lines.extend([
        "",
        "## Recommended Actions",
    ])
    if actions:
        for action in actions:
            target = action.get("target_hotspot_id") or "unassigned hotspot"
            lines.append(f"- [{target}] {action.get('recommended_action')}")
    else:
        lines.append("- No actions generated.")

    lines.extend([
        "",
        "## Evidence Appendix",
        f"- Bounding box: {report.get('geometry_summary', {}).get('bounding_box_mm')}",
        f"- Complexity score: {report.get('geometry_features', {}).get('complexity_score')}",
        f"- Inspection records: {evidence.get('inspection_record_count')}",
        f"- Quality issues: {evidence.get('quality_issue_count')}",
        f"- Source files: {', '.join(evidence.get('source_files') or []) or 'n/a'}",
    ])
    return "\n".join(lines) + "\n"

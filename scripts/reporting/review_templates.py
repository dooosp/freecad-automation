def build_markdown_sections(payload):
    context = payload.get("context") or {}
    geometry = payload.get("geometry_intelligence") or {}
    hotspots = (payload.get("manufacturing_hotspots") or {}).get("hotspots") or []
    inspection_outliers = (payload.get("inspection_outliers") or {}).get("records") or []
    quality_hotspots = (payload.get("quality_hotspots") or {}).get("records") or []
    review_priorities = (payload.get("review_priorities") or {}).get("records") or []
    actions = (payload.get("review_priorities") or {}).get("recommended_actions") or []

    part = context.get("part") or geometry.get("part") or {}
    metrics = geometry.get("metrics") or {}

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
            lines.append(f"- {item.get('category')}: score {item.get('score')}")
    else:
        lines.append("- No recurring quality hotspots captured.")

    lines.extend([
        "",
        "## Review Priorities",
    ])
    if review_priorities:
        for priority in review_priorities[:5]:
            lines.append(f"- P{priority.get('priority_rank')}: {priority.get('title')} ({priority.get('score')})")
    else:
        lines.append("- No review priorities were generated.")

    lines.extend([
        "",
        "## Recommended Actions",
    ])
    if actions:
        for action in actions:
            lines.append(f"- {action.get('recommended_action')}")
    else:
        lines.append("- No actions generated.")

    lines.extend([
        "",
        "## Evidence Appendix",
        f"- Bounding box: {metrics.get('bounding_box_mm')}",
        f"- Complexity score: {(geometry.get('features') or {}).get('complexity_score')}",
        f"- Inspection records: {len((payload.get('inspection_linkage') or {}).get('records') or [])}",
        f"- Quality issues: {len((payload.get('quality_linkage') or {}).get('records') or [])}",
    ])
    return "\n".join(lines) + "\n"

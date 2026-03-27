from adapters.common import tokenize
from linkage.inspection_metrics import summarize_inspection


def _build_feature_index(geometry_intelligence, hotspots):
    index = []
    features = (geometry_intelligence or {}).get("features") or {}
    if (features.get("hole_like_feature_count") or 0) > 0:
        index.append(("hole", "hole_pattern"))
        index.append(("bore", "hole_pattern"))
    if features.get("thin_wall_candidates"):
        index.append(("wall", "wall_thickness"))
        index.append(("thickness", "wall_thickness"))
    if features.get("deep_pocket_candidates"):
        index.append(("pocket", "tool_access"))
    if features.get("inner_corner_risk_candidates"):
        index.append(("corner", "stress_or_tooling"))
        index.append(("fillet", "stress_or_tooling"))

    for hotspot in hotspots or []:
        category = hotspot.get("category")
        title = hotspot.get("title", "").lower()
        for token in tokenize(title):
            index.append((token, category))

    return index


def map_inspection_results(context, geometry_intelligence, hotspot_payload):
    inspection_results = (context or {}).get("inspection_results") or []
    hotspots = (hotspot_payload or {}).get("hotspots") or []
    feature_index = _build_feature_index(geometry_intelligence, hotspots)
    summary, outliers = summarize_inspection(inspection_results)

    linkage = []
    for result in inspection_results:
        tokens = set(tokenize(result.get("dimension_name")))
        if result.get("feature_hint"):
            tokens.update(tokenize(result.get("feature_hint")))

        matched_categories = []
        for token, category in feature_index:
            if token in tokens and category not in matched_categories:
                matched_categories.append(category)

        rationale = "Matched by dimension/feature tokens." if matched_categories else "No strong geometry token match."
        linkage.append({
            "record_id": result.get("record_id"),
            "dimension_name": result.get("dimension_name"),
            "matched_categories": matched_categories,
            "status": result.get("status"),
            "deviation": result.get("deviation"),
            "rationale": rationale,
            "confidence": 0.75 if matched_categories else 0.2,
        })

    return {
        "summary": summary,
        "records": linkage,
    }, outliers

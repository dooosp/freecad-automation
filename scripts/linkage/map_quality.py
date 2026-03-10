from collections import defaultdict

from linkage.quality_patterns import infer_quality_pattern


def map_quality_issues(context, hotspot_payload):
    issues = (context or {}).get("quality_issues") or []
    hotspots = (hotspot_payload or {}).get("hotspots") or []
    hotspot_categories = {hotspot.get("category") for hotspot in hotspots}

    linkage_records = []
    hotspot_scores = defaultdict(float)

    for issue in issues:
        pattern = infer_quality_pattern(issue)
        category = pattern.get("category")
        linked = category in hotspot_categories
        score = pattern.get("severity_score", 0.35) * max(issue.get("occurrence_count") or 1, 1)
        hotspot_scores[category] += score
        linkage_records.append({
            "issue_id": issue.get("issue_id"),
            "description": issue.get("description"),
            "defect_code": issue.get("defect_code"),
            "likely_feature_class": pattern.get("feature_class"),
            "linked_hotspot_category": category,
            "linked_to_geometry": linked,
            "occurrence_count": issue.get("occurrence_count"),
            "severity_score": round(score, 3),
            "rationale": f"Matched quality token '{pattern.get('matched_token')}'." if pattern.get("matched_token") else "No strong rule match; keeping weak linkage.",
        })

    ranked_hotspots = [
        {
            "category": category,
            "score": round(score, 3),
        }
        for category, score in hotspot_scores.items()
        if category and category != "unknown"
    ]
    ranked_hotspots.sort(key=lambda item: item["score"], reverse=True)

    return {
        "summary": {
            "issue_count": len(issues),
            "matched_categories": len(ranked_hotspots),
        },
        "records": linkage_records,
    }, ranked_hotspots

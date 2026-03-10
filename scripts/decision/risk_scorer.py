def score_review_risks(hotspots, inspection_outliers, quality_hotspots):
    scores = {}

    for hotspot in hotspots or []:
        category = hotspot.get("category") or "uncategorized"
        scores.setdefault(category, {"category": category, "score": 0.0, "evidence": []})
        scores[category]["score"] += hotspot.get("score", 0)
        scores[category]["evidence"].append({"type": "geometry", "title": hotspot.get("title")})

    for outlier in inspection_outliers or []:
        category = "inspection_variation"
        scores.setdefault(category, {"category": category, "score": 0.0, "evidence": []})
        scores[category]["score"] += min(1.0, 0.2 + outlier.get("magnitude", 0))
        scores[category]["evidence"].append({"type": "inspection", "record_id": outlier.get("record_id")})

    for hotspot in quality_hotspots or []:
        category = hotspot.get("category") or "quality_pattern"
        scores.setdefault(category, {"category": category, "score": 0.0, "evidence": []})
        scores[category]["score"] += min(1.5, hotspot.get("score", 0) / 3)
        scores[category]["evidence"].append({"type": "quality", "score": hotspot.get("score")})

    ranked = list(scores.values())
    for item in ranked:
        item["score"] = round(item["score"], 3)
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return ranked

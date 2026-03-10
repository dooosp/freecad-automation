def _hotspot(title, category, severity, score, rationale, evidence):
    return {
        "title": title,
        "category": category,
        "severity": severity,
        "score": round(score, 3),
        "rationale": rationale,
        "evidence": evidence,
    }


def detect_hotspots(metrics, features):
    hotspots = []
    aspect_ratio = metrics.get("max_aspect_ratio") or 0
    thinness_ratio = metrics.get("thinness_ratio") or 0
    complexity = features.get("complexity_score") or 0

    if aspect_ratio >= 6:
        hotspots.append(_hotspot(
            "Slender geometry review",
            "slenderness",
            "high" if aspect_ratio >= 10 else "medium",
            min(1.0, aspect_ratio / 12),
            "Large aspect ratio can increase review focus on stiffness, handling, and fixture strategy.",
            {"max_aspect_ratio": aspect_ratio},
        ))

    for candidate in features.get("thin_wall_candidates") or []:
        hotspots.append(_hotspot(
            "Thin-wall candidate",
            "wall_thickness",
            "high" if thinness_ratio < 0.08 else "medium",
            candidate.get("confidence", 0.5),
            "Bounding-box thinness suggests regions that may be sensitive to distortion or manufacturing variation.",
            candidate,
        ))

    for candidate in features.get("deep_pocket_candidates") or []:
        hotspots.append(_hotspot(
            "Deep pocket review",
            "tool_access",
            "medium",
            candidate.get("confidence", 0.5),
            "Low compactness and high face count suggest tool-access or cleanup review points.",
            candidate,
        ))

    for candidate in features.get("inner_corner_risk_candidates") or []:
        hotspots.append(_hotspot(
            "Inner corner risk",
            "stress_or_tooling",
            "medium",
            candidate.get("confidence", 0.5),
            "Sharp internal transitions can drive stress concentration or tooling complexity.",
            candidate,
        ))

    if (features.get("hole_pattern_count") or 0) >= 1:
        hotspots.append(_hotspot(
            "Repeated hole pattern",
            "patterning",
            "medium",
            min(1.0, 0.3 + (features["hole_pattern_count"] * 0.2)),
            "Repeated hole patterns are good candidates for inspection and datum review.",
            {"hole_pattern_count": features["hole_pattern_count"]},
        ))

    if complexity >= 55:
        hotspots.append(_hotspot(
            "High complexity review",
            "complexity",
            "medium" if complexity < 80 else "high",
            min(1.0, complexity / 100),
            "Geometry complexity is high enough to justify focused review sequencing.",
            {"complexity_score": complexity},
        ))

    hotspots.sort(key=lambda item: item["score"], reverse=True)
    return hotspots

from adapters.common import tokenize

QUALITY_RULES = {
    "burr": {"feature_class": "edge_condition", "category": "stress_or_tooling", "severity": 0.5},
    "warp": {"feature_class": "thin_wall", "category": "wall_thickness", "severity": 0.85},
    "distortion": {"feature_class": "thin_wall", "category": "wall_thickness", "severity": 0.75},
    "crack": {"feature_class": "inner_corner", "category": "stress_or_tooling", "severity": 0.9},
    "porosity": {"feature_class": "pocket_or_mass", "category": "complexity", "severity": 0.6},
    "diameter": {"feature_class": "hole", "category": "patterning", "severity": 0.65},
    "hole": {"feature_class": "hole", "category": "patterning", "severity": 0.65},
    "misalign": {"feature_class": "datum_or_pattern", "category": "patterning", "severity": 0.7},
}


def infer_quality_pattern(issue):
    description_tokens = tokenize(issue.get("description"))
    description_tokens.extend(tokenize(issue.get("defect_code")))
    description_tokens.extend(tokenize(issue.get("defect_class")))
    description_tokens.extend(tokenize(issue.get("feature_hint")))

    for token in description_tokens:
        if token in QUALITY_RULES:
            pattern = QUALITY_RULES[token]
            return {
                "matched_token": token,
                "feature_class": pattern["feature_class"],
                "category": pattern["category"],
                "severity_score": pattern["severity"],
            }

    return {
        "matched_token": None,
        "feature_class": issue.get("feature_hint") or "unknown",
        "category": "unknown",
        "severity_score": 0.35,
    }

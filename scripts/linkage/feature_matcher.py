from adapters.common import tokenize


FEATURE_ALIASES = {
    "hole": {"hole", "diameter", "bore", "drill", "mounting"},
    "pattern": {"pattern", "datum", "spacing", "pcd", "bolt"},
    "thin_wall": {"wall", "thin", "thickness", "web", "warp", "distortion", "section"},
    "inner_corner": {"corner", "fillet", "radius", "edge", "transition", "crack"},
    "tool_access": {"pocket", "tool", "access", "cleanup", "reach", "depth"},
    "complexity": {"complexity", "complex", "setup"},
    "slenderness": {"slender", "stiffness", "handling", "fixture"},
}

CATEGORY_FEATURE_REFS = {
    "patterning": ["hole", "pattern"],
    "wall_thickness": ["thin_wall"],
    "stress_or_tooling": ["inner_corner"],
    "tool_access": ["tool_access"],
    "complexity": ["complexity"],
    "slenderness": ["slenderness"],
}


def _dedupe(values):
    seen = set()
    ordered = []
    for value in values or []:
        text = str(value or "").strip().lower()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def infer_feature_refs(*values):
    tokens = set()
    for value in values:
        if isinstance(value, (list, tuple, set)):
            for item in value:
                tokens.update(tokenize(item))
        else:
            tokens.update(tokenize(value))

    refs = []
    for canonical, aliases in FEATURE_ALIASES.items():
        if tokens & aliases:
            refs.append(canonical)
    return _dedupe(refs)


def build_hotspot_feature_refs(hotspot):
    evidence = hotspot.get("evidence") or {}
    refs = []
    refs.extend(CATEGORY_FEATURE_REFS.get(hotspot.get("category"), []))
    refs.extend(infer_feature_refs(
        hotspot.get("title"),
        hotspot.get("category"),
        hotspot.get("rationale"),
        evidence.get("feature_type"),
        evidence.get("evidence"),
    ))
    feature_type = str(evidence.get("feature_type") or "").strip().lower()
    if feature_type:
        refs.append(feature_type)
    return _dedupe(refs)


def match_feature_refs(signal_feature_refs, hotspot):
    signal_refs = set(_dedupe(signal_feature_refs))
    hotspot_refs = set(_dedupe(hotspot.get("feature_refs") or []))
    overlap = sorted(signal_refs & hotspot_refs)
    if not overlap:
        return {"score": 0.0, "matched_feature_refs": []}

    score = 0.7 + (0.1 * min(len(overlap), 3))
    return {
        "score": round(min(1.0, score), 3),
        "matched_feature_refs": overlap,
    }

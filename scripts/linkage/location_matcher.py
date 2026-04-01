from adapters.common import tokenize


CATEGORY_LOCATION_ALIASES = {
    "patterning": ["pattern", "mounting", "hole", "datum"],
    "wall_thickness": ["wall", "web", "section", "rib", "side"],
    "stress_or_tooling": ["corner", "edge", "transition"],
    "tool_access": ["pocket", "cavity", "internal"],
    "complexity": ["overall", "general"],
    "slenderness": ["span", "length", "fixture"],
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


def build_hotspot_location_aliases(hotspot):
    evidence = hotspot.get("evidence") or {}
    aliases = []
    aliases.extend(CATEGORY_LOCATION_ALIASES.get(hotspot.get("category"), []))
    aliases.extend(tokenize(hotspot.get("title")))
    aliases.extend(tokenize(hotspot.get("rationale")))
    aliases.extend(tokenize(evidence.get("feature_type")))
    aliases.extend(tokenize(evidence.get("evidence")))
    return _dedupe(aliases)


def match_location(location_hint, hotspot):
    hint_tokens = set(tokenize(location_hint))
    hotspot_tokens = set(_dedupe(hotspot.get("location_aliases") or []))
    overlap = sorted(hint_tokens & hotspot_tokens)
    if not hint_tokens or not hotspot_tokens or not overlap:
        return {"score": 0.0, "matched_tokens": []}

    exact = "_".join(sorted(hint_tokens)) == "_".join(sorted(overlap))
    score = 0.55 + (0.15 * min(len(overlap), 3))
    if exact:
        score += 0.15
    return {
        "score": round(min(1.0, score), 3),
        "matched_tokens": overlap,
    }

from adapters.common import tokenize


def dedupe(values):
    seen = set()
    ordered = []
    for value in values or []:
        if isinstance(value, dict):
            marker = tuple(sorted(value.items()))
        else:
            marker = str(value or "").strip().lower()
        if not marker or marker in seen:
            continue
        seen.add(marker)
        ordered.append(value)
    return ordered


def lexical_match(values, hotspot):
    signal_tokens = set()
    for value in values or []:
        if isinstance(value, (list, tuple, set)):
            for item in value:
                signal_tokens.update(tokenize(item))
        else:
            signal_tokens.update(tokenize(value))

    hotspot_tokens = set(hotspot.get("tokens") or [])
    overlap = sorted(signal_tokens & hotspot_tokens)
    if not signal_tokens or not hotspot_tokens or not overlap:
        return {"score": 0.0, "matched_tokens": []}

    coverage = len(overlap) / max(1, min(len(signal_tokens), len(hotspot_tokens)))
    score = 0.45 + (0.4 * min(coverage, 1.0))
    if hotspot.get("category") in signal_tokens:
        score = max(score, 0.9)
    return {
        "score": round(min(1.0, score), 3),
        "matched_tokens": overlap,
    }


def summarize_match_type(reason_codes):
    dimensions = []
    if "lexical_match" in reason_codes:
        dimensions.append("lexical")
    if "location_match" in reason_codes:
        dimensions.append("location")
    if "feature_class_match" in reason_codes:
        dimensions.append("feature_class")
    if "process_step_match" in reason_codes:
        dimensions.append("process_step")
    if not dimensions:
        return "unmatched"
    if len(dimensions) == 1:
        return f"{dimensions[0]}_only"
    return "multi_factor"


def select_top_matches(candidate_matches, threshold=0.42, ambiguity_delta=0.08, max_links=3):
    ranked = sorted(candidate_matches or [], key=lambda item: item.get("total_score", 0), reverse=True)
    strong = [item for item in ranked if item.get("total_score", 0) >= threshold]
    if not strong:
        return [], {"is_ambiguous": False, "candidate_hotspot_ids": [], "top_score_gap": None}

    top = strong[0]
    selected = [top]
    for item in strong[1:]:
        if len(selected) >= max_links:
            break
        if (top.get("total_score", 0) - item.get("total_score", 0)) <= ambiguity_delta:
            selected.append(item)

    gap = None
    if len(strong) > 1:
        gap = round(top.get("total_score", 0) - strong[1].get("total_score", 0), 3)

    return selected, {
        "is_ambiguous": len(selected) > 1,
        "candidate_hotspot_ids": [item.get("hotspot_id") for item in selected],
        "top_score_gap": gap,
    }

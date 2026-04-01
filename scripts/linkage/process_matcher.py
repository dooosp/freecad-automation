from adapters.common import tokenize


PROCESS_ALIASES = {
    "machining": {"machining", "machine", "mill", "milling", "fixture", "setup"},
    "drill": {"drill", "drilling", "ream", "boring", "hole"},
    "heat_treat": {"heat", "treat", "heat_treat", "quench", "temper", "distortion", "warp"},
    "inspection": {"inspection", "gage", "measurement", "cmm"},
}

CATEGORY_PROCESS_STEPS = {
    "patterning": ["drill", "inspection", "machining"],
    "wall_thickness": ["machining", "heat_treat"],
    "stress_or_tooling": ["machining"],
    "tool_access": ["machining"],
    "complexity": ["machining", "inspection"],
    "slenderness": ["machining", "inspection"],
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


def infer_process_steps(*values):
    tokens = set()
    for value in values:
        if isinstance(value, (list, tuple, set)):
            for item in value:
                tokens.update(tokenize(item))
        else:
            tokens.update(tokenize(value))

    steps = []
    for canonical, aliases in PROCESS_ALIASES.items():
        if tokens & aliases:
            steps.append(canonical)
    return _dedupe(steps)


def build_hotspot_process_steps(hotspot, default_process=None):
    evidence = hotspot.get("evidence") or {}
    steps = []
    steps.extend(CATEGORY_PROCESS_STEPS.get(hotspot.get("category"), []))
    steps.extend(infer_process_steps(
        default_process,
        hotspot.get("title"),
        hotspot.get("rationale"),
        evidence.get("evidence"),
    ))
    return _dedupe(steps)


def match_process(process_step, hotspot, default_process=None):
    signal_steps = set(infer_process_steps(process_step, default_process))
    hotspot_steps = set(_dedupe(hotspot.get("process_steps") or []))
    overlap = sorted(signal_steps & hotspot_steps)
    if not signal_steps or not hotspot_steps or not overlap:
        return {"score": 0.0, "matched_process_steps": []}

    score = 0.6 + (0.15 * min(len(overlap), 2))
    return {
        "score": round(min(1.0, score), 3),
        "matched_process_steps": overlap,
    }

from adapters.common import unique_list


def severity_from_score(score):
    value = float(score or 0)
    if value >= 0.8:
        return "high"
    if value >= 0.45:
        return "medium"
    return "low"


def slenderness_reason_codes(aspect_ratio):
    codes = ["geometry.aspect_ratio.elevated"]
    if (aspect_ratio or 0) >= 10:
        codes.append("geometry.aspect_ratio.critical")
    return unique_list(codes)


def thin_wall_reason_codes(thinness_ratio, evidence_refs=None):
    codes = ["geometry.thinness.low"]
    if (thinness_ratio or 0) < 0.08:
        codes.append("geometry.thinness.critical")
    if evidence_refs:
        codes.append("evidence.wall.signal")
    return unique_list(codes)


def hole_pattern_reason_codes(pattern_count, evidence_refs=None):
    codes = ["geometry.hole_pattern.repeated"]
    if (pattern_count or 0) >= 4:
        codes.append("geometry.hole_pattern.dense")
    if evidence_refs:
        codes.append("evidence.pattern.signal")
    return unique_list(codes)


def deep_pocket_reason_codes(compactness_ratio, face_count, evidence_refs=None):
    codes = ["geometry.compactness.low", "geometry.face_count.high"]
    if (compactness_ratio or 0) < 0.35:
        codes.append("geometry.compactness.very_low")
    if evidence_refs:
        codes.append("evidence.tool_access.signal")
    return unique_list(codes)


def inner_corner_reason_codes(fillet_count, evidence_refs=None):
    codes = ["geometry.corner.internal_risk"]
    if not fillet_count:
        codes.append("geometry.fillet.absent")
    if evidence_refs:
        codes.append("evidence.corner.signal")
    return unique_list(codes)


def complexity_reason_codes(complexity_score):
    codes = ["geometry.complexity.high"]
    if (complexity_score or 0) >= 80:
        codes.append("geometry.complexity.critical")
    return unique_list(codes)

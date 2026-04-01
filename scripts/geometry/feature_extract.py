from adapters.common import tokenize, unique_list
from adapters.id_resolver import canonical_ref
from geometry.entity_index import stable_ref
from geometry.reason_codes import (
    deep_pocket_reason_codes,
    hole_pattern_reason_codes,
    inner_corner_reason_codes,
    thin_wall_reason_codes,
)


def _count_hole_like_features(feature_hints):
    cylinders = (feature_hints or {}).get("cylinders") or []
    return sum(1 for cylinder in cylinders if cylinder.get("is_hole"))


def _evidence_ref(kind, record):
    explicit_id = record.get("record_id") or record.get("issue_id")
    if explicit_id:
        return f"{kind}:{explicit_id}"
    source_ref = record.get("source_ref")
    if source_ref:
        return f"{kind}:{source_ref}"
    return None


def _build_evidence_signals(context):
    signals = []

    for record in (context or {}).get("inspection_results") or []:
        signals.append({
            "kind": "inspection",
            "evidence_ref": _evidence_ref("inspection", record),
            "region_ref": record.get("normalized_location_ref") or canonical_ref("region", record.get("location_hint")) or "region:global",
            "feature_ref": record.get("normalized_feature_ref") or canonical_ref("feature", record.get("feature_hint")),
            "tokens": unique_list(
                tokenize(record.get("feature_hint"))
                + tokenize(record.get("location_hint"))
                + tokenize(record.get("dimension_name"))
            ),
            "status": record.get("status"),
        })

    for record in (context or {}).get("quality_issues") or []:
        signals.append({
            "kind": "quality",
            "evidence_ref": _evidence_ref("quality", record),
            "region_ref": record.get("normalized_location_ref") or canonical_ref("region", record.get("location_hint")) or "region:global",
            "feature_ref": record.get("normalized_feature_ref") or canonical_ref("feature", record.get("feature_hint")),
            "tokens": unique_list(
                tokenize(record.get("feature_hint"))
                + tokenize(record.get("location_hint"))
                + tokenize(record.get("description"))
                + tokenize(record.get("defect_class"))
            ),
            "status": record.get("status"),
        })

    return signals


def _select_signals(signals, match_tokens):
    token_set = set(match_tokens or [])
    matches = []
    for signal in signals:
        signal_tokens = set(signal.get("tokens") or [])
        if token_set and token_set.intersection(signal_tokens):
            matches.append(signal)
    return matches


def _preferred_region(matches):
    ranked = {}
    for match in matches:
        region_ref = match.get("region_ref") or "region:global"
        if region_ref == "region:global":
            continue
        ranked[region_ref] = ranked.get(region_ref, 0) + 1
    if not ranked:
        return "region:global"
    return sorted(ranked.items(), key=lambda item: (-item[1], item[0]))[0][0]


def _evidence_refs(matches):
    return unique_list([match.get("evidence_ref") for match in matches if match.get("evidence_ref")])


def _feature_record(feature_type, region_ref, entity_refs, score, confidence, reason_codes, evidence_refs, match_tokens, details):
    feature_id = stable_ref(
        "feature",
        feature_type,
        feature_type,
        region_ref,
        *sorted(entity_refs or []),
        *sorted(evidence_refs or []),
    )
    return {
        "feature_id": feature_id,
        "feature_type": feature_type,
        "region_ref": region_ref,
        "entity_refs": list(entity_refs or []),
        "score": round(score, 3),
        "confidence": round(confidence, 3),
        "reason_codes": list(reason_codes or []),
        "evidence_refs": list(evidence_refs or []),
        "match_tokens": unique_list(match_tokens or []),
        "details": dict(details or {}),
    }


def extract_geometry_features(model_metadata, feature_hints, metrics, geometry_facts=None, entity_index=None, context=None):
    hole_count = _count_hole_like_features(feature_hints)
    bolt_patterns = len((feature_hints or {}).get("bolt_circles") or [])
    fillet_count = len((feature_hints or {}).get("fillets") or [])
    chamfer_count = len((feature_hints or {}).get("chamfers") or [])
    face_count = metrics.get("face_count") or 0
    max_ratio = metrics.get("max_aspect_ratio") or 0
    thinness_ratio = metrics.get("thinness_ratio") or 0
    compactness_ratio = metrics.get("compactness_ratio") or 0
    entity_index = entity_index or {}
    evidence_signals = _build_evidence_signals(context)
    derived_records = []

    thin_wall_candidates = []
    if thinness_ratio and thinness_ratio < 0.12:
        match_tokens = ["thin", "wall", "thickness"]
        matches = _select_signals(evidence_signals, match_tokens)
        evidence_refs = _evidence_refs(matches)
        region_ref = _preferred_region(matches)
        candidate = {
            "feature_type": "thin_wall",
            "confidence": 0.6 if thinness_ratio > 0.07 else 0.8,
            "evidence": f"thinness_ratio={thinness_ratio}",
        }
        thin_wall_candidates.append(candidate)
        derived_records.append(_feature_record(
            "thin_wall_candidate",
            region_ref,
            [],
            candidate["confidence"],
            candidate["confidence"],
            thin_wall_reason_codes(thinness_ratio, evidence_refs),
            evidence_refs,
            match_tokens,
            {
                "thinness_ratio": thinness_ratio,
                "max_aspect_ratio": max_ratio,
            },
        ))

    deep_pocket_candidates = []
    if face_count >= 24 and bolt_patterns == 0 and (metrics.get("compactness_ratio") or 0) < 0.45:
        match_tokens = ["pocket", "cavity", "access"]
        matches = _select_signals(evidence_signals, match_tokens)
        evidence_refs = _evidence_refs(matches)
        region_ref = _preferred_region(matches)
        candidate = {
            "feature_type": "deep_pocket",
            "confidence": 0.55,
            "evidence": "high face count with low compactness",
        }
        deep_pocket_candidates.append(candidate)
        derived_records.append(_feature_record(
            "deep_pocket_candidate",
            region_ref,
            [],
            candidate["confidence"],
            candidate["confidence"],
            deep_pocket_reason_codes(compactness_ratio, face_count, evidence_refs),
            evidence_refs,
            match_tokens,
            {
                "face_count": face_count,
                "compactness_ratio": compactness_ratio,
            },
        ))

    inner_corner_risk = []
    if face_count >= 18 and fillet_count == 0:
        match_tokens = ["corner", "fillet", "radius"]
        matches = _select_signals(evidence_signals, match_tokens)
        evidence_refs = _evidence_refs(matches)
        region_ref = _preferred_region(matches)
        candidate = {
            "feature_type": "inner_corner",
            "confidence": 0.65,
            "evidence": "complex shape without fillet evidence",
        }
        inner_corner_risk.append(candidate)
        derived_records.append(_feature_record(
            "inner_corner_risk",
            region_ref,
            [],
            candidate["confidence"],
            candidate["confidence"],
            inner_corner_reason_codes(fillet_count, evidence_refs),
            evidence_refs,
            match_tokens,
            {
                "face_count": face_count,
                "fillet_count": fillet_count,
            },
        ))

    for bolt_circle in entity_index.get("bolt_circles") or []:
        match_tokens = ["hole", "pattern", "bore"]
        matches = _select_signals(evidence_signals, match_tokens)
        evidence_refs = _evidence_refs(matches)
        region_ref = _preferred_region(matches)
        pattern_score = min(1.0, 0.3 + (bolt_circle.get("hole_count", 0) * 0.1))
        derived_records.append(_feature_record(
            "hole_pattern",
            region_ref,
            [bolt_circle["entity_ref"]],
            pattern_score,
            pattern_score,
            hole_pattern_reason_codes(bolt_circle.get("hole_count"), evidence_refs),
            evidence_refs,
            match_tokens,
            {
                "hole_count": bolt_circle.get("hole_count"),
                "hole_diameter_mm": bolt_circle.get("hole_diameter_mm"),
                "pcd_mm": bolt_circle.get("pcd_mm"),
            },
        ))

    complexity_score = min(
        100,
        round(
            (face_count * 1.4)
            + (hole_count * 5)
            + (bolt_patterns * 7)
            + max(0, (max_ratio - 3) * 4)
            + max(0, (0.2 - thinness_ratio) * 80),
            1,
        ),
    )

    return {
        "hole_like_feature_count": hole_count,
        "hole_pattern_count": bolt_patterns,
        "thin_wall_candidates": thin_wall_candidates,
        "deep_pocket_candidates": deep_pocket_candidates,
        "inner_corner_risk_candidates": inner_corner_risk,
        "fillet_density": round(fillet_count / max(face_count, 1), 4),
        "chamfer_density": round(chamfer_count / max(face_count, 1), 4),
        "feature_density": round((hole_count + fillet_count + chamfer_count) / max(face_count, 1), 4),
        "complexity_score": complexity_score,
        "records": derived_records,
        "derived_feature_count": len(derived_records),
    }

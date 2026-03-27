def _count_hole_like_features(feature_hints):
    cylinders = (feature_hints or {}).get("cylinders") or []
    return sum(1 for cylinder in cylinders if cylinder.get("is_hole"))


def extract_geometry_features(model_metadata, feature_hints, metrics):
    hole_count = _count_hole_like_features(feature_hints)
    bolt_patterns = len((feature_hints or {}).get("bolt_circles") or [])
    fillet_count = len((feature_hints or {}).get("fillets") or [])
    chamfer_count = len((feature_hints or {}).get("chamfers") or [])
    face_count = metrics.get("face_count") or 0
    max_ratio = metrics.get("max_aspect_ratio") or 0
    thinness_ratio = metrics.get("thinness_ratio") or 0

    thin_wall_candidates = []
    if thinness_ratio and thinness_ratio < 0.12:
        thin_wall_candidates.append({
            "feature_type": "thin_wall",
            "confidence": 0.6 if thinness_ratio > 0.07 else 0.8,
            "evidence": f"thinness_ratio={thinness_ratio}",
        })

    deep_pocket_candidates = []
    if face_count >= 24 and bolt_patterns == 0 and (metrics.get("compactness_ratio") or 0) < 0.45:
        deep_pocket_candidates.append({
            "feature_type": "deep_pocket",
            "confidence": 0.55,
            "evidence": "high face count with low compactness",
        })

    inner_corner_risk = []
    if face_count >= 18 and fillet_count == 0:
        inner_corner_risk.append({
            "feature_type": "inner_corner",
            "confidence": 0.65,
            "evidence": "complex shape without fillet evidence",
        })

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
    }

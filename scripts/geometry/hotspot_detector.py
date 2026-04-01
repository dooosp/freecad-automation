from geometry.entity_index import stable_ref
from geometry.reason_codes import (
    complexity_reason_codes,
    severity_from_score,
    slenderness_reason_codes,
)


def _hotspot(title, category, severity, score, rationale, evidence, region_ref="region:global", feature_refs=None, entity_refs=None, reason_codes=None, evidence_refs=None):
    feature_refs = list(feature_refs or [])
    entity_refs = list(entity_refs or [])
    reason_codes = list(reason_codes or [])
    evidence_refs = list(evidence_refs or [])
    return {
        "hotspot_id": stable_ref(
            "hotspot",
            category,
            category,
            region_ref,
            *sorted(feature_refs),
            *sorted(entity_refs),
        ),
        "title": title,
        "category": category,
        "region_ref": region_ref,
        "feature_refs": feature_refs,
        "entity_refs": entity_refs,
        "severity": severity,
        "score": round(score, 3),
        "reason_codes": reason_codes,
        "evidence_refs": evidence_refs,
        "rationale": rationale,
        "evidence": evidence,
    }


def detect_hotspots(metrics, features, geometry_facts=None):
    hotspots = []
    aspect_ratio = metrics.get("max_aspect_ratio") or 0
    thinness_ratio = metrics.get("thinness_ratio") or 0
    complexity = features.get("complexity_score") or 0
    derived_records = (features or {}).get("records") or []

    if aspect_ratio >= 6:
        hotspots.append(_hotspot(
            "Slender geometry review",
            "slenderness",
            "high" if aspect_ratio >= 10 else "medium",
            min(1.0, aspect_ratio / 12),
            "Large aspect ratio can increase review focus on stiffness, handling, and fixture strategy.",
            {"max_aspect_ratio": aspect_ratio},
            reason_codes=slenderness_reason_codes(aspect_ratio),
        ))

    for record in derived_records:
        feature_type = record.get("feature_type")
        if feature_type == "thin_wall_candidate":
            hotspots.append(_hotspot(
                "Thin-wall candidate",
                "wall_thickness",
                "high" if thinness_ratio < 0.08 else severity_from_score(record.get("score")),
                record.get("score", 0.5),
                "Bounding-box thinness suggests regions that may be sensitive to distortion or manufacturing variation.",
                record.get("details") or {},
                region_ref=record.get("region_ref") or "region:global",
                feature_refs=[record.get("feature_id")],
                entity_refs=record.get("entity_refs") or [],
                reason_codes=record.get("reason_codes") or [],
                evidence_refs=record.get("evidence_refs") or [],
            ))
        elif feature_type == "deep_pocket_candidate":
            hotspots.append(_hotspot(
                "Deep pocket review",
                "tool_access",
                severity_from_score(record.get("score")),
                record.get("score", 0.5),
                "Low compactness and high face count suggest tool-access or cleanup review points.",
                record.get("details") or {},
                region_ref=record.get("region_ref") or "region:global",
                feature_refs=[record.get("feature_id")],
                entity_refs=record.get("entity_refs") or [],
                reason_codes=record.get("reason_codes") or [],
                evidence_refs=record.get("evidence_refs") or [],
            ))
        elif feature_type == "inner_corner_risk":
            hotspots.append(_hotspot(
                "Inner corner risk",
                "stress_or_tooling",
                severity_from_score(record.get("score")),
                record.get("score", 0.5),
                "Sharp internal transitions can drive stress concentration or tooling complexity.",
                record.get("details") or {},
                region_ref=record.get("region_ref") or "region:global",
                feature_refs=[record.get("feature_id")],
                entity_refs=record.get("entity_refs") or [],
                reason_codes=record.get("reason_codes") or [],
                evidence_refs=record.get("evidence_refs") or [],
            ))
        elif feature_type == "hole_pattern":
            hotspots.append(_hotspot(
                "Repeated hole pattern",
                "patterning",
                severity_from_score(record.get("score")),
                record.get("score", 0.5),
                "Repeated hole patterns are good candidates for inspection and datum review.",
                record.get("details") or {},
                region_ref=record.get("region_ref") or "region:global",
                feature_refs=[record.get("feature_id")],
                entity_refs=record.get("entity_refs") or [],
                reason_codes=record.get("reason_codes") or [],
                evidence_refs=record.get("evidence_refs") or [],
            ))

    if complexity >= 55:
        hotspots.append(_hotspot(
            "High complexity review",
            "complexity",
            "medium" if complexity < 80 else "high",
            min(1.0, complexity / 100),
            "Geometry complexity is high enough to justify focused review sequencing.",
            {"complexity_score": complexity},
            reason_codes=complexity_reason_codes(complexity),
        ))

    hotspots.sort(key=lambda item: (-item["score"], item["hotspot_id"]))
    return hotspots

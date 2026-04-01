from adapters.common import tokenize
from linkage.feature_matcher import infer_feature_refs, match_feature_refs
from linkage.hotspot_catalog import build_evidence_ref
from linkage.inspection_metrics import summarize_inspection
from linkage.location_matcher import match_location
from linkage.match_utils import dedupe, lexical_match, select_top_matches, summarize_match_type


def _build_signal_feature_refs(result, geometry_intelligence):
    refs = infer_feature_refs(
        result.get("dimension_name"),
        result.get("feature_hint"),
        result.get("location_hint"),
    )
    features = (geometry_intelligence or {}).get("features") or {}
    if (features.get("hole_like_feature_count") or 0) > 0 and "hole" in tokenize(result.get("dimension_name")):
        refs.append("hole")
    if features.get("thin_wall_candidates") and "wall" in tokenize(result.get("dimension_name")):
        refs.append("thin_wall")
    return dedupe(refs)


def _score_hotspot_match(result, hotspot, geometry_intelligence):
    lexical = lexical_match(
        [
            result.get("dimension_name"),
            result.get("feature_hint"),
            result.get("location_hint"),
        ],
        hotspot,
    )
    feature = match_feature_refs(_build_signal_feature_refs(result, geometry_intelligence), hotspot)
    location = match_location(result.get("location_hint"), hotspot)

    total_score = (
        (lexical.get("score", 0) * 0.45)
        + (feature.get("score", 0) * 0.35)
        + (location.get("score", 0) * 0.20)
    )

    reason_codes = []
    if lexical.get("matched_tokens"):
        reason_codes.append("lexical_match")
    if feature.get("matched_feature_refs"):
        reason_codes.append("feature_class_match")
    if location.get("matched_tokens"):
        reason_codes.append("location_match")

    return {
        "hotspot_id": hotspot.get("hotspot_id"),
        "category": hotspot.get("category"),
        "title": hotspot.get("title"),
        "total_score": round(total_score, 3),
        "reason_codes": reason_codes,
        "matched_feature_refs": feature.get("matched_feature_refs") or [],
        "component_scores": {
            "lexical_match": lexical.get("score", 0.0),
            "feature_class_match": feature.get("score", 0.0),
            "location_match": location.get("score", 0.0),
        },
    }


def map_inspection_results(context, geometry_intelligence, hotspots):
    inspection_results = (context or {}).get("inspection_results") or []
    summary, outliers = summarize_inspection(inspection_results)

    linkage = []
    for result in inspection_results:
        candidate_matches = [
            _score_hotspot_match(result, hotspot, geometry_intelligence)
            for hotspot in hotspots or []
        ]
        selected, ambiguity = select_top_matches(candidate_matches, threshold=0.42, ambiguity_delta=0.06)
        reason_codes = dedupe([
            code
            for match in selected
            for code in (match.get("reason_codes") or [])
        ])
        linked_hotspot_ids = [match.get("hotspot_id") for match in selected]
        linked_feature_refs = dedupe([
            ref
            for match in selected
            for ref in (match.get("matched_feature_refs") or [])
        ])
        matched_categories = dedupe([match.get("category") for match in selected])
        top_score = selected[0].get("total_score", 0.0) if selected else 0.0
        confidence = max(0.15, top_score - (0.08 * max(len(selected) - 1, 0))) if selected else 0.15
        rationale = (
            "Linked to geometry hotspots using lexical, feature, and location signals."
            if selected
            else "No hotspot cleared the inspection linkage threshold."
        )
        linkage.append({
            "record_id": result.get("record_id"),
            "dimension_name": result.get("dimension_name"),
            "feature_hint": result.get("feature_hint"),
            "location_hint": result.get("location_hint"),
            "matched_categories": matched_categories,
            "linked_hotspot_ids": linked_hotspot_ids,
            "linked_feature_refs": linked_feature_refs,
            "match_type": summarize_match_type(reason_codes),
            "status": result.get("status"),
            "deviation": result.get("deviation"),
            "rationale": rationale,
            "confidence": round(confidence, 3),
            "reason_codes": reason_codes,
            "ambiguity": ambiguity,
            "evidence_refs": [build_evidence_ref("inspection_result", result, "record_id")],
            "matched_hotspots": [
                {
                    "hotspot_id": match.get("hotspot_id"),
                    "category": match.get("category"),
                    "title": match.get("title"),
                    "score": match.get("total_score"),
                    "component_scores": match.get("component_scores"),
                }
                for match in selected
            ],
        })

    matched_count = sum(1 for record in linkage if record.get("linked_hotspot_ids"))
    ambiguous_count = sum(1 for record in linkage if (record.get("ambiguity") or {}).get("is_ambiguous"))
    unmatched_count = len(linkage) - matched_count

    return {
        "summary": summary,
        "linkage_stats": {
            "matched_record_count": matched_count,
            "ambiguous_record_count": ambiguous_count,
            "unmatched_record_count": unmatched_count,
        },
        "records": linkage,
    }, outliers
